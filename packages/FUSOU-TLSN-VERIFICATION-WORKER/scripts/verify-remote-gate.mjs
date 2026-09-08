#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const identityFields = [
  "git_commit_sha",
  "deployment_id",
  "profile_sha256",
  "verifier_key_id",
  "notary_key_id",
  "security_registry_set_sha256",
  "notary_registry_sha256",
  "result_public_key_spki",
  "binding_mode",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

async function readCanaryHealth(origin) {
  const response = await fetch(`${origin}/health`, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("current canary health endpoint redirected");
  }
  if (!response.ok) throw new Error(`current canary health returned ${response.status}`);
  return response.json();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assertProvenance(manifest, role) {
  if (
    manifest?.schema_version !== 1 ||
    manifest?.scope !== "production-deployment-inputs" ||
    manifest?.environment !== "production" ||
    manifest?.deployment_role !== role
  ) {
    throw new Error(`invalid ${role} provenance manifest`);
  }
  for (const field of identityFields) {
    if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
      throw new Error(`${role} provenance is missing ${field}`);
    }
  }
}

function compareIdentity(left, right, label) {
  for (const field of identityFields) {
    if (left[field] !== right[field]) {
      throw new Error(`${label} identity mismatch: ${field}`);
    }
  }
}

async function main() {
  const reportPath = process.env.TLSN_REMOTE_VALIDATION_REPORT_PATH?.trim()
    ?? process.env.TLSN_REMOTE_REPORT_PATH?.trim();
  if (!reportPath) throw new Error("missing required environment variable: TLSN_REMOTE_REPORT_PATH");
  const report = await readJson(reportPath);
  const canary = await readJson(required("TLSN_REMOTE_EXPECTED_PROVENANCE_JSON"));
  const production = await readJson(required("TLSN_PROVENANCE_REPORT_PATH"));
  assertProvenance(canary, "canary");
  assertProvenance(production, "production");

  if (report?.schema_version !== 1 || report?.scope !== "remote-deployed-synthetic") {
    throw new Error("remote validation report schema or scope is invalid");
  }
  if (report?.summary?.fail !== 0 || report?.summary?.blocking_blocked !== 0) {
    throw new Error("remote validation did not PASS all required synthetic checks");
  }
  if (report.production_evidence !== "BLOCKED" || report.p0_05 !== "BLOCKED") {
    throw new Error("production evidence and P0-05 must remain BLOCKED");
  }
  if (report.checks?.remote_worker_identity?.status !== "PASS") {
    throw new Error("remote Worker identity check did not PASS");
  }
  if (report.deployment_role !== "canary") {
    throw new Error("remote validation must target the canary Worker");
  }
  compareIdentity(report, canary, "remote validation");
  for (const field of identityFields) {
    if (field !== "binding_mode" && canary[field] !== production[field]) {
      throw new Error(`canary/production candidate mismatch: ${field}`);
    }
  }
  const expectedOrigin = new URL(required("TLSN_REMOTE_WORKER_URL")).origin;
  if (report.worker_origin !== expectedOrigin) {
    throw new Error("remote validation report worker origin mismatch");
  }
  const health = await readCanaryHealth(expectedOrigin);
  if (health.environment !== "production" || health.deployment_role !== "canary") {
    throw new Error("current remote Worker is not the production canary");
  }
  compareIdentity(health, canary, "current canary Worker");
  compareIdentity(report, health, "remote validation/current canary");

  console.log(JSON.stringify({
    status: "PASS",
    validated_worker_origin: report.worker_origin,
    git_commit_sha: production.git_commit_sha,
    deployment_id: production.deployment_id,
    binding_mode: canary.binding_mode,
  }));
}

main().catch((error) => {
  console.error(`[tlsn-verify-remote-gate] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});