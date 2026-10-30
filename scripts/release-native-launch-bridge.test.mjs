import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rmdir } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { withNativeLaunchBridge } from "./release-native-launch-bridge.mjs";
import { withNativeInspectionBudget, retainNativeLaunchOperation } from "./release-native-resources.mjs";
import { nativeResourceFixtureBudget } from "./release-native-attestation-fixture.mjs";

const reservation = Object.freeze({ image: 4096, input: 4096, fds: 4096, execution: 1,
  capture: 4096, stop: 4096, cleanup: 4096, reads: 16, captures: 2 });
const phases = ["PREPARING", "CHILD_CREATED", "EXEC_OBSERVED", "CAPTURING", "STOPPING",
  "REAPED", "TREE_EMPTY", "CAPTURE_COMPLETE", "CLEANUP_CONFIRMED"];
const usage = Object.fromEntries(Object.keys(reservation).sort().map(key => [key, key === "captures" ? 2 : 0]));
const events = (id, outcome = "SUCCEEDED") => phases.map((state, index) => ({
  native_id: 1, operation_id: id, outcome: index === 8 ? outcome : "PENDING",
  sequence: index + 1, state, usage: index === 8 ? usage : null, version: 1,
}));
const encode = values => values.map(value => JSON.stringify(value) + "\n").join("");
async function fixture(t, respond, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "fusou-native-bridge-"));
  const path = join(directory, "wire");
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("error", error => assert.ok(["EPIPE", "ECONNRESET"].includes(error.code)));
    socket.once("close", () => sockets.delete(socket));
    let pending = "";
    socket.on("data", bytes => {
      pending += bytes.toString();
      for (;;) {
        const index = pending.indexOf("\n"); if (index < 0) break;
        const request = JSON.parse(pending.slice(0, index)); pending = pending.slice(index + 1);
        respond(socket, request);
      }
    });
  });
  server.listen(path); await once(server, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve)); await rmdir(directory);
  });
  const channel = createConnection(path); await once(channel, "connect");
  t.after(() => channel.destroy());
  const resourceBudget = nativeResourceFixtureBudget({ max_concurrent_operations: 1, ...overrides });
  return { resourceBudget, channel, reservation, cleanupTimeoutMs: 200 };
}
const busy = async budget => assert.rejects(withNativeInspectionBudget(budget, undefined, () => 1),
  { code: "NATIVE_RESOURCE_BUSY" });

test("cleanup and channel close, not child exit, release the native hold", async t => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const options = await fixture(t, (socket, request) => {
    if (request.action !== "START") return;
    socket.write(encode(events(request.operation_id).slice(0, 6)));
    finish = () => socket.end(encode(events(request.operation_id).slice(6))); started();
  });
  const result = withNativeLaunchBridge(options); await ready;
  await busy(options.resourceBudget); finish();
  const record = await result;
  assert.equal(record.state, "CLEANUP_CONFIRMED"); assert.equal(record.authenticated, false);
  assert.equal(record.publication_authorized, false); assert.equal(record.approval, "UNAPPROVED");
  assert.equal(await withNativeInspectionBudget(options.resourceBudget, undefined, () => 2), 2);
});
test("failed execution can settle only after every cleanup confirmation", async t => {
  const options = await fixture(t, (socket, request) => socket.end(encode(events(request.operation_id, "FAILED"))));
  assert.equal((await withNativeLaunchBridge(options)).outcome, "FAILED");
  assert.equal(await withNativeInspectionBudget(options.resourceBudget, undefined, () => 1), 1);
});
for (const fault of ["unknown-id", "changed-native-id", "duplicate", "reverse", "missing-tree",
  "missing-capture", "missing-removal", "trailing", "duplicate-json-key", "oversize", "bad-usage",
  "kill-failure", "reap-failure", "empty-unknown", "remove-failure"]) {
  test(`invalid native completion quarantines: ${fault}`, async t => {
    const options = await fixture(t, (socket, request) => {
      let values = events(request.operation_id);
      if (fault === "unknown-id") values[0].operation_id = "native-unknown";
      if (fault === "changed-native-id") values[2].native_id = 2;
      if (fault === "duplicate") values.splice(6, 0, values[5]);
      if (fault === "reverse") [values[4], values[5]] = [values[5], values[4]];
      if (fault === "missing-tree") values.splice(6, 1);
      if (fault === "missing-capture") values.splice(7, 1);
      if (fault === "missing-removal") values.pop();
      if (fault === "bad-usage") values[8].usage = { ...usage, image: reservation.image + 1 };
      if (["kill-failure", "reap-failure", "empty-unknown", "remove-failure"].includes(fault)) {
        values = values.slice(0, { "kill-failure": 4, "reap-failure": 5,
          "empty-unknown": 6, "remove-failure": 8 }[fault]);
        values.push({ ...values.at(-1), sequence: values.length + 1, state: "QUARANTINED", outcome: "FAILED" });
      }
      let raw = encode(values);
      if (fault === "trailing") raw += "partial";
      if (fault === "duplicate-json-key") raw = raw.replace('"version":1', '"version":0,"version":1');
      if (fault === "oversize") raw = "x".repeat(16385);
      socket.end(raw);
    });
    await assert.rejects(withNativeLaunchBridge(options), error => error.code?.startsWith("NATIVE_BRIDGE_"));
    await busy(options.resourceBudget);
  });
}
test("cancel returns promptly but a late verified cleanup owns the slot until channel close", async t => {
  const abort = new AbortController();
  let finish, started, operationId;
  const ready = new Promise(resolve => { started = resolve; });
  const options = await fixture(t, (socket, request) => {
    if (request.action === "START") {
      operationId = request.operation_id;
      socket.write(encode(events(request.operation_id).slice(0, 4))); started();
    }
    else { finish = () => socket.end(encode(events(request.operation_id, "FAILED").slice(4))); }
  });
  const result = withNativeLaunchBridge({ ...options, signal: abort.signal });
  await ready; abort.abort();
  await assert.rejects(result, { code: "NATIVE_RESOURCE_ABORTED" });
  while (!finish) await setImmediate();
  await busy(options.resourceBudget); finish();
  await once(options.channel, "close"); await setImmediate();
  assert.equal(await withNativeInspectionBudget(options.resourceBudget, undefined, () => 1), 1);
});

test("closed channel and direct-child reap cannot settle a native hold", async t => {
  let operationId;
  const options = await fixture(t, (socket, request) => {
    operationId = request.operation_id;
    socket.end(encode(events(operationId).slice(0, 6)));
  });
  await assert.rejects(withNativeLaunchBridge(options), { code: "NATIVE_BRIDGE_INCOMPLETE" });
  await busy(options.resourceBudget);
});
test("old operation completion cannot release a newer native hold", async t => {
  let oldId, currentId;
  const first = await fixture(t, (socket, request) => {
    oldId = request.operation_id; socket.end(encode(events(oldId)));
  });
  await withNativeLaunchBridge(first);
  const next = await fixture(t, (socket, request) => {
    currentId = request.operation_id;
    const values = events(currentId); values[6].operation_id = oldId;
    socket.end(encode(values));
  });
  next.resourceBudget = first.resourceBudget;
  await assert.rejects(withNativeLaunchBridge(next), { code: "NATIVE_BRIDGE_TRANSITION" });
  assert.notEqual(currentId, oldId);
  await busy(first.resourceBudget);
});
test("second native attachment after normal settlement rejects explicitly, not via a missing record", async t => {
  const options = await fixture(t, () => assert.fail("test-only ownership case sends no START"));
  await withNativeInspectionBudget(options.resourceBudget, undefined, async scope => {
    const hold = retainNativeLaunchOperation(scope, reservation);
    assert.throws(() => hold.cleanup(), { code: "NATIVE_RESOURCE_NATIVE_SETTLEMENT" });
    hold.watchChannel(options.channel); hold.observeNative(1, "CLEANUP_CONFIRMED");
    const closed = once(options.channel, "close"); options.channel.destroy(); await closed;
    hold.cleanup();
    assert.throws(() => hold.cleanup(), { code: "NATIVE_RESOURCE_NATIVE_SETTLEMENT" });
    assert.throws(() => retainNativeLaunchOperation(scope, reservation),
      { code: "NATIVE_RESOURCE_NATIVE_ALREADY_ATTACHED" });
  });
  assert.equal(await withNativeInspectionBudget(options.resourceBudget, undefined, () => 1), 1);
});
test("unresponsive peer cleanup timeout preserves quarantine after caller timeout", async t => {
  const options = await fixture(t, () => {}, { timeout_ms: 10 });
  options.cleanupTimeoutMs = 30;
  await assert.rejects(withNativeLaunchBridge(options), { code: "NATIVE_RESOURCE_TIMEOUT" });
  await delay(50); await busy(options.resourceBudget);
});
test("missing explicit cleanup bound and malformed reservation never start or free a native operation", async t => {
  for (const changes of [{ cleanupTimeoutMs: undefined }, { reservation: { image: 1 } }]) {
    const options = await fixture(t, () => assert.fail("invalid operation started"));
    await assert.rejects(withNativeLaunchBridge({ ...options, ...changes }));
    await busy(options.resourceBudget);
  }
});

test("closed sockets and predecoded channels cannot bypass byte/connection bounds", async t => {
  for (const kind of ["closed", "decoded"]) {
    const options = await fixture(t, (socket, request) => socket.end(encode(events(request.operation_id))));
    if (kind === "closed") { options.channel.destroy(); await once(options.channel, "close"); }
    else options.channel.setEncoding("utf8");
    await assert.rejects(withNativeLaunchBridge(options), {
      code: kind === "closed" ? "NATIVE_BRIDGE_CHANNEL" : "NATIVE_BRIDGE_CHANNEL_BYTES",
    });
    await busy(options.resourceBudget);
  }
});
