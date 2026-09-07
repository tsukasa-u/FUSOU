#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifierDirectory = resolve(workerDirectory, "../FUSOU-TLSN-VERIFIER");
const repositoryNodeModules = resolve(workerDirectory, "../../node_modules/.bin");
const localWasmPack = resolve(
  repositoryNodeModules,
  process.platform === "win32" ? "wasm-pack.cmd" : "wasm-pack",
);
const wasmPack = existsSync(localWasmPack) ? localWasmPack : "wasm-pack";

function findCompiler() {
  if (process.env.CC_wasm32_unknown_unknown) {
    return process.env.CC_wasm32_unknown_unknown;
  }
  for (const candidate of ["clang", "clang-18", "clang-17"]) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }
  return undefined;
}

const wasmPackCheck = spawnSync(wasmPack, ["--version"], { stdio: "ignore" });
if (wasmPackCheck.error || wasmPackCheck.status !== 0) {
  throw new Error(`wasm-pack was not found at ${wasmPack}`);
}

const environment = {
  ...process.env,
  RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? "1.95.0",
};
const compiler = findCompiler();
if (!compiler) {
  throw new Error(
    "A wasm-capable Clang compiler is required to build ring for wasm32-unknown-unknown. Set CC_wasm32_unknown_unknown to its path.",
  );
}
environment.CC_wasm32_unknown_unknown = compiler;
const resourceDirectory = spawnSync(compiler, ["-print-resource-dir"], {
  encoding: "utf8",
}).stdout?.trim();
const requiredCFlags = ["--target=wasm32-unknown-unknown"];
if (resourceDirectory) {
  requiredCFlags.push(`-I${resolve(resourceDirectory, "include")}`);
}
environment.CFLAGS_wasm32_unknown_unknown = [
  ...requiredCFlags,
  process.env.CFLAGS_wasm32_unknown_unknown ?? "",
]
  .join(" ")
  .trim();

const result = spawnSync(
  wasmPack,
  [
    "build",
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