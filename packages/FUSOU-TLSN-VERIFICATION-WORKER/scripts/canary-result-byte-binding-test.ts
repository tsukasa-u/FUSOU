import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  assertCanaryVerifierExecutionReceipt,
  canaryVerifierIdentityKeyRegistrySha256,
  CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
  CANARY_VERIFIER_WORKER_NAME,
} from "./canary-verifier-identity.mjs";
import {
  createCanaryVerifierExecutionReceipt,
  serializeCanaryAuthoritativeResult,
} from "../src/verifier_identity.js";
import { verificationFinalResponseSchema } from "../src/verification_jobs.js";

const jobId = "f73fded7-d9af-4f0a-b87b-c626d30d55bd";
const attemptId = "5f289198-7361-4a92-9d03-c4e506385130";
const deploymentId = "canary-verifier-deployment-2026-09-30";
const runtimeVersionId = "4b064508-1cdb-453c-826b-bdea36a8b1e5";
const verifierKeyId = "verifier-canary-2026-09-30";
const capturedAt = "2026-09-30T11:50:00.000Z";
const expiresAt = "2026-09-30T12:20:00.000Z";
const issuedAt = "2026-09-30T11:55:00.000Z";
const now = "2026-09-30T12:00:00.000Z";
const presentationBytes = new TextEncoder().encode("Canary Presentation bytes");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPkcs8 = new Uint8Array(privateKey.export({ format: "der", type: "pkcs8" }));
const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const publicKeyBytes = Buffer.from(publicKeySpki, "base64url");
const registry = {
  schema_version: 1,
  scope: CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
  keys: [{
    key_id: verifierKeyId,
    public_key_spki: publicKeySpki,
    status: "ACTIVE",
    not_before: "2026-09-30T11:00:00.000Z",
    not_after: "2026-09-30T13:00:00.000Z",
    deployment_id: deploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
  }],
};
const trustedRuntimeIdentity = {
  status: "VALID",
  signature_valid: true,
  cross_binding: { attestation_fresh: true },
  verifier_identity: {
    status: "VALID",
    deployment_id: deploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
    version_id: runtimeVersionId,
    verifier_key_id: verifierKeyId,
    public_key_spki_sha256: createHash("sha256").update(publicKeyBytes).digest("base64url"),
    key_registry_sha256: canaryVerifierIdentityKeyRegistrySha256(registry),
    attestation_captured_at: capturedAt,
    attestation_expires_at: expiresAt,
  },
};
const signedResult = {
  schema_version: 1,
  scope: "fusou-verifier-result",
  verification_id: jobId,
  signature_algorithm: "Ed25519",
  signature_base64url: "R".repeat(86),
};
const response = serializeCanaryAuthoritativeResult({
  verified: true,
  result: signedResult,
  signer_key_id: "canary-result-signer",
  signature_algorithm: "Ed25519",
  consume_receipt: {
    schema_version: 1,
    type: "attestation-consume-receipt",
    session_id: "session-2026-09-30",
    signature_base64url: "C".repeat(86),
  },
  device_replay_digest_hex: "ab".repeat(32),
});
const resultHash = createHash("sha256").update(response.bytes).digest("base64url");
const receipt = await createCanaryVerifierExecutionReceipt({
  jobId,
  verificationAttemptId: attemptId,
  deploymentId,
  runtimeVersionId,
  verifierKeyId,
  verifierPublicKeySpki: publicKeySpki,
  verifierSigningPrivateKeyPkcs8: privateKeyPkcs8,
  presentationBytes,
  resultBytes: response.bytes,
  issuedAt,
});

assert.equal(receipt.result_sha256, resultHash);
assert.equal(response.body, new TextDecoder().decode(response.bytes));
assert.equal(response.body.includes("verifier_execution_receipt"), false);
assert.throws(() => verificationFinalResponseSchema.parse({
  ...JSON.parse(response.body),
  verifier_execution_receipt: receipt,
}), /verifier_execution_receipt/);
assert.equal(assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes: response.bytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity,
  expectedJobId: jobId,
  expectedVerificationAttemptId: attemptId,
  now,
}).status, "PASS");

const responseValue = JSON.parse(response.body);
const alteredOuterField = serializeCanaryAuthoritativeResult({
  ...responseValue,
  signer_key_id: "different-result-signer",
});
const alteredConsumeReceipt = serializeCanaryAuthoritativeResult({
  ...responseValue,
  consume_receipt: { ...responseValue.consume_receipt, session_id: "different-session" },
});
const alteredReplayDigest = serializeCanaryAuthoritativeResult({
  ...responseValue,
  device_replay_digest_hex: "cd".repeat(32),
});
for (const changedBytes of [
  new TextEncoder().encode(`${response.body}\n`),
  alteredOuterField.bytes,
  alteredConsumeReceipt.bytes,
  alteredReplayDigest.bytes,
  new TextEncoder().encode(JSON.stringify(signedResult)),
]) {
  assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
    presentationBytes,
    resultBytes: changedBytes,
    verifierIdentityKeyRegistry: registry,
    trustedRuntimeIdentity,
    expectedJobId: jobId,
    expectedVerificationAttemptId: attemptId,
    now,
  }), /Result hash mismatch/);
}

console.log("[tlsn-canary-result-byte-binding] exact authoritative response bytes and detached receipt contract PASS");