#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AVRO_WASM_DIR = __dirname;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function canRun(command, args = []) {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    shell: false,
  });
  return !result.error && result.status === 0;
}

function detectVersions() {
  const cargoTomlPath = resolve(AVRO_WASM_DIR, "Cargo.toml");
  if (!existsSync(cargoTomlPath)) {
    fail(`Cargo.toml not found: ${cargoTomlPath}`);
  }

  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const versions = [];
  const pattern = /^schema_(v[0-9]+_[0-9]+)\s*=/gm;
  let match = pattern.exec(cargoToml);
  while (match) {
    versions.push(match[1]);
    match = pattern.exec(cargoToml);
  }

  if (!versions.length) {
    fail("No schema_vN_M features found in avro-wasm Cargo.toml");
  }

  return versions;
}

function resolveWasmPackCommand() {
  const binName = process.platform === "win32" ? "wasm-pack.cmd" : "wasm-pack";
  const localCandidate = resolve(AVRO_WASM_DIR, "node_modules/.bin", binName);
  const workspaceCandidate = resolve(
    AVRO_WASM_DIR,
    "../../node_modules/.bin",
    binName,
  );

  const candidates = [localCandidate, workspaceCandidate, "wasm-pack"];
  for (const candidate of candidates) {
    if (canRun(candidate, ["--version"])) {
      return candidate;
    }
  }

  console.log("wasm-pack not found. Installing via cargo...");
  run("cargo", ["install", "wasm-pack", "--locked", "--force"]);

  if (canRun("wasm-pack", ["--version"])) {
    return "wasm-pack";
  }
  if (canRun(localCandidate, ["--version"])) {
    return localCandidate;
  }
  if (canRun(workspaceCandidate, ["--version"])) {
    return workspaceCandidate;
  }

  fail("wasm-pack installation failed or wasm-pack is not executable");
}

function main() {
  const requestedVersion = process.argv[2] || "all";

  if (!canRun("cargo", ["--version"])) {
    fail("cargo is required but was not found in PATH");
  }

  const versions = detectVersions();
  console.log(`Detected schema versions: ${versions.join(" ")}`);

  let feature;
  if (requestedVersion === "all") {
    const parts = versions.map((v) => `schema_${v}`);
    feature = `${parts.join(",")},console_error_panic_hook`;
  } else if (/^v[0-9]+_[0-9]+$/.test(requestedVersion)) {
    feature = `schema_${requestedVersion},console_error_panic_hook`;
  } else {
    fail("Usage: node build-wasm.mjs [v0_4|v0_5|...|all]");
  }

  const wasmPack = resolveWasmPackCommand();
  console.log(`Building avro-wasm with features: ${feature}`);

  run(
    wasmPack,
    [
      "build",
      "--target",
      "web",
      "--release",
      "--no-default-features",
      "--features",
      feature,
    ],
    { cwd: AVRO_WASM_DIR },
  );

  const outputJs = resolve(AVRO_WASM_DIR, "pkg/avro_wasm.js");
  if (!existsSync(outputJs)) {
    fail("WASM build failed: pkg/avro_wasm.js was not generated");
  }

  console.log("avro-wasm build completed successfully.");
}

try {
  main();
} catch (error) {
  console.error(
    "build-wasm failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
