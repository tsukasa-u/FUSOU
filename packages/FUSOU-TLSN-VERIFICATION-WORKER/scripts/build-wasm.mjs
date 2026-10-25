#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { publicToolEnvironment } from "./app-build-tool-environment.mjs";
import { findWasmCompiler, resolveWasmPackCommand, wasmCompilerFlags, collectWasmSourceInputs,
  writeWasmArtifactProvenance, WASM_BUILD_ARGUMENTS } from "./wasm-provenance.mjs";

export async function buildWorkerWasm({
  expectedSourceSha, executionAllowed = false, environment = process.env,
  workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
}, { run = spawnSync, collectInputs = collectWasmSourceInputs, writeProvenance = writeWasmArtifactProvenance,
  findCompiler = findWasmCompiler, compilerFlags = wasmCompilerFlags, resolvePack = resolveWasmPackCommand } = {}) {
  if (!executionAllowed) throw new Error("WASM build execution is not authorized");
  if (!/^[0-9a-f]{40}$/.test(expectedSourceSha ?? "") || !/^\d+\.\d+\.\d+$/.test(environment.RUSTUP_TOOLCHAIN ?? "")) {
    throw new Error("exact release source SHA and Rust toolchain are required");
  }
  const repositoryRoot = resolve(workerDirectory, "../..");
  const cleanEnvironment = { ...publicToolEnvironment(environment), RUSTUP_TOOLCHAIN: environment.RUSTUP_TOOLCHAIN,
    CARGO_NET_OFFLINE: "true", RUSTUP_AUTO_INSTALL: "0" };
  const head = () => {
    const result = run("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", env: cleanEnvironment });
    if (result.error || result.status !== 0 || result.stdout.trim() !== expectedSourceSha) {
      throw new Error("WASM checkout does not match exact release source SHA");
    }
  };
  head();
  const before = await collectInputs({ workerDirectory });
  const wasmPack = resolvePack(workerDirectory);
  const version = run(wasmPack, ["--version"], { env: cleanEnvironment, stdio: "ignore" });
  if (version.error || version.status !== 0) throw new Error("wasm-pack is unavailable");
  const compiler = findCompiler(environment);
  if (!compiler) throw new Error("wasm-capable Clang compiler is required");
  const flags = compilerFlags(compiler, environment);
  Object.assign(cleanEnvironment, { CC_wasm32_unknown_unknown: compiler, CFLAGS_wasm32_unknown_unknown: flags });
  const built = run(wasmPack, [...WASM_BUILD_ARGUMENTS],
  { cwd: resolve(workerDirectory, "../FUSOU-TLSN-VERIFIER"), env: cleanEnvironment, stdio: "inherit" });
  if (built.error || built.status !== 0) throw new Error("offline Worker WASM build failed");
  head();
  if (JSON.stringify(before) !== JSON.stringify(await collectInputs({ workerDirectory }))) {
    throw new Error("WASM source inputs changed during compilation");
  }
  const provenance = await writeProvenance({ workerDirectory, artifactDirectory: resolve(workerDirectory, "src/wasm"),
    environment: cleanEnvironment, effectiveCompilerFlags: flags });
  if (provenance.source_commit_sha !== expectedSourceSha || provenance.source_tree_status !== "CLEAN" ||
      JSON.stringify(provenance.source_inputs) !== JSON.stringify(before)) {
    throw new Error("WASM provenance is not bound to the clean release source");
  }
  return provenance;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildWorkerWasm({ expectedSourceSha: process.env.FUSOU_RELEASE_SOURCE_SHA,
    executionAllowed: process.env.FUSOU_RELEASE_ALLOW_WASM_BUILD === "1" });
  console.log("WASM_BUILD_NETWORK=VERIFIED_OFFLINE");
}
