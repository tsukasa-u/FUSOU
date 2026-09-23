#!/usr/bin/env node

import { createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fixtureSourcePath,
  generateRealFixture,
  packageDirectory,
  repositoryDirectory,
  readRealFixtureManifest,
} from "./tlsn-benchmark-fixtures.mjs";

const DEFAULT_SAMPLE_COUNT = 20;
const DEFAULT_CASES = "p50,p95,p99,max";
const DEFAULT_CONCURRENCY = "1,2,4,8";
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_POLL_MS = 300_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const RESULT_TARGET_MS = 3_000;
const PAYLOAD_SCALING_BANDS = [
  { label: "4KiB-16KiB", minimum: 4 * 1024, maximum: 16 * 1024 },
  { label: "16KiB-64KiB", minimum: 16 * 1024, maximum: 64 * 1024 },
  { label: "64KiB-256KiB", minimum: 64 * 1024, maximum: 256 * 1024 },
  { label: "256KiB-1MiB", minimum: 256 * 1024, maximum: 1024 * 1024 },
  { label: "1MiB-4MiB", minimum: 1024 * 1024, maximum: 4 * 1024 * 1024 },
  { label: "4MiB-8MiB", minimum: 4 * 1024 * 1024, maximum: 8 * 1024 * 1024 },
];
const ALLOWED_EXPECTED_ENVIRONMENTS = new Set(["test", "evidence", "production"]);
const FORBIDDEN_GAME_SERVER_HOST_PATTERN = /(?:^|\.)(?:kancolle-server\.com|kancolle\.dmm\.com)$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMON_REQUIRED_TIMING_STAGES = [
  "t0_accepted",
  "t1_202_response_sent",
  "t4_callback_accepted",
  "t5_lease_acquired",
  "t6_presentation_read",
  "t5_presentation_hash_started",
  "t5_presentation_hash_completed",
  "t7_wasm_verification_completed",
  "t8_result_signing_completed",
  "t8_result_persisted",
  "t9_result_persisted",
  "t9_consume_completed",
  "t10_consume_completed",
  "t11_status_verified",
  "t10_callback_response_ready",
  "result_canonicalization_started",
  "result_canonicalization_completed",
  "result_signing_started",
  "result_signing_completed",
  "result_construction_started",
  "result_construction_completed",
  "result_hash_started",
  "result_hash_completed",
  "result_persistence_started",
  "result_persistence_completed",
  "status_result_read_started",
  "status_result_read_completed",
];

const REQUIRED_TIMING_STAGES_BY_MODE = {
  trigger: [
    ...COMMON_REQUIRED_TIMING_STAGES,
    "t2_trigger_task_accepted",
    "t3_trigger_execution_started",
    "t3_trigger_module_initialized",
    "t3_trigger_input_fetch_started",
    "t3_trigger_input_fetch_completed",
    "t3_trigger_verifier_initialization_started",
    "t3_trigger_verifier_initialization_completed",
    "t3_trigger_verifier_started",
    "t3_trigger_verifier_completed",
    "t3_trigger_callback_request_started",
  ],
  queue: [
    ...COMMON_REQUIRED_TIMING_STAGES,
    "queue_send_start",
    "queue_send_completed",
    "queue_message_accepted",
    "queue_consumer_scheduled",
    "queue_consumer_started",
    "queue_handler_entered",
    "queue_callback_authentication_started",
    "queue_callback_authentication_completed",
    "queue_callback_schema_validated",
    "queue_completion_entered",
    "queue_binding_lookup_and_lease_started",
    "queue_binding_lookup_and_lease_completed",
    "queue_presentation_read_started",
    "queue_presentation_read_completed",
    "queue_presentation_hash_completed",
    "queue_wasm_verification_started",
    "queue_wasm_verification_completed",
    "queue_result_signing_started",
    "queue_result_signing_completed",
    "queue_result_persistence_started",
    "queue_result_persistence_completed",
    "queue_consume_started",
    "queue_consume_completed",
    "queue_completion_response_ready",
    "t2_queue_message_accepted",
    "t3_queue_execution_started",
    "t3_queue_verifier_started",
    "t3_queue_verifier_completed",
    "t3_queue_callback_dispatch_started",
    "t3_queue_callback_response_received",
  ],
  direct: [
    ...COMMON_REQUIRED_TIMING_STAGES,
    "t1_direct_input_bound",
    "direct_dispatch_started",
    "direct_invocation_completed",
    "t3_direct_execution_started",
    "direct_presentation_read_started",
    "direct_presentation_read_completed",
    "direct_presentation_received",
  ],
};
const SYNCHRONOUS_REQUIRED_TIMING_STAGES = [
  ...REQUIRED_TIMING_STAGES_BY_MODE.direct.filter(
    (stage) => stage !== "t1_202_response_sent"
      && stage !== "t11_status_verified"
      && stage !== "status_result_read_started"
      && stage !== "status_result_read_completed",
  ),
  "direct_synchronous_response_started",
  "t1_200_response_sent",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parseInteger(name, fallback, minimum, maximum) {
  const raw = optional(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseList(name, fallback, mapper) {
  return (optional(name) ?? fallback)
    .split(",")
    .map((value) => mapper(value.trim()))
    .filter((value) => value !== undefined);
}

function requireOrigin(name) {
  const value = required(name);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) {
    throw new Error(`${name} must be an HTTPS origin without credentials, port, query, or fragment`);
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(`${name} must not contain a path`);
  }
  return url.origin;
}

function assertReadinessOrigin(name, origin) {
  const hostname = new URL(origin).hostname;
  if (FORBIDDEN_GAME_SERVER_HOST_PATTERN.test(hostname) || hostname.includes("kancolle")) {
    throw new Error(`${name} must not target a game-server hostname during canary readiness`);
  }
  return origin;
}

function endpoint(origin, pathname) {
  return new URL(pathname, `${origin}/`).toString();
}

function sha256Base64Url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url");
}

async function loadPrivateKey(prefix) {
  const file = optional(`${prefix}_PRIVATE_KEY_PKCS8_FILE`);
  const encoded = file
    ? (await readFile(file, "utf8")).trim()
    : required(`${prefix}_PRIVATE_KEY_PKCS8_B64URL`);
  return createPrivateKey({ key: decodeBase64Url(encoded), format: "der", type: "pkcs8" });
}

function pushLengthPrefixed(chunks, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  chunks.push(length, bytes);
}

function tlsnDeviceProofMessage(deviceId, sessionId, binding, challenge) {
  const chunks = [Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  pushLengthPrefixed(chunks, deviceId);
  pushLengthPrefixed(chunks, sessionId);
  pushLengthPrefixed(chunks, binding);
  pushLengthPrefixed(chunks, decodeBase64Url(challenge));
  return Buffer.concat(chunks);
}

function signedDeviceProof(device, session, privateKey) {
  return sign(
    null,
    tlsnDeviceProofMessage(device.id, session.session_id, session.binding, session.device_challenge),
    privateKey,
  ).toString("base64url");
}

async function timedJsonRequest(url, options = {}) {
  const startedAt = performance.now();
  const requestStartedEpochMilliseconds = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMilliseconds());
  let response;
  let responseBytes;
  try {
    response = await fetch(url, { redirect: "error", ...options, signal: controller.signal });
    responseBytes = Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
  const responseReceivedEpochMilliseconds = Date.now();
  const body = responseBytes.toString("utf8");
  const elapsedMilliseconds = performance.now() - startedAt;
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  return {
    response,
    responseBytes,
    status: response.status,
    json,
    elapsedMilliseconds,
    responseBodyBytes: responseBytes.length,
    responseBodySha256: createHash("sha256").update(responseBytes).digest("base64url"),
    requestStartedEpochMilliseconds,
    responseReceivedEpochMilliseconds,
  };
}

function requestTimeoutMilliseconds() {
  const raw = optional("TLSN_REMOTE_REQUEST_TIMEOUT_MS");
  if (!raw) return DEFAULT_REQUEST_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) {
    throw new Error("TLSN_REMOTE_REQUEST_TIMEOUT_MS must be an integer between 1000 and 300000");
  }
  return value;
}

async function loadHealth(workerOrigin) {
  const result = await timedJsonRequest(endpoint(workerOrigin, "/health"));
  if (result.status !== 200 || result.json?.ok !== true) {
    throw new Error(`remote Worker health failed with status ${result.status}`);
  }
  const expectedEnvironment = optional("TLSN_REMOTE_EXPECTED_ENVIRONMENT") ?? "test";
  if (!ALLOWED_EXPECTED_ENVIRONMENTS.has(expectedEnvironment)) {
    throw new Error("TLSN_REMOTE_EXPECTED_ENVIRONMENT must be test, evidence, or production");
  }
  const environmentMatches = expectedEnvironment === "evidence"
    ? result.json.environment === "test" && result.json.deployment_role === "evidence"
    : result.json.environment === expectedEnvironment;
  if (!environmentMatches) {
    throw new Error(`remote Worker is not the expected ${expectedEnvironment} environment`);
  }
  if (result.json.binding_mode !== "random") {
    throw new Error("remote benchmark requires a random-binding Worker; fixed canary bindings are one-shot");
  }
  const expectedExecutionMode = optional("TLSN_REMOTE_EXECUTION_MODE") ?? "trigger";
  if (!["trigger", "queue", "direct"].includes(expectedExecutionMode)) {
    throw new Error("TLSN_REMOTE_EXECUTION_MODE must be trigger, queue, or direct");
  }
  if (result.json.execution_mode !== expectedExecutionMode) {
    throw new Error(`remote Worker execution mode is ${result.json.execution_mode ?? "unset"}, expected ${expectedExecutionMode}`);
  }
  if (expectedEnvironment === "production" && result.json.deployment_role !== "canary") {
    throw new Error("production readiness benchmark requires an isolated canary deployment role");
  }
  if (typeof result.json.sparse_profile_sha256 !== "string") {
    throw new Error("remote Worker does not expose the sparse profile");
  }
  const authMode = optional("TLSN_REMOTE_AUTH_MODE") ?? "supabase";
  if (authMode === "test" && (result.json.auth_mode !== "test-token" || result.json.device_auth_mode !== "test-ed25519")) {
    throw new Error("remote Worker is not configured for self-contained test auth");
  }
  return { ...result.json, expected_environment: expectedEnvironment };
}

async function loadAuthenticatedUser(supabaseOrigin, publishableKey, accessToken) {
  const result = await timedJsonRequest(`${supabaseOrigin}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (result.status !== 200 || typeof result.json?.id !== "string" || result.json.is_anonymous !== false) {
    throw new Error(`Supabase authentication failed with status ${result.status}`);
  }
  return { id: result.json.id, latencyMilliseconds: result.elapsedMilliseconds };
}

async function issueSession(workerOrigin, webOrigin, accessToken, device, privateKey, authMode) {
  let nonce;
  if (authMode === "test") {
    nonce = randomBytes(32).toString("hex");
  } else {
    const challenge = await timedJsonRequest(
      endpoint(webOrigin, `/api/auth/anonymous-sync/v2/challenge?device_id=${encodeURIComponent(device.id)}`),
    );
    if (challenge.status !== 200 || typeof challenge.json?.nonce !== "string") {
      throw new Error(`device challenge failed with status ${challenge.status}`);
    }
    nonce = challenge.json.nonce;
  }
  const nonceSignature = sign(null, Buffer.from(nonce), privateKey).toString("base64url");
  const result = await timedJsonRequest(endpoint(workerOrigin, "/attestation/session"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ device_id: device.id, nonce, sig: nonceSignature }),
  });
  if (result.status !== 201 || !UUID_PATTERN.test(result.json?.session_id ?? "")) {
    throw new Error(`remote session issuance failed with status ${result.status}`);
  }
  const timingHeaderMilliseconds = (name) => {
    const raw = result.response.headers.get(name);
    if (raw === null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  return {
    ...result.json,
    sessionIssuanceMilliseconds: result.elapsedMilliseconds,
    sessionConfigMilliseconds: timingHeaderMilliseconds("X-FUSOU-TLSN-Benchmark-Session-Config-Ms"),
    sessionAuthorityMilliseconds: timingHeaderMilliseconds("X-FUSOU-TLSN-Benchmark-Session-Authority-Ms"),
    sessionBindingMilliseconds: timingHeaderMilliseconds("X-FUSOU-TLSN-Benchmark-Session-Binding-Ms"),
    sessionReceiptMilliseconds: timingHeaderMilliseconds("X-FUSOU-TLSN-Benchmark-Session-Receipt-Ms"),
  };
}

function verificationBody(session, device, privateKey, fixture) {
  return JSON.stringify({
    presentation_base64: fixture.sparse_presentation_base64,
    session_id: session.session_id,
    binding: session.binding,
    device_id: device.id,
    device_proof: {
      challenge: session.device_challenge,
      sig: signedDeviceProof(device, session, privateKey),
    },
  });
}

function parseTimingHeader(response) {
  const encoded = response.headers.get("X-FUSOU-TLSN-Benchmark-Timing");
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function synchronousCompletion(submission, executionMode) {
  const timing = submission.synchronousTiming;
  const completionHeader = Number(submission.response.headers.get(
    "X-FUSOU-TLSN-Benchmark-Server-Completion-Epoch-Ms",
  ));
  const diagnosticCompletion = typeof timing?.diagnostics?.server_completion_epoch_ms === "number"
    ? timing.diagnostics.server_completion_epoch_ms
    : null;
  const callerCompletion = executionMode === "direct"
    && typeof timing?.timestamps?.direct_invocation_completed === "number"
    ? timing.timestamps.direct_invocation_completed
    : null;
  const hasCompletionHeader = Number.isFinite(completionHeader) && completionHeader > 0;
  const hasDiagnosticCompletion = Number.isFinite(diagnosticCompletion) && diagnosticCompletion > 0;
  const hasCallerCompletion = Number.isFinite(callerCompletion) && callerCompletion > 0;
  return {
    outcome: "verified",
    clientT11: submission.clientT1,
    clientResponseBytes: submission.responseBodyBytes,
    clientResponseSha256: submission.responseBodySha256,
    statusRecoveryResponseBytes: submission.responseBodyBytes,
    statusRecoveryResponseSha256: submission.responseBodySha256,
    statusPollingMilliseconds: 0,
    pollCount: 0,
    pollingTotalElapsedMilliseconds: 0,
    pollingWaitBeforeFirstStatusRequestMilliseconds: 0,
    pollingWaitBetweenStatusRequestsMilliseconds: 0,
    pollingStatusRequestRoundTripMilliseconds: 0,
    pollingStatusRequestCount: 0,
    clientTerminalObservedEpochMilliseconds: submission.clientT1EpochMilliseconds,
    benchmarkServerCompletionEpochMilliseconds: hasCompletionHeader
      ? completionHeader
      : hasDiagnosticCompletion
        ? diagnosticCompletion
        : null,
    benchmarkServerCompletionEpochSource: hasCompletionHeader
      ? "completion_header"
      : hasDiagnosticCompletion
        ? "timing_diagnostics"
        : hasCallerCompletion
          ? "caller_direct_invocation_fallback"
          : "missing",
    callerDirectInvocationCompletedEpochMilliseconds: hasCallerCompletion ? callerCompletion : null,
            responseBytes: submission.responseBytes,
            responseJson: submission.json,
    timing,
    pollEvents: [],
  };
}

async function submitVerification(workerOrigin, accessToken, body, synchronousCandidate) {
  const clientT0 = performance.now();
  const result = await timedJsonRequest(endpoint(workerOrigin, "/verify/tlsn/sparse"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-FUSOU-TLSN-Response-Mode": synchronousCandidate ? "sync" : "async",
    },
    body,
  });
  const clientT1 = performance.now();
  const expectedStatus = synchronousCandidate ? 200 : 202;
  const testJobId = synchronousCandidate
    ? result.response.headers.get("X-FUSOU-TLSN-Test-Job-Id")
    : null;
  const testBenchmarkTraceId = synchronousCandidate
    ? result.response.headers.get("X-FUSOU-TLSN-Test-Benchmark-Trace-Id")
    : null;
  if (
    result.status !== expectedStatus ||
    (synchronousCandidate
      ? result.json?.verified !== true || !UUID_PATTERN.test(testJobId ?? "")
      : typeof result.json?.job_id !== "string")
  ) {
    throw new Error(`remote verification response was invalid: status ${result.status}, body ${JSON.stringify(result.json ?? null)}`);
  }
  return {
    jobId: synchronousCandidate ? testJobId : result.json.job_id,
    benchmarkTraceId: typeof result.json.benchmark_trace_id === "string"
      ? result.json.benchmark_trace_id
      : testBenchmarkTraceId,
    clientT0,
    clientT1,
    clientT0EpochMilliseconds: result.requestStartedEpochMilliseconds,
    clientT1EpochMilliseconds: result.responseReceivedEpochMilliseconds,
    requestBodyBytes: Buffer.byteLength(body),
    requestAcceptanceMilliseconds: clientT1 - clientT0,
    responseMode: synchronousCandidate ? "direct_synchronous" : "queued_202",
    requestBody: body,
    response: result.response,
    responseBytes: result.responseBytes,
    responseBodyBytes: result.responseBodyBytes,
    responseBodySha256: result.responseBodySha256,
    synchronousTiming: synchronousCandidate ? parseTimingHeader(result.response) : null,
  };
}

async function submitDirectControl(workerOrigin, accessToken, presentationBytes) {
  const result = await timedJsonRequest(endpoint(workerOrigin, "/internal/tlsn/direct-control"), {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      Authorization: `Bearer ${accessToken}`,
    },
    body: presentationBytes,
  });
  const requiredFields = [
    "request_construction_ms",
    "service_binding_fetch_wait_ms",
    "service_binding_round_trip_ms",
    "response_body_consumption_ms",
    "response_decode_ms",
  ];
  if (result.status !== 200 || result.json?.control !== "direct-service-binding-v1" || requiredFields.some(
    (field) => !Number.isFinite(result.json?.[field]) || result.json[field] < 0,
  )) {
    throw new Error(`remote Direct control response was invalid: status ${result.status}, body ${JSON.stringify(result.json ?? null)}`);
  }
  return {
    requestConstructionMilliseconds: result.json.request_construction_ms,
    serviceBindingFetchWaitMilliseconds: result.json.service_binding_fetch_wait_ms,
    serviceBindingRoundTripMilliseconds: result.json.service_binding_round_trip_ms,
    responseBodyConsumptionMilliseconds: result.json.response_body_consumption_ms,
    responseDecodeMilliseconds: result.json.response_decode_ms,
    clientRoundTripMilliseconds: result.elapsedMilliseconds,
    responseBodyBytes: result.responseBodyBytes,
  };
}

async function replaySynchronousVerification(workerOrigin, accessToken, submission) {
  const result = await timedJsonRequest(endpoint(workerOrigin, "/verify/tlsn/sparse"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-FUSOU-TLSN-Response-Mode": "sync",
    },
    body: submission.requestBody,
  });
  const timing = parseTimingHeader(result.response);
  if (result.status !== 200 || result.json?.verified !== true) {
    throw new Error(`remote synchronous replay failed with status ${result.status}, body ${JSON.stringify(result.json ?? null)}`);
  }
  if (
    result.responseBodyBytes !== submission.responseBodyBytes ||
    result.responseBodySha256 !== submission.responseBodySha256 ||
    !result.responseBytes.equals(submission.responseBytes)
  ) {
    throw new Error("remote synchronous replay response bytes did not match the initial response");
  }
  if (
    timing?.diagnostics?.synchronous_replay_path !== "established" ||
    timing?.diagnostics?.direct_invocation_count !== 1 ||
    timing?.do_operations?.start_verification !== 1 ||
    timing?.do_operations?.acquire_verification !== 1 ||
    timing?.do_operations?.commit_verified_result !== 1 ||
    timing?.do_operations?.replay_result_read !== 1 ||
    timing?.r2_operations?.result_archive_put !== 1 ||
    Object.keys(timing?.r2_operations ?? {}).some((operation) =>
      ["result_get", "status_result_get", "replay_result_get"].includes(operation),
    )
  ) {
    throw new Error(`remote synchronous replay diagnostics were invalid: ${JSON.stringify({
      diagnostics: timing?.diagnostics ?? null,
      r2_operations: timing?.r2_operations ?? null,
    })}`);
  }
  return {
    response: result.response,
    responseBytes: result.responseBytes,
    responseBodyBytes: result.responseBodyBytes,
    responseBodySha256: result.responseBodySha256,
    timing,
    replayMilliseconds: result.elapsedMilliseconds,
  };
}

async function pollStatus(workerOrigin, accessToken, userId, device, session, jobId, benchmarkTraceId, pollIntervalMs, maxPollMs, executionMode, synchronousCandidate = false) {
  const pollStartedAt = performance.now();
  const deadline = pollStartedAt + maxPollMs;
  let pollCount = 0;
  let firstVerifiedResponse;
  let previousResponseAt = pollStartedAt;
  let waitBeforeFirstStatusRequestMilliseconds = null;
  let waitBetweenStatusRequestsMilliseconds = 0;
  let statusRequestRoundTripMilliseconds = 0;
  let clientTerminalObservedEpochMilliseconds = null;
  let benchmarkServerCompletionEpochMilliseconds = null;
  let benchmarkServerCompletionEpochSource = "missing";
  let callerDirectInvocationCompletedEpochMilliseconds = null;
  const pollEvents = [];
  const complete = (value) => ({
    ...value,
    pollingTotalElapsedMilliseconds: performance.now() - pollStartedAt,
    pollingWaitBeforeFirstStatusRequestMilliseconds: waitBeforeFirstStatusRequestMilliseconds,
    pollingWaitBetweenStatusRequestsMilliseconds: waitBetweenStatusRequestsMilliseconds,
    pollingStatusRequestRoundTripMilliseconds: statusRequestRoundTripMilliseconds,
    pollingStatusRequestCount: pollCount,
    clientTerminalObservedEpochMilliseconds,
    benchmarkServerCompletionEpochMilliseconds,
    benchmarkServerCompletionEpochSource,
    callerDirectInvocationCompletedEpochMilliseconds,
    pollEvents,
  });
  while (performance.now() < deadline) {
    const statusRequestStartedAt = performance.now();
    const waitBeforeRequestMilliseconds = statusRequestStartedAt - previousResponseAt;
    if (pollCount === 0) {
      waitBeforeFirstStatusRequestMilliseconds = waitBeforeRequestMilliseconds;
    } else {
      waitBetweenStatusRequestsMilliseconds += waitBeforeRequestMilliseconds;
    }
    let result;
    try {
      result = await timedJsonRequest(endpoint(workerOrigin, "/verify/tlsn/status"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          job_id: jobId,
          binding_id: sha256Base64Url(session.binding),
          session_id: session.session_id,
          canonical_user_id: userId,
          device_id: device.id,
          ...(benchmarkTraceId ? { benchmark_trace_id: benchmarkTraceId } : {}),
        }),
      });
    } catch (error) {
      const responseReceivedAt = performance.now();
      pollCount += 1;
      statusRequestRoundTripMilliseconds += responseReceivedAt - statusRequestStartedAt;
      pollEvents.push({
        request_started_epoch_ms: Date.now() - Math.max(0, responseReceivedAt - statusRequestStartedAt),
        response_received_epoch_ms: Date.now(),
        status: null,
        terminal: true,
        request_round_trip_ms: responseReceivedAt - statusRequestStartedAt,
        wait_before_request_ms: waitBeforeRequestMilliseconds,
        error: error instanceof Error ? error.name : "request_failed",
      });
      clientTerminalObservedEpochMilliseconds = Date.now();
      return complete({
        outcome: "request_error",
        failureCode: "status_poll_request_failed",
        error: error instanceof Error ? error.message : "status_poll_request_failed",
        timing: null,
        pollCount,
      });
    }
    pollCount += 1;
    const responseReceivedAt = performance.now();
    previousResponseAt = responseReceivedAt;
    statusRequestRoundTripMilliseconds += result.elapsedMilliseconds;
    const timing = parseTimingHeader(result.response);
    const headerServerCompletionEpochRaw = result.response.headers.get(
      "X-FUSOU-TLSN-Benchmark-Server-Completion-Epoch-Ms",
    );
    const headerServerCompletionEpochMilliseconds = headerServerCompletionEpochRaw === null
      ? null
      : Number(headerServerCompletionEpochRaw);
    const diagnosticServerCompletionEpochMilliseconds = typeof timing?.diagnostics?.server_completion_epoch_ms === "number"
      ? timing.diagnostics.server_completion_epoch_ms
      : null;
    const directInvocationCompletionEpochMilliseconds = executionMode === "direct"
      && typeof timing?.timestamps?.direct_invocation_completed === "number"
      ? timing.timestamps.direct_invocation_completed
      : null;
    if (Number.isFinite(directInvocationCompletionEpochMilliseconds) && directInvocationCompletionEpochMilliseconds > 0) {
      callerDirectInvocationCompletedEpochMilliseconds = directInvocationCompletionEpochMilliseconds;
    }
    if (Number.isFinite(headerServerCompletionEpochMilliseconds) && headerServerCompletionEpochMilliseconds > 0) {
      benchmarkServerCompletionEpochMilliseconds = headerServerCompletionEpochMilliseconds;
      benchmarkServerCompletionEpochSource = "completion_header";
    } else if (
      benchmarkServerCompletionEpochSource !== "completion_header"
      && Number.isFinite(diagnosticServerCompletionEpochMilliseconds)
      && diagnosticServerCompletionEpochMilliseconds > 0
    ) {
      benchmarkServerCompletionEpochMilliseconds = diagnosticServerCompletionEpochMilliseconds;
      benchmarkServerCompletionEpochSource = "timing_diagnostics";
    } else if (
      benchmarkServerCompletionEpochSource === "missing"
      && Number.isFinite(callerDirectInvocationCompletedEpochMilliseconds)
    ) {
      benchmarkServerCompletionEpochSource = "caller_direct_invocation_fallback";
    }
    const terminal = result.status !== 202;
    pollEvents.push({
      request_started_epoch_ms: result.requestStartedEpochMilliseconds,
      response_received_epoch_ms: result.responseReceivedEpochMilliseconds,
      status: result.status,
      terminal,
      request_round_trip_ms: result.elapsedMilliseconds,
      wait_before_request_ms: waitBeforeRequestMilliseconds,
    });
    if (result.status === 200 && result.json?.verified === true) {
      const clientT11 = performance.now();
      clientTerminalObservedEpochMilliseconds ??= result.responseReceivedEpochMilliseconds;
      if (!firstVerifiedResponse) {
        firstVerifiedResponse = {
          clientT11,
          statusPollingMilliseconds: clientT11 - pollStartedAt,
          clientResponseBytes: result.responseBodyBytes,
          clientResponseSha256: result.responseBodySha256,
          responseBytes: result.responseBytes,
          responseJson: result.json,
          timing,
        };
      }
      if (requiredTimingStagesPresent(timing, executionMode, synchronousCandidate, synchronousCandidate)) {
        return complete({
          outcome: "verified",
          ...firstVerifiedResponse,
          timing,
          pollCount,
        });
      }
    } else if (result.status !== 202) {
      const boundedStatus = result.json && typeof result.json === "object"
        ? {
          verified: result.json.verified === true,
          ...(typeof result.json.status === "string" ? { status: result.json.status } : {}),
          ...(typeof result.json.error === "string" ? { error: result.json.error } : {}),
        }
        : null;
      const boundedDiagnostics = timing?.diagnostics && typeof timing.diagnostics === "object"
        ? Object.fromEntries(
          [
            "completion_failure_code",
            "terminal_failure_code",
            "terminal_outcome",
            "direct_invocation_count",
            "payload_bytes",
            "presentation_bytes",
            "presentation_transfer_bytes",
            "signed_result_bytes",
            "r2_object_bytes",
            "status_result_bytes",
            "lease_started_epoch_ms",
            "lease_expires_epoch_ms",
            "persistence_started_epoch_ms",
            "lease_remaining_at_persistence_start_ms",
            "terminal_failure_epoch_ms",
            "lease_remaining_at_terminal_failure_ms",
            "server_completion_epoch_ms",
          ]
            .filter((name) => Object.prototype.hasOwnProperty.call(timing.diagnostics, name))
            .map((name) => [name, timing.diagnostics[name]]),
        )
        : null;
      const completedStages = timing?.timestamps && typeof timing.timestamps === "object"
        ? Object.keys(timing.timestamps).filter((stage) => stage.startsWith("direct_") || stage.startsWith("t5_") || stage.startsWith("t6_") || stage.startsWith("t7_") || stage.startsWith("t8_") || stage.startsWith("t9_") || stage.startsWith("t10_") || stage.startsWith("t11_") || stage.startsWith("result_") || stage.startsWith("status_result_read_") || stage.startsWith("input_cleanup_"))
        : null;
      clientTerminalObservedEpochMilliseconds ??= result.responseReceivedEpochMilliseconds;
      return complete({
        outcome: "terminal_failure",
        failureCode: boundedStatus?.status ?? boundedStatus?.error ?? `status_${result.status}`,
        terminalStatus: result.status,
        terminalResponse: boundedStatus,
        timing,
        diagnostics: boundedDiagnostics,
        completedStages,
        r2Operations: timing?.r2_operations ?? null,
        durations: timing?.durations ?? null,
        pollCount,
      });
    }
    if (firstVerifiedResponse && performance.now() >= deadline) {
      return complete({ outcome: "verified", ...firstVerifiedResponse, pollCount });
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, pollIntervalMs));
  }
  if (firstVerifiedResponse) return complete({ outcome: "verified", ...firstVerifiedResponse, pollCount });
  clientTerminalObservedEpochMilliseconds ??= Date.now();
  return complete({
    outcome: "poll_timeout",
    failureCode: "poll_timeout",
    timing: null,
    pollCount,
  });
}

function stageTimestamp(timing, stage) {
  const value = timing?.timestamps?.[stage];
  return Number.isFinite(value) ? value : null;
}

function phaseMilliseconds(timing, start, end) {
  const startValue = stageTimestamp(timing, start);
  const endValue = stageTimestamp(timing, end);
  return startValue !== null && endValue !== null ? endValue - startValue : null;
}

function measuredPhaseMilliseconds(timing, durations, name, start, end) {
  return Number.isFinite(durations?.[name]) ? durations[name] : phaseMilliseconds(timing, start, end);
}

const REQUIRED_SESSION_TIMING_FIELDS = [
  "configMilliseconds",
  "authorityMilliseconds",
  "bindingMilliseconds",
  "receiptMilliseconds",
];

const REQUIRED_DIRECT_TIMING_DURATIONS = [
  "request_authentication",
  "request_body_read",
  "request_body_parse",
  "request_presentation_decode",
  "request_device_possession",
  "request_presentation_hash",
  "request_start_verification",
  "direct_request_construction",
  "direct_service_binding_fetch_wait",
  "direct_service_binding_round_trip",
  "direct_response_body_consumption",
  "direct_response_decode",
  "direct_callback_processing",
  "transport_residual",
  "direct_callback_entry_to_lease",
  "direct_callback_config_validation",
  "direct_callback_benchmark_registration",
  "direct_acquire_verification",
  "acquire_verification_rpc",
  "acquire_verification_transaction",
  "acquire_verification_storage_get",
  "acquire_verification_validation",
  "acquire_verification_storage_put",
  "acquire_verification_set_alarm",
  "direct_presentation_transfer",
  "direct_presentation_hash",
  "direct_wasm_verification",
  "result_canonicalization",
  "result_signing",
  "result_construction",
  "result_serialization",
  "result_hash",
  "result_persistence",
  "result_persistence_preparation",
  "result_persistence_post_commit",
  "do_commit_verified_result",
];

function requiredSessionTimingPresent(sessionMeasurement) {
  return sessionMeasurement !== undefined && REQUIRED_SESSION_TIMING_FIELDS.every(
    (field) => Number.isFinite(sessionMeasurement[field]) && sessionMeasurement[field] >= 0,
  );
}

function requiredTimingDurationsPresent(timing, executionMode, synchronousCandidate) {
  const requiredDurations = executionMode === "direct"
    ? [
      ...REQUIRED_DIRECT_TIMING_DURATIONS,
      ...(synchronousCandidate ? ["request_direct_dispatch", "direct_synchronous_response"] : []),
    ]
    : [];
  return requiredDurations.every(
    (name) => Number.isFinite(timing?.durations?.[name]) && timing.durations[name] >= 0,
  );
}

function requiredTimingStagesPresent(
  timing,
  executionMode,
  synchronousCandidate = false,
  statusRecovery = false,
  sessionMeasurement,
) {
  const requiredStages = synchronousCandidate
    ? statusRecovery
      ? [...SYNCHRONOUS_REQUIRED_TIMING_STAGES, "t11_status_verified"]
      : SYNCHRONOUS_REQUIRED_TIMING_STAGES
    : REQUIRED_TIMING_STAGES_BY_MODE[executionMode];
  return requiredStages.every((stage) => stageTimestamp(timing, stage) !== null)
    && requiredTimingDurationsPresent(timing, executionMode, synchronousCandidate)
    && (sessionMeasurement === undefined || requiredSessionTimingPresent(sessionMeasurement));
}

function pQuantile(values, quantile) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  return sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function summarize(samples, field) {
  const values = samples.map((sample) => sample[field]).filter(Number.isFinite);
  return {
    count: values.length,
    p50_ms: pQuantile(values, 0.5),
    p95_ms: pQuantile(values, 0.95),
    p99_ms: pQuantile(values, 0.99),
    max_ms: values.length ? Math.max(...values) : null,
  };
}

function pairedCorrelation(samples, leftField, rightField) {
  const pairs = samples
    .map((sample) => [sample[leftField], sample[rightField]])
    .filter(([left, right]) => Number.isFinite(left) && Number.isFinite(right));
  if (pairs.length === 0) {
    return { count: 0, pearson_r: null };
  }
  const leftMean = pairs.reduce((total, [left]) => total + left, 0) / pairs.length;
  const rightMean = pairs.reduce((total, [, right]) => total + right, 0) / pairs.length;
  const centered = pairs.map(([left, right]) => [left - leftMean, right - rightMean]);
  const numerator = centered.reduce((total, [left, right]) => total + left * right, 0);
  const leftNorm = Math.sqrt(centered.reduce((total, [left]) => total + left * left, 0));
  const rightNorm = Math.sqrt(centered.reduce((total, [, right]) => total + right * right, 0));
  return {
    count: pairs.length,
    pearson_r: leftNorm > 0 && rightNorm > 0 ? numerator / (leftNorm * rightNorm) : null,
  };
}

function sumFinite(values) {
  return values.reduce(
    (total, value) => total + (Number.isFinite(value) ? value : 0),
    0,
  );
}

function epochDelta(end, start) {
  if (!Number.isFinite(end) || !Number.isFinite(start)) {
    return { value: null, raw: null, invalid: false };
  }
  const raw = end - start;
  return { value: raw >= 0 ? raw : null, raw, invalid: raw < 0 };
}

function hasAuthoritativeCompletionEpoch(sample) {
  const source = sample.server_completion_epoch_source ?? sample.completion_marker_source;
  return (
    (source === "completion_header" || source === "timing_diagnostics")
    && Number.isFinite(sample.benchmark_server_completion_epoch_ms)
  );
}

function derivePollingSample(sample) {
  const events = Array.isArray(sample.poll_events) ? sample.poll_events : [];
  const firstEvent = events[0] ?? null;
  const terminalEvent = events.find((event) => event.terminal === true) ?? null;
  const completionEpoch = hasAuthoritativeCompletionEpoch(sample)
    ? sample.benchmark_server_completion_epoch_ms
    : null;
  const completionMarkerSource = sample.server_completion_epoch_source ?? "missing";
  const firstPollDelay = epochDelta(
    firstEvent?.request_started_epoch_ms,
    sample.initial_202_response_received_epoch_ms,
  );
  const nextPollAfterCompletion = Number.isFinite(completionEpoch)
    ? events.find((event) => event.request_started_epoch_ms >= completionEpoch) ?? null
    : null;
  const completionDuringStatusRequest = Number.isFinite(completionEpoch)
    ? events.find((event) => (
      Number.isFinite(event.request_started_epoch_ms)
      && Number.isFinite(event.response_received_epoch_ms)
      && event.request_started_epoch_ms < completionEpoch
      && completionEpoch <= event.response_received_epoch_ms
    )) ?? null
    : null;
  let completionRelativeToPollSchedule = "inconclusive_clock_order";
  if (Number.isFinite(completionEpoch) && firstEvent?.request_started_epoch_ms >= completionEpoch) {
    completionRelativeToPollSchedule = "before_first_status_request";
  } else if (completionDuringStatusRequest) {
    completionRelativeToPollSchedule = "during_status_request";
  } else if (nextPollAfterCompletion) {
    completionRelativeToPollSchedule = "between_status_requests";
  } else if (
    terminalEvent
    && Number.isFinite(completionEpoch)
    && Number.isFinite(terminalEvent.response_received_epoch_ms)
    && terminalEvent.response_received_epoch_ms < completionEpoch
  ) {
    completionRelativeToPollSchedule = "after_terminal_observation";
  }
  const terminalResponseAfterCompletion = terminalEvent && Number.isFinite(completionEpoch)
    ? epochDelta(
      terminalEvent.response_received_epoch_ms,
      Math.max(completionEpoch, terminalEvent.request_started_epoch_ms),
    )
    : { value: null, raw: null, invalid: false };
  const completionToTerminalPollStart = terminalEvent && Number.isFinite(completionEpoch)
    ? epochDelta(terminalEvent.request_started_epoch_ms, completionEpoch)
    : { value: null, raw: null, invalid: false };
  const completionToNextStatusRequest = nextPollAfterCompletion
    ? epochDelta(nextPollAfterCompletion.request_started_epoch_ms, completionEpoch)
    : { value: null, raw: null, invalid: false };
  const serverToClientObservation = epochDelta(
    sample.client_terminal_observed_epoch_ms,
    completionEpoch,
  );
  const invalidEpochDeltas = [
    ["first_poll_delay", firstPollDelay],
    ["terminal_response_after_completion", terminalResponseAfterCompletion],
    ["completion_to_next_status_request", completionToNextStatusRequest],
    ["completion_to_terminal_poll_start", completionToTerminalPollStart],
    ["server_to_client_observation_delay", serverToClientObservation],
  ]
    .filter(([, delta]) => delta.invalid)
    .map(([name]) => name);
  const statusRequestCount = events.length || sample.polling_status_request_count || 0;
  return {
    case_label: sample.case_label,
    concurrency: sample.concurrency,
    sample_index: sample.sample_index,
    outcome: "verified",
    completion_marker_source: completionMarkerSource,
    verification_start_request_start_epoch_ms: sample.verification_start_request_started_epoch_ms ?? null,
    initial_202_response_received_epoch_ms: sample.initial_202_response_received_epoch_ms ?? null,
    client_terminal_observed_epoch_ms: sample.client_terminal_observed_epoch_ms ?? null,
    benchmark_server_completion_epoch_ms: completionEpoch ?? null,
    caller_direct_invocation_completed_epoch_ms: sample.caller_direct_invocation_completed_epoch_ms ?? null,
    first_poll_delay_ms: firstPollDelay.invalid
      ? null
      : firstPollDelay.value ?? sample.polling_wait_before_first_status_request_ms ?? null,
    first_poll_delay_raw_ms: firstPollDelay.raw,
    polling_wait_before_first_status_request_ms: sample.polling_wait_before_first_status_request_ms ?? null,
    polling_wait_between_status_requests_ms: sample.polling_wait_between_status_requests_ms ?? null,
    total_poll_wait_ms: sumFinite(events.map((event) => event.wait_before_request_ms)),
    total_status_request_round_trip_ms: sumFinite(events.map((event) => event.request_round_trip_ms)),
    terminal_status_request_round_trip_ms: terminalEvent?.request_round_trip_ms ?? null,
    terminal_response_after_completion_ms: terminalResponseAfterCompletion.value,
    terminal_response_after_completion_raw_ms: terminalResponseAfterCompletion.raw,
    terminal_observation_delay_ms: serverToClientObservation.value,
    terminal_observation_delay_raw_ms: serverToClientObservation.raw,
    completion_to_next_status_request_delay_ms: completionToNextStatusRequest.value,
    completion_to_next_status_request_delay_raw_ms: completionToNextStatusRequest.raw,
    completion_to_next_poll_request_ms: completionToNextStatusRequest.value,
    completion_to_next_poll_request_raw_ms: completionToNextStatusRequest.raw,
    completion_to_terminal_poll_start_ms: completionToTerminalPollStart.value,
    completion_to_terminal_poll_start_raw_ms: completionToTerminalPollStart.raw,
    completion_relative_to_poll_schedule: Number.isFinite(completionEpoch)
      ? completionRelativeToPollSchedule
      : "inconclusive_server_completion_epoch_unavailable",
    invalid_epoch_deltas: invalidEpochDeltas,
    invalid_epoch_delta_count: invalidEpochDeltas.length,
    poll_count: statusRequestCount,
    status_request_count: statusRequestCount,
    total_http_request_count: 1 + statusRequestCount,
    requests_per_completed_verification: 1 + statusRequestCount,
    client_visible_ms: sample.client_visible_ms ?? null,
    server_completion_ms: sample.phases_ms?.server_completion ?? null,
    server_to_client_observation_delay_ms: sample.server_to_client_observation_delay_ms ?? null,
    do_operations: sample.do_operations ?? {},
    r2_operations: sample.r2_operations ?? {},
    response_bytes_match_result_hash: sample.response_bytes_match_result_hash ?? null,
    status_recovery_bytes_match_result_hash: sample.status_recovery_bytes_match_result_hash ?? null,
  };
}

function summarizePollingField(samples, field) {
  return summarize(samples.map((sample) => ({ value: sample[field] })), "value");
}

function diagnosePollingSchedule(samples) {
  const authoritativeSamples = samples.filter(hasAuthoritativeCompletionEpoch);
  if (authoritativeSamples.length === 0) {
    return {
      classification: "inconclusive",
      basis: "server_completion_epoch_unavailable",
      authoritative_completion_epoch_sample_count: 0,
      unavailable_completion_epoch_sample_count: samples.length,
      schedule_component_p95_ms: null,
      terminal_exchange_component_p95_ms: null,
      schedule_component_sample_count: 0,
      terminal_exchange_component_sample_count: 0,
    };
  }
  const scheduleValues = authoritativeSamples
    .map((sample) => sample.completion_to_terminal_poll_start_ms)
    .filter(Number.isFinite);
  const terminalExchangeValues = authoritativeSamples
    .map((sample) => sample.terminal_status_request_round_trip_ms)
    .filter(Number.isFinite);
  const scheduleP95 = pQuantile(scheduleValues, 0.95);
  const terminalExchangeP95 = pQuantile(terminalExchangeValues, 0.95);
  if (!Number.isFinite(scheduleP95) || !Number.isFinite(terminalExchangeP95)) {
    return {
      classification: "inconclusive",
      basis: "missing_sample_level_completion_to_terminal_poll_start_or_terminal_status_round_trip",
      authoritative_completion_epoch_sample_count: authoritativeSamples.length,
      unavailable_completion_epoch_sample_count: samples.length - authoritativeSamples.length,
      schedule_component_p95_ms: scheduleP95,
      terminal_exchange_component_p95_ms: terminalExchangeP95,
      schedule_component_sample_count: scheduleValues.length,
      terminal_exchange_component_sample_count: terminalExchangeValues.length,
    };
  }
  const classification = scheduleP95 > terminalExchangeP95 * 1.5
    ? "polling-schedule-dominated"
    : terminalExchangeP95 > scheduleP95 * 1.5
      ? "polling-round-trip-dominated"
      : "mixed";
  return {
    classification,
    basis: "sample_level_p95_completion_to_terminal_poll_start_vs_terminal_status_request_round_trip",
    authoritative_completion_epoch_sample_count: authoritativeSamples.length,
    unavailable_completion_epoch_sample_count: samples.length - authoritativeSamples.length,
    schedule_component_p95_ms: scheduleP95,
    terminal_exchange_component_p95_ms: terminalExchangeP95,
    schedule_component_sample_count: scheduleValues.length,
    terminal_exchange_component_sample_count: terminalExchangeValues.length,
  };
}

function sumResourceOperation(samples, operation, resource) {
  return samples.reduce((total, sample) => {
    const value = sample[resource]?.[operation];
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function buildPollingAuthoritySummary(samples, executionMode) {
  const all = (predicate) => samples.length > 0 && samples.every(predicate);
  const resultR2GetCount = ["result_get", "status_result_get", "replay_result_get"].reduce(
    (total, operation) => total + sumResourceOperation(samples, operation, "r2_operations"),
    0,
  );
  return {
    expected_semantics: {
      start_verification: 1,
      acquire_verification: 1,
      commit_verified_result: 1,
      fresh_direct_lookup_binding: 0,
      result_authority: "durable_object_commit",
      result_r2_get: 0,
      result_r2_put: "async_archive_only",
      polling_role: "observe_authoritative_result_only",
    },
    observed_counts: {
      start_verification: sumResourceOperation(samples, "start_verification", "do_operations"),
      acquire_verification: sumResourceOperation(samples, "acquire_verification", "do_operations"),
      commit_verified_result: sumResourceOperation(samples, "commit_verified_result", "do_operations"),
      fresh_direct_lookup_binding: sumResourceOperation(samples, "lookup_binding", "do_operations"),
      result_r2_get: resultR2GetCount,
      result_r2_put_archive: sumResourceOperation(samples, "result_archive_put", "r2_operations"),
    },
    invariant_checks: {
      start_verification_exactly_once: all((sample) => sample.do_operations?.start_verification === 1),
      acquire_verification_exactly_once: all((sample) => sample.do_operations?.acquire_verification === 1),
      commit_verified_result_exactly_once: all((sample) => sample.do_operations?.commit_verified_result === 1),
      fresh_direct_lookup_binding_zero: executionMode !== "direct"
        || all((sample) => (sample.do_operations?.lookup_binding ?? 0) === 0),
      result_r2_get_zero: resultR2GetCount === 0,
      result_bytes_match_result_hash: all((sample) => sample.response_bytes_match_result_hash === true),
      status_recovery_bytes_match_result_hash: all((sample) => sample.status_recovery_bytes_match_result_hash === true),
    },
    replay_semantics: "not_exercised_by_this_baseline; status polling only observes the committed result",
    callback_authority_semantics: "unchanged; this measurement does not promote polling to an authority mechanism",
  };
}

function buildPollingAnalysis({
  rows,
  failures,
  workerOrigin,
  health,
  cases,
  concurrencyValues,
  sampleCount,
  pollIntervalMs,
  maxPollMs,
  executionMode,
  authMode,
  expectedEnvironment,
  reportPath,
}) {
  const samples = rows.flatMap((row) => row.samples).map(derivePollingSample);
  const byConcurrency = concurrencyValues.map((concurrency) => {
    const group = samples.filter((sample) => sample.concurrency === concurrency);
    const diagnosis = diagnosePollingSchedule(group);
    return {
      concurrency,
      case_count: cases.length,
      requested_samples_per_case: sampleCount,
      requested_invocations: sampleCount * concurrency * cases.length,
      normal_verified_sample_records: group.length,
      timing_complete_sample_records: group.length,
      metrics: {
        client_visible: summarizePollingField(group, "client_visible_ms"),
        server_completion: summarizePollingField(group, "server_completion_ms"),
        total_poll_wait: summarizePollingField(group, "total_poll_wait_ms"),
        polling_wait_between_status_requests: summarizePollingField(group, "polling_wait_between_status_requests_ms"),
        total_status_request_round_trip: summarizePollingField(group, "total_status_request_round_trip_ms"),
        terminal_observation_delay: summarizePollingField(group, "terminal_observation_delay_ms"),
        terminal_observation_delay_raw: summarizePollingField(group, "terminal_observation_delay_raw_ms"),
        poll_count: summarizePollingField(group, "poll_count"),
        status_request_count: summarizePollingField(group, "status_request_count"),
        total_http_request_count: summarizePollingField(group, "total_http_request_count"),
        requests_per_completed_verification: summarizePollingField(group, "requests_per_completed_verification"),
        completion_to_next_status_request_delay: summarizePollingField(group, "completion_to_next_status_request_delay_ms"),
        completion_to_next_poll_request: summarizePollingField(group, "completion_to_next_poll_request_ms"),
        completion_to_terminal_poll_start: summarizePollingField(group, "completion_to_terminal_poll_start_ms"),
        completion_to_terminal_poll_start_raw: summarizePollingField(group, "completion_to_terminal_poll_start_raw_ms"),
        terminal_status_request_round_trip: summarizePollingField(group, "terminal_status_request_round_trip_ms"),
        terminal_response_after_completion: summarizePollingField(group, "terminal_response_after_completion_ms"),
        invalid_epoch_delta_count: summarizePollingField(group, "invalid_epoch_delta_count"),
      },
      correlations: {
        client_visible_vs_total_poll_wait: pairedCorrelation(group, "client_visible_ms", "total_poll_wait_ms"),
        client_visible_vs_polling_wait_between_status_requests: pairedCorrelation(group, "client_visible_ms", "polling_wait_between_status_requests_ms"),
        client_visible_vs_completion_to_next_poll_request: pairedCorrelation(group, "client_visible_ms", "completion_to_next_poll_request_ms"),
        client_visible_vs_terminal_status_request_round_trip: pairedCorrelation(group, "client_visible_ms", "terminal_status_request_round_trip_ms"),
        client_visible_vs_terminal_observation_delay: pairedCorrelation(group, "client_visible_ms", "terminal_observation_delay_ms"),
        client_visible_vs_poll_count: pairedCorrelation(group, "client_visible_ms", "poll_count"),
        server_completion_vs_client_visible: pairedCorrelation(group, "server_completion_ms", "client_visible_ms"),
      },
      completion_relative_to_poll_schedule: Object.fromEntries(
        [...new Set(group.map((sample) => sample.completion_relative_to_poll_schedule))]
          .map((phase) => [phase, group.filter((sample) => sample.completion_relative_to_poll_schedule === phase).length]),
      ),
      diagnosis,
    };
  });
  const invalidEpochDeltaNames = [
    "first_poll_delay",
    "terminal_response_after_completion",
    "completion_to_next_status_request",
    "completion_to_terminal_poll_start",
    "server_to_client_observation_delay",
  ];
  const invalidEpochDeltaCounts = Object.fromEntries(
    invalidEpochDeltaNames.map((name) => [
      name,
      samples.filter((sample) => sample.invalid_epoch_deltas.includes(name)).length,
    ]),
  );
  const completionMarkerSources = Object.fromEntries(
    ["completion_header", "timing_diagnostics", "caller_direct_invocation_fallback", "missing"]
      .map((source) => [source, samples.filter((sample) => sample.completion_marker_source === source).length]),
  );
  const globalDiagnosis = diagnosePollingSchedule(samples);
  return {
    schema_version: 2,
    benchmark: "tlsn-direct-polling-analysis",
    generated_at: new Date().toISOString(),
    source_report: repositoryRelativePath(reportPath),
    worker_origin: workerOrigin,
    worker_health: {
      environment: health.environment,
      deployment_role: health.deployment_role,
      deployment_id: health.deployment_id,
      git_commit_sha: health.git_commit_sha,
    },
    current_algorithm: {
      initial_status_request_delay_ms: 0,
      initial_status_request_behavior: "issue immediately after the initial 202 response is received",
      poll_interval_ms: pollIntervalMs,
      schedule: "fixed interval after each non-terminal status response",
      retry_or_backoff: "none; a status request error is terminal for the sample",
      non_terminal_status: 202,
      terminal_status: "any status other than 202",
      successful_terminal_condition: "status 200, verified true, and required timing metadata present",
      timeout_ms: maxPollMs,
      timeout_condition: "pollStatus deadline expires before a verified terminal response",
    },
    configuration: {
      execution_mode: executionMode,
      session_auth_mode: authMode,
      expected_environment: expectedEnvironment,
      cases,
      concurrency: concurrencyValues,
      requested_samples_per_case_and_concurrency: sampleCount,
      poll_interval_ms: pollIntervalMs,
      max_poll_ms: maxPollMs,
      sample_count_semantics: "requested samples are multiplied by concurrency and case count; internal timing records are not the same as requested sample count",
    },
    deployment_completion_marker: {
      source_counts: completionMarkerSources,
      completion_header_count: completionMarkerSources.completion_header,
      timing_diagnostics_count: completionMarkerSources.timing_diagnostics,
      caller_fallback_count: completionMarkerSources.caller_direct_invocation_fallback,
      missing_count: completionMarkerSources.missing,
      timestamp_semantics: "completion_header is authoritative, timing diagnostics are secondary, and direct_invocation_completed is caller-only telemetry; Worker epoch and client epoch are compared without clock-skew correction",
      old_deployment_compatibility: completionMarkerSources.caller_direct_invocation_fallback > 0
        ? "old deployment fallback was used"
        : "no completion marker fallback was used",
    },
    clock_order_anomalies: {
      invalid_epoch_delta_counts: invalidEpochDeltaCounts,
      total_invalid_epoch_delta_count: samples.reduce(
        (total, sample) => total + sample.invalid_epoch_delta_count,
        0,
      ),
    },
    baseline: {
      normal_verified_sample_records: samples.length,
      failure_count: failures.length,
      timing_complete_sample_records: samples.length,
      by_concurrency: byConcurrency,
      global: {
        client_visible: summarizePollingField(samples, "client_visible_ms"),
        server_completion: summarizePollingField(samples, "server_completion_ms"),
        total_poll_wait: summarizePollingField(samples, "total_poll_wait_ms"),
        polling_wait_between_status_requests: summarizePollingField(samples, "polling_wait_between_status_requests_ms"),
        total_status_request_round_trip: summarizePollingField(samples, "total_status_request_round_trip_ms"),
        terminal_observation_delay: summarizePollingField(samples, "terminal_observation_delay_ms"),
        terminal_observation_delay_raw: summarizePollingField(samples, "terminal_observation_delay_raw_ms"),
        poll_count: summarizePollingField(samples, "poll_count"),
        status_request_count: summarizePollingField(samples, "status_request_count"),
        total_http_request_count: summarizePollingField(samples, "total_http_request_count"),
        requests_per_completed_verification: summarizePollingField(samples, "requests_per_completed_verification"),
        completion_to_next_status_request_delay: summarizePollingField(samples, "completion_to_next_status_request_delay_ms"),
        completion_to_next_poll_request: summarizePollingField(samples, "completion_to_next_poll_request_ms"),
        completion_to_terminal_poll_start: summarizePollingField(samples, "completion_to_terminal_poll_start_ms"),
        completion_to_terminal_poll_start_raw: summarizePollingField(samples, "completion_to_terminal_poll_start_raw_ms"),
        terminal_status_request_round_trip: summarizePollingField(samples, "terminal_status_request_round_trip_ms"),
        terminal_response_after_completion: summarizePollingField(samples, "terminal_response_after_completion_ms"),
        invalid_epoch_delta_count: summarizePollingField(samples, "invalid_epoch_delta_count"),
      },
      correlations: {
        client_visible_vs_total_poll_wait: pairedCorrelation(samples, "client_visible_ms", "total_poll_wait_ms"),
        client_visible_vs_polling_wait_between_status_requests: pairedCorrelation(samples, "client_visible_ms", "polling_wait_between_status_requests_ms"),
        client_visible_vs_completion_to_next_poll_request: pairedCorrelation(samples, "client_visible_ms", "completion_to_next_poll_request_ms"),
        client_visible_vs_terminal_status_request_round_trip: pairedCorrelation(samples, "client_visible_ms", "terminal_status_request_round_trip_ms"),
        client_visible_vs_terminal_observation_delay: pairedCorrelation(samples, "client_visible_ms", "terminal_observation_delay_ms"),
        client_visible_vs_poll_count: pairedCorrelation(samples, "client_visible_ms", "poll_count"),
        server_completion_vs_client_visible: pairedCorrelation(samples, "server_completion_ms", "client_visible_ms"),
      },
      diagnosis: globalDiagnosis,
    },
    authority_invariants: buildPollingAuthoritySummary(samples, executionMode),
    samples,
    failures: failures.map((failure) => ({
      case_label: failure.case_label,
      concurrency: failure.concurrency,
      sample_index: failure.sample_index,
      outcome: failure.outcome,
      failure_code: failure.failure_code,
      poll_count: failure.poll_count,
      polling_total_elapsed_ms: failure.polling_total_elapsed_ms,
    })),
    optimization: "measurement-only; no runtime optimization retained",
  };
}

function summarizeServerDuration(samples, name) {
  return summarize(
    samples.map((sample) => ({ value: sample.server_durations?.[name] })),
    "value",
  );
}

function summarizePhases(samples) {
  return {
    config_validation: summarize(samples, "configValidationMilliseconds"),
    config_validation_request: summarizeServerDuration(samples, "config_validation_request"),
    config_validation_callback: summarizeServerDuration(samples, "config_validation_callback"),
    session_issuance: summarize(samples, "sessionIssuanceMilliseconds"),
    session_config: summarize(samples, "sessionConfigMilliseconds"),
    session_authority: summarize(samples, "sessionAuthorityMilliseconds"),
    session_binding: summarize(samples, "sessionBindingMilliseconds"),
    session_receipt: summarize(samples, "sessionReceiptMilliseconds"),
    request_acceptance: summarize(samples, "requestAcceptanceMilliseconds"),
    request_authentication: summarize(samples, "requestAuthenticationMilliseconds"),
    request_body_read: summarize(samples, "requestBodyReadMilliseconds"),
    request_body_parse: summarize(samples, "requestBodyParseMilliseconds"),
    request_presentation_decode: summarize(samples, "requestPresentationDecodeMilliseconds"),
    request_device_possession: summarize(samples, "requestDevicePossessionMilliseconds"),
    request_presentation_hash: summarize(samples, "requestPresentationHashMilliseconds"),
    request_start_verification: summarize(samples, "requestStartVerificationMilliseconds"),
    request_direct_dispatch: summarize(samples, "requestDirectDispatchMilliseconds"),
    trigger_accept_to_202_send: summarize(samples, "triggerAcceptTo202SendMilliseconds"),
    trigger_queue_start: summarize(samples, "triggerQueueStartMilliseconds"),
    direct_input_binding: summarize(samples, "directInputBindingMilliseconds"),
    direct_invocation_startup: summarize(samples, "directInvocationStartupMilliseconds"),
    direct_request_construction: summarize(samples, "directRequestConstructionMilliseconds"),
    direct_service_binding_fetch_wait: summarize(samples, "directServiceBindingFetchWaitMilliseconds"),
    direct_presentation_transfer: summarize(samples, "directPresentationTransferMilliseconds"),
    direct_presentation_hash: summarize(samples, "presentationHashMilliseconds"),
    direct_wasm_verification: summarize(samples, "wasmVerificationMilliseconds"),
    direct_service_binding_round_trip: summarize(samples, "directServiceBindingRoundTripMilliseconds"),
    direct_response_body_consumption: summarize(samples, "directResponseBodyConsumptionMilliseconds"),
    direct_response_decode: summarize(samples, "directResponseDecodeMilliseconds"),
    direct_control_request_construction: summarize(samples, "directControlRequestConstructionMilliseconds"),
    direct_control_service_binding_fetch_wait: summarize(samples, "directControlServiceBindingFetchWaitMilliseconds"),
    direct_control_service_binding_round_trip: summarize(samples, "directControlServiceBindingRoundTripMilliseconds"),
    direct_control_response_body_consumption: summarize(samples, "directControlResponseBodyConsumptionMilliseconds"),
    direct_control_response_decode: summarize(samples, "directControlResponseDecodeMilliseconds"),
    direct_control_client_round_trip: summarize(samples, "directControlClientRoundTripMilliseconds"),
    direct_callback_processing: summarize(samples, "directCallbackProcessingMilliseconds"),
    transport_residual: summarize(samples, "transportResidualMilliseconds"),
    direct_callback_entry_to_lease: summarize(samples, "directCallbackEntryToLeaseMilliseconds"),
    direct_callback_config_validation: summarize(samples, "directCallbackConfigValidationMilliseconds"),
    direct_callback_benchmark_registration: summarize(samples, "directCallbackBenchmarkRegistrationMilliseconds"),
    direct_acquire_verification: summarize(samples, "directAcquireVerificationMilliseconds"),
    acquire_verification_rpc: summarize(samples, "acquireVerificationRpcMilliseconds"),
    acquire_verification_transaction: summarize(samples, "acquireVerificationTransactionMilliseconds"),
    acquire_verification_storage_get: summarize(samples, "acquireVerificationStorageGetMilliseconds"),
    acquire_verification_validation: summarize(samples, "acquireVerificationValidationMilliseconds"),
    acquire_verification_storage_put: summarize(samples, "acquireVerificationStoragePutMilliseconds"),
    acquire_verification_set_alarm: summarize(samples, "acquireVerificationSetAlarmMilliseconds"),
    trigger_start_to_callback: summarize(samples, "triggerStartToCallbackMilliseconds"),
    callback_entry_to_lease: summarize(samples, "callbackEntryToLeaseMilliseconds"),
    worker_r2_input: summarize(samples, "workerR2InputMilliseconds"),
    presentation_hash: summarize(samples, "presentationHashMilliseconds"),
    wasm_verification: summarize(samples, "wasmVerificationMilliseconds"),
    result_signing: summarize(samples, "resultSigningMilliseconds"),
    result_canonicalization: summarize(samples, "resultCanonicalizationMilliseconds"),
    result_signing_detailed: summarize(samples, "resultSigningDetailedMilliseconds"),
    result_construction: summarize(samples, "resultConstructionMilliseconds"),
    result_serialization: summarize(samples, "resultSerializationMilliseconds"),
    result_hash: summarize(samples, "resultHashMilliseconds"),
    result_persistence: summarize(samples, "resultPersistenceMilliseconds"),
    result_persistence_preparation: summarize(samples, "resultPersistencePreparationMilliseconds"),
    result_persistence_post_commit: summarize(samples, "resultPersistencePostCommitMilliseconds"),
    result_persistence_detailed: summarize(samples, "resultPersistenceDetailedMilliseconds"),
    status_result_read: summarize(samples, "statusResultReadMilliseconds"),
    status_result_hash: summarize(samples, "statusResultHashMilliseconds"),
    status_result_parse: summarize(samples, "statusResultParseMilliseconds"),
    do_commit: summarize(samples, "doCommitMilliseconds"),
    do_commit_detailed: summarize(samples, "doCommitDetailedMilliseconds"),
    callback_response: summarize(samples, "callbackResponseMilliseconds"),
    direct_synchronous_response: summarize(samples, "synchronousResponseMilliseconds"),
    trigger_input_fetch: summarize(samples, "triggerInputFetchMilliseconds"),
    trigger_verifier: summarize(samples, "triggerVerifierMilliseconds"),
    trigger_verifier_initialization: summarize(samples, "triggerVerifierInitializationMilliseconds"),
    trigger_to_callback_request: summarize(samples, "triggerToCallbackRequestMilliseconds"),
    queue_verifier: summarize(samples, "queueVerifierMilliseconds"),
    queue_callback_dispatch: summarize(samples, "queueCallbackDispatchMilliseconds"),
    queue_send: summarize(samples, "queueSendMilliseconds"),
    queue_batch_to_handler: summarize(samples, "queueBatchToHandlerMilliseconds"),
    queue_callback_authentication: summarize(samples, "queueCallbackAuthenticationMilliseconds"),
    queue_callback_schema: summarize(samples, "queueCallbackSchemaMilliseconds"),
    queue_binding_lookup_and_lease: summarize(samples, "queueBindingLookupAndLeaseMilliseconds"),
    queue_presentation_read: summarize(samples, "queuePresentationReadMilliseconds"),
    queue_presentation_hash: summarize(samples, "queuePresentationHashMilliseconds"),
    queue_wasm_verification_detailed: summarize(samples, "queueWasmVerificationDetailedMilliseconds"),
    queue_result_signing_detailed: summarize(samples, "queueResultSigningDetailedMilliseconds"),
    queue_result_persistence_detailed: summarize(samples, "queueResultPersistenceDetailedMilliseconds"),
    queue_consume_detailed: summarize(samples, "queueConsumeDetailedMilliseconds"),
    queue_completion_response: summarize(samples, "queueCompletionResponseMilliseconds"),
    server_completion: summarize(samples, "serverCompletionMilliseconds"),
    client_observation: summarize(samples, "clientObservationMilliseconds"),
    status_polling: summarize(samples, "statusPollingMilliseconds"),
    polling_initial_response_round_trip: summarize(samples, "pollingInitialResponseRoundTripMilliseconds"),
    polling_wait_before_first_status_request: summarize(samples, "pollingWaitBeforeFirstStatusRequestMilliseconds"),
    polling_wait_between_status_requests: summarize(samples, "pollingWaitBetweenStatusRequestsMilliseconds"),
    polling_status_request_round_trip: summarize(samples, "pollingStatusRequestRoundTripMilliseconds"),
    polling_total_elapsed: summarize(samples, "pollingTotalElapsedMilliseconds"),
    polling_status_request_count: summarize(samples, "pollingStatusRequestCount"),
    server_to_client_observation_delay: summarize(samples, "serverToClientObservationDelayMilliseconds"),
    synchronous_response: summarize(samples, "synchronousResponseMilliseconds"),
    client_visible: summarize(samples, "clientVisibleMilliseconds"),
  };
}

function diagnoseNormalLatency(samples) {
  const completeSamples = samples.filter((sample) =>
    Number.isFinite(sample.clientVisibleMilliseconds)
    && Number.isFinite(sample.serverCompletionMilliseconds)
    && Number.isFinite(sample.serverToClientObservationDelayMilliseconds),
  );
  if (completeSamples.length === 0) {
    return {
      classification: "inconclusive",
      basis: "no_verified_samples_with_server_and_observation_epochs",
      sample_count: 0,
    };
  }
  const pollingValues = completeSamples.map((sample) =>
    (sample.pollingWaitBeforeFirstStatusRequestMilliseconds ?? 0)
    + (sample.pollingWaitBetweenStatusRequestsMilliseconds ?? 0)
    + Math.max(0, sample.serverToClientObservationDelayMilliseconds),
  );
  const serverValues = completeSamples.map((sample) => sample.serverCompletionMilliseconds);
  const pollingP95 = pQuantile(pollingValues, 0.95);
  const serverP95 = pQuantile(serverValues, 0.95);
  if (!Number.isFinite(pollingP95) || !Number.isFinite(serverP95)) {
    return {
      classification: "inconclusive",
      basis: "incomplete_verified_phase_measurements",
      sample_count: completeSamples.length,
    };
  }
  const classification = pollingP95 > serverP95 * 1.5
    ? "polling-observation-dominated"
    : serverP95 > pollingP95 * 1.5
      ? "server-processing-dominated"
      : "mixed";
  return {
    classification,
    basis: "verified_sample_p95_component_comparison",
    sample_count: completeSamples.length,
    polling_observation_component_p95_ms: pollingP95,
    server_processing_component_p95_ms: serverP95,
    clock_skew_caveat: "server epoch and client epoch are compared as coarse wall-clock markers; cross-runtime clock skew is not corrected",
  };
}

function summarizeConfigValidation(samples) {
  const sumDiagnostic = (...names) => names.reduce((total, name) => total + samples.reduce(
    (sampleTotal, sample) => sampleTotal + (Number.isFinite(sample.diagnostics?.[name]) ? sample.diagnostics[name] : 0),
    0,
  ), 0);
  return {
    validation_count: sumDiagnostic("config_validation_request_count", "config_validation_callback_count"),
    cache_hit_count: sumDiagnostic("config_validation_request_cache_hit_count", "config_validation_callback_cache_hit_count"),
    cache_miss_count: sumDiagnostic("config_validation_request_cache_miss_count", "config_validation_callback_cache_miss_count"),
    full_miss_count: sumDiagnostic("config_validation_request_full_miss_count", "config_validation_callback_full_miss_count"),
    concurrent_dedup_count: sumDiagnostic("config_validation_request_concurrent_dedup_count", "config_validation_callback_concurrent_dedup_count"),
  };
}

function summarizeConfigValidationBreakdown(samples) {
  const components = [
    ["total", ""],
    ["private_key", "_private_key"],
    ["fingerprint", "_fingerprint"],
    ["crypto", "_crypto"],
    ["cache_hit", "_cache_hit"],
    ["full_miss", "_full_miss"],
    ["concurrent_dedup", "_concurrent_dedup"],
    ["schema_validation", "_schema_validation"],
    ["registry_parsing", "_registry_parsing"],
    ["registry_lookup", "_registry_lookup"],
    ["base64_decoding", "_base64_decoding"],
    ["hostname_allowlist", "_hostname_allowlist"],
    ["other", "_other"],
  ];
  return Object.fromEntries(["request", "callback"].map((source) => [
    source,
    Object.fromEntries(components.map(([label, suffix]) => [
      label,
      summarizeServerDuration(samples, `config_validation_${source}${suffix}`),
    ])),
  ]));
}

function repositoryRelativePath(value) {
  const relative = resolve(value).startsWith(`${repositoryDirectory}/`)
    ? resolve(value).slice(repositoryDirectory.length + 1)
    : null;
  return relative ?? "EXTERNAL_SOURCE_NOT_RECORDED";
}

function payloadScalingReport(rows) {
  const observations = rows.flatMap((row) => row.samples.map((sample) => ({
    case_label: row.case_label,
    concurrency: row.concurrency,
    source_response_bytes: sample.source_response_bytes,
    payload_bytes: sample.payload_bytes,
    request_body_bytes: sample.request_body_bytes,
    presentation_bytes: sample.presentation_bytes,
    result_bytes: sample.result_bytes,
    signed_result_bytes: sample.signed_result_bytes,
    r2_object_bytes: sample.r2_object_bytes,
    client_response_bytes: sample.client_response_bytes,
  })));
  const measuredBands = new Set(
    observations
      .map((observation) => PAYLOAD_SCALING_BANDS.find(
        (band) => observation.presentation_bytes >= band.minimum && observation.presentation_bytes < band.maximum,
      )?.label)
      .filter(Boolean),
  );
  return {
    status: "MEASURED_ONLY_FOR_AVAILABLE_REAL_FIXTURES",
    synthetic_padding_used: false,
    arbitrary_payload_append_used: false,
    target_bands: PAYLOAD_SCALING_BANDS.map((band) => ({
      ...band,
      status: measuredBands.has(band.label) ? "MEASURED" : "NOT_ESTABLISHED",
      observations: observations.filter(
        (observation) => observation.presentation_bytes >= band.minimum && observation.presentation_bytes < band.maximum,
      ).length,
    })),
    observations,
  };
}

function summarizeResourceObservations(samples) {
  const countOperations = (operation) => samples.reduce(
    (total, sample) => total + (Number.isFinite(sample.r2_operations?.[operation]) ? sample.r2_operations[operation] : 0),
    0,
  );
  const countDiagnostic = (name) => samples.reduce(
    (total, sample) => total + (Number.isFinite(sample.diagnostics?.[name]) ? sample.diagnostics[name] : 0),
    0,
  );
  const countDOOperations = (operation) => samples.reduce(
    (total, sample) => total + (Number.isFinite(sample.do_operations?.[operation]) ? sample.do_operations[operation] : 0),
    0,
  );
  const resultR2ReadCount = ["result_get", "status_result_get", "replay_result_get"].reduce(
    (total, operation) => total + countOperations(operation),
    0,
  );
  return {
    requested_samples: samples.length,
    input_put_count: countOperations("input_put"),
    input_get_count: countOperations("trigger_input_get") + countOperations("worker_presentation_get"),
    input_delete_count: countOperations("input_delete"),
    result_archive_put_count: countOperations("result_archive_put"),
    result_r2_read_count: resultR2ReadCount,
    do_start_verification_count: countDOOperations("start_verification"),
    do_acquire_verification_count: countDOOperations("acquire_verification"),
    do_commit_verified_result_count: countDOOperations("commit_verified_result"),
    do_result_read_count: countDOOperations("result_read"),
    direct_invocation_count: countDiagnostic("direct_invocation_count"),
    transport_residual_negative_count: countDiagnostic("transport_residual_negative_count"),
    synchronous_replay_count: countDiagnostic("synchronous_replay_count"),
    late_callback_count: countDiagnostic("late_callback_count"),
    verified_count: samples.filter((sample) => sample.diagnostics?.terminal_outcome === "verified").length,
    not_verified_count: samples.filter((sample) => sample.diagnostics?.terminal_outcome === "not_verified").length,
    consumed_count: samples.filter((sample) => sample.diagnostics?.consume_outcome === "consumed").length,
    max_verifier_concurrency: samples.reduce(
      (maximum, sample) => Math.max(maximum, Number.isFinite(sample.maxVerifierConcurrency) ? sample.maxVerifierConcurrency : 0),
      0,
    ),
  };
}

function rowDecision(row) {
  if (row.successful_samples !== row.requested_samples || row.timing_complete_samples !== row.requested_samples) {
    return "NOT ESTABLISHED";
  }
  const client = row.phases.client_visible;
  return client.p95_ms <= RESULT_TARGET_MS && client.p99_ms <= RESULT_TARGET_MS && client.max_ms <= RESULT_TARGET_MS
    ? "MEASURED WITHIN TARGET"
    : "EXCEEDS TARGET";
}

async function runBatch({ workerOrigin, webOrigin, accessToken, userId, device, privateKey, manifest, entry, concurrency, sampleCount, pollIntervalMs, maxPollMs, executionMode, synchronousCandidate, responseLossRecovery }) {
  const sourcePath = fixtureSourcePath(manifest, entry);
  const samples = [];
  const failures = [];
  let preparationMilliseconds = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const sessionMeasurements = await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const session = await issueSession(
          workerOrigin,
          webOrigin,
          accessToken,
          device,
          privateKey,
          optional("TLSN_REMOTE_AUTH_MODE") ?? "supabase",
        );
        return {
          session,
          milliseconds: session.sessionIssuanceMilliseconds,
          configMilliseconds: session.sessionConfigMilliseconds,
          authorityMilliseconds: session.sessionAuthorityMilliseconds,
          bindingMilliseconds: session.sessionBindingMilliseconds,
          receiptMilliseconds: session.sessionReceiptMilliseconds,
        };
      }),
    );
    const sessions = sessionMeasurements.map(({ session }) => session);
    const fixtures = [];
    const preparationStartedAt = performance.now();
    for (const session of sessions) {
      const fixture = generateRealFixture(sourcePath, session.binding);
      fixture.source_fixture_body_bytes = entry.sourceFixtureBodyBytes;
      fixtures.push(fixture);
    }
    preparationMilliseconds += performance.now() - preparationStartedAt;

    const submissions = await Promise.all(sessions.map((session, index) => (
      submitVerification(
        workerOrigin,
        accessToken,
        verificationBody(session, device, privateKey, fixtures[index]),
        synchronousCandidate,
      )
    )));
    const completions = responseLossRecovery
      ? (await Promise.all(
        submissions.map((submission) => replaySynchronousVerification(workerOrigin, accessToken, submission)),
      )).map((recovery, index) => ({
        ...recovery,
        clientT11: performance.now(),
        clientResponseBytes: recovery.responseBodyBytes,
        clientResponseSha256: recovery.responseBodySha256,
        statusPollingMilliseconds: recovery.replayMilliseconds,
        pollCount: 0,
        statusRecoveryResponseBytes: recovery.responseBodyBytes,
        statusRecoveryResponseSha256: recovery.responseBodySha256,
        timing: recovery.timing,
        responseMode: "direct_synchronous_response_loss_recovery",
        initialResponseBytes: submissions[index].responseBodyBytes,
        initialResponseSha256: submissions[index].responseBodySha256,
      }))
      : synchronousCandidate
      ? (await Promise.all(
        submissions.map((submission) => synchronousCompletion(submission, executionMode)),
      ))
      : await Promise.all(
        submissions.map((submission, index) => pollStatus(
          workerOrigin,
          accessToken,
          userId,
          device,
          sessions[index],
          submission.jobId,
          submission.benchmarkTraceId,
          pollIntervalMs,
          maxPollMs,
          executionMode,
          false,
        )),
      );
    const controlMeasurements = executionMode === "direct"
      ? await Promise.all(fixtures.map((fixture) => submitDirectControl(
        workerOrigin,
        accessToken,
        Buffer.from(fixture.sparse_presentation_base64, "base64url"),
      )))
      : fixtures.map(() => null);
    for (let index = 0; index < concurrency; index += 1) {
      const submission = submissions[index];
      const completion = completions[index];
      const controlMeasurement = controlMeasurements[index];
      if (synchronousCandidate && (
        completion.pollCount !== 0
        || completion.pollingStatusRequestCount !== 0
        || completion.pollingTotalElapsedMilliseconds !== 0
        || completion.pollingWaitBeforeFirstStatusRequestMilliseconds !== 0
        || completion.pollingWaitBetweenStatusRequestsMilliseconds !== 0
        || completion.pollingStatusRequestRoundTripMilliseconds !== 0
        || completion.pollEvents.length !== 0
      )) {
        throw new Error("synchronous candidate performed status polling");
      }
      if (completion.outcome !== "verified") {
        const failureTiming = completion.timing;
        const failureDiagnostics = failureTiming?.diagnostics ?? completion.diagnostics ?? {};
        const failureServerToClientObservation = epochDelta(
          completion.clientTerminalObservedEpochMilliseconds,
          completion.benchmarkServerCompletionEpochMilliseconds,
        );
        failures.push({
          case_label: entry.caseLabel,
          concurrency,
          sample_index: sampleIndex,
          worker_sample_index: index,
          job_id_sha256: submission?.jobId ? sha256Base64Url(submission.jobId) : null,
          outcome: completion.outcome,
          failure_code: completion.failureCode ?? "unknown_failure",
          terminal_status: completion.terminalStatus ?? null,
          terminal_response: completion.terminalResponse ?? null,
          elapsed_ms: Number.isFinite(completion.pollingTotalElapsedMilliseconds)
            ? completion.pollingTotalElapsedMilliseconds
            : null,
          request_acceptance_ms: submission?.requestAcceptanceMilliseconds ?? null,
          poll_count: completion.pollCount ?? 0,
          polling_wait_before_first_status_request_ms: completion.pollingWaitBeforeFirstStatusRequestMilliseconds ?? null,
          polling_wait_between_status_requests_ms: completion.pollingWaitBetweenStatusRequestsMilliseconds ?? null,
          polling_status_request_round_trip_ms: completion.pollingStatusRequestRoundTripMilliseconds ?? null,
          polling_total_elapsed_ms: completion.pollingTotalElapsedMilliseconds ?? null,
          client_terminal_observed_epoch_ms: completion.clientTerminalObservedEpochMilliseconds ?? null,
          benchmark_server_completion_epoch_ms: completion.benchmarkServerCompletionEpochMilliseconds ?? null,
          server_completion_epoch_source: completion.benchmarkServerCompletionEpochSource ?? "missing",
          caller_direct_invocation_completed_epoch_ms: completion.callerDirectInvocationCompletedEpochMilliseconds ?? null,
          server_to_client_observation_delay_ms: failureServerToClientObservation.value,
          server_to_client_observation_delay_raw_ms: failureServerToClientObservation.raw,
          server_to_client_observation_epoch_delta_invalid: failureServerToClientObservation.invalid,
          diagnostics: failureDiagnostics,
          direct_acquire_verification_ms: Number.isFinite(failureTiming?.durations?.direct_acquire_verification)
            ? failureTiming.durations.direct_acquire_verification
            : null,
          direct_callback_processing_ms: Number.isFinite(failureTiming?.durations?.direct_callback_processing)
            ? failureTiming.durations.direct_callback_processing
            : null,
          transport_residual_ms: Number.isFinite(failureTiming?.durations?.transport_residual)
            ? failureTiming.durations.transport_residual
            : null,
          result_persistence_ms: Number.isFinite(failureTiming?.durations?.result_persistence)
            ? failureTiming.durations.result_persistence
            : null,
          result_persistence_preparation_ms: Number.isFinite(failureTiming?.durations?.result_persistence_preparation)
            ? failureTiming.durations.result_persistence_preparation
            : null,
          do_commit_verified_result_ms: Number.isFinite(failureTiming?.durations?.do_commit_verified_result)
            ? failureTiming.durations.do_commit_verified_result
            : null,
          lease_started_epoch_ms: Number.isFinite(failureDiagnostics.lease_started_epoch_ms)
            ? failureDiagnostics.lease_started_epoch_ms
            : null,
          lease_expires_epoch_ms: Number.isFinite(failureDiagnostics.lease_expires_epoch_ms)
            ? failureDiagnostics.lease_expires_epoch_ms
            : null,
          persistence_started_epoch_ms: Number.isFinite(failureDiagnostics.persistence_started_epoch_ms)
            ? failureDiagnostics.persistence_started_epoch_ms
            : null,
          lease_remaining_at_persistence_start_ms: Number.isFinite(failureDiagnostics.lease_remaining_at_persistence_start_ms)
            ? failureDiagnostics.lease_remaining_at_persistence_start_ms
            : null,
          terminal_failure_epoch_ms: Number.isFinite(failureDiagnostics.terminal_failure_epoch_ms)
            ? failureDiagnostics.terminal_failure_epoch_ms
            : null,
          lease_remaining_at_terminal_failure_ms: Number.isFinite(failureDiagnostics.lease_remaining_at_terminal_failure_ms)
            ? failureDiagnostics.lease_remaining_at_terminal_failure_ms
            : null,
          server_completion_epoch_ms: Number.isFinite(failureDiagnostics.server_completion_epoch_ms)
            ? failureDiagnostics.server_completion_epoch_ms
            : completion.benchmarkServerCompletionEpochMilliseconds ?? null,
          server_timestamps: failureTiming?.timestamps ?? {},
          server_durations: failureTiming?.durations ?? {},
        });
        continue;
      }
      const timing = completion.timing;
      const timestamps = timing?.timestamps ?? {};
      const durations = timing?.durations ?? {};
      const diagnostics = timing?.diagnostics ?? {};
      if (executionMode === "direct" && (timing?.do_operations?.lookup_binding ?? 0) !== 0) {
        throw new Error(`fresh Direct path performed lookup_binding: ${JSON.stringify(timing?.do_operations ?? {})}`);
      }
      if (
        executionMode === "direct"
        && (
          timing?.do_operations?.start_verification !== 1
          || timing?.do_operations?.acquire_verification !== 1
          || timing?.do_operations?.commit_verified_result !== 1
        )
      ) {
        throw new Error(`fresh Direct path authority operation invariant failed: ${JSON.stringify(timing?.do_operations ?? {})}`);
      }
      const t1Server = stageTimestamp(
        timing,
        synchronousCandidate ? "t0_accepted" : "t1_202_response_sent",
      );
      const t1DirectInputBound = stageTimestamp(timing, "t1_direct_input_bound");
      const t2 = stageTimestamp(
        timing,
        executionMode === "queue"
          ? "t2_queue_message_accepted"
          : executionMode === "direct"
            ? "direct_dispatch_started"
            : "t2_trigger_task_accepted",
      );
      const t3 = stageTimestamp(
        timing,
        executionMode === "queue"
          ? "t3_queue_execution_started"
          : executionMode === "direct"
            ? "t3_direct_execution_started"
            : "t3_trigger_execution_started",
      );
      const t4 = stageTimestamp(timing, "t4_callback_accepted");
      const t5 = stageTimestamp(timing, "t5_lease_acquired");
      const t6 = stageTimestamp(timing, "t6_presentation_read");
      const t7 = stageTimestamp(timing, "t7_wasm_verification_completed");
      const t8Signing = stageTimestamp(timing, "t8_result_signing_completed");
      const t8Persisted = stageTimestamp(timing, "t8_result_persisted");
      const resultHashStarted = stageTimestamp(timing, "result_hash_started");
      const resultHashCompleted = stageTimestamp(timing, "result_hash_completed");
      const t9 = stageTimestamp(timing, "t9_consume_completed");
      const t10 = stageTimestamp(timing, "t10_consume_completed");
      const t10CallbackResponse = stageTimestamp(timing, "t10_callback_response_ready");
      const observed = requiredTimingStagesPresent(
        timing,
        executionMode,
        synchronousCandidate,
        false,
        sessionMeasurements[index],
      );
      const queueVerifierStarted = stageTimestamp(timing, "t3_queue_verifier_started");
      const queueVerifierCompleted = stageTimestamp(timing, "t3_queue_verifier_completed");
      const queueCallbackDispatchStarted = stageTimestamp(timing, "t3_queue_callback_dispatch_started");
      const queueCallbackResponseReceived = stageTimestamp(timing, "t3_queue_callback_response_received");
      const triggerVerifierInitializationStarted = stageTimestamp(timing, "t3_trigger_verifier_initialization_started");
      const triggerVerifierInitializationCompleted = stageTimestamp(timing, "t3_trigger_verifier_initialization_completed");
      const serverToClientObservation = epochDelta(
        completion.clientTerminalObservedEpochMilliseconds,
        completion.benchmarkServerCompletionEpochMilliseconds,
      );
      samples.push({
        case_label: entry.caseLabel,
        body_bytes: entry.sourceFixtureBodyBytes,
        sourceResponseBytes: entry.sourceFixtureBodyBytes,
        presentation_bytes: Buffer.from(fixtures[index].sparse_presentation_base64, "base64url").length,
        concurrency,
        sample_index: sampleIndex,
        responseMode: responseLossRecovery ? completion.responseMode : submission.responseMode,
        statusRecoveryMeasured: responseLossRecovery || !synchronousCandidate,
        responseLossRecoveryMeasured: responseLossRecovery,
        requestBodyBytes: submission.requestBodyBytes,
        resultBytes: Number.isFinite(diagnostics.result_bytes) ? diagnostics.result_bytes : null,
        payloadBytes: Number.isFinite(diagnostics.payload_bytes) ? diagnostics.payload_bytes : null,
        signedResultBytes: Number.isFinite(diagnostics.signed_result_bytes) ? diagnostics.signed_result_bytes : null,
        r2ObjectBytes: Number.isFinite(diagnostics.r2_object_bytes) ? diagnostics.r2_object_bytes : null,
        statusResultBytes: Number.isFinite(diagnostics.status_result_bytes) ? diagnostics.status_result_bytes : null,
        clientResponseBytes: responseLossRecovery ? submission.responseBodyBytes : completion.clientResponseBytes,
        clientResponseSha256: responseLossRecovery ? submission.responseBodySha256 : completion.clientResponseSha256 ?? submission.responseBodySha256,
        statusRecoveryResponseBytes: synchronousCandidate && !responseLossRecovery
          ? null
          : responseLossRecovery
            ? completion.statusRecoveryResponseBytes
            : completion.statusRecoveryResponseBytes ?? completion.clientResponseBytes,
        statusRecoveryResponseSha256: synchronousCandidate && !responseLossRecovery
          ? null
          : responseLossRecovery
            ? completion.statusRecoveryResponseSha256
            : completion.statusRecoveryResponseSha256 ?? completion.clientResponseSha256 ?? submission.responseBodySha256,
        responseLossRecoveryResponseBytes: responseLossRecovery ? completion.responseBodyBytes : null,
        responseLossRecoveryResponseSha256: responseLossRecovery ? completion.responseBodySha256 : null,
        resultSha256: typeof diagnostics.result_sha256 === "string" ? diagnostics.result_sha256 : null,
        responseBytesMatchResultHash: typeof diagnostics.result_sha256 === "string"
          && (responseLossRecovery ? submission.responseBodySha256 : completion.clientResponseSha256 ?? submission.responseBodySha256) === diagnostics.result_sha256,
        responseBytesMatchResultBytes: Number.isFinite(diagnostics.result_bytes)
          && completion.clientResponseBytes === diagnostics.result_bytes,
        statusRecoveryBytesMatchResponse: synchronousCandidate && !responseLossRecovery
          ? null
          : (responseLossRecovery
            ? completion.statusRecoveryResponseSha256
            : completion.statusRecoveryResponseSha256 ?? completion.clientResponseSha256 ?? submission.responseBodySha256)
            === (responseLossRecovery ? submission.responseBodySha256 : completion.clientResponseSha256 ?? submission.responseBodySha256)
            && (responseLossRecovery ? completion.statusRecoveryResponseBytes : completion.statusRecoveryResponseBytes ?? completion.clientResponseBytes)
              === (responseLossRecovery ? submission.responseBodyBytes : completion.clientResponseBytes),
        statusRecoveryBytesMatchResultHash: typeof diagnostics.result_sha256 === "string"
          && !(synchronousCandidate && !responseLossRecovery)
          && (responseLossRecovery
            ? completion.statusRecoveryResponseSha256
            : completion.statusRecoveryResponseSha256 ?? completion.clientResponseSha256 ?? submission.responseBodySha256) === diagnostics.result_sha256,
        statusRecoveryBytesMatchResultBytes: Number.isFinite(diagnostics.result_bytes)
          && !(synchronousCandidate && !responseLossRecovery)
          && (responseLossRecovery ? completion.statusRecoveryResponseBytes : completion.statusRecoveryResponseBytes ?? completion.clientResponseBytes) === diagnostics.result_bytes,
        responseBytesMatchCommittedResult: typeof diagnostics.result_sha256 === "string"
          && completion.clientResponseSha256 === diagnostics.result_sha256
          && Number.isFinite(diagnostics.result_bytes)
          && completion.clientResponseBytes === diagnostics.result_bytes,
        requestAcceptanceMilliseconds: submission.requestAcceptanceMilliseconds,
        requestAuthenticationMilliseconds: Number.isFinite(durations.request_authentication) ? durations.request_authentication : null,
        requestBodyReadMilliseconds: Number.isFinite(durations.request_body_read) ? durations.request_body_read : null,
        requestBodyParseMilliseconds: Number.isFinite(durations.request_body_parse) ? durations.request_body_parse : null,
        requestPresentationDecodeMilliseconds: Number.isFinite(durations.request_presentation_decode) ? durations.request_presentation_decode : null,
        requestDevicePossessionMilliseconds: Number.isFinite(durations.request_device_possession) ? durations.request_device_possession : null,
        requestPresentationHashMilliseconds: Number.isFinite(durations.request_presentation_hash) ? durations.request_presentation_hash : null,
        requestStartVerificationMilliseconds: Number.isFinite(durations.request_start_verification) ? durations.request_start_verification : null,
        requestDirectDispatchMilliseconds: Number.isFinite(durations.request_direct_dispatch) ? durations.request_direct_dispatch : null,
        sessionIssuanceMilliseconds: sessionMeasurements[index].milliseconds,
        configValidationMilliseconds: Number.isFinite(durations.config_validation_request) || Number.isFinite(durations.config_validation_callback)
          ? (durations.config_validation_request ?? 0) + (durations.config_validation_callback ?? 0)
          : null,
        sessionConfigMilliseconds: sessionMeasurements[index].configMilliseconds,
        sessionAuthorityMilliseconds: sessionMeasurements[index].authorityMilliseconds,
        sessionBindingMilliseconds: sessionMeasurements[index].bindingMilliseconds,
        sessionReceiptMilliseconds: sessionMeasurements[index].receiptMilliseconds,
        verificationStartRequestStartedEpochMilliseconds: submission.clientT0EpochMilliseconds,
        initial202ResponseReceivedEpochMilliseconds: submission.clientT1EpochMilliseconds,
        statusPollingMilliseconds: completion.statusPollingMilliseconds,
        pollCount: completion.pollCount,
        pollingInitialResponseRoundTripMilliseconds: synchronousCandidate ? null : submission.requestAcceptanceMilliseconds,
        pollingWaitBeforeFirstStatusRequestMilliseconds: completion.pollingWaitBeforeFirstStatusRequestMilliseconds,
        pollingWaitBetweenStatusRequestsMilliseconds: completion.pollingWaitBetweenStatusRequestsMilliseconds,
        pollingStatusRequestRoundTripMilliseconds: completion.pollingStatusRequestRoundTripMilliseconds,
        pollingTotalElapsedMilliseconds: completion.pollingTotalElapsedMilliseconds,
        pollingStatusRequestCount: completion.pollingStatusRequestCount,
        clientTerminalObservedEpochMilliseconds: completion.clientTerminalObservedEpochMilliseconds,
        benchmarkServerCompletionEpochMilliseconds: completion.benchmarkServerCompletionEpochMilliseconds,
        benchmarkServerCompletionEpochSource: completion.benchmarkServerCompletionEpochSource ?? "missing",
        callerDirectInvocationCompletedEpochMilliseconds: completion.callerDirectInvocationCompletedEpochMilliseconds ?? null,
        serverToClientObservationDelayMilliseconds: serverToClientObservation.value,
        serverToClientObservationDelayRawMilliseconds: serverToClientObservation.raw,
        serverToClientObservationEpochDeltaInvalid: serverToClientObservation.invalid,
        pollEvents: completion.pollEvents,
        clientVisibleMilliseconds: completion.clientT11 - submission.clientT0,
        serverCompletionMilliseconds: t1Server !== null && t10 !== null ? t10 - t1Server : null,
        clientObservationMilliseconds: completion.clientT11 - submission.clientT1,
        triggerAcceptTo202SendMilliseconds: synchronousCandidate
          ? null
          : t1Server !== null && t2 !== null
            ? t1Server - t2
            : null,
        triggerQueueStartMilliseconds: t2 !== null && t3 !== null ? t3 - t2 : null,
        directInputBindingMilliseconds: t1DirectInputBound !== null && stageTimestamp(timing, "t0_accepted") !== null
          ? t1DirectInputBound - stageTimestamp(timing, "t0_accepted")
          : null,
        directInvocationStartupMilliseconds: executionMode === "direct" && t2 !== null && t3 !== null ? t3 - t2 : null,
        directRequestConstructionMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_request_construction) ? durations.direct_request_construction : null
          : null,
        directServiceBindingFetchWaitMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_service_binding_fetch_wait) ? durations.direct_service_binding_fetch_wait : null
          : null,
        directServiceBindingRoundTripMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_service_binding_round_trip) ? durations.direct_service_binding_round_trip : null
          : null,
        directResponseBodyConsumptionMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_response_body_consumption) ? durations.direct_response_body_consumption : null
          : null,
        directResponseDecodeMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_response_decode) ? durations.direct_response_decode : null
          : null,
        directControlRequestConstructionMilliseconds: controlMeasurement?.requestConstructionMilliseconds ?? null,
        directControlServiceBindingFetchWaitMilliseconds: controlMeasurement?.serviceBindingFetchWaitMilliseconds ?? null,
        directControlServiceBindingRoundTripMilliseconds: controlMeasurement?.serviceBindingRoundTripMilliseconds ?? null,
        directControlResponseBodyConsumptionMilliseconds: controlMeasurement?.responseBodyConsumptionMilliseconds ?? null,
        directControlResponseDecodeMilliseconds: controlMeasurement?.responseDecodeMilliseconds ?? null,
        directControlClientRoundTripMilliseconds: controlMeasurement?.clientRoundTripMilliseconds ?? null,
        directControlResponseBodyBytes: controlMeasurement?.responseBodyBytes ?? null,
        directCallbackProcessingMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_callback_processing) ? durations.direct_callback_processing : null
          : null,
        transportResidualMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.transport_residual) ? durations.transport_residual : null
          : null,
        transportResidualNegativeCount: executionMode === "direct"
          ? Number.isFinite(diagnostics.transport_residual_negative_count) ? diagnostics.transport_residual_negative_count : 0
          : 0,
        directCallbackEntryToLeaseMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_callback_entry_to_lease) ? durations.direct_callback_entry_to_lease : null
          : null,
        directCallbackConfigValidationMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_callback_config_validation) ? durations.direct_callback_config_validation : null
          : null,
        directCallbackBenchmarkRegistrationMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_callback_benchmark_registration) ? durations.direct_callback_benchmark_registration : null
          : null,
        directAcquireVerificationMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_acquire_verification) ? durations.direct_acquire_verification : null
          : null,
        acquireVerificationRpcMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.acquire_verification_rpc) ? durations.acquire_verification_rpc : null
          : null,
        acquireVerificationTransactionMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.acquire_verification_transaction) ? durations.acquire_verification_transaction : null
          : null,
        acquireVerificationStorageGetMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.acquire_verification_storage_get) ? durations.acquire_verification_storage_get : null
          : null,
        acquireVerificationValidationMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.acquire_verification_validation) ? durations.acquire_verification_validation : null
          : null,
        acquireVerificationStoragePutMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.acquire_verification_storage_put) ? durations.acquire_verification_storage_put : null
          : null,
        acquireVerificationSetAlarmMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.acquire_verification_set_alarm) ? durations.acquire_verification_set_alarm : null
          : null,
        directPresentationTransferMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_presentation_transfer) ? durations.direct_presentation_transfer : null
          : null,
        triggerStartToCallbackMilliseconds: t3 !== null && t4 !== null ? t4 - t3 : null,
        callbackEntryToLeaseMilliseconds: t4 !== null && t5 !== null ? t5 - t4 : null,
        workerR2InputMilliseconds: phaseMilliseconds(timing, "t5_lease_acquired", "t5_presentation_read"),
        presentationHashMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_presentation_hash) ? durations.direct_presentation_hash : null
          : phaseMilliseconds(timing, "t5_presentation_hash_started", "t5_presentation_hash_completed"),
        wasmVerificationMilliseconds: executionMode === "direct"
          ? Number.isFinite(durations.direct_wasm_verification) ? durations.direct_wasm_verification : null
          : phaseMilliseconds(timing, "t6_presentation_read", "t7_wasm_verification_completed"),
        resultSigningMilliseconds: t8Signing !== null ? t8Signing - t7 : null,
        resultPersistenceMilliseconds: Number.isFinite(durations.result_persistence) ? durations.result_persistence : null,
        doCommitMilliseconds: Number.isFinite(durations.do_commit_verified_result) ? durations.do_commit_verified_result : null,
        resultCanonicalizationMilliseconds: measuredPhaseMilliseconds(
          timing,
          durations,
          "result_canonicalization",
          "result_canonicalization_started",
          "result_canonicalization_completed",
        ),
        resultSigningDetailedMilliseconds: measuredPhaseMilliseconds(
          timing,
          durations,
          "result_signing",
          "result_signing_started",
          "result_signing_completed",
        ),
        resultConstructionMilliseconds: measuredPhaseMilliseconds(
          timing,
          durations,
          "result_construction",
          "result_construction_started",
          "result_construction_completed",
        ),
        resultSerializationMilliseconds: measuredPhaseMilliseconds(
          timing,
          durations,
          "result_serialization",
          "result_serialization_started",
          "result_serialization_completed",
        ),
        resultHashMilliseconds: measuredPhaseMilliseconds(
          timing,
          durations,
          "result_hash",
          "result_hash_started",
          "result_hash_completed",
        ) ?? (resultHashStarted !== null && resultHashCompleted !== null ? resultHashCompleted - resultHashStarted : null),
        resultPersistenceDetailedMilliseconds: measuredPhaseMilliseconds(
          timing,
          durations,
          "result_persistence",
          "result_persistence_started",
          "result_persistence_completed",
        ),
        resultPersistencePreparationMilliseconds: Number.isFinite(durations.result_persistence_preparation)
          ? durations.result_persistence_preparation
          : null,
        resultPersistencePostCommitMilliseconds: Number.isFinite(durations.result_persistence_post_commit)
          ? durations.result_persistence_post_commit
          : null,
        statusResultReadMilliseconds: measuredPhaseMilliseconds(
          timing,
          durations,
          "status_result_read",
          "status_result_read_started",
          "status_result_read_completed",
        ),
        statusResultHashMilliseconds: measuredPhaseMilliseconds(
          timing,
          durations,
          "status_result_hash",
          "status_result_hash_started",
          "status_result_hash_completed",
        ),
        statusResultParseMilliseconds: measuredPhaseMilliseconds(
          timing,
          durations,
          "status_result_parse",
          "status_result_parse_started",
          "status_result_parse_completed",
        ),
        doCommitDetailedMilliseconds: measuredPhaseMilliseconds(
          timing,
          durations,
          "do_commit_verified_result",
          "result_persistence_started",
          "result_persistence_completed",
        ),
        callbackResponseMilliseconds: t10 !== null && t10CallbackResponse !== null ? t10CallbackResponse - t10 : null,
        synchronousResponseMilliseconds: synchronousCandidate
          ? responseLossRecovery
            ? completion.replayMilliseconds
            : Number.isFinite(durations.direct_synchronous_response) ? durations.direct_synchronous_response : null
          : null,
        triggerInputFetchMilliseconds: phaseMilliseconds(timing, "t3_trigger_input_fetch_started", "t3_trigger_input_fetch_completed"),
        triggerVerifierMilliseconds: phaseMilliseconds(timing, "t3_trigger_verifier_started", "t3_trigger_verifier_completed"),
        triggerVerifierInitializationMilliseconds: triggerVerifierInitializationStarted !== null && triggerVerifierInitializationCompleted !== null
          ? triggerVerifierInitializationCompleted - triggerVerifierInitializationStarted
          : null,
        triggerToCallbackRequestMilliseconds: t3 !== null && stageTimestamp(timing, "t3_trigger_callback_request_started") !== null
          ? stageTimestamp(timing, "t3_trigger_callback_request_started") - t3
          : null,
        queueVerifierMilliseconds: queueVerifierStarted !== null && queueVerifierCompleted !== null
          ? queueVerifierCompleted - queueVerifierStarted
          : null,
        queueCallbackDispatchMilliseconds: queueCallbackDispatchStarted !== null && queueCallbackResponseReceived !== null
          ? queueCallbackResponseReceived - queueCallbackDispatchStarted
          : null,
        queueSendMilliseconds: Number.isFinite(durations.queue_send) ? durations.queue_send : null,
        queueBatchToHandlerMilliseconds: Number.isFinite(durations.queue_batch_to_handler)
          ? durations.queue_batch_to_handler
          : null,
        queueCallbackAuthenticationMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_callback_authentication", "queue_callback_authentication_started", "queue_callback_authentication_completed"),
        queueCallbackSchemaMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_callback_schema", "queue_callback_authentication_completed", "queue_callback_schema_validated"),
        queueBindingLookupAndLeaseMilliseconds: measuredPhaseMilliseconds(
          timing,
          durations,
          "queue_binding_lookup_and_lease",
          "queue_binding_lookup_and_lease_started",
          "queue_binding_lookup_and_lease_completed",
        ),
        queuePresentationReadMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_presentation_read", "queue_presentation_read_started", "queue_presentation_read_completed"),
        queuePresentationHashMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_presentation_hash", "queue_presentation_read_completed", "queue_presentation_hash_completed"),
        queueWasmVerificationDetailedMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_wasm_verification", "queue_wasm_verification_started", "queue_wasm_verification_completed"),
        queueResultSigningDetailedMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_result_signing", "queue_result_signing_started", "queue_result_signing_completed"),
        queueResultPersistenceDetailedMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_result_persistence", "queue_result_persistence_started", "queue_result_persistence_completed"),
        queueConsumeDetailedMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_consume", "queue_consume_started", "queue_consume_completed"),
        queueCompletionResponseMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_completion_response", "queue_consume_completed", "queue_completion_response_ready"),
        resultFinalizationMilliseconds: phaseMilliseconds(timing, "t7_wasm_verification_completed", "t10_consume_completed"),
        timing_complete: observed,
        timing_trace_id_present: typeof timing?.trace_id_sha256 === "string",
        timing_trace_id_matches_submission: typeof timing?.trace_id_sha256 === "string" && timing.trace_id_sha256 === sha256Base64Url(submission.benchmarkTraceId ?? ""),
        timing_job_id_hashed: typeof timing?.job_id_sha256 === "string",
        timing_job_id_matches_submission: typeof timing?.job_id_sha256 === "string"
          && typeof submission.jobId === "string"
          && timing.job_id_sha256 === sha256Base64Url(submission.jobId),
        maxVerifierConcurrency: Number.isFinite(timing?.max_verifier_concurrency)
          ? timing.max_verifier_concurrency
          : null,
        r2_operations: timing?.r2_operations ?? {},
        do_operations: timing?.do_operations ?? {},
        diagnostics,
        server_timestamps: timestamps,
        server_durations: durations,
        queue_message_diagnostics: diagnostics,
      });
    }
  }
  const row = {
    case_label: entry.caseLabel,
    body_bytes: entry.sourceFixtureBodyBytes,
    concurrency,
    requested_samples: sampleCount * concurrency,
    successful_samples: samples.length,
    failure_samples: failures.length,
    timing_complete_samples: samples.filter((sample) => sample.timing_complete).length,
    preparation_milliseconds_excluded: preparationMilliseconds,
    payload_sizes: {
      source_response_bytes: summarize(samples, "sourceResponseBytes"),
      request_body_bytes: summarize(samples, "requestBodyBytes"),
      presentation_bytes: summarize(samples, "presentation_bytes"),
      result_bytes: summarize(samples, "resultBytes"),
      payload_bytes: summarize(samples, "payloadBytes"),
      signed_result_bytes: summarize(samples, "signedResultBytes"),
      r2_object_bytes: summarize(samples, "r2ObjectBytes"),
      client_response_bytes: summarize(samples, "clientResponseBytes"),
    },
    phases: summarizePhases(samples),
    config_validation: summarizeConfigValidation(samples),
    config_validation_breakdown: summarizeConfigValidationBreakdown(samples),
    resource_observations: summarizeResourceObservations(samples),
    correlations: {
      direct_service_binding_round_trip_vs_control: pairedCorrelation(
        samples,
        "directServiceBindingRoundTripMilliseconds",
        "directControlServiceBindingRoundTripMilliseconds",
      ),
      transport_residual_vs_control: pairedCorrelation(
        samples,
        "transportResidualMilliseconds",
        "directControlServiceBindingRoundTripMilliseconds",
      ),
      client_visible_vs_polling_wait: pairedCorrelation(
        samples,
        "clientVisibleMilliseconds",
        "pollingWaitBetweenStatusRequestsMilliseconds",
      ),
      client_visible_vs_observation_delay: pairedCorrelation(
        samples,
        "clientVisibleMilliseconds",
        "serverToClientObservationDelayMilliseconds",
      ),
      client_visible_vs_server_processing: pairedCorrelation(
        samples,
        "clientVisibleMilliseconds",
        "serverCompletionMilliseconds",
      ),
      client_visible_vs_poll_count: pairedCorrelation(
        samples,
        "clientVisibleMilliseconds",
        "pollingStatusRequestCount",
      ),
    },
    cold_start_observation: samples.filter((sample) => sample.sample_index === 0).length,
    warm_observation_count: samples.filter((sample) => sample.sample_index > 0).length,
    result: null,
    diagnosis: diagnoseNormalLatency(samples),
    failures,
    samples: samples.map((sample) => ({
      sample_index: sample.sample_index,
      concurrency: sample.concurrency,
      verification_start_request_started_epoch_ms: sample.verificationStartRequestStartedEpochMilliseconds,
      initial_202_response_received_epoch_ms: sample.initial202ResponseReceivedEpochMilliseconds,
      client_visible_ms: sample.clientVisibleMilliseconds,
      polling_initial_response_round_trip_ms: sample.pollingInitialResponseRoundTripMilliseconds,
      polling_wait_before_first_status_request_ms: sample.pollingWaitBeforeFirstStatusRequestMilliseconds,
      polling_wait_between_status_requests_ms: sample.pollingWaitBetweenStatusRequestsMilliseconds,
      polling_status_request_round_trip_ms: sample.pollingStatusRequestRoundTripMilliseconds,
      polling_total_elapsed_ms: sample.pollingTotalElapsedMilliseconds,
      polling_status_request_count: sample.pollingStatusRequestCount,
      client_terminal_observed_epoch_ms: sample.clientTerminalObservedEpochMilliseconds,
      benchmark_server_completion_epoch_ms: sample.benchmarkServerCompletionEpochMilliseconds,
      server_completion_epoch_source: sample.benchmarkServerCompletionEpochSource,
      caller_direct_invocation_completed_epoch_ms: sample.callerDirectInvocationCompletedEpochMilliseconds,
      server_to_client_observation_delay_ms: sample.serverToClientObservationDelayMilliseconds,
      server_to_client_observation_delay_raw_ms: sample.serverToClientObservationDelayRawMilliseconds,
      server_to_client_observation_epoch_delta_invalid: sample.serverToClientObservationEpochDeltaInvalid,
      poll_events: sample.pollEvents,
      timing_complete: sample.timing_complete,
      timing_trace_id_present: sample.timing_trace_id_present,
      timing_trace_id_matches_submission: sample.timing_trace_id_matches_submission,
      timing_job_id_hashed: sample.timing_job_id_hashed,
      timing_job_id_matches_submission: sample.timing_job_id_matches_submission,
      max_verifier_concurrency: sample.maxVerifierConcurrency,
      r2_operations: sample.r2_operations,
      do_operations: sample.do_operations,
      diagnostics: sample.diagnostics,
      transport_residual_negative_count: sample.transportResidualNegativeCount,
      request_body_bytes: sample.requestBodyBytes,
      presentation_bytes: sample.presentation_bytes,
      source_response_bytes: sample.sourceResponseBytes,
      result_bytes: sample.resultBytes,
      payload_bytes: sample.payloadBytes,
      signed_result_bytes: sample.signedResultBytes,
      r2_object_bytes: sample.r2ObjectBytes,
      client_response_bytes: sample.clientResponseBytes,
      client_response_sha256: sample.clientResponseSha256,
      status_recovery_response_bytes: sample.statusRecoveryResponseBytes,
      status_recovery_response_sha256: sample.statusRecoveryResponseSha256,
      response_loss_recovery_response_bytes: sample.responseLossRecoveryResponseBytes,
      response_loss_recovery_response_sha256: sample.responseLossRecoveryResponseSha256,
      result_sha256: sample.resultSha256,
      response_bytes_match_result_hash: sample.responseBytesMatchResultHash,
      response_bytes_match_result_bytes: sample.responseBytesMatchResultBytes,
      response_bytes_match_committed_result: sample.responseBytesMatchCommittedResult,
      status_recovery_bytes_match_response: sample.statusRecoveryBytesMatchResponse,
      status_recovery_bytes_match_result_hash: sample.statusRecoveryBytesMatchResultHash,
      status_recovery_bytes_match_result_bytes: sample.statusRecoveryBytesMatchResultBytes,
      response_mode: sample.responseMode,
      status_recovery_measured: sample.statusRecoveryMeasured,
      phases_ms: {
        session_issuance: sample.sessionIssuanceMilliseconds,
        session_config: sample.sessionConfigMilliseconds,
        session_authority: sample.sessionAuthorityMilliseconds,
        session_binding: sample.sessionBindingMilliseconds,
        session_receipt: sample.sessionReceiptMilliseconds,
        request_acceptance: sample.requestAcceptanceMilliseconds,
        request_authentication: sample.requestAuthenticationMilliseconds,
        request_body_read: sample.requestBodyReadMilliseconds,
        request_body_parse: sample.requestBodyParseMilliseconds,
        request_presentation_decode: sample.requestPresentationDecodeMilliseconds,
        request_device_possession: sample.requestDevicePossessionMilliseconds,
        request_presentation_hash: sample.requestPresentationHashMilliseconds,
        request_start_verification: sample.requestStartVerificationMilliseconds,
        request_direct_dispatch: sample.requestDirectDispatchMilliseconds,
        trigger_accept_to_202_send: sample.triggerAcceptTo202SendMilliseconds,
        direct_input_binding: sample.directInputBindingMilliseconds,
        trigger_queue_start: sample.triggerQueueStartMilliseconds,
        direct_invocation_startup: sample.directInvocationStartupMilliseconds,
        direct_request_construction: sample.directRequestConstructionMilliseconds,
        direct_service_binding_fetch_wait: sample.directServiceBindingFetchWaitMilliseconds,
        direct_presentation_transfer: sample.directPresentationTransferMilliseconds,
        direct_service_binding_round_trip: sample.directServiceBindingRoundTripMilliseconds,
        direct_response_body_consumption: sample.directResponseBodyConsumptionMilliseconds,
        direct_response_decode: sample.directResponseDecodeMilliseconds,
        direct_control_request_construction: sample.directControlRequestConstructionMilliseconds,
        direct_control_service_binding_fetch_wait: sample.directControlServiceBindingFetchWaitMilliseconds,
        direct_control_service_binding_round_trip: sample.directControlServiceBindingRoundTripMilliseconds,
        direct_control_response_body_consumption: sample.directControlResponseBodyConsumptionMilliseconds,
        direct_control_response_decode: sample.directControlResponseDecodeMilliseconds,
        direct_control_client_round_trip: sample.directControlClientRoundTripMilliseconds,
        direct_callback_processing: sample.directCallbackProcessingMilliseconds,
        transport_residual: sample.transportResidualMilliseconds,
        direct_callback_entry_to_lease: sample.directCallbackEntryToLeaseMilliseconds,
        direct_callback_config_validation: sample.directCallbackConfigValidationMilliseconds,
        direct_callback_benchmark_registration: sample.directCallbackBenchmarkRegistrationMilliseconds,
        direct_acquire_verification: sample.directAcquireVerificationMilliseconds,
        acquire_verification_rpc: sample.acquireVerificationRpcMilliseconds,
        acquire_verification_transaction: sample.acquireVerificationTransactionMilliseconds,
        acquire_verification_storage_get: sample.acquireVerificationStorageGetMilliseconds,
        acquire_verification_validation: sample.acquireVerificationValidationMilliseconds,
        acquire_verification_storage_put: sample.acquireVerificationStoragePutMilliseconds,
        acquire_verification_set_alarm: sample.acquireVerificationSetAlarmMilliseconds,
        trigger_start_to_callback: sample.triggerStartToCallbackMilliseconds,
        callback_entry_to_lease: sample.callbackEntryToLeaseMilliseconds,
        worker_r2_input: sample.workerR2InputMilliseconds,
        direct_presentation_hash: sample.presentationHashMilliseconds,
        direct_wasm_verification: sample.wasmVerificationMilliseconds,
        presentation_hash: sample.presentationHashMilliseconds,
        wasm_verification: sample.wasmVerificationMilliseconds,
        result_signing: sample.resultSigningMilliseconds,
        result_canonicalization: sample.resultCanonicalizationMilliseconds,
        result_signing_detailed: sample.resultSigningDetailedMilliseconds,
        result_construction: sample.resultConstructionMilliseconds,
        result_serialization: sample.resultSerializationMilliseconds,
        result_persistence: sample.resultPersistenceMilliseconds,
        result_persistence_detailed: sample.resultPersistenceDetailedMilliseconds,
        result_persistence_preparation: sample.resultPersistencePreparationMilliseconds,
        result_persistence_post_commit: sample.resultPersistencePostCommitMilliseconds,
        status_result_read: sample.statusResultReadMilliseconds,
        status_result_hash: sample.statusResultHashMilliseconds,
        status_result_parse: sample.statusResultParseMilliseconds,
        do_commit: sample.doCommitMilliseconds,
        do_commit_detailed: sample.doCommitDetailedMilliseconds,
        callback_response: sample.callbackResponseMilliseconds,
        trigger_input_fetch: sample.triggerInputFetchMilliseconds,
        trigger_verifier: sample.triggerVerifierMilliseconds,
        trigger_verifier_initialization: sample.triggerVerifierInitializationMilliseconds,
        trigger_to_callback_request: sample.triggerToCallbackRequestMilliseconds,
        queue_verifier: sample.queueVerifierMilliseconds,
        queue_callback_dispatch: sample.queueCallbackDispatchMilliseconds,
        queue_send: sample.queueSendMilliseconds,
        queue_batch_to_handler: sample.queueBatchToHandlerMilliseconds,
          queue_callback_authentication: sample.queueCallbackAuthenticationMilliseconds,
          queue_callback_schema: sample.queueCallbackSchemaMilliseconds,
          queue_binding_lookup_and_lease: sample.queueBindingLookupAndLeaseMilliseconds,
          queue_presentation_read: sample.queuePresentationReadMilliseconds,
          queue_presentation_hash: sample.queuePresentationHashMilliseconds,
          queue_wasm_verification_detailed: sample.queueWasmVerificationDetailedMilliseconds,
          queue_result_signing_detailed: sample.queueResultSigningDetailedMilliseconds,
          queue_result_persistence_detailed: sample.queueResultPersistenceDetailedMilliseconds,
          queue_consume_detailed: sample.queueConsumeDetailedMilliseconds,
          queue_completion_response: sample.queueCompletionResponseMilliseconds,
          server_completion: sample.serverCompletionMilliseconds,
          client_observation: sample.clientObservationMilliseconds,
        status_polling: sample.statusPollingMilliseconds,
        direct_synchronous_response: sample.synchronousResponseMilliseconds,
        synchronous_response: sample.synchronousResponseMilliseconds,
        poll_count: sample.pollCount,
      },
      server_timestamps: sample.server_timestamps,
      server_durations: sample.server_durations,
      queue_message_diagnostics: sample.queue_message_diagnostics,
    })),
  };
  row.result = rowDecision(row);
  return row;
}

function reportDecision(rows) {
  if (rows.length === 0 || rows.some((row) => row.result === "NOT ESTABLISHED")) return "NOT ESTABLISHED";
  return rows.some((row) => row.result === "EXCEEDS TARGET") ? "EXCEEDS TARGET" : "MEASURED WITHIN TARGET";
}

async function main() {
  const sampleCount = parseInteger("TLSN_REMOTE_SAMPLE_COUNT", DEFAULT_SAMPLE_COUNT, 1, 1_000);
  const pollIntervalMs = parseInteger("TLSN_REMOTE_POLL_INTERVAL_MS", DEFAULT_POLL_INTERVAL_MS, 25, 5_000);
  const maxPollMs = parseInteger("TLSN_REMOTE_MAX_POLL_MS", DEFAULT_MAX_POLL_MS, 1_000, 300_000);
  const executionMode = optional("TLSN_REMOTE_EXECUTION_MODE") ?? "trigger";
  if (!Object.hasOwn(REQUIRED_TIMING_STAGES_BY_MODE, executionMode)) {
    throw new Error("TLSN_REMOTE_EXECUTION_MODE must be trigger, queue, or direct");
  }
  const synchronousCandidate = executionMode === "direct"
    && optional("TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE") === "true";
  const responseLossRecoveryRequested = optional("TLSN_REMOTE_DIRECT_RESPONSE_LOSS_RECOVERY") === "true";
  if (responseLossRecoveryRequested && !synchronousCandidate) {
    throw new Error("TLSN_REMOTE_DIRECT_RESPONSE_LOSS_RECOVERY requires TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE=true");
  }
  const responseLossRecovery = responseLossRecoveryRequested;
  const expectedEnvironment = optional("TLSN_REMOTE_EXPECTED_ENVIRONMENT") ?? "test";
  if (!ALLOWED_EXPECTED_ENVIRONMENTS.has(expectedEnvironment)) {
    throw new Error("TLSN_REMOTE_EXPECTED_ENVIRONMENT must be test, evidence, or production");
  }
  if (expectedEnvironment === "evidence" && executionMode !== "direct") {
    throw new Error("evidence benchmark requires TLSN_REMOTE_EXECUTION_MODE=direct");
  }
  if (synchronousCandidate && expectedEnvironment === "production") {
    if (optional("TLSN_REMOTE_PRODUCTION_SYNC_CANARY") !== "true") {
      throw new Error("production synchronous benchmark requires TLSN_REMOTE_PRODUCTION_SYNC_CANARY=true");
    }
    if (manifest.deployment_role !== "canary") {
      throw new Error("production synchronous benchmark requires the canary deployment role");
    }
  }
  const cases = parseList("TLSN_REMOTE_CASES", DEFAULT_CASES, (value) => value || undefined);
  const concurrencyValues = parseList("TLSN_REMOTE_CONCURRENCY", DEFAULT_CONCURRENCY, (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 && number <= 32 ? number : undefined;
  });
  if (cases.length === 0 || concurrencyValues.length === 0) throw new Error("remote benchmark case and concurrency lists must not be empty");

  const authMode = optional("TLSN_REMOTE_AUTH_MODE") ?? "supabase";
  if (authMode !== "test" && authMode !== "supabase") throw new Error("TLSN_REMOTE_AUTH_MODE must be test or supabase");
  const { manifest, entries } = readRealFixtureManifest();
  const workerOrigin = assertReadinessOrigin(
    "TLSN_REMOTE_BENCHMARK_WORKER_URL",
    requireOrigin("TLSN_REMOTE_BENCHMARK_WORKER_URL"),
  );
  const webOrigin = authMode === "supabase"
    ? assertReadinessOrigin("TLSN_REMOTE_WEB_ORIGIN", requireOrigin("TLSN_REMOTE_WEB_ORIGIN"))
    : undefined;
  const supabaseOrigin = authMode === "supabase"
    ? assertReadinessOrigin("TLSN_REMOTE_SUPABASE_URL", requireOrigin("TLSN_REMOTE_SUPABASE_URL"))
    : undefined;
  const accessToken = required("TLSN_REMOTE_ACCESS_TOKEN_A");
  const device = { id: required("TLSN_REMOTE_DEVICE_ID_A") };
  const privateKey = await loadPrivateKey("TLSN_REMOTE_DEVICE_A");
  const publishableKey = authMode === "supabase" ? required("TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY") : undefined;
  const missingCases = cases.filter((caseLabel) => !entries.has(caseLabel));
  if (missingCases.length > 0) throw new Error(`unknown real fixture cases: ${missingCases.join(", ")}`);

  const health = await loadHealth(workerOrigin);
  const user = authMode === "test"
    ? (() => {
      let users;
      try {
        users = JSON.parse(required("TLSN_TEST_AUTH_USERS"));
      } catch {
        throw new Error("TLSN_TEST_AUTH_USERS must be a valid JSON object");
      }
      const testUser = users[accessToken];
      if (!testUser || typeof testUser.id !== "string" || testUser.is_anonymous === true) {
        throw new Error("remote test token is not configured as a non-anonymous test user");
      }
      return { id: testUser.id };
    })()
    : await loadAuthenticatedUser(supabaseOrigin, publishableKey, accessToken);
  const rows = [];
  for (const concurrency of concurrencyValues) {
    for (const caseLabel of cases) {
      const row = await runBatch({
        workerOrigin,
        webOrigin,
        accessToken,
        userId: user.id,
        device,
        privateKey,
        manifest,
        entry: entries.get(caseLabel),
        concurrency,
        sampleCount,
        pollIntervalMs,
        maxPollMs,
        executionMode,
        synchronousCandidate,
        responseLossRecovery,
      });
      rows.push(row);
      console.log(JSON.stringify({
        case: row.case_label,
        concurrency: row.concurrency,
        samples: row.successful_samples,
        client_visible: row.phases.client_visible,
        server_completion: row.phases.server_completion,
        client_observation: row.phases.client_observation,
        trigger_queue_start: row.phases.trigger_queue_start,
        direct_invocation_startup: row.phases.direct_invocation_startup,
        queue_verifier: row.phases.queue_verifier,
        result_serialization: row.phases.result_serialization,
        result_persistence: row.phases.result_persistence,
        do_commit: row.phases.do_commit,
        synchronous_response: row.phases.synchronous_response,
        presentation_hash: row.phases.presentation_hash,
        result: row.result,
      }));
    }
  }

  const result = reportDecision(rows);
  const failureArtifactPath = optional("TLSN_REMOTE_BENCHMARK_FAILURE_REPORT_PATH")
    ?? resolve(packageDirectory, "artifacts/tlsn-remote-benchmark-failures.json");
  const failures = rows.flatMap((row) => row.failures);
  const report = {
    schema_version: 8,
    benchmark: "tlsn-worker-remote-e2e",
    architecture_variant: optional("TLSN_REMOTE_BENCHMARK_VARIANT") ?? "current",
    generated_at: new Date().toISOString(),
    worker_origin: workerOrigin,
    worker_health: {
      environment: health.environment,
      deployment_role: health.deployment_role,
      deployment_id: health.deployment_id,
      binding_mode: health.binding_mode,
      git_commit_sha: health.git_commit_sha,
      sparse_profile_sha256: health.sparse_profile_sha256,
    },
    fixture_corpus: {
      manifest: "packages/FUSOU-TLSN-VERIFICATION-WORKER/.cache/sparse-crypto-real-fixtures/manifest.json",
      cases,
      source_path: repositoryRelativePath(manifest.source.path),
      request_transcript_status: "NOT_ESTABLISHED",
    },
    phase_semantics: {
      unit: "milliseconds",
      aggregation_rule: "Do not sum inclusive phases with their nested phases or with the end-to-end client-visible phase.",
      optimization_comparison: {
        excluded_phases: ["request_direct_dispatch"],
        primary_direct_phases: [
          "direct_request_construction",
          "direct_service_binding_fetch_wait",
          "direct_service_binding_round_trip",
          "direct_response_body_consumption",
          "direct_response_decode",
          "direct_callback_processing",
          "transport_residual",
          "direct_control_service_binding_round_trip",
          "direct_control_response_body_consumption",
          "direct_control_response_decode",
          "direct_callback_entry_to_lease",
          "direct_callback_config_validation",
          "direct_callback_benchmark_registration",
          "direct_acquire_verification",
          "acquire_verification_rpc",
          "acquire_verification_transaction",
          "acquire_verification_storage_get",
          "acquire_verification_validation",
          "acquire_verification_storage_put",
          "acquire_verification_set_alarm",
          "direct_presentation_transfer",
          "direct_presentation_hash",
          "direct_wasm_verification",
          "result_signing",
          "result_persistence",
          "direct_synchronous_response",
          "client_visible",
        ],
        rationale: "request_direct_dispatch has a baseline/current flush-boundary mismatch and must not be used for historical regression or improvement claims.",
      },
      intervals: {
        request_direct_dispatch: {
          relation: "inclusive",
          includes: ["direct_service_binding_round_trip", "direct_callback_processing", "direct_response_body_consumption", "direct_response_decode"],
          comparison: "NOT_COMPARABLE_TO_218E5EC_BASELINE",
          meaning: "Current Request Worker elapsed time from Direct dispatch start until the verifier response is received; excludes the final request-side benchmark flush.",
        },
        direct_service_binding_round_trip: {
          relation: "inclusive",
          includes: ["direct_callback_processing"],
          meaning: "Elapsed time from immediately before Request Worker verifier.fetch(new Request(...)) through the returned Response object; includes Service Binding transport and verifier callback processing, but excludes response body consumption and decode.",
        },
        direct_request_construction: {
          relation: "caller_phase",
          within: "request_direct_dispatch",
          meaning: "Request Worker construction of the Direct verifier Request, measured immediately before new Request(...) through construction completion.",
        },
        direct_service_binding_fetch_wait: {
          relation: "caller_phase",
          within: "direct_service_binding_round_trip",
          meaning: "Request Worker elapsed time awaiting verifier.fetch(...) after the Request object has been constructed; it is a caller-side boundary and is not a cross-Worker pure transport clock.",
        },
        direct_response_body_consumption: {
          relation: "caller_phase",
          after: "direct_service_binding_round_trip",
          meaning: "Benchmark-only consumption of a clone of the returned Response body; the production Response body remains untouched.",
        },
        direct_response_decode: {
          relation: "caller_phase",
          after: "direct_response_body_consumption",
          meaning: "Benchmark-only UTF-8 decode of the consumed Response body bytes.",
        },
        direct_callback_processing: {
          relation: "inclusive",
          includes: ["direct_callback_entry_to_lease", "direct_callback_config_validation", "direct_callback_benchmark_registration", "direct_acquire_verification", "direct_presentation_transfer", "direct_presentation_hash", "direct_wasm_verification", "result_signing", "result_persistence"],
          meaning: "Direct verifier handler entry through creation of its completion response; excludes client/network delivery after fetch returns.",
        },
        transport_residual: {
          relation: "derived_non_negative",
          within: "direct_service_binding_round_trip",
          raw_inputs: ["direct_service_binding_round_trip", "direct_callback_processing"],
          formula: "max(0, direct_service_binding_round_trip - direct_callback_processing)",
          meaning: "Service Binding, inter-Worker, response delivery, scheduling, and measurement-boundary residual; not pure network latency.",
          negative_raw_diagnostic: "transport_residual_negative_count",
        },
        direct_callback_entry_to_lease: {
          relation: "inclusive",
          includes: ["direct_callback_config_validation", "direct_callback_benchmark_registration", "direct_acquire_verification"],
          meaning: "Direct callback entry through completion of the authoritative acquireVerification call; includes callback setup and benchmark registration, excludes presentation processing and benchmark flush.",
        },
        direct_callback_config_validation: {
          relation: "source_metric",
          source: "config_validation_callback",
          meaning: "Existing callback readConfig validation duration; no duplicate config validation is performed.",
        },
        direct_callback_benchmark_registration: {
          relation: "nested",
          within: "direct_callback_entry_to_lease",
          meaning: "Only the benchmarkRegisterFromCallback call; recorded only when benchmark instrumentation is enabled.",
        },
        direct_acquire_verification: {
          relation: "nested",
          within: "direct_callback_entry_to_lease",
          meaning: "From immediately before benchmarkDOOperation and authority.acquireVerification through Promise completion; excludes config, registration, presentation processing, result processing, and benchmark flush.",
        },
        acquire_verification_rpc: {
          relation: "inclusive",
          within: "direct_acquire_verification",
          includes: ["acquire_verification_transaction", "acquire_verification_set_alarm"],
          meaning: "Durable Object /acquire request from before JSON parsing until the response is ready; benchmark-only response-header telemetry.",
        },
        acquire_verification_transaction: {
          relation: "inclusive",
          within: "acquire_verification_rpc",
          includes: ["acquire_verification_storage_get", "acquire_verification_validation", "acquire_verification_storage_put"],
          meaning: "The authoritative storage transaction from transaction start through transaction completion.",
        },
        acquire_verification_storage_get: {
          relation: "nested",
          within: "acquire_verification_transaction",
          meaning: "Only the binding record transaction.get operation.",
        },
        acquire_verification_validation: {
          relation: "nested",
          within: "acquire_verification_transaction",
          meaning: "Successful acquire validation from binding read completion until immediately before transaction.put; validation order and authority checks are unchanged.",
        },
        acquire_verification_storage_put: {
          relation: "nested",
          within: "acquire_verification_transaction",
          meaning: "Only the successful binding record transaction.put operation.",
        },
        acquire_verification_set_alarm: {
          relation: "nested",
          within: "acquire_verification_rpc",
          excludes: ["acquire_verification_transaction"],
          meaning: "Only the post-transaction storage.setAlarm operation; alarm placement is unchanged.",
        },
        result_persistence: {
          relation: "inclusive",
          includes: ["result_persistence_preparation", "do_commit_verified_result", "result_persistence_post_commit"],
          meaning: "Result persistence preparation, authoritative DO commit, and post-commit bookkeeping/archive scheduling.",
        },
        do_commit_verified_result: {
          relation: "nested",
          within: "result_persistence",
          meaning: "Only the benchmarkDOOperation marker plus authority.commitVerifiedResult call interval; excludes commit input construction and injected pre-commit delay.",
        },
        direct_synchronous_response: {
          relation: "terminal_server_phase",
          meaning: "Server-side response preparation from the synchronous response marker until the handler returns; excludes client/network delivery.",
        },
        direct_control_service_binding_round_trip: {
          relation: "control_metric",
          meaning: "Same Request Worker Service Binding invocation boundary as the actual Direct path, targeting a verifier endpoint that reads the request body, validates the benchmark HMAC envelope, and returns a fixed JSON response without DO, R2, authority, or TLSN verification work.",
        },
        direct_control_response_body_consumption: {
          relation: "control_metric",
          after: "direct_control_service_binding_round_trip",
          meaning: "Control caller consumption of the fixed JSON response body.",
        },
        direct_control_response_decode: {
          relation: "control_metric",
          after: "direct_control_response_body_consumption",
          meaning: "Control caller UTF-8 decode of the fixed JSON response body bytes.",
        },
      },
    },
    configuration: {
      requested_samples_per_case_and_concurrency: sampleCount,
      concurrency: concurrencyValues,
      poll_interval_ms: pollIntervalMs,
      max_poll_ms: maxPollMs,
      target_ms: RESULT_TARGET_MS,
      target_basis: "existing benchmark regression target; not a production SLO",
      formal_slo_decision: "NOT_ESTABLISHED",
      execution_mode: executionMode,
      session_auth_mode: authMode,
      response_mode: responseLossRecovery
        ? "direct_synchronous_response_loss_recovery"
        : synchronousCandidate
          ? "direct_synchronous_candidate"
          : "queued_202_status_poll",
      status_recovery_measurement: responseLossRecovery ? "NOT_USED" : "MEASURED",
      response_loss_recovery_measurement: responseLossRecovery ? "MEASURED" : "NOT_REQUESTED",
      expected_environment: expectedEnvironment,
      payload_scaling_status: "MEASURED_ONLY_FOR_AVAILABLE_REAL_FIXTURES",
    },
    boundaries: {
      worker_r2_do: "MEASURED BY OPT-IN WORKER TELEMETRY",
      trigger_task_start: executionMode === "trigger"
        ? "MEASURED AT FIRST TRIGGER TASK CODE USING TRIGGER CLOCK"
        : "NOT APPLICABLE",
      direct_service_binding_start: executionMode === "direct"
        ? "MEASURED AS caller request construction, fetch wait, Response-object round trip, clone body consumption/decode, and verifier callback processing; the separate control path removes callback verification and persistence work"
        : "NOT APPLICABLE",
      trigger_platform_scheduler_timestamp: "NOT_ESTABLISHED",
      production_worker_isolate_rss: "NOT_ESTABLISHED",
      evidence_environment: expectedEnvironment === "evidence"
        ? "MEASURED BY DEDICATED NON-PRODUCTION WORKER, DO, R2, AND DIRECT VERIFIER"
        : "NOT APPLICABLE",
      cold_start_boundary: "first benchmark sample after the health probe; isolate coldness is not independently observable",
      cold_start_decision: "OBSERVED_PROXY_ONLY",
      client_visible_clock: "MEASURED BY BENCHMARK PROCESS",
      trigger_queue_start_clock_note: executionMode === "trigger"
        ? "T2 and T3 are wall-clock timestamps from Worker and Trigger environments; clock skew is not corrected"
        : executionMode === "queue"
          ? "Queue T2 and T3 are wall-clock timestamps from the same Worker environment"
          : "Direct T2 and T3 are wall-clock timestamps from Request and verifier Workers; clock skew is not corrected",
      queue_message_timestamp_note: executionMode === "queue"
        ? "queue_consumer_scheduled is Message.timestamp, the Queue message creation timestamp; Cloudflare does not expose a consumer scheduling timestamp, so this value is not used as a cross-runtime delivery duration"
        : "NOT APPLICABLE",
      fixture_generation: "EXCLUDED FROM T0-T11; generated from existing real corpus with each issued binding",
    },
    target_decision: result,
    formal_slo_decision: "NOT_ESTABLISHED",
    diagnosis: {
      normal_verified_samples_only: true,
      classifications: rows.map((row) => ({
        case_label: row.case_label,
        concurrency: row.concurrency,
        classification: row.diagnosis.classification,
      })),
      failure_population: {
        count: failures.length,
        artifact: repositoryRelativePath(failureArtifactPath),
      },
      prohibited_conclusion: "Service Binding transport-dominated",
    },
    payload_scaling: payloadScalingReport(rows),
    results: rows,
  };
  const reportPath = optional("TLSN_REMOTE_BENCHMARK_REPORT_PATH")
    ?? resolve(packageDirectory, "artifacts/tlsn-remote-benchmark.json");
  const pollingAnalysisPath = optional("TLSN_REMOTE_POLLING_ANALYSIS_REPORT_PATH")
    ?? resolve(packageDirectory, "artifacts/tlsn-direct-polling-analysis-c1-c2-c4-c8.json");
  const pollingAnalysis = buildPollingAnalysis({
    rows,
    failures,
    workerOrigin,
    health,
    cases,
    concurrencyValues,
    sampleCount,
    pollIntervalMs,
    maxPollMs,
    executionMode,
    authMode,
    expectedEnvironment,
    reportPath,
  });
  for (const row of rows) {
    for (const sample of row.samples) delete sample.poll_events;
  }
  await mkdir(dirname(reportPath), { recursive: true });
  await mkdir(dirname(failureArtifactPath), { recursive: true });
  await mkdir(dirname(pollingAnalysisPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(pollingAnalysisPath, `${JSON.stringify(pollingAnalysis, null, 2)}\n`, "utf8");
  await writeFile(failureArtifactPath, `${JSON.stringify({
    schema_version: 2,
    benchmark: "tlsn-worker-remote-e2e-failures",
    generated_at: new Date().toISOString(),
    worker_origin: workerOrigin,
    configuration: {
      execution_mode: executionMode,
      poll_interval_ms: pollIntervalMs,
      max_poll_ms: maxPollMs,
    },
    failures,
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    report_path: reportPath,
    polling_analysis_path: pollingAnalysisPath,
    target_decision: result,
  }));
  if (result === "EXCEEDS TARGET") process.exitCode = 1;
  if (result === "NOT ESTABLISHED") process.exitCode = 2;
}

export {
  derivePollingSample,
  diagnosePollingSchedule,
  issueSession,
  loadHealth,
  pollStatus,
  submitVerification,
  synchronousCompletion,
  verificationBody,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[tlsn-remote-benchmark] ${error instanceof Error ? error.message : "measurement_failed"}`);
    process.exitCode = 2;
  });
}
