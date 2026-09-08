import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { assertSigningKeyRegistry } from "./signing-key-registry.mjs";
import {
  assertProductionEvidenceManifest,
  PRODUCTION_EVIDENCE_SCOPE,
} from "./production-evidence-contract.mjs";
import { canonicalJson, sha256Base64Url } from "./deployment-attestation.mjs";

export const PRODUCTION_EVIDENCE_SIGNATURE_ALGORITHM = "Ed25519";
export const DEFAULT_MAX_PRODUCTION_EVIDENCE_AGE_SECONDS = 900;
export const PRODUCTION_EVIDENCE_PAYLOAD_FIELDS = [
  "schema_version",
  "scope",
  "status",
  "capture_status",
  "verification_status",
  "production_evidence_status",
  "p0_05_status",
  "production_evidence",
  "p0_05",
  "capture_id",
  "capture_provenance",
  "capture_started_at",
  "capture_finished_at",
  "workflow_context",
  "deployment_identity",
  "result_identity",
  "security_identity",
  "authority_compromise_definitions",
  "worker_authority_boundary",
  "subject_identity",
  "trust_graph",
  "evidence_domains",
  "evidence",
  "semantic_predicates",
  "capture_predicates",
  "device_predicates",
  "semantic_verification",
  "artifacts",
  "independent_verification",
];

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function decodeBase64Url(value, label, expectedLength) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) throw new Error(`${label} is not canonical base64url`);
  if (expectedLength !== undefined && bytes.length !== expectedLength) throw new Error(`${label} has an invalid length`);
  return bytes;
}

function publicKeySpki(publicKey, label) {
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error(`${label} is not Ed25519`);
  return publicKey.export({ format: "der", type: "spki" }).toString("base64url");
}

function publicKeyFromSpki(value, label) {
  const publicKey = createPublicKey({
    key: decodeBase64Url(value, label),
    format: "der",
    type: "spki",
  });
  publicKeySpki(publicKey, label);
  return publicKey;
}

function privateKeyFromPkcs8(value, label) {
  const privateKey = createPrivateKey({
    key: decodeBase64Url(value, label),
    format: "der",
    type: "pkcs8",
  });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error(`${label} is not Ed25519`);
  return privateKey;
}

export function canonicalProductionEvidencePayload(manifest) {
  const payload = {};
  for (const field of PRODUCTION_EVIDENCE_PAYLOAD_FIELDS) {
    if (!(field in (manifest ?? {}))) throw new Error(`production evidence payload is missing ${field}`);
    payload[field] = manifest[field];
  }
  return canonicalJson(payload);
}

export function assertProductionEvidenceFreshness(
  manifest,
  { now = new Date(), maxAgeSeconds = DEFAULT_MAX_PRODUCTION_EVIDENCE_AGE_SECONDS } = {},
) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const finishedMs = Date.parse(manifest?.capture_finished_at ?? "");
  if (!Number.isFinite(nowMs) || !Number.isFinite(finishedMs)) throw new Error("production evidence freshness time is invalid");
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) throw new Error("production evidence maximum age is invalid");
  if (finishedMs > nowMs) throw new Error("production evidence capture is in the future");
  if (nowMs - finishedMs > maxAgeSeconds * 1000) throw new Error("production evidence capture is stale");
}

export function createSignedProductionEvidenceManifest({
  manifest,
  signerKeyId,
  signerPublicKeySpki,
  signingPrivateKeyPkcs8,
}) {
  assertProductionEvidenceManifest(manifest);
  if (!KEY_ID_PATTERN.test(signerKeyId ?? "")) throw new Error("production evidence signer key ID is invalid");
  const privateKey = privateKeyFromPkcs8(signingPrivateKeyPkcs8, "production evidence signing private key");
  const derivedPublicKeySpki = publicKeySpki(createPublicKey(privateKey), "production evidence signing key");
  if (derivedPublicKeySpki !== signerPublicKeySpki) throw new Error("production evidence signer key pair does not match");
  const payload = Buffer.from(canonicalProductionEvidencePayload(manifest));
  return {
    ...manifest,
    signature_algorithm: PRODUCTION_EVIDENCE_SIGNATURE_ALGORITHM,
    manifest_signer_key_id: signerKeyId,
    manifest_signer_public_key_spki: signerPublicKeySpki,
    manifest_signature_base64url: sign(null, payload, privateKey).toString("base64url"),
  };
}

export function assertSignedProductionEvidenceManifest(
  manifest,
  {
    expectedSignerKeyId,
    expectedSignerPublicKeySpki,
    expectedWorkflowContext,
    expectedDeploymentIdentity,
    expectedSecurityIdentity,
    expectedResultIdentity,
    now = new Date(),
    maxAgeSeconds = DEFAULT_MAX_PRODUCTION_EVIDENCE_AGE_SECONDS,
  } = {},
) {
  assertProductionEvidenceManifest(manifest);
  assertProductionEvidenceFreshness(manifest, { now, maxAgeSeconds });
  if (manifest.scope !== PRODUCTION_EVIDENCE_SCOPE) throw new Error("production evidence scope mismatch");
  if (manifest.signature_algorithm !== PRODUCTION_EVIDENCE_SIGNATURE_ALGORITHM) {
    throw new Error("production evidence signature algorithm is invalid");
  }
  if (!KEY_ID_PATTERN.test(manifest.manifest_signer_key_id ?? "")) {
    throw new Error("production evidence signer key ID is invalid");
  }
  if (manifest.manifest_signer_key_id !== expectedSignerKeyId) {
    throw new Error("production evidence signer key ID mismatch");
  }
  if (manifest.manifest_signer_public_key_spki !== expectedSignerPublicKeySpki) {
    throw new Error("production evidence signer public key mismatch");
  }
  const publicKey = publicKeyFromSpki(expectedSignerPublicKeySpki, "production evidence signer public key");
  const signature = decodeBase64Url(manifest.manifest_signature_base64url, "production evidence signature", 64);
  if (!verify(null, Buffer.from(canonicalProductionEvidencePayload(manifest)), publicKey, signature)) {
    throw new Error("production evidence manifest signature is invalid");
  }
  if (expectedWorkflowContext) assertObjectIdentity(manifest.workflow_context, expectedWorkflowContext, "workflow context");
  if (expectedDeploymentIdentity) assertObjectIdentity(manifest.deployment_identity, expectedDeploymentIdentity, "deployment identity");
  if (expectedSecurityIdentity) assertObjectIdentity(manifest.security_identity, expectedSecurityIdentity, "security identity");
  if (expectedResultIdentity) assertObjectIdentity(manifest.result_identity, expectedResultIdentity, "result identity");
  return manifest;
}

export function assertObjectIdentity(actual, expected, label) {
  for (const [field, value] of Object.entries(expected)) {
    if (actual?.[field] !== value) throw new Error(`${label} mismatch: ${field}`);
  }
}

export function assertProductionEvidenceArtifacts(manifest, artifacts) {
  for (const [name, expected] of Object.entries(manifest.artifacts ?? {})) {
    const bytes = artifacts?.[name];
    if (!bytes) throw new Error(`production evidence artifact is missing: ${name}`);
    const actualHash = sha256Base64Url(bytes);
    if (actualHash !== expected.artifact_sha256) throw new Error(`production evidence artifact hash mismatch: ${name}`);
    if (expected.provenance !== "production") throw new Error(`production evidence artifact provenance is not production: ${name}`);
  }
}

function pushU16(chunks, value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  chunks.push(bytes);
}

function pushU32(chunks, value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  chunks.push(bytes);
}

function pushU64(chunks, value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  chunks.push(bytes);
}

function pushLengthPrefixed(chunks, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  pushU16(chunks, bytes.length);
  chunks.push(bytes);
}

function decodeResultValue(value, label) {
  return decodeBase64Url(value, label);
}

function pushRanges(chunks, ranges) {
  if (!Array.isArray(ranges)) throw new Error("result ranges are invalid");
  pushU32(chunks, ranges.length);
  for (const range of ranges) {
    pushU64(chunks, range.start);
    pushU64(chunks, range.length);
    const bytes = decodeResultValue(range.bytes, "result range bytes");
    pushU64(chunks, bytes.length);
    chunks.push(bytes);
  }
}

export function resultSigningBytes(result) {
  const chunks = [Buffer.from("FUSOU-VERIFIER-RESULT-V1\0")];
  pushU16(chunks, result.version);
  pushLengthPrefixed(chunks, result.profile_id);
  pushLengthPrefixed(chunks, decodeResultValue(result.profile_sha256, "result profile_sha256"));
  pushLengthPrefixed(chunks, result.issuer);
  pushLengthPrefixed(chunks, result.proof_purpose);
  pushLengthPrefixed(chunks, result.canonical_user_id);
  pushLengthPrefixed(chunks, result.device_id);
  pushLengthPrefixed(chunks, decodeResultValue(result.device_challenge, "result device_challenge"));
  pushLengthPrefixed(chunks, result.verified_member_id);
  pushLengthPrefixed(chunks, Buffer.from(result.attestation_session_id.replaceAll("-", ""), "hex"));
  pushLengthPrefixed(chunks, decodeResultValue(result.binding_nonce, "result binding_nonce"));
  pushLengthPrefixed(chunks, result.binding_value);
  pushLengthPrefixed(chunks, result.verifier_key_id);
  pushLengthPrefixed(chunks, result.notary_key_id);
  pushLengthPrefixed(chunks, decodeResultValue(result.tlsn_attestation_id, "result tlsn_attestation_id"));
  pushLengthPrefixed(chunks, result.server_identity);
  pushU64(chunks, result.request_transcript_size);
  pushLengthPrefixed(chunks, decodeResultValue(result.request_transcript_sha256, "result request hash"));
  pushRanges(chunks, result.revealed_request_ranges);
  pushU64(chunks, result.response_transcript_size);
  pushLengthPrefixed(chunks, decodeResultValue(result.response_transcript_sha256, "result response hash"));
  pushRanges(chunks, result.revealed_response_ranges);
  return Buffer.concat(chunks);
}

export function assertSignedResult(result, {
  publicKeySpki,
  keyRegistry,
  signerKeyId,
  now = new Date(),
} = {}) {
  if (!result || result.version !== 1 || typeof result.signature !== "string") {
    throw new Error("production verifier result schema is invalid");
  }
  const publicKey = publicKeyFromSpki(publicKeySpki, "production result public key");
  assertSigningKeyRegistry(keyRegistry, {
    currentKeyId: signerKeyId,
    currentPublicKeySpki: publicKeySpki,
    now,
  });
  if (result.verifier_key_id === "" || result.notary_key_id === "") throw new Error("production result key identity is missing");
  const signature = decodeBase64Url(result.signature, "production result signature", 64);
  if (!verify(null, resultSigningBytes(result), publicKey, signature)) {
    throw new Error("production verifier result signature is invalid");
  }
  return {
    result_sha256: sha256Base64Url(JSON.stringify(result)),
    result_signature_valid: true,
    result_signer_key_id: signerKeyId,
  };
}

export function assertResultSubjectIdentity(result, subjectIdentity) {
  const expected = [
    ["canonical_user_id", "canonical_user_id_sha256"],
    ["device_id", "device_id_sha256"],
    ["attestation_session_id", "attestation_session_id_sha256"],
    ["verified_member_id", "verified_member_id_sha256"],
    ["binding_value", "binding_value_sha256"],
  ];
  for (const [resultField, identityField] of expected) {
    if (typeof result?.[resultField] !== "string" || typeof subjectIdentity?.[identityField] !== "string") {
      throw new Error(`production subject identity is missing ${identityField}`);
    }
    if (sha256Base64Url(result[resultField]) !== subjectIdentity[identityField]) {
      throw new Error(`production subject identity mismatch: ${resultField}`);
    }
  }
  return subjectIdentity;
}

export function assertNoSyntheticEvidence(manifest) {
  if (manifest.capture_provenance === "synthetic") throw new Error("synthetic capture cannot be production evidence");
  for (const [name, artifact] of Object.entries(manifest.artifacts ?? {})) {
    if (artifact?.provenance !== "production") throw new Error(`synthetic artifact cannot be production evidence: ${name}`);
  }
  return manifest;
}

export function artifactDescriptor(bytes, { provenance = "production", mediaType = "application/octet-stream" } = {}) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error("artifact bytes are required");
  return {
    artifact_sha256: sha256Base64Url(bytes),
    provenance,
    media_type: mediaType,
    byte_length: bytes.byteLength,
  };
}

export function productionEvidenceSignerPublicKeyFromPrivateKey(encoded) {
  return publicKeySpki(createPublicKey(privateKeyFromPkcs8(encoded, "production evidence signing private key")), "production evidence signer");
}

export function productionEvidenceManifestHash(manifest) {
  return createHash("sha256").update(canonicalProductionEvidencePayload(manifest)).digest("base64url");
}
