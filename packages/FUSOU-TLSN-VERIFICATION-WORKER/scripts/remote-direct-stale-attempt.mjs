#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  fixtureSourcePath,
  generateRealFixture,
  packageDirectory,
  readRealFixtureManifest,
} from "./tlsn-benchmark-fixtures.mjs";

const workerOrigin = required("TLSN_REMOTE_BENCHMARK_WORKER_URL");
const accessToken = required("TLSN_REMOTE_ACCESS_TOKEN_A");
const deviceId = required("TLSN_REMOTE_DEVICE_ID_A");
const expectedEnvironment = process.env.TLSN_REMOTE_EXPECTED_ENVIRONMENT?.trim() || "evidence";
const expectedLeaseMs = integer("TLSN_REMOTE_EXPECTED_LEASE_MS", 60_000, 1, 600_000);
const settleMs = integer("TLSN_REMOTE_STALE_SETTLE_MS", expectedLeaseMs + 1_000, 1, 120_000);
const pollIntervalMs = integer("TLSN_REMOTE_POLL_INTERVAL_MS", 100, 25, 5_000);
const maxPollMs = integer("TLSN_REMOTE_MAX_POLL_MS", 30_000, 1_000, 300_000);
const reportPath = process.env.TLSN_REMOTE_STALE_REPORT_PATH?.trim()
  || resolve(packageDirectory, "artifacts/tlsn-remote-stale-attempt.json");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function integer(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
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
  const response = await fetch(endpoint(pathname), { redirect: "error", ...options });
  const body = await response.text();
  return { response, json: parseJson(body) };
}

function timingFrom(response) {
  const encoded = response.headers.get("X-FUSOU-TLSN-Benchmark-Timing");
  if (!encoded) return {};
  return parseJson(Buffer.from(encoded, "base64url").toString("utf8")) ?? {};
}

async function loadPrivateKey() {
  const file = process.env.TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE?.trim();
  const encoded = file
    ? (await readFile(resolve(file), "utf8")).trim()
    : required("TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL");
  return createPrivateKey({ key: decodeBase64Url(encoded), format: "der", type: "pkcs8" });
}

async function issueSession(privateKey) {
  const nonce = randomBytes(32).toString("hex");
  const signature = sign(null, Buffer.from(nonce), privateKey).toString("base64url");
  const result = await requestJson("/attestation/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ device_id: deviceId, nonce, sig: signature }),
  });
  if (result.response.status !== 201 || typeof result.json?.session_id !== "string") {
    throw new Error(`session issuance failed with status ${result.response.status}`);
  }
  return result.json;
}

async function pollStatus(session, userId, jobId, traceId, untilTerminal) {
  const deadline = Date.now() + maxPollMs;
  let last;
  while (Date.now() < deadline) {
    last = await requestJson("/verify/tlsn/status", {
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
        device_id: deviceId,
        ...(traceId ? { benchmark_trace_id: traceId } : {}),
      }),
    });
    if (!untilTerminal || (last.response.status === 200 && last.json?.status === "not_verified")) return last;
    if (last.response.status !== 202) throw new Error(`status polling failed with status ${last.response.status}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
  }
  throw new Error("stale attempt status polling exceeded configured maximum");
}

async function pollStaleDiagnostics(session, userId, jobId, traceId) {
  const deadline = Date.now() + maxPollMs;
  let last;
  while (Date.now() < deadline) {
    last = await requestJson("/verify/tlsn/status", {
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
        device_id: deviceId,
        ...(traceId ? { benchmark_trace_id: traceId } : {}),
      }),
    });
    const timing = timingFrom(last.response);
    const diagnostics = timing.diagnostics ?? {};
    if (last.response.status === 200 && diagnostics.stale_attempt_rejected === true) return last;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
  }
  return last;
}

async function main() {
  if (process.env.TLSN_REMOTE_AUTH_MODE !== "test") throw new Error("TLSN_REMOTE_AUTH_MODE must be test");
  if (expectedEnvironment !== "evidence") throw new Error("stale attempt evidence requires TLSN_REMOTE_EXPECTED_ENVIRONMENT=evidence");
  const health = await requestJson("/health");
  if (health.response.status !== 200 || health.json?.ok !== true || health.json.environment !== "test" || health.json.deployment_role !== "evidence") {
    throw new Error("remote Worker is not the isolated evidence environment");
  }
  if (health.json.binding_mode !== "random") throw new Error("stale attempt evidence requires random bindings");
  if (health.json.execution_mode !== "direct") throw new Error("stale attempt evidence requires Direct execution");

  const users = parseJson(required("TLSN_TEST_AUTH_USERS"));
  const user = users?.[accessToken];
  if (typeof user?.id !== "string" || user.is_anonymous === true) throw new Error("remote test token is not a configured non-anonymous user");
  const privateKey = await loadPrivateKey();
  const { manifest, entries } = readRealFixtureManifest();
  const entry = entries.get("p50");
  const session = await issueSession(privateKey);
  const fixture = generateRealFixture(fixtureSourcePath(manifest, entry), session.binding);
  const proof = sign(null, deviceProofMessage(session, session.binding), privateKey).toString("base64url");
  const verification = await requestJson("/verify/tlsn/sparse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-FUSOU-TLSN-Test-Fault": "pause_before_result_commit",
    },
    body: JSON.stringify({
      presentation_base64: fixture.sparse_presentation_base64,
      session_id: session.session_id,
      binding: session.binding,
      device_id: deviceId,
      device_proof: { challenge: session.device_challenge, sig: proof },
    }),
  });
  if (verification.response.status !== 202 || typeof verification.json?.job_id !== "string") {
    throw new Error(`stale attempt submission failed with status ${verification.response.status}`);
  }

  const terminal = await pollStatus(session, user.id, verification.json.job_id, verification.json.benchmark_trace_id, true);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, settleMs));
  const settled = await pollStaleDiagnostics(session, user.id, verification.json.job_id, verification.json.benchmark_trace_id);
  const timing = timingFrom(settled.response);
  const diagnostics = timing.diagnostics ?? {};
  const r2Operations = timing.r2_operations ?? {};
  const timestamps = timing.timestamps ?? {};
  const retry = await requestJson("/verify/tlsn/retry", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      job_id: verification.json.job_id,
      binding_id: sha256Base64Url(session.binding),
      session_id: session.session_id,
      canonical_user_id: user.id,
      device_id: deviceId,
    }),
  });
  const result = {
    schema_version: 1,
    evidence: "tlsn-direct-remote-stale-attempt",
    generated_at: new Date().toISOString(),
    worker_origin: workerOrigin,
    worker_health: {
      environment: health.json.environment,
      deployment_role: health.json.deployment_role,
      deployment_id: health.json.deployment_id,
      binding_mode: health.json.binding_mode,
      git_commit_sha: health.json.git_commit_sha,
    },
    configuration: {
      expected_environment: expectedEnvironment,
      expected_lease_ms: expectedLeaseMs,
      settle_ms: settleMs,
      fault: "pause_before_result_commit",
    },
    observations: {
      submission_status: verification.response.status,
      terminal_status: terminal.response.status,
      terminal_not_verified: terminal.json?.verified === false && terminal.json?.status === "not_verified",
      settled_status: settled.response.status,
      settled_not_verified: settled.json?.verified === false && settled.json?.status === "not_verified",
      direct_invocation_count: Number(diagnostics.direct_invocation_count ?? 0),
      direct_invocation_accepted: Number.isFinite(timestamps.direct_invocation_accepted),
      result_archive_put_count: Number(r2Operations.result_archive_put ?? 0),
      result_r2_read_count: Number(r2Operations.result_get ?? 0)
        + Number(r2Operations.status_result_get ?? 0)
        + Number(r2Operations.replay_result_get ?? 0),
      do_commit_verified_result_attempt_count: Number(timing.do_operations?.commit_verified_result ?? 0),
      do_commit_verified_result_count: Number(diagnostics.do_commit_verified_result_count ?? 0),
      input_put_count: Number(r2Operations.input_put ?? 0),
      input_get_count: Number(r2Operations.trigger_input_get ?? 0)
        + Number(r2Operations.worker_presentation_get ?? 0),
      input_delete_count: Number(r2Operations.input_delete ?? 0),
      consume_completed: Number.isFinite(timestamps.t10_consume_completed),
      consume_outcome: diagnostics.consume_outcome ?? null,
      late_callback_count: Number(diagnostics.late_callback_count ?? 0),
      stale_attempt_rejected: diagnostics.stale_attempt_rejected === true,
      terminal_failure_code: diagnostics.terminal_failure_code ?? null,
      retry_status: retry.response.status,
      retry_disabled: retry.response.status === 409 && retry.json?.error === "verification_retry_disabled",
      timing_job_id_hashed: typeof timing.job_id_sha256 === "string",
      timing_job_id_matches_submission: typeof timing.job_id_sha256 === "string" && timing.job_id_sha256 === sha256Base64Url(verification.json.job_id),
      timing_trace_id_hashed: typeof timing.trace_id_sha256 === "string",
      timing_trace_id_matches_submission: typeof timing.trace_id_sha256 === "string"
        && typeof verification.json.benchmark_trace_id === "string"
        && timing.trace_id_sha256 === sha256Base64Url(verification.json.benchmark_trace_id),
    },
    production_alert_delivery: "NOT_ESTABLISHED",
  };
  const pass = result.observations.terminal_not_verified
    && result.observations.settled_not_verified
    && result.observations.direct_invocation_count === 1
    && !result.observations.direct_invocation_accepted
    && result.observations.result_archive_put_count === 0
    && result.observations.result_r2_read_count === 0
    && result.observations.do_commit_verified_result_attempt_count === 1
    && result.observations.do_commit_verified_result_count === 0
    && result.observations.input_put_count === 0
    && result.observations.input_get_count === 0
    && result.observations.input_delete_count === 0
    && !result.observations.consume_completed
    && result.observations.consume_outcome === "not_attempted"
    && result.observations.late_callback_count >= 1
    && result.observations.stale_attempt_rejected
    && result.observations.terminal_failure_code === "lease_expired"
    && result.observations.retry_disabled
    && result.observations.timing_job_id_matches_submission
    && result.observations.timing_trace_id_matches_submission;
  result.decision = pass ? "PASS" : "FAIL";
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report_path: reportPath, decision: result.decision, production_alert_delivery: result.production_alert_delivery }));
  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[tlsn-remote-stale-attempt] ${error instanceof Error ? error.message : "scenario_failed"}`);
  process.exitCode = 2;
});
