const TEST_SCOPE = "fusou_freshness_gateway_runtime_test";
const PROBE_WINDOW_MS = 7_500;
let isolateId;
let eventSequence = 0;
const recordedEvents = [];

function logEvent(event, scenario, fields = {}) {
  isolateId ??= crypto.randomUUID();
  recordedEvents.push({
    scope: TEST_SCOPE,
    worker: "probe",
    isolate_id: isolateId,
    sequence: ++eventSequence,
    timestamp_ms: Date.now(),
    event,
    ...(scenario ? { scenario } : {}),
    ...fields,
  });
  if (recordedEvents.length > 256) recordedEvents.shift();
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__signal_probe/ready" && request.method === "GET") {
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__signal_probe/config" && request.method === "GET") {
      return Response.json({ window_ms: PROBE_WINDOW_MS });
    }
    if (
      url.pathname === "/__signal_probe/events" &&
      request.method === "GET"
    ) {
      return new Response(JSON.stringify(recordedEvents), {
        headers: { "content-type": "application/json" },
      });
    }

    const scenario =
      request.headers.get("x-fusou-runtime-test-case") ?? "unspecified";
    logEvent("probe_request_received", scenario);
    const outcome = await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        request.signal.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () => {
        logEvent("probe_request_signal_aborted", scenario);
        finish("signal");
      };
      const watchdog = setTimeout(() => {
        logEvent("probe_signal_window_elapsed", scenario);
        finish("watchdog");
      }, PROBE_WINDOW_MS);
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) onAbort();
    });
    logEvent("probe_request_finished", scenario, { outcome });
    return new Response(null, { status: 204 });
  },
};
