import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readRegularFile } from "./release-files.mjs";
import { WORKER_ROOT, WORKER_SOURCE_PATHS, generateUnsignedWorkerBuild } from "./release-worker-source.mjs";
import { WASM_ARTIFACT_NAMES, collectWasmSourceInputs } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/wasm-provenance.mjs";
import { publicToolEnvironment } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-tool-environment.mjs";

export async function buildUnsignedWorker({ inputs, eligibility, workspace, runId, runAttempt, executionAllowed = false },
  { read = readRegularFile, run, list = readdir, collectInputs = collectWasmSourceInputs } = {}) {
  if (!executionAllowed) return { status: "BLOCKED_EXTERNAL_INPUTS", blockers: ["WORKER_BUILD_EXECUTION_NOT_AUTHORIZED"] };
  const source = resolve(workspace, "source"), sourceSha = eligibility.commit_sha;
  const environment = { ...publicToolEnvironment(process.env), FUSOU_RELEASE_SOURCE_SHA: sourceSha,
    FUSOU_RELEASE_ALLOW_WASM_BUILD: "1", RUSTUP_TOOLCHAIN: inputs.rust_toolchain,
    CARGO_NET_OFFLINE: "true", RUSTUP_AUTO_INSTALL: "0", WRANGLER_SEND_METRICS: "false", CI: "true" };
  const execute = run ?? ((command, args) => {
    try { return execFileSync(command, args, { cwd: source, env: environment, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { throw new Error(`unsigned Worker build tool failed: ${command}`); }
  });
  const checkHead = () => {
    if (Buffer.from(execute("git", ["rev-parse", "HEAD"])).toString().trim() !== sourceSha) throw new Error("Worker checkout source SHA mismatch");
  };
  checkHead();
  const sourceFiles = new Map(await Promise.all(WORKER_SOURCE_PATHS.map(async (path) => [path, await read(join(source, path))])));
  const wasmSourceInputs = await collectInputs({ workerDirectory: join(source, WORKER_ROOT) });
  const pnpm = Buffer.from(execute("pnpm", ["--version"])).toString().trim();
  const wrangler = Buffer.from(execute("pnpm", ["--dir", WORKER_ROOT, "exec", "wrangler", "--version"])).toString().trim();
  if (!/^\d+\.\d+\.\d+$/.test(pnpm) || !/^\d+\.\d+\.\d+$/.test(wrangler)) throw new Error("Worker toolchain version observation is invalid");
  const reference = { worker_git_commit_sha: inputs.worker_reference.compile_inputs.FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA,
    active_version_id: inputs.worker_reference.cloudflare.version_id, script_name: inputs.worker_reference.cloudflare.script_name };
  return generateUnsignedWorkerBuild({ sourceFiles, sourceSha, context: { repository: "tsukasa-u/FUSOU", source_sha: sourceSha,
    run_id: runId, run_attempt: runAttempt, workflow_sha: eligibility.coordinator_sha },
    toolchain: { node: process.versions.node, pnpm, rust: inputs.rust_toolchain, wrangler }, workerReference: reference,
    executionAllowed: true }, { executeRecipe: async ({ source: recipe, toolchain, context }) => {
      for (const [command, ...args] of recipe.commands) execute(command, args);
      checkHead();
      for (const [path, before] of sourceFiles) if (!before.equals(await read(join(source, path)))) throw new Error("Worker source changed during build");
      if (JSON.stringify(wasmSourceInputs) !== JSON.stringify(await collectInputs({ workerDirectory: join(source, WORKER_ROOT) }))) {
        throw new Error("Worker verifier source changed during build");
      }
      const artifactDirectory = join(source, WORKER_ROOT, "src/wasm"), modules = new Map(), wasmArtifacts = new Map();
      for (const name of WASM_ARTIFACT_NAMES) wasmArtifacts.set(name, await read(join(artifactDirectory, name)));
      const wasmProvenanceRaw = await read(join(artifactDirectory, "wasm-provenance.json"));
      const outputDirectory = join(source, ".fusou-worker-bundle");
      for (const name of await list(outputDirectory)) {
        if (/^[A-Za-z0-9_.-]+\.(?:js|wasm|map|json)$/.test(name)) modules.set(name, await read(join(outputDirectory, name)));
      }
      modules.set("wasm-provenance.json", wasmProvenanceRaw);
      return { source_inputs_sha256: recipe.source_inputs_sha256, toolchain, context, completed_commands: recipe.commands,
        exit_code: 0, modules, wasmArtifacts, wasmProvenanceRaw, wasmSourceInputs, wasmToolchain: JSON.parse(wasmProvenanceRaw).toolchain };
    } });
}
