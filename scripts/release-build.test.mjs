import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateReleaseBuild } from "./release-build.mjs";
import { sha256 } from "./release-manifest.mjs";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { LOCK_PATHS } from "./release-checks.mjs";
import { checkFixture, wasmFixture } from "./release-check-fixture.mjs";

function fixture(root) {
  const eligibility = { schema_version: 2, status: "PRODUCTION_ELIGIBLE", commit_sha: "a".repeat(40),
    tag: "fusou-v0.6.0", coordinator_sha: "b".repeat(40), validation_run_id: 1,
    validation_run_attempt: 1, validation_workflow_blob_sha: "c".repeat(40) };
  const inputs = { schema_version: 1, app_source_sha: eligibility.commit_sha, worker_reference: { cloudflare: { version_id: "synthetic-version" } },
    public_app_inputs: {}, runtime_config_bootstrap: {}, rust_toolchain: "1.98.1", platform: "linux-x86_64" };
  const publicInputsBytes = Buffer.from(canonicalJson(inputs));
  const bytes = Buffer.from("synthetic artifact, not executable");
  let builds = 0, checks = 0;
  const options = { eligibility, publicInputsBytes, publicInputsSha256: sha256(publicInputsBytes),
    workspace: root, outputDirectory: join(root, "outputs"), runId: 30, runAttempt: 1 };
  const deps = {
    recheckEligibility: async () => { checks++; return structuredClone(eligibility); },
    buildApp: async () => { builds++; return {
      artifactPath: join(root, "synthetic.bin"), record: {
        schema_version: 3, scope: "fusou-tlsn-app-operator-build-record",
        app_source_sha: eligibility.commit_sha, worker_source_sha: eligibility.commit_sha,
        active_version_id: inputs.worker_reference.cloudflare.version_id,
        artifact: { sha256: sha256(bytes), byte_length: bytes.length },
        compiled_input_comparison: "VERIFIED", runtime_config_bootstrap_comparison: "VERIFIED",
        public_app_configuration_comparison: "VERIFIED", authority_status: "UNVERIFIED",
      },
    }; },
    readArtifact: async () => bytes,
  };
  return { options, deps, counts: () => ({ builds, checks }) };
}
test("missing public input pin blocks before source checkout, tool execution or artifact creation", async () => {
  const f = fixture("/unused-synthetic-path");
  delete f.options.publicInputsSha256;
  const result = await generateReleaseBuild(f.options, f.deps);
  assert.equal(result.status, "BLOCKED_EXTERNAL_INPUTS");
  assert.equal(result.tag_status, "PRODUCTION_ELIGIBLE");
  assert.deepEqual(f.counts(), { builds: 0, checks: 0 });
});
test("combined APP/Worker producer binds both raw records and WASM sidecars without inventing archive or offline execution", async () => {
  const f = await checkFixture(), root = await mkdtemp(join(tmpdir(), "fusou-combined-build-"));
  try {
    const app = f.report.build.artifacts.find((a) => a.role === "app"), worker = f.report.build.artifacts.find((a) => a.role === "worker");
    const receipt = JSON.parse(f.compiled.receipt);
    const reports = receipt.output.app_reports.app;
    const locked = JSON.parse(f.evidenceBytes.get(f.records.locked_dependencies.evidence_sha256));
    const bytes = Buffer.from(canonicalJson(f.publicBuildInputs));
    const result = await generateReleaseBuild({ eligibility: f.eligibility, publicInputsBytes: bytes, publicInputsSha256: sha256(bytes),
      workspace: root, outputDirectory: join(root, "outputs"), runId: f.context.run_id, runAttempt: f.context.run_attempt,
      workerBuildAuthorized: true }, {
      recheckEligibility: async () => structuredClone(f.eligibility),
      buildApp: async () => ({ artifactPath: join(root, "synthetic-app"), record: JSON.parse(f.files.get(app.build_record_file)).details,
        execution: { sourceFiles: new Map(LOCK_PATHS.map((path) => [path, f.sourceFiles.get(path)])),
          pnpmVersion: locked.output.pnpm_version, commands: locked.output.commands,
          reports: Object.fromEntries(["worker", "public"].map((name) => [name,
            { ...reports[name], executable_sha256: app.sha256, raw: f.evidenceBytes.get(reports[name].stdout_sha256) }])) } }),
      readArtifact: async () => f.files.get(app.file),
      buildWorker: async ({ executionAllowed, runId, runAttempt }) => {
        assert.equal(executionAllowed, true); assert.equal(runId, f.context.run_id); assert.equal(runAttempt, f.context.run_attempt);
        return { status: "BUILD_OUTPUTS_GENERATED", raw: f.files.get(worker.file), recordRaw: f.files.get(worker.build_record_file),
          provenance: f.files.get(worker.provenance_file), wasmArtifacts: wasmFixture(f.context.source_sha).artifacts };
      },
    });
    assert.deepEqual(result.artifacts.map((a) => a.role), ["app", "worker"]);
    assert.equal(result.artifact_status, "NOT_CHECKED"); assert.equal(result.deployed, false);
    assert.equal(result.publication_authorized, false);
    for (const claim of result.artifacts) {
      assert.equal(sha256(await readFile(join(root, "outputs", claim.file))), claim.sha256);
      assert.equal(sha256(await readFile(join(root, "outputs", claim.build_record_file))), claim.build_record_sha256);
    }
    assert.ok(result.check_files.includes("check-compiled_inputs.json"));
    assert.equal(result.check_files.includes("check-archive_readback.json"), false);
    assert.equal(result.check_files.includes("check-offline_verification.json"), false);
  } finally { await rm(root, { recursive: true }); }
});
test("synthetic build writes exact observed bytes and provenance, never declares release/deployment complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "fusou-release-build-"));
  try {
    const f = fixture(root);
    const result = await generateReleaseBuild(f.options, f.deps);
    assert.equal(result.status, "BUILD_OUTPUTS_GENERATED");
    assert.equal(result.artifact_status, "NOT_CHECKED");
    assert.equal(result.deployed, false);
    assert.deepEqual(f.counts(), { builds: 1, checks: 3 });
    assert.deepEqual(result.worker_build, { status: "BLOCKED_EXTERNAL_INPUTS", blockers: ["WORKER_BUILD_EXECUTION_NOT_AUTHORIZED"] });
    assert.equal(sha256(await readFile(join(root, "outputs/app-linux-x86_64.bin"))), result.artifact_sha256);
    assert.equal(sha256(await readFile(join(root, "outputs/release-build-provenance.json"))), result.provenance_sha256);
  } finally { await rm(root, { recursive: true }); }
});
test("invalid eligibility, pins, source, run identity and changed tag fail before build", async () => {
  for (const mutate of [
    (f) => { f.options.eligibility.status = "DEVELOPMENT_VALIDATED"; },
    (f) => { f.options.publicInputsSha256 = "bad"; },
    (f) => { f.options.publicInputsBytes = Buffer.from("{}"); },
    (f) => { f.options.runId = undefined; },
    (f) => { f.deps.recheckEligibility = async () => ({ ...f.options.eligibility, commit_sha: "d".repeat(40) }); },
  ]) {
    const f = fixture("/unused-synthetic-path"); mutate(f);
    await assert.rejects(generateReleaseBuild(f.options, f.deps));
    assert.equal(f.counts().builds, 0);
  }
});
test("artifact corruption, Worker mismatch, escaped output and post-build tag movement reject", async () => {
  for (const mutate of [
    (f) => { f.deps.readArtifact = async () => Buffer.from("changed"); },
    (f) => { const build = f.deps.buildApp; f.deps.buildApp = async () => {
      const result = await build(); result.record.active_version_id = "other"; return result;
    }; },
    (f) => { const build = f.deps.buildApp; f.deps.buildApp = async () => {
      const result = await build(); result.artifactPath = "/outside.bin"; return result;
    }; },
    (f) => { f.deps.recheckEligibility = async () => f.counts().builds ?
      { ...f.options.eligibility, tag: "fusou-v0.7.0" } : f.options.eligibility; },
  ]) {
    const f = fixture("/unused-synthetic-path"); mutate(f);
    await assert.rejects(generateReleaseBuild(f.options, f.deps));
  }
});
test("injected process observations produce exact sidecars without inventing full compiled-input success", async () => {
  const root = await mkdtemp(join(tmpdir(), "fusou-release-observations-"));
  try {
    const f = fixture(root), build = f.deps.buildApp;
    const locks = new Map(LOCK_PATHS.map((path) => [path, Buffer.from(`synthetic source ${path}`)]));
    locks.set("package.json", Buffer.from('{"packageManager":"pnpm@10.0.0"}'));
    const stdout = Buffer.from('{"synthetic":"raw stdout"}\n');
    f.deps.buildApp = async () => {
      const result = await build();
      result.record.cargo_lock_sha256 = sha256(locks.get(LOCK_PATHS[1]));
      return { ...result, execution: { sourceFiles: locks, pnpmVersion: "10.0.0",
        commands: [{ argv: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"], exit_code: 0 },
          { argv: ["pnpm", "exec", "tauri", "build", "--ci", "--no-bundle", "--features", "tlsn-production,custom-protocol", "--", "--locked"], exit_code: 0 }],
        reports: { worker: { raw: stdout, argv: ["--tlsn-compiled-worker-entry"], exit_code: 0,
          stdout_sha256: sha256(stdout), executable_sha256: result.record.artifact.sha256 } } } };
    };
    const result = await generateReleaseBuild(f.options, f.deps);
    assert.ok(result.check_files.includes("check-locked_dependencies.json"));
    assert.equal(result.check_files.includes("check-compiled_inputs.json"), false);
    const observation = JSON.parse(await readFile(join(root, "outputs/app-compiled-observations.json")));
    assert.equal(observation.run_id, f.options.runId); assert.equal(observation.run_attempt, f.options.runAttempt);
    assert.equal(observation.reports.worker.stdout_sha256, sha256(stdout));
    assert.deepEqual(await readFile(join(root, `outputs/evidence-${sha256(stdout)}.bin`)), stdout);
    assert.equal(result.artifact_status, "NOT_CHECKED");
  } finally { await rm(root, { recursive: true }); }
});
