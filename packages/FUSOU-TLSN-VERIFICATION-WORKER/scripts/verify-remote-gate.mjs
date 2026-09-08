#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const securityIdentityFields = [
  "git_commit_sha",
  "server_identity",
  "profile_sha256",
  "verifier_key_id",
  "notary_key_id",
  "security_registry_set_sha256",
  "notary_registry_sha256",
  "binding_authority",
];
const deploymentIdentityFields = ["deployment_id", "deployment_role", "binding_mode", "trust_root_certificate_sha256", "worker_name"];
const resultIdentityFields = ["result_public_key_spki"];

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
    manifest?.schema_version !== 2 ||
    manifest?.scope !== "tlsn-deployment-provenance" ||
    manifest?.status !== "PASS" ||
    manifest?.environment !== "production" ||
    manifest?.deployment_role !== role
  ) {
    throw new Error(`invalid ${role} provenance manifest`);
  }
  for (const [name, fields] of [
    ["security_identity", securityIdentityFields],
    ["deployment_identity", deploymentIdentityFields],
    ["result_identity", resultIdentityFields],
  ]) {
    for (const field of fields) {
      if (typeof manifest[name]?.[field] !== "string" || manifest[name][field].length === 0) {
        throw new Error(`${role} provenance is missing ${name}.${field}`);
      }
    }
  }
}

function compareIdentity(left, right, label, fields) {
  for (const field of fields) {
    if (left?.[field] !== right?.[field]) {
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
  if (report.deployment_identity?.deployment_role !== "canary") {
    throw new Error("remote validation must target the canary Worker");
  }
  compareIdentity(report.security_identity, canary.security_identity, "remote validation security", securityIdentityFields);
  compareIdentity(report.deployment_identity, canary.deployment_identity, "remote validation deployment", deploymentIdentityFields);
  compareIdentity(report.result_identity, canary.result_identity, "remote validation result", resultIdentityFields);
  compareIdentity(canary.security_identity, production.security_identity, "canary/production security", securityIdentityFields);
  if (canary.result_identity.result_public_key_spki === production.result_identity.result_public_key_spki) {
    throw new Error("canary and production result public keys must be different");
  }
  const expectedOrigin = new URL(required("TLSN_REMOTE_WORKER_URL")).origin;
  if (report.worker_origin !== expectedOrigin) {
    throw new Error("remote validation report worker origin mismatch");
  }
  const health = await readCanaryHealth(expectedOrigin);
  if (health.environment !== "production" || health.deployment_role !== "canary") {
    throw new Error("current remote Worker is not the production canary");
  }
  compareIdentity(health.security_identity, canary.security_identity, "current canary Worker security", securityIdentityFields);
  compareIdentity(health.deployment_identity, canary.deployment_identity, "current canary Worker deployment", deploymentIdentityFields);
  compareIdentity(health.result_identity, canary.result_identity, "current canary Worker result", resultIdentityFields);
  compareIdentity(report.security_identity, health.security_identity, "remote validation/current canary security", securityIdentityFields);

  console.log(JSON.stringify({
    status: "PASS",
    validated_worker_origin: report.worker_origin,
    git_commit_sha: production.security_identity.git_commit_sha,
    deployment_id: production.deployment_identity.deployment_id,
    binding_mode: canary.deployment_identity.binding_mode,
  }));
}

main().catch((error) => {
  console.error(`[tlsn-verify-remote-gate] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});