#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
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

function resolveCargoCommand() {
  const homeCandidate = resolve(
    homedir(),
    ".cargo",
    "bin",
    process.platform === "win32" ? "cargo.exe" : "cargo",
  );

  const candidates = ["cargo", homeCandidate];
  for (const candidate of candidates) {
    if (canRun(candidate, ["--version"])) {
      return candidate;
    }
  }

  return null;
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
  const homeCandidate = resolve(
    homedir(),
    ".cargo",
    "bin",
    process.platform === "win32" ? "wasm-pack.exe" : "wasm-pack",
  );
  const localCandidate = resolve(AVRO_WASM_DIR, "node_modules/.bin", binName);
  const workspaceCandidate = resolve(
    AVRO_WASM_DIR,
    "../../node_modules/.bin",
    binName,
  );

  const candidates = [
    "wasm-pack",
    homeCandidate,
    localCandidate,
    workspaceCandidate,
  ];
  for (const candidate of candidates) {
    if (canRun(candidate, ["--version"])) {
      return candidate;
    }
  }

  return null;
}

function buildWasmPackEnv(cargoCommand) {
  const env = {
    ...process.env,
    CARGO: cargoCommand,
  };

  if (/[\\/]/.test(cargoCommand)) {
    const cargoBinDir = dirname(cargoCommand);
    const currentPath = process.env.PATH ?? "";
    const pathEntries = currentPath.split(delimiter).filter(Boolean);

    if (!pathEntries.includes(cargoBinDir)) {
      env.PATH = currentPath
        ? `${cargoBinDir}${delimiter}${currentPath}`
        : cargoBinDir;
    }
  }

  return env;
}

function main() {
  const requestedVersion = process.argv[2] || "all";

  const cargoCommand = resolveCargoCommand();
  if (!cargoCommand) {
    fail(
      "cargo is required but was not found. Run 'pnpm run setup:rust-env' first.",
    );
  }

  console.log(`Using cargo: ${cargoCommand}`);

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
  if (!wasmPack) {
    fail(
      "wasm-pack is required but was not found. Run 'pnpm run setup:rust-env' first.",
    );
  }

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
    {
      cwd: AVRO_WASM_DIR,
      env: buildWasmPackEnv(cargoCommand),
    },
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
