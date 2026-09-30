import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import {
  assertAuthorityKeyRegistry,
  resolveAuthorityKey,
} from "./authority-key-registry.mjs";

export const CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE = "tlsn-canary-verifier-identity-key-registry";
export const CANARY_VERIFIER_EXECUTION_RECEIPT_SCOPE = "tlsn-canary-verifier-execution-receipt";
export const CANARY_VERIFIER_WORKER_NAME = "fusou-tlsn-verifier-canary";

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,512}$/;
const VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RECEIPT_FIELDS = [
  "schema_version",
  "scope",
  "receipt_id",
  "job_id",
  "verification_attempt_id",
  "deployment_id",
  "worker_name",
  "runtime_version_id",
  "verifier_key_id",
  "verifier_public_key_spki_sha256",
  "presentation_sha256",
  "result_sha256",
  "issued_at",
  "signature_algorithm",
  "signature_base64url",
];

function assertString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function assertTimestamp(value, label) {
  assertString(value, label, ISO_TIMESTAMP_PATTERN);
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return Date.parse(value);
}

function bytes(value, label) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  throw new Error(`${label} bytes are required`);
}

function sha256Base64Url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canaryVerifierIdentityKeyRegistrySha256(registry) {
  return sha256Base64Url(Buffer.from(canonicalJson(registry), "utf8"));
}

function normalizedNow(now) {
  const timestamp = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new Error("Verifier identity validation time is invalid");
  return timestamp;
}

function receiptPayload(receipt) {
  return {
    schema_version: receipt.schema_version,
    scope: receipt.scope,
    receipt_id: receipt.receipt_id,
    job_id: receipt.job_id,
    verification_attempt_id: receipt.verification_attempt_id,
    deployment_id: receipt.deployment_id,
    worker_name: receipt.worker_name,
    runtime_version_id: receipt.runtime_version_id,
    verifier_key_id: receipt.verifier_key_id,
    verifier_public_key_spki_sha256: receipt.verifier_public_key_spki_sha256,
    presentation_sha256: receipt.presentation_sha256,
    result_sha256: receipt.result_sha256,
    issued_at: receipt.issued_at,
  };
}

export function canaryVerifierExecutionReceiptSigningBytes(receipt) {
  return Buffer.from(
    `FUSOU-TLSN-CANARY-VERIFIER-EXECUTION-V1\0${JSON.stringify(receiptPayload(receipt))}`,
    "utf8",
  );
}

function assertRegistryDeploymentMetadata(registry, currentIdentity = undefined) {
  const activeKeys = registry.keys.filter((key) => key.status === "ACTIVE");
  if (activeKeys.length !== 1) throw new Error("Verifier identity registry must have exactly one ACTIVE key");
  const activeKey = activeKeys[0];
  assertString(activeKey.deployment_id, `Verifier key ${activeKey.key_id}.deployment_id`, DEPLOYMENT_ID_PATTERN);
  if (activeKey.worker_name !== CANARY_VERIFIER_WORKER_NAME) {
    throw new Error("ACTIVE Verifier key is not associated with the canonical Verifier Worker");
  }

  for (const key of registry.keys) {
    assertString(key.deployment_id, `Verifier key ${key.key_id}.deployment_id`, DEPLOYMENT_ID_PATTERN);
    if (key.worker_name !== CANARY_VERIFIER_WORKER_NAME) {
      throw new Error(`Verifier key ${key.key_id} is not associated with the canonical Verifier Worker`);
    }
    if (key.status === "VERIFY_ONLY" || key.status === "RETIRED") {
      if (key.not_after === null || key.superseded_by !== activeKey.key_id) {
        throw new Error(`Verifier key ${key.key_id} must have an expiry and explicit supersession`);
      }
      if (Date.parse(key.not_before) >= Date.parse(activeKey.not_before)) {
        throw new Error(`Verifier key ${key.key_id} activation must precede its superseding key`);
      }
    }
    if (key.status === "REVOKED" && key.superseded_by !== undefined && key.superseded_by !== null) {
      throw new Error(`Revoked Verifier key ${key.key_id} cannot be represented as a normal supersession`);
    }
  }

  if (currentIdentity && (
    currentIdentity.status !== "VALID" ||
    currentIdentity.verifier_key_id !== activeKey.key_id ||
    currentIdentity.public_key_spki !== activeKey.public_key_spki ||
    currentIdentity.deployment_id !== activeKey.deployment_id ||
    currentIdentity.worker_name !== activeKey.worker_name
  )) {
    throw new Error("attested current Verifier identity does not match the ACTIVE registry association");
  }
  return activeKey;
}

export function assertCanaryVerifierIdentityKeyRegistry(registry, {
  currentIdentity,
  now = new Date(),
} = {}) {
  assertAuthorityKeyRegistry(registry, {
    scope: CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
    now,
    label: "Canary Verifier identity",
  });
  const activeKey = assertRegistryDeploymentMetadata(registry, currentIdentity);
  assertAuthorityKeyRegistry(registry, {
    scope: CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
    currentKeyId: activeKey.key_id,
    currentPublicKeySpki: activeKey.public_key_spki,
    now,
    label: "Canary Verifier identity",
  });
  return registry;
}

function makeUnsignedReceipt({
  receiptId = randomUUID(),
  jobId,
  verificationAttemptId,
  deploymentId,
  workerName = CANARY_VERIFIER_WORKER_NAME,
  runtimeVersionId,
  verifierKeyId,
  verifierPublicKeySpki,
  presentationSha256,
  resultSha256,
  issuedAt = new Date().toISOString(),
}) {
  const receipt = {
    schema_version: 1,
    scope: CANARY_VERIFIER_EXECUTION_RECEIPT_SCOPE,
    receipt_id: assertString(receiptId, "Verifier receipt ID", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    job_id: assertString(jobId, "Verifier receipt job ID", /^[A-Za-z0-9._:-]{1,128}$/),
    verification_attempt_id: assertString(verificationAttemptId, "Verifier receipt attempt ID", /^[A-Za-z0-9._:-]{1,128}$/),
    deployment_id: assertString(deploymentId, "Verifier receipt deployment ID", DEPLOYMENT_ID_PATTERN),
    worker_name: assertString(workerName, "Verifier receipt Worker name", /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/),
    runtime_version_id: assertString(runtimeVersionId, "Verifier receipt runtime version ID", VERSION_ID_PATTERN),
    verifier_key_id: assertString(verifierKeyId, "Verifier receipt key ID", KEY_ID_PATTERN),
    verifier_public_key_spki_sha256: sha256Base64Url(Buffer.from(
      assertString(verifierPublicKeySpki, "Verifier public key SPKI", /^[A-Za-z0-9_-]{59}$/),
      "base64url",
    )),
    presentation_sha256: assertString(presentationSha256, "Verifier receipt Presentation SHA-256", SHA256_BASE64URL_PATTERN),
    result_sha256: assertString(resultSha256, "Verifier receipt Result SHA-256", SHA256_BASE64URL_PATTERN),
    issued_at: issuedAt,
  };
  assertTimestamp(receipt.issued_at, "Verifier receipt issued_at");
  if (receipt.worker_name !== CANARY_VERIFIER_WORKER_NAME) {
    throw new Error("Verifier receipt Worker name is not canonical");
  }
  return receipt;
}

export function createCanaryVerifierExecutionReceipt({
  jobId,
  verificationAttemptId,
  deploymentId,
  workerName,
  runtimeVersionId,
  verifierKeyId,
  verifierPublicKeySpki,
  verifierSigningPrivateKeyPkcs8,
  presentationBytes,
  resultBytes,
  issuedAt,
  receiptId,
}) {
  const presentation = bytes(presentationBytes, "Verifier receipt Presentation");
  const result = bytes(resultBytes, "Verifier receipt Result");
  const privateKey = createPrivateKey({
    key: Buffer.from(assertString(verifierSigningPrivateKeyPkcs8, "Verifier signing private key", /^[A-Za-z0-9_-]+$/), "base64url"),
    format: "der",
    type: "pkcs8",
  });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Verifier signing private key must be Ed25519");
  const publicKeySpki = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64url");
  if (publicKeySpki !== verifierPublicKeySpki) throw new Error("Verifier signing key does not match its published SPKI");
  const receipt = makeUnsignedReceipt({
    receiptId,
    jobId,
    verificationAttemptId,
    deploymentId,
    workerName,
    runtimeVersionId,
    verifierKeyId,
    verifierPublicKeySpki,
    presentationSha256: sha256Base64Url(presentation),
    resultSha256: sha256Base64Url(result),
    issuedAt,
  });
  return {
    ...receipt,
    signature_algorithm: "Ed25519",
    signature_base64url: sign(null, canaryVerifierExecutionReceiptSigningBytes(receipt), privateKey).toString("base64url"),
  };
}

export function assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry,
  trustedRuntimeIdentity,
  expectedJobId,
  expectedVerificationAttemptId,
  now = new Date(),
} = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("Verifier execution receipt is missing");
  if (Object.keys(receipt).sort().join("\0") !== [...RECEIPT_FIELDS].sort().join("\0")) {
    throw new Error("Verifier execution receipt fields are invalid");
  }
  if (receipt.schema_version !== 1 || receipt.scope !== CANARY_VERIFIER_EXECUTION_RECEIPT_SCOPE) {
    throw new Error("Verifier execution receipt scope is invalid");
  }
  if (receipt.signature_algorithm !== "Ed25519" || !SIGNATURE_BASE64URL_PATTERN.test(receipt.signature_base64url ?? "")) {
    throw new Error("Verifier execution receipt signature is malformed");
  }
  const issuedAt = assertTimestamp(receipt.issued_at, "Verifier receipt issued_at");
  const validationTime = normalizedNow(now);
  if (issuedAt > validationTime) throw new Error("Verifier execution receipt is from the future");
  const identity = trustedRuntimeIdentity?.verifier_identity;
  if (
    trustedRuntimeIdentity?.status !== "VALID" ||
    trustedRuntimeIdentity?.signature_valid !== true ||
    trustedRuntimeIdentity?.cross_binding?.attestation_fresh !== true ||
    identity?.status !== "VALID"
  ) {
    throw new Error("a fresh signed Runtime Attestation for the Verifier is required");
  }
  if (identity.key_registry_sha256 !== canaryVerifierIdentityKeyRegistrySha256(verifierIdentityKeyRegistry)) {
    throw new Error("Verifier identity key registry is not bound to the signed Runtime Attestation");
  }
  const attestationCapturedAt = assertTimestamp(identity.attestation_captured_at, "Verifier Runtime Attestation captured_at");
  const attestationExpiresAt = assertTimestamp(identity.attestation_expires_at, "Verifier Runtime Attestation expires_at");
  if (attestationExpiresAt <= validationTime || issuedAt < attestationCapturedAt || issuedAt > attestationExpiresAt) {
    throw new Error("Verifier execution receipt is not covered by a current Runtime Attestation");
  }
  if (
    receipt.deployment_id !== identity.deployment_id ||
    receipt.worker_name !== identity.worker_name ||
    receipt.runtime_version_id !== identity.version_id ||
    receipt.verifier_key_id !== identity.verifier_key_id ||
    receipt.verifier_public_key_spki_sha256 !== identity.public_key_spki_sha256
  ) {
    throw new Error("Verifier execution receipt does not match the attested deployment, runtime, or key identity");
  }
  if (receipt.worker_name !== CANARY_VERIFIER_WORKER_NAME) throw new Error("Verifier execution receipt Worker is unauthorized");
  if (expectedJobId !== undefined && receipt.job_id !== expectedJobId) throw new Error("Verifier execution receipt job ID mismatch");
  if (expectedVerificationAttemptId !== undefined && receipt.verification_attempt_id !== expectedVerificationAttemptId) {
    throw new Error("Verifier execution receipt attempt ID mismatch");
  }
  if (sha256Base64Url(bytes(presentationBytes, "verified Presentation")) !== receipt.presentation_sha256) {
    throw new Error("Verifier execution receipt Presentation hash mismatch");
  }
  if (sha256Base64Url(bytes(resultBytes, "signed Result")) !== receipt.result_sha256) {
    throw new Error("Verifier execution receipt Result hash mismatch");
  }
  assertCanaryVerifierIdentityKeyRegistry(verifierIdentityKeyRegistry, { now });
  const registryKey = verifierIdentityKeyRegistry.keys.find((key) => key.key_id === receipt.verifier_key_id);
  if (!registryKey || registryKey.deployment_id !== receipt.deployment_id || registryKey.worker_name !== receipt.worker_name) {
    throw new Error("Verifier key is not authorized for this deployment association");
  }
  const publicKeySpki = resolveAuthorityKey(verifierIdentityKeyRegistry, {
    scope: CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
    keyId: receipt.verifier_key_id,
    at: receipt.issued_at,
    label: "Canary Verifier identity",
  });
  if (sha256Base64Url(Buffer.from(publicKeySpki, "base64url")) !== receipt.verifier_public_key_spki_sha256) {
    throw new Error("Verifier execution receipt public key fingerprint mismatch");
  }
  const publicKey = createPublicKey({ key: Buffer.from(publicKeySpki, "base64url"), format: "der", type: "spki" });
  if (!verify(null, canaryVerifierExecutionReceiptSigningBytes(receipt), publicKey, Buffer.from(receipt.signature_base64url, "base64url"))) {
    throw new Error("Verifier execution receipt signature is invalid");
  }
  return {
    status: "PASS",
    receipt_id: receipt.receipt_id,
    verifier_key_id: receipt.verifier_key_id,
    deployment_id: receipt.deployment_id,
    worker_name: receipt.worker_name,
    runtime_version_id: receipt.runtime_version_id,
    presentation_sha256: receipt.presentation_sha256,
    result_sha256: receipt.result_sha256,
  };
}