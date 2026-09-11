#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { spawnSync } from "node:child_process";

const packageDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));

const required = [
  "TRIGGER_PROJECT_REF",
  "TLSN_WORKER_INTERNAL_URL",
  "TLSN_TRIGGER_CALLBACK_SECRET",
  "TLSN_TRIGGER_SERVER_IDENTITY",
  "TLSN_TRIGGER_PROFILE_SHA256",
  "TLSN_TRIGGER_VERIFIER_KEY_ID",
  "TLSN_TRIGGER_NOTARY_KEY_ID",
  "TLSN_TRIGGER_NOTARY_REGISTRY",
  "TLSN_TRIGGER_TRUST_ROOT_CERTIFICATE_DER",
];
const missing = required.filter((name) => !String(process.env[name] || "").trim());
if (missing.length > 0) {
  console.error(`Missing required TLSN deployment env names: ${missing.join(", ")}`);
  process.exit(1);
}
if (String(process.env.TRIGGER_PROJECT_REF).startsWith("encrypted:")) {
  console.error("TRIGGER_PROJECT_REF is still encrypted. Run this script through dotenvx.");
  process.exit(1);
}

const missingAssets = [
  resolve(packageDirectory, "../FUSOU-TLSN-VERIFICATION-WORKER/src/wasm/fusou_tlsn_verifier.js"),
  resolve(packageDirectory, "../FUSOU-TLSN-VERIFICATION-WORKER/src/wasm/fusou_tlsn_verifier_bg.wasm"),
].filter((assetPath) => !existsSync(assetPath));
if (missingAssets.length > 0) {
  console.error("Missing TLSN Trigger verifier assets. Build the Worker WASM artifact first.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["scripts/trigger-deploy.mjs", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
