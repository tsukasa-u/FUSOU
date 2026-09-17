#!/usr/bin/env node

import { createHash, createHmac, createPrivateKey, randomBytes, randomUUID, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  fixtureSourcePath,
  generateRealFixture,
  readRealFixtureManifest,
} from "./tlsn-benchmark-fixtures.mjs";

const workerOrigin = required("TLSN_REMOTE_BENCHMARK_WORKER_URL");
const accessToken = required("TLSN_REMOTE_ACCESS_TOKEN_A");
const deviceId = required("TLSN_REMOTE_DEVICE_ID_A");
const callbackSecret = required("TLSN_REMOTE_DIRECT_CALLBACK_SECRET");
const failureBinding = required("TLSN_REMOTE_TEST_BINDING_FAILURE");
const successBinding = required("TLSN_REMOTE_TEST_BINDING_SUCCESS");
const pollIntervalMs = Number(process.env.TLSN_REMOTE_POLL_INTERVAL_MS ?? "100");
const maxPollMs = Number(process.env.TLSN_REMOTE_MAX_POLL_MS ?? "15000");
const reportPath = process.env.TLSN_REMOTE_MALICIOUS_CALLBACK_REPORT_PATH?.trim();

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

function internalRequestSignature(secret, jobId, body) {
  const digest = createHash("sha256").update(body).digest("base64url");
  return createHmac("sha256", secret)
    .update(`FUSOU-TLSN-INTERNAL-V1\0${jobId}\0${digest}`)
    .digest("base64url");
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(endpoint(pathname), { redirect: "error", ...options });
  const body = await response.text();
  return { response, json: parseJson(body) };
}

async function loadPrivateKey() {
  const file = process.env.TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE?.trim();
  const encoded = file
    ? (await readFile(resolve(file), "utf8")).trim()
    : required("TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL");
  return createPrivateKey({ key: decodeBase64Url(encoded), format: "der", type: "pkcs8" });
}

async function issueSession(privateKey, bindingSelector) {
  const nonce = randomBytes(32).toString("hex");
  const signature = sign(null, Buffer.from(nonce), privateKey).toString("base64url");
  const result = await requestJson("/attestation/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-FUSOU-TLSN-Test-Binding": bindingSelector,
    },
    body: JSON.stringify({ device_id: deviceId, nonce, sig: signature }),
  });
  if (result.response.status !== 201 || typeof result.json?.session_id !== "string") {
    throw new Error(`session issuance failed with status ${result.response.status}`);
  }
  return result.json;
}

async function submitVerification(privateKey, session, fixture, fault, bindingSelector) {
  const deviceProof = sign(
    null,
    deviceProofMessage(session, session.binding),
    privateKey,
  ).toString("base64url");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "X-FUSOU-TLSN-Test-Binding": bindingSelector,
  };
  if (fault) headers["X-FUSOU-TLSN-Test-Fault"] = fault;
  const result = await requestJson("/verify/tlsn/sparse", {
    method: "POST",
    headers,
    body: JSON.stringify({
      presentation_base64: fixture.sparse_presentation_base64,
      session_id: session.session_id,
      binding: session.binding,
      device_id: deviceId,
      device_proof: { challenge: session.device_challenge, sig: deviceProof },
    }),
  });
  if (result.response.status !== 202 || typeof result.json?.job_id !== "string") {
    throw new Error(`verification submission failed with status ${result.response.status}`);
  }
  return result.json;
}

async function pollStatus(session, userId, jobId, bindingId) {
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
      }),
    });
    if (lastResult.response.status !== 202) return lastResult;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
  }
  throw new Error("status polling exceeded configured maximum");
}

function callbackBody(base, changes = {}) {
  return JSON.stringify({
    job_id: base.job_id,
    binding_id: base.binding_id,
    session_id: base.session_id,
    canonical_user_id: base.canonical_user_id,
    device_id: base.device_id,
    presentation_id: base.presentation_id,
    verification_status: "verified",
    profile: "sparse",
    disclosure_mode: "sparse",
    ...changes,
  });
}

async function sendCallback(body, jobId, signatureMode = "valid") {
  const headers = {
    "Content-Type": "application/json",
    "X-FUSOU-TLSN-Job-Id": jobId,
    "X-FUSOU-TLSN-Execution-Mode": "direct",
  };
  if (signatureMode !== "missing") {
    headers["X-FUSOU-TLSN-Signature"] = signatureMode === "invalid"
      ? "A".repeat(43)
      : internalRequestSignature(callbackSecret, jobId, body);
  }
  const result = await requestJson("/internal/tlsn/verification-complete", {
    method: "POST",
    headers,
    body,
  });
  return {
    http_status: result.response.status,
    error: typeof result.json?.error === "string" ? result.json.error : null,
    accepted: result.json?.accepted === true,
  };
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
  const entry = entries.get("p50");

  const failedSession = await issueSession(privateKey, failureBinding);
  const failedFixture = generateRealFixture(fixtureSourcePath(manifest, entry), failedSession.binding);
  const failedSubmission = await submitVerification(privateKey, failedSession, failedFixture, "failure", failureBinding);
  const failedBindingId = createHash("sha256").update(failedSession.binding).digest("base64url");
  const failedStatus = await pollStatus(failedSession, user.id, failedSubmission.job_id, failedBindingId);
  if (failedStatus.response.status !== 200 || failedStatus.json?.status !== "not_verified") {
    throw new Error(`failure fixture did not reach not_verified: ${failedStatus.response.status}`);
  }
  const failedBase = {
    job_id: failedSubmission.job_id,
    binding_id: failedBindingId,
    session_id: failedSession.session_id,
    canonical_user_id: user.id,
    device_id: deviceId,
    presentation_id: createHash("sha256").update(decodeBase64Url(failedFixture.sparse_presentation_base64)).digest("base64url"),
  };
  const attackCases = [
    ["missing_signature", callbackBody(failedBase), "missing"],
    ["invalid_signature", callbackBody(failedBase), "invalid"],
    ["wrong_job", callbackBody(failedBase, { job_id: randomUUID() }), "valid"],
    ["wrong_binding", callbackBody(failedBase, { binding_id: createHash("sha256").update("wrong-binding").digest("base64url") }), "valid"],
    ["wrong_session", callbackBody(failedBase, { session_id: randomUUID() }), "valid"],
    ["wrong_user", callbackBody(failedBase, { canonical_user_id: "22222222-2222-4222-8222-222222222222" }), "valid"],
    ["wrong_device", callbackBody(failedBase, { device_id: "44444444-4444-4444-8444-444444444444" }), "valid"],
    ["wrong_presentation", callbackBody(failedBase, { presentation_id: "A".repeat(43) }), "valid"],
    ["wrong_profile", callbackBody(failedBase, { profile: "complete", disclosure_mode: "full" }), "valid"],
    ["late_failed_callback", callbackBody(failedBase), "valid"],
  ];
  const failureAttacks = [];
  for (const [name, body, signatureMode] of attackCases) {
    failureAttacks.push({ name, ...(await sendCallback(body, failedBase.job_id, signatureMode)) });
  }
  const failedStatusAfterAttacks = await pollStatus(failedSession, user.id, failedSubmission.job_id, failedBindingId);

  const successSession = await issueSession(privateKey, successBinding);
  const successFixture = generateRealFixture(fixtureSourcePath(manifest, entry), successSession.binding);
  const successSubmission = await submitVerification(privateKey, successSession, successFixture, undefined, successBinding);
  const successBindingId = createHash("sha256").update(successSession.binding).digest("base64url");
  const successStatus = await pollStatus(successSession, user.id, successSubmission.job_id, successBindingId);
  if (successStatus.response.status !== 200 || successStatus.json?.verified !== true) {
    throw new Error(`success fixture did not reach verified: ${successStatus.response.status}`);
  }
  const successBase = {
    job_id: successSubmission.job_id,
    binding_id: successBindingId,
    session_id: successSession.session_id,
    canonical_user_id: user.id,
    device_id: deviceId,
    presentation_id: createHash("sha256").update(decodeBase64Url(successFixture.sparse_presentation_base64)).digest("base64url"),
  };
  const consumedCallback = await sendCallback(callbackBody(successBase), successBase.job_id);
  const consumedMutation = await sendCallback(
    callbackBody(successBase, { presentation_id: "A".repeat(43) }),
    successBase.job_id,
  );
  const successStatusAfterAttack = await pollStatus(successSession, user.id, successSubmission.job_id, successBindingId);

  const result = {
    failed_binding: {
      terminal_status: failedStatus.response.status,
      terminal_not_verified: failedStatus.json?.status === "not_verified",
      attacks: failureAttacks,
      remains_not_verified: failedStatusAfterAttacks.json?.status === "not_verified",
    },
    consumed_binding: {
      terminal_status: successStatus.response.status,
      duplicate_callback: consumedCallback,
      mutated_callback: consumedMutation,
      remains_verified: successStatusAfterAttack.json?.verified === true,
    },
  };
  console.log(JSON.stringify(result));
  if (
    !result.failed_binding.terminal_not_verified ||
    !result.failed_binding.remains_not_verified ||
    !result.consumed_binding.remains_verified ||
    !result.consumed_binding.duplicate_callback.accepted ||
    result.consumed_binding.mutated_callback.http_status !== 422
  ) {
    throw new Error("remote malicious callback invariant failed");
  }
  if (reportPath) await writeFile(resolve(reportPath), `${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[tlsn-remote-malicious-callback] ${error instanceof Error ? error.message : "scenario_failed"}`);
  process.exitCode = 2;
});
