// Mock authenticated GitHub, storage and process captures only; no external or native execution.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { checkFixture } from "./release-check-fixture.mjs";
import { acquireReleaseTransport, packProducerTransport, decodeReleaseTransport } from "./release-transport.mjs";
import { createCrossRunExecutionIntake, assertAuthenticatedCrossRunExecution, EXECUTION_IMPLEMENTATION_PATHS } from "./release-execution-intake.mjs";
import { EXECUTION_ORIGIN_FILE, createProducerExecutionOrigin } from "./release-execution-origin.mjs";
import { consumeReleaseRun } from "./release-consumer.mjs";
import { captureOfflineExecution, jsonBytes, resolvePinnedArchiveObject } from "./release-checks.mjs";

const remoteDependencies = (f) => {
  const dependencies = { ...f.dependencies };
  delete dependencies.verifyCheckEvidence;
  delete dependencies.authenticateArchiveReadback;
  delete dependencies.authenticateOfflineExecution;
  return dependencies;
};
test("the independently fixed capture TCB includes its literal local JavaScript import closure", async () => {
  const paths = new Set(EXECUTION_IMPLEMENTATION_PATHS);
  for (const path of paths) {
    if (!path.endsWith(".mjs")) continue;
    assert.ok(!path.startsWith("../") && !path.startsWith("/"));
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.[^"']+\.mjs)["']/g)) {
      const dependency = posix.normalize(posix.join(posix.dirname(path), match[1]));
      assert.ok(paths.has(dependency), `${path} imports capture implementation missing from the independent TCB: ${dependency}`);
    }
  }
});
async function intakeFor(f, changes = {}) {
  const downloaded = await acquireReleaseTransport({ github: f.github, run: f.run,
    downloadArchive: f.options.downloadArchive, ...f.dependencies.transport });
  return { downloaded, intake: createCrossRunExecutionIntake({ github: f.github, run: f.run,
    trustedSha: f.options.trustedSha, eligibility: f.eligibility,
    publicBuildInputsSha256: f.options.publicBuildInputsSha256, downloaded, ...changes }) };
}
function executionFor(f, check = "locked_dependencies") {
  const record = f.records[check], receipt = JSON.parse(f.evidenceBytes.get(record.evidence_sha256));
  return { check, receipt, inputs: new Map(Object.entries(receipt.inputs).map(([name, d]) => [name, f.evidenceBytes.get(d.sha256)])),
    context: f.context, build: f.build };
}
function changeOrigin(f, mutate) {
  const origin = JSON.parse(f.files.get(EXECUTION_ORIGIN_FILE));
  mutate(origin); f.files.set(EXECUTION_ORIGIN_FILE, jsonBytes(origin)); f.sync();
}
test("mock GitHub-authenticated cross-run evidence validates all four checks without local capture callbacks", async () => {
  const f = await checkFixture(), result = await consumeReleaseRun(f.options, remoteDependencies(f));
  assert.equal(result.artifact_status, "RELEASE_ARTIFACTS_VALIDATED");
  for (const check of Object.values(result.check_results)) assert.equal(check.authentication, "GITHUB_ACTIONS_ARTIFACT");
  assert.equal(result.publication_authorized, false);
  assert.equal(result.deployment_status, "NOT_CHECKED");
  assert.equal(result.production_acceptance, "BLOCKED");
  assert.equal(result.check_results.offline_verification.verification.independent_verifier_result, "AUTHENTICATED_NATIVE_EXECUTION_REPORT");
  assert.equal(result.check_results.offline_verification.verification.consumer_native_crypto_reexecution, "NOT_CHECKED");
});
test("bare origin JSON, claimed authentication and serialized proof cannot replace independently acquired GitHub transport", async () => {
  const f = await checkFixture(), { downloaded } = await intakeFor(f);
  for (const authenticationProof of [{ authenticated: true }, structuredClone(downloaded.authenticationProof), undefined]) {
    const intake = createCrossRunExecutionIntake({ github: f.github, run: f.run, trustedSha: f.options.trustedSha,
      eligibility: f.eligibility, publicBuildInputsSha256: f.options.publicBuildInputsSha256,
      downloaded: { ...downloaded, authenticationProof } });
    await assert.rejects(intake.authenticate(executionFor(f)), /unauthenticated.*transport/);
  }
});
test("missing capture-origin evidence blocks a green authenticated producer run", async () => {
  const f = await checkFixture(); f.files.delete(EXECUTION_ORIGIN_FILE); f.sync();
  const result = await consumeReleaseRun(f.options, remoteDependencies(f));
  assert.equal(result.status, "BLOCKED_IMPLEMENTATION");
  assert.equal(result.artifact_status, "NOT_CHECKED");
  assert.ok(result.blockers.some((s) => s.includes("CROSS_RUN_EXECUTION_ORIGIN_MISSING")));
});
test("an authenticated archive still cannot turn unissued native capture claims into execution evidence", async () => {
  const f = await checkFixture();
  changeOrigin(f, (origin) => { delete origin.checks.offline_verification; origin.unattested_checks.push("offline_verification"); });
  const result = await consumeReleaseRun(f.options, remoteDependencies(f));
  assert.equal(result.status, "BLOCKED_IMPLEMENTATION");
  assert.equal(result.check_results.offline_verification.blocker, "UNATTESTED_OFFLINE_VERIFICATION_EXECUTION");
  assert.equal(result.artifact_status, "NOT_CHECKED");
});
for (const field of ["kind", "repository", "workflow_path", "workflow_sha", "run_id", "run_attempt"]) {
  test(`independent GitHub run identity rejects forged issuer ${field}`, async () => {
    const f = await checkFixture();
    changeOrigin(f, (origin) => { origin.issuer[field] = typeof origin.issuer[field] === "number" ? 99 : "untrusted"; });
    const { intake } = await intakeFor(f);
    await assert.rejects(intake.authenticate(executionFor(f)), /issuer\/subject/);
  });
}
for (const field of ["source_sha", "tag", "validation_run_id", "validation_run_attempt", "public_build_inputs_sha256", "report_sha256"]) {
  test(`API eligibility and independent input pin reject forged release subject ${field}`, async () => {
    const f = await checkFixture();
    changeOrigin(f, (origin) => { origin.subject[field] = typeof origin.subject[field] === "number" ? 99 : "untrusted"; });
    const { intake } = await intakeFor(f);
    await assert.rejects(intake.authenticate(executionFor(f)), /release subject/);
  });
}
test("an unregistered detached signature scheme or arbitrary authenticated marker is not a new trust root", async () => {
  const f = await checkFixture();
  changeOrigin(f, (origin) => { origin.signature = "invalid-signature"; origin.authenticated = true; });
  const { intake } = await intakeFor(f);
  await assert.rejects(intake.authenticate(executionFor(f)), /origin contract/);
});
test("changing raw bytes after authenticated download invalidates the transport capability", async () => {
  const f = await checkFixture(), { intake, downloaded } = await intakeFor(f);
  downloaded.files.get("app.bin")[0] ^= 1;
  await assert.rejects(intake.authenticate(executionFor(f)), /changed.*transport/);
});
test("rehashing a changed receipt in an authenticated archive cannot reuse an old execution-origin binding", async () => {
  const f = await checkFixture();
  changeOrigin(f, (origin) => { origin.checks.locked_dependencies.receipt_sha256 = "z".repeat(43); });
  const { intake } = await intakeFor(f);
  await assert.rejects(intake.authenticate(executionFor(f)), /exact record\/receipt/);
});
test("producer implementation must match independent trusted-main blobs, not just its own workflow path", async () => {
  const f = await checkFixture(), getContent = f.github.rest.repos.getContent;
  f.github.rest.repos.getContent = async (p) => p.path === "scripts/release-execution-origin.mjs" && p.ref === f.run.head_sha ?
    { data: { type: "file", sha: "d".repeat(40) } } : getContent(p);
  const { intake } = await intakeFor(f, { trustedSha: "c".repeat(40) });
  await assert.rejects(intake.authenticate(executionFor(f)), /untrusted execution producer implementation/);
});
test("proof serialization, cross-check reuse and another attempt cannot reuse authenticated execution", async () => {
  const f = await checkFixture(), { intake } = await intakeFor(f), execution = executionFor(f);
  const proof = await intake.authenticate(execution);
  assertAuthenticatedCrossRunExecution(proof, execution);
  assert.throws(() => assertAuthenticatedCrossRunExecution(structuredClone(proof), execution), /unauthenticated/);
  assert.throws(() => assertAuthenticatedCrossRunExecution(proof, executionFor(f, "compiled_inputs")), /mismatched/);
  await assert.rejects(intake.authenticate({ ...execution, context: { ...f.context, run_attempt: 2 } }), /target context/);
});
test("a newly started producer attempt or replaced artifact is rejected on final independent recheck", async () => {
  const f = await checkFixture(), { intake } = await intakeFor(f);
  await intake.authenticate(executionFor(f));
  f.github.rest.actions.getWorkflowRun = async () => ({ data: { ...f.run, run_attempt: 2 } });
  await assert.rejects(intake.recheck(), /attempt\/status/);
  const other = await checkFixture(), next = (await intakeFor(other)).intake;
  await next.authenticate(executionFor(other));
  other.github.rest.actions.getArtifact = async () => ({ data: { ...other.metadata(), digest: `sha256:${"0".repeat(64)}` } });
  await assert.rejects(next.recheck(), /artifact changed/);
});
test("an authentic old capture still fails the consumer's independently supplied freshness window", async () => {
  const f = await checkFixture();
  await assert.rejects(consumeReleaseRun({ ...f.options, nowMs: 2000 }, remoteDependencies(f)), /archive.*freshness/);
});
test("producer refuses fake local build/archive/native proofs, even when JSON records say PASS", async () => {
  const f = await checkFixture(), inputs = { report: f.report, files: f.files, context: f.context };
  const unissued = JSON.parse(createProducerExecutionOrigin(inputs));
  assert.deepEqual(unissued.checks, {});
  assert.equal(unissued.unattested_checks.length, 4);
  assert.throws(() => createProducerExecutionOrigin({ ...inputs, executionProofs: { archive_readback: { authenticated: true } } }), /unauthenticated/);
  Object.defineProperty(f.report.build, "executionProof", { value: {} });
  assert.throws(() => createProducerExecutionOrigin(inputs), /local build execution/);
});
test("producer can carry actual in-process capture proofs across packaging, but never serializes those capabilities", async () => {
  const f = await checkFixture();
  f.report.build.check_files = [...f.files.keys()].filter((name) => /^(?:check-|evidence-)/.test(name));
  const raw = await packProducerTransport(f.report, async (name) => f.files.get(name), {
    executionProofs: { archive_readback: f.archiveExecution.executionProof, offline_verification: f.offlineExecution.executionProof },
  });
  const origin = JSON.parse(decodeReleaseTransport(raw).get(EXECUTION_ORIGIN_FILE));
  assert.deepEqual(Object.keys(origin.checks).sort(), ["archive_readback", "offline_verification"]);
  assert.deepEqual(origin.unattested_checks, ["locked_dependencies", "compiled_inputs"]);
});
for (const mutation of ["missing measurement", "before bytes", "after bytes", "version"]) {
  test(`native capture rejects ${mutation} against independent executable bytes/hash/version`, async () => {
    const f = await checkFixture();
    await assert.rejects(captureOfflineExecution({ context: f.context, inputs: f.nativeInputs, policy: f.checkPolicy.offline },
      { execute: async (request) => {
        const result = await f.executor(request);
        if (mutation === "missing measurement") delete result.executable_before;
        if (mutation === "before bytes") result.executable_before = Buffer.from("foreign binary");
        if (mutation === "after bytes") result.executable_after = Buffer.from("mutated binary");
        if (mutation === "version") result.executable_version = "foreign-version";
        return result;
      } }), /native execution source/);
  });
}
for (const field of ["session_id", "job_id", "verification_attempt_id", "binding_id", "version_id"]) {
  test(`independently pinned capture registry rejects observed archive ${field} from another target`, async () => {
    const f = await checkFixture(), observed = JSON.parse(f.archiveExecution.receipt).output.objects.find((o) => o.role === "result");
    assert.equal(resolvePinnedArchiveObject(f.checkPolicy.archive, "result", observed).capture_id, f.checkPolicy.archive.capture_id);
    observed[field] = "foreign";
    assert.throws(() => resolvePinnedArchiveObject(f.checkPolicy.archive, "result", observed), /independent capture resolver/);
  });
}
