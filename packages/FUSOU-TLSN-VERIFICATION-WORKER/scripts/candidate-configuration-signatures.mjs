import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalJson } from "./deployment-attestation.mjs";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const CANDIDATE_CONFIGURATION_SIGNATURE_CONTRACT = deepFreeze(JSON.parse(readFileSync(
  new URL("./candidate-configuration-provenance-contract-v3.json", import.meta.url),
  "utf8",
)));

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const TRUSTED_PIN_SOURCE = CANDIDATE_CONFIGURATION_SIGNATURE_CONTRACT.trust_root.application_pin_source;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactKeys(value, fields, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function decodeBase64Url(value, label, expectedLength) {
  if (typeof value !== "string" || value.length === 0 || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || (expectedLength !== undefined && bytes.length !== expectedLength)) {
    throw new Error(`${label} has an invalid encoding or length`);
  }
  return bytes;
}

function requiredTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) throw new Error(`${label} is invalid`);
  return Date.parse(value);
}

function nowMilliseconds(now) {
  const value = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(value)) throw new Error("candidate configuration signature validation time is invalid");
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function publicKeyFromSpki(value, label) {
  const bytes = decodeBase64Url(value, label);
  let key;
  try {
    key = createPublicKey({ key: bytes, format: "der", type: "spki" });
  } catch {
    throw new Error(`${label} is not valid SPKI`);
  }
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${label} is not Ed25519`);
  return key;
}

function signatureBytes(signature, expectedPayloadSha256, label) {
  assertExactKeys(signature, CANDIDATE_CONFIGURATION_SIGNATURE_CONTRACT.nested_fields.signature, `${label}.signature`);
  if (signature.algorithm !== "Ed25519") throw new Error(`${label} signature algorithm is invalid`);
  if (typeof signature.key_id !== "string" || !KEY_ID_PATTERN.test(signature.key_id)) {
    throw new Error(`${label} signature key_id is invalid`);
  }
  if (typeof signature.payload_sha256 !== "string" || !SHA256_PATTERN.test(signature.payload_sha256)) {
    throw new Error(`${label} signature payload_sha256 is invalid`);
  }
  if (signature.payload_sha256 !== expectedPayloadSha256) throw new Error(`${label} signature payload digest mismatch`);
  return decodeBase64Url(signature.value, `${label} signature value`, 64);
}

function verifyEd25519(bytes, signature, key, label) {
  try {
    if (!verify(null, bytes, key, signature)) throw new Error("signature mismatch");
  } catch {
    throw new Error(`${label} Ed25519 signature is invalid`);
  }
}

function inputContract(inputName) {
  const result = CANDIDATE_CONFIGURATION_SIGNATURE_CONTRACT.inputs[inputName];
  if (!result?.signed_fields || !result.signed_payload_scope) throw new Error(`unknown signed evidence type: ${inputName}`);
  return result;
}

export function canonicalCandidateConfigurationSignedPayload(inputName, evidence) {
  const contract = inputContract(inputName);
  assertExactKeys(evidence, contract.required_fields, inputName);
  if (evidence.schema_version !== contract.schema_version || evidence.scope !== contract.scope) {
    throw new Error(`${inputName} schema version or scope is invalid`);
  }
  const signedFields = Object.fromEntries(contract.signed_fields.map((field) => [field, evidence[field]]));
  return Buffer.from(canonicalJson({
    schema_version: contract.signed_payload_schema_version,
    scope: contract.signed_payload_scope,
    canonicalization: CANDIDATE_CONFIGURATION_SIGNATURE_CONTRACT.canonicalization,
    signed_fields: signedFields,
  }), "utf8");
}

function registryPayloadFromBundle(bundle, expectedType, now, issuedAt) {
  const contract = CANDIDATE_CONFIGURATION_SIGNATURE_CONTRACT;
  assertExactKeys(bundle, contract.trust_bundle.required_fields, "authority trust bundle");
  if (bundle.schema_version !== contract.trust_bundle.schema_version || bundle.scope !== contract.trust_bundle.scope) {
    throw new Error("authority trust bundle schema or scope is invalid");
  }
  if (bundle.authority_type !== expectedType) throw new Error("authority trust bundle type mismatch");

  const rootFields = contract.trust_root.required_fields;
  assertExactKeys(bundle.trust_root, rootFields, "authority trust root");
  const root = bundle.trust_root;
  if (root.algorithm !== "Ed25519" || root.status !== "ACTIVE") throw new Error("authority trust root algorithm or status is invalid");
  if (typeof root.authority_id !== "string" || root.authority_id.trim() === "") throw new Error("authority trust root authority_id is invalid");
  if (typeof root.key_id !== "string" || !KEY_ID_PATTERN.test(root.key_id)) throw new Error("authority trust root key_id is invalid");
  const rootFrom = requiredTimestamp(root.not_before, "authority trust root not_before");
  const rootUntil = requiredTimestamp(root.not_after, "authority trust root not_after");
  if (rootFrom >= rootUntil || now < rootFrom || now >= rootUntil) throw new Error("authority trust root is outside its validity interval");
  const authorityContract = Object.values(contract.inputs).find((item) => item.authority_type === expectedType);
  if (!authorityContract || root.scope !== authorityContract.registry_scope) throw new Error("authority trust root scope mismatch");
  const rootKey = publicKeyFromSpki(root.public_key_spki, "authority trust root public key");

  const rawRegistry = decodeBase64Url(bundle.registry_payload_base64url, "authority registry payload");
  if (typeof bundle.registry_sha256 !== "string" || !SHA256_PATTERN.test(bundle.registry_sha256)) {
    throw new Error("authority registry SHA-256 is invalid");
  }
  const registrySha256 = sha256(rawRegistry);
  if (registrySha256 !== bundle.registry_sha256) throw new Error("authority registry hash mismatch");
  const registryText = rawRegistry.toString("utf8");
  if (!Buffer.from(registryText, "utf8").equals(rawRegistry)) throw new Error("authority registry is not valid UTF-8");
  let registryPayload;
  try {
    registryPayload = JSON.parse(registryText);
  } catch {
    throw new Error("authority registry payload is not valid JSON");
  }
  assertExactKeys(registryPayload, ["schema_version", "scope", "canonicalization", "signed_fields"], "authority registry payload");
  if (
    registryPayload.schema_version !== contract.registry_payload.schema_version ||
    registryPayload.scope !== authorityContract.registry_scope ||
    registryPayload.canonicalization !== contract.canonicalization ||
    canonicalJson(registryPayload) !== registryText
  ) throw new Error("authority registry payload is noncanonical or has the wrong scope");
  const registryFields = registryPayload.signed_fields;
  const expectedRegistryFields = contract.registry_payload.signed_fields;
  assertExactKeys(registryFields, expectedRegistryFields, "authority registry signed_fields");
  if (registryFields.authority_type !== expectedType || typeof registryFields.authority_id !== "string" || registryFields.authority_id.trim() === "") {
    throw new Error("authority registry identity is invalid");
  }
  if (typeof registryFields.registry_version !== "string" || registryFields.registry_version.trim() === "") {
    throw new Error("authority registry version is invalid");
  }
  const registryFrom = requiredTimestamp(registryFields.valid_from, "authority registry valid_from");
  const registryUntil = requiredTimestamp(registryFields.valid_until, "authority registry valid_until");
  if (registryFrom >= registryUntil || now < registryFrom || now >= registryUntil) {
    throw new Error("authority registry is outside its validity interval");
  }
  if (issuedAt < registryFrom || issuedAt >= registryUntil) {
    throw new Error("evidence issued_at is outside authority registry validity interval");
  }
  if (!Array.isArray(registryFields.keys) || registryFields.keys.length === 0) throw new Error("authority registry has no keys");

  const registrySignaturePayloadSha256 = sha256(rawRegistry);
  const registrySignature = signatureBytes(bundle.registry_signature, registrySignaturePayloadSha256, "authority registry");
  if (bundle.registry_signature.key_id !== root.key_id) throw new Error("authority registry signer does not match trust root");
  verifyEd25519(rawRegistry, registrySignature, rootKey, "authority registry");

  const seenKeyIds = new Set();
  const seenPublicKeys = new Set();
  let signer = null;
  for (const [index, key] of registryFields.keys.entries()) {
    assertExactKeys(key, contract.registry_payload.key_fields, `authority registry key ${index}`);
    if (
      key.authority_id !== registryFields.authority_id ||
      typeof key.key_id !== "string" || !KEY_ID_PATTERN.test(key.key_id) ||
      seenKeyIds.has(key.key_id)
    ) throw new Error(`authority registry key ${index} identity is invalid or duplicated`);
    seenKeyIds.add(key.key_id);
    if (key.algorithm !== "Ed25519" || !contract.registry_payload.statuses.includes(key.status)) {
      throw new Error(`authority registry key ${key.key_id} algorithm or status is invalid`);
    }
    if (!Array.isArray(key.scopes) || key.scopes.some((scope) => typeof scope !== "string") || new Set(key.scopes).size !== key.scopes.length) {
      throw new Error(`authority registry key ${key.key_id} scopes are invalid`);
    }
    publicKeyFromSpki(key.public_key_spki, `authority registry key ${key.key_id} public key`);
    if (seenPublicKeys.has(key.public_key_spki) || key.public_key_spki === root.public_key_spki) {
      throw new Error("authority registry reuses a public key within or across root and signer roles");
    }
    seenPublicKeys.add(key.public_key_spki);
  }

  return {
    authorityContract,
    registryFields,
    registrySha256,
    root,
    rootKey,
    keys: registryFields.keys,
  };
}

function trustRootMatchesPin(root, pin) {
  if (!pin || typeof pin !== "object" || Array.isArray(pin)) return false;
  const fields = CANDIDATE_CONFIGURATION_SIGNATURE_CONTRACT.trust_root.required_fields;
  return fields.every((field) => root[field] === pin[field]);
}

function signatureTime(evidence, inputName) {
  const field = inputContract(inputName).signature_time_field;
  if (!field) throw new Error(`${inputName} signature time field is not defined`);
  return requiredTimestamp(evidence[field], `${inputName} ${field}`);
}

function validateEvidenceTimeShape(evidence, inputName, issuedAt) {
  const fields = inputContract(inputName).evidence_validity_fields;
  if (!Array.isArray(fields) || fields.length !== 2) throw new Error(`${inputName} evidence validity fields are not defined`);
  const validFrom = requiredTimestamp(evidence[fields[0]], `${inputName} ${fields[0]}`);
  const validUntil = requiredTimestamp(evidence[fields[1]], `${inputName} ${fields[1]}`);
  if (validFrom >= validUntil) throw new Error(`${inputName} evidence validity interval is invalid`);
  if (issuedAt > validFrom) throw new Error(`${inputName} issued_at is after valid_from`);
}

/**
 * Verifies the signed payload, signer authorization at the issuer-asserted
 * issued_at/current time, and root-pinned authority status. issued_at is not an
 * independently trusted timestamp. Evidence validity and candidate readiness
 * remain the binding assessment's responsibility.
 */
export function verifyCandidateConfigurationEvidenceSignature({
  inputName,
  evidence,
  trustBundle,
  pinnedTrustRoot = null,
  now = new Date(),
} = {}) {
  const nowMs = nowMilliseconds(now);
  const contract = inputContract(inputName);
  const payload = canonicalCandidateConfigurationSignedPayload(inputName, evidence);
  const payloadSha256 = sha256(payload);
  const signature = signatureBytes(evidence.signature, payloadSha256, inputName);
  const issuedAt = signatureTime(evidence, inputName);
  if (issuedAt > nowMs) throw new Error(`${inputName} issued_at is after verification time`);
  validateEvidenceTimeShape(evidence, inputName, issuedAt);
  const signerIdentity = contract.signer_key_id_field.includes(".")
    ? evidence.authority_identity
    : {
      authority_id: evidence.builder_identity,
      key_id: evidence[contract.signer_key_id_field],
    };
  const signerKeyId = signerIdentity?.key_id;
  if (evidence.signature.key_id !== signerKeyId) throw new Error(`${inputName} signature key ID does not match its signed signer identity`);

  const registry = registryPayloadFromBundle(trustBundle, contract.authority_type, nowMs, issuedAt);
  if (registry.authorityContract.signed_payload_scope !== contract.signed_payload_scope) {
    throw new Error(`${inputName} trust registry does not authorize this signed payload scope`);
  }
  if (!signerIdentity || signerIdentity.authority_id !== registry.registryFields.authority_id) {
    throw new Error(`${inputName} authority identity does not match its key registry`);
  }
  const key = registry.keys.find((entry) => entry.key_id === signerKeyId);
  if (!key) throw new Error(`${inputName} signer key is absent from its authority registry`);
  if (key.status === "REVOKED" || key.status === "RETIRED") throw new Error(`${inputName} signer key is revoked or retired`);
  if (key.status !== "ACTIVE" && key.status !== "VERIFY_ONLY") throw new Error(`${inputName} signer key status is not verifiable`);
  if (!key.scopes.includes(contract.signed_payload_scope)) throw new Error(`${inputName} signer key is not authorized for this payload scope`);
  if (typeof evidence.signature.key_id !== "string" || key.key_id !== evidence.signature.key_id) {
    throw new Error(`${inputName} signer key identity mismatch`);
  }
  const keyFrom = requiredTimestamp(key.not_before, `${inputName} signer not_before`);
  const keyUntil = requiredTimestamp(key.not_after, `${inputName} signer not_after`);
  if (keyFrom >= keyUntil) throw new Error(`${inputName} signer key validity interval is invalid`);
  if (issuedAt < keyFrom || issuedAt >= keyUntil) {
    throw new Error(`${inputName} signer key is not valid at evidence issued_at`);
  }
  if (nowMs < keyFrom || nowMs >= keyUntil) throw new Error(`${inputName} signer key is not currently valid`);

  verifyEd25519(payload, signature, publicKeyFromSpki(key.public_key_spki, `${inputName} signer public key`), inputName);
  const authorityTrusted = trustRootMatchesPin(registry.root, pinnedTrustRoot)
    && pinnedTrustRoot.source === TRUSTED_PIN_SOURCE;
  return Object.freeze({
    signature_verified: true,
    registry_signer_authorized: true,
    evidence_issued_at: new Date(issuedAt).toISOString(),
    evidence_issued_at_basis: "SIGNED_ISSUER_ASSERTION_NOT_INDEPENDENT_TIMESTAMP",
    signature_algorithm: "Ed25519",
    signer_key_id: key.key_id,
    signer_public_key_sha256: sha256(Buffer.from(key.public_key_spki, "base64url")),
    signed_payload_sha256: payloadSha256,
    registry_sha256: registry.registrySha256,
    registry_fingerprint: registry.registrySha256,
    trust_root_key_id: registry.root.key_id,
    trust_root_sha256: sha256(Buffer.from(registry.root.public_key_spki, "base64url")),
    trust_root_pinned: trustRootMatchesPin(registry.root, pinnedTrustRoot),
    authority_trusted: authorityTrusted,
    evidence_current_validity: CANDIDATE_CONFIGURATION_SIGNATURE_CONTRACT.time_semantics.low_level_signature_verifier_current_evidence_validity,
    candidate_readiness: CANDIDATE_CONFIGURATION_SIGNATURE_CONTRACT.time_semantics.low_level_signature_verifier_candidate_readiness,
    trust_source: authorityTrusted ? pinnedTrustRoot.source : "UNPINNED_OR_TEST_FIXTURE",
    authority_type: contract.authority_type,
    signed_payload_scope: contract.signed_payload_scope,
  });
}