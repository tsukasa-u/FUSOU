import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { canaryVerifierExecutionReceiptCapabilityAvailable } from "../src/execution_boundary.js";
import { createCanaryVerifierExecutionReceipt } from "../src/verifier_identity.js";

const mainCanary = { TLSN_ENVIRONMENT: "production", TLSN_DEPLOYMENT_ROLE: "canary" };
assert.equal(canaryVerifierExecutionReceiptCapabilityAvailable(mainCanary, undefined), false);
assert.equal(canaryVerifierExecutionReceiptCapabilityAvailable(mainCanary, async () => undefined), true);
assert.equal(canaryVerifierExecutionReceiptCapabilityAvailable({ TLSN_ENVIRONMENT: "test" }, undefined), true);

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const { privateKey: resultSignerPrivateKey } = generateKeyPairSync("ed25519");
const privateKeyPkcs8 = new Uint8Array(privateKey.export({ format: "der", type: "pkcs8" }));
const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const jobId = "f73fded7-d9af-4f0a-b87b-c626d30d55bd";
const verificationAttemptId = "a73fded7-d9af-4f0a-b87b-c626d30d55bd";
const presentationBytes = new TextEncoder().encode("exact presentation bytes");
const resultBytes = new TextEncoder().encode('{"verified":true}');

const receipt = await createCanaryVerifierExecutionReceipt({
  jobId,
  verificationAttemptId,
  deploymentId: "canary-verifier-deployment",
  runtimeVersionId: "b73fded7-d9af-4f0a-b87b-c626d30d55bd",
  verifierKeyId: "canary-verifier-key",
  verifierPublicKeySpki: publicKeySpki,
  verifierSigningPrivateKeyPkcs8: privateKeyPkcs8,
  presentationBytes,
  resultBytes,
  issuedAt: "2026-09-30T12:00:00.000Z",
});
assert.equal(receipt.job_id, jobId);
assert.equal(receipt.verification_attempt_id, verificationAttemptId);
assert.equal(receipt.presentation_sha256.length, 43);
assert.equal(receipt.result_sha256.length, 43);

await assert.rejects(() => createCanaryVerifierExecutionReceipt({
  jobId,
  verificationAttemptId,
  deploymentId: "canary-verifier-deployment",
  runtimeVersionId: "b73fded7-d9af-4f0a-b87b-c626d30d55bd",
  verifierKeyId: "canary-verifier-key",
  verifierPublicKeySpki: publicKeySpki,
  verifierSigningPrivateKeyPkcs8: new Uint8Array(resultSignerPrivateKey.export({ format: "der", type: "pkcs8" })),
  presentationBytes,
  resultBytes,
  issuedAt: "2026-09-30T12:00:00.000Z",
}), /does not match its published SPKI/);

console.log("[tlsn-canary-execution-boundary] Main capability fail-closed and dedicated Verifier receipt signing separation PASS");