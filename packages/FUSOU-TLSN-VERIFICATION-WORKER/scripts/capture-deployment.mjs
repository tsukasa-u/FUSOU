#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
const resultIdentityFields = [
  "result_public_key_spki",
  "result_public_key_spki_sha256",
  "result_signer_key_id",
  "result_key_registry_sha256",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const origin = new URL(required("TLSN_CAPTURE_WORKER_URL")).origin;
  const response = await fetch(`${origin}/health`, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) throw new Error("previous Worker health endpoint redirected");
  if (!response.ok) throw new Error(`previous Worker health returned ${response.status}`);
  const health = await response.json();
  if (health.environment !== "production" || health.deployment_role !== "production") {
    throw new Error("previous Worker is not a production deployment");
  }
  for (const [name, fields] of [
    ["security_identity", securityIdentityFields],
    ["deployment_identity", deploymentIdentityFields],
    ["result_identity", resultIdentityFields],
  ]) {
    for (const field of fields) {
      if (typeof health[name]?.[field] !== "string" || health[name][field].length === 0) {
        throw new Error(`previous Worker health is missing ${name}.${field}`);
      }
    }
  }
  const manifest = {
    schema_version: 2,
    scope: "previous-known-good-deployment",
    status: "PASS",
    captured_at: new Date().toISOString(),
    worker_origin: origin,
    deployment_role: health.deployment_role,
    environment: health.environment,
  };
  manifest.security_identity = health.security_identity;
  manifest.deployment_identity = health.deployment_identity;
  manifest.result_identity = health.result_identity;
  const path = required("TLSN_PREVIOUS_PROVENANCE_PATH");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", worker_origin: origin, deployment_id: health.deployment_id }));
}

main().catch((error) => {
  console.error(`[tlsn-capture-deployment] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});