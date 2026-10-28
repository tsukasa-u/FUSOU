import test from "node:test";
import assert from "node:assert/strict";
import { checkFixture } from "./release-check-fixture.mjs";
import { verifyReleaseChecks, recordCheckExecution, captureArchiveReadback, verifyArchiveReadback,
  captureOfflineExecution, verifyOfflineExecution, offlineLayout, jsonBytes, LOCK_PATHS } from "./release-checks.mjs";
import { consumeReleaseRun } from "./release-consumer.mjs";
import { sha256 } from "./release-bytes.mjs";
import { verifyProducerBuild } from "./release-build-proof.mjs";

function install(f, check, execution) {
  const record = JSON.parse(execution.record); f.args.records[check] = record;
  for (const [name, raw] of execution.files) {
    f.files.set(name, raw);
    if (name.startsWith("evidence-")) f.args.evidenceBytes.set(sha256(raw), raw);
  }
}
function replaceWorker(f, change) {
  const claim = f.report.build.artifacts.find((a) => a.role === "worker");
  const wrapper = JSON.parse(f.files.get(claim.build_record_file));
  const raw = change(wrapper.details, f.files.get(claim.file)) ?? f.files.get(claim.file);
  wrapper.artifact_sha256 = sha256(raw); wrapper.byte_length = raw.length;
  const record = jsonBytes(wrapper), provenance = JSON.parse(f.files.get(claim.provenance_file));
  Object.assign(provenance, { artifact_sha256: sha256(raw), input_record_sha256: sha256(record) });
  const provenanceRaw = jsonBytes(provenance);
  Object.assign(claim, { sha256: sha256(raw), byte_length: raw.length,
    build_record_sha256: sha256(record), provenance_sha256: sha256(provenanceRaw) });
  f.files.set(claim.file, raw); f.files.set(claim.build_record_file, record); f.files.set(claim.provenance_file, provenanceRaw);
  f.files.set("release-report.json", jsonBytes(f.report)); f.sync();
  const receipt = JSON.parse(f.compiled.receipt);
  const inputs = new Map(Object.entries(receipt.inputs).map(([name, value]) => [name, f.args.evidenceBytes.get(value.sha256)]));
  inputs.set("record_worker", record);
  install(f, "compiled_inputs", recordCheckExecution("compiled_inputs", f.context, inputs, receipt.output));
  f.args.build = verifyProducerBuild({ run: f.run, eligibility: f.eligibility, files: f.files,
    origin: { ...f.metadata(), run_id: f.run.id, workflow_sha: f.run.head_sha } });
  for (const [hash, bytes] of f.args.build.evidenceBytes) f.args.evidenceBytes.set(hash, bytes);
}
test("four independent adapters accept complete mock execution data, not real TLSN evidence", async () => {
  const f = await checkFixture(), outcome = await verifyReleaseChecks(f.args, f.config);
  assert.deepEqual(Object.keys(outcome.checks), ["locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"]);
  for (const result of Object.values(outcome.checks)) assert.equal(result.status, "VERIFIED");
});
test("valid-looking native stdout alone is not authenticated execution", async () => {
  const f = await checkFixture();
  await assert.rejects(verifyReleaseChecks(f.args, { ...f.config, authenticateOfflineExecution: undefined }), (error) => {
    assert.equal(error.status, "BLOCKED_IMPLEMENTATION");
    assert.equal(error.check_results.offline_verification.blocker, "AUTHENTICATED_OFFLINE_EXECUTION_INTAKE_NOT_CONFIGURED"); return true;
  });
  await assert.rejects(verifyReleaseChecks(f.args, { ...f.config, authenticateOfflineExecution: async () => ({ status: "AUTHENTICATED" }) }),
    /unauthenticated/);
  const other = await captureOfflineExecution({ context: { ...f.context, run_attempt: 2 }, inputs: f.nativeInputs,
    policy: f.checkPolicy.offline }, { execute: f.executor });
  await assert.rejects(verifyReleaseChecks(f.args, { ...f.config, authenticateOfflineExecution: async () => other.executionProof }),
    /mismatched native/);
});
test("archive JSON metadata does not authenticate a backend read or survive proof serialization", async () => {
  const f = await checkFixture();
  await assert.rejects(verifyReleaseChecks(f.args, { ...f.config, authenticateArchiveReadback: undefined }), (error) => {
    assert.equal(error.check_results.archive_readback.blocker, "AUTHENTICATED_ARCHIVE_READBACK_INTAKE_NOT_CONFIGURED");
    assert.equal(error.check_results.offline_verification.blocker, "VERIFIED_ARCHIVE_READBACK_REQUIRED"); return true;
  });
  await assert.rejects(verifyReleaseChecks(f.args, { ...f.config,
    authenticateArchiveReadback: async () => structuredClone(f.archiveExecution.executionProof) }), /unauthenticated.*archive/);
});
test("default consumer integrates all adapters but never authorizes publication or deployment", async () => {
  const f = await checkFixture(), dependencies = { ...f.dependencies }; delete dependencies.verifyCheckEvidence;
  const result = await consumeReleaseRun(f.options, dependencies);
  assert.equal(result.artifact_status, "RELEASE_ARTIFACTS_VALIDATED");
  assert.equal(result.publication_authorized, false);
  assert.equal(result.deployment_status, "NOT_CHECKED");
});
test("default consumer preserves safe check results when external Runtime Config inputs are absent", async () => {
  const f = await checkFixture(), dependencies = { ...f.dependencies }; delete dependencies.verifyCheckEvidence;
  const result = await consumeReleaseRun({ ...f.options, publicInputsBytes: undefined }, dependencies);
  assert.equal(result.status, "BLOCKED_EXTERNAL_INPUTS");
  assert.equal(result.check_results.locked_dependencies.status, "VERIFIED");
  assert.equal(result.check_results.archive_readback.status, "VERIFIED");
  assert.equal(result.check_results.offline_verification.status, "BLOCKED_EXTERNAL_INPUTS");
  assert.equal(result.publication_authorized, false);
});
test("PASS-only record and missing raw input cannot substitute for execution evidence", async () => {
  const f = await checkFixture();
  f.args.evidenceBytes.delete(JSON.parse(f.offlineExecution.receipt).inputs.stdout.sha256);
  await assert.rejects(verifyReleaseChecks(f.args, f.config), /required raw check input/);
});
for (const field of ["source_sha", "run_id", "run_attempt", "workflow_sha", "repository"]) {
  test(`rehashing a foreign execution receipt does not authorize ${field}`, async () => {
    const f = await checkFixture(), raw = JSON.parse(f.offlineExecution.receipt);
    raw[field] = typeof raw[field] === "number" ? raw[field] + 1 : "c".repeat(40);
    const bytes = jsonBytes(raw); f.args.evidenceBytes.set(sha256(bytes), bytes);
    f.args.records.offline_verification.evidence_sha256 = sha256(bytes);
    await assert.rejects(verifyReleaseChecks(f.args, f.config), /identity/);
  });
}
for (const mutation of ["lockfile", "commands", "pnpm"]) {
  test(`locked dependencies reject ${mutation} mismatch despite PASS receipt`, async () => {
    const f = await checkFixture(), old = JSON.parse(f.files.get(`evidence-${f.records.locked_dependencies.evidence_sha256}.bin`));
    const inputs = new Map(LOCK_PATHS.map((path) => [path, f.sourceFiles.get(path)]));
    if (mutation === "lockfile") inputs.set(LOCK_PATHS[0], Buffer.from("foreign lock"));
    if (mutation === "commands") old.output.commands.pop();
    if (mutation === "pnpm") old.output.pnpm_version = "0.0.1";
    install(f, "locked_dependencies", recordCheckExecution("locked_dependencies", f.context, inputs, old.output));
    await assert.rejects(verifyReleaseChecks(f.args, f.config), /inventory|commands|toolchain/);
  });
}
test("missing external check policy keeps locked execution result but blocks final release", async () => {
  const f = await checkFixture();
  await assert.rejects(verifyReleaseChecks(f.args, { ...f.config, checkPolicyBytes: undefined, checkPolicySha256: undefined }), (error) => {
    assert.equal(error.check_results.locked_dependencies.status, "VERIFIED");
    assert.equal(error.check_results.compiled_inputs.status, "BLOCKED_EXTERNAL_INPUTS");
    assert.equal(error.check_results.archive_readback.status, "BLOCKED_EXTERNAL_INPUTS"); return true;
  });
});
test("APP-only outputs cannot produce compiled_inputs PASS receipt", async () => {
  const f = await checkFixture();
  f.build.artifacts.pop();
  await assert.rejects(verifyReleaseChecks(f.args, f.config), /complete|Worker/);
});
test("independently pinned Worker toolchain and source snapshot reject mismatches", async () => {
  const f = await checkFixture(), altered = structuredClone(f.checkPolicy);
  altered.worker_toolchain.rust = "foreign";
  const raw = jsonBytes(altered);
  await assert.rejects(verifyReleaseChecks(f.args, { ...f.config, checkPolicyBytes: raw, checkPolicySha256: sha256(raw) }), /toolchain/);
  f.sourceFiles.set("pnpm-lock.yaml", Buffer.from("changed exact-SHA source"));
  await assert.rejects(verifyReleaseChecks(f.args, f.config), /inventory/);
});
for (const mutation of ["version", "source", "commands", "import_closure", "dummy_bundle", "empty_wasm"]) {
  test(`valid outer build hashes do not hide Worker ${mutation} mismatch`, async () => {
    const f = await checkFixture();
    replaceWorker(f, (details, bytes) => {
      if (mutation === "version") details.version_reference.active_version_id = "other";
      if (mutation === "source") details.source_inputs_sha256 = "0".repeat(43);
      if (mutation === "commands") details.commands.pop();
      if (mutation === "import_closure") details.import_closure.entrypoint = "other.ts";
      if (mutation === "dummy_bundle") return jsonBytes({ dummy: true });
      if (mutation === "empty_wasm") {
        const pkg = JSON.parse(bytes);
        pkg.modules["verifier.wasm"] = { bytes: "", byte_length: 0, sha256: sha256(Buffer.alloc(0)) };
        return jsonBytes(pkg);
      }
    });
    await assert.rejects(verifyReleaseChecks(f.args, f.config), /Worker|module/);
  });
}
test("a missing exact-SHA runtime entrypoint remains an implementation blocker", async () => {
  const f = await checkFixture();
  f.sourceFiles.delete("packages/FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts");
  await assert.rejects(verifyReleaseChecks(f.args, f.config), (error) => {
    assert.equal(error.status, "BLOCKED_IMPLEMENTATION");
    assert.equal(error.check_results.compiled_inputs.blocker, "WORKER_SOURCE_INCOMPLETE_AT_RELEASE_SHA"); return true;
  });
});
test("independent WASM toolchain and source pins are mandatory and cannot be replaced by build self-declarations", async () => {
  const f = await checkFixture();
  for (const field of ["worker_wasm_toolchain", "worker_wasm_source_inputs"]) {
    const policy = structuredClone(f.checkPolicy); delete policy[field];
    const raw = jsonBytes(policy);
    await assert.rejects(verifyReleaseChecks(f.args, { ...f.config, checkPolicyBytes: raw, checkPolicySha256: sha256(raw) }), (error) => {
      assert.equal(error.check_results.compiled_inputs.status, "BLOCKED_EXTERNAL_INPUTS");
      assert.equal(error.check_results.locked_dependencies.status, "VERIFIED");
      return true;
    });
  }
  const policy = structuredClone(f.checkPolicy); policy.worker_wasm_source_inputs[0].sha256 = "z".repeat(43);
  const raw = jsonBytes(policy);
  await assert.rejects(verifyReleaseChecks(f.args, { ...f.config, checkPolicyBytes: raw, checkPolicySha256: sha256(raw) }), /source input fingerprint/);
});
test("missing generated WASM raw evidence and foreign archive release source fail independently of PASS labels", async () => {
  const f = await checkFixture(), receipt = JSON.parse(f.compiled.receipt);
  f.args.evidenceBytes.delete(receipt.inputs["wasm_fusou_tlsn_verifier_bg.wasm"].sha256);
  await assert.rejects(verifyReleaseChecks(f.args, f.config), /required raw check input/);
  const other = await checkFixture(), policy = structuredClone(other.checkPolicy); policy.archive.source_sha = "c".repeat(40);
  const raw = jsonBytes(policy);
  await assert.rejects(verifyReleaseChecks(other.args, { ...other.config, checkPolicyBytes: raw, checkPolicySha256: sha256(raw) }), /archive policy\/release source/);
});
test("APP actual stdout arguments and independently pinned policy release identity are enforced", async () => {
  const f = await checkFixture(), receipt = JSON.parse(f.compiled.receipt);
  receipt.output.app_reports.app.worker.argv = ["--version"];
  const inputs = new Map(Object.entries(receipt.inputs).map(([name, d]) => [name, f.args.evidenceBytes.get(d.sha256)]));
  install(f, "compiled_inputs", recordCheckExecution("compiled_inputs", f.context, inputs, receipt.output));
  await assert.rejects(verifyReleaseChecks(f.args, f.config), /stdout\/command/);
  const other = await checkFixture(), policy = jsonBytes({ ...other.checkPolicy, source_sha: "c".repeat(40) });
  await assert.rejects(verifyReleaseChecks(other.args, { ...other.config, checkPolicyBytes: policy, checkPolicySha256: sha256(policy) }), /policy repository\/source/);
});
test("archive capture calls a backend and rejects changed stored bytes", async () => {
  const f = await checkFixture(); let calls = 0;
  await assert.rejects(captureArchiveReadback({ context: f.context, expected: f.checkPolicy.archive, sourceBytes: f.saved,
    backend: { get: async (identity) => { calls++; return { ...identity, bytes: Buffer.from("wrong readback") }; } } }), /readback/);
  assert.equal(calls, 1);
  await assert.rejects(captureArchiveReadback({ context: f.context, expected: f.checkPolicy.archive, sourceBytes: f.saved }), /ARCHIVE_BACKEND/);
});
test("archive capture rejects foreign observed session metadata instead of copying the requested identity", async () => {
  const f = await checkFixture();
  await assert.rejects(captureArchiveReadback({ context: f.context, expected: f.checkPolicy.archive, sourceBytes: f.saved,
    backend: { get: async (identity) => ({ ...identity, session_id: "foreign", bytes: f.saved.get(identity.role) }) } }), /readback/);
});
for (const mutation of ["bytes", "role", "session", "object", "version", "stale"]) {
  test(`archive verification rejects ${mutation} readback`, async () => {
    const f = await checkFixture(), receipt = JSON.parse(f.archiveExecution.receipt);
    const raw = new Map(f.archiveInputs);
    const observed = receipt.output.objects.find((object) => object.role === "presentation");
    if (mutation === "bytes") raw.set("readback_presentation", Buffer.from("mutated"));
    if (mutation === "role") observed.role = "result";
    if (mutation === "session") observed.session_id = "other";
    if (mutation === "object") observed.object_key = "other";
    if (mutation === "version") observed.version_id = "other";
    assert.throws(() => verifyArchiveReadback({ inputs: raw, receipt, policy: f.checkPolicy.archive,
      nowMs: mutation === "stale" ? 2000 : 1000 }), /archive/);
  });
}
test("native executor is opt-in, receives all formal CLI files, and rejected output cannot emit PASS", async () => {
  const f = await checkFixture(), args = { context: f.context, inputs: f.nativeInputs, policy: f.checkPolicy.offline };
  await assert.rejects(captureOfflineExecution(args), /OFFLINE_EXECUTOR/);
  let filesSeen;
  await captureOfflineExecution(args, { execute: async (request) => { filesSeen = request.files; return f.executor(request); } });
  assert.equal(filesSeen.size, f.nativeInputs.size - 1);
  assert.equal(filesSeen.has("verifier_executable.input"), false);
  await assert.rejects(captureOfflineExecution(args, { execute: async (request) => ({
    ...await f.executor(request), stdout: jsonBytes({ status: "REJECTED" }),
  }) }), /result\/trust/);
  const failure = await captureOfflineExecution(args, { execute: async (request) => ({
    ...await f.executor(request), stdout: jsonBytes({ status: "REJECTED" }), exit_code: 1,
  }) });
  assert.equal(JSON.parse(failure.receipt).status, "FAIL");
});
for (const mutation of ["argv", "files", "inputs", "executable"]) {
  test(`native process capture rejects ${mutation} mutation`, async () => {
    const f = await checkFixture();
    await assert.rejects(captureOfflineExecution({ context: f.context, inputs: f.nativeInputs, policy: f.checkPolicy.offline },
      { execute: async (request) => {
        if (mutation === "argv") request.argv[0] = "--foreign";
        if (mutation === "files") request.files.set("bundle.input", Buffer.from("foreign"));
        if (mutation === "inputs") request.inputs.set("bundle", Buffer.from("foreign"));
        const result = await f.executor(request);
        if (mutation === "executable") result.executable_sha256 = "0".repeat(64);
        return result;
      } }), /execution source/);
  });
}
test("offline verifier needs matching archived bytes, signed source/session and trusted derived identity", async () => {
  const f = await checkFixture(), receipt = JSON.parse(f.offlineExecution.receipt);
  const args = { inputs: new Map([...f.nativeInputs, ["stdout", jsonBytes(f.nativeReport)]]), receipt,
    policy: f.checkPolicy.offline, archiveInputs: f.archiveInputs, archivePolicy: f.checkPolicy.archive, context: f.context };
  verifyOfflineExecution(args);
  assert.throws(() => verifyOfflineExecution({ ...args, context: { ...f.context, source_sha: "f".repeat(40) } }), /source/);
  assert.throws(() => verifyOfflineExecution({ ...args, archivePolicy: { ...f.checkPolicy.archive, session_id: "other" } }), /session/);
  assert.throws(() => verifyOfflineExecution({ ...args, archiveInputs: new Map([...f.archiveInputs,
    ["readback_presentation", Buffer.from("other")]]) }), /same archive/);
  assert.throws(() => verifyOfflineExecution({ ...args, policy: { ...args.policy, expected_derived: { server_identity: "other.example.test" } } }), /identity/);
});
test("missing executable pin, repinned path traversal and Notary identity mismatch never pass", async () => {
  const f = await checkFixture();
  await assert.rejects(captureOfflineExecution({ context: f.context, inputs: f.nativeInputs,
    policy: { ...f.checkPolicy.offline, executable_sha256: null } }, { execute: f.executor }), /pinned native executable/);
  const raw = JSON.parse(f.nativeInputs.get("bundle")); raw.artifacts.presentation.path = "../escape";
  const inputs = new Map(f.nativeInputs); inputs.set("bundle", jsonBytes(raw));
  const policy = { ...f.checkPolicy.offline, input_sha256: { ...f.checkPolicy.offline.input_sha256, bundle: sha256(inputs.get("bundle")) } };
  await assert.rejects(captureOfflineExecution({ context: f.context, inputs, policy }, { execute: f.executor }), /artifact\/path/);
  const other = await checkFixture(), checkPolicy = structuredClone(other.checkPolicy);
  checkPolicy.offline.expected_derived.notary_key_id = "other";
  const bytes = jsonBytes(checkPolicy);
  await assert.rejects(verifyReleaseChecks(other.args, { ...other.config, checkPolicyBytes: bytes, checkPolicySha256: sha256(bytes) }), /Notary/);
});
function repinnedBundle(f, change) {
  const bundle = JSON.parse(f.nativeInputs.get("bundle"));
  for (const artifact of Object.values(bundle.artifacts)) {
    artifact.artifact_sha256 = artifact.artifact_sha256 ?? artifact.sha256;
    delete artifact.sha256;
  }
  change(bundle);
  const inputs = new Map(f.nativeInputs); inputs.set("bundle", jsonBytes(bundle));
  const policy = { ...f.checkPolicy.offline,
    input_sha256: { ...f.checkPolicy.offline.input_sha256, bundle: sha256(inputs.get("bundle")) } };
  return { inputs, policy };
}
test("offline layout uses the Rust manifest artifact_sha256 contract, not receipt sha256 descriptors", async () => {
  const f = await checkFixture(), args = repinnedBundle(f, () => {});
  const layout = offlineLayout(args.policy, args.inputs);
  assert.deepEqual(layout.files.get("presentation.artifact"), f.nativeInputs.get("bundle_artifact_presentation"));
  const capture = await captureOfflineExecution({ context: f.context, ...args }, { execute: f.executor });
  assert.equal(JSON.parse(capture.receipt).status, "PASS");
});
test("a legacy sha256 alias cannot substitute for or override the Rust manifest hash", async () => {
  const f = await checkFixture();
  for (const kind of ["missing", "corrupt"]) {
    const args = repinnedBundle(f, (bundle) => {
      for (const artifact of Object.values(bundle.artifacts)) artifact.sha256 = artifact.artifact_sha256;
      const artifact = bundle.artifacts.presentation;
      if (kind === "missing") delete artifact.artifact_sha256;
      else artifact.artifact_sha256 = "0".repeat(43);
    });
    assert.throws(() => offlineLayout(args.policy, args.inputs), /artifact\/path binding/);
  }
});
test("offline paths cannot be both an input file and another input's parent directory", async () => {
  const f = await checkFixture();
  const withLegacyAliases = (bundle) => {
    for (const artifact of Object.values(bundle.artifacts)) artifact.sha256 = artifact.artifact_sha256;
  };
  const control = repinnedBundle(f, withLegacyAliases);
  assert.doesNotThrow(() => offlineLayout(control.policy, control.inputs));
  for (const path of ["bundle.input", "result.artifact", "bundle.input/child", "session.artifact/child", "nested", "nested/child"]) {
    const args = repinnedBundle(f, (bundle) => {
      withLegacyAliases(bundle);
      bundle.artifacts.presentation.path = path;
      if (path === "nested") bundle.artifacts.result.path = "nested/child";
      if (path === "nested/child") bundle.artifacts.result.path = "nested";
    });
    assert.throws(() => offlineLayout(args.policy, args.inputs), /artifact\/path binding/);
  }
});
test("offline layout preserves raw inputs across shared directories and descriptor reordering", async () => {
  const f = await checkFixture(), args = repinnedBundle(f, (bundle) => {
    bundle.artifacts.presentation.path = "shared/nested/presentation";
    bundle.artifacts.result.path = "shared/nested/result";
    bundle.artifacts = Object.fromEntries(Object.entries(bundle.artifacts).reverse());
  });
  const layout = offlineLayout(args.policy, args.inputs);
  assert.deepEqual(layout.files.get("shared/nested/presentation"), f.nativeInputs.get("bundle_artifact_presentation"));
  assert.deepEqual(layout.files.get("shared/nested/result"), f.nativeInputs.get("bundle_artifact_result"));
});
