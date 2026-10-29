import { ReleaseBlocked } from "./release-transport.mjs";
import { MAX_RELEASE_RECORD_BYTES } from "./release-bytes.mjs";
import { performance } from "node:perf_hooks";
import { setTimeout as nodeSetTimeout, clearTimeout as nodeClearTimeout } from "node:timers";
import { addAbortListener } from "node:events";

const now = performance.now.bind(performance), schedule = nodeSetTimeout, cancelTimer = nodeClearTimeout;
const allocateOwnedBytes = Buffer.allocUnsafeSlow, setBytes = Uint8Array.prototype.set;
const typedArrayAccessors = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(Uint8Array.prototype));
const budgets = new WeakMap(), scopes = new WeakMap(), errors = new WeakSet();
const fields = ["max_bytes", "max_reads", "max_captures", "max_json_bytes", "max_json_nodes",
  "max_json_depth", "max_string_length", "max_concurrent_operations", "timeout_ms"];
const fail = (code) => {
  const error = new ReleaseBlocked(code, "BLOCKED_IMPLEMENTATION");
  errors.add(Object.freeze(error)); throw error;
};
export const isNativeResourceError = (error) => errors.has(error);

export function createNativeInspectionBudget(limits) {
  if (!limits || typeof limits !== "object" || Object.keys(limits).length !== fields.length) {
    fail("NATIVE_RESOURCE_LIMITS_INVALID");
  }
  const owned = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(limits, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value") ||
      !Number.isSafeInteger(descriptor.value) || descriptor.value <= 0) fail("NATIVE_RESOURCE_LIMITS_INVALID");
    owned[key] = descriptor.value;
  }
  if (owned.max_json_bytes > MAX_RELEASE_RECORD_BYTES || owned.max_json_depth > 64 ||
    owned.timeout_ms > 2 ** 31 - 1 ||
    !Number.isSafeInteger(owned.max_bytes * owned.max_concurrent_operations)) fail("NATIVE_RESOURCE_LIMITS_INVALID");
  const budget = Object.freeze({ scope: "native-inspection-admission", approval: "UNAPPROVED" });
  budgets.set(budget, { limits: Object.freeze(owned), active: 0 });
  return budget;
}

export function assertNativeResourceScope(scope) {
  if (!scopes.has(scope)) fail("NATIVE_RESOURCE_SCOPE_MISSING");
  scope.check();
}

export function parseNativeInspectionJson(raw, scope) {
  assertNativeResourceScope(scope);
  let text;
  try { text = scope.jsonText(raw); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    fail("NATIVE_RESOURCE_JSON_INVALID_UTF8");
  }
  let value;
  try { value = JSON.parse(text); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    fail("NATIVE_RESOURCE_JSON_INVALID");
  }
  const containers = [];
  for (let index = 0; index < text.length; index++) {
    scope.check();
    const character = text[index];
    if (character === "{") containers.push(new Set());
    else if (character === "[") containers.push(null);
    else if (character === "}" || character === "]") containers.pop();
    else if (character === '"') {
      const start = index++;
      for (; text[index] !== '"'; index++) if (text[index] === "\\") index++;
      let next = index + 1;
      while (" \t\r\n".includes(text[next]) && next < text.length) next++;
      if (text[next] === ":") {
        const key = JSON.parse(text.slice(start, index + 1)), keys = containers.at(-1);
        if (keys.has(key)) fail("NATIVE_RESOURCE_JSON_DUPLICATE_KEY");
        keys.add(key);
      }
    }
  }
  scope.object(value);
  return value;
}

function enter(budget, signal) {
  const state = budgets.get(budget);
  if (!state) fail("NATIVE_RESOURCE_BUDGET_MISSING");
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail("NATIVE_RESOURCE_SIGNAL_INVALID");
  if (signal?.aborted) fail("NATIVE_RESOURCE_ABORTED");
  if (state.active >= state.limits.max_concurrent_operations) fail("NATIVE_RESOURCE_BUSY");
  state.active++;
  const limits = state.limits, controller = new AbortController(), deadline = now() + limits.timeout_ms;
  let bytes = 0, reads = 0, captures = 0, pending = 0, closed = false, released = false, timedOut = false;
  const abort = () => controller.abort();
  const callerAbort = signal ? addAbortListener(signal, abort) : undefined;
  const timer = schedule(() => { timedOut = true; abort(); }, limits.timeout_ms);
  const release = () => {
    if (closed && !pending && !released) { released = true; state.active--; }
  };
  const check = () => {
    if (timedOut || now() >= deadline) fail("NATIVE_RESOURCE_TIMEOUT");
    if (controller.signal.aborted) fail("NATIVE_RESOURCE_ABORTED");
    if (closed) fail("NATIVE_RESOURCE_SCOPE_CLOSED");
  };
  const charge = (amount) => {
    check();
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > limits.max_bytes - bytes) {
      fail("NATIVE_RESOURCE_BYTES_EXCEEDED");
    }
    bytes += amount;
  };
  const string = (value) => {
    if (value.length > limits.max_string_length) fail("NATIVE_RESOURCE_STRING_EXCEEDED");
    return 6 * value.length + 2;
  };
  const object = (value) => {
    let nodes = 0, size = 0;
    const ancestors = new WeakSet();
    function* children(item) {
      let indices = 0;
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        if (Array.isArray(item) && key !== String(indices++)) fail("NATIVE_GH_INPUT_UNCLONEABLE");
        size += string(key) + 2;
        if (++nodes > limits.max_json_nodes) fail("NATIVE_RESOURCE_NODES_EXCEEDED");
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("NATIVE_GH_INPUT_UNCLONEABLE");
        yield descriptor.value;
      }
      if (Array.isArray(item) && indices !== item.length) fail("NATIVE_GH_INPUT_UNCLONEABLE");
    }
    const stack = [{ values: [value][Symbol.iterator](), depth: 0 }];
    while (stack.length) {
      check();
      const frame = stack.at(-1), next = frame.values.next();
      if (next.done) { if (frame.owner) ancestors.delete(frame.owner); stack.pop(); continue; }
      if (++nodes > limits.max_json_nodes) fail("NATIVE_RESOURCE_NODES_EXCEEDED");
      const item = next.value;
      if (typeof item === "string") size += string(item);
      else if (item === null || typeof item === "boolean") size += 5;
      else if (typeof item === "number" && Number.isFinite(item)) size += 32;
      else if (item && typeof item === "object" &&
        (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
        if (Array.isArray(item) && (item.length > limits.max_json_nodes || item.length > limits.max_json_bytes)) {
          fail("NATIVE_RESOURCE_NODES_EXCEEDED");
        }
        if (ancestors.has(item)) fail("NATIVE_GH_INPUT_UNCLONEABLE");
        if (frame.depth >= limits.max_json_depth) fail("NATIVE_RESOURCE_DEPTH_EXCEEDED");
        ancestors.add(item); size += 2;
        stack.push({ values: children(item), depth: frame.depth + 1, owner: item });
      } else fail("NATIVE_GH_INPUT_UNCLONEABLE");
      if (size > limits.max_json_bytes) fail("NATIVE_RESOURCE_JSON_BYTES_EXCEEDED");
    }
    charge(2 * size);
  };
  const jsonText = (raw) => {
    check();
    if (!(raw instanceof Uint8Array) || raw.byteLength > limits.max_json_bytes) fail("NATIVE_RESOURCE_JSON_BYTES_EXCEEDED");
    charge(3 * raw.byteLength);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
    let depth = 0, nodes = 0, size = 0;
    for (let i = 0; i < text.length; i++) {
      check();
      const c = text[i];
      if (c === '"') {
        const start = ++i;
        for (; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
        if (i - start > limits.max_string_length) fail("NATIVE_RESOURCE_STRING_EXCEEDED");
        size += 6 * (i - start) + 2;
        nodes++;
      } else if (c === "[" || c === "{") {
        if (++depth > limits.max_json_depth) fail("NATIVE_RESOURCE_DEPTH_EXCEEDED");
        nodes++; size += 2;
      } else if (c === "]" || c === "}") depth--;
      else if (c === "," || c === ":") size++;
      else if (!/[\s,:]/.test(c)) {
        nodes++; size += 32;
        while (i + 1 < text.length && !/[\s,\]}:]/.test(text[i + 1])) i++;
      }
      if (nodes > limits.max_json_nodes) fail("NATIVE_RESOURCE_NODES_EXCEEDED");
    }
    charge(2 * size);
    return text;
  };
  const retain = (task) => {
    pending++;
    const settled = () => { pending--; release(); };
    Promise.resolve(task).then(settled, settled);
  };
  const wait = (action, eager = false) => {
    check(); pending++;
    const task = eager ? new Promise((resolve) => resolve(action())) :
      Promise.resolve().then(() => { check(); return action(); });
    const settled = () => { pending--; release(); };
    task.then(settled, settled);
    return new Promise((resolve, reject) => {
      const cancelled = () => {
        try { check(); } catch (error) { reject(error); }
      };
      const cancellation = addAbortListener(controller.signal, cancelled);
      task.then((result) => {
        cancellation[Symbol.dispose]();
        try { check(); resolve(result); } catch (error) { reject(error); }
      }, (error) => { cancellation[Symbol.dispose](); reject(error); });
      if (controller.signal.aborted) cancelled();
    });
  };
  const scope = {
    check, object, jsonText, charge, wait: (action) => wait(action), signal: controller.signal,
    collection(count) {
      check();
      if (!Number.isSafeInteger(count) || count < 0 || count > limits.max_json_nodes) fail("NATIVE_RESOURCE_NODES_EXCEEDED");
      charge(32 * count);
    },
    recordEntries(value) {
      check();
      if (!value || typeof value !== "object" ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
        fail("NATIVE_GH_INPUT_UNCLONEABLE");
      }
      const entries = [];
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (entries.length >= limits.max_json_nodes) fail("NATIVE_RESOURCE_NODES_EXCEEDED");
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (!property || !Object.hasOwn(property, "value")) fail("NATIVE_GH_INPUT_UNCLONEABLE");
        charge(32 + 2 * string(key));
        entries.push([key, property.value]);
      }
      return entries;
    },
    read() { check(); if (++reads > limits.max_reads) fail("NATIVE_RESOURCE_READS_EXCEEDED"); },
    capture() { check(); if (++captures > limits.max_captures) fail("NATIVE_RESOURCE_CAPTURES_EXCEEDED"); },
    allocate(length) {
      charge(length);
      return allocateOwnedBytes(length);
    },
    copy(raw) {
      if (!(raw instanceof Uint8Array) || typedArrayAccessors.buffer.get.call(raw) instanceof SharedArrayBuffer) {
        fail("NATIVE_GH_INPUT_UNCLONEABLE");
      }
      const length = typedArrayAccessors.byteLength.get.call(raw);
      charge(length);
      const owned = allocateOwnedBytes(length);
      setBytes.call(owned, raw);
      return owned;
    },
  };
  scopes.set(scope, {
    run: (action) => wait(action, true),
    retain,
    finish() { check(); if (pending) fail("NATIVE_RESOURCE_PENDING_WORK"); },
    close() {
      closed = true; cancelTimer(timer); callerAbort?.[Symbol.dispose]();
      if (pending) abort();
      release();
    },
  });
  return Object.freeze(scope);
}

export async function withNativeInspectionBudget(budget, signal, action) {
  const scope = enter(budget, signal), owner = scopes.get(scope);
  // Start synchronously so native entry snapshots still precede the first asynchronous turn.
  try { const result = await owner.run(() => action(scope)); owner.finish(); return result; }
  finally { owner.close(); }
}

export function withNativeInspectionBudgetSync(budget, action) {
  const scope = enter(budget), owner = scopes.get(scope);
  try {
    const result = action(scope);
    if (result && typeof result.then === "function") {
      owner.retain(result);
      fail("NATIVE_RESOURCE_ASYNC_IN_SYNC");
    }
    owner.finish(); return result;
  } finally { owner.close(); }
}
