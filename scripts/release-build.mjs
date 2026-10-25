import { execFileSync } from "node:child_process";
import { constants, openSync, fstatSync, readFileSync, closeSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { sha256, MAX_RELEASE_RECORD_BYTES } from "./release-manifest.mjs";
import { assertAppBuildRecordBinding } from "./release-build-proof.mjs";
import { LOCK_PATHS, recordLockedDependenciesExecution, recordCompiledInputsExecution } from "./release-checks.mjs";
import { readRegularFile } from "./release-files.mjs";
import { buildUnsignedWorker } from "./release-worker-build.mjs";
export { readRegularFile } from "./release-files.mjs";

async function buildUnsignedApp({ inputs, eligibility, workspace, sourceToken }) {
  const {
    buildApprovedApp, assertBuildReference, runtimeConfigBootstrapInputs, runPublicBuildCommand,
  } = await import("../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs");
  const { validatePublicAppInputs } = await import("../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-public-configuration.mjs");
  const reference = assertBuildReference(inputs.worker_reference, eligibility.commit_sha);
  const publicInputs = validatePublicAppInputs(inputs.public_app_inputs);
  const bootstrap = runtimeConfigBootstrapInputs(inputs.runtime_config_bootstrap);
  if (!bootstrap) throw new Error("registered Runtime Config bootstrap is required for build");
  if (inputs.platform !== "linux-x86_64" || process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("this unsigned build driver currently supports linux-x86_64 only");
  }
  const root = resolve(workspace);
  if (typeof sourceToken !== "string" || !sourceToken) throw new Error("read-only source token required");
  const source = join(root, "source");
  const commands = [], reports = {};
  const referencePath = join(root, "worker-reference.json");
  const template = join(root, "empty-template");
  await mkdir(template);
  const toolEnv = Object.fromEntries(["PATH", "HOME", "LANG", "TMPDIR"].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  const run = (command, args, cwd = root) => {
    try {
      return execFileSync(command, args, { cwd, env: toolEnv, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      // Child errors can include the fetch header or tool output; never publish them.
      throw new Error(`unsigned release build tool failed: ${command}`);
    }
  };
  // This credential is read-only and never persisted or inherited by source build commands.
  run("git", ["init", "--template", template, source]);
  run("git", ["-c", `http.extraHeader=AUTHORIZATION: bearer ${sourceToken}`, "fetch", "--depth=1",
    "https://github.com/tsukasa-u/FUSOU.git", eligibility.commit_sha], source);
  run("git", ["checkout", "--detach", eligibility.commit_sha], source);
  if (run("git", ["rev-parse", "HEAD"], source).toString().trim() !== eligibility.commit_sha) throw new Error("source checkout SHA mismatch");
  run("sudo", ["apt-get", "update"]);
  run("sudo", ["apt-get", "install", "-y", "libwebkit2gtk-4.1-dev", "libappindicator3-dev", "librsvg2-dev", "patchelf"]);
  run("rustup", ["toolchain", "install", inputs.rust_toolchain, "--profile", "minimal"]);
  run("corepack", ["enable"]);
  const sourceFiles = new Map(await Promise.all(LOCK_PATHS.map(async (path) =>
    [path, await readRegularFile(join(source, path))])));
  const pnpmVersion = run("pnpm", ["--version"], source).toString().trim();
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], source);
  commands.push({ argv: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"], exit_code: 0 });
  const referenceBytes = Buffer.from(canonicalJson(reference));
  await writeFile(referencePath, referenceBytes, { flag: "wx", mode: 0o600 });
  const built = await buildApprovedApp({
    referencePath, expectedReferenceSha256: sha256(referenceBytes),
    expectedWorkerSha: eligibility.commit_sha, expectedAppSha: eligibility.commit_sha,
    outputDirectory: join(root, "app-build"), repositoryDirectory: source,
    toolchain: inputs.rust_toolchain, environment: { ...toolEnv, ...bootstrap },
  }, {
    run: (command, args, options) => {
      const kind = args.length === 1 && args[0] === "--tlsn-compiled-worker-entry" ? "worker" :
        args.length === 1 && args[0] === "--app-compiled-public-configuration" ? "public" : null;
      const readExecutable = () => {
        if (!resolve(command).startsWith(`${root}${sep}`)) throw new Error("compiled report executable escaped workspace");
        const fd = openSync(command, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (!fstatSync(fd).isFile()) throw new Error("compiled report executable must be regular");
          return readFileSync(fd);
        } finally { closeSync(fd); }
      };
      const before = kind ? sha256(readExecutable()) : null;
      const stdout = runPublicBuildCommand(command, args, options);
      if (command === "pnpm" && args[0] === "exec" && args[1] === "tauri") {
        commands.push({ argv: ["pnpm", ...args], exit_code: 0 });
      }
      if (kind) {
        if (sha256(readExecutable()) !== before) throw new Error("compiled executable changed during observation");
        const raw = Buffer.from(stdout);
        reports[kind] = { argv: args, exit_code: 0, stdout_sha256: sha256(raw), executable_sha256: before, raw };
      }
      return stdout;
    },
    loadDotenvx: async () => ({
      inputs: publicInputs,
      reference: { scope: "independently-pinned-public-release-inputs", sha256: sha256(Buffer.from(canonicalJson(inputs))) },
      assertUnchanged: async () => {
        if (canonicalJson(publicInputs) !== canonicalJson(validatePublicAppInputs(inputs.public_app_inputs))) {
          throw new Error("pinned public build inputs changed");
        }
      },
    }),
  });
  for (const [path, before] of sourceFiles) {
    if (!before.equals(await readRegularFile(join(source, path)))) throw new Error("release dependency input changed during build");
  }
  return { ...built, execution: { sourceFiles, commands, reports, pnpmVersion } };
}

export async function generateReleaseBuild({
  eligibility, publicInputsBytes, publicInputsSha256, workspace, outputDirectory,
  runId, runAttempt, sourceToken, workerBuildAuthorized = false,
}, { recheckEligibility, buildApp = buildUnsignedApp, buildWorker = buildUnsignedWorker, readArtifact = readRegularFile } = {}) {
  if (eligibility?.schema_version !== 2 || eligibility.status !== "PRODUCTION_ELIGIBLE") {
    throw new Error("Production eligibility is required before build");
  }
  if (!publicInputsSha256 || publicInputsBytes === undefined) {
    return { status: "BLOCKED_EXTERNAL_INPUTS", tag_status: eligibility.status,
      blockers: ["PINNED_PUBLIC_BUILD_INPUTS_NOT_SUPPLIED"], artifact_status: "NOT_CHECKED", deployed: false };
  }
  if (!(publicInputsBytes instanceof Uint8Array) || publicInputsBytes.byteLength > MAX_RELEASE_RECORD_BYTES ||
      sha256(publicInputsBytes) !== publicInputsSha256) throw new Error("public build input hash/size mismatch");
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(publicInputsBytes);
  const inputs = JSON.parse(raw);
  const fields = ["schema_version", "app_source_sha", "worker_reference", "public_app_inputs",
    "runtime_config_bootstrap", "rust_toolchain", "platform"].sort();
  if (canonicalJson(inputs) !== raw || canonicalJson(Object.keys(inputs).sort()) !== canonicalJson(fields) ||
      inputs.schema_version !== 1 || inputs.app_source_sha !== eligibility.commit_sha ||
      !/^\d+\.\d+\.\d+$/.test(inputs.rust_toolchain)) throw new Error("public build input contract/source mismatch");
  if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(runAttempt) || runAttempt < 1 ||
      typeof recheckEligibility !== "function") throw new Error("build run identity and live eligibility recheck required");
  async function unchanged() {
    const fresh = await recheckEligibility();
    for (const key of ["status", "commit_sha", "tag", "validation_run_id", "validation_run_attempt", "coordinator_sha", "validation_workflow_blob_sha"]) {
      if (fresh[key] !== eligibility[key]) throw new Error(`release eligibility changed: ${key}`);
    }
  }
  await unchanged();
  const built = await buildApp({ inputs, eligibility, workspace, sourceToken });
  const artifactPath = resolve(built.artifactPath);
  if (!artifactPath.startsWith(`${resolve(workspace)}${sep}`)) throw new Error("APP output escaped build workspace");
  const bytes = await readArtifact(artifactPath);
  const record = built.record;
  assertAppBuildRecordBinding(record, { sourceSha: eligibility.commit_sha,
    workerVersionId: inputs.worker_reference.cloudflare.version_id, artifactBytes: bytes });
  await unchanged();
  await mkdir(outputDirectory, { recursive: true });
  const recordBytes = Buffer.from(canonicalJson({
    schema_version: 1, scope: "fusou-release-artifact-build-record-v1",
    source_sha: eligibility.commit_sha, run_id: runId, run_attempt: runAttempt,
    workflow_sha: eligibility.coordinator_sha, platform: inputs.platform,
    artifact_sha256: sha256(bytes), byte_length: bytes.length,
    worker_version_id: record.active_version_id, details: record,
  }));
  const provenance = {
    schema_version: 1, scope: "fusou-release-build-provenance-v1",
    source_sha: eligibility.commit_sha, run_id: runId, run_attempt: runAttempt,
    workflow_sha: eligibility.coordinator_sha, artifact_sha256: sha256(bytes),
    platform: inputs.platform, input_record_sha256: sha256(recordBytes),
  };
  await writeFile(join(outputDirectory, `app-${inputs.platform}.bin`), bytes, { flag: "wx" });
  await writeFile(join(outputDirectory, "app-build-record.json"), recordBytes, { flag: "wx" });
  await writeFile(join(outputDirectory, "release-build-provenance.json"), canonicalJson(provenance), { flag: "wx" });
  const checkFiles = new Map();
  if (built.execution) {
    const context = { repository: "tsukasa-u/FUSOU", source_sha: eligibility.commit_sha, run_id: runId,
      run_attempt: runAttempt, workflow_sha: eligibility.coordinator_sha };
    const locked = recordLockedDependenciesExecution({ context, inputs: built.execution.sourceFiles, appRecord: record,
      output: { commands: built.execution.commands, pnpm_version: built.execution.pnpmVersion } });
    for (const [name, raw] of locked.files) checkFiles.set(name, raw);
    const reports = {};
    for (const [role, report] of Object.entries(built.execution.reports)) {
      const { raw, ...metadata } = report;
      if (metadata.executable_sha256 !== sha256(bytes) || sha256(raw) !== metadata.stdout_sha256) {
        throw new Error("actual compiled observation/artifact mismatch");
      }
      reports[role] = metadata;
      checkFiles.set(`evidence-${sha256(raw)}.bin`, raw);
    }
    checkFiles.set("app-compiled-observations.json", Buffer.from(canonicalJson({
      schema_version: 1, scope: "fusou-app-compiled-execution-observations-v1", ...context,
      executable_sha256: sha256(bytes), reports, app_build_record_sha256: sha256(recordBytes),
      public_build_inputs_sha256: publicInputsSha256,
    })));
    for (const [name, raw] of checkFiles) await writeFile(join(outputDirectory, name), raw, { flag: "wx" });
  }
  const artifacts = [{
    name: "app", role: "app", platform: inputs.platform, file: `app-${inputs.platform}.bin`,
    build_record_file: "app-build-record.json", provenance_file: "release-build-provenance.json",
    sha256: sha256(bytes), byte_length: bytes.length, build_record_sha256: sha256(recordBytes),
    provenance_sha256: sha256(Buffer.from(canonicalJson(provenance))),
  }];
  const worker = await buildWorker({ inputs, eligibility, workspace, runId, runAttempt, executionAllowed: workerBuildAuthorized });
  await unchanged();
  if (worker.status === "BUILD_OUTPUTS_GENERATED") {
    for (const [name, raw] of [["worker.bin", worker.raw], ["worker-build-record.json", worker.recordRaw],
      ["worker-build-provenance.json", worker.provenance]]) {
      await writeFile(join(outputDirectory, name), raw, { flag: "wx" });
    }
    for (const raw of worker.wasmArtifacts.values()) {
      const name = `evidence-${sha256(raw)}.bin`;
      if (!checkFiles.has(name)) await writeFile(join(outputDirectory, name), raw, { flag: "wx" });
      checkFiles.set(name, raw);
    }
    artifacts.push({ name: "worker", role: "worker", platform: "cloudflare-workers", file: "worker.bin",
      build_record_file: "worker-build-record.json", provenance_file: "worker-build-provenance.json",
      sha256: sha256(worker.raw), byte_length: worker.raw.length, build_record_sha256: sha256(worker.recordRaw),
      provenance_sha256: sha256(worker.provenance) });
    if (built.execution) {
      const compiled = recordCompiledInputsExecution({ context: { repository: "tsukasa-u/FUSOU",
        source_sha: eligibility.commit_sha, run_id: runId, run_attempt: runAttempt, workflow_sha: eligibility.coordinator_sha },
        publicBuildInputs: inputs, artifacts, buildRecords: new Map([["app", recordBytes], ["worker", worker.recordRaw]]),
        artifactBytes: new Map([["app", bytes], ["worker", worker.raw]]),
        observations: new Map([["app", checkFiles.get("app-compiled-observations.json")]]),
        rawEvidence: new Map([...checkFiles.values()].map((raw) => [sha256(raw), raw])) });
      for (const [name, raw] of compiled.files) {
        if (!checkFiles.has(name)) await writeFile(join(outputDirectory, name), raw, { flag: "wx" });
        checkFiles.set(name, raw);
      }
    }
  }
  return {
    status: "BUILD_OUTPUTS_GENERATED", tag_status: eligibility.status,
    source_sha: eligibility.commit_sha, public_inputs_sha256: publicInputsSha256,
    worker_version_id: record.active_version_id,
    check_files: [...checkFiles.keys()].sort(),
    artifacts,
    worker_build: { status: worker.status, blockers: worker.blockers ?? [] },
    artifact_sha256: sha256(bytes), provenance_sha256: sha256(Buffer.from(canonicalJson(provenance))),
    artifact_status: "NOT_CHECKED", signature_status: "NOT_CHECKED", deployment_status: "NOT_CHECKED", publication_authorized: false,
    blockers: ["COMPLETE_RELEASE_MANIFEST_AND_INDEPENDENT_CONSUMER_REQUIRED"], deployed: false,
  };
}
