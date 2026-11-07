import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
  createRuntimeConfigFreshnessRequest,
  runtimeConfigFreshnessWire,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/index.ts";
import { FRESHNESS_GATEWAY_DEADLINE_MS } from "../src/index.ts";

const TEST_SCOPE = "fusou_freshness_gateway_runtime_test";
const TEST_COMPATIBILITY = Object.freeze({
  date: "2026-11-06",
  flags: Object.freeze(["enable_request_signal"]),
});
const MANIFEST_URL =
  "https://gateway.fusou.test/tlsn/runtime-config/v2/manifest.json";
const HOSTNAME = "gateway.fusou.test";
const PROBE_HOSTNAME = "signal-probe.fusou.test";
const TEST_HEADER = "x-fusou-runtime-test-case";
const GATEWAY_WORKER_NAME = "fusou-freshness-gateway-runtime-test";
const SIGNER_WORKER_NAME = "fusou-freshness-signer-runtime-test";
const SIGNAL_PROBE_WORKER_NAME = "fusou-request-signal-probe-runtime-test";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKERD_DIRECTORY = realpathSync(
  resolve(
    realpathSync(resolve(PACKAGE_ROOT, "node_modules/miniflare")),
    "../workerd",
  ),
);
const ESBUILD_DIRECTORY = realpathSync(
  resolve(PACKAGE_ROOT, "node_modules/esbuild"),
);
const GATEWAY_CONFIG_SOURCE = resolve(PACKAGE_ROOT, "wrangler.toml");
const GATEWAY_WORKER_SOURCE = resolve(
  PACKAGE_ROOT,
  "tests/runtime/gateway-worker.mjs",
);
const SIGNER_WORKER_SOURCE = resolve(
  PACKAGE_ROOT,
  "tests/runtime/signer-worker.mjs",
);
const SIGNAL_PROBE_WORKER_SOURCE = resolve(
  PACKAGE_ROOT,
  "tests/runtime/signal-probe-worker.mjs",
);
const MAX_RESPONSE_BYTES = 1_048_576;
const PROBE_WINDOW_MS = 7_500;
const RUNTIME_TEST_CHILD_ENV = "FUSOU_FRESHNESS_RUNTIME_TEST_CHILD";
const RUNTIME_TEST_ROOT_ENV = "FUSOU_FRESHNESS_RUNTIME_TEST_ROOT";
const EXPECTED_RESPONSE = Buffer.from(
  '{\n  "runtime_test": "exact bytes",\n  "reformatted": false\n}\n',
  "utf8",
);
const events = [];
const eventKeys = new Set();
const clients = new Set();
const sockets = new Set();
const runtimes = new Set();
const caseFailures = [];

let miniflare;
let runtimeUrl;
let probeDirectUrl;
let temporaryDirectory;
let interrupted = false;
let cleanupPromise;
let lastObservationError;

function readInstalledVersion(packageDirectory) {
  return JSON.parse(
    readFileSync(resolve(packageDirectory, "package.json"), "utf8"),
  ).version;
}

function readProductionCompatibilitySettings() {
  const source = readFileSync(GATEWAY_CONFIG_SOURCE, "utf8");
  const date = source.match(/^compatibility_date\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const flagsSource = source.match(
    /^compatibility_flags\s*=\s*\[([^\]]*)\]\s*$/m,
  )?.[1];
  assert.ok(date, "Production Gateway config must define compatibility_date");
  assert.ok(
    flagsSource !== undefined,
    "Production Gateway config must define compatibility_flags",
  );
  const flags = [...flagsSource.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(
    flagsSource.replace(/"[^"]+"/g, "").replace(/[,\s]/g, ""),
    "",
    "Production Gateway config has unsupported compatibility_flags syntax",
  );
  return { date, flags };
}

function verifyRuntimeConfigParity() {
  assert.equal(
    PROBE_WINDOW_MS,
    FRESHNESS_GATEWAY_DEADLINE_MS + 500,
    "signal probe window must outlast the Gateway deadline by 500 ms",
  );
  assert.deepEqual(readProductionCompatibilitySettings(), {
    date: TEST_COMPATIBILITY.date,
    flags: [...TEST_COMPATIBILITY.flags],
  });
}

function withTimeout(promise, timeoutMs, description) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timed out waiting for ${description}`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function trackSocket(client, socket, name) {
  let resolveClosed;
  const record = {
    socket,
    name,
    closed: new Promise((resolve) => {
      resolveClosed = resolve;
    }),
  };
  socket.once("close", resolveClosed);
  socket.once("close", () => sockets.delete(record));
  socket.once("error", client.onTransportError);
  client.socketRecords.push(record);
  sockets.add(record);
  if (socket.destroyed) resolveClosed();
  return record;
}

function makeHttpClient({
  url = runtimeUrl,
  path,
  method = "GET",
  scenario,
  contentType,
  hostHeader = HOSTNAME,
  servername = HOSTNAME,
}) {
  assert.ok(url instanceof URL, "runtime URL is required");
  assert.ok(
    url.hostname === "127.0.0.1" || url.hostname === "::1",
    `runtime listener must be loopback: ${url.hostname}`,
  );
  const port = Number(url.port);
  assert.ok(Number.isInteger(port) && port > 0, "runtime URL must have a port");
  const secure = url.protocol === "https:";
  assert.ok(secure || url.protocol === "http:", "unsupported runtime protocol");
  const Agent = secure ? HttpsAgent : HttpAgent;
  const requestFn = secure ? httpsRequest : httpRequest;
  let resolveResponse;
  let resolveConnected;
  let resolveRequestClosed;
  let connectionSettled = false;
  const responsePromise = new Promise((resolveResponsePromise) => {
    resolveResponse = resolveResponsePromise;
  });
  const connectedPromise = new Promise((resolveConnectedPromise) => {
    resolveConnected = resolveConnectedPromise;
  });
  const requestClosedPromise = new Promise((resolveClosed) => {
    resolveRequestClosed = resolveClosed;
  });
  const client = {
    socket: undefined,
    rawSocket: undefined,
    tlsSocket: undefined,
    request: undefined,
    agent: undefined,
    socketRecords: [],
    onTransportError: (error) => {
      if (!connectionSettled) {
        connectionSettled = true;
        resolveConnected({ error });
      }
      resolveResponse({ error });
    },
    connectedPromise,
    responsePromise,
    waitForConnect: async (timeoutMs, description) => {
      const result = await withTimeout(connectedPromise, timeoutMs, description);
      if (result.error) throw result.error;
      return result.socket;
    },
    waitForClose: async () => {
      await withTimeout(
        Promise.all(client.socketRecords.map(({ closed }) => closed)),
        2_000,
        "loopback transport socket close",
      );
      await withTimeout(requestClosedPromise, 2_000, "HTTP request close");
      clients.delete(client);
    },
    destroy: () => {
      if (client.rawSocket && !client.rawSocket.destroyed) {
        client.rawSocket.destroy();
      } else {
        client.request?.destroy();
      }
    },
    resetAndDestroy: () => {
      assert.ok(client.rawSocket, "TCP transport was not created");
      assert.equal(
        typeof client.rawSocket.resetAndDestroy,
        "function",
        "Node net.Socket.resetAndDestroy() is required",
      );
      client.rawSocket.resetAndDestroy();
    },
    dispose: () => {
      client.request?.destroy();
      client.agent?.destroy();
      if (client.tlsSocket && !client.tlsSocket.destroyed) {
        client.tlsSocket.destroy();
      }
      if (client.rawSocket && !client.rawSocket.destroyed) {
        client.rawSocket.destroy();
      }
    },
    write: (bytes) => client.request.write(bytes),
    end: (bytes) => client.request.end(bytes),
  };
  const agent = new Agent({ keepAlive: false, maxSockets: 1 });
  agent.createConnection = (_options, callback) => {
    const rawSocket = netConnect({ host: "127.0.0.1", port });
    client.rawSocket = rawSocket;
    trackSocket(client, rawSocket, "tcp");

    let transportSocket = rawSocket;
    if (secure) {
      transportSocket = tlsConnect({
        socket: rawSocket,
        servername,
        rejectUnauthorized: false,
        ALPNProtocols: ["http/1.1"],
      });
      client.tlsSocket = transportSocket;
      trackSocket(client, transportSocket, "tls");
    }
    client.socket = transportSocket;

    let callbackCalled = false;
    const finishConnect = (error) => {
      if (callbackCalled || connectionSettled) return;
      callbackCalled = true;
      connectionSettled = true;
      if (error) {
        resolveConnected({ error });
        callback?.(error);
        return;
      }
      resolveConnected({ socket: transportSocket });
      callback?.(null, transportSocket);
    };
    transportSocket.once(secure ? "secureConnect" : "connect", () =>
      finishConnect(),
    );
    transportSocket.once("error", finishConnect);
    rawSocket.once("error", finishConnect);
    return transportSocket;
  };
  client.agent = agent;
  const request = requestFn(
    {
      hostname: url.hostname,
      port,
      ...(secure ? { servername, rejectUnauthorized: false } : {}),
      method,
      path,
      agent,
      headers: {
        host: hostHeader,
        connection: "close",
        ...(scenario ? { [TEST_HEADER]: scenario } : {}),
        ...(contentType ? { "content-type": contentType } : {}),
      },
    },
    (incoming) => {
      const chunks = [];
      let length = 0;
      incoming.on("data", (chunk) => {
        length += chunk.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
          request.destroy(new Error("runtime test response exceeded its bound"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      incoming.on("end", () => {
        resolveResponse({
          status: incoming.statusCode,
          headers: incoming.headers,
          body: Buffer.concat(chunks),
        });
      });
      incoming.on("aborted", () =>
        resolveResponse({
          error: new Error("loopback HTTP response was aborted"),
        }),
      );
      incoming.on("error", (error) => resolveResponse({ error }));
    },
  );
  client.request = request;
  clients.add(client);
  request.once("close", resolveRequestClosed);
  request.on("error", (error) => {
    if (!connectionSettled) {
      connectionSettled = true;
      resolveConnected({ error });
    }
    resolveResponse({ error });
  });
  return client;
}

async function apiRequest(
  path,
  {
    method = "GET",
    body,
    contentType,
    url = runtimeUrl,
    hostHeader,
    servername,
  } = {},
) {
  const client = makeHttpClient({
    url,
    path,
    method,
    contentType,
    hostHeader,
    servername,
  });
  try {
    await client.waitForConnect(5_000, `local ${url.protocol} connection`);
    client.end(body);
    const response = await withTimeout(
      client.responsePromise,
      5_000,
      `HTTP ${method} ${path}`,
    );
    await client.waitForClose();
    client.dispose();
    return response;
  } catch (error) {
    client.dispose();
    try {
      await client.waitForClose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `HTTP ${method} ${path} failed and client cleanup was unconfirmed`,
      );
    }
    throw error;
  }
}

async function setSignerMode(mode) {
  const response = await apiRequest("/__runtime_test/mode", {
    method: "POST",
    body: mode,
    contentType: "text/plain",
  });
  assert.equal(response.error, undefined, "test Signer control request failed");
  assert.equal(response.status, 204, "test Signer rejected its response mode");
}

async function createChallenge() {
  const challenge = await createRuntimeConfigFreshnessRequest({
    manifestUrl: MANIFEST_URL,
    requestNonce: randomBytes(32),
  });
  return Buffer.from(challenge.raw);
}

async function startFreshnessRequest(scenario, body) {
  const client = makeHttpClient({
    path: runtimeConfigFreshnessWire.requestPath,
    method: "POST",
    scenario,
    contentType: "application/json",
  });
  await client.waitForConnect(5_000, "local HTTPS connection");
  assert.ok(
    client.rawSocket?.remoteAddress === "127.0.0.1" ||
      client.rawSocket?.remoteAddress === "::ffff:127.0.0.1",
    "runtime test client did not connect to loopback",
  );
  client.end(body);
  return client;
}

function appendWorkerEvents(snapshot, workers) {
  for (const worker of workers) {
    assert.ok(Array.isArray(snapshot[worker]), `missing ${worker} observations`);
    for (const event of snapshot[worker]) {
      const key = `${worker}:${event.isolate_id}:${event.sequence}`;
      if (eventKeys.has(key)) continue;
      eventKeys.add(key);
      events.push(event);
    }
  }
}

async function refreshGatewayEvents() {
  const response = await apiRequest("/__runtime_test/observations");
  if (response.error) throw response.error;
  assert.equal(
    response.status,
    200,
    `runtime observation endpoint failed: ${response.body.toString("utf8")}`,
  );
  const snapshot = JSON.parse(response.body.toString("utf8"));
  appendWorkerEvents(snapshot, ["gateway", "signer"]);
}

async function refreshProbeEvents(url) {
  const response = await apiRequest("/__signal_probe/events", {
    url,
    hostHeader: PROBE_HOSTNAME,
    servername: PROBE_HOSTNAME,
  });
  if (response.error) throw response.error;
  assert.equal(response.status, 200, "signal probe event endpoint failed");
  const probeEvents = JSON.parse(response.body.toString("utf8"));
  appendWorkerEvents({ probe: probeEvents }, ["probe"]);
}

function eventIndex(predicate, from = 0) {
  for (let index = from; index < events.length; index += 1) {
    if (predicate(events[index])) return index;
  }
  return -1;
}

async function waitForEvent(predicate, {
  from = 0,
  timeoutMs = 3_000,
  description,
  refresh = refreshGatewayEvents,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error(`Interrupted while waiting for ${description}`);
    try {
      await refresh();
      lastObservationError = undefined;
    } catch (error) {
      lastObservationError =
        error instanceof Error ? error.message : String(error);
    }
    const index = eventIndex(predicate, from);
    if (index >= 0) return events[index];
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 20));
  }
  throw new Error(
    `Timed out waiting for ${description}; last observation error: ${lastObservationError ?? "none"}; events: ${JSON.stringify(events.slice(from).map(({ worker, event, scenario, mode, isolate_id, error_name, error_message }) => ({ worker, event, scenario, mode, isolate_id, error_name, error_message })))}`,
  );
}

async function waitForOptionalEvent(predicate, options = {}) {
  try {
    return await waitForEvent(predicate, options);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Timed out waiting for ")
    ) {
      return undefined;
    }
    throw error;
  }
}

function workerEvent(event, worker, scenario, mode) {
  return (candidate) =>
    candidate.scope === TEST_SCOPE &&
    candidate.worker === worker &&
    candidate.event === event &&
    (scenario === undefined || candidate.scenario === scenario) &&
    (mode === undefined || candidate.mode === mode);
}

async function waitForGatewaySignal(scenario, from) {
  return waitForEvent(
    workerEvent("gateway_incoming_request_signal_aborted", "gateway", scenario),
    {
      from,
      timeoutMs: 3_000,
      description: `${scenario} incoming Request.signal abort`,
    },
  );
}

function caseTrace(from) {
  return events.slice(from).map(
    ({
      worker,
      event,
      scenario,
      mode,
      isolate_id,
      sequence,
      timestamp_ms,
      status,
      outcome,
      reason,
      error_name,
      production_event,
    }) => ({
      worker,
      event,
      scenario,
      mode,
      isolate_id,
      sequence,
      timestamp_ms,
      status,
      outcome,
      reason,
      error_name,
      production_event,
    }),
  );
}

async function waitForGatewayCleanup(scenario, from) {
  return waitForEvent(
    workerEvent("gateway_cleanup_waituntil_settled", "gateway", scenario),
    {
      from,
      timeoutMs: 4_000,
      description: `${scenario} cleanup completion`,
    },
  );
}

function assertProbeOutcome(action, signalObserved, outcome, scenario) {
  assert.ok(
    action === "destroy" || action === "resetAndDestroy",
    `${scenario} used an unknown disconnect action`,
  );
  assert.ok(
    outcome === "signal" || outcome === "watchdog",
    `${scenario} returned an unknown probe outcome`,
  );
  assert.equal(
    outcome,
    signalObserved ? "signal" : "watchdog",
    `${scenario} signal and probe outcome disagree`,
  );
  if (action === "resetAndDestroy") {
    assert.equal(
      signalObserved,
      true,
      `${scenario} explicit TCP reset did not abort Request.signal`,
    );
    assert.equal(
      outcome,
      "signal",
      `${scenario} explicit TCP reset did not finish with signal`,
    );
  }
}

function verifyProbeOutcomeDecisionCases() {
  const cases = [
    ["destroy", false, "watchdog", true],
    ["destroy", true, "signal", true],
    ["destroy", false, "signal", false],
    ["destroy", true, "watchdog", false],
    ["destroy", false, "unknown", false],
    ["resetAndDestroy", true, "signal", true],
    ["resetAndDestroy", false, "watchdog", false],
    ["resetAndDestroy", false, "signal", false],
    ["resetAndDestroy", true, "watchdog", false],
    ["unknown", false, "watchdog", false],
  ];
  for (const [action, signalObserved, outcome, accepted] of cases) {
    const check = () =>
      assertProbeOutcome(
        action,
        signalObserved,
        outcome,
        `decision case ${action}/${signalObserved}/${outcome}`,
      );
    if (accepted) {
      assert.doesNotThrow(check);
    } else {
      assert.throws(check);
    }
  }
  console.log("PASS probe outcome decision cases");
}

async function runProbeDisconnectCase(scenario, url, action) {
  const from = events.length;
  const client = makeHttpClient({
    url,
    path: "/__signal_probe/observe",
    method: "GET",
    scenario,
    hostHeader: PROBE_HOSTNAME,
    servername: PROBE_HOSTNAME,
  });
  await client.waitForConnect(5_000, `${scenario} loopback connection`);
  client.end();
  await waitForEvent(
    workerEvent("probe_request_received", "probe", scenario),
    {
      from,
      timeoutMs: 3_000,
      description: `${scenario} probe request arrival`,
      refresh: () => refreshProbeEvents(url),
    },
  );
  if (action === "destroy") {
    client.destroy();
  } else {
    assert.equal(action, "resetAndDestroy");
    client.resetAndDestroy();
  }
  await client.waitForClose();
  const signalEvent = await waitForOptionalEvent(
    workerEvent("probe_request_signal_aborted", "probe", scenario),
    {
      from,
      timeoutMs: PROBE_WINDOW_MS + 1_000,
      description: `${scenario} incoming Request.signal abort`,
      refresh: () => refreshProbeEvents(url),
    },
  );
  const finished = await waitForEvent(
    workerEvent("probe_request_finished", "probe", scenario),
    {
      from,
      timeoutMs: 2_000,
      description: `${scenario} probe completion`,
      refresh: () => refreshProbeEvents(url),
    },
  );
  console.log(
    `OBSERVED ${scenario}: operation=${action}; signal=${signalEvent ? "observed" : "not observed"}; probe=${finished.outcome}; wire FIN/RST=${action === "resetAndDestroy" ? "explicit TCP reset requested" : "not observed"}`,
  );
  console.log(`TRACE ${scenario}: ${JSON.stringify(caseTrace(from))}`);
  assertProbeOutcome(action, Boolean(signalEvent), finished.outcome, scenario);
  return finished.outcome;
}

async function buildRuntimeWorkers() {
  const gatewayBundle = resolve(temporaryDirectory, "gateway-worker.mjs");
  const signerBundle = resolve(temporaryDirectory, "signer-worker.mjs");
  const probeBundle = resolve(temporaryDirectory, "signal-probe-worker.mjs");
  await build({
    entryPoints: [GATEWAY_WORKER_SOURCE],
    outfile: gatewayBundle,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  await build({
    entryPoints: [SIGNER_WORKER_SOURCE],
    outfile: signerBundle,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  await build({
    entryPoints: [SIGNAL_PROBE_WORKER_SOURCE],
    outfile: probeBundle,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  if (interrupted) throw new Error("Interrupted while building Workers runtime");

  const miniflareOptions = convertV4MiniflareOptions({
    rootPath: temporaryDirectory,
    resourcePersistencePath: resolve(temporaryDirectory, "state"),
    isolatedResourcePersistencePath: resolve(
      temporaryDirectory,
      "isolated-state",
    ),
    resourceTmpPath: resolve(temporaryDirectory, "resource-tmp"),
    workers: [
      {
        name: GATEWAY_WORKER_NAME,
        scriptPath: gatewayBundle,
        modules: true,
        compatibilityDate: TEST_COMPATIBILITY.date,
        compatibilityFlags: [...TEST_COMPATIBILITY.flags],
        bindings: {
          TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
        },
        serviceBindings: {
          TLSN_FRESHNESS_SIGNER: SIGNER_WORKER_NAME,
        },
      },
      {
        name: SIGNER_WORKER_NAME,
        scriptPath: signerBundle,
        modules: true,
        compatibilityDate: TEST_COMPATIBILITY.date,
        compatibilityFlags: [...TEST_COMPATIBILITY.flags],
      },
      {
        name: SIGNAL_PROBE_WORKER_NAME,
        scriptPath: probeBundle,
        modules: true,
        compatibilityDate: TEST_COMPATIBILITY.date,
        compatibilityFlags: [...TEST_COMPATIBILITY.flags],
        routes: [`${PROBE_HOSTNAME}/*`],
        unsafeDirectSockets: [{ host: "127.0.0.1", port: 0 }],
      },
    ],
    host: "127.0.0.1",
    port: 0,
    https: true,
    cf: false,
    telemetry: { enabled: false },
  });
  for (const workerName of [
    GATEWAY_WORKER_NAME,
    SIGNER_WORKER_NAME,
    SIGNAL_PROBE_WORKER_NAME,
  ]) {
    const workerConfig = miniflareOptions.workers.find(
      (worker) => worker.config.name === workerName,
    )?.config;
    assert.ok(workerConfig, `Miniflare did not configure ${workerName}`);
    assert.equal(workerConfig.compatibilityDate, TEST_COMPATIBILITY.date);
    assert.deepEqual(
      workerConfig.compatibilityFlags,
      [...TEST_COMPATIBILITY.flags],
    );
  }
  miniflare = new Miniflare(miniflareOptions);
  runtimes.add(miniflare);
}

async function waitForReady() {
  const readyUrl = await withTimeout(
    miniflare.ready,
    30_000,
    "Miniflare workerd startup",
  );
  assert.equal(readyUrl.protocol, "https:");
  assert.equal(readyUrl.hostname, "127.0.0.1");
  runtimeUrl = readyUrl;
  assert.ok(Number.isInteger(Number(runtimeUrl.port)) && Number(runtimeUrl.port) > 0);
  probeDirectUrl = await miniflare.unsafeGetDirectURL(SIGNAL_PROBE_WORKER_NAME);
  assert.equal(probeDirectUrl.protocol, "http:");
  assert.equal(
    probeDirectUrl.hostname,
    "127.0.0.1",
    "direct probe socket must remain on loopback",
  );
  assert.ok(Number(probeDirectUrl.port) > 0);

  const deadline = Date.now() + 10_000;
  let delayMs = 50;
  let gatewayReady = false;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("Interrupted while waiting for runtime readiness");
    try {
      const response = await apiRequest("/__runtime_test/ready");
      if (response.status === 204) {
        gatewayReady = true;
        break;
      }
    } catch (error) {
      lastObservationError =
        error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    delayMs = Math.min(delayMs + 25, 250);
  }
  if (!gatewayReady) {
    throw new Error(
      `Local Workers runtime or Service Binding did not become ready; last error: ${lastObservationError ?? "unexpected status"}`,
    );
  }
  const entryProbeReady = await apiRequest("/__signal_probe/ready", {
    hostHeader: PROBE_HOSTNAME,
    servername: PROBE_HOSTNAME,
  });
  assert.equal(entryProbeReady.status, 204, "Miniflare probe route is unavailable");
  const directProbeReady = await apiRequest("/__signal_probe/ready", {
    url: probeDirectUrl,
    hostHeader: PROBE_HOSTNAME,
    servername: PROBE_HOSTNAME,
  });
  assert.equal(directProbeReady.status, 204, "direct Worker probe socket is unavailable");
  for (const [description, url] of [
    ["Miniflare entry", runtimeUrl],
    ["direct Worker socket", probeDirectUrl],
  ]) {
    const config = await apiRequest("/__signal_probe/config", {
      url,
      hostHeader: PROBE_HOSTNAME,
      servername: PROBE_HOSTNAME,
    });
    assert.equal(config.status, 200, `${description} probe config unavailable`);
    assert.equal(
      JSON.parse(config.body.toString("utf8")).window_ms,
      PROBE_WINDOW_MS,
      `${description} probe window differs from the client expectation`,
    );
  }
}

async function runExactResponseCase() {
  await setSignerMode("exact");
  const from = events.length;
  const client = await startFreshnessRequest(
    "exact-response",
    await createChallenge(),
  );
  const started = await waitForEvent(
    workerEvent("gateway_request_received", "gateway", "exact-response"),
    { from, timeoutMs: 2_000, description: "Gateway exact-response request" },
  );
  const response = await withTimeout(
    client.responsePromise,
    5_000,
    "exact-response HTTP completion",
  );
  assert.equal(response.error, undefined, "exact-response request failed");
  assert.equal(response.status, 200);
  assert.equal(response.body.length, EXPECTED_RESPONSE.length);
  assert.ok(response.body.equals(EXPECTED_RESPONSE), "Gateway changed Signer bytes");
  assert.equal(
    createHash("sha256").update(response.body).digest("hex"),
    createHash("sha256").update(EXPECTED_RESPONSE).digest("hex"),
    "response digest changed",
  );
  await waitForEvent(
    workerEvent("signer_request_received", "signer", undefined, "exact"),
    { from, timeoutMs: 2_000, description: "test Signer exact response" },
  );
  await client.waitForClose();
  return started.isolate_id;
}

async function runRequestBodyDisconnectCase() {
  await setSignerMode("unexpected");
  const from = events.length;
  const client = makeHttpClient({
    path: runtimeConfigFreshnessWire.requestPath,
    method: "POST",
    scenario: "request-body-disconnect",
    contentType: "application/json",
  });
  await client.waitForConnect(5_000, "partial-body HTTPS connection");
  assert.ok(
    client.rawSocket?.remoteAddress === "127.0.0.1" ||
      client.rawSocket?.remoteAddress === "::ffff:127.0.0.1",
    "runtime test client did not connect to loopback",
  );
  client.write(Buffer.from('{"schema_version":'));
  await waitForEvent(
    workerEvent(
      "gateway_request_body_reader_acquired",
      "gateway",
      "request-body-disconnect",
    ),
    { from, timeoutMs: 3_000, description: "Gateway request-body reader acquisition" },
  );
  const disconnectedAt = Date.now();
  client.resetAndDestroy();
  await client.waitForClose();
  await waitForGatewaySignal("request-body-disconnect", from);
  await waitForEvent(
    workerEvent(
      "gateway_request_body_cancel_completed",
      "gateway",
      "request-body-disconnect",
    ),
    { from, timeoutMs: 3_000, description: "request-body cancellation" },
  );
  await waitForEvent(
    workerEvent(
      "gateway_request_body_reader_released",
      "gateway",
      "request-body-disconnect",
    ),
    { from, timeoutMs: 3_000, description: "request-body reader release" },
  );
  await waitForGatewayCleanup("request-body-disconnect", from);
  assert.ok(
    Date.now() - disconnectedAt < FRESHNESS_GATEWAY_DEADLINE_MS - 500,
    "request body ended only after the Gateway deadline",
  );
  assert.equal(
    eventIndex(workerEvent("signer_request_received", "signer"), from),
    -1,
    "Signer was called for a disconnected partial request body",
  );
}

async function runSignerHeadersDisconnectCase() {
  await setSignerMode("wait-for-headers");
  const from = events.length;
  const client = await startFreshnessRequest(
    "signer-headers-disconnect",
    await createChallenge(),
  );
  await waitForEvent(
    workerEvent(
      "signer_request_received",
      "signer",
      undefined,
      "wait-for-headers",
    ),
    { from, timeoutMs: 3_000, description: "Signer fetch arrival before disconnect" },
  );
  const disconnectedAt = Date.now();
  client.resetAndDestroy();
  await client.waitForClose();
  await waitForGatewaySignal("signer-headers-disconnect", from);
  await waitForEvent(
    workerEvent(
      "signer_request_signal_aborted",
      "signer",
      undefined,
      "wait-for-headers",
    ),
    { from, timeoutMs: 3_000, description: "Service Binding Request.signal abort" },
  );
  await waitForEvent(
    workerEvent(
      "signer_fetch_unblocked_by_abort",
      "signer",
      undefined,
      "wait-for-headers",
    ),
    { from, timeoutMs: 3_000, description: "Signer fetch completion after disconnect" },
  );
  await waitForGatewayCleanup("signer-headers-disconnect", from);
  assert.ok(
    Date.now() - disconnectedAt < FRESHNESS_GATEWAY_DEADLINE_MS - 500,
    "Signer headers wait ended only after the Gateway deadline",
  );
}

async function runSignerBodyDisconnectCase() {
  await setSignerMode("stream-body");
  const from = events.length;
  const client = await startFreshnessRequest(
    "signer-body-disconnect",
    await createChallenge(),
  );
  await waitForEvent(
    workerEvent("signer_request_received", "signer", undefined, "stream-body"),
    { from, timeoutMs: 3_000, description: "Signer body request arrival" },
  );
  await waitForEvent(
    workerEvent(
      "signer_response_body_read_stalled",
      "signer",
      undefined,
      "stream-body",
    ),
    {
      from,
      timeoutMs: 3_000,
      description: "Gateway reading the streaming Signer body",
    },
  );
  await waitForEvent(
    workerEvent(
      "signer_response_body_pull_pending",
      "signer",
      undefined,
      "stream-body",
    ),
    {
      from,
      timeoutMs: 1_000,
      description: "test Signer body source pull remains pending",
    },
  );
  const disconnectedAt = Date.now();
  client.resetAndDestroy();
  await client.waitForClose();
  await waitForOptionalEvent(
    workerEvent(
      "gateway_incoming_request_signal_aborted",
      "gateway",
      "signer-body-disconnect",
    ),
    {
      from,
      timeoutMs: 1_000,
      description: "Signer-body incoming Request.signal abort",
    },
  );
  await waitForOptionalEvent(
    workerEvent(
      "gateway_signer_response_body_read_rejected",
      "gateway",
      "signer-body-disconnect",
    ),
    {
      from,
      timeoutMs: 3_000,
      description: "Gateway Signer body read failure",
    },
  );
  const internalSignal = await waitForOptionalEvent(
    workerEvent(
      "gateway_internal_signal_aborted",
      "gateway",
      "signer-body-disconnect",
    ),
    {
      from,
      timeoutMs: 500,
      description: "Signer-body internal signal abort",
    },
  );
  const cancelStarted = await waitForOptionalEvent(
    workerEvent(
      "gateway_signer_response_body_cancel_started",
      "gateway",
      "signer-body-disconnect",
    ),
    {
      from,
      timeoutMs: 1_000,
      description: "Gateway Signer body cancellation start",
    },
  );
  const cancelCompleted = await waitForOptionalEvent(
    workerEvent(
      "gateway_signer_response_body_cancel_completed",
      "gateway",
      "signer-body-disconnect",
    ),
    {
      from,
      timeoutMs: 500,
      description: "Gateway Signer body cancellation completion",
    },
  );
  const cancelRejected = await waitForOptionalEvent(
    workerEvent(
      "gateway_signer_response_body_cancel_rejected",
      "gateway",
      "signer-body-disconnect",
    ),
    {
      from,
      timeoutMs: 500,
      description: "Gateway Signer body cancellation rejection",
    },
  );
  const readerReleased = await waitForEvent(
    workerEvent(
      "gateway_signer_response_body_reader_released",
      "gateway",
      "signer-body-disconnect",
    ),
    {
      from,
      timeoutMs: 1_000,
      description: "Gateway Signer body reader release",
    },
  );
  const signerSignal = await waitForOptionalEvent(
    workerEvent(
      "signer_request_signal_aborted",
      "signer",
      undefined,
      "stream-body",
    ),
    {
      from,
      timeoutMs: 500,
      description: "Service Binding Request.signal abort",
    },
  );
  const signerCancelStarted = await waitForOptionalEvent(
    workerEvent(
      "signer_response_body_cancel_started",
      "signer",
      undefined,
      "stream-body",
    ),
    {
      from,
      timeoutMs: 500,
      description: "Signer body cancellation start",
    },
  );
  const signerCancelCompleted = await waitForOptionalEvent(
    workerEvent(
      "signer_response_body_cancel_completed",
      "signer",
      undefined,
      "stream-body",
    ),
    {
      from,
      timeoutMs: 500,
      description: "Signer body cancellation completion",
    },
  );
  const signerPullResolved = await waitForOptionalEvent(
    workerEvent(
      "signer_response_body_pull_resolved",
      "signer",
      undefined,
      "stream-body",
    ),
    {
      from,
      timeoutMs: 500,
      description: "test Signer body source pull resolution",
    },
  );
  const operationReturned = await waitForEvent(
    workerEvent(
      "gateway_operation_returned",
      "gateway",
      "signer-body-disconnect",
    ),
    {
      from,
      timeoutMs: 3_000,
      description: "Gateway body-disconnect operation completion",
    },
  );
  const admissionRetained = await waitForOptionalEvent(
    workerEvent(
      "freshness_gateway_admission_retained_cleanup_unconfirmed",
      "gateway",
      "signer-body-disconnect",
    ),
    {
      from,
      timeoutMs: 500,
      description: "admission retained after unconfirmed cleanup",
    },
  );
  const waitUntilRegistered = await waitForOptionalEvent(
    workerEvent(
      "gateway_cleanup_waituntil_registered",
      "gateway",
      "signer-body-disconnect",
    ),
    {
      from,
      timeoutMs: 250,
      description: "cleanup waitUntil registration",
    },
  );
  const waitUntilSettled = waitUntilRegistered
    ? await waitForOptionalEvent(
        workerEvent(
          "gateway_cleanup_waituntil_settled",
          "gateway",
          "signer-body-disconnect",
        ),
        {
          from,
          timeoutMs: 1_000,
          description: "cleanup waitUntil settlement",
        },
      )
    : undefined;
  await refreshGatewayEvents();
  const incomingSignalIndex = eventIndex(
    workerEvent(
      "gateway_incoming_request_signal_aborted",
      "gateway",
      "signer-body-disconnect",
    ),
    from,
  );
  const bodyReadRejectedIndex = eventIndex(
    workerEvent(
      "gateway_signer_response_body_read_rejected",
      "gateway",
      "signer-body-disconnect",
    ),
    from,
  );
  const operationReturnedIndex = eventIndex(
    workerEvent(
      "gateway_operation_returned",
      "gateway",
      "signer-body-disconnect",
    ),
    from,
  );
  const incomingSignalEvent =
    incomingSignalIndex >= 0 ? events[incomingSignalIndex] : undefined;
  const bodyReadRejectedEvent =
    bodyReadRejectedIndex >= 0 ? events[bodyReadRejectedIndex] : undefined;
  const readFailureWon =
    bodyReadRejectedIndex >= 0 &&
    (incomingSignalIndex < 0 ||
      events[bodyReadRejectedIndex].sequence <
        events[incomingSignalIndex].sequence);
  const signalWon =
    incomingSignalIndex >= 0 &&
    !readFailureWon &&
    incomingSignalIndex < operationReturnedIndex;
  assert.ok(
    readFailureWon || signalWon,
    "neither a body-read failure nor an incoming signal won before handler completion",
  );
  assert.ok(
    cancelStarted || cancelCompleted || cancelRejected,
    "Gateway did not attempt Signer body cleanup after the disconnect/read failure",
  );
  if (signalWon) {
    assert.ok(
      internalSignal && signerSignal,
      "incoming abort did not propagate through Gateway and Service Binding signals",
    );
    assert.equal(
      operationReturned.status,
      499,
      "incoming-signal path did not return the existing interrupted response",
    );
    assert.ok(
      waitUntilRegistered,
      "interrupted cleanup did not register waitUntil",
    );
  } else {
    assert.equal(
      operationReturned.status,
      502,
      "body-read failure did not preserve the existing invalid-response result",
    );
    assert.equal(
      waitUntilRegistered,
      undefined,
      "read-error-first completion unexpectedly required waitUntil",
    );
    assert.ok(
      cancelCompleted || cancelRejected,
      "read-error completion did not resolve or reject body cancellation",
    );
  }
  assert.ok(
    Date.now() - disconnectedAt < FRESHNESS_GATEWAY_DEADLINE_MS - 500,
    "Signer body read failure ended only after the Gateway deadline",
  );
  console.log(
    `OBSERVED signer-body-disconnect: incoming_signal=${Boolean(incomingSignalEvent)}; internal_signal=${Boolean(internalSignal)}; signer_signal=${Boolean(signerSignal)}; read_rejected=${Boolean(bodyReadRejectedEvent)}; order=${signalWon ? "signal-first" : "read-error-first"}; gateway_cancel=${cancelCompleted ? "completed" : cancelRejected ? "rejected" : "started/unsettled"}; signer_cancel=${signerCancelCompleted ? "completed" : signerCancelStarted ? "started/unsettled" : "not observed"}; signer_pull=${signerPullResolved ? "resolved" : "still unconfirmed"}; reader_released=${Boolean(readerReleased)}; operation_status=${operationReturned.status}; admission_retained=${Boolean(admissionRetained)}; waitUntil_registered=${Boolean(waitUntilRegistered)}; waitUntil_settled=${Boolean(waitUntilSettled)}`,
  );
  console.log(
    `TRACE signer-body-disconnect: ${JSON.stringify(caseTrace(from))}`,
  );
  if (cancelRejected) {
    assert.ok(
      admissionRetained,
      "failed Signer body cleanup did not retain the admission slot",
    );
  }
}

async function runGatewayDeadlineCase() {
  await setSignerMode("wait-for-headers");
  const from = events.length;
  const client = await startFreshnessRequest(
    "gateway-deadline",
    await createChallenge(),
  );
  await waitForEvent(
    workerEvent(
      "signer_request_received",
      "signer",
      undefined,
      "wait-for-headers",
    ),
    { from, timeoutMs: 3_000, description: "Signer wait before Gateway deadline" },
  );
  const startedAt = Date.now();
  const response = await withTimeout(
    client.responsePromise,
    FRESHNESS_GATEWAY_DEADLINE_MS + 4_000,
    "Gateway-owned deadline response",
  );
  const elapsed = Date.now() - startedAt;
  assert.equal(response.error, undefined, "deadline request lost its open client");
  if (response.status !== 504) {
    await refreshGatewayEvents();
    const observed = events
      .slice(from)
      .map(({ worker, event, scenario, mode, isolate_id, error_name, error_message }) => ({
        worker,
        event,
        scenario,
        mode,
        isolate_id,
        error_name,
        error_message,
      }));
    throw new Error(
      `expected 504, received ${response.status} after ${elapsed} ms; events: ${JSON.stringify(observed)}`,
    );
  }
  assert.ok(
    elapsed >= FRESHNESS_GATEWAY_DEADLINE_MS - 500,
    `Gateway responded before its deadline (${elapsed} ms)`,
  );
  assert.ok(
    elapsed < FRESHNESS_GATEWAY_DEADLINE_MS + 3_000,
    `Gateway response exceeded its finite deadline tolerance (${elapsed} ms)`,
  );
  await waitForEvent(
    workerEvent(
      "signer_request_signal_aborted",
      "signer",
      undefined,
      "wait-for-headers",
    ),
    { from, timeoutMs: 2_000, description: "deadline signal to Service Binding" },
  );
  await waitForEvent(
    workerEvent(
      "signer_fetch_unblocked_by_abort",
      "signer",
      undefined,
      "wait-for-headers",
    ),
    { from, timeoutMs: 2_000, description: "Signer fetch completion after deadline" },
  );
  await waitForGatewayCleanup("gateway-deadline", from);
  assert.equal(
    eventIndex(
      workerEvent(
        "gateway_incoming_request_signal_aborted",
        "gateway",
        "gateway-deadline",
      ),
      from,
    ),
    -1,
    "deadline case was incorrectly observed as a client disconnect",
  );
  await client.waitForClose();
}

async function runPostCleanupCase(previousIsolateId, runtimeInstance) {
  await setSignerMode("exact");
  const from = events.length;
  const client = await startFreshnessRequest("post-cleanup", await createChallenge());
  const started = await waitForEvent(
    workerEvent("gateway_request_received", "gateway", "post-cleanup"),
    { from, timeoutMs: 2_000, description: "post-cleanup Gateway request" },
  );
  const response = await withTimeout(
    client.responsePromise,
    5_000,
    "post-cleanup HTTP completion",
  );
  assert.equal(response.error, undefined, "post-cleanup request failed");
  assert.equal(response.status, 200);
  assert.equal(response.body.length, EXPECTED_RESPONSE.length);
  assert.equal(
    createHash("sha256").update(response.body).digest("hex"),
    createHash("sha256").update(EXPECTED_RESPONSE).digest("hex"),
    "post-cleanup Signer bytes changed",
  );
  assert.equal(miniflare, runtimeInstance, "Workers runtime instance changed");
  assert.equal(
    started.isolate_id,
    previousIsolateId,
    "Gateway Worker isolate changed before the follow-up request",
  );
  await client.waitForClose();
  return true;
}

async function runCase(name, operation) {
  try {
    const result = await operation();
    console.log(`PASS ${name}`);
    if (typeof result === "boolean") {
      console.log(
        `Gateway isolate continuity after ${name}: ${result ? "same" : "different"}`,
      );
    }
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    caseFailures.push(`${name}: ${detail}`);
    console.error(`FAIL ${name}: ${detail}`);
    return undefined;
  }
}

async function cleanupRuntime() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const failures = [];
    const activeClients = [...clients];
    for (const client of activeClients) client.dispose();
    try {
      await Promise.all(activeClients.map((client) => client.waitForClose()));
    } catch (error) {
      failures.push(error);
    }

    const activeRuntimes = [...runtimes];
    runtimes.clear();
    miniflare = undefined;
    for (const runningRuntime of activeRuntimes) {
      const disposal = runningRuntime.dispose();
      try {
        await withTimeout(disposal, 5_000, "Miniflare shutdown");
      } catch (error) {
        failures.push(error);
      }
    }

    try {
      await Promise.all(
        [...sockets].map(({ closed, name }) =>
          withTimeout(closed, 2_000, `loopback ${name} socket cleanup`),
        ),
      );
    } catch (error) {
      failures.push(error);
    }

    if (failures.length === 0 && temporaryDirectory) {
      const directory = temporaryDirectory;
      temporaryDirectory = undefined;
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "Runtime test cleanup failed");
    }
  })();
  return cleanupPromise;
}

if (process.env[RUNTIME_TEST_CHILD_ENV] === "1") {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      interrupted = true;
      process.exitCode = signal === "SIGINT" ? 130 : 143;
      void cleanupRuntime().catch((error) => {
        console.error(
          `Runtime cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
      });
    });
  }
}

async function main() {
  verifyRuntimeConfigParity();
  verifyProbeOutcomeDecisionCases();
  const miniflareDirectory = realpathSync(
    resolve(PACKAGE_ROOT, "node_modules/miniflare"),
  );
  const versions = {
    node: process.version,
    miniflare: readInstalledVersion(miniflareDirectory),
    workerd: readInstalledVersion(WORKERD_DIRECTORY),
    esbuild: readInstalledVersion(ESBUILD_DIRECTORY),
  };
  console.log(
    `Local Workers runtime: Node ${versions.node}, Miniflare ${versions.miniflare}, ` +
      `workerd ${versions.workerd}, esbuild ${versions.esbuild}`,
  );
  console.log(
    "Local-only HTTPS listener: 127.0.0.1; reserved .test hostname is sent as Host/SNI without DNS lookup.",
  );

  const temporaryRoot = process.env[RUNTIME_TEST_ROOT_ENV] ?? tmpdir();
  temporaryDirectory = mkdtempSync(
    resolve(temporaryRoot, "fusou-freshness-runtime-"),
  );
  try {
    await buildRuntimeWorkers();
    await waitForReady();
    const runtimeInstance = miniflare;
    const entryDestroyOutcome = await runCase(
      "signal probe via Miniflare entry and ordinary destroy",
      () =>
        runProbeDisconnectCase(
          "probe-entry-destroy",
          runtimeUrl,
          "destroy",
        ),
    );
    const entryResetOutcome = await runCase(
      "signal probe via Miniflare entry and explicit TCP reset",
      () =>
        runProbeDisconnectCase(
          "probe-entry-reset",
          runtimeUrl,
          "resetAndDestroy",
        ),
    );
    const directDestroyOutcome = await runCase(
      "signal probe via direct Worker socket and ordinary destroy",
      () =>
        runProbeDisconnectCase(
          "probe-direct-destroy",
          probeDirectUrl,
          "destroy",
        ),
    );
    const directResetOutcome = await runCase(
      "signal probe via direct Worker socket and explicit TCP reset",
      () =>
        runProbeDisconnectCase(
          "probe-direct-reset",
          probeDirectUrl,
          "resetAndDestroy",
        ),
    );
    const initialIsolateId = await runCase(
      "exact response bytes",
      runExactResponseCase,
    );
    await runCase("Gateway-owned deadline", runGatewayDeadlineCase);
    const sameIsolateFollowUp =
      initialIsolateId === undefined
        ? undefined
        : await runCase("post-cleanup request", () =>
            runPostCleanupCase(initialIsolateId, runtimeInstance),
          );
    await runCase(
      "explicit TCP reset while awaiting Signer headers",
      runSignerHeadersDisconnectCase,
    );
    await runCase(
      "explicit TCP reset while reading Signer body",
      runSignerBodyDisconnectCase,
    );
    await runCase(
      "explicit TCP reset while reading request body",
      runRequestBodyDisconnectCase,
    );
    if (caseFailures.length > 0) {
      throw new Error(
        `Runtime boundary cases failed:\n${caseFailures.map((failure) => `- ${failure}`).join("\n")}`,
      );
    }
    console.log(
      "LOCAL_WORKERS_RUNTIME_VERIFIED: exact response bytes, probe comparisons, and the Gateway reset cases whose assertions passed.",
    );
    console.log(
      `Ordinary-destroy probe outcomes: Miniflare entry=${entryDestroyOutcome ?? "failed"}; direct socket=${directDestroyOutcome ?? "failed"}. Explicit-reset probe outcomes: Miniflare entry=${entryResetOutcome ?? "failed"}; direct socket=${directResetOutcome ?? "failed"}.`,
    );
    console.log(
      `Post-cleanup request used the same Gateway isolate: ${sameIsolateFollowUp ? "observed" : "not observed"}; no 16-slot recovery claim is made.`,
    );
  } finally {
    await cleanupRuntime();
  }
}

function signalChildProcessGroup(child, signal) {
  if (typeof child.pid !== "number") return;
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      return;
    }
    throw error;
  }
}

async function superviseRuntimeTest() {
  const supervisorRoot = mkdtempSync(
    resolve(tmpdir(), "fusou-freshness-runtime-supervisor-"),
  );
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", fileURLToPath(import.meta.url)],
    {
      cwd: PACKAGE_ROOT,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        [RUNTIME_TEST_CHILD_ENV]: "1",
        [RUNTIME_TEST_ROOT_ENV]: supervisorRoot,
      },
      stdio: "inherit",
    },
  );
  let childGone = false;
  const childDone = new Promise((resolveDone) => {
    child.once("error", (error) => {
      childGone = true;
      resolveDone({ kind: "spawn-error", error });
    });
    child.once("exit", (code, signal) => {
      childGone = true;
      resolveDone({ kind: "exit", code, signal });
    });
  });
  const signalHandlers = new Map();
  const interrupted = new Promise((resolveSignal) => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => resolveSignal({ kind: "signal", signal });
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
  });
  let timeoutHandle;
  const timedOut = new Promise((resolveTimeout) => {
    timeoutHandle = setTimeout(
      () => resolveTimeout({ kind: "timeout" }),
      120_000,
    );
  });
  let cleanupError;

  const waitForChild = async (timeoutMs, description) => {
    try {
      return await withTimeout(childDone, timeoutMs, description);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === `Timed out waiting for ${description}`
      ) {
        return undefined;
      }
      throw error;
    }
  };

  let primaryError;
  try {
    const outcome = await Promise.race([childDone, interrupted, timedOut]);
    if (outcome.kind === "spawn-error") throw outcome.error;
    if (outcome.kind === "exit") {
      process.exitCode =
        outcome.code ??
        (outcome.signal === "SIGINT"
          ? 130
          : outcome.signal === "SIGTERM"
            ? 143
            : 1);
    } else {
      process.exitCode =
        outcome.kind === "timeout"
            ? 1
            : outcome.signal === "SIGINT"
              ? 130
              : 143;
      signalChildProcessGroup(
        child,
        outcome.kind === "timeout" ? "SIGTERM" : outcome.signal,
      );
      if (!(await waitForChild(5_000, "runtime test child cleanup"))) {
        signalChildProcessGroup(child, "SIGKILL");
        if (!(await waitForChild(5_000, "runtime test child termination"))) {
            throw new Error("Runtime test process group did not terminate");
        }
      }
    }
  } catch (error) {
    primaryError = error;
  } finally {
    clearTimeout(timeoutHandle);
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    if (!childGone) {
      try {
        signalChildProcessGroup(child, "SIGKILL");
        if (!(await waitForChild(5_000, "runtime test supervisor cleanup"))) {
          cleanupError = new Error("Runtime test process did not exit after SIGKILL");
        }
      } catch (error) {
        cleanupError = error;
      }
    }
    if (childGone) {
      try {
        rmSync(supervisorRoot, { recursive: true, force: true });
      } catch (error) {
        cleanupError ??= error;
      }
    }
  }
  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      "Runtime test and supervisor cleanup failed",
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
}

if (process.env[RUNTIME_TEST_CHILD_ENV] === "1") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
} else {
  superviseRuntimeTest().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
