import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { buildOfflineFdFrame, captureOfflineExecution, jsonBytes, verifyOfflineExecution } from "./release-checks.mjs";
import { inspectOfflineFdFrame, FD_HEADER_BYTES } from "./release-offline-fd.mjs";
import { offlineFdFixture, refreshFdFixture, fdResourceFixtureBudget } from "./release-offline-fd-fixture.mjs";
import { sha256 } from "./release-bytes.mjs";

const request = (f, changes = {}) => ({ ...f, resourceBudget: fdResourceFixtureBudget(), ...changes });
const build = (f) => buildOfflineFdFrame(request(f));
const inspect = (f, frame, changes = {}) => inspectOfflineFdFrame(frame, {
  limits: { ...f.policy.fd_abi.limits, ...changes }, resourceBudget: fdResourceFixtureBudget(),
});
const reject = (f, mutate) => {
  const frame = Buffer.from(build(f).frame); mutate(frame);
  assert.throws(() => inspect(f, frame), /FD_ABI_V1|NATIVE_RESOURCE/);
};
function tableRecords(frame) {
  const records = []; let cursor = FD_HEADER_BYTES;
  for (let i = 0; i < frame.readUInt32LE(16); i++) {
    const roleLength = frame.readUInt32LE(cursor + 4), pathLength = frame.readUInt32LE(cursor + 8);
    const strings = cursor + 64, end = strings + roleLength + pathLength;
    records.push({ cursor, strings, end, role: frame.toString("utf8", strings, strings + roleLength),
      pathStart: strings + roleLength, pathLength });
    cursor = end + (8 - end % 8) % 8;
  }
  return records;
}
test("v1 preserves all raw inputs and agrees with the shared Rust vector", async () => {
  const f = offlineFdFixture(), parsed = build(f);
  assert.equal(parsed.entries.length, 27);
  for (const entry of parsed.entries.filter((entry) => entry.kind !== 0)) {
    assert.deepEqual(entry.bytes, f.inputs.get(entry.kind === 3 ? `bundle_artifact_${entry.role}` : entry.role));
  }
  const vector = JSON.parse(await readFile(new URL("../packages/FUSOU-TLSN-VERIFIER/fixtures/offline-fd-v1-vector.json", import.meta.url)));
  assert.equal(parsed.frame.toString("base64"), vector.frame_base64);
  assert.deepEqual(parsed.binding, vector.binding);
  assert.deepEqual(parsed.binding, inspect(f, parsed.frame).binding);
});
for (const [name, mutate] of [
  ["version", (b) => b.writeUInt16LE(2, 8)],
  ["flags", (b) => b.writeUInt16LE(1, 10)],
  ["header length", (b) => b.writeUInt32LE(47, 12)],
  ["reserved header", (b) => b.writeUInt32LE(1, 20)],
  ["missing entry", (b) => b.writeUInt32LE(26, 16)],
  ["total length", (b) => b.writeBigUInt64LE(BigInt(b.length - 1), 32)],
  ["table length", (b) => b.writeBigUInt64LE(1n, 24)],
  ["offset overflow", (b) => b.writeBigUInt64LE(0xffffffffffffffffn, 64)],
  ["length overflow", (b) => b.writeBigUInt64LE(0xffffffffffffffffn, 72)],
  ["out of range", (b) => b.writeBigUInt64LE(BigInt(b.length + 1), 72)],
  ["overlap", (b) => b.writeBigUInt64LE(b.readBigUInt64LE(64) - 1n, 64)],
  ["gap", (b) => b.writeBigUInt64LE(b.readBigUInt64LE(64) + 1n, 64)],
  ["entry flags", (b) => b.writeUInt16LE(1, 50)],
  ["unknown kind", (b) => b.writeUInt16LE(4, 48)],
  ["duplicate entry", (b) => b.writeUInt16LE(0, tableRecords(b)[1].cursor)],
  ["unknown artifact role", (b) => {
    const record = tableRecords(b).find((r) => r.role === "health"); b.write("boguus", record.strings, "ascii");
  }],
  ["padding", (b) => {
    const record = tableRecords(b).find((r) => r.end % 8); b[record.end] = 1;
  }],
  ["metadata UTF-8", (b) => { b[tableRecords(b)[0].pathStart] = 0xff; }],
  ["payload digest", (b) => { b[b.length - 1] ^= 1; }],
]) test(`parser rejects ${name}`, () => reject(offlineFdFixture(), mutate));

test("parser rejects truncation and trailing bytes, even with an adjusted total", () => {
  const f = offlineFdFixture(), frame = build(f).frame;
  for (const modified of [frame.subarray(0, 40), frame.subarray(0, frame.length - 1), Buffer.concat([frame, Buffer.from([0])])]) {
    assert.throws(() => inspect(f, modified), /FD_ABI_V1/);
  }
  const trailing = Buffer.concat([frame, Buffer.from([0])]); trailing.writeBigUInt64LE(BigInt(trailing.length), 32);
  assert.throws(() => inspect(f, trailing), /trailing/);
});
for (const path of ["../health", "/health", "a//b", "a/./b", "a/../b", "a\\b", "a:b", "a\0b"]) {
  test(`encoder rejects noncanonical logical path ${JSON.stringify(path)}`, () => {
    const f = offlineFdFixture(), manifest = JSON.parse(f.inputs.get("bundle"));
    manifest.artifacts.health.path = path; f.inputs.set("bundle", jsonBytes(manifest)); refreshFdFixture(f);
    assert.throws(() => build(f), /path|artifact\/path/);
  });
}
test("logical destinations reject duplicates and file/parent collisions including control", () => {
  for (const path of ["artifacts/result.bin", "artifacts/result.bin/child", "control.json", "control.json/child"]) {
    const f = offlineFdFixture(), manifest = JSON.parse(f.inputs.get("bundle"));
    manifest.artifacts.health.path = path; f.inputs.set("bundle", jsonBytes(manifest)); refreshFdFixture(f);
    assert.throws(() => build(f), /collision|artifact\/path/);
  }
});
for (const [name, raw] of [
  ["top duplicate", '{"artifacts":{},"artifacts":{}}'],
  ["nested duplicate", '{"artifacts":{"x":1,"x":2}}'],
  ["escaped duplicate", '{"artifacts":{},"\\u0061rtifacts":{}}'],
  ["bad escape", '{"x":"\\q"}'],
  ["trailing", '{} {}'],
  ["surrogate", '{"x":"\\ud800"}'],
]) test(`JSON rejects ${name}`, () => {
  const f = offlineFdFixture();
  f.inputs.set("bundle", Buffer.from(name === "surrogate" ?
    `{"unicode":"\\ud800",${f.inputs.get("bundle").toString().slice(1)}` : raw));
  f.policy.input_sha256.bundle = sha256(f.inputs.get("bundle"));
  assert.throws(() => build(f), /JSON|DUPLICATE|Unicode/);
});
test("JSON rejects invalid UTF-8 and bounds bytes, strings, depth and nodes", () => {
  const f = offlineFdFixture();
  f.inputs.set("bundle", Buffer.from([0xff])); f.policy.input_sha256.bundle = sha256(f.inputs.get("bundle"));
  assert.throws(() => build(f), /UTF8/);
  for (const limits of [{ max_json_bytes: 2 }, { max_string_bytes: 2 }, { max_json_depth: 1 }, { max_json_nodes: 1 },
    { max_entry_bytes: 1 }, { max_entries: 26 }, { max_frame_bytes: 1 }]) {
    const sample = offlineFdFixture(); Object.assign(sample.policy.fd_abi.limits, limits);
    assert.throws(() => build(sample), /limit|FD_ABI_V1/);
  }
});
test("additional descriptors are included without dedup; undeclared inputs are rejected", () => {
  const f = offlineFdFixture(), manifest = JSON.parse(f.inputs.get("bundle"));
  f.inputs.set("bundle_artifact_extra", Buffer.from(f.inputs.get("bundle_artifact_presentation")));
  manifest.artifacts.extra = { path: "extra.bin" }; f.inputs.set("bundle", jsonBytes(manifest)); refreshFdFixture(f);
  const parsed = build(f);
  assert.equal(parsed.entries.length, 28);
  const extra = parsed.entries.find((entry) => entry.role === "extra");
  const original = parsed.entries.find((entry) => entry.role === "presentation");
  assert.deepEqual(extra.bytes, original.bytes); assert.notEqual(extra.offset, original.offset);
  f.inputs.set("undeclared", Buffer.from("foreign")); refreshFdFixture(f);
  assert.throws(() => build(f), /inventory/);
});
test("parser rejects a parent collision even with a lexically intervening destination", () => {
  const f = offlineFdFixture(), manifest = JSON.parse(f.inputs.get("bundle"));
  f.inputs.set("bundle_artifact_extra", Buffer.alloc(0));
  manifest.artifacts.extra = { path: "artifacts/result.bin-between" };
  f.inputs.set("bundle", jsonBytes(manifest)); refreshFdFixture(f);
  const frame = Buffer.from(build(f).frame);
  const record = tableRecords(frame).find((entry) => entry.role === "health");
  const path = "artifacts/result.bin/child", next = record.end + (8 - record.end % 8) % 8;
  assert.equal(record.pathStart + Buffer.byteLength(path), next);
  frame.writeUInt32LE(Buffer.byteLength(path), record.cursor + 8);
  frame.write(path, record.pathStart, "utf8");
  assert.throws(() => inspect(f, frame), /logical path collision/);
});
test("extra empty payloads and key-like JSON strings retain their original bytes", () => {
  const f = offlineFdFixture(), manifest = JSON.parse(f.inputs.get("bundle"));
  f.inputs.set("bundle_artifact_extra", Buffer.alloc(0));
  f.inputs.set("bundle_artifact_health", Buffer.from('{"text":"\\\"x\\\":","nested":[{},{"x":1}]}'));
  manifest.artifacts.extra = { path: "empty.bin" };
  f.inputs.set("bundle", jsonBytes(manifest)); refreshFdFixture(f);
  const parsed = build(f);
  assert.equal(parsed.entries.length, 28);
  assert.equal(parsed.entries.find((entry) => entry.role === "extra").bytes.byteLength, 0);
  assert.deepEqual(parsed.entries.find((entry) => entry.role === "health").bytes, f.inputs.get("bundle_artifact_health"));
  assert.deepEqual(inspect(f, parsed.frame).binding, parsed.binding);
});
for (const role of ["trusted_notary_registry", "session_authority_registry", "binding_authority_registry", "trust_anchor_der"]) {
  test(`FD requires external/bundled equality for ${role}`, () => {
    const f = offlineFdFixture(); f.inputs.set(role, jsonBytes({ changed: true })); refreshFdFixture(f);
    assert.throws(() => build(f), /registry bytes|external\/bundle bytes/);
  });
}
test("frame and parsed payloads own independent ArrayBuffers", () => {
  const f = offlineFdFixture(), parsed = build(f), saved = Buffer.from(parsed.frame);
  for (const bytes of f.inputs.values()) bytes.fill(0);
  assert.deepEqual(parsed.frame, saved);
  assert.notEqual(parsed.entries[0].bytes.buffer, parsed.frame.buffer);
  for (const entry of parsed.entries.slice(1)) assert.notEqual(entry.bytes.buffer, parsed.entries[0].bytes.buffer);
  const source = Buffer.from(saved), inspected = inspect(f, source); source.fill(0);
  assert.deepEqual(inspected.frame, saved);
  assert.throws(() => buildOfflineFdFrame(request(offlineFdFixture(), {
    inputs: new Map([["bundle", new Uint8Array(new SharedArrayBuffer(1))]]),
  })), /nonshared/);
});
test("FD profile accessors are rejected without executing caller code", () => {
  const f = offlineFdFixture();
  Object.defineProperty(f.policy.fd_abi, "limits", {
    enumerable: true, get() { assert.fail("caller getter executed"); },
  });
  assert.throws(() => build(f), /UNCLONEABLE/);
});
for (const name of ["source_sha", "workflow_sha"]) {
  test(`control ${name} rejects arrays instead of coercing them to strings`, () => {
    const f = offlineFdFixture(); f.context[name] = [f.context[name]];
    assert.throws(() => build(f), /FD_ABI_V1 context/);
  });
}
test("FD capture snapshots before awaiting and keeps callback maps separate from frame", async () => {
  const f = offlineFdFixture(), original = Buffer.from(f.inputs.get("bundle")), args = request(f);
  const execution = await captureOfflineExecution(args, { mockExecutor: async (r) => {
    assert.equal(r.files, undefined); assert.deepEqual(r.argv, ["--fd-abi-v1"]);
    const frame = Buffer.from(r.frame), source = Buffer.from(r.inputs.get("bundle"));
    f.inputs.get("bundle").fill(32); r.inputs.get("bundle").fill(0);
    assert.deepEqual(r.frame, frame);
    r.frame.fill(0); await setImmediate(); r.frame.set(frame); r.inputs.get("bundle").set(source);
    f.inputs.get("bundle").set(original);
    return f.executor(r);
  } });
  const receipt = JSON.parse(execution.receipt);
  assert.equal(receipt.output.input_abi, "FUSOU_FD_V1");
  const inputs = new Map([...f.inputs, ["fd_frame", execution.files.get(`evidence-${receipt.inputs.fd_frame.sha256}.bin`)],
    ["stdout", execution.files.get(`evidence-${receipt.output.stdout_sha256}.bin`)],
    ["stderr", execution.files.get(`evidence-${receipt.output.stderr_sha256}.bin`)]]);
  verifyOfflineExecution({ ...request(f), inputs, receipt });
  receipt.output.input_binding.inventory_sha256 = sha256(Buffer.from("foreign"));
  assert.throws(() => verifyOfflineExecution({ ...request(f), inputs, receipt }), /frame\/receipt binding/);
});
test("capture rejects different consumed inventory, persistent frame mutation and operation mixing", async () => {
  for (const change of ["binding", "frame", "context"]) {
    const f = offlineFdFixture();
    await assert.rejects(captureOfflineExecution(request(f), { mockExecutor: async (r) => {
      const output = await f.executor(r);
      if (change === "frame") r.frame[0] ^= 1;
      else {
        const report = JSON.parse(output.stdout);
        report.input_binding[change === "binding" ? "inventory_sha256" : "control_sha256"] = sha256(Buffer.from(change));
        output.stdout = jsonBytes(report);
      }
      return output;
    } }), /consumed FD inventory|source\/executable\/command/);
  }
});
test("missing budgets, unknown profile ABI and unregistered runners cannot enable execution", async () => {
  const f = offlineFdFixture();
  f.policy.approval = "APPROVED";
  assert.throws(() => buildOfflineFdFrame(request(f, { resourceBudget: undefined })), /BUDGET_MISSING/);
  const unknown = offlineFdFixture(); unknown.policy.fd_abi.schema_version = 2;
  assert.throws(() => build(unknown), /profile identity/);
  for (const options of [{}, { execute: f.executor }, { execute: f.executor, mockExecutor: f.executor }]) {
    await assert.rejects(captureOfflineExecution(request(f), options), /OFFLINE_EXECUTOR/);
  }
  let calls = 0;
  await assert.rejects(captureOfflineExecution(request(f, { resourceBudget: fdResourceFixtureBudget({ max_bytes: 1 }) }),
    { mockExecutor: () => { calls++; } }), /BYTES_EXCEEDED/);
  assert.equal(calls, 0);
});
test("failed execution records submitted input, never a successful consumed-input claim", async () => {
  const f = offlineFdFixture();
  const execution = await captureOfflineExecution(request(f), { mockExecutor: async (r) => ({
    ...await f.executor(r), exit_code: 1, stdout: jsonBytes({ status: "REJECTED" }),
  }) });
  const receipt = JSON.parse(execution.receipt);
  assert.equal(receipt.status, "FAIL");
  assert.deepEqual(receipt.output.submitted_input_binding, build(f).binding);
  assert.equal(Object.hasOwn(receipt.output, "input_binding"), false);
  assert.equal(execution.executionProof, undefined);
});
test("cancellation retains a FD operation slot until callback settlement", async () => {
  const f = offlineFdFixture(), resourceBudget = fdResourceFixtureBudget({ max_concurrent_operations: 1 });
  const abort = new AbortController(); let settle, ready;
  const started = new Promise((resolve) => { ready = resolve; });
  const operation = captureOfflineExecution(request(f, { resourceBudget, signal: abort.signal }), { mockExecutor: (r) => {
    ready(); return new Promise((resolve) => { settle = async () => resolve(await f.executor(r)); });
  } });
  await started; abort.abort(); await assert.rejects(operation, /ABORTED/);
  await assert.rejects(captureOfflineExecution(request(f, { resourceBudget }), { mockExecutor: f.executor }), /BUSY/);
  await settle(); await setImmediate();
  await captureOfflineExecution(request(f, { resourceBudget }), { mockExecutor: f.executor });
});
