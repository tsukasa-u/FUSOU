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
import { assertResultArchiveBytes, encodeResultArchiveSha256, persistAndVerifyResultArchive } from "../src/result_archive.js";
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
const alteredSignedInnerResult = serializeCanaryAuthoritativeResult({
  ...responseValue,
  result: { ...signedResult, verification_id: "different-job" },
});
const alteredConsumeReceipt = serializeCanaryAuthoritativeResult({
  ...responseValue,
  consume_receipt: { ...responseValue.consume_receipt, session_id: "different-session" },
});
const alteredReplayDigest = serializeCanaryAuthoritativeResult({
  ...responseValue,
  device_replay_digest_hex: "cd".repeat(32),
});
const reorderedResponseBytes = new TextEncoder().encode(JSON.stringify(
  Object.fromEntries(Object.entries(responseValue).reverse()),
));
for (const changedBytes of [
  new TextEncoder().encode(` ${response.body}`),
  new TextEncoder().encode(`${response.body}\n`),
  reorderedResponseBytes,
  alteredOuterField.bytes,
  alteredSignedInnerResult.bytes,
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

const changedPresentationBytes = new TextEncoder().encode("Canary Presentation byteS");
assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes: changedPresentationBytes,
  resultBytes: response.bytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity,
  expectedJobId: jobId,
  expectedVerificationAttemptId: attemptId,
  now,
}), /Presentation hash mismatch/);

const archiveObjectKey = `tlsn-verification/${attemptId}/result.json`;
const archiveExpectedHash = await encodeResultArchiveSha256(response.bytes);
await assertResultArchiveBytes(response.bytes, response.bytes, archiveExpectedHash);
const corruptedArchiveBytes = Uint8Array.from(response.bytes, (byte, index) => index === 0 ? byte ^ 1 : byte);
const truncatedArchiveBytes = response.bytes.subarray(1);
await assert.rejects(assertResultArchiveBytes(response.bytes, corruptedArchiveBytes, archiveExpectedHash), /digest mismatch/);
await assert.rejects(
  assertResultArchiveBytes(response.bytes, truncatedArchiveBytes, await encodeResultArchiveSha256(truncatedArchiveBytes)),
  /length mismatch/,
);
await assert.rejects(assertResultArchiveBytes(response.bytes, response.bytes, "A".repeat(43)), /digest mismatch/);

for (const [archivedBytes, expectedHash] of [
  [corruptedArchiveBytes, archiveExpectedHash],
  [truncatedArchiveBytes, await encodeResultArchiveSha256(truncatedArchiveBytes)],
  [response.bytes, "A".repeat(43)],
] as const) {
  let writtenObjectKey: string | undefined;
  let fetchedObjectKey: string | undefined;
  let deletedObjectKey: string | undefined;
  let writtenBytes: Uint8Array | undefined;
  let writtenContentType: string | undefined;
  const fakeBucket = {
    put: async (key: string, bytes: Uint8Array, options: R2PutOptions) => {
      writtenObjectKey = key;
      writtenBytes = bytes.slice();
      writtenContentType = options.httpMetadata?.contentType;
      return key;
    },
    get: async (key: string) => {
      fetchedObjectKey = key;
      return { arrayBuffer: async () => archivedBytes.slice().buffer } as R2ObjectBody;
    },
    delete: async (key: string) => { deletedObjectKey = key; },
  } as unknown as R2Bucket;
  await assert.rejects(
    persistAndVerifyResultArchive(fakeBucket, archiveObjectKey, response.bytes, expectedHash),
    /authoritative Result archive verification failed/,
  );
  assert.equal(writtenObjectKey, archiveObjectKey);
  assert.equal(fetchedObjectKey, archiveObjectKey);
  assert.deepEqual(writtenBytes, response.bytes);
  assert.equal(writtenContentType, "application/json");
  assert.equal(deletedObjectKey, archiveObjectKey);
}

assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes: response.bytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity,
  expectedJobId: "b73fded7-d9af-4f0a-b87b-c626d30d55bd",
  expectedVerificationAttemptId: attemptId,
  now,
}), /job ID mismatch/);
assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes: response.bytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity,
  expectedJobId: jobId,
  expectedVerificationAttemptId: "c73fded7-d9af-4f0a-b87b-c626d30d55bd",
  now,
}), /attempt ID mismatch/);

for (const alteredReceipt of [
  { ...receipt, deployment_id: "other-deployment" },
  { ...receipt, runtime_version_id: "c4b06408-1cdb-453c-826b-bdea36a8b1e5" },
  { ...receipt, verifier_key_id: "other-verifier-key" },
  { ...receipt, signature_base64url: `${receipt.signature_base64url.slice(0, -1)}A` },
]) {
  assert.throws(() => assertCanaryVerifierExecutionReceipt(alteredReceipt, {
    presentationBytes,
    resultBytes: response.bytes,
    verifierIdentityKeyRegistry: registry,
    trustedRuntimeIdentity,
    expectedJobId: jobId,
    expectedVerificationAttemptId: attemptId,
    now,
  }));
}

console.log("[tlsn-canary-result-byte-binding] exact authoritative response bytes and detached receipt contract PASS");