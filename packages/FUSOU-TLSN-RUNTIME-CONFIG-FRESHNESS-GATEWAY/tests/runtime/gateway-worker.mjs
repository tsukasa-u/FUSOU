import gateway from "../../src/index.ts";

const TEST_SCOPE = "fusou_freshness_gateway_runtime_test";
const OBSERVED_SCENARIOS = new Set([
  "exact-response",
  "request-body-disconnect",
  "signer-headers-disconnect",
  "signer-body-disconnect",
  "gateway-deadline",
  "post-cleanup",
]);
let isolateId;
let eventSequence = 0;
let lastScenario;
const recordedEvents = [];

function logEvent(event, scenario, fields = {}) {
  isolateId ??= crypto.randomUUID();
  recordedEvents.push({
    scope: TEST_SCOPE,
    worker: "gateway",
    isolate_id: isolateId,
    sequence: ++eventSequence,
    timestamp_ms: Date.now(),
    event,
    ...(scenario ? { scenario } : {}),
    ...fields,
  });
  if (recordedEvents.length > 512) recordedEvents.shift();
}

const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  const serialized = args[0];
  if (
    typeof serialized === "string" &&
    serialized.startsWith('{"event":"freshness_gateway_')
  ) {
    const entry = JSON.parse(serialized);
    logEvent(entry.event, lastScenario);
  }
  originalConsoleError(...args);
};

function observeBody(body, source, scenario) {
  if (body === null) return;

  const prefix =
    source === "request"
      ? "gateway_request_body"
      : "gateway_signer_response_body";
  const cancel = body.cancel.bind(body);
  Object.defineProperty(body, "cancel", {
    configurable: true,
    value: async (reason) => {
      logEvent(`${prefix}_cancel_started`, scenario);
      try {
        const result = await cancel(reason);
        logEvent(`${prefix}_cancel_completed`, scenario);
        return result;
      } catch (error) {
        logEvent(`${prefix}_cancel_rejected`, scenario, {
          error_name: error instanceof Error ? error.name : "unknown",
        });
        throw error;
      }
    },
  });

  const getReader = body.getReader.bind(body);
  Object.defineProperty(body, "getReader", {
    configurable: true,
    value(...args) {
      const reader = getReader(...args);
      logEvent(`${prefix}_reader_acquired`, scenario);
      return new Proxy(reader, {
        get(target, property) {
          if (property === "read") {
            return (...readArgs) => {
              logEvent(`${prefix}_read_started`, scenario);
              let pending;
              try {
                pending = target.read(...readArgs);
              } catch (error) {
                logEvent(`${prefix}_read_rejected`, scenario, {
                  error_name: error instanceof Error ? error.name : "unknown",
                });
                throw error;
              }
              return Promise.resolve(pending).then(
                (result) => {
                  logEvent(`${prefix}_read_resolved`, scenario, {
                    done: result.done,
                  });
                  return result;
                },
                (error) => {
                  logEvent(`${prefix}_read_rejected`, scenario, {
                    error_name: error instanceof Error ? error.name : "unknown",
                  });
                  throw error;
                },
              );
            };
          }
          if (property === "cancel") {
            return async (reason) => {
              logEvent(`${prefix}_cancel_started`, scenario);
              try {
                const result = await target.cancel(reason);
                logEvent(`${prefix}_cancel_completed`, scenario);
                return result;
              } catch (error) {
                logEvent(`${prefix}_cancel_rejected`, scenario, {
                  error_name: error instanceof Error ? error.name : "unknown",
                });
                throw error;
              }
            };
          }
          if (property === "releaseLock") {
            return () => {
              const result = target.releaseLock();
              logEvent(`${prefix}_reader_released`, scenario);
              return result;
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  });
}

function observeContext(context, scenario) {
  return {
    waitUntil(promise) {
      logEvent("gateway_cleanup_waituntil_registered", scenario);
      const tracked = Promise.resolve(promise).then(
        () => logEvent("gateway_cleanup_waituntil_settled", scenario),
        (error) => {
          logEvent("gateway_cleanup_waituntil_rejected", scenario, {
            error_name: error instanceof Error ? error.name : "unknown",
          });
          throw error;
        },
      );
      context.waitUntil(tracked);
    },
  };
}

async function setSignerMode(bindings, request) {
  const mode = await request.text();
  const response = await bindings.TLSN_FRESHNESS_SIGNER.fetch(
    new Request("https://freshness-signer.internal/__runtime_test/mode", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: mode,
    }),
  );
  return new Response(null, { status: response.status });
}

export default {
  async fetch(request, bindings, context) {
    const url = new URL(request.url);
    if (url.pathname === "/__runtime_test/observations" && request.method === "GET") {
      if (!bindings.TLSN_FRESHNESS_SIGNER) {
        return new Response(null, { status: 503 });
      }
      const signerResponse = await bindings.TLSN_FRESHNESS_SIGNER.fetch(
        new Request("https://freshness-signer.internal/__runtime_test/events"),
      );
      if (!signerResponse.ok) return new Response(null, { status: 503 });
      const signerEvents = await signerResponse.json();
      return new Response(
        JSON.stringify({ gateway: recordedEvents, signer: signerEvents }),
        { headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === "/__runtime_test/ready" && request.method === "GET") {
      if (!bindings.TLSN_FRESHNESS_SIGNER) {
        return new Response(null, { status: 503 });
      }
      const response = await bindings.TLSN_FRESHNESS_SIGNER.fetch(
        new Request("https://freshness-signer.internal/__runtime_test/ready"),
      );
      return new Response(null, { status: response.status === 204 ? 204 : 503 });
    }
    if (url.pathname === "/__runtime_test/mode" && request.method === "POST") {
      if (!bindings.TLSN_FRESHNESS_SIGNER) {
        return new Response(null, { status: 503 });
      }
      return setSignerMode(bindings, request);
    }
    if (url.pathname.startsWith("/__runtime_test/")) {
      return new Response(null, { status: 404 });
    }

    const scenario = request.headers.get("x-fusou-runtime-test-case");
    if (scenario && OBSERVED_SCENARIOS.has(scenario)) {
      lastScenario = scenario;
      logEvent("gateway_request_received", scenario);
      const onAbort = () =>
        logEvent("gateway_incoming_request_signal_aborted", scenario);
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) onAbort();
      observeBody(request.body, "request", scenario);
      const signerBinding = bindings.TLSN_FRESHNESS_SIGNER;
      const observedBindings = signerBinding
        ? {
            ...bindings,
            TLSN_FRESHNESS_SIGNER: {
              fetch: async (signerRequest) => {
                const onInternalAbort = () =>
                  logEvent("gateway_internal_signal_aborted", scenario, {
                    reason:
                      signerRequest.signal.reason?.message ?? "unknown",
                  });
                signerRequest.signal.addEventListener(
                  "abort",
                  onInternalAbort,
                  { once: true },
                );
                if (signerRequest.signal.aborted) onInternalAbort();
                logEvent("gateway_signer_fetch_started", scenario);
                try {
                  const signerResponse =
                    await signerBinding.fetch(signerRequest);
                  logEvent("gateway_signer_response_received", scenario, {
                    status: signerResponse.status,
                  });
                  observeBody(signerResponse.body, "signer-response", scenario);
                  return signerResponse;
                } catch (error) {
                  logEvent("gateway_signer_fetch_rejected", scenario, {
                    error_name:
                      error instanceof Error ? error.name : "unknown",
                  });
                  throw error;
                }
              },
            },
          }
        : bindings;
      const response = await gateway.fetch(
        request,
        observedBindings,
        observeContext(context, scenario),
      );
      logEvent("gateway_operation_returned", scenario, {
        status: response.status,
      });
      return response;
    }

    return gateway.fetch(request, bindings, context);
  },
};
