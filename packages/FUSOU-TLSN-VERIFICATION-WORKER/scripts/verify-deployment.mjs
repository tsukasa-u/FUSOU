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
const resultIdentityFields = ["result_public_key_spki", "result_public_key_spki_sha256"];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const manifest = JSON.parse(await readFile(required("TLSN_PROVENANCE_REPORT_PATH"), "utf8"));
  if (
    manifest?.schema_version !== 2 ||
    manifest?.scope !== "tlsn-deployment-provenance" ||
    manifest?.status !== "PASS" ||
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
  for (const [name, fields] of [
    ["security_identity", securityIdentityFields],
    ["deployment_identity", deploymentIdentityFields],
    ["result_identity", resultIdentityFields],
  ]) {
    for (const field of fields) {
      if (health[name]?.[field] !== manifest[name]?.[field]) {
        throw new Error(`post-deploy identity mismatch: ${name}.${field}`);
      }
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
    git_commit_sha: manifest.security_identity.git_commit_sha,
    deployment_id: manifest.deployment_identity.deployment_id,
    verifier_key_id: manifest.security_identity.verifier_key_id,
    profile_sha256: manifest.security_identity.profile_sha256,
    result_public_key_spki: manifest.result_identity.result_public_key_spki,
    smoke_status: smokeResponse.status,
  }));
}

main().catch((error) => {
  console.error(`[tlsn-verify-deployment] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});