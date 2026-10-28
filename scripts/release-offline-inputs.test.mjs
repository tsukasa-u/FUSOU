import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { checkFixture, offlineResourceFixtureBudget } from "./release-check-fixture.mjs";
import { captureOfflineExecution, jsonBytes, verifyOfflineExecution, verifyReleaseChecks } from "./release-checks.mjs";
import { sha256 } from "./release-bytes.mjs";
import { parseNativeInspectionJson, withNativeInspectionBudgetSync } from "./release-native-resources.mjs";
import { parseReleaseRecord } from "./release-build-proof.mjs";

const request = (f, changes = {}) => ({ context: f.context, inputs: f.nativeInputs,
  policy: f.checkPolicy.offline, resourceBudget: offlineResourceFixtureBudget(), ...changes });
const mock = (mockExecutor) => ({ mockExecutor });
function manifest(f, text) {
  const inputs = new Map(f.nativeInputs); inputs.set("bundle", Buffer.from(text));
  return request(f, { inputs, policy: { ...f.checkPolicy.offline, input_sha256: {
    ...f.checkPolicy.offline.input_sha256, bundle: sha256(inputs.get("bundle")),
  } } });
}
test("offline admission requires a resource budget before calling the executor", async () => {
  const f = await checkFixture(); let calls = 0;
  await assert.rejects(captureOfflineExecution(request(f, { resourceBudget: undefined }),
    mock(async (r) => { calls++; return f.executor(r); })), /RESOURCE_BUDGET_MISSING/);
  assert.equal(calls, 0);
});
test("unregistered execute callbacks cannot enable formal offline execution", async () => {
  const f = await checkFixture(); let calls = 0;
  const execute = async (r) => { calls++; return f.executor(r); };
  for (const options of [{ execute }, { execute, mockExecutor: execute }]) {
    await assert.rejects(captureOfflineExecution(request(f), options), /OFFLINE_EXECUTOR/);
  }
  assert.equal(calls, 0);
});
test("offline capture requires stderr bytes, including an explicit empty capture", async () => {
  const f = await checkFixture();
  await assert.rejects(captureOfflineExecution(request(f), mock(async (r) => {
    const result = await f.executor(r); delete result.stderr; return result;
  })), /native execution source\/result property/);
  const inputs = new Map([...f.nativeInputs, ["stdout", jsonBytes(f.nativeReport)]]), receipt = JSON.parse(f.offlineExecution.receipt);
  assert.throws(() => verifyOfflineExecution({ inputs, receipt, policy: f.checkPolicy.offline, archiveInputs: f.archiveInputs,
    archivePolicy: f.checkPolicy.archive, context: f.context, resourceBudget: f.offlineResourceBudget }), /offline actual stderr/);
});
test("offline callback maps never share bytes with each other or the caller", async () => {
  const f = await checkFixture();
  await captureOfflineExecution(request(f), mock(async (r) => {
    const raw = r.inputs.get("bundle"), saved = Buffer.from(raw);
    raw.fill(32);
    assert.deepEqual(r.files.get("bundle.input"), saved);
    assert.deepEqual(f.nativeInputs.get("bundle"), saved);
    raw.set(saved);
    return f.executor(r);
  }));
});
test("offline callback argv cannot be changed and restored", async () => {
  const f = await checkFixture();
  await captureOfflineExecution(request(f), mock(async (r) => {
    assert.throws(() => { r.argv[0] = "--foreign"; }, TypeError);
    return f.executor(r);
  }));
});
for (const kind of ["top", "nested", "escaped"]) {
  test(`offline manifest rejects ${kind} duplicate JSON keys before callback`, async () => {
    const f = await checkFixture(), raw = f.nativeInputs.get("bundle").toString();
    const text = kind === "top" ? `{"capture_id":"foreign",${raw.slice(1)}` :
      kind === "escaped" ? `{"capture_\\u0069d":"foreign",${raw.slice(1)}` :
        raw.replace('"artifact_sha256":', '"artifact_sha256":"foreign","artifact_sha256":');
    let calls = 0;
    await assert.rejects(captureOfflineExecution(manifest(f, text), mock(async (r) => {
      calls++; return f.executor(r);
    })), /duplicate|DUPLICATE/);
    assert.equal(calls, 0);
  });
}
test("offline stdout rejects duplicate trust decisions", async () => {
  const f = await checkFixture();
  await assert.rejects(captureOfflineExecution(request(f), mock(async (r) => ({
    ...await f.executor(r), stdout: Buffer.from(`{"status":"REJECTED",${jsonBytes(f.nativeReport).toString().slice(1)}`),
  }))), /duplicate|DUPLICATE/);
});
test("offline resource denial occurs before callback allocation", async () => {
  const f = await checkFixture(); let calls = 0;
  await assert.rejects(captureOfflineExecution(request(f, { resourceBudget: offlineResourceFixtureBudget({ max_bytes: 1 }) }),
    mock(async (r) => { calls++; return f.executor(r); })), /RESOURCE_BYTES_EXCEEDED/);
  assert.equal(calls, 0);
});
test("offline snapshots precede the first async turn and ignore caller A-B-A changes", async () => {
  const f = await checkFixture(), args = request(f), original = Buffer.from(args.inputs.get("bundle"));
  const expectedContext = structuredClone(args.context);
  const savedOptions = structuredClone(args.policy.options);
  const operation = captureOfflineExecution(args, mock(async (r) => {
    args.inputs.get("bundle").fill(32); args.context.run_attempt++;
    args.policy.options["server-identity"] = "foreign.example.test";
    await setImmediate();
    assert.deepEqual(r.inputs.get("bundle"), original);
    args.inputs.get("bundle").set(original);
    Object.assign(args.context, expectedContext); Object.assign(args.policy.options, savedOptions);
    return f.executor(r);
  }));
  const captured = await operation;
  assert.equal(JSON.parse(captured.receipt).run_attempt, expectedContext.run_attempt);
  assert.equal(JSON.parse(captured.receipt).output.argv.includes("foreign.example.test"), false);
});
test("late callback aliases cannot modify captured inputs, receipt, stdout or stderr", async () => {
  const f = await checkFixture(); let retained;
  const captured = await captureOfflineExecution(request(f), mock(async (r) => {
    retained = { r, result: { ...await f.executor(r), stderr: Buffer.from("diagnostic") } };
    return retained.result;
  }));
  const expected = new Map([...captured.files].map(([key, raw]) => [key, Buffer.from(raw)]));
  retained.r.inputs.get("bundle").fill(0);
  retained.r.files.get("bundle.input").fill(1);
  retained.result.stdout.fill(2); retained.result.stderr.fill(3);
  retained.r.inputs.clear(); retained.r.files.clear();
  assert.deepEqual(captured.files, expected);
});
test("offline callback copies and emitted records have isolated backing ArrayBuffers, not pooled slices", async () => {
  const f = await checkFixture(); let retained;
  const captured = await captureOfflineExecution(request(f), mock(async (r) => {
    retained = r;
    const buffers = [...r.inputs.values(), ...r.files.values()];
    assert.equal(new Set(buffers.map((raw) => raw.buffer)).size, buffers.length);
    for (const raw of buffers) {
      assert.equal(raw.byteOffset, 0);
      assert.equal(raw.buffer.byteLength, raw.byteLength);
    }
    return f.executor(r);
  }));
  for (const raw of [captured.record, captured.receipt, ...captured.files.values()]) {
    assert.equal(raw.byteOffset, 0);
    assert.equal(raw.buffer.byteLength, raw.byteLength);
  }
  const expected = new Map([...captured.files].map(([key, raw]) => [key, Buffer.from(raw)]));
  for (const raw of [...retained.inputs.values(), ...retained.files.values()]) new Uint8Array(raw.buffer).fill(0);
  assert.deepEqual(captured.files, expected);
});
test("shared bytes and accessor-bearing policy or callback output are rejected", async () => {
  const f = await checkFixture(), inputs = new Map(f.nativeInputs);
  inputs.set("bundle", new Uint8Array(new SharedArrayBuffer(4)));
  await assert.rejects(captureOfflineExecution(request(f, { inputs }), mock(() => assert.fail())), /nonshared/);
  const policy = { ...f.checkPolicy.offline };
  Object.defineProperty(policy, "options", { enumerable: true, get() { assert.fail("policy getter executed"); } });
  await assert.rejects(captureOfflineExecution(request(f, { policy }), mock(() => assert.fail())), /UNCLONEABLE/);
  await assert.rejects(captureOfflineExecution(request(f), mock(async (r) => {
    const result = await f.executor(r);
    Object.defineProperty(result, "stdout", { get() { assert.fail("stdout getter executed"); } });
    return result;
  })), /result property/);
});
for (const [limits, code] of [
  [{ max_reads: 1 }, "READS_EXCEEDED"],
  [{ max_captures: 1 }, "CAPTURES_EXCEEDED"],
  [{ max_json_bytes: 32 }, "JSON_BYTES_EXCEEDED"],
  [{ max_json_depth: 1 }, "DEPTH_EXCEEDED"],
  [{ max_json_nodes: 2 }, "NODES_EXCEEDED"],
  [{ max_string_length: 1 }, "STRING_EXCEEDED"],
]) {
  test(`offline ${code} rejects before executor admission`, async () => {
    const f = await checkFixture(); let calls = 0;
    await assert.rejects(captureOfflineExecution(request(f, { resourceBudget: offlineResourceFixtureBudget(limits) }),
      mock(async (r) => { calls++; return f.executor(r); })), new RegExp(code));
    assert.equal(calls, 0);
  });
}
test("consumer requires an explicit branded budget, not an APPROVED label", async () => {
  const f = await checkFixture();
  for (const offlineResourceBudget of [undefined, { approval: "APPROVED" }, { ...f.offlineResourceBudget, approval: "APPROVED" }]) {
    await assert.rejects(verifyReleaseChecks(f.args, { ...f.config, offlineResourceBudget }), /RESOURCE_BUDGET_MISSING/);
  }
});
test("consumer inventory snapshot rejects accessors without invoking them", async () => {
  const f = await checkFixture();
  Object.defineProperty(f.args.inputs.verification.independentInputs, "unexpected", {
    enumerable: true, get() { assert.fail("inventory getter executed"); },
  });
  await assert.rejects(verifyReleaseChecks(f.args, f.config), /UNCLONEABLE/);
});
test("byte-valued record enumeration has exact modeled byte and entry-count bounds", () => {
  const raw = Buffer.from("x");
  for (const max_bytes of [47, 48, 49]) {
    const run = () => withNativeInspectionBudgetSync(offlineResourceFixtureBudget({ max_bytes }),
      (scope) => scope.recordEntries({ a: raw }));
    if (max_bytes === 47) assert.throws(run, /RESOURCE_BYTES_EXCEEDED/);
    else assert.deepEqual(run(), [["a", raw]]);
  }
  const enumerate = (value) => withNativeInspectionBudgetSync(offlineResourceFixtureBudget({ max_json_nodes: 1 }),
    (scope) => scope.recordEntries(value));
  assert.deepEqual(enumerate({ a: raw }), [["a", raw]]);
  assert.throws(() => enumerate({ a: raw, b: raw }), /RESOURCE_NODES_EXCEEDED/);
});
test("consumer snapshots offline evidence, policy and Runtime Config before async callbacks", async () => {
  const f = await checkFixture(), original = Buffer.from(f.config.checkPolicyBytes);
  const archived = f.config.authenticateArchiveReadback;
  const outcome = await verifyReleaseChecks(f.args, { ...f.config, authenticateArchiveReadback: async (r) => {
    const descriptor = JSON.parse(f.offlineExecution.receipt).inputs.bundle_artifact_session;
    f.args.evidenceBytes.get(descriptor.sha256).fill(0);
    f.config.checkPolicyBytes.fill(32);
    f.args.payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID = "foreign";
    f.args.inputs.verification.independentInputs.security_registry_set_raw.fill(32);
    const proof = await archived(r);
    f.config.checkPolicyBytes.set(original);
    return proof;
  } });
  assert.equal(outcome.checks.offline_verification.status, "VERIFIED");
  assert.equal(outcome.checks.offline_verification.authentication, "LOCAL_CAPTURE_ONLY");
});
test("offline proof callbacks cannot mutate the internal receipt or input snapshot", async () => {
  const f = await checkFixture();
  const outcome = await verifyReleaseChecks(f.args, { ...f.config, authenticateOfflineExecution: async (r) => {
    r.inputs.get("bundle").fill(0); r.inputs.clear();
    r.receipt.output.argv.fill("foreign"); r.policy.executable_sha256 = "foreign"; r.context.run_attempt++;
    return f.offlineExecution.executionProof;
  } });
  assert.equal(outcome.checks.offline_verification.status, "VERIFIED");
});
for (const kind of ["receipt", "inventory"]) {
  test(`offline ${kind} rejects duplicate keys even if the outer digest is repinned`, async () => {
    const f = await checkFixture(), raw = f.offlineExecution.receipt.toString();
    const text = kind === "receipt" ? `{"status":"FAIL",${raw.slice(1)}` :
      raw.replace('"inputs":{', '"inputs":{"bundle":{"sha256":"foreign","byte_length":1},');
    const bytes = Buffer.from(text), digest = sha256(bytes);
    f.args.evidenceBytes.set(digest, bytes);
    f.args.records.offline_verification = { ...f.args.records.offline_verification, evidence_sha256: digest };
    await assert.rejects(verifyReleaseChecks(f.args, f.config), /JSON_DUPLICATE_KEY/);
  });
}
test("receipt descriptors cannot substitute manifest artifact_sha256 for sha256", async () => {
  const f = await checkFixture(), receipt = JSON.parse(f.offlineExecution.receipt);
  receipt.inputs.bundle.artifact_sha256 = receipt.inputs.bundle.sha256;
  delete receipt.inputs.bundle.sha256;
  receipt.input_sha256 = sha256(jsonBytes(receipt.inputs));
  const raw = jsonBytes(receipt), digest = sha256(raw);
  f.args.evidenceBytes.set(digest, raw);
  f.args.records.offline_verification = { ...f.args.records.offline_verification, evidence_sha256: digest };
  await assert.rejects(verifyReleaseChecks(f.args, f.config), /input descriptor contract/);
});
test("session JSON is strictly parsed after its independent byte pins match", async () => {
  const f = await checkFixture(), raw = f.nativeInputs.get("bundle_artifact_session").toString();
  const session = Buffer.from(`{"session_id":"foreign",${raw.slice(1)}`);
  const bundle = JSON.parse(f.nativeInputs.get("bundle")), inputs = new Map(f.nativeInputs);
  bundle.artifacts.session.artifact_sha256 = sha256(session); bundle.artifacts.session.byte_length = session.byteLength;
  inputs.set("bundle_artifact_session", session); inputs.set("bundle", jsonBytes(bundle));
  const policy = { ...f.checkPolicy.offline, input_sha256: { ...f.checkPolicy.offline.input_sha256,
    bundle: sha256(inputs.get("bundle")), bundle_artifact_session: sha256(session) } };
  inputs.set("stdout", jsonBytes(f.nativeReport)); inputs.set("stderr", Buffer.alloc(0));
  assert.throws(() => verifyOfflineExecution({ inputs, receipt: JSON.parse(f.offlineExecution.receipt), policy,
    archiveInputs: f.archiveInputs, archivePolicy: f.checkPolicy.archive, context: f.context,
    resourceBudget: f.offlineResourceBudget }), /JSON_DUPLICATE_KEY/);
});
test("oversized output and thrown callbacks release the scope without producing an execution proof", async () => {
  const f = await checkFixture(), resourceBudget = offlineResourceFixtureBudget({ max_json_bytes: 32768, max_concurrent_operations: 1 });
  await assert.rejects(captureOfflineExecution(request(f, { resourceBudget }), mock(async (r) => ({
    ...await f.executor(r), stdout: Buffer.alloc(32769, 32),
  }))), /JSON_BYTES_EXCEEDED/);
  await assert.rejects(captureOfflineExecution(request(f, { resourceBudget }), mock(async () => { throw new Error("mock failure"); })), /mock failure/);
  const next = await captureOfflineExecution(request(f, { resourceBudget }), mock(f.executor));
  assert.equal(JSON.parse(next.receipt).status, "PASS");
});
for (const settlement of ["resolve", "reject"]) {
  test(`offline timeout keeps its shared slot until late ${settlement}`, async () => {
    const f = await checkFixture(), resourceBudget = offlineResourceFixtureBudget({ max_concurrent_operations: 1, timeout_ms: 100 });
    let finish, started = false, callbackSignal;
    const pending = new Promise((resolve, reject) => { finish = settlement === "resolve" ? resolve : reject; });
    const operation = captureOfflineExecution(request(f, { resourceBudget }), mock((r) => {
      started = true; callbackSignal = r.signal; return pending;
    }));
    const timedOut = assert.rejects(operation, /RESOURCE_TIMEOUT/);
    await setImmediate();
    assert.equal(started, true);
    await timedOut;
    assert.equal(callbackSignal.aborted, true);
    await assert.rejects(captureOfflineExecution(request(f, { resourceBudget }), mock(f.executor)), /RESOURCE_BUSY/);
    finish(settlement === "resolve" ? {} : new Error("late rejection"));
    await setImmediate();
    const next = await captureOfflineExecution(request(f, { resourceBudget }), mock(f.executor));
    assert.equal(JSON.parse(next.receipt).status, "PASS");
  });
}
test("offline cancellation does not release a pending callback or poison the next operation", async () => {
  const f = await checkFixture(), resourceBudget = offlineResourceFixtureBudget({ max_concurrent_operations: 1 });
  const abort = new AbortController(); let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const operation = captureOfflineExecution(request(f, { resourceBudget, signal: abort.signal }), mock(() => pending));
  const cancelled = assert.rejects(operation, /RESOURCE_ABORTED/);
  await setImmediate();
  abort.abort();
  await cancelled;
  await assert.rejects(captureOfflineExecution(request(f, { resourceBudget }), mock(f.executor)), /RESOURCE_BUSY/);
  finish({}); finish({}); await setImmediate();
  const next = await captureOfflineExecution(request(f, { resourceBudget }), mock(f.executor));
  assert.equal(JSON.parse(next.receipt).status, "PASS");
});
test("independent offline controllers remain separate admission domains", async () => {
  const f = await checkFixture(), abort = new AbortController(); let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const operation = captureOfflineExecution(request(f, { signal: abort.signal }), mock(() => pending));
  const independent = await captureOfflineExecution(request(f), mock(f.executor));
  assert.equal(JSON.parse(independent.receipt).status, "PASS");
  abort.abort(); await assert.rejects(operation, /RESOURCE_ABORTED/);
  finish({}); await setImmediate();
});
const parse = (text, limits = {}) => withNativeInspectionBudgetSync(offlineResourceFixtureBudget(limits),
  (scope) => parseNativeInspectionJson(typeof text === "string" ? Buffer.from(text) : text, scope));
for (const text of [
  '{"a":1,"a":2}', '{"nested":{"a":1,"a":2}}', '[{"x":0,"\\u0078":1}]',
  '{"__proto__":1,"__proto__":2}', '{"a\\\\b":1,"a\\u005cb":2}',
]) {
  test(`strict bounded JSON rejects duplicate object keys: ${text}`, () => assert.throws(() => parse(text), /JSON_DUPLICATE_KEY/));
}
for (const text of ['{"a":"\\q"}', '{"a":"\\uZZZZ"}', '{} true', '{"a":1,}', '[0,]', '{"a":}', '"unterminated', '01']) {
  test(`strict bounded JSON rejects invalid grammar: ${text}`, () => assert.throws(() => parse(text), /JSON_INVALID/));
}
test("strict JSON accepts noncanonical manifest whitespace, key-like strings and separate object keys", () => {
  const text = ' { "message" : "\\"a\\": 1, \\"a\\": 2", "array": [{"a": 1}, {"a": 2}], "escaped": "\\\\\\"{}[]" } \n';
  assert.deepEqual(parse(text), JSON.parse(text));
  assert.throws(() => parseReleaseRecord(Buffer.from(text)), /noncanonical/);
  assert.deepEqual(parseReleaseRecord(jsonBytes(parse(text))), parse(text));
});
test("strict JSON rejects malformed UTF-8 and bounds decoded tree structure", () => {
  assert.throws(() => parse(Buffer.from([0xc3, 0x28])), /JSON_INVALID_UTF8/);
  for (const [limits, accepted, rejected, code] of [
    [{ max_json_depth: 2 }, "[[]]", "[[[]]]", "DEPTH_EXCEEDED"],
    [{ max_json_nodes: 3 }, "[0]", "[0,1,2,3]", "NODES_EXCEEDED"],
    [{ max_string_length: 3 }, '"abc"', '"abcd"', "STRING_EXCEEDED"],
  ]) {
    assert.deepEqual(parse(accepted, limits), JSON.parse(accepted));
    assert.throws(() => parse(rejected, limits), new RegExp(code));
  }
});
