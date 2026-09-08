#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const inputManifestPath = resolve(packageDirectory, "scripts/production-inputs.json");
const deploymentAuthInputs = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "WRANGLER_SEND_METRICS",
  "WRANGLER_LOG",
];
const secretInputs = new Set([
  "TLSN_PRODUCTION_SIGNING_PRIVATE_KEY_PKCS8",
]);
const inheritedRuntimeInputs = [
  "PATH",
  "HOME",
  "PWD",
  "TMPDIR",
  "TMP",
  "TEMP",
  "CI",
  "NODE_OPTIONS",
  "XDG_CACHE_HOME",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "CC_wasm32_unknown_unknown",
  "AR_wasm32_unknown_unknown",
  "RUSTFLAGS",
];

function fail(message) {
  console.error(`[tlsn-deploy-production] ${message}`);
  process.exitCode = 1;
}

async function main() {
  const manifest = JSON.parse(await readFile(inputManifestPath, "utf8"));
  const allowedInputs = manifest.allowed_inputs;
  if (
    manifest.schema_version !== 1 ||
    manifest.scope !== "fusou-tlsn-verification-worker-production" ||
    !Array.isArray(allowedInputs) ||
    allowedInputs.length === 0
  ) {
    throw new Error("production input manifest is invalid");
  }
  const preflight = spawnSync("pnpm", ["run", "preflight:production"], {
    cwd: packageDirectory,
    env: process.env,
    stdio: "inherit",
  });
  if (preflight.error) throw preflight.error;
  if (preflight.status !== 0) {
    process.exitCode = preflight.status ?? 1;
    return;
  }

  const allowedChildEnvironment = new Set([
    ...allowedInputs,
    ...deploymentAuthInputs,
    ...inheritedRuntimeInputs,
  ]);
  const build = spawnSync("pnpm", ["run", "build:wasm"], {
    cwd: packageDirectory,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => inheritedRuntimeInputs.includes(name)),
    ),
    stdio: "inherit",
  });
  if (build.error) throw build.error;
  if (build.status !== 0) {
    process.exitCode = build.status ?? 1;
    return;
  }
  const childEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => allowedChildEnvironment.has(name)),
  );
  const deployArguments = ["exec", "wrangler", "deploy"];
  for (const name of allowedInputs) {
    if (!secretInputs.has(name)) {
      deployArguments.push("--var", `${name}:${process.env[name]}`);
    }
  }
  const secretDirectory = await mkdtemp(join(tmpdir(), "tlsn-production-secrets-"));
  const secretsPath = join(secretDirectory, "secrets.json");
  try {
    await writeFile(
      secretsPath,
      JSON.stringify(Object.fromEntries([...secretInputs].map((name) => [name, process.env[name]]))),
      { encoding: "utf8", mode: 0o600 },
    );
    deployArguments.push("--secrets-file", secretsPath);
    const deploy = spawnSync("pnpm", deployArguments, {
      cwd: packageDirectory,
      env: childEnvironment,
      stdio: "inherit",
    });
    if (deploy.error) throw deploy.error;
    process.exitCode = deploy.status ?? 1;
  } finally {
    await rm(secretDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
