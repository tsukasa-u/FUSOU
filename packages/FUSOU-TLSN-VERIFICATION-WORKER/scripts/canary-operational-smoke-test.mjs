#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANARY_OPERATIONAL_SMOKE_COMPONENTS,
  CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY,
  assertCanaryOperationalSmokeArtifact,
  createCanaryOperationalSmokeArtifact,
  createCanaryOperationalSmokeNotRun,
  loadCanaryOperationalSmokeArtifact,
} from "./canary-operational-smoke.mjs";
import { deploymentManifestIdentity } from "./canary-deployment-manifest.mjs";
import { signCanaryRuntimeAttestation } from "./canary-runtime-attestation-signing.mjs";

const capturedAt = "2026-09-30T12:00:00.000Z";
const readinessInvocationId = "f73fded7-d9af-4f0a-b87b-c626d30d55bd";
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
const deploymentManifestBody = {
  target: {
    server_identity: "game.example.net",
    environment: "production",
    deployment_role: "canary",
    binding_identity: "canary-binding-2026-09-30",
  },
  notary: { owner: "FUSOU", service: "FUSOU-NOTARY", key_id: "notary-2026-09-30" },
  inputs: [{ name: "TLSN_CANDIDATE_PROFILE_SHA256", value_sha256: "A".repeat(43), provenance: "deployment-input" }],
  artifacts: [{ name: "profile", path: "profile.json", sha256: "B".repeat(43) }],
};
const deploymentManifest = {
  ...deploymentManifestBody,
  manifest_id: deploymentManifestIdentity(deploymentManifestBody),
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
  manifest_id: deploymentManifest.manifest_id,
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

const observations = Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, {
  status: "NOT_RUN",
  observed_at: null,
  probe_id: null,
  evidence_artifact: null,
}]));
const partialArtifact = createCanaryOperationalSmokeArtifact({
  observations,
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  capturedAt,
  signingNow: capturedAt,
});
assert.equal(partialArtifact.status, "NOT_RUN");
assert.equal(partialArtifact.readiness, "BLOCKED");
assert.equal(partialArtifact.checks.main_worker.status, "NOT_RUN");
assert.equal(partialArtifact.evidence.source, "semantic-validators-not-implemented");
assert.equal(partialArtifact.evidence.synthetic, true);
assert.equal(partialArtifact.evidence.replay_policy, CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY);
assert.equal(partialArtifact.bound_identity.manifest_id, deploymentManifest.manifest_id);
assert.equal(partialArtifact.readiness_invocation_id, readinessInvocationId);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations: {
    ...observations,
    main_worker: {
      status: "PASS",
      observed_at: "2026-09-30T11:59:00.000Z",
      probe_id: "394dc8cc-d4bc-4b8c-9813-7bc4a04a9603",
      evidence_artifact: "observations/main-worker.json",
    },
  },
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  capturedAt,
  signingNow: capturedAt,
}), /semantic validators are not implemented/);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations: {
    ...observations,
    main_worker: { ...observations.main_worker, probe_id: "394dc8cc-d4bc-4b8c-9813-7bc4a04a9603" },
  },
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  capturedAt,
  signingNow: capturedAt,
}), /non-run status cannot claim live evidence/);
assert.throws(() => assertCanaryOperationalSmokeArtifact(partialArtifact, {
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  runtimeAttestationKeyRegistry,
  currentHead: trustedRuntimeIdentity.git_commit_sha,
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  now: new Date(capturedAt),
}), /not a complete PASS/);
assert.equal(assertCanaryOperationalSmokeArtifact(partialArtifact, {
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  runtimeAttestationKeyRegistry,
  currentHead: trustedRuntimeIdentity.git_commit_sha,
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  allowNonPass: true,
  now: new Date(capturedAt),
}).status, "NOT_RUN");
assert.throws(() => assertCanaryOperationalSmokeArtifact(partialArtifact, {
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId: "a73fded7-d9af-4f0a-b87b-c626d30d55bd",
  runtimeAttestationKeyRegistry,
  currentHead: trustedRuntimeIdentity.git_commit_sha,
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  allowNonPass: true,
  now: new Date(capturedAt),
}), /another readiness invocation/);
assert.throws(() => assertCanaryOperationalSmokeArtifact(partialArtifact, {
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  runtimeAttestationKeyRegistry,
  currentHead: "b".repeat(40),
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  allowNonPass: true,
  now: new Date(capturedAt),
}), /another HEAD or deployment/);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations,
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId: "unbound-smoke-signer",
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  capturedAt,
  signingNow: capturedAt,
}), /must use the Runtime Attestation signer/);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations,
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  capturedAt: "2026-09-30T12:21:00.000Z",
  signingNow: capturedAt,
}), /outside the Verifier Runtime Attestation validity window/);

const { attestation_signer_key_id, signature_algorithm, signature_base64url, ...unsignedPartialArtifact } = partialArtifact;
const forgedPassArtifact = signCanaryRuntimeAttestation({
  ...unsignedPartialArtifact,
  status: "PASS",
  readiness: "OPERATIONAL_SMOKE_VERIFIED",
  evidence: {
    source: "live-service-observations",
    synthetic: false,
    replay_policy: CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY,
  },
  checks: {
    ...partialArtifact.checks,
    main_worker: {
      status: "PASS",
      source: "live-service-observation",
      observed_at: "2026-09-30T11:59:00.000Z",
      probe_id: "394dc8cc-d4bc-4b8c-9813-7bc4a04a9603",
      evidence_artifact: "observations/main-worker.json",
      evidence_sha256: "C".repeat(43),
    },
  },
}, {
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  registry: runtimeAttestationKeyRegistry,
  now: capturedAt,
});
assert.throws(() => assertCanaryOperationalSmokeArtifact(forgedPassArtifact, {
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  runtimeAttestationKeyRegistry,
  currentHead: trustedRuntimeIdentity.git_commit_sha,
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  allowNonPass: true,
  now: new Date(capturedAt),
}), /semantic validators are not implemented/);

const tempDir = await mkdtemp(join(tmpdir(), "canary-operational-smoke-"));
try {
  const artifactPath = join(tempDir, "smoke.json");
  await writeFile(artifactPath, JSON.stringify(partialArtifact));
  const loadedPartial = await loadCanaryOperationalSmokeArtifact({
    artifactPath,
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    runtimeAttestationKeyRegistry,
    currentHead: trustedRuntimeIdentity.git_commit_sha,
    expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
    now: new Date(capturedAt),
  });
  assert.equal(loadedPartial.status, "NOT_RUN");
  assert.equal(loadedPartial.readiness, "BLOCKED");
  assert.equal(loadedPartial.components.main_worker, "NOT_RUN");
  assert.equal(loadedPartial.manifest_id, deploymentManifest.manifest_id);
  assert.equal(loadedPartial.readiness_invocation_id, readinessInvocationId);

  const tamperedPath = join(tempDir, "smoke.json");
  await writeFile(tamperedPath, JSON.stringify({ ...partialArtifact, status: "FAIL" }));
  await assert.rejects(() => loadCanaryOperationalSmokeArtifact({
    artifactPath: tamperedPath,
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    runtimeAttestationKeyRegistry,
    currentHead: trustedRuntimeIdentity.git_commit_sha,
    expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
    now: new Date(capturedAt),
  }), /signature is invalid/);

  const forgedPassPath = join(tempDir, "smoke-pass.json");
  await writeFile(forgedPassPath, JSON.stringify(forgedPassArtifact));
  await assert.rejects(() => loadCanaryOperationalSmokeArtifact({
    artifactPath: forgedPassPath,
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    runtimeAttestationKeyRegistry,
    currentHead: trustedRuntimeIdentity.git_commit_sha,
    expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
    now: new Date(capturedAt),
  }), /semantic validators are not implemented/);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("[tlsn-canary-operational-smoke] manifest, trust digest, invocation binding, blocked defaults, and opaque PASS rejection tests PASS");