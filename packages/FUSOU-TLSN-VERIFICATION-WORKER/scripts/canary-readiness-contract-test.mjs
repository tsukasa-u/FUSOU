#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildReadinessReport } from "./canary-readiness-test.mjs";
import { CANARY_TLSN_ARCHITECTURE } from "./canary-external-input-intake.mjs";

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
const validRuntimeAttestation = {
  schema_version: 1,
  scope: "tlsn-canary-deployment-runtime-attestation",
  status: "PASS",
  readiness: "READY_FOR_HUMAN_GAMEPLAY",
  evidence: {
    source: "cloudflare-platform-and-live-health",
    synthetic: false,
  },
  repository: { git_commit_sha: expectedHead },
  deployment: {
    authorized_deployment_id: "canary-contract-test",
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
};

const root = await mkdtemp(join(tmpdir(), "tlsn-canary-readiness-contract-"));
try {
  const artifactPath = join(root, "runtime-attestation.json");
  const reportFor = async (artifact) => {
    await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`, "utf8");
    return buildReadinessReport({
      environment: { TLSN_CANARY_DEPLOYMENT_ATTESTATION_PATH: artifactPath },
      expectedHead,
      artifactPaths: [],
      baseDirectory: root,
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
  assert.equal(validReport.gates.runtime_attestation, true);
  assert.equal(validReport.status, "BLOCKED");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("[tlsn-canary-readiness-contract] Runtime Attestation gate, remote validation boundary, and live-verifier status PASS");