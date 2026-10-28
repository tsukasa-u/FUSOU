// Only storage/API/process doubles and explicit source reads; no service or native execution.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { collectReleaseEvidence } from "./release-evidence-producer.mjs";
import { checkFixture } from "./release-check-fixture.mjs";
import { archiveCustomMetadata } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-readback.mjs";
import { captureOfflineExecution, jsonBytes, verifyArchiveReadback } from "./release-checks.mjs";
import { sha256 } from "./release-bytes.mjs";
import { packProducerTransport, decodeReleaseTransport, acquireReleaseTransport } from "./release-transport.mjs";
import { createCrossRunExecutionIntake, assertAuthenticatedCrossRunExecution } from "./release-execution-intake.mjs";
import { EXECUTION_ORIGIN_FILE } from "./release-execution-origin.mjs";
import { consumeReleaseRun } from "./release-consumer.mjs";

async function fixture() {
  const f = await checkFixture(), calls = [];
  const options = { report: f.report, identity: { repository: f.context.repository,
    workflow_ref: `tsukasa-u/FUSOU/${f.run.path}@refs/heads/main`, event_name: "workflow_run", ref: "refs/heads/main",
    run_id: f.run.id, run_attempt: f.run.run_attempt, workflow_sha: f.run.head_sha },
    checkPolicyBytes: f.options.checkPolicyBytes, checkPolicySha256: f.options.checkPolicySha256 };
  const objects = new Map(Object.values(f.checkPolicy.archive.objects).map((identity) => [identity.object_key, {
    version: identity.version_id, customMetadata: archiveCustomMetadata(identity.role, identity),
    arrayBuffer: async () => f.archiveInputs.get(`saved_${identity.role}`),
  }]));
  const dependencies = { archiveBinding: { backendId: "mock-archive", bucket: { get: async (key) => {
    calls.push(key); return objects.get(key);
  } } }, readSourceBytes: async (digest) => {
    const raw = [...f.archiveInputs.values()].find((raw) => sha256(raw) === digest);
    if (!raw) throw Object.assign(new Error("missing saved input"), { code: "ENOENT" });
    return raw;
  }, now: () => 900 };
  return { f, options, dependencies, objects, calls };
}
test("concrete R2-binding collector emits locally captured raw evidence, never native success", async () => {
  const { options, dependencies, calls, f } = await fixture();
  const result = await collectReleaseEvidence(options, dependencies);
  assert.equal(calls.length, 2);
  assert.equal(result.report.checks.archive_readback.status, "LOCAL_CAPTURE_ONLY");
  assert.equal(result.report.checks.archive_readback.retention_status, "NOT_CHECKED");
  assert.equal(result.report.checks.offline_verification.blocker, "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED");
  assert.equal(result.report.checks.offline_verification.status, "BLOCKED_IMPLEMENTATION");
  assert.equal(result.report.checks.offline_verification.identity_model, "AUTHENTICATED_BUILD_PROVENANCE_AND_EXECUTABLE_SHA256");
  assert.deepEqual(result.report.checks.offline_verification.missing_contracts,
    ["TRUSTED_NATIVE_BUILDER_ARTIFACT", "NATIVE_LOCKFILE_AND_RECIPE", "NATIVE_LAUNCHER_EXECUTION_CAPTURE"]);
  assert.deepEqual([...result.executions.keys()], ["archive_readback"]);
  const receipt = JSON.parse(result.executions.get("archive_readback").receipt);
  assert.deepEqual(receipt.output.objects.map((o) => o.version_id), ["presentation-version-1", "result-version-1"]);
  assert.equal(receipt.run_id, f.run.id); assert.equal(receipt.run_attempt, f.run.run_attempt);
  assert.equal(result.report.publication_authorized, false);
  assert.equal(result.report.deployment_status, "NOT_CHECKED");
  assert.equal(result.report.production_acceptance, "BLOCKED");
});
for (const field of ["repository", "workflow_ref", "event_name", "ref", "run_id", "run_attempt", "workflow_sha"]) {
  test(`independent producer runtime identity rejects changed ${field} before any R2 access`, async () => {
    const { options, dependencies, calls } = await fixture();
    options.identity[field] = typeof options.identity[field] === "number" ? options.identity[field] + 1 : "foreign";
    await assert.rejects(collectReleaseEvidence(options, dependencies), /coordinator execution identity/);
    assert.deepEqual(calls, []);
  });
}
test("development eligibility and a release source from a different pinned policy never invoke the collector", async () => {
  const { options, dependencies, calls } = await fixture();
  const report = { ...options.report, status: "DEVELOPMENT_VALIDATED" };
  await assert.rejects(collectReleaseEvidence({ ...options, report }, dependencies), /execution identity/);
  await assert.rejects(collectReleaseEvidence({ ...options, report: { ...options.report, commit_sha: "f".repeat(40) } }, dependencies),
    /policy\/release source/);
  assert.deepEqual(calls, []);
});
for (const missing of ["policy", "pin", "binding", "source reader", "saved bytes"]) {
  test(`missing ${missing} remains explicitly blocked and cannot mint native or archive evidence`, async () => {
    const { options, dependencies } = await fixture();
    if (missing === "policy") delete options.checkPolicyBytes;
    if (missing === "pin") delete options.checkPolicySha256;
    if (missing === "binding") delete dependencies.archiveBinding;
    if (missing === "source reader") delete dependencies.readSourceBytes;
    if (missing === "saved bytes") dependencies.readSourceBytes = async () => {
      throw Object.assign(new Error("missing saved input"), { code: "ENOENT" });
    };
    const result = await collectReleaseEvidence(options, dependencies);
    assert.match(result.report.checks.archive_readback.status, /^BLOCKED_/);
    if (missing === "binding") assert.equal(result.report.checks.archive_readback.blocker, "ACTIONS_R2_BINDING_TRANSPORT_NOT_REGISTERED");
    assert.equal(result.executions.size, 0);
    assert.equal(result.report.checks.offline_verification.status, "BLOCKED_IMPLEMENTATION");
  });
}
test("unregistered credentials or a self-asserted backend marker cannot stand in for a real R2 binding", async () => {
  const { options, dependencies, calls } = await fixture();
  dependencies.archiveBinding = { backendId: "mock-archive", bucket: { authenticated: true } };
  await assert.rejects(collectReleaseEvidence(options, dependencies), /R2 binding\/backend/);
  dependencies.archiveBinding = { backendId: "foreign", bucket: { get: async () => assert.fail("must not read") } };
  await assert.rejects(collectReleaseEvidence(options, dependencies), /R2 binding\/backend/);
  assert.deepEqual(calls, []);
});
for (const field of ["version", "fusou_source_sha", "fusou_session_id", "fusou_job_id", "fusou_verification_attempt_id", "fusou_binding_id"]) {
  test(`independently pinned catalog rejects R2 observed ${field} substitution`, async () => {
    const { options, dependencies, objects } = await fixture();
    const object = objects.values().next().value;
    if (field === "version") object.version = "overwritten-generation";
    else object.customMetadata[field] = field === "fusou_binding_id" ? "f".repeat(43) : "foreign";
    await assert.rejects(collectReleaseEvidence(options, dependencies), /catalog\/generation|identity is incomplete/);
  });
}
test("missing generation or object and corrupt raw readback are rejected, not echoed from saved bytes", async () => {
  for (const mutation of ["missing generation", "missing object", "raw bytes"]) {
    const { options, dependencies, objects } = await fixture();
    const [key, object] = objects.entries().next().value;
    if (mutation === "missing generation") delete object.version;
    if (mutation === "missing object") objects.delete(key);
    if (mutation === "raw bytes") object.arrayBuffer = async () => Buffer.from("substituted archive");
    await assert.rejects(collectReleaseEvidence(options, dependencies), /object\/version|readback bytes mismatch/);
  }
});
test("saved input corruption, invalid digest and invalid object key fail before accessing storage", async () => {
  for (const mutation of ["saved bytes", "policy digest", "object key"]) {
    const { options, dependencies, f, calls } = await fixture();
    if (mutation === "saved bytes") dependencies.readSourceBytes = async () => Buffer.from("substituted source");
    if (mutation === "policy digest") options.checkPolicySha256 = "f".repeat(43);
    if (mutation === "object key") {
      f.checkPolicy.archive.objects.result.object_key = "unrelated/private-object";
      options.checkPolicyBytes = jsonBytes(f.checkPolicy); options.checkPolicySha256 = sha256(options.checkPolicyBytes);
    }
    await assert.rejects(collectReleaseEvidence(options, dependencies), /raw bytes\/digest|policy digest|archive.*policy/);
    assert.deepEqual(calls, []);
  }
});
test("unexpected storage or filesystem errors surface explicitly, not as success or missing configuration", async () => {
  const { options, dependencies } = await fixture();
  dependencies.archiveBinding.bucket.get = async () => { throw new Error("storage denied"); };
  await assert.rejects(collectReleaseEvidence(options, dependencies), /storage denied/);
  dependencies.readSourceBytes = async () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); };
  await assert.rejects(collectReleaseEvidence(options, dependencies), /permission denied/);
});
test("producer packaging and API-authenticated intake accept the same captured R2 bytes; full consumer stays blocked without native", async () => {
  const { options, dependencies, f } = await fixture(), production = await collectReleaseEvidence(options, dependencies);
  f.report.evidence_production = production.report;
  f.report.build.check_files = [...f.files.keys()].filter((name) => /^evidence-/.test(name) ||
    ["check-locked_dependencies.json", "check-compiled_inputs.json"].includes(name));
  const buildSnapshot = jsonBytes(f.report.build);
  const transport = await packProducerTransport(f.report, async (name) => f.files.get(name), { capturedChecks: production.executions });
  assert.deepEqual(jsonBytes(f.report.build), buildSnapshot);
  const decoded = decodeReleaseTransport(transport), origin = JSON.parse(decoded.get(EXECUTION_ORIGIN_FILE));
  assert.deepEqual(Object.keys(origin.checks), ["archive_readback"]);
  assert.equal(decoded.has("check-offline_verification.json"), false);
  f.files.clear(); for (const [name, raw] of decoded) f.files.set(name, raw); f.sync();
  const downloaded = await acquireReleaseTransport({ github: f.github, run: f.run,
    downloadArchive: f.options.downloadArchive, ...f.dependencies.transport });
  const intake = createCrossRunExecutionIntake({ github: f.github, run: f.run, trustedSha: f.options.trustedSha,
    downloaded, eligibility: f.eligibility, publicBuildInputsSha256: f.options.publicBuildInputsSha256,
    checkPolicySha256: f.options.checkPolicySha256 });
  const captured = production.executions.get("archive_readback"), receipt = JSON.parse(captured.receipt);
  const inputs = new Map(Object.entries(receipt.inputs).map(([name, d]) => [name, downloaded.files.get(`evidence-${d.sha256}.bin`)]));
  const execution = { check: "archive_readback", context: f.context, receipt, inputs, build: { ...f.build, report: f.report } };
  verifyArchiveReadback({ inputs, receipt, policy: f.checkPolicy.archive, nowMs: 1000 });
  assertAuthenticatedCrossRunExecution(await intake.authenticate(execution), execution);
  for (const checkPolicySha256 of [undefined, "f".repeat(43)]) {
    const wrong = createCrossRunExecutionIntake({ github: f.github, run: f.run, trustedSha: f.options.trustedSha,
      downloaded, eligibility: f.eligibility, publicBuildInputsSha256: f.options.publicBuildInputsSha256, checkPolicySha256 });
    await assert.rejects(wrong.authenticate(execution), /CHECK_POLICY_PIN_MISSING|policy\/context binding/);
  }
  const result = await consumeReleaseRun(f.options, { transport: f.dependencies.transport,
    verifyRuntimeEnvelope: f.dependencies.verifyRuntimeEnvelope });
  assert.match(result.status, /^BLOCKED_/);
  assert.equal(result.status, "BLOCKED_IMPLEMENTATION");
  assert.deepEqual(result.blockers, ["FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED"]);
  assert.notEqual(result.artifact_status, "RELEASE_ARTIFACTS_VALIDATED");
  assert.equal(result.publication_authorized, false);
  assert.equal(result.deployment_status, "NOT_CHECKED");
  assert.equal(result.production_acceptance, "BLOCKED");
  f.report.evidence_production.checks.offline_verification = { status: "PASS", authenticated: true };
  f.files.set("release-report.json", jsonBytes(f.report)); f.sync();
  const selfAsserted = await consumeReleaseRun(f.options, { transport: f.dependencies.transport,
    verifyRuntimeEnvelope: f.dependencies.verifyRuntimeEnvelope });
  assert.deepEqual(selfAsserted.blockers, ["REQUIRED_RELEASE_CHECK_RECORDS_MISSING"]);
  assert.notEqual(selfAsserted.artifact_status, "RELEASE_ARTIFACTS_VALIDATED");
  assert.equal(selfAsserted.publication_authorized, false);
  assert.equal(selfAsserted.production_acceptance, "BLOCKED");
});
test("data-only PASS cannot be attached as a producer capture without its private capability", async () => {
  const { f } = await fixture();
  const forged = { ...f.archiveExecution, executionProof: { authenticated: true } };
  await assert.rejects(packProducerTransport(f.report, async (name) => f.files.get(name),
    { capturedChecks: new Map([["archive_readback", forged]]) }), /unauthenticated/);
});
test("altered capture bytes and executable-looking extra files cannot be smuggled into the producer package", async () => {
  for (const mutation of ["raw bytes", "extra file"]) {
    const { f } = await fixture(), execution = { ...f.archiveExecution, files: new Map(f.archiveExecution.files) };
    if (mutation === "raw bytes") {
      const name = [...execution.files.keys()].find((name) => name.startsWith("evidence-"));
      execution.files.set(name, Buffer.from("substituted capture"));
    } else execution.files.set("unexpected-module.mjs", Buffer.from("throw new Error('must not execute');"));
    await assert.rejects(packProducerTransport(f.report, async (name) => f.files.get(name),
      { capturedChecks: new Map([["archive_readback", execution]]) }), /captured execution record\/proof|raw evidence filename\/hash/);
  }
});
test("archive capture cannot replace locked or compiled builder proofs or another receipt", async () => {
  const { f } = await fixture();
  for (const key of ["locked_dependencies", "compiled_inputs", "offline_verification"]) {
    await assert.rejects(packProducerTransport(f.report, async (name) => f.files.get(name),
      { capturedChecks: new Map([[key, f.archiveExecution]]) }), /captured execution record\/proof/);
  }
});
test("independent policy mixing two jobs is rejected before any binding access", async () => {
  const { options, dependencies, calls, f } = await fixture();
  f.checkPolicy.archive.objects.presentation.job_id = "other-job";
  options.checkPolicyBytes = jsonBytes(f.checkPolicy); options.checkPolicySha256 = sha256(options.checkPolicyBytes);
  await assert.rejects(collectReleaseEvidence(options, dependencies), /archive.*policy/);
  assert.deepEqual(calls, []);
});
test("an empty binary cannot become a native executable identity merely by pinning its digest", async () => {
  const { f } = await fixture(), inputs = new Map(f.nativeInputs), policy = structuredClone(f.checkPolicy.offline);
  const empty = Buffer.alloc(0); inputs.set("verifier_executable", empty);
  policy.executable_sha256 = sha256(empty); policy.input_sha256.verifier_executable = sha256(empty);
  await assert.rejects(captureOfflineExecution({ context: f.context, inputs, policy, resourceBudget: f.offlineResourceBudget },
    { mockExecutor: async () => assert.fail("must not execute") }), /pinned native executable bytes\/version/);
});
for (const missing of ["executable_sha256", "executable_version", "input_sha256"]) {
  test(`native capture rejects missing independent ${missing} before invoking even a mock executor`, async () => {
    const { f } = await fixture(), policy = structuredClone(f.checkPolicy.offline);
    delete policy[missing];
    await assert.rejects(captureOfflineExecution({ context: f.context, inputs: f.nativeInputs, policy, resourceBudget: f.offlineResourceBudget },
      { mockExecutor: async () => assert.fail("must not execute") }), /pinned native executable|input digest inventory/);
  });
}
for (const mutation of ["result", "target", "arguments", "failed exit"]) {
  test(`native capture rejects ${mutation} as an authenticated successful report`, async () => {
    const { f } = await fixture();
    const operation = captureOfflineExecution({ context: f.context, inputs: f.nativeInputs, policy: f.checkPolicy.offline, resourceBudget: f.offlineResourceBudget }, {
      mockExecutor: async (request) => {
        const result = await f.executor(request), report = JSON.parse(result.stdout);
        if (mutation === "result") report.status = "REJECTED";
        if (mutation === "target") report.derived.server_identity = "other.example.test";
        if (mutation === "arguments") result.argv = ["--self-asserted"];
        if (mutation === "failed exit") result.exit_code = 1;
        result.stdout = jsonBytes(report); return result;
      },
    });
    if (mutation === "failed exit") {
      const result = await operation;
      assert.equal(result.executionProof, undefined); assert.equal(JSON.parse(result.record).status, "FAIL");
    } else await assert.rejects(operation, /native verification|native execution/);
  });
}
test("formal CLI source supports the existing evidence arguments but defines no executable version observation", async () => {
  const source = await readFile(new URL("../packages/FUSOU-TLSN-VERIFIER/src/bin/verify_fusou_tlsn_evidence.rs", import.meta.url), "utf8");
  for (const flag of ["--bundle", "--trusted-notary-registry", "--origin-inventory", "--target-approval", "--trust-anchor-der"]) {
    assert.ok(source.includes(`"${flag}"`));
  }
  assert.doesNotMatch(source, /"--version"|env!\("CARGO_PKG_VERSION"\)|build_identity/);
});
