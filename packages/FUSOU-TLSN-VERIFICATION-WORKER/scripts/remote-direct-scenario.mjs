#!/usr/bin/env node

import { createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  fixtureSourcePath,
  generateRealFixture,
  readRealFixtureManifest,
} from "./tlsn-benchmark-fixtures.mjs";

const workerOrigin = required("TLSN_REMOTE_BENCHMARK_WORKER_URL");
const accessToken = required("TLSN_REMOTE_ACCESS_TOKEN_A");
const deviceId = required("TLSN_REMOTE_DEVICE_ID_A");
const expectedMode = required("TLSN_REMOTE_DIRECT_EXPECTED_MODE");
const pollIntervalMs = Number(process.env.TLSN_REMOTE_POLL_INTERVAL_MS ?? "100");
const maxPollMs = Number(process.env.TLSN_REMOTE_MAX_POLL_MS ?? "15000");
const resultRaceSettleMs = Number(process.env.TLSN_REMOTE_RESULT_RACE_SETTLE_MS ?? "90000");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function endpoint(pathname) {
  return new URL(pathname, `${workerOrigin}/`).toString();
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url");
}

function sha256Base64Url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function pushLengthPrefixed(chunks, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  chunks.push(length, bytes);
}

function deviceProofMessage(session, binding) {
  const chunks = [Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  pushLengthPrefixed(chunks, deviceId);
  pushLengthPrefixed(chunks, session.session_id);
  pushLengthPrefixed(chunks, binding);
  pushLengthPrefixed(chunks, decodeBase64Url(session.device_challenge));
  return Buffer.concat(chunks);
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(endpoint(pathname), {
    redirect: "error",
    ...options,
  });
  const body = await response.text();
  return { response, json: parseJson(body) };
}

function parseTimingHeader(response) {
  const encoded = response.headers.get("X-FUSOU-TLSN-Benchmark-Timing");
  if (!encoded) return null;
  return parseJson(Buffer.from(encoded, "base64url").toString("utf8"));
}

async function loadPrivateKey() {
  const file = process.env.TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE?.trim();
  const encoded = file
    ? (await readFile(resolve(file), "utf8")).trim()
    : required("TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL");
  return createPrivateKey({ key: decodeBase64Url(encoded), format: "der", type: "pkcs8" });
}

async function issueSession(privateKey, requestedBinding) {
  const nonce = randomBytes(32).toString("hex");
  const signature = sign(null, Buffer.from(nonce), privateKey).toString("base64url");
  const result = await requestJson("/attestation/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(requestedBinding ? { "X-FUSOU-TLSN-Test-Binding": requestedBinding } : {}),
    },
    body: JSON.stringify({ device_id: deviceId, nonce, sig: signature }),
  });
  if (result.response.status !== 201 || typeof result.json?.session_id !== "string") {
    throw new Error(`session issuance failed with status ${result.response.status}`);
  }
  return result.json;
}

async function pollTerminalStatus(session, userId, jobId, traceId) {
  const bindingId = createHash("sha256").update(session.binding).digest("base64url");
  const deadline = Date.now() + maxPollMs;
  let lastResult;
  while (Date.now() < deadline) {
    lastResult = await requestJson("/verify/tlsn/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        job_id: jobId,
        binding_id: bindingId,
        session_id: session.session_id,
        canonical_user_id: userId,
        device_id: deviceId,
        ...(traceId ? { benchmark_trace_id: traceId } : {}),
      }),
    });
    if (lastResult.response.status !== 202) return { ...lastResult, bindingId };
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
  }
  throw new Error("status polling exceeded configured maximum");
}

async function pollResultRaceDiagnostics(session, userId, jobId, traceId, bindingId) {
  const deadline = Date.now() + resultRaceSettleMs;
  let lastResult;
  while (Date.now() < deadline) {
    lastResult = await requestJson("/verify/tlsn/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        job_id: jobId,
        binding_id: bindingId,
        session_id: session.session_id,
        canonical_user_id: userId,
        device_id: deviceId,
        ...(traceId ? { benchmark_trace_id: traceId } : {}),
      }),
    });
    const timing = parseTimingHeader(lastResult.response) ?? {};
    const diagnostics = timing.diagnostics ?? {};
    if (
      Number(diagnostics.direct_invocation_count ?? 0) > 0 && (
        Number(timing.r2_operations?.result_put ?? 0) > 0
        || diagnostics.result_sha256_present === true
        || diagnostics.result_put_before_consume_rejected === true
      )
    ) {
      return lastResult;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
  }
  return lastResult;
}

async function runMixedAttempt({ fault, session, userId, privateKey, manifest, entry }) {
  const fixture = generateRealFixture(fixtureSourcePath(manifest, entry), session.binding);
  const deviceProof = sign(null, deviceProofMessage(session, session.binding), privateKey).toString("base64url");
  const verification = await requestJson("/verify/tlsn/sparse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(fault !== "success" ? { "X-FUSOU-TLSN-Test-Fault": fault } : {}),
    },
    body: JSON.stringify({
      presentation_base64: fixture.sparse_presentation_base64,
      session_id: session.session_id,
      binding: session.binding,
      device_id: deviceId,
      device_proof: { challenge: session.device_challenge, sig: deviceProof },
    }),
  });
  if (verification.response.status !== 202 || typeof verification.json?.job_id !== "string") {
    throw new Error(`remote mixed ${fault} submission failed with status ${verification.response.status}`);
  }
  const final = await pollTerminalStatus(
    session,
    userId,
    verification.json.job_id,
    verification.json.benchmark_trace_id,
  );
  const timing = parseTimingHeader(final.response) ?? {};
  const timestamps = timing.timestamps ?? {};
  const expectedSuccess = fault === "success";
  const terminalMatches = expectedSuccess
    ? final.response.status === 200 && final.json?.verified === true
    : final.response.status === 200 && final.json?.verified === false && final.json?.status === "not_verified";
  const result = {
    fault,
    submission_status: verification.response.status,
    terminal_status: final.response.status,
    terminal_verified: final.json?.verified === true,
    terminal_not_verified: final.json?.verified === false && final.json?.status === "not_verified",
    direct_invocation_count: Number(timing.diagnostics?.direct_invocation_count ?? 0),
    result_put_count: Number(timing.r2_operations?.result_put ?? 0),
    consume_completed: Number.isFinite(timestamps.t10_consume_completed),
    timing_job_id_matches_submission: typeof timing.job_id_sha256 === "string"
      && timing.job_id_sha256 === sha256Base64Url(verification.json.job_id),
    timing_trace_id_matches_submission: typeof timing.trace_id_sha256 === "string"
      && typeof verification.json.benchmark_trace_id === "string"
      && timing.trace_id_sha256 === sha256Base64Url(verification.json.benchmark_trace_id),
  };
  if (
    !terminalMatches
    || result.direct_invocation_count !== 1
    || !result.timing_job_id_matches_submission
    || !result.timing_trace_id_matches_submission
    || (expectedSuccess && (!result.consume_completed || result.result_put_count !== 1))
    || (!expectedSuccess && result.result_put_count !== 0)
  ) {
    throw new Error(`remote mixed ${fault} invariant failed`);
  }
  return result;
}

async function main() {
  if (process.env.TLSN_REMOTE_AUTH_MODE !== "test") {
    throw new Error("TLSN_REMOTE_AUTH_MODE must be test");
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 25 || !Number.isInteger(maxPollMs) || maxPollMs < 1_000) {
    throw new Error("invalid polling configuration");
  }
  const users = parseJson(required("TLSN_TEST_AUTH_USERS"));
  const user = users?.[accessToken];
  if (typeof user?.id !== "string" || user.is_anonymous === true) {
    throw new Error("remote test token is not a configured non-anonymous user");
  }
  const privateKey = await loadPrivateKey();
  const { manifest, entries } = readRealFixtureManifest();
  const mixedMatch = /^mixed-(4|8)$/.exec(expectedMode);
  if (mixedMatch) {
    const concurrency = Number(mixedMatch[1]);
    const bindings = required("TLSN_REMOTE_TEST_BINDING_VALUES")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (new Set(bindings).size < concurrency) {
      throw new Error(`TLSN_REMOTE_TEST_BINDING_VALUES must contain ${concurrency} distinct values`);
    }
    const faults = ["failure", "timeout", ...Array.from({ length: concurrency - 2 }, () => "success")];
    const sessions = [];
    for (const binding of bindings.slice(0, concurrency)) {
      const session = await issueSession(privateKey, binding);
      if (session.binding !== binding) throw new Error("remote mixed binding selection failed");
      sessions.push(session);
    }
    const results = await Promise.all(faults.map((fault, index) => runMixedAttempt({
      fault,
      session: sessions[index],
      userId: user.id,
      privateKey,
      manifest,
      entry: entries.get("p50"),
    })));
    console.log(JSON.stringify({ expected_mode: expectedMode, concurrency, attempts: results }));
    return;
  }
  const session = await issueSession(privateKey);
  const entry = entries.get("p50");
  const fixture = generateRealFixture(fixtureSourcePath(manifest, entry), session.binding);
  const deviceProof = sign(null, deviceProofMessage(session, session.binding), privateKey).toString("base64url");
  const verification = await requestJson("/verify/tlsn/sparse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(expectedMode === "result_race"
        ? { "X-FUSOU-TLSN-Test-Fault": "pause_after_result_put" }
        : {}),
    },
    body: JSON.stringify({
      presentation_base64: fixture.sparse_presentation_base64,
      session_id: session.session_id,
      binding: session.binding,
      device_id: deviceId,
      device_proof: { challenge: session.device_challenge, sig: deviceProof },
    }),
  });
  if (verification.response.status !== 202 || typeof verification.json?.job_id !== "string") {
    throw new Error(`verification submission failed with status ${verification.response.status}`);
  }

  const final = await pollTerminalStatus(
    session,
    user.id,
    verification.json.job_id,
    verification.json.benchmark_trace_id,
  );
  if (final.response.status !== 200 || final.json?.verified !== false || final.json?.status !== "not_verified") {
    throw new Error(`expected terminal not_verified, received status ${final.response.status}`);
  }

  if (expectedMode === "timeout") {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  const stable = expectedMode === "result_race"
    ? await pollResultRaceDiagnostics(
      session,
      user.id,
      verification.json.job_id,
      verification.json.benchmark_trace_id,
      final.bindingId,
    )
    : await pollTerminalStatus(
      session,
      user.id,
      verification.json.job_id,
      verification.json.benchmark_trace_id,
    );
  const retry = await requestJson("/verify/tlsn/retry", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      job_id: verification.json.job_id,
      binding_id: final.bindingId,
      session_id: session.session_id,
      canonical_user_id: user.id,
      device_id: deviceId,
    }),
  });
  const timing = parseTimingHeader(stable.response) ?? parseTimingHeader(final.response) ?? {};
  const timestamps = timing.timestamps ?? {};
  const directInvocationCount = Number(timing.diagnostics?.direct_invocation_count ?? 0);
  const resultPutCount = Number(timing.r2_operations?.result_put ?? 0);
  const result = {
    expected_mode: expectedMode,
    submission_status: verification.response.status,
    terminal_status: final.response.status,
    terminal_payload_shape: {
      verified: final.json?.verified === false,
      status: final.json?.status === "not_verified",
      job_id_present: typeof final.json?.job_id === "string",
    },
    stable_terminal_status: stable.response.status === 200 && stable.json?.status === "not_verified",
    direct_invocation_started: Number.isFinite(timestamps.direct_invocation_started),
    direct_invocation_count: directInvocationCount,
    direct_invocation_accepted: Number.isFinite(timestamps.direct_invocation_accepted),
    result_persisted: Number.isFinite(timestamps.t8_result_persisted) || resultPutCount > 0,
    result_put_count: resultPutCount,
    result_sha256_present: timing.diagnostics?.result_sha256_present === true,
    completion_failure_code: typeof timing.diagnostics?.completion_failure_code === "string"
      ? timing.diagnostics.completion_failure_code
      : null,
    result_put_before_consume_rejected: timing.diagnostics?.result_put_before_consume_rejected === true,
    result_object_retained: timing.diagnostics?.result_object_retained === true,
    result_delete_count: Number(timing.r2_operations?.result_delete ?? 0),
    consume_completed: Number.isFinite(timestamps.t10_consume_completed),
    timing_job_id_hashed: typeof timing.job_id_sha256 === "string",
    timing_job_id_matches_submission: typeof timing.job_id_sha256 === "string"
      && timing.job_id_sha256 === sha256Base64Url(verification.json.job_id),
    timing_trace_id_hashed: typeof timing.trace_id_sha256 === "string",
    timing_trace_id_matches_submission: typeof timing.trace_id_sha256 === "string"
      && typeof verification.json.benchmark_trace_id === "string"
      && timing.trace_id_sha256 === sha256Base64Url(verification.json.benchmark_trace_id),
    retry_status: retry.response.status,
    retry_payload: retry.json,
    no_retry_attempt: retry.response.status === 409 && retry.json?.error === "verification_retry_disabled",
  };
  const resultRacePassed = expectedMode !== "result_race"
    || (
      result.result_persisted &&
      result.result_put_count === 1 &&
      !result.consume_completed &&
      result.result_put_before_consume_rejected &&
      result.result_object_retained &&
      result.result_delete_count === 0
    );
  console.log(JSON.stringify(result));
  if (!result.stable_terminal_status || !result.no_retry_attempt || result.direct_invocation_count !== 1 || result.direct_invocation_accepted || !resultRacePassed || !result.timing_job_id_matches_submission || !result.timing_trace_id_matches_submission) {
    throw new Error("remote Direct terminal, retry, or telemetry invariant failed");
  }
}

main().catch((error) => {
  console.error(`[tlsn-remote-direct-scenario] ${error instanceof Error ? error.message : "scenario_failed"}`);
  process.exitCode = 2;
});