const TEST_SCOPE = "fusou_freshness_gateway_runtime_test";
const REQUEST_PATH = "/tlsn/runtime-config/v2/freshness/v1";
const EXACT_RESPONSE = new TextEncoder().encode(
  '{\n  "runtime_test": "exact bytes",\n  "reformatted": false\n}\n',
);
const MODES = new Set(["exact", "wait-for-headers", "stream-body", "unexpected"]);
let isolateId;
let nextMode = "exact";
let requestSequence = 0;
let eventSequence = 0;
const recordedEvents = [];

function logEvent(event, mode, requestId) {
  isolateId ??= crypto.randomUUID();
  recordedEvents.push({
    scope: TEST_SCOPE,
    worker: "signer",
    isolate_id: isolateId,
    sequence: ++eventSequence,
    timestamp_ms: Date.now(),
    event,
    ...(mode ? { mode } : {}),
    ...(requestId ? { request_id: requestId } : {}),
  });
  if (recordedEvents.length > 512) recordedEvents.shift();
}

function waitForAbort(request, mode, requestId) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      request.signal.removeEventListener("abort", onAbort);
      resolve(response);
    };
    const onAbort = () => {
      if (settled) return;
      logEvent("signer_fetch_unblocked_by_abort", mode, requestId);
      finish(new Response(null, { status: 499 }));
    };
    const watchdog = setTimeout(() => {
      logEvent("signer_wait_watchdog_elapsed", mode, requestId);
      finish(new Response(null, { status: 504 }));
    }, 15_000);
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) onAbort();
  });
}

function pendingBody(mode, requestId) {
  let pullCount = 0;
  let releasePendingPull;
  const body = new ReadableStream(
    {
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          logEvent("signer_response_body_read_started", mode, requestId);
          controller.enqueue(new Uint8Array([0x7b]));
          return;
        }
        if (pullCount === 2) {
          logEvent("signer_response_body_read_stalled", mode, requestId);
        }
        return new Promise((resolve) => {
          logEvent("signer_response_body_pull_pending", mode, requestId);
          releasePendingPull = () => {
            releasePendingPull = undefined;
            resolve();
            logEvent("signer_response_body_pull_resolved", mode, requestId);
          };
        });
      },
      async cancel() {
        logEvent("signer_response_body_cancel_started", mode, requestId);
        releasePendingPull?.();
        await Promise.resolve();
        logEvent("signer_response_body_cancel_completed", mode, requestId);
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__runtime_test/events" && request.method === "GET") {
      return new Response(JSON.stringify(recordedEvents), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/__runtime_test/ready" && request.method === "GET") {
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__runtime_test/mode" && request.method === "POST") {
      const mode = await request.text();
      if (mode.length > 32 || !MODES.has(mode)) {
        return new Response(null, { status: 400 });
      }
      nextMode = mode;
      logEvent("signer_mode_set", mode);
      return new Response(null, { status: 204 });
    }
    if (request.method !== "POST" || url.pathname !== REQUEST_PATH) {
      return new Response(null, { status: 404 });
    }

    const mode = nextMode;
    nextMode = "exact";
    requestSequence += 1;
    const requestId = requestSequence;
    logEvent("signer_request_received", mode, requestId);
    request.signal.addEventListener(
      "abort",
      () => logEvent("signer_request_signal_aborted", mode, requestId),
      { once: true },
    );
    if (request.signal.aborted) {
      logEvent("signer_request_signal_aborted", mode, requestId);
    }

    if (mode === "wait-for-headers") {
      return waitForAbort(request, mode, requestId);
    }
    if (mode === "stream-body") {
      return pendingBody(mode, requestId);
    }
    if (mode === "unexpected") {
      return new Response(null, { status: 500 });
    }
    return new Response(EXACT_RESPONSE.slice(), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
};
