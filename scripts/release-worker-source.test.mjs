import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { workerSourceFixture, fixtureToolchain, wasmFixture } from "./release-check-fixture.mjs";
import { readReleaseSource, inspectWorkerSource, inspectWorkerSourceAt, generateUnsignedWorkerBuild,
  encodeUnsignedWorkerPackage, WORKER_ROOT } from "./release-worker-source.mjs";
const sourceSha = "a".repeat(40);
function setup() {
  const sourceFiles = workerSourceFixture();
  const args = { sourceFiles, sourceSha, context: { repository: "tsukasa-u/FUSOU", source_sha: sourceSha,
    run_id: 30, run_attempt: 1, workflow_sha: "b".repeat(40) }, toolchain: { ...fixtureToolchain },
  workerReference: { worker_git_commit_sha: sourceSha, active_version_id: "11111111-1111-1111-1111-111111111111", script_name: "fusou-verifier" },
  executionAllowed: true };
  const wasm = wasmFixture(sourceSha);
  const executor = async ({ source, toolchain, context }) => ({ context: { ...context }, source_inputs_sha256: source.source_inputs_sha256,
    toolchain: { ...toolchain }, completed_commands: structuredClone(source.commands), exit_code: 0,
    modules: wasm.modules, wasmArtifacts: wasm.artifacts, wasmToolchain: wasm.toolchain, wasmProvenanceRaw: wasm.raw,
    wasmSourceInputs: wasm.provenance.source_inputs });
  return { args, executor };
}
test("source presence is not runtime semantics or a generated bundle", () => {
  const f = setup(), result = inspectWorkerSource(f.args.sourceFiles, sourceSha);
  assert.equal(result.status, "SOURCE_INPUTS_PRESENT");
  assert.equal(result.runtime_semantics, "NOT_CHECKED"); assert.equal(result.bundle_status, "NOT_CHECKED");
  f.args.sourceFiles.delete(`${WORKER_ROOT}/src/index.ts`);
  assert.deepEqual(inspectWorkerSource(f.args.sourceFiles, sourceSha).missing_paths, [`${WORKER_ROOT}/src/index.ts`]);
});
test("missing source and absent execution authorization never call the executor", async () => {
  const f = setup(); let called = false;
  const executeRecipe = async () => { called = true; throw new Error("must not execute"); };
  assert.equal((await generateUnsignedWorkerBuild({ ...f.args, executionAllowed: false }, { executeRecipe })).status,
    "BLOCKED_EXECUTION_AUTHORIZATION");
  f.args.sourceFiles.delete(`${WORKER_ROOT}/src/index.ts`);
  assert.equal((await generateUnsignedWorkerBuild(f.args, { executeRecipe })).status, "BLOCKED_IMPLEMENTATION");
  assert.equal(called, false);
});
test("exact-SHA API source requires a matching Git blob and separates 404 from API failure", async () => {
  const raw = Buffer.from("source"), blob = createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
  const github = { rest: { repos: { getContent: async ({ ref, path }) => {
    assert.equal(ref, sourceSha); assert.equal(path, "package.json");
    return { data: { type: "file", encoding: "base64", content: raw.toString("base64"), sha: blob } };
  } } } };
  assert.deepEqual(await readReleaseSource(github, sourceSha, "package.json"), raw);
  await assert.rejects(readReleaseSource(github, sourceSha, "unapproved.file"), /allowlist/);
  github.rest.repos.getContent = async () => ({ data: { type: "file", encoding: "base64", content: "dGFtcGVy", sha: blob } });
  await assert.rejects(readReleaseSource(github, sourceSha, "package.json"), /blob/);
  github.rest.repos.getContent = async () => { throw Object.assign(new Error("missing"), { status: 404 }); };
  assert.equal((await inspectWorkerSourceAt(github, sourceSha)).status, "BLOCKED_IMPLEMENTATION");
  github.rest.repos.getContent = async () => { throw Object.assign(new Error("API denied"), { status: 403 }); };
  await assert.rejects(inspectWorkerSourceAt(github, sourceSha), /API denied/);
});
test("injected recipe outputs bind source, toolchain, commands, raw modules and context without deployment authority", async () => {
  const f = setup(), result = await generateUnsignedWorkerBuild(f.args, { executeRecipe: f.executor });
  assert.equal(result.status, "BUILD_OUTPUTS_GENERATED");
  const record = JSON.parse(result.recordRaw), provenance = JSON.parse(result.provenance);
  assert.equal(record.source_sha, sourceSha); assert.equal(record.run_attempt, 1);
  assert.equal(record.worker_version_id, f.args.workerReference.active_version_id);
  assert.equal(provenance.artifact_sha256, record.artifact_sha256);
  assert.equal(result.publication_authorized, false); assert.equal(result.deployment_status, "NOT_CHECKED");
  await assert.rejects(generateUnsignedWorkerBuild(f.args), /executor/);
  assert.throws(() => encodeUnsignedWorkerPackage(new Map([["index.js", Buffer.from("placeholder")]])), /JS and WASM/);
});
for (const mutation of ["source", "toolchain", "commands", "exit", "version", "run", "mutation"]) {
  test(`Worker recipe rejects ${mutation} mismatch`, async () => {
    const f = setup();
    if (mutation === "version") f.args.workerReference.worker_git_commit_sha = "c".repeat(40);
    if (mutation === "run") f.args.context.run_attempt = 0;
    await assert.rejects(generateUnsignedWorkerBuild(f.args, { executeRecipe: async (input) => {
      const output = await f.executor(input);
      if (mutation === "source") output.source_inputs_sha256 = "0".repeat(64);
      if (mutation === "toolchain") output.toolchain.rust = "wrong";
      if (mutation === "commands") output.completed_commands.pop();
      if (mutation === "exit") output.exit_code = 1;
      if (mutation === "mutation") f.args.sourceFiles.set("pnpm-lock.yaml", Buffer.from("changed after checkout"));
      return output;
    } }), /mismatch|pins/);
  });
}
