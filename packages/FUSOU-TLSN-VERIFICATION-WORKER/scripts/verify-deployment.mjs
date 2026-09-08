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

async function main() {
  const manifest = JSON.parse(await readFile(required("TLSN_PROVENANCE_REPORT_PATH"), "utf8"));
  if (
    manifest?.schema_version !== 1 ||
    manifest?.scope !== "production-deployment-inputs" ||
    manifest?.environment !== "production" ||
    manifest?.deployment_role !== "production"
  ) {
    throw new Error("invalid production provenance manifest");
  }

  const origin = new URL(required("TLSN_VERIFY_WORKER_URL")).origin;
  const response = await fetch(`${origin}/health`, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("production Worker health endpoint redirected");
  }
  if (!response.ok) throw new Error(`production Worker health returned ${response.status}`);
  const health = await response.json();
  if (health.environment !== "production" || health.deployment_role !== "production") {
    throw new Error("production Worker environment or role mismatch");
  }
  for (const field of identityFields) {
    if (health[field] !== manifest[field]) {
      throw new Error(`post-deploy identity mismatch: ${field}`);
    }
  }
  const smokeResponse = await fetch(`${origin}/attestation/session`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (smokeResponse.status >= 300 && smokeResponse.status < 400) {
    throw new Error("production session endpoint redirected an unauthenticated request");
  }
  if (smokeResponse.status !== 401) {
    throw new Error(`production session smoke returned ${smokeResponse.status}, expected 401`);
  }

  console.log(JSON.stringify({
    status: "PASS",
    worker_origin: origin,
    git_commit_sha: manifest.git_commit_sha,
    deployment_id: manifest.deployment_id,
    verifier_key_id: manifest.verifier_key_id,
    profile_sha256: manifest.profile_sha256,
    result_public_key_spki: manifest.result_public_key_spki,
    smoke_status: smokeResponse.status,
  }));
}

main().catch((error) => {
  console.error(`[tlsn-verify-deployment] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});