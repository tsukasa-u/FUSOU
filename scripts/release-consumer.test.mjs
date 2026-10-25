import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeReleaseRun, parseConsumerInputs, assembleReleaseManifest } from "./release-consumer.mjs";
import { consumerFixture, recordBytes } from "./release-consumer-fixture.mjs";
import { verifyProducerBuild } from "./release-build-proof.mjs";
import { sha256, parseReleaseManifest, encodeReleaseManifest } from "./release-manifest.mjs";

function updateReport(f) { f.files.set("release-report.json", recordBytes(f.report)); f.sync(); }
test("synthetic complete consumer path derives expectations before reading a candidate; never authorizes publication/deployment", async () => {
  const f = consumerFixture();
  const result = await consumeReleaseRun(f.options, f.dependencies);
  assert.equal(result.status, "RELEASE_ARTIFACTS_VALIDATED");
  assert.equal(result.artifact_status, "RELEASE_ARTIFACTS_VALIDATED");
  assert.equal(result.publication_authorized, false);
  assert.equal(result.deployment_status, "NOT_CHECKED");
  const m = parseReleaseManifest(Buffer.from(result.manifest_base64url, "base64url"));
  assert.equal(m.eligibility.run_id, 30);
  assert.equal(m.artifacts[1].role, "worker");
  assert.equal(m.deployment.status, "NOT_CHECKED");
  f.files.set("release-manifest.json", Buffer.from(result.manifest_base64url, "base64url")); f.sync();
  assert.equal((await consumeReleaseRun(f.options, f.dependencies)).status, "RELEASE_ARTIFACTS_VALIDATED");
});
test("a successful blocked coordinator is not a successful build", async () => {
  const f = consumerFixture();
  f.report.build = { status: "BLOCKED_EXTERNAL_INPUTS" }; updateReport(f);
  const result = await consumeReleaseRun(f.options, f.dependencies);
  assert.equal(result.tag_status, "PRODUCTION_ELIGIBLE");
  assert.equal(result.build_status, "BLOCKED_EXTERNAL_INPUTS");
  assert.equal(result.status, "BLOCKED_EXTERNAL_INPUTS");
  assert.equal(result.artifact_status, "NOT_CHECKED");
});
test("verified partial outputs survive missing Worker and independent external inputs; no placeholder bundle", async () => {
  const f = consumerFixture({ includeWorker: false });
  delete f.options.publicInputsBytes;
  const result = await consumeReleaseRun(f.options, f.dependencies);
  assert.equal(result.build_status, "BUILD_OUTPUTS_VERIFIED");
  assert.equal(result.status, "BLOCKED_IMPLEMENTATION");
  assert.deepEqual(result.blockers, ["ACTUAL_WORKER_BUNDLE_AND_BUILD_RECORD_MISSING", "PINNED_INDEPENDENT_CONSUMER_INPUTS_MISSING"]);
  assert.equal(result.manifest_base64url, undefined);
  const build = verifyProducerBuild({ run: f.run, eligibility: f.eligibility, files: f.files,
    origin: { ...f.metadata(), run_id: 30, workflow_sha: f.run.head_sha } });
  await assert.rejects(assembleReleaseManifest({ eligibility: f.eligibility, run: f.run, build, files: f.files }),
    /ACTUAL_WORKER_BUNDLE/);
  const g = consumerFixture(); delete g.options.publicInputsBytes;
  const external = await consumeReleaseRun(g.options, g.dependencies);
  assert.equal(external.status, "BLOCKED_EXTERNAL_INPUTS");
  assert.deepEqual(external.blockers, ["PINNED_INDEPENDENT_CONSUMER_INPUTS_MISSING"]);
});
test("foreign/failed runs, wrong attempts, non-main producer and missing API values fail closed", async () => {
  for (const mutate of [
    (f) => { f.run.id = 31; }, (f) => { f.run.run_attempt = 2; }, (f) => { f.run.head_branch = "feature"; },
    (f) => { f.run.repository = { id: 8, full_name: "other/repo" }; },
    (f) => { f.run.path = "other.yml"; }, (f) => { f.run.conclusion = "failure"; },
    (f) => { f.run.head_sha = undefined; },
    (f) => { f.github.rest.repos.compareCommitsWithBasehead = async () => ({ data: { status: "behind" } }); },
    (f) => { const original = f.github.rest.actions.getWorkflowRun;
      f.github.rest.actions.getWorkflowRun = async (p) => p.run_id === 10 ?
        { data: { ...(await original(p)).data, head_sha: "c".repeat(40) } } : original(p); },
  ]) {
    const f = consumerFixture(); mutate(f);
    await assert.rejects(consumeReleaseRun(f.options, f.dependencies));
  }
});
test("development reports remain not applicable, never requiring main ancestry for the tag commit", async () => {
  const f = consumerFixture();
  f.eligibility.tag = "fusou-dev-any-branch";
  f.report.tag = f.eligibility.tag; f.report.status = "DEVELOPMENT_VALIDATED"; delete f.report.build; updateReport(f);
  const compare = f.github.rest.repos.compareCommitsWithBasehead;
  f.github.rest.repos.compareCommitsWithBasehead = async (p) => {
    assert.ok(p.basehead.startsWith(f.run.head_sha)); return compare(p);
  };
  const result = await consumeReleaseRun(f.options, f.dependencies);
  assert.equal(result.status, "NOT_APPLICABLE");
  assert.equal(result.tag_status, "DEVELOPMENT_VALIDATED");
  assert.equal(result.publication_authorized, false);
});
test("Production tag ancestry and validation workflow identity are independently rechecked", async () => {
  for (const workflowMismatch of [false, true]) {
    const f = consumerFixture();
    if (workflowMismatch) {
      const get = f.github.rest.repos.getContent;
      f.github.rest.repos.getContent = async (p) => p.path.endsWith("tlsn-tag-validation.yml") &&
        p.ref === f.eligibility.commit_sha ? { data: { type: "file", sha: "c".repeat(40) } } : get(p);
    } else {
      const compare = f.github.rest.repos.compareCommitsWithBasehead;
      f.github.rest.repos.compareCommitsWithBasehead = async (p) => p.basehead.startsWith(f.eligibility.commit_sha) ?
        { data: { status: "behind", merge_base_commit: { sha: "c".repeat(40) } } } : compare(p);
    }
    await assert.rejects(consumeReleaseRun(f.options, f.dependencies));
  }
});
test("missing build state, records, artifacts and tampered raw bytes cannot become validated manifests", async () => {
  for (const mutate of [
    (f) => { delete f.report.build; },
    (f) => { f.report.eligibility_run.run_attempt = 2; },
    (f) => { f.report.validation_run_attempt = 2; },
    (f) => { f.report.build.status = "SUCCESS"; },
    (f) => { f.files.delete("app.bin"); },
    (f) => { f.files.delete("app-record.json"); },
    (f) => { f.files.set("app.bin", Buffer.from("changed")); },
    (f) => { f.files.set("app-record.json", recordBytes({ status: "PASS" })); },
  ]) {
    const f = consumerFixture(); mutate(f); updateReport(f);
    await assert.rejects(consumeReleaseRun(f.options, f.dependencies));
  }
});
test("even rehashed provenance cannot change source/platform/workflow/run/attempt", async () => {
  for (const [key, value] of [["run_id", 31], ["run_attempt", 2], ["workflow_sha", "c".repeat(40)],
    ["source_sha", "c".repeat(40)], ["platform", "windows-x86_64"]]) {
    const f = consumerFixture(), claim = f.report.build.artifacts[0];
    const p = JSON.parse(f.files.get(claim.provenance_file)); p[key] = value;
    const raw = recordBytes(p);
    f.files.set(claim.provenance_file, raw); claim.provenance_sha256 = sha256(raw); updateReport(f);
    await assert.rejects(consumeReleaseRun(f.options, f.dependencies), /provenance/);
  }
});
test("copied detailed records and altered check evidence reject even when their outer hashes are updated", async () => {
  const f = consumerFixture(), claim = f.report.build.artifacts[0];
  const detail = JSON.parse(f.files.get(claim.build_record_file)); detail.run_attempt = 2;
  const detailRaw = recordBytes(detail); f.files.set(claim.build_record_file, detailRaw);
  claim.build_record_sha256 = sha256(detailRaw);
  const provenance = JSON.parse(f.files.get(claim.provenance_file)); provenance.input_record_sha256 = sha256(detailRaw);
  const provenanceRaw = recordBytes(provenance); f.files.set(claim.provenance_file, provenanceRaw);
  claim.provenance_sha256 = sha256(provenanceRaw); updateReport(f);
  await assert.rejects(consumeReleaseRun(f.options, f.dependencies), /provenance/);
  for (const mutate of [
    (g, record) => { record.run_attempt = 2; },
    (g, record) => { record.source_sha = "c".repeat(40); },
    (g, record) => { g.files.set(`evidence-${record.evidence_sha256}.bin`, Buffer.from("changed")); },
  ]) {
    const g = consumerFixture(), name = "check-offline_verification.json", record = JSON.parse(g.files.get(name));
    mutate(g, record); g.files.set(name, recordBytes(record)); g.sync();
    await assert.rejects(consumeReleaseRun(g.options, g.dependencies), /check evidence/);
  }
});
test("original APP record cannot disagree with its rehashed CI wrapper", async () => {
  const f = consumerFixture(), claim = f.report.build.artifacts[0];
  const detail = JSON.parse(f.files.get(claim.build_record_file));
  detail.details.app_source_sha = "c".repeat(40);
  const raw = recordBytes(detail); f.files.set(claim.build_record_file, raw); claim.build_record_sha256 = sha256(raw);
  const provenance = JSON.parse(f.files.get(claim.provenance_file)); provenance.input_record_sha256 = sha256(raw);
  const p = recordBytes(provenance); f.files.set(claim.provenance_file, p); claim.provenance_sha256 = sha256(p);
  updateReport(f);
  await assert.rejects(consumeReleaseRun(f.options, f.dependencies), /detailed APP record/);
});
test("candidate manifest cannot supply its own expected values, Worker version, digest, or deployment state", async () => {
  for (const mutate of [
    (m) => { m.worker.version_id = "22222222-2222-2222-2222-222222222222"; },
    (m) => { m.runtime_config.manifest_sha256 = sha256(Buffer.from("other")); },
    (m) => { m.eligibility.run_id = 31; },
    (m) => { m.artifacts[0].build_run_attempt = 2; },
  ]) {
    const f = consumerFixture(), good = await consumeReleaseRun(f.options, f.dependencies);
    const m = parseReleaseManifest(Buffer.from(good.manifest_base64url, "base64url")); mutate(m);
    f.files.set("release-manifest.json", encodeReleaseManifest(m)); f.sync();
    await assert.rejects(consumeReleaseRun(f.options, f.dependencies), /candidate manifest/);
  }
  const f = consumerFixture();
  f.files.set("release-manifest.json", recordBytes({ deployment: { status: "DEPLOYMENT_VERIFIED" }, expected: {} })); f.sync();
  await assert.rejects(consumeReleaseRun(f.options, f.dependencies), /candidate manifest/);
});
test("independent public pin, required platforms, Worker version and Runtime Config pins reject mismatch", async () => {
  for (const mutate of [
    (f) => { f.options.publicInputsSha256 = sha256(Buffer.from("other")); },
    (f) => { f.payload.source.active_version_id = "22222222-2222-2222-2222-222222222222"; },
    (f) => { f.payload.production_authority_pins.origin_inventory_sha256 = sha256(Buffer.from("other")); },
    (f) => { f.publicInput.required_app_platforms.push("windows-x86_64");
      f.options.publicInputsBytes = recordBytes(f.publicInput); f.options.publicInputsSha256 = sha256(f.options.publicInputsBytes); },
  ]) {
    const f = consumerFixture(); mutate(f);
    await assert.rejects(consumeReleaseRun(f.options, f.dependencies));
  }
  const f = consumerFixture();
  const input = parseConsumerInputs(f.options.publicInputsBytes, f.options.publicInputsSha256, 1234);
  assert.equal(input.verification.policy.now_ms, 1234);
});
test("real crypto adapter never accepts the unsigned synthetic fixture; check PASS claims alone remain blocked", async () => {
  const f = consumerFixture();
  await assert.rejects(consumeReleaseRun(f.options, { transport: f.dependencies.transport }));
  const result = await consumeReleaseRun(f.options, {
    transport: f.dependencies.transport, verifyRuntimeEnvelope: f.dependencies.verifyRuntimeEnvelope,
  });
  assert.equal(result.status, "BLOCKED_IMPLEMENTATION");
  assert.deepEqual(result.blockers, ["INDEPENDENT_RELEASE_CHECK_EXECUTION_NOT_IMPLEMENTED"]);
  const g = consumerFixture(); g.files.delete("check-archive_readback.json"); g.sync();
  assert.equal((await consumeReleaseRun(g.options, g.dependencies)).blockers[0], "REQUIRED_RELEASE_CHECK_RECORDS_MISSING");
});
test("tag movement after download or after check verification is rejected", async () => {
  for (const afterChecks of [false, true]) {
    const f = consumerFixture();
    if (afterChecks) f.dependencies.verifyCheckEvidence = async () => f.moveTag();
    else { const download = f.options.downloadArchive;
      f.options.downloadArchive = async () => { const raw = await download(); f.moveTag(); return raw; }; }
    await assert.rejects(consumeReleaseRun(f.options, f.dependencies), /tag moved/);
  }
});
