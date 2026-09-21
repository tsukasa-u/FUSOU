#!/usr/bin/env node

import { createHash, createPrivateKey, createHmac, randomBytes, randomUUID, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  fixtureSourcePath,
  generateRealFixture,
  packageDirectory,
  readRealFixtureManifest,
} from "./tlsn-benchmark-fixtures.mjs";
import { decodeReplayEnvironmentValues } from "./replay-deployment-environment.mjs";

const replayEnvironment = decodeReplayEnvironmentValues(process.env);
const reportPath = resolve(
  packageDirectory,
  replayEnvironment.TLSN_REPLAY_CALLBACK_REPORT_PATH ?? "artifacts/tlsn-replay-callback-security-current.json",
);

function required(name) {
  const value = replayEnvironment[name]?.trim();
  if (!value) throw new Error(`missing required replay callback input: ${name}`);
  return value;
}

function endpoint(origin, pathname) {
  return new URL(pathname, `${origin}/`).toString();
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

function deviceProofMessage(session, binding, deviceId) {
  const chunks = [Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  pushLengthPrefixed(chunks, deviceId);
  pushLengthPrefixed(chunks, session.session_id);
  pushLengthPrefixed(chunks, binding);
  pushLengthPrefixed(chunks, decodeBase64Url(session.device_challenge));
  return Buffer.concat(chunks);
}

function internalRequestSignature(secret, jobId, body) {
  const digest = createHash("sha256").update(body).digest("base64url");
  return createHmac("sha256", secret)
    .update(`FUSOU-TLSN-INTERNAL-V1\0${jobId}\0${digest}`)
    .digest("base64url");
}

async function requestJson(origin, pathname, options = {}) {
  const response = await fetch(endpoint(origin, pathname), { redirect: "error", ...options });
  const body = await response.text();
  return { response, json: parseJson(body) };
}

function parseTiming(response) {
  const encoded = response.headers.get("X-FUSOU-TLSN-Benchmark-Timing");
  return encoded ? parseJson(Buffer.from(encoded, "base64url").toString("utf8")) : null;
}

async function loadPrivateKey() {
  const encoded = required("TLSN_REPLAY_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL");
  return createPrivateKey({ key: decodeBase64Url(encoded), format: "der", type: "pkcs8" });
}

async function issueSession(origin, token, deviceId, privateKey) {
  const nonce = randomBytes(32).toString("hex");
  const response = await requestJson(origin, "/attestation/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      device_id: deviceId,
      nonce,
      sig: sign(null, Buffer.from(nonce), privateKey).toString("base64url"),
    }),
  });
  return response;
}

async function submitVerification(origin, token, session, deviceId, privateKey, fixture) {
  const proof = sign(
    null,
    deviceProofMessage(session, session.binding, deviceId),
    privateKey,
  ).toString("base64url");
  return requestJson(origin, "/verify/tlsn/sparse", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      presentation_base64: fixture.sparse_presentation_base64,
      session_id: session.session_id,
      binding: session.binding,
      device_id: deviceId,
      device_proof: { challenge: session.device_challenge, sig: proof },
    }),
  });
}

async function pollStatus(origin, token, session, userId, jobId, traceId, deviceId) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    last = await requestJson(origin, "/verify/tlsn/status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        job_id: jobId,
        binding_id: sha256Base64Url(session.binding),
        session_id: session.session_id,
        canonical_user_id: userId,
        device_id: deviceId,
        ...(traceId ? { benchmark_trace_id: traceId } : {}),
      }),
    });
    if (last.response.status !== 202) return last;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("callback regression status polling exceeded 30 seconds");
}

function callbackBody(base, changes = {}) {
  return JSON.stringify({
    job_id: base.job_id,
    binding_id: base.binding_id,
    session_id: base.session_id,
    canonical_user_id: base.canonical_user_id,
    device_id: base.device_id,
    presentation_id: base.presentation_id,
    execution_mode: "direct",
    verification_input_source: "direct",
    verification_attempt_id: randomUUID(),
    verification_status: "verified",
    profile: "sparse",
    disclosure_mode: "sparse",
    ...changes,
  });
}

async function sendCallback(origin, secret, body, jobId, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-FUSOU-TLSN-Job-Id": jobId,
    "X-FUSOU-TLSN-Execution-Mode": "direct",
    ...(options.signature === "missing"
      ? {}
      : { "X-FUSOU-TLSN-Signature": options.signature ?? internalRequestSignature(secret, jobId, body) }),
    ...(options.diagnostic ? { "X-FUSOU-TLSN-Diagnostic": "hmac" } : {}),
  };
  const result = await requestJson(origin, "/internal/tlsn/verification-complete", {
    method: "POST",
    headers,
    body,
  });
  return {
    http_status: result.response.status,
    error: typeof result.json?.error === "string" ? result.json.error : null,
    accepted: result.json?.accepted === true,
    status: result.json?.status ?? null,
  };
}

function baseCallback(session, userId, jobId, fixture) {
  return {
    job_id: jobId,
    binding_id: sha256Base64Url(session.binding),
    session_id: session.session_id,
    canonical_user_id: userId,
    device_id: required("TLSN_REPLAY_DEVICE_ID"),
    presentation_id: sha256Base64Url(decodeBase64Url(fixture.sparse_presentation_base64)),
  };
}

function observationsFromTiming(timing) {
  return {
    do_acquire_verification: Number(timing?.do_operations?.acquire_verification ?? 0),
    do_commit_verified_result: Number(timing?.do_operations?.commit_verified_result ?? 0),
    result_archive_put: Number(timing?.r2_operations?.result_archive_put ?? 0),
    result_r2_get: Number(timing?.r2_operations?.result_get ?? 0)
      + Number(timing?.r2_operations?.status_result_get ?? 0)
      + Number(timing?.r2_operations?.replay_result_get ?? 0),
    late_callback_count: Number(timing?.diagnostics?.late_callback_count ?? 0),
  };
}

async function writeReport(report) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const workerOrigin = required("TLSN_REPLAY_WORKER_URL");
  const token = required("TLSN_REPLAY_ACCESS_TOKEN");
  const deviceId = required("TLSN_REPLAY_DEVICE_ID");
  const callbackSecret = required("TLSN_DIRECT_CALLBACK_SECRET");
  const expectedCommit = required("TLSN_GIT_COMMIT_SHA");
  const health = await requestJson(workerOrigin, "/health");
  const reportBase = {
    schema_version: 1,
    scope: "tlsn-replay-callback-security",
    generated_at: new Date().toISOString(),
    current_head: expectedCommit,
    report_path: reportPath,
    worker_origin: workerOrigin,
    health: health.json ?? null,
  };
  if (
    health.response.status !== 200
    || health.json?.environment !== "test"
    || health.json?.deployment_role !== "replay"
    || health.json?.binding_mode !== "fixed"
    || health.json?.execution_mode !== "direct"
    || health.json?.git_commit_sha !== expectedCommit
  ) {
    const report = { ...reportBase, status: "BLOCKED", blocked_reason: "replay_health_contract_mismatch" };
    await writeReport(report);
    console.log(JSON.stringify({ report_path: reportPath, status: report.status, blocked_reason: report.blocked_reason }));
    process.exitCode = 3;
    return;
  }

  const privateKey = await loadPrivateKey();
  const userId = JSON.parse(required("TLSN_REPLAY_AUTH_USERS"))[token]?.id;
  if (typeof userId !== "string") throw new Error("replay access token does not map to a user");
  const sessionResponse = await issueSession(workerOrigin, token, deviceId, privateKey);
  if (sessionResponse.response.status !== 201) {
    const blockedReason = sessionResponse.json?.error === "binding_consumed"
      ? "fixed_binding_already_consumed"
      : "session_issuance_failed";
    const report = {
      ...reportBase,
      status: blockedReason === "fixed_binding_already_consumed" ? "BLOCKED" : "FAILED",
      blocked_reason: blockedReason,
      session_response: { status: sessionResponse.response.status, body: sessionResponse.json },
    };
    await writeReport(report);
    console.log(JSON.stringify({ report_path: reportPath, status: report.status, blocked_reason: blockedReason }));
    process.exitCode = report.status === "BLOCKED" ? 3 : 1;
    return;
  }
  const session = sessionResponse.json;
  if (session.binding !== required("TLSN_REPLAY_BINDING_VALUE")) {
    throw new Error("replay session did not return the configured fixed binding");
  }

  const { manifest, entries } = readRealFixtureManifest();
  const fixture = generateRealFixture(fixtureSourcePath(manifest, entries.get("p50")), session.binding);
  const submission = await submitVerification(workerOrigin, token, session, deviceId, privateKey, fixture);
  const submissionJobId = typeof submission.json?.job_id === "string"
    ? submission.json.job_id
    : submission.response.headers.get("X-FUSOU-TLSN-Test-Job-Id");
  const submissionTraceId = typeof submission.json?.benchmark_trace_id === "string"
    ? submission.json.benchmark_trace_id
    : submission.response.headers.get("X-FUSOU-TLSN-Test-Benchmark-Trace-Id");
  const synchronousSuccess = submission.response.status === 200 && submission.json?.verified === true;
  if ((!synchronousSuccess && submission.response.status !== 202) || typeof submissionJobId !== "string") {
    throw new Error(`normal callback submission failed with status ${submission.response.status}`);
  }
  const terminal = synchronousSuccess
    ? submission
    : await pollStatus(workerOrigin, token, session, userId, submissionJobId, submissionTraceId, deviceId);
  const normalCallback = {
    submission_status: submission.response.status,
    terminal_status: terminal.response.status,
    terminal_verified: terminal.json?.verified === true,
    terminal_payload: terminal.json?.status ?? null,
  };
  if (terminal.response.status !== 200 || terminal.json?.verified !== true) {
    throw new Error(`normal callback did not reach verified: ${JSON.stringify(normalCallback)}`);
  }

  const base = baseCallback(session, userId, submissionJobId, fixture);
  const staleJobId = randomUUID();
  const staleBody = callbackBody(base, { job_id: staleJobId });
  const staleCallback = await sendCallback(workerOrigin, callbackSecret, staleBody, staleJobId);
  const missingSignature = await sendCallback(
    workerOrigin,
    callbackSecret,
    callbackBody(base),
    base.job_id,
    { signature: "missing", diagnostic: true },
  );
  const mutatedCallback = await sendCallback(
    workerOrigin,
    callbackSecret,
    callbackBody(base, { presentation_id: "A".repeat(43) }),
    base.job_id,
  );
  const duplicateCallback = await sendCallback(
    workerOrigin,
    callbackSecret,
    callbackBody(base),
    base.job_id,
  );
  const stable = await pollStatus(
    workerOrigin,
    token,
    session,
    userId,
    submissionJobId,
    submissionTraceId,
    deviceId,
  );
  const timing = parseTiming(stable.response) ?? parseTiming(terminal.response) ?? {};
  const observations = observationsFromTiming(timing);
  const checks = {
    normal_callback_verified: normalCallback.terminal_verified,
    stale_callback_rejected: staleCallback.http_status === 409 && staleCallback.error === "binding_unknown",
    missing_signature_rejected: missingSignature.http_status === 401 && missingSignature.error === "signature_invalid",
    mutated_callback_rejected: mutatedCallback.http_status === 422 && mutatedCallback.error === "verification_result_mismatch",
    duplicate_callback_idempotent: duplicateCallback.http_status === 200 && duplicateCallback.accepted,
    result_remains_verified: stable.response.status === 200 && stable.json?.verified === true,
    commit_count_unchanged: observations.do_commit_verified_result === 1,
    archive_count_unchanged: observations.result_archive_put === 1,
    no_result_r2_read: observations.result_r2_get === 0,
    late_callback_observed: observations.late_callback_count >= 1,
  };
  const pass = Object.values(checks).every(Boolean);
  const report = {
    ...reportBase,
    status: pass ? "PASS" : "FAILED",
    binding_mode: health.json.binding_mode,
    execution_mode: health.json.execution_mode,
    deployment_id: health.json.deployment_id,
    worker_version_id: replayEnvironment.TLSN_REPLAY_WORKER_VERSION_ID ?? null,
    verifier_version_id: replayEnvironment.TLSN_REPLAY_VERIFIER_VERSION_ID ?? null,
    normal_callback: normalCallback,
    callback_cases: {
      stale_callback: staleCallback,
      missing_signature: missingSignature,
      mutated_callback: mutatedCallback,
      duplicate_callback: duplicateCallback,
    },
    observations,
    checks,
  };
  await writeReport(report);
  console.log(JSON.stringify({ report_path: reportPath, status: report.status, checks }));
  if (!pass) process.exitCode = 1;
}

main().catch(async (error) => {
  const report = {
    schema_version: 1,
    scope: "tlsn-replay-callback-security",
    generated_at: new Date().toISOString(),
    report_path: reportPath,
    status: "FAILED",
    failure: error instanceof Error ? error.message : String(error),
  };
  await writeReport(report);
  console.error(`[tlsn-replay-callback-security] ${report.failure}`);
  process.exitCode = 1;
});
