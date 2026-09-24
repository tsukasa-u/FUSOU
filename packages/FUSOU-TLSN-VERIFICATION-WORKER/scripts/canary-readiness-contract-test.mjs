#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildReadinessReport } from "./canary-readiness-test.mjs";
import { CANARY_TLSN_ARCHITECTURE } from "./canary-external-input-intake.mjs";
import { signCanaryRuntimeAttestation } from "./canary-runtime-attestation-signing.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const readinessPath = resolve(packageDirectory, "scripts/canary-readiness-test.mjs");
const result = spawnSync(process.execPath, [readinessPath], {
  cwd: packageDirectory,
  encoding: "utf8",
  env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
  },
});

assert.equal(result.status, 0, result.stderr);
const report = JSON.parse(result.stdout);
assert.equal(report.network_access, "NOT_USED");
assert.equal(report.deployment_executed, false);
assert.equal(report.status, "BLOCKED");
assert.equal(report.inputs.runtime_attestation.status, "MISSING");
assert.equal(report.gates.runtime_attestation, false);
assert.equal(report.inputs.remote_validation.status, "POST_DEPLOYMENT_ONLY");
assert.ok(Object.values(report.inputs.remote_validation.fields).every((status) => status.endsWith("POST_DEPLOYMENT")));
assert.ok(!report.missing_inputs.some((name) => name.startsWith("TLSN_REMOTE_")));
assert.ok(report.input_diagnostics
  .filter((entry) => entry.phase === "REMOTE_VALIDATION_ONLY")
  .every((entry) => entry.status.endsWith("POST_DEPLOYMENT")));
assert.equal(CANARY_TLSN_ARCHITECTURE.live_verifier.status, "NOT_IMPLEMENTED");
assert.equal(CANARY_TLSN_ARCHITECTURE.delegated_notary.current_presentation_path, "REQUIRED");

const expectedHead = "a".repeat(40);
const matchingWorkflow = {
  workflow_run_id: "100",
  workflow_run_attempt: "1",
  repository: "example/FUSOU",
  workflow_file_identity: "dotenvx+pnpm+wrangler",
};
const matchingEnvironment = {
  TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID: "test-readiness-runtime-attestation",
  TLSN_CANARY_DEPLOYMENT_ID: "canary-contract-test",
  TLSN_CANARY_WORKER_NAME: "fusou-tlsn-verification-canary",
  TLSN_WORKFLOW_RUN_ID: matchingWorkflow.workflow_run_id,
  TLSN_WORKFLOW_RUN_ATTEMPT: matchingWorkflow.workflow_run_attempt,
  TLSN_REPOSITORY: matchingWorkflow.repository,
  TLSN_WORKFLOW_FILE_IDENTITY: matchingWorkflow.workflow_file_identity,
  TLSN_GIT_COMMIT_SHA: expectedHead,
};
const { privateKey: runtimeAttestationPrivateKey, publicKey: runtimeAttestationPublicKey } = generateKeyPairSync("ed25519");
const runtimeAttestationPrivateKeyPkcs8 = runtimeAttestationPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const runtimeAttestationPublicKeySpki = runtimeAttestationPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const runtimeAttestationKeyRegistry = {
  schema_version: 1,
  scope: "tlsn-canary-runtime-attestation-key-registry",
  keys: [{
    key_id: matchingEnvironment.TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID,
    public_key_spki: runtimeAttestationPublicKeySpki,
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: null,
  }],
};
const matchingManifest = {
  manifest_id: "B".repeat(43),
  issued_at: "2026-09-01T00:00:00.000Z",
  expires_at: "2026-10-01T00:00:00.000Z",
  target: { deployment_role: "canary" },
  workflow: {
    repository: matchingWorkflow.repository,
    run_id: matchingWorkflow.workflow_run_id,
    run_attempt: matchingWorkflow.workflow_run_attempt,
    workflow_file_identity: matchingWorkflow.workflow_file_identity,
    commit_sha: expectedHead,
  },
  deployment: {
    deployment_id: matchingEnvironment.TLSN_CANARY_DEPLOYMENT_ID,
    worker_name: matchingEnvironment.TLSN_CANARY_WORKER_NAME,
  },
};
const unsignedRuntimeAttestation = {
  schema_version: 1,
  scope: "tlsn-canary-deployment-runtime-attestation",
  status: "PASS",
  readiness: "READY_FOR_HUMAN_GAMEPLAY",
  evidence: {
    source: "cloudflare-platform-and-live-health",
    synthetic: false,
  },
  repository: {
    git_commit_sha: expectedHead,
    workflow_run_id: matchingWorkflow.workflow_run_id,
    workflow_run_attempt: matchingWorkflow.workflow_run_attempt,
    repository: matchingWorkflow.repository,
    workflow_file_identity: matchingWorkflow.workflow_file_identity,
  },
  deployment: {
    authorized_deployment_id: "canary-contract-test",
    manifest_id: matchingManifest.manifest_id,
    platform_deployment_id: "3b064508-1cdb-453c-826b-bdea36a8b1e5",
    worker_name: "fusou-tlsn-verification-canary",
    deployment_role: "canary",
    versions: [{ version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5", percentage: 100 }],
  },
  version: {
    version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5",
    serving_percentage: 100,
  },
  runtime_self_reported_identity: {
    deployment_id: "canary-contract-test",
    worker_name: "fusou-tlsn-verification-canary",
    deployment_role: "canary",
    git_commit_sha: expectedHead,
    runtime_version: { version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5" },
  },
  checks: {
    synthetic_evidence_rejected: true,
    runtime_is_production_canary: true,
    runtime_deployment_matches_authorized_identity: true,
    runtime_version_matches_platform_version: true,
    runtime_git_sha_matches_head: true,
  },
  captured_at: "2026-09-15T00:00:00.000Z",
};
const validRuntimeAttestation = signCanaryRuntimeAttestation(unsignedRuntimeAttestation, {
  signerKeyId: matchingEnvironment.TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID,
  signingPrivateKeyPkcs8: runtimeAttestationPrivateKeyPkcs8,
  registry: runtimeAttestationKeyRegistry,
  now: "2026-09-15T00:00:00.000Z",
});

const root = await mkdtemp(join(tmpdir(), "tlsn-canary-readiness-contract-"));
try {
  const artifactPath = join(root, "runtime-attestation.json");
  const reportFor = async (artifact, reportEnvironment = matchingEnvironment, reportManifest = matchingManifest) => {
    await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`, "utf8");
    return buildReadinessReport({
      environment: { ...reportEnvironment, TLSN_CANARY_DEPLOYMENT_ATTESTATION_PATH: artifactPath },
      expectedHead,
      artifactPaths: [],
      baseDirectory: root,
      validatedDeploymentManifest: reportManifest,
      runtimeAttestationKeyRegistry,
      now: new Date("2026-09-20T00:00:00.000Z"),
    });
  };

  const genericPassReport = await reportFor({ status: "PASS", environment: "production", deployment_role: "canary" });
  assert.equal(genericPassReport.status, "BLOCKED");
  assert.equal(genericPassReport.inputs.runtime_attestation.status, "INVALID");
  assert.equal(genericPassReport.gates.runtime_attestation, false);

  const fixtureReport = await reportFor({
    ...validRuntimeAttestation,
    scope: "tlsn-canary-deployment-runtime-attestation-fixture",
    status: "FIXTURE_ONLY",
    readiness: "NOT_READY",
    evidence: { source: "repository-fixture", synthetic: true },
  });
  assert.equal(fixtureReport.status, "BLOCKED");
  assert.equal(fixtureReport.inputs.runtime_attestation.status, "FIXTURE_ONLY");
  assert.equal(fixtureReport.gates.runtime_attestation, false);

  const validReport = await reportFor(validRuntimeAttestation);
  assert.equal(validReport.inputs.runtime_attestation.status, "VALID");
  assert.equal(validReport.inputs.runtime_attestation.readiness, "READY_FOR_HUMAN_GAMEPLAY");
  assert.equal(validReport.inputs.runtime_attestation.cross_binding.status, "PASS");
  assert.equal(validReport.cross_binding.status, "PASS");
  assert.equal(validReport.gates.runtime_attestation, true);
  assert.equal(validReport.gates.cross_binding, true);
  assert.equal(validReport.gates.attestation_fresh, true);
  assert.equal(validReport.gates.attestation_signature, true);
  assert.equal(validReport.inputs.runtime_attestation.signature_valid, true);
  assert.equal(validReport.inputs.runtime_attestation.signature_algorithm, "Ed25519");
  assert.equal(validReport.status, "BLOCKED");

  const tamperedPayloadReport = await reportFor({
    ...validRuntimeAttestation,
    deployment: {
      ...validRuntimeAttestation.deployment,
      platform_deployment_id: "5b064508-1cdb-453c-826b-bdea36a8b1e5",
    },
  });
  assert.equal(tamperedPayloadReport.status, "BLOCKED");
  assert.equal(tamperedPayloadReport.inputs.runtime_attestation.status, "INVALID");
  assert.equal(tamperedPayloadReport.gates.runtime_attestation, false);
  assert.equal(tamperedPayloadReport.gates.attestation_signature, false);

  const manifestIdMismatchReport = await reportFor(validRuntimeAttestation, matchingEnvironment, {
    ...matchingManifest,
    manifest_id: "C".repeat(43),
  });
  assert.equal(manifestIdMismatchReport.status, "BLOCKED");
  assert.equal(manifestIdMismatchReport.inputs.runtime_attestation.status, "INVALID");
  assert.equal(manifestIdMismatchReport.cross_binding.status, "BLOCKED");
  assert.equal(manifestIdMismatchReport.gates.cross_binding, false);
  assert.equal(manifestIdMismatchReport.gates.attestation_fresh, false);

  const expiredManifestReport = await reportFor(validRuntimeAttestation, matchingEnvironment, {
    ...matchingManifest,
    expires_at: "2026-09-10T00:00:00.000Z",
  });
  assert.equal(expiredManifestReport.status, "BLOCKED");
  assert.equal(expiredManifestReport.inputs.runtime_attestation.status, "INVALID");
  assert.equal(expiredManifestReport.gates.attestation_fresh, false);

  for (const [label, capturedAt] of [
    ["future captured_at", "2026-09-21T00:00:00.000Z"],
    ["captured_at before manifest.issued_at", "2026-08-31T23:59:59.999Z"],
    ["captured_at after manifest.expires_at", "2026-10-01T00:00:00.001Z"],
  ]) {
    const timestampReport = await reportFor({ ...validRuntimeAttestation, captured_at: capturedAt });
    assert.equal(timestampReport.status, "BLOCKED", label);
    assert.equal(timestampReport.inputs.runtime_attestation.status, "INVALID", label);
    assert.equal(timestampReport.gates.attestation_fresh, false, label);
  }

  const frankensteinReport = await reportFor(validRuntimeAttestation, {
    ...matchingEnvironment,
    TLSN_CANARY_DEPLOYMENT_ID: "canary-other-deployment",
  });
  assert.equal(frankensteinReport.status, "BLOCKED");
  assert.equal(frankensteinReport.inputs.runtime_attestation.status, "INVALID");
  assert.equal(frankensteinReport.cross_binding.status, "BLOCKED");
  assert.equal(frankensteinReport.gates.cross_binding, false);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("[tlsn-canary-readiness-contract] Runtime Attestation gate, remote validation boundary, and live-verifier status PASS");