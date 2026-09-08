#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
  const origin = new URL(required("TLSN_CAPTURE_WORKER_URL")).origin;
  const response = await fetch(`${origin}/health`, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) throw new Error("previous Worker health endpoint redirected");
  if (!response.ok) throw new Error(`previous Worker health returned ${response.status}`);
  const health = await response.json();
  if (health.environment !== "production" || health.deployment_role !== "production") {
    throw new Error("previous Worker is not a production deployment");
  }
  for (const field of identityFields) {
    if (typeof health[field] !== "string" || health[field].length === 0) {
      throw new Error(`previous Worker health is missing ${field}`);
    }
  }
  const manifest = {
    schema_version: 1,
    scope: "previous-known-good-deployment",
    captured_at: new Date().toISOString(),
    worker_origin: origin,
    deployment_role: health.deployment_role,
    environment: health.environment,
  };
  for (const field of identityFields) manifest[field] = health[field];
  const path = required("TLSN_PREVIOUS_PROVENANCE_PATH");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", worker_origin: origin, deployment_id: health.deployment_id }));
}

main().catch((error) => {
  console.error(`[tlsn-capture-deployment] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});