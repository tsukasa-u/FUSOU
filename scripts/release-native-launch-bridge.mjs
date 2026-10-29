import { addAbortListener } from "node:events";
import { Socket } from "node:net";
import { ReleaseBlocked } from "./release-transport.mjs";
import { retainNativeLaunchOperation, withNativeInspectionBudget } from "./release-native-resources.mjs";

const transitions = Object.freeze({
  PREPARING: ["CHILD_CREATED", "STOPPING", "QUARANTINED"],
  CHILD_CREATED: ["EXEC_OBSERVED", "STOPPING", "QUARANTINED"],
  EXEC_OBSERVED: ["CAPTURING", "STOPPING", "QUARANTINED"],
  CAPTURING: ["STOPPING", "QUARANTINED"], STOPPING: ["REAPED", "QUARANTINED"],
  REAPED: ["TREE_EMPTY", "QUARANTINED"], TREE_EMPTY: ["CAPTURE_COMPLETE", "QUARANTINED"],
  CAPTURE_COMPLETE: ["CLEANUP_CONFIRMED", "QUARANTINED"],
});
const blocked = (code) => new ReleaseBlocked(code, "BLOCKED_IMPLEMENTATION");

export async function withNativeLaunchBridge({ resourceBudget, signal, reservation, channel, cleanupTimeoutMs }) {
  return withNativeInspectionBudget(resourceBudget, signal, async (scope) => {
    scope.charge(65536);
    const hold = retainNativeLaunchOperation(scope, reservation);
    let phase, nativeId, sequence = 0, frames = 0, total = 0, pending = "", result, failure;
    let settled = false, cleanupPending = false;
    const fail = (code) => {
      hold.quarantine(); failure ??= blocked(code);
      if (channel instanceof Socket) channel.destroy();
    };
    const control = (action) => {
      channel.write(JSON.stringify({ operation_id: hold.operationId, action,
        ...(action === "START" ? { reservation: hold.reservation } : {}) }) + "\n");
    };
    const abort = () => {
      try { control("CANCEL"); } catch { fail("NATIVE_BRIDGE_CANCEL_CHANNEL"); }
    };
    const onData = (raw) => {
      if (settled || failure) return;
      if (!Buffer.isBuffer(raw)) { fail("NATIVE_BRIDGE_CHANNEL_BYTES"); return; }
      total += raw.byteLength;
      if (total > 16384) { fail("NATIVE_BRIDGE_BYTE_LIMIT"); channel.destroy(); return; }
      pending += raw.toString("utf8");
      if (pending.length > 1024 && !pending.includes("\n")) {
        fail("NATIVE_BRIDGE_FRAME_LIMIT"); channel.destroy(); return;
      }
      for (;;) {
        const end = pending.indexOf("\n");
        if (end < 0) break;
        const text = pending.slice(0, end); pending = pending.slice(end + 1);
        if (++frames > 16 || end > 1024) { fail("NATIVE_BRIDGE_FRAME_LIMIT"); break; }
        let event;
        try { event = JSON.parse(text); }
        catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          fail("NATIVE_BRIDGE_JSON"); break;
        }
        if (!event || Object.getPrototypeOf(event) !== Object.prototype ||
          Object.keys(event).sort().join() !== "native_id,operation_id,outcome,sequence,state,usage,version" ||
          event.version !== 1 || event.operation_id !== hold.operationId ||
          !Number.isSafeInteger(event.native_id) || event.native_id <= 0 ||
          (nativeId !== undefined && event.native_id !== nativeId) ||
          event.sequence !== sequence + 1 ||
          !["PENDING", "SUCCEEDED", "FAILED"].includes(event.outcome) ||
          (sequence === 0 ? event.state !== "PREPARING" : !transitions[phase]?.includes(event.state))) {
          fail("NATIVE_BRIDGE_TRANSITION"); break;
        }
        nativeId = event.native_id; sequence = event.sequence; phase = event.state;
        const canonical = { native_id: event.native_id, operation_id: event.operation_id, outcome: event.outcome,
          sequence: event.sequence, state: event.state, usage: event.usage, version: event.version };
        if (text !== JSON.stringify(canonical)) { fail("NATIVE_BRIDGE_CANONICAL_JSON"); break; }
        if (phase === "QUARANTINED") { fail("NATIVE_BRIDGE_QUARANTINED"); break; }
        if (phase === "CLEANUP_CONFIRMED") {
          if (event.outcome === "PENDING") { fail("NATIVE_BRIDGE_OUTCOME"); break; }
          if (!event.usage || Object.getPrototypeOf(event.usage) !== Object.prototype ||
            Object.keys(event.usage).sort().join() !== Object.keys(hold.reservation).sort().join() ||
            Object.entries(event.usage).some(([key, value]) => !Number.isSafeInteger(value) ||
              value < 0 || value > hold.reservation[key])) { fail("NATIVE_BRIDGE_USAGE"); break; }
          result = Object.freeze({ operation_id: hold.operationId, native_id: nativeId,
            state: phase, outcome: event.outcome, usage: Object.freeze(event.usage), approval: "UNAPPROVED",
            authenticated: false, publication_authorized: false });
        } else if (event.outcome !== "PENDING" || event.usage !== null) { fail("NATIVE_BRIDGE_OUTCOME"); break; }
      }
    };
    try {
      if (!(channel instanceof Socket) || channel.pending || channel.remoteAddress !== undefined) {
        throw blocked("NATIVE_BRIDGE_CHANNEL");
      }
      if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs <= 0 || cleanupTimeoutMs > 2 ** 31 - 1) {
        throw blocked("NATIVE_BRIDGE_CLEANUP_LIMIT_REQUIRED");
      }
      const done = new Promise((resolve) => {
        channel.on("data", onData);
        channel.once("error", () => { fail("NATIVE_BRIDGE_CHANNEL"); });
        channel.once("close", () => {
          settled = true;
          if (pending || !result) fail("NATIVE_BRIDGE_INCOMPLETE");
          resolve();
        });
      });
      const cancellation = addAbortListener(scope.signal, abort);
      const timer = setTimeout(() => {
        fail("NATIVE_BRIDGE_CLEANUP_TIMEOUT"); channel.destroy();
      }, cleanupTimeoutMs);
      control("START");
      const completion = done.then(() => {
        clearTimeout(timer); cancellation[Symbol.dispose]();
        if (failure) throw failure;
        hold.cleanup();
        return result;
      });
      cleanupPending = true;
      return await hold.wait(() => completion);
    } catch (error) {
      if (!cleanupPending || !scope.signal.aborted) {
        hold.quarantine();
        if (channel instanceof Socket) channel.destroy();
      }
      throw error;
    }
  });
}
