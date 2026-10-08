#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertCanaryVerifierExecutionEvidence,
  CANARY_EXECUTION_EVIDENCE_BUNDLE_SCOPE,
  CANARY_EXECUTION_EVIDENCE_SCOPE,
  loadCanaryVerifierExecutionEvidenceBundle,
} from "./canary-execution-evidence.mjs";
import {
  canaryVerifierIdentityKeyRegistrySha256,
  CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
  CANARY_VERIFIER_WORKER_NAME,
  createCanaryVerifierExecutionReceipt,
} from "./canary-verifier-identity.mjs";

const now = "2026-09-30T12:00:00.000Z";
const capturedAt = "2026-09-30T11:50:00.000Z";
const expiresAt = "2026-09-30T12:20:00.000Z";
const deploymentId = "canary-verifier-deployment-2026-09-30";
const runtimeVersionId = "4b064508-1cdb-453c-826b-bdea36a8b1e5";
const jobId = "f73fded7-d9af-4f0a-b87b-c626d30d55bd";
const attemptId = "5f289198-7361-4a92-9d03-c4e506385130";
const presentationBytes = Buffer.from("independent Canary Presentation bytes");
const verifierKeyId = "verifier-canary-2026-09-30";
const resultEnvelope = (keyId) => Buffer.from(JSON.stringify({
  verified: true,
  result: { verifier_key_id: keyId },
  signer_key_id: "result-signing-key",
  signature_algorithm: "Ed25519",
}));
const resultBytes = resultEnvelope(verifierKeyId);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const verifierIdentityKeyRegistry = {
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
  git_commit_sha: "a".repeat(40),
  workflow_run_id: "123456",
  workflow_run_attempt: "2",
  deployment_id: "canary-main-deployment-2026-09-30",
  worker_name: "fusou-tlsn-verification-canary",
  version_id: "6b064508-1cdb-453c-826b-bdea36a8b1e5",
  platform_deployment_id: "7b064508-1cdb-453c-826b-bdea36a8b1e5",
  verifier_identity: {
    status: "VALID",
    deployment_id: deploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
    version_id: runtimeVersionId,
    verifier_key_id: verifierKeyId,
    public_key_spki_sha256: createHash("sha256").update(Buffer.from(publicKeySpki, "base64url")).digest("base64url"),
    key_registry_sha256: canaryVerifierIdentityKeyRegistrySha256(verifierIdentityKeyRegistry),
    attestation_captured_at: capturedAt,
    attestation_expires_at: expiresAt,
  },
};
const receipt = createCanaryVerifierExecutionReceipt({
  jobId,
  verificationAttemptId: attemptId,
  deploymentId,
  workerName: CANARY_VERIFIER_WORKER_NAME,
  runtimeVersionId,
  verifierKeyId,
  verifierPublicKeySpki: publicKeySpki,
  verifierSigningPrivateKeyPkcs8: privateKeyPkcs8,
  presentationBytes,
  resultBytes,
  issuedAt: "2026-09-30T11:55:00.000Z",
  receiptId: "394dc8cc-d4bc-4b8c-9813-7bc4a04a9603",
});
const receiptBytes = Buffer.from(JSON.stringify(receipt));
const verifyEvidence = (overrides = {}) => assertCanaryVerifierExecutionEvidence({
  receiptBytes,
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry,
  trustedRuntimeIdentity,
  expectedJobId: jobId,
  expectedVerificationAttemptId: attemptId,
  now,
  ...overrides,
});

const evidence = verifyEvidence();
assert.equal(evidence.scope, CANARY_EXECUTION_EVIDENCE_SCOPE);
assert.equal(evidence.status, "PASS");
assert.equal(evidence.evidence.synthetic, false);
assert.equal(evidence.execution.job_id, jobId);
assert.equal(evidence.execution.verification_attempt_id, attemptId);
assert.equal(evidence.execution.verifier_key_id, verifierKeyId);
assert.equal(evidence.trust_graph.nodes.find((node) => node.id === "verifier_execution").authority, "canary-verifier-identity-key");
assert.equal(evidence.trust_graph.edges.length, 5);

assert.throws(() => verifyEvidence({ presentationBytes: Buffer.from("different presentation") }), /Presentation hash mismatch/);
assert.throws(() => verifyEvidence({ resultBytes: Buffer.from("different result") }), /Result hash mismatch/);
assert.throws(() => verifyEvidence({ resultBytes: resultEnvelope("another-key") }), /Result hash mismatch/);
const malformedResultBytes = Buffer.from(JSON.stringify({ verifier_key_id: verifierKeyId }));
const malformedResultReceipt = createCanaryVerifierExecutionReceipt({
  jobId,
  verificationAttemptId: attemptId,
  deploymentId,
  workerName: CANARY_VERIFIER_WORKER_NAME,
  runtimeVersionId,
  verifierKeyId,
  verifierPublicKeySpki: publicKeySpki,
  verifierSigningPrivateKeyPkcs8: privateKeyPkcs8,
  presentationBytes,
  resultBytes: malformedResultBytes,
  issuedAt: "2026-09-30T11:55:00.000Z",
  receiptId: "594dc8cc-d4bc-4bc8-9813-7bc4a04a9603",
});
assert.throws(() => verifyEvidence({
  resultBytes: malformedResultBytes,
  receiptBytes: Buffer.from(JSON.stringify(malformedResultReceipt)),
}), /verified Result envelope/);
const mismatchedClaimReceipt = createCanaryVerifierExecutionReceipt({
  jobId,
  verificationAttemptId: attemptId,
  deploymentId,
  workerName: CANARY_VERIFIER_WORKER_NAME,
  runtimeVersionId,
  verifierKeyId,
  verifierPublicKeySpki: publicKeySpki,
  verifierSigningPrivateKeyPkcs8: privateKeyPkcs8,
  presentationBytes,
  resultBytes: resultEnvelope("another-key"),
  issuedAt: "2026-09-30T11:55:00.000Z",
  receiptId: "494dc8cc-d4bc-4bc8-9813-7bc4a04a9603",
});
assert.throws(() => verifyEvidence({
  resultBytes: resultEnvelope("another-key"),
  receiptBytes: Buffer.from(JSON.stringify(mismatchedClaimReceipt)),
}), /Result verifier_key_id claim does not match the attested execution identity/);
assert.throws(() => verifyEvidence({ expectedJobId: "b73fded7-d9af-4f0a-b87b-c626d30d55bd" }), /job ID mismatch/);
assert.throws(() => verifyEvidence({ expectedVerificationAttemptId: "6f289198-7361-4a92-9d03-c4e506385130" }), /attempt ID mismatch/);
assert.throws(() => verifyEvidence({ expectedJobId: undefined }), /authoritative UUID/);
assert.throws(() => verifyEvidence({ now: "2026-09-30T12:21:00.000Z" }), /not covered by a current Runtime Attestation/);
assert.throws(() => verifyEvidence({
  trustedRuntimeIdentity: {
    ...trustedRuntimeIdentity,
    verifier_identity: { ...trustedRuntimeIdentity.verifier_identity, deployment_id: "another-verifier-deployment" },
  },
}), /does not match the attested deployment/);
assert.throws(() => verifyEvidence({
  verifierIdentityKeyRegistry: {
    ...verifierIdentityKeyRegistry,
    keys: [{
      ...verifierIdentityKeyRegistry.keys[0],
      public_key_spki: publicKeySpki.slice(0, -1) + (publicKeySpki.at(-1) === "A" ? "B" : "A"),
    }],
  },
}), /not bound to the signed Runtime Attestation/);
assert.throws(() => verifyEvidence({ receiptBytes: Buffer.from(`${receiptBytes.toString("utf8")} `) }), /not canonically serialized/);
assert.throws(() => verifyEvidence({ receiptBytes: Buffer.from(JSON.stringify({
  ...receipt,
  signature_base64url: (receipt.signature_base64url[0] === "A" ? "B" : "A") + receipt.signature_base64url.slice(1),
})) }), /signature is invalid/);

const bundleRoot = await mkdtemp(join(tmpdir(), "canary-execution-evidence-"));
const outsideRoot = await mkdtemp(join(tmpdir(), "canary-execution-evidence-outside-"));
try {
  const artifactDirectory = join(bundleRoot, "artifacts");
  await mkdir(artifactDirectory);
  await writeFile(join(artifactDirectory, "presentation.bin"), presentationBytes);
  await writeFile(join(artifactDirectory, "result.json"), resultBytes);
  await writeFile(join(artifactDirectory, "receipt.json"), receiptBytes);
  const manifestPath = join(bundleRoot, "bundle.json");
  const manifest = {
    schema_version: 1,
    scope: CANARY_EXECUTION_EVIDENCE_BUNDLE_SCOPE,
    main_deployment_id: trustedRuntimeIdentity.deployment_id,
    main_worker_name: trustedRuntimeIdentity.worker_name,
    main_version_id: trustedRuntimeIdentity.version_id,
    main_platform_deployment_id: trustedRuntimeIdentity.platform_deployment_id,
    git_commit_sha: trustedRuntimeIdentity.git_commit_sha,
    workflow_run_id: trustedRuntimeIdentity.workflow_run_id,
    workflow_run_attempt: trustedRuntimeIdentity.workflow_run_attempt,
    job_id: jobId,
    verification_attempt_id: attemptId,
    artifacts: {
      presentation: "artifacts/presentation.bin",
      result: "artifacts/result.json",
      verifier_execution_receipt: "artifacts/receipt.json",
    },
  };
  const loadBundle = (overrides = {}) => loadCanaryVerifierExecutionEvidenceBundle({
    bundlePath: manifestPath,
    verifierIdentityKeyRegistry,
    trustedRuntimeIdentity,
    expectedJobId: jobId,
    expectedVerificationAttemptId: attemptId,
    now,
    ...overrides,
  });
  await writeFile(manifestPath, JSON.stringify(manifest));
  const loadedBundle = await loadBundle();
  assert.equal(loadedBundle.status, "PASS");
  assert.equal(loadedBundle.bundle.presentation_path, manifest.artifacts.presentation);

  await assert.rejects(() => loadBundle({ expectedJobId: "b73fded7-d9af-4f0a-b87b-c626d30d55bd" }), /does not match the expected job or attempt/);
  await writeFile(manifestPath, JSON.stringify({
    ...manifest,
    artifacts: { ...manifest.artifacts, presentation: "../outside.bin" },
  }));
  await assert.rejects(() => loadBundle(), /must be a safe relative path/);

  await writeFile(join(outsideRoot, "outside.bin"), "outside bundle");
  await symlink(join(outsideRoot, "outside.bin"), join(artifactDirectory, "escaped.bin"));
  await writeFile(manifestPath, JSON.stringify({
    ...manifest,
    artifacts: { ...manifest.artifacts, presentation: "artifacts/escaped.bin" },
  }));
  await assert.rejects(() => loadBundle(), /resolves outside the evidence bundle/);
} finally {
  await rm(bundleRoot, { recursive: true, force: true });
  await rm(outsideRoot, { recursive: true, force: true });
}

console.log("[tlsn-canary-execution-evidence] exact-byte receipt binding, runtime identity, replay context, and trust graph tests PASS");