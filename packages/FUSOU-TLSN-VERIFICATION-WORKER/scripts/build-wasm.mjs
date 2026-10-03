#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  findWasmCompiler,
  resolveWasmPackCommand,
  wasmCompilerFlags,
  writeWasmArtifactProvenance,
} from "./wasm-provenance.mjs";

const workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifierDirectory = resolve(workerDirectory, "../FUSOU-TLSN-VERIFIER");
const wasmPack = resolveWasmPackCommand(workerDirectory);

const wasmPackCheck = spawnSync(wasmPack, ["--version"], { stdio: "ignore" });
if (wasmPackCheck.error || wasmPackCheck.status !== 0) {
  throw new Error(`wasm-pack was not found at ${wasmPack}`);
}

const environment = {
  ...process.env,
  RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? "1.95.0",
  CARGO_NET_OFFLINE: "true",
  RUSTUP_AUTO_INSTALL: "0",
};
const compiler = findWasmCompiler();
if (!compiler) {
  throw new Error(
    "A wasm-capable Clang compiler is required to build ring for wasm32-unknown-unknown. Set CC_wasm32_unknown_unknown to its path.",
  );
}
environment.CC_wasm32_unknown_unknown = compiler;
const effectiveCompilerFlags = wasmCompilerFlags(compiler, process.env);
environment.CFLAGS_wasm32_unknown_unknown = effectiveCompilerFlags;

const result = spawnSync(
  wasmPack,
  [
    "build",
    "--mode",
    "no-install",
    "--target",
    "web",
    "--release",
    "--out-dir",
    "../FUSOU-TLSN-VERIFICATION-WORKER/src/wasm",
  ],
  {
    cwd: verifierDirectory,
    env: environment,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

await writeWasmArtifactProvenance({
  workerDirectory,
  artifactDirectory: resolve(workerDirectory, "src/wasm"),
  environment,
  effectiveCompilerFlags,
});
console.log("WASM_BUILD_NETWORK=VERIFIED_OFFLINE");