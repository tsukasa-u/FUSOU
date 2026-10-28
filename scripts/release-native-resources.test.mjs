import assert from "node:assert/strict";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { assertNativeResourceScope, createNativeInspectionBudget, withNativeInspectionBudget,
  withNativeInspectionBudgetSync } from "./release-native-resources.mjs";
import { nativeResourceFixtureBudget, nativeResourceFixtureLimits } from "./release-native-attestation-fixture.mjs";

const code = (expected) => (error) => { assert.ok(Object.isFrozen(error)); return error.code === expected; };

test("resource limits are required, finite, complete and explicitly unapproved", async () => {
  for (const limits of [undefined, {}, { ...nativeResourceFixtureLimits, extra: 1 },
    ...[0, -1, 0.5, Infinity, "1"].map((max_bytes) => ({ ...nativeResourceFixtureLimits, max_bytes })),
    { ...nativeResourceFixtureLimits, max_json_depth: 65 },
    { ...nativeResourceFixtureLimits, timeout_ms: 2 ** 31 },
    { ...nativeResourceFixtureLimits, max_bytes: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => createNativeInspectionBudget(limits), code("NATIVE_RESOURCE_LIMITS_INVALID"));
  }
  assert.equal(nativeResourceFixtureBudget().approval, "UNAPPROVED");
  await assert.rejects(withNativeInspectionBudget({}, undefined, () => assert.fail("forged budget")),
    code("NATIVE_RESOURCE_BUDGET_MISSING"));
  assert.throws(() => assertNativeResourceScope({ check() { assert.fail("forged scope"); } }),
    code("NATIVE_RESOURCE_SCOPE_MISSING"));
});
test("aggregate byte-work includes multiple owned copies at below/equal/above boundaries", () => {
  for (const max_bytes of [7, 8, 9]) {
    const run = () => withNativeInspectionBudgetSync(nativeResourceFixtureBudget({ max_bytes }), (scope) => {
      scope.copy(Buffer.from("abcd")); return scope.copy(Buffer.from("efgh"));
    });
    if (max_bytes === 7) assert.throws(run, code("NATIVE_RESOURCE_BYTES_EXCEEDED"));
    else assert.deepEqual(run(), Buffer.from("efgh"));
  }
});
test("admission values and branded scope methods cannot be replaced after validation", () => {
  const limits = { ...nativeResourceFixtureLimits, max_bytes: 8 }, budget = createNativeInspectionBudget(limits);
  limits.max_bytes = 100;
  assert.throws(() => withNativeInspectionBudgetSync(budget, (scope) => scope.copy(Buffer.alloc(9))),
    code("NATIVE_RESOURCE_BYTES_EXCEEDED"));
  withNativeInspectionBudgetSync(budget, (scope) => {
    assert.ok(Object.isFrozen(scope));
    assert.throws(() => { scope.charge = () => {}; }, TypeError);
  });
  const accessor = { ...nativeResourceFixtureLimits };
  Object.defineProperty(accessor, "max_bytes", { enumerable: true, get() { assert.fail("budget accessor executed"); } });
  assert.throws(() => createNativeInspectionBudget(accessor), code("NATIVE_RESOURCE_LIMITS_INVALID"));
});
test("JSON decoding and serialization byte-work are charged once at the exact modeled boundary", () => {
  for (const max_bytes of [64, 65, 66]) {
    const run = () => withNativeInspectionBudgetSync(nativeResourceFixtureBudget({ max_bytes }),
      (scope) => scope.jsonText(Buffer.from('["abc"]')));
    if (max_bytes === 64) assert.throws(run, code("NATIVE_RESOURCE_BYTES_EXCEEDED"));
    else assert.equal(run(), '["abc"]');
  }
});
test("read and capture work is bounded and counters reset after rejection", () => {
  const budget = nativeResourceFixtureBudget({ max_reads: 1, max_captures: 1 });
  for (const method of ["read", "capture"]) {
    assert.throws(() => withNativeInspectionBudgetSync(budget, (scope) => { scope[method](); scope[method](); }),
      code(method === "read" ? "NATIVE_RESOURCE_READS_EXCEEDED" : "NATIVE_RESOURCE_CAPTURES_EXCEEDED"));
    withNativeInspectionBudgetSync(budget, (scope) => scope[method]());
  }
});
test("JSON depth, node and raw string boundaries are checked before recursive parsing", () => {
  for (const [limits, accepted, rejected, error] of [
    [{ max_json_depth: 2 }, "[[]]", "[[[]]]", "NATIVE_RESOURCE_DEPTH_EXCEEDED"],
    [{ max_json_nodes: 3 }, "[0,0]", "[0,0,0]", "NATIVE_RESOURCE_NODES_EXCEEDED"],
    [{ max_string_length: 3 }, '"abc"', '"abcd"', "NATIVE_RESOURCE_STRING_EXCEEDED"],
    [{ max_json_bytes: 3 }, "[0]", "[00]", "NATIVE_RESOURCE_JSON_BYTES_EXCEEDED"],
  ]) {
    const budget = nativeResourceFixtureBudget(limits);
    assert.equal(withNativeInspectionBudgetSync(budget, (scope) => scope.jsonText(Buffer.from(accepted))), accepted);
    assert.throws(() => withNativeInspectionBudgetSync(budget, (scope) => scope.jsonText(Buffer.from(rejected))), code(error));
  }
});
test("configuration snapshots accept only bounded JSON trees, not shared-memory or exotic containers", () => {
  const cycle = {}; cycle.self = cycle;
  for (const value of [new Map(), new Set(), Buffer.from("abc"), new Uint8Array(4),
    new SharedArrayBuffer(4), cycle, [,,], { get secret() { assert.fail("accessor must not execute"); } }]) {
    assert.throws(() => withNativeInspectionBudgetSync(nativeResourceFixtureBudget(), (scope) => scope.object(value)),
      code("NATIVE_GH_INPUT_UNCLONEABLE"));
  }
  assert.throws(() => withNativeInspectionBudgetSync(nativeResourceFixtureBudget({ max_json_nodes: 8 }),
    (scope) => scope.object(new Array(9))), code("NATIVE_RESOURCE_NODES_EXCEEDED"));
  withNativeInspectionBudgetSync(nativeResourceFixtureBudget(), (scope) => scope.object({ a: [null, true, "text", 1] }));
});
test("a shared budget rejects excess concurrency without queueing or retrying", async () => {
  const budget = nativeResourceFixtureBudget({ max_concurrent_operations: 1 });
  let finish;
  const held = withNativeInspectionBudget(budget, undefined, (scope) => scope.wait(() => new Promise((resolve) => { finish = resolve; })));
  await setImmediate();
  await assert.rejects(withNativeInspectionBudget(budget, undefined, () => 1), code("NATIVE_RESOURCE_BUSY"));
  finish(1); assert.equal(await held, 1);
  assert.equal(await withNativeInspectionBudget(budget, undefined, () => 2), 2);
});
test("cancellation hides caller reasons and retains the slot until uncooperative work settles", async () => {
  for (const settlement of ["resolve", "reject"]) {
    const budget = nativeResourceFixtureBudget({ max_concurrent_operations: 1 }), controller = new AbortController();
    let finish;
    const held = withNativeInspectionBudget(budget, controller.signal,
      (scope) => scope.wait(() => new Promise((resolve, reject) => { finish = settlement === "resolve" ? resolve : reject; })));
    await setImmediate(); controller.abort(new Error("synthetic credential marker"));
    await assert.rejects(held, (error) => error.code === "NATIVE_RESOURCE_ABORTED" &&
      !error.message.includes("synthetic credential marker"));
    await assert.rejects(withNativeInspectionBudget(budget, undefined, () => 1), code("NATIVE_RESOURCE_BUSY"));
    finish(new Error("synthetic late settlement")); await setImmediate();
    assert.equal(await withNativeInspectionBudget(budget, undefined, () => 2), 2);
  }
});
test("a nonresponsive mock times out without freeing its outstanding-work slot", async () => {
  const budget = nativeResourceFixtureBudget({ timeout_ms: 20, max_concurrent_operations: 1 });
  let finish;
  const held = withNativeInspectionBudget(budget, undefined,
    (scope) => scope.wait(() => new Promise((resolve) => { finish = resolve; })));
  await assert.rejects(held, code("NATIVE_RESOURCE_TIMEOUT"));
  await assert.rejects(withNativeInspectionBudget(budget, undefined, () => 1), code("NATIVE_RESOURCE_BUSY"));
  finish(); await setImmediate();
  await withNativeInspectionBudget(budget, undefined, () => 1);
});
test("operation body timeout covers promises that do not call scope.wait", async () => {
  const budget = nativeResourceFixtureBudget({ timeout_ms: 20, max_concurrent_operations: 1 });
  let finish;
  const operation = withNativeInspectionBudget(budget, undefined, () => new Promise((resolve) => { finish = resolve; }));
  const observed = operation.then(() => "unexpected success", (error) => error.code);
  try {
    assert.equal(await Promise.race([observed, delay(100).then(() => "deadline did not return")]), "NATIVE_RESOURCE_TIMEOUT");
    await assert.rejects(withNativeInspectionBudget(budget, undefined, () => 1), code("NATIVE_RESOURCE_BUSY"));
  } finally { finish(); await observed; await setImmediate(); }
  await withNativeInspectionBudget(budget, undefined, () => 1);
});
test("only the owner can dispose an operation scope", () => {
  withNativeInspectionBudgetSync(nativeResourceFixtureBudget(), (scope) => assert.equal("close" in scope, false));
});
test("clock and timer references are captured before caller mutation", (t) => {
  const budget = nativeResourceFixtureBudget();
  withNativeInspectionBudgetSync(budget, (scope) => {
    for (const value of [0, Number.MAX_SAFE_INTEGER]) {
      t.mock.method(performance, "now", () => value);
      scope.check();
      t.mock.restoreAll();
    }
  });
  t.mock.restoreAll();
  t.mock.method(globalThis, "setTimeout", () => assert.fail("caller timer used"));
  t.mock.method(globalThis, "clearTimeout", () => assert.fail("caller timer cleanup used"));
  assert.equal(withNativeInspectionBudgetSync(budget, () => 1), 1);
});
test("async results in the synchronous API are rejected and retained until settlement", async () => {
  const budget = nativeResourceFixtureBudget({ max_concurrent_operations: 1 });
  let finish, result;
  try {
    assert.throws(() => {
      result = withNativeInspectionBudgetSync(budget, () => new Promise((resolve) => { finish = resolve; }));
    }, code("NATIVE_RESOURCE_ASYNC_IN_SYNC"));
    await assert.rejects(withNativeInspectionBudget(budget, undefined, () => 1), code("NATIVE_RESOURCE_BUSY"));
  } finally { finish(); await result; await setImmediate(); }
  await withNativeInspectionBudget(budget, undefined, () => 1);
});
test("an owner cannot report completion with unawaited managed work", async () => {
  const budget = nativeResourceFixtureBudget({ max_concurrent_operations: 1 });
  let finish, observed;
  const operation = withNativeInspectionBudget(budget, undefined, (scope) => {
    const child = scope.wait(() => new Promise((resolve) => { finish = resolve; }));
    observed = child.then(() => "completed", (error) => error.code);
    return "premature success";
  });
  try {
    await assert.rejects(operation, code("NATIVE_RESOURCE_PENDING_WORK"));
    await assert.rejects(withNativeInspectionBudget(budget, undefined, () => 1), code("NATIVE_RESOURCE_BUSY"));
  } finally { finish(); await observed; await setImmediate(); }
  await withNativeInspectionBudget(budget, undefined, () => 1);
});
test("old duplicate completions cannot release a newer operation or another controller", async () => {
  const first = nativeResourceFixtureBudget({ max_concurrent_operations: 1 });
  const other = nativeResourceFixtureBudget({ max_concurrent_operations: 1 });
  let duplicate, finish;
  await withNativeInspectionBudget(first, undefined, (scope) => scope.wait(() => ({
    then(resolve, reject) { duplicate = () => { resolve(2); reject(new Error("late duplicate")); }; resolve(1); },
  })));
  const newer = withNativeInspectionBudget(first, undefined, (scope) =>
    scope.wait(() => new Promise((resolve) => { finish = resolve; })));
  await setImmediate(); duplicate(); await setImmediate();
  await assert.rejects(withNativeInspectionBudget(first, undefined, () => 1), code("NATIVE_RESOURCE_BUSY"));
  assert.equal(await withNativeInspectionBudget(other, undefined, () => 2), 2);
  finish(1); await newer;
});
test("a failed byte reservation is atomic and does not change the remaining amount", () => {
  withNativeInspectionBudgetSync(nativeResourceFixtureBudget({ max_bytes: 8 }), (scope) => {
    scope.charge(4);
    assert.throws(() => scope.charge(5), code("NATIVE_RESOURCE_BYTES_EXCEEDED"));
    scope.charge(4);
    assert.throws(() => scope.charge(1), code("NATIVE_RESOURCE_BYTES_EXCEEDED"));
  });
});
test("caller abort listeners cannot suppress operation cancellation", async () => {
  const budget = nativeResourceFixtureBudget({ max_concurrent_operations: 1 }), controller = new AbortController();
  controller.signal.addEventListener("abort", (event) => event.stopImmediatePropagation());
  let finish;
  const operation = withNativeInspectionBudget(budget, controller.signal,
    () => new Promise((resolve) => { finish = resolve; }));
  const observed = operation.then(() => "unexpected success", (error) => error.code);
  try {
    controller.abort();
    assert.equal(await Promise.race([observed, delay(60).then(() => "abort suppressed")]), "NATIVE_RESOURCE_ABORTED");
  } finally { finish(); await observed; await setImmediate(); }
});
test("timeout late resolve/reject and cancellation-completion races settle once", async () => {
  for (const settlement of ["resolve", "reject"]) {
    const budget = nativeResourceFixtureBudget({ timeout_ms: 20, max_concurrent_operations: 1 });
    let finish;
    const operation = withNativeInspectionBudget(budget, undefined, () =>
      new Promise((resolve, reject) => { finish = settlement === "resolve" ? resolve : reject; }));
    await assert.rejects(operation, code("NATIVE_RESOURCE_TIMEOUT"));
    await assert.rejects(withNativeInspectionBudget(budget, undefined, () => 1), code("NATIVE_RESOURCE_BUSY"));
    finish(new Error("synthetic late completion")); await setImmediate();
    const controller = new AbortController();
    const racing = withNativeInspectionBudget(budget, controller.signal, () => {
      controller.abort(); return Promise.resolve("must not succeed");
    });
    await assert.rejects(racing, code("NATIVE_RESOURCE_ABORTED"));
    await setImmediate();
    assert.equal(await withNativeInspectionBudget(budget, undefined, () => 1), 1);
  }
});
