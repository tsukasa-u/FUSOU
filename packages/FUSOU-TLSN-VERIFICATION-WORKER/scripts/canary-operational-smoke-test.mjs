#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANARY_OPERATIONAL_SMOKE_COMPONENTS,
  assertCanaryOperationalSmokeArtifact,
  createCanaryOperationalSmokeArtifact,
  createCanaryOperationalSmokeNotRun,
  loadCanaryOperationalSmokeArtifact,
  operationalSmokeEvidenceSha256,
} from "./canary-operational-smoke.mjs";

const capturedAt = "2026-09-30T12:00:00.000Z";
const signerKeyId = "test-runtime-attestation";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const runtimeAttestationKeyRegistry = {
  schema_version: 1,
  scope: "tlsn-canary-runtime-attestation-key-registry",
  keys: [{
    key_id: signerKeyId,
    public_key_spki: publicKeySpki,
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: null,
  }],
};
const trustedRuntimeIdentity = {
  status: "VALID",
  signature_valid: true,
  cross_binding: { attestation_fresh: true },
  git_commit_sha: "a".repeat(40),
  workflow_run_id: "123456",
  workflow_run_attempt: "2",
  deployment_id: "canary-main-2026-09-30",
  worker_name: "fusou-tlsn-verification-canary",
  version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5",
  platform_deployment_id: "3b064508-1cdb-453c-826b-bdea36a8b1e5",
  attestation_signer_key_id: signerKeyId,
  verifier_identity: {
    status: "VALID",
    deployment_id: "canary-verifier-2026-09-30",
    worker_name: "fusou-tlsn-verifier-canary",
    version_id: "5b064508-1cdb-453c-826b-bdea36a8b1e5",
    verifier_key_id: "verifier-canary-2026-09-30",
    key_registry_sha256: "A".repeat(43),
    attestation_captured_at: "2026-09-30T11:50:00.000Z",
    attestation_expires_at: "2026-09-30T12:20:00.000Z",
  },
};

const defaultArtifact = createCanaryOperationalSmokeNotRun({ capturedAt });
assert.equal(defaultArtifact.status, "NOT_RUN");
assert.equal(defaultArtifact.readiness, "BLOCKED");
assert.equal(defaultArtifact.evidence.synthetic, true);
for (const component of CANARY_OPERATIONAL_SMOKE_COMPONENTS) {
  assert.equal(defaultArtifact.checks[component].status, "NOT_RUN");
}

const observationBytes = Buffer.from("synthetic test observation bytes");
const evidencePath = "observations/main-worker.json";
const observations = Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, {
  status: "NOT_RUN",
  observed_at: null,
  probe_id: null,
  evidence_artifact: null,
}]));
observations.main_worker = {
  status: "PASS",
  observed_at: "2026-09-30T11:59:00.000Z",
  probe_id: "394dc8cc-d4bc-4b8c-9813-7bc4a04a9603",
  evidence_artifact: evidencePath,
};
const evidenceArtifacts = { [evidencePath]: observationBytes };
const partialArtifact = createCanaryOperationalSmokeArtifact({
  observations,
  trustedRuntimeIdentity,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  evidenceArtifacts,
  capturedAt,
  signingNow: capturedAt,
});
assert.equal(partialArtifact.status, "NOT_RUN");
assert.equal(partialArtifact.readiness, "BLOCKED");
assert.equal(partialArtifact.checks.main_worker.evidence_sha256, operationalSmokeEvidenceSha256(observationBytes));
assert.equal(partialArtifact.evidence.synthetic, false);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations: {
    ...observations,
    main_worker: { ...observations.main_worker, observed_at: "2026-09-30T11:49:00.000Z" },
  },
  trustedRuntimeIdentity,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  evidenceArtifacts,
  capturedAt,
  signingNow: capturedAt,
}), /outside the current attestation window/);
assert.throws(() => assertCanaryOperationalSmokeArtifact(partialArtifact, {
  trustedRuntimeIdentity,
  runtimeAttestationKeyRegistry,
  currentHead: trustedRuntimeIdentity.git_commit_sha,
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  evidenceArtifacts,
  now: new Date(capturedAt),
}), /not a complete PASS/);
assert.throws(() => assertCanaryOperationalSmokeArtifact(partialArtifact, {
  trustedRuntimeIdentity,
  runtimeAttestationKeyRegistry,
  currentHead: trustedRuntimeIdentity.git_commit_sha,
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  evidenceArtifacts: { [evidencePath]: Buffer.from("changed test bytes") },
  now: new Date(capturedAt),
}), /evidence hash mismatch/);
assert.throws(() => assertCanaryOperationalSmokeArtifact(partialArtifact, {
  trustedRuntimeIdentity,
  runtimeAttestationKeyRegistry,
  currentHead: "b".repeat(40),
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  evidenceArtifacts,
  now: new Date(capturedAt),
}), /another HEAD or deployment/);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations,
  trustedRuntimeIdentity,
  signerKeyId: "unbound-smoke-signer",
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  evidenceArtifacts,
  capturedAt,
  signingNow: capturedAt,
}), /must use the Runtime Attestation signer/);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations,
  trustedRuntimeIdentity,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  evidenceArtifacts,
  capturedAt: "2026-09-30T12:21:00.000Z",
  signingNow: capturedAt,
}), /outside the Verifier Runtime Attestation validity window/);

const tempDir = await mkdtemp(join(tmpdir(), "canary-operational-smoke-"));
try {
  const evidenceDir = join(tempDir, "observations");
  await mkdir(evidenceDir);
  await writeFile(join(evidenceDir, "main-worker.json"), observationBytes);
  const artifactPath = join(tempDir, "smoke.json");
  await writeFile(artifactPath, JSON.stringify(partialArtifact));
  const loadedPartial = await loadCanaryOperationalSmokeArtifact({
    artifactPath,
    trustedRuntimeIdentity,
    runtimeAttestationKeyRegistry,
    currentHead: trustedRuntimeIdentity.git_commit_sha,
    expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
    now: new Date(capturedAt),
  });
  assert.equal(loadedPartial.status, "NOT_RUN");
  assert.equal(loadedPartial.readiness, "BLOCKED");
  assert.equal(loadedPartial.components.main_worker, "PASS");

  const tamperedPath = join(tempDir, "smoke.json");
  await writeFile(tamperedPath, JSON.stringify({ ...partialArtifact, status: "FAIL" }));
  await assert.rejects(() => loadCanaryOperationalSmokeArtifact({
    artifactPath: tamperedPath,
    trustedRuntimeIdentity,
    runtimeAttestationKeyRegistry,
    currentHead: trustedRuntimeIdentity.git_commit_sha,
    expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
    now: new Date(capturedAt),
  }), /signature is invalid/);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("[tlsn-canary-operational-smoke] NOT_RUN default, partial-status blocking, evidence digest, and identity binding tests PASS");