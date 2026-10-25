import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { open, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { sha256, MAX_RELEASE_RECORD_BYTES } from "./release-manifest.mjs";
import { assertAppBuildRecordBinding } from "./release-build-proof.mjs";

export async function readRegularFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error("release input/output must be a regular file");
    return await file.readFile();
  } finally {
    await file.close();
  }
}

async function buildUnsignedApp({ inputs, eligibility, workspace, sourceToken }) {
  const {
    buildApprovedApp, assertBuildReference, runtimeConfigBootstrapInputs,
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
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], source);
  const referenceBytes = Buffer.from(canonicalJson(reference));
  await writeFile(referencePath, referenceBytes, { flag: "wx", mode: 0o600 });
  return buildApprovedApp({
    referencePath, expectedReferenceSha256: sha256(referenceBytes),
    expectedWorkerSha: eligibility.commit_sha, expectedAppSha: eligibility.commit_sha,
    outputDirectory: join(root, "app-build"), repositoryDirectory: source,
    toolchain: inputs.rust_toolchain, environment: { ...toolEnv, ...bootstrap },
  }, {
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
}

export async function generateReleaseBuild({
  eligibility, publicInputsBytes, publicInputsSha256, workspace, outputDirectory,
  runId, runAttempt, sourceToken,
}, { recheckEligibility, buildApp = buildUnsignedApp, readArtifact = readRegularFile } = {}) {
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
  return {
    status: "BUILD_OUTPUTS_GENERATED", tag_status: eligibility.status,
    source_sha: eligibility.commit_sha, public_inputs_sha256: publicInputsSha256,
    worker_version_id: record.active_version_id,
    artifacts: [{
      name: "app", role: "app", platform: inputs.platform, file: `app-${inputs.platform}.bin`,
      build_record_file: "app-build-record.json", provenance_file: "release-build-provenance.json",
      sha256: sha256(bytes), byte_length: bytes.length, build_record_sha256: sha256(recordBytes),
      provenance_sha256: sha256(Buffer.from(canonicalJson(provenance))),
    }],
    artifact_sha256: sha256(bytes), provenance_sha256: sha256(Buffer.from(canonicalJson(provenance))),
    artifact_status: "NOT_CHECKED", signature_status: "NOT_CHECKED", deployment_status: "NOT_CHECKED",
    blockers: ["COMPLETE_RELEASE_MANIFEST_AND_INDEPENDENT_CONSUMER_REQUIRED"], deployed: false,
  };
}
