#!/usr/bin/env node

import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AVRO_WASM_DIR = resolve(__dirname, "../../avro-wasm");

function fail(message) {
  console.error(`[setup-rust-env] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
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
  const home = homedir();
  const homeCandidate = resolve(
    home,
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

function resolveWasmPackCommand() {
  const home = homedir();
  const homeCandidate = resolve(
    home,
    ".cargo",
    "bin",
    process.platform === "win32" ? "wasm-pack.exe" : "wasm-pack",
  );

  const binName = process.platform === "win32" ? "wasm-pack.cmd" : "wasm-pack";
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

function installRustToolchain() {
  if (process.platform === "win32") {
    fail(
      "cargo was not found. Install Rust with rustup first, then rerun this script.",
    );
  }

  if (!canRun("curl", ["--version"])) {
    fail("curl is required to install Rust automatically");
  }

  console.log("[setup-rust-env] Installing Rust toolchain via rustup...");
  run("sh", [
    "-c",
    "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
  ]);
}

function ensureCargo() {
  let cargoCommand = resolveCargoCommand();
  if (cargoCommand) {
    return cargoCommand;
  }

  installRustToolchain();
  cargoCommand = resolveCargoCommand();
  if (!cargoCommand) {
    fail("cargo installation did not produce an executable command");
  }

  return cargoCommand;
}

function ensureWasmPack(cargoCommand) {
  let wasmPackCommand = resolveWasmPackCommand();
  if (wasmPackCommand) {
    return wasmPackCommand;
  }

  console.log("[setup-rust-env] Installing wasm-pack via cargo...");
  run(cargoCommand, ["install", "wasm-pack", "--locked", "--force"]);

  wasmPackCommand = resolveWasmPackCommand();
  if (!wasmPackCommand) {
    fail("wasm-pack installation did not produce an executable command");
  }

  return wasmPackCommand;
}

function main() {
  const cargoCommand = ensureCargo();
  const wasmPackCommand = ensureWasmPack(cargoCommand);

  console.log(`[setup-rust-env] cargo ready: ${cargoCommand}`);
  console.log(`[setup-rust-env] wasm-pack ready: ${wasmPackCommand}`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
