#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const WRANGLER_COMMAND =
  process.platform === "win32" ? "wrangler.cmd" : "wrangler";

const REQUIRED_SECRET_NAMES = [
  "DATASET_TOKEN_SECRET",
  "CHALLENGE_HMAC_SECRET",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
];

const RECOMMENDED_SECRET_NAMES = [
  "INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256",
  "INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256",
];

function fail(message) {
  console.error(`[check-cloudflare-required-secrets] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: WEB_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    encoding: "utf8",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    const output = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(output || `${command} exited with status ${result.status}`);
  }

  return result.stdout || "";
}

function parseSecretNames(rawOutput) {
  const text = rawOutput.trim();
  if (!text) {
    throw new Error("wrangler returned empty output");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonStart = text.indexOf("[");
    if (jsonStart === -1) {
      throw new Error("unable to parse wrangler secret list JSON output");
    }
    parsed = JSON.parse(text.slice(jsonStart));
  }

  if (!Array.isArray(parsed)) {
    throw new Error("wrangler secret list output is not an array");
  }

  return parsed
    .map((entry) => entry?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

function main() {
  const locallyInjected = REQUIRED_SECRET_NAMES.filter(
    (name) =>
      typeof process.env[name] === "string" && process.env[name].length > 0,
  );
  if (locallyInjected.length > 0) {
    console.log(
      "[check-cloudflare-required-secrets] Found local process.env values for required names, but these are ignored for this check.",
    );
  }

  const output = run(WRANGLER_COMMAND, ["secret", "list", "--format", "json"]);

  const registeredNames = new Set(parseSecretNames(output));
  const missing = REQUIRED_SECRET_NAMES.filter(
    (name) => !registeredNames.has(name),
  );

  if (missing.length > 0) {
    console.error(
      "[check-cloudflare-required-secrets] Missing required Cloudflare Worker secrets:",
    );
    for (const name of missing) {
      console.error(`- ${name}`);
    }
    console.error(
      "[check-cloudflare-required-secrets] Register them in Cloudflare Workers secrets (wrangler secret put or Dashboard).",
    );
    process.exit(2);
  }

  const missingRecommended = RECOMMENDED_SECRET_NAMES.filter(
    (name) => !registeredNames.has(name),
  );
  if (missingRecommended.length > 0) {
    console.warn(
      "[check-cloudflare-required-secrets] Recommended trust-related secrets are not registered:",
    );
    for (const name of missingRecommended) {
      console.warn(`- ${name}`);
    }
  }

  console.log(
    `[check-cloudflare-required-secrets] OK: all required secrets are registered (${REQUIRED_SECRET_NAMES.join(", ")}).`,
  );
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
