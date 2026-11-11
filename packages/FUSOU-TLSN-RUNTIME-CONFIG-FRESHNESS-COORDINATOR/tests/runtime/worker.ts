import {
  LocalTestFreshnessIssueCoordinatorDO,
  LocalTestReleaseLedgerCoordinatorDO,
} from "./local-test-coordinator.ts";
import {
  decodeRuntimeRpcValue,
  encodeRuntimeRpcValue,
  MAX_RUNTIME_RPC_REQUEST_BYTES,
  RUNTIME_RPC_PATH,
} from "./rpc-data.ts";

export {
  LocalTestFreshnessIssueCoordinatorDO,
  LocalTestReleaseLedgerCoordinatorDO,
};

// This entrypoint is bundled only by the loopback runtime harness, never Production.
const RPC_METHOD_NAMES = [
  "appendReleaseRecord",
  "armDelayedPointerWriteForLocalTest",
  "attemptAppendReleaseRecordForLocalTest",
  "attemptBeginOrGetForLocalTest",
  "attemptBeginReleaseOperationForLocalTest",
  "attemptClearReleasePointerForLocalTest",
  "attemptGetReleaseOperationForLocalTest",
  "attemptMarkResultUnknownForLocalTest",
  "attemptReadReleaseLedgerHeadForLocalTest",
  "attemptRejectBeforeSignerForLocalTest",
  "attemptStageReleaseManifestForLocalTest",
  "beginOrGet",
  "beginCloudflareOperatorBindingInstall",
  "beginCloudflareOperatorIssue",
  "claimCloudflareOperatorIssueSigning",
  "beginReleaseBindingInstall",
  "beginReleaseForLocalTest",
  "beginReleaseOperation",
  "bootstrapInitialReleaseCheckpointForLocalTest",
  "bootstrapCloudflareOperatorProfileForLocalTest",
  "bootstrapLocalTestState",
  "bootstrapReleaseLedgerForLocalTest",
  "checkLease",
  "clearReleasePointerForLocalTest",
  "completeReleaseForLocalTest",
  "corruptCoordinatorStateForLocalTest",
  "corruptReleaseOperationBindingForLocalTest",
  "deleteCoordinatorStateForLocalTest",
  "deleteReleaseLedgerHeadForLocalTest",
  "failNextR2ReadbackForLocalTest",
  "finalizeIfCurrent",
  "finalizeCloudflareOperatorBindingInstall",
  "finalizeCloudflareOperatorIssue",
  "finalizeReleaseBindingInstall",
  "finalizeReleaseR2Readback",
  "getOperation",
  "getCloudflareOperatorBindingInstall",
  "getCloudflareOperatorIssue",
  "getReleaseBindingInstall",
  "getReleaseOperation",
  "inspectOperationForLocalTest",
  "inspectStateForLocalTest",
  "loseNextAppendResponseForLocalTest",
  "markReleaseOperationUnknown",
  "markResultUnknown",
  "markCloudflareOperatorIssueUnknown",
  "mismatchNextPointerEtagForLocalTest",
  "publishBaselineManifestForLocalTest",
  "readClock",
  "readCloudflareOperatorReleaseSnapshot",
  "readCloudflareOperatorIssueReleaseSnapshot",
  "readCurrentStateSnapshot",
  "readReleaseLedgerHead",
  "reconcileReleaseOperation",
  "rejectBeforeSigner",
  "rejectCompletedSigner",
  "releaseDelayedPointerWriteForLocalTest",
  "rejectCloudflareOperatorIssue",
  "restoreCoordinationStateForLocalTest",
  "setClockForLocalTest",
  "setCloudflareOperatorObservedUtcForLocalTest",
  "setCloudflareOperatorRuntimeUtcSequenceForLocalTest",
  "setNextFenceForLocalTest",
  "setWitnessForLocalTest",
  "stageReleaseManifest",
  "waitForDelayedPointerWriteForLocalTest",
  "writeReleaseObjectForLocalTest"
] as const satisfies readonly (
  keyof LocalTestFreshnessIssueCoordinatorDO | keyof LocalTestReleaseLedgerCoordinatorDO
)[];
const RPC_METHODS: ReadonlySet<string> = new Set(RPC_METHOD_NAMES);

interface RuntimeTestEnv {
  FRESHNESS_ISSUE_COORDINATOR: DurableObjectNamespace<LocalTestReleaseLedgerCoordinatorDO>;
}

export default {
  async fetch(request: Request, env: RuntimeTestEnv): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== RUNTIME_RPC_PATH) {
      return new Response("Not Found", { status: 404 });
    }
    let input: unknown;
    try {
      input = await readBoundedJson(request);
    } catch {
      return new Response("Invalid runtime RPC request", { status: 400 });
    }
    if (!isRequest(input)) return new Response("Invalid runtime RPC request", { status: 400 });
    let args: unknown;
    try {
      args = decodeRuntimeRpcValue(input.args);
    } catch {
      return new Response("Invalid runtime RPC arguments", { status: 400 });
    }
    if (!Array.isArray(args)) return new Response("Invalid runtime RPC arguments", { status: 400 });

    const namespace = env.FRESHNESS_ISSUE_COORDINATOR;
    const stub = namespace.get(namespace.idFromString(input.id));
    let call: unknown;
    let result: unknown;
    try {
      const method: unknown = Reflect.get(stub, input.method);
      if (typeof method !== "function") throw new TypeError("Runtime RPC method is unavailable");
      call = Reflect.apply(method, stub, args);
      result = await call;
      // Serialize the DTO while the RPC result is still owned in this context.
      return Response.json({ ok: true, result: encodeRuntimeRpcValue(result) });
    } catch (error) {
      return Response.json({
        ok: false,
        error: {
          name: error instanceof Error ? error.name : "NonErrorThrow",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      // Node's Miniflare namespace proxy cannot forward Symbol.dispose. Keep
      // real DO RPC handles here and dispose them before returning plain data.
      disposeRpcResource(result);
      disposeRpcResource(call);
    }
  },
};

function disposeRpcResource(value: unknown): void {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
  const dispose: unknown = Reflect.get(value, Symbol.dispose);
  if (typeof dispose === "function") Reflect.apply(dispose, value, []);
}

function isRequest(value: unknown): value is { id: string; method: string; args: unknown } {
  return value !== null && typeof value === "object" &&
    "id" in value && typeof value.id === "string" && /^[a-f0-9]{64}$/.test(value.id) &&
    "method" in value && typeof value.method === "string" && RPC_METHODS.has(value.method) &&
    "args" in value && Object.keys(value).sort().join(",") === "args,id,method";
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (request.body === null) throw new TypeError("Missing runtime RPC body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      length += value.byteLength;
      if (length > MAX_RUNTIME_RPC_REQUEST_BYTES) throw new RangeError("Runtime RPC body exceeds limit");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    try { if (!complete) await reader.cancel(); } finally { reader.releaseLock(); }
  }
}
