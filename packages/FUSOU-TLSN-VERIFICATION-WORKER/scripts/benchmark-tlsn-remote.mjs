#!/usr/bin/env node

import { createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  fixtureSourcePath,
  generateRealFixture,
  packageDirectory,
  readRealFixtureManifest,
} from "./tlsn-benchmark-fixtures.mjs";

const DEFAULT_SAMPLE_COUNT = 20;
const DEFAULT_CASES = "p50,p95,p99,max";
const DEFAULT_CONCURRENCY = "1,2,4,8";
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_POLL_MS = 300_000;
const RESULT_TARGET_MS = 3_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMON_REQUIRED_TIMING_STAGES = [
  "t0_accepted",
  "t1_202_response_sent",
  "t4_callback_accepted",
  "t5_lease_acquired",
  "t6_presentation_read",
  "t7_wasm_verification_completed",
  "t8_result_signing_completed",
  "t8_result_persisted",
  "t9_result_persisted",
  "t9_consume_completed",
  "t10_consume_completed",
  "t11_status_verified",
  "t10_callback_response_ready",
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
    "queue_binding_lookup_started",
    "queue_binding_lookup_completed",
    "queue_lease_acquire_started",
    "queue_lease_acquire_completed",
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
};

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
  const response = await fetch(url, { redirect: "error", ...options });
  const body = await response.text();
  const elapsedMilliseconds = performance.now() - startedAt;
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  return { response, status: response.status, json, elapsedMilliseconds };
}

async function loadHealth(workerOrigin) {
  const result = await timedJsonRequest(endpoint(workerOrigin, "/health"));
  if (result.status !== 200 || result.json?.ok !== true) {
    throw new Error(`remote Worker health failed with status ${result.status}`);
  }
  if (!['test', 'production'].includes(result.json.environment)) {
    throw new Error("remote Worker environment is not test or production");
  }
  if (result.json.binding_mode !== "random") {
    throw new Error("remote benchmark requires a random-binding Worker; fixed canary bindings are one-shot");
  }
  if (typeof result.json.sparse_profile_sha256 !== "string") {
    throw new Error("remote Worker does not expose the sparse profile");
  }
  const authMode = optional("TLSN_REMOTE_AUTH_MODE") ?? "supabase";
  if (authMode === "test" && (result.json.auth_mode !== "test-token" || result.json.device_auth_mode !== "test-ed25519")) {
    throw new Error("remote Worker is not configured for self-contained test auth");
  }
  return result.json;
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
  return result.json;
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

async function submitVerification(workerOrigin, accessToken, body) {
  const clientT0 = performance.now();
  const result = await timedJsonRequest(endpoint(workerOrigin, "/verify/tlsn/sparse"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body,
  });
  const clientT1 = performance.now();
  if (result.status !== 202 || typeof result.json?.job_id !== "string") {
    throw new Error(`remote verification was not queued: status ${result.status}, body ${JSON.stringify(result.json ?? null)}`);
  }
  return {
    jobId: result.json.job_id,
    benchmarkTraceId: typeof result.json.benchmark_trace_id === "string" ? result.json.benchmark_trace_id : null,
    clientT0,
    clientT1,
    requestAcceptanceMilliseconds: clientT1 - clientT0,
  };
}

async function pollStatus(workerOrigin, accessToken, userId, device, session, jobId, benchmarkTraceId, pollIntervalMs, maxPollMs, executionMode) {
  const pollStartedAt = performance.now();
  const deadline = pollStartedAt + maxPollMs;
  let pollCount = 0;
  let firstVerifiedResponse;
  while (performance.now() < deadline) {
    const result = await timedJsonRequest(endpoint(workerOrigin, "/verify/tlsn/status"), {
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
    pollCount += 1;
    if (result.status === 200 && result.json?.verified === true) {
      const clientT11 = performance.now();
      const timing = parseTimingHeader(result.response);
      if (!firstVerifiedResponse) {
        firstVerifiedResponse = {
          clientT11,
          statusPollingMilliseconds: clientT11 - pollStartedAt,
          timing,
        };
      }
      if (requiredTimingStagesPresent(timing, executionMode)) {
        return {
          ...firstVerifiedResponse,
          timing,
          pollCount,
        };
      }
    } else if (result.status !== 202) {
      throw new Error(`remote status polling failed with status ${result.status}`);
    }
    if (firstVerifiedResponse && performance.now() >= deadline) {
      return { ...firstVerifiedResponse, pollCount };
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, pollIntervalMs));
  }
  if (firstVerifiedResponse) return { ...firstVerifiedResponse, pollCount };
  throw new Error("remote status polling exceeded configured maximum");
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

function requiredTimingStagesPresent(timing, executionMode) {
  return REQUIRED_TIMING_STAGES_BY_MODE[executionMode].every((stage) => stageTimestamp(timing, stage) !== null);
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

function summarizePhases(samples) {
  return {
    request_acceptance: summarize(samples, "requestAcceptanceMilliseconds"),
    trigger_accept_to_202_send: summarize(samples, "triggerAcceptTo202SendMilliseconds"),
    trigger_queue_start: summarize(samples, "triggerQueueStartMilliseconds"),
    trigger_start_to_callback: summarize(samples, "triggerStartToCallbackMilliseconds"),
    callback_entry_to_lease: summarize(samples, "callbackEntryToLeaseMilliseconds"),
    worker_r2_input: summarize(samples, "workerR2InputMilliseconds"),
    wasm_verification: summarize(samples, "wasmVerificationMilliseconds"),
    result_signing: summarize(samples, "resultSigningMilliseconds"),
    result_persistence: summarize(samples, "resultPersistenceMilliseconds"),
    do_consume: summarize(samples, "doConsumeMilliseconds"),
    callback_response: summarize(samples, "callbackResponseMilliseconds"),
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
    queue_binding_lookup: summarize(samples, "queueBindingLookupMilliseconds"),
    queue_lease_acquire: summarize(samples, "queueLeaseAcquireMilliseconds"),
    queue_presentation_read: summarize(samples, "queuePresentationReadMilliseconds"),
    queue_presentation_hash: summarize(samples, "queuePresentationHashMilliseconds"),
    queue_wasm_verification_detailed: summarize(samples, "queueWasmVerificationDetailedMilliseconds"),
    queue_result_signing_detailed: summarize(samples, "queueResultSigningDetailedMilliseconds"),
    queue_result_persistence_detailed: summarize(samples, "queueResultPersistenceDetailedMilliseconds"),
    queue_consume_detailed: summarize(samples, "queueConsumeDetailedMilliseconds"),
    queue_completion_response: summarize(samples, "queueCompletionResponseMilliseconds"),
    status_polling: summarize(samples, "statusPollingMilliseconds"),
    client_visible: summarize(samples, "clientVisibleMilliseconds"),
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

async function runBatch({ workerOrigin, webOrigin, accessToken, userId, device, privateKey, manifest, entry, concurrency, sampleCount, pollIntervalMs, maxPollMs, executionMode }) {
  const sourcePath = fixtureSourcePath(manifest, entry);
  const samples = [];
  let preparationMilliseconds = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const sessions = [];
    for (let index = 0; index < concurrency; index += 1) {
      sessions.push(await issueSession(workerOrigin, webOrigin, accessToken, device, privateKey, optional("TLSN_REMOTE_AUTH_MODE") ?? "supabase"));
    }
    const fixtures = [];
    const preparationStartedAt = performance.now();
    for (const session of sessions) {
      const fixture = generateRealFixture(sourcePath, session.binding);
      fixture.source_fixture_body_bytes = entry.sourceFixtureBodyBytes;
      fixtures.push(fixture);
    }
    preparationMilliseconds += performance.now() - preparationStartedAt;

    const submissions = await Promise.all(sessions.map((session, index) => (
      submitVerification(workerOrigin, accessToken, verificationBody(session, device, privateKey, fixtures[index]))
    )));
    const completions = await Promise.all(submissions.map((submission, index) => (
      pollStatus(
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
      )
    )));
    for (let index = 0; index < concurrency; index += 1) {
      const submission = submissions[index];
      const completion = completions[index];
      const timing = completion.timing;
      const timestamps = timing?.timestamps ?? {};
      const durations = timing?.durations ?? {};
      const diagnostics = timing?.diagnostics ?? {};
      const t1Server = stageTimestamp(timing, "t1_202_response_sent");
      const t2 = stageTimestamp(timing, executionMode === "queue" ? "t2_queue_message_accepted" : "t2_trigger_task_accepted");
      const t3 = stageTimestamp(timing, executionMode === "queue" ? "t3_queue_execution_started" : "t3_trigger_execution_started");
      const t4 = stageTimestamp(timing, "t4_callback_accepted");
      const t5 = stageTimestamp(timing, "t5_lease_acquired");
      const t6 = stageTimestamp(timing, "t6_presentation_read");
      const t7 = stageTimestamp(timing, "t7_wasm_verification_completed");
      const t8Signing = stageTimestamp(timing, "t8_result_signing_completed");
      const t8Persisted = stageTimestamp(timing, "t8_result_persisted");
      const t9 = stageTimestamp(timing, "t9_consume_completed");
      const t10 = stageTimestamp(timing, "t10_consume_completed");
      const t10CallbackResponse = stageTimestamp(timing, "t10_callback_response_ready");
      const observed = requiredTimingStagesPresent(timing, executionMode);
      const queueVerifierStarted = stageTimestamp(timing, "t3_queue_verifier_started");
      const queueVerifierCompleted = stageTimestamp(timing, "t3_queue_verifier_completed");
      const queueCallbackDispatchStarted = stageTimestamp(timing, "t3_queue_callback_dispatch_started");
      const queueCallbackResponseReceived = stageTimestamp(timing, "t3_queue_callback_response_received");
      const triggerVerifierInitializationStarted = stageTimestamp(timing, "t3_trigger_verifier_initialization_started");
      const triggerVerifierInitializationCompleted = stageTimestamp(timing, "t3_trigger_verifier_initialization_completed");
      samples.push({
        case_label: entry.caseLabel,
        body_bytes: entry.sourceFixtureBodyBytes,
        presentation_bytes: Buffer.from(fixtures[index].sparse_presentation_base64, "base64url").length,
        concurrency,
        sample_index: sampleIndex,
        requestAcceptanceMilliseconds: submission.requestAcceptanceMilliseconds,
        statusPollingMilliseconds: completion.statusPollingMilliseconds,
        pollCount: completion.pollCount,
        clientVisibleMilliseconds: completion.clientT11 - submission.clientT0,
        triggerAcceptTo202SendMilliseconds: t1Server !== null && t2 !== null ? t1Server - t2 : null,
        triggerQueueStartMilliseconds: t2 !== null && t3 !== null ? t3 - t2 : null,
        triggerStartToCallbackMilliseconds: t3 !== null && t4 !== null ? t4 - t3 : null,
        callbackEntryToLeaseMilliseconds: t4 !== null && t5 !== null ? t5 - t4 : null,
        workerR2InputMilliseconds: phaseMilliseconds(timing, "t5_lease_acquired", "t6_presentation_read"),
        wasmVerificationMilliseconds: phaseMilliseconds(timing, "t6_presentation_read", "t7_wasm_verification_completed"),
        resultSigningMilliseconds: t8Signing !== null ? t8Signing - t7 : null,
        resultPersistenceMilliseconds: t8Signing !== null && t8Persisted !== null ? t8Persisted - t8Signing : null,
        doConsumeMilliseconds: t8Persisted !== null && t10 !== null ? t10 - t8Persisted : null,
        callbackResponseMilliseconds: t10 !== null && t10CallbackResponse !== null ? t10CallbackResponse - t10 : null,
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
        queueBindingLookupMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_binding_lookup", "queue_binding_lookup_started", "queue_binding_lookup_completed"),
        queueLeaseAcquireMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_lease_acquire", "queue_lease_acquire_started", "queue_lease_acquire_completed"),
        queuePresentationReadMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_presentation_read", "queue_presentation_read_started", "queue_presentation_read_completed"),
        queuePresentationHashMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_presentation_hash", "queue_presentation_read_completed", "queue_presentation_hash_completed"),
        queueWasmVerificationDetailedMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_wasm_verification", "queue_wasm_verification_started", "queue_wasm_verification_completed"),
        queueResultSigningDetailedMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_result_signing", "queue_result_signing_started", "queue_result_signing_completed"),
        queueResultPersistenceDetailedMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_result_persistence", "queue_result_persistence_started", "queue_result_persistence_completed"),
        queueConsumeDetailedMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_consume", "queue_consume_started", "queue_consume_completed"),
        queueCompletionResponseMilliseconds: measuredPhaseMilliseconds(timing, durations, "queue_completion_response", "queue_consume_completed", "queue_completion_response_ready"),
        resultFinalizationMilliseconds: phaseMilliseconds(timing, "t7_wasm_verification_completed", "t10_consume_completed"),
        timing_complete: observed,
        timing_trace_id_present: typeof timing?.trace_id === "string",
        timing_trace_id_matches_submission: typeof timing?.trace_id === "string" && timing.trace_id === submission.benchmarkTraceId,
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
    timing_complete_samples: samples.filter((sample) => sample.timing_complete).length,
    preparation_milliseconds_excluded: preparationMilliseconds,
    phases: summarizePhases(samples),
    result: null,
    samples: samples.map((sample) => ({
      sample_index: sample.sample_index,
      concurrency: sample.concurrency,
      client_visible_ms: sample.clientVisibleMilliseconds,
      timing_complete: sample.timing_complete,
      timing_trace_id_present: sample.timing_trace_id_present,
      timing_trace_id_matches_submission: sample.timing_trace_id_matches_submission,
      presentation_bytes: sample.presentation_bytes,
      phases_ms: {
        request_acceptance: sample.requestAcceptanceMilliseconds,
        trigger_accept_to_202_send: sample.triggerAcceptTo202SendMilliseconds,
        trigger_queue_start: sample.triggerQueueStartMilliseconds,
        trigger_start_to_callback: sample.triggerStartToCallbackMilliseconds,
        callback_entry_to_lease: sample.callbackEntryToLeaseMilliseconds,
        worker_r2_input: sample.workerR2InputMilliseconds,
        wasm_verification: sample.wasmVerificationMilliseconds,
        result_signing: sample.resultSigningMilliseconds,
        result_persistence: sample.resultPersistenceMilliseconds,
        do_consume: sample.doConsumeMilliseconds,
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
          queue_binding_lookup: sample.queueBindingLookupMilliseconds,
          queue_lease_acquire: sample.queueLeaseAcquireMilliseconds,
          queue_presentation_read: sample.queuePresentationReadMilliseconds,
          queue_presentation_hash: sample.queuePresentationHashMilliseconds,
          queue_wasm_verification_detailed: sample.queueWasmVerificationDetailedMilliseconds,
          queue_result_signing_detailed: sample.queueResultSigningDetailedMilliseconds,
          queue_result_persistence_detailed: sample.queueResultPersistenceDetailedMilliseconds,
          queue_consume_detailed: sample.queueConsumeDetailedMilliseconds,
          queue_completion_response: sample.queueCompletionResponseMilliseconds,
        status_polling: sample.statusPollingMilliseconds,
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
    throw new Error("TLSN_REMOTE_EXECUTION_MODE must be trigger or queue");
  }
  const cases = parseList("TLSN_REMOTE_CASES", DEFAULT_CASES, (value) => value || undefined);
  const concurrencyValues = parseList("TLSN_REMOTE_CONCURRENCY", DEFAULT_CONCURRENCY, (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 && number <= 32 ? number : undefined;
  });
  if (cases.length === 0 || concurrencyValues.length === 0) throw new Error("remote benchmark case and concurrency lists must not be empty");

  const authMode = optional("TLSN_REMOTE_AUTH_MODE") ?? "supabase";
  if (authMode !== "test" && authMode !== "supabase") throw new Error("TLSN_REMOTE_AUTH_MODE must be test or supabase");
  const workerOrigin = requireOrigin("TLSN_REMOTE_BENCHMARK_WORKER_URL");
  const webOrigin = authMode === "supabase" ? requireOrigin("TLSN_REMOTE_WEB_ORIGIN") : undefined;
  const supabaseOrigin = authMode === "supabase" ? requireOrigin("TLSN_REMOTE_SUPABASE_URL") : undefined;
  const accessToken = required("TLSN_REMOTE_ACCESS_TOKEN_A");
  const device = { id: required("TLSN_REMOTE_DEVICE_ID_A") };
  const privateKey = await loadPrivateKey("TLSN_REMOTE_DEVICE_A");
  const publishableKey = authMode === "supabase" ? required("TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY") : undefined;
  const { manifest, entries } = readRealFixtureManifest();
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
      });
      rows.push(row);
      console.log(JSON.stringify({
        case: row.case_label,
        concurrency: row.concurrency,
        samples: row.successful_samples,
        client_visible: row.phases.client_visible,
        trigger_queue_start: row.phases.trigger_queue_start,
        queue_verifier: row.phases.queue_verifier,
        result: row.result,
      }));
    }
  }

  const result = reportDecision(rows);
  const report = {
    schema_version: 1,
    benchmark: "tlsn-worker-remote-e2e",
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
      source_path: manifest.source.path,
      request_transcript_status: "NOT_ESTABLISHED",
    },
    configuration: {
      requested_samples_per_case_and_concurrency: sampleCount,
      concurrency: concurrencyValues,
      poll_interval_ms: pollIntervalMs,
      max_poll_ms: maxPollMs,
      target_ms: RESULT_TARGET_MS,
      execution_mode: executionMode,
    },
    boundaries: {
      worker_r2_do: "MEASURED BY OPT-IN WORKER TELEMETRY",
      trigger_task_start: executionMode === "trigger"
        ? "MEASURED AT FIRST TRIGGER TASK CODE USING TRIGGER CLOCK"
        : "NOT APPLICABLE",
      trigger_platform_scheduler_timestamp: "NOT_ESTABLISHED",
      production_worker_isolate_rss: "NOT_ESTABLISHED",
      client_visible_clock: "MEASURED BY BENCHMARK PROCESS",
      trigger_queue_start_clock_note: executionMode === "trigger"
        ? "T2 and T3 are wall-clock timestamps from Worker and Trigger environments; clock skew is not corrected"
        : "Queue T2 and T3 are wall-clock timestamps from the same Worker environment",
      queue_message_timestamp_note: executionMode === "queue"
        ? "queue_consumer_scheduled is Message.timestamp, the Queue message creation timestamp; Cloudflare does not expose a consumer scheduling timestamp, so this value is not used as a cross-runtime delivery duration"
        : "NOT APPLICABLE",
      fixture_generation: "EXCLUDED FROM T0-T11; generated from existing real corpus with each issued binding",
    },
    target_decision: result,
    results: rows,
  };
  const reportPath = optional("TLSN_REMOTE_BENCHMARK_REPORT_PATH")
    ?? resolve(packageDirectory, "artifacts/tlsn-remote-benchmark.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report_path: reportPath, target_decision: result }));
  if (result === "EXCEEDS TARGET") process.exitCode = 1;
  if (result === "NOT ESTABLISHED") process.exitCode = 2;
}

main().catch((error) => {
  console.error(`[tlsn-remote-benchmark] ${error instanceof Error ? error.message : "measurement_failed"}`);
  process.exitCode = 2;
});
