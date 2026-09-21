#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  fixtureSourcePath,
  generateRealFixture,
  readRealFixtureManifest,
} from "./tlsn-benchmark-fixtures.mjs";
import { decodeReplayEnvironmentValues } from "./replay-deployment-environment.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const replayEnvironment = decodeReplayEnvironmentValues(process.env);
const reportPath = resolve(
  packageDirectory,
  process.env.TLSN_REPLAY_REPORT_PATH ?? "artifacts/tlsn-replay-evidence-current.json",
);

function required(name) {
  const value = replayEnvironment[name]?.trim();
  if (!value) throw new Error(`missing required replay validation input: ${name}`);
  return value;
}

function optional(name) {
  const value = replayEnvironment[name]?.trim();
  return value || undefined;
}

function endpoint(origin, pathname) {
  return new URL(pathname, `${origin}/`).toString();
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url");
}

function hash(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function pushU16(chunks, value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  chunks.push(bytes);
}

function pushU32(chunks, value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  chunks.push(bytes);
}

function pushU64(chunks, value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  chunks.push(bytes);
}

function pushLengthPrefixed(chunks, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  pushU16(chunks, bytes.length);
  chunks.push(bytes);
}

function pushRanges(chunks, ranges) {
  pushU32(chunks, ranges.length);
  for (const range of ranges) {
    pushU64(chunks, range.start);
    pushU64(chunks, range.length);
    const bytes = decodeBase64Url(range.bytes);
    pushU64(chunks, bytes.length);
    chunks.push(bytes);
  }
}

function resultSigningBytes(result) {
  const chunks = [Buffer.from("FUSOU-VERIFIER-RESULT-V1\0")];
  pushU16(chunks, result.version);
  pushLengthPrefixed(chunks, result.profile_id);
  pushLengthPrefixed(chunks, decodeBase64Url(result.profile_sha256));
  pushLengthPrefixed(chunks, result.issuer);
  pushLengthPrefixed(chunks, result.proof_purpose);
  pushLengthPrefixed(chunks, result.canonical_user_id);
  pushLengthPrefixed(chunks, result.device_id);
  pushLengthPrefixed(chunks, decodeBase64Url(result.device_challenge));
  pushLengthPrefixed(chunks, result.verified_member_id);
  pushLengthPrefixed(chunks, Buffer.from(result.attestation_session_id.replaceAll("-", ""), "hex"));
  pushLengthPrefixed(chunks, decodeBase64Url(result.binding_nonce));
  pushLengthPrefixed(chunks, result.binding_value);
  pushLengthPrefixed(chunks, result.verifier_key_id);
  pushLengthPrefixed(chunks, result.notary_key_id);
  pushLengthPrefixed(chunks, decodeBase64Url(result.tlsn_attestation_id));
  pushLengthPrefixed(chunks, result.server_identity);
  pushU64(chunks, result.request_transcript_size);
  pushLengthPrefixed(chunks, decodeBase64Url(result.request_transcript_sha256));
  pushRanges(chunks, result.revealed_request_ranges);
  pushU64(chunks, result.response_transcript_size);
  pushLengthPrefixed(chunks, decodeBase64Url(result.response_transcript_sha256));
  pushRanges(chunks, result.revealed_response_ranges);
  return Buffer.concat(chunks);
}

function parseTiming(response) {
  const encoded = response.headers.get("X-FUSOU-TLSN-Benchmark-Timing");
  return encoded ? JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) : null;
}

async function requestJson(url, options = {}) {
  const startedAt = performance.now();
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!headers.has("User-Agent")) headers.set("User-Agent", "fusou-tlsn-replay-validator/1");
  const response = await fetch(url, { redirect: "error", ...options, headers });
  const body = await response.text();
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  return { response, json, latencyMs: performance.now() - startedAt };
}

function proofMessage(deviceId, session, binding) {
  const chunks = [Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  pushLengthPrefixed(chunks, deviceId);
  pushLengthPrefixed(chunks, session.session_id);
  pushLengthPrefixed(chunks, binding);
  pushLengthPrefixed(chunks, decodeBase64Url(session.device_challenge));
  return Buffer.concat(chunks);
}

async function issueSession(origin, token, deviceId, privateKey) {
  const nonce = randomNonce();
  const response = await requestJson(endpoint(origin, "/attestation/session"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      device_id: deviceId,
      nonce,
      sig: sign(null, Buffer.from(nonce), privateKey).toString("base64url"),
    }),
  });
  assert.equal(response.response.status, 201);
  assert.equal(typeof response.json?.session_id, "string");
  assert.equal(response.json.binding, required("TLSN_REPLAY_BINDING_VALUE"));
  return response.json;
}

function randomNonce() {
  return Buffer.from(cryptoRandomBytes(32)).toString("hex");
}

function cryptoRandomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function verificationBody(session, fixture, deviceId, privateKey) {
  const proof = sign(null, proofMessage(deviceId, session, session.binding), privateKey).toString("base64url");
  return JSON.stringify({
    presentation_base64: fixture.sparse_presentation_base64,
    session_id: session.session_id,
    binding: session.binding,
    device_id: deviceId,
    device_proof: { challenge: session.device_challenge, sig: proof },
  });
}

function verifyCurrentResult(result, fixture, session, deviceId, userId, publicKey) {
  assert.equal(result.version, 1);
  assert.equal(result.canonical_user_id, userId);
  assert.equal(result.device_id, deviceId);
  assert.equal(result.attestation_session_id, session.session_id);
  assert.equal(result.binding_value, fixture.binding_value);
  assert.equal(result.profile_id, "fusou-require-info-v1");
  assert.equal(typeof result.signature, "string");
  assert.equal(verify(null, resultSigningBytes(result), publicKey, decodeBase64Url(result.signature)), true);
  return {
    signature_valid: true,
    canonical_user_id_sha256: hash(result.canonical_user_id),
    device_id_sha256: hash(result.device_id),
    attestation_session_id_sha256: hash(result.attestation_session_id),
    binding_value_sha256: hash(result.binding_value),
    verifier_key_id: result.verifier_key_id,
    notary_key_id: result.notary_key_id,
    profile_sha256: result.profile_sha256,
    server_identity: result.server_identity,
  };
}

async function main() {
  const workerOrigin = required("TLSN_REPLAY_WORKER_URL");
  const token = required("TLSN_REPLAY_ACCESS_TOKEN");
  const deviceId = required("TLSN_REPLAY_DEVICE_ID");
  const privateKey = createPrivateKey({
    key: decodeBase64Url(required("TLSN_REPLAY_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL")),
    format: "der",
    type: "pkcs8",
  });
  const resultPublicKey = createPublicKey({
    key: decodeBase64Url(required("TLSN_REPLAY_RESULT_PUBLIC_KEY_SPKI")),
    format: "der",
    type: "spki",
  });
  const expectedCommit = required("TLSN_GIT_COMMIT_SHA");
  const health = await requestJson(endpoint(workerOrigin, "/health"));
  assert.equal(health.response.status, 200);
  assert.equal(health.json.environment, "test");
  assert.equal(health.json.deployment_role, "replay");
  assert.equal(health.json.binding_mode, "fixed");
  assert.equal(health.json.execution_mode, "direct");
  assert.equal(health.json.auth_mode, "test-token");
  assert.equal(health.json.device_auth_mode, "test-ed25519");
  assert.equal(health.json.git_commit_sha, expectedCommit);
  assert.equal(health.json.deployment_identity.worker_name, "fusou-tlsn-verification-replay");
  assert.equal(health.json.deployment_identity.deployment_role, "replay");
  assert.equal(health.json.deployment_identity.binding_mode, "fixed");

  const { manifest, entries } = readRealFixtureManifest();
  const entry = entries.get("p50") ?? manifest.cases[0];
  const session = await issueSession(workerOrigin, token, deviceId, privateKey);
  const fixture = generateRealFixture(fixtureSourcePath(manifest, entry), session.binding);
  const body = verificationBody(session, fixture, deviceId, privateKey);
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => requestJson(endpoint(workerOrigin, "/verify/tlsn/sparse"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body,
    })),
  );
  const successes = responses.filter((entry) => entry.response.status === 200);
  const conflicts = responses.filter((entry) => entry.response.status === 409);
  assert.equal(successes.length, 1);
  assert.equal(conflicts.length, 7);
  for (const conflict of conflicts) {
    assert.ok(["binding_consumed", "device_possession_replayed"].includes(conflict.json?.error));
  }
  const ordinaryReplay = await requestJson(endpoint(workerOrigin, "/verify/tlsn/sparse"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body,
  });
  assert.equal(ordinaryReplay.response.status, 409);
  assert.equal(ordinaryReplay.json?.error, "binding_consumed");

  const success = successes[0];
  const userId = JSON.parse(required("TLSN_REPLAY_AUTH_USERS"))[token].id;
  const currentResult = verifyCurrentResult(success.json.result, fixture, session, deviceId, userId, resultPublicKey);
  const timing = parseTiming(success.response) ?? {};
  const authorityInvariants = {
    start_verification: Number(timing.do_operations?.start_verification ?? 0),
    acquire_verification: Number(timing.do_operations?.acquire_verification ?? 0),
    commit_verified_result: Number(timing.do_operations?.commit_verified_result ?? 0),
    fresh_binding_lookup: Number(timing.do_operations?.fresh_binding_lookup ?? 0),
    fresh_result_r2_get: Number(timing.r2_operations?.result_get ?? 0) + Number(timing.r2_operations?.status_result_get ?? 0),
    archive_r2_put: Number(timing.r2_operations?.result_archive_put ?? 0),
  };
  assert.equal(authorityInvariants.start_verification, 1);
  assert.equal(authorityInvariants.acquire_verification, 1);
  assert.equal(authorityInvariants.commit_verified_result, 1);
  assert.equal(authorityInvariants.fresh_binding_lookup, 0);
  assert.equal(authorityInvariants.fresh_result_r2_get, 0);
  assert.equal(authorityInvariants.archive_r2_put, 1);

  const report = {
    schema_version: 1,
    scope: "tlsn-replay-evidence-current",
    status: "PASS",
    generated_at: new Date().toISOString(),
    current_head: expectedCommit,
    environment: health.json.environment,
    deployment_role: health.json.deployment_role,
    binding_mode: health.json.binding_mode,
    deployment_id: health.json.deployment_id,
    worker_version_id: optional("TLSN_REPLAY_WORKER_VERSION_ID") ?? null,
    verifier_version_id: optional("TLSN_REPLAY_VERIFIER_VERSION_ID") ?? null,
    git_commit_sha: health.json.git_commit_sha,
    profile_sha256: health.json.profile_sha256,
    sparse_profile_sha256: health.json.sparse_profile_sha256,
    security_registry_set_hash: health.json.security_identity?.security_registry_set_sha256 ?? null,
    ordinary_replay: { status_code: ordinaryReplay.response.status, error: ordinaryReplay.json?.error },
    concurrent_replay: {
      requests: responses.length,
      successful_verifications: successes.length,
      conflict_responses: conflicts.length,
      conflict_codes: [...new Set(conflicts.map((entry) => entry.json?.error))],
    },
    current_result_verification: currentResult,
    authority_invariants: authorityInvariants,
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report_path: reportPath, status: report.status, concurrent_replay: report.concurrent_replay }));
}

main().catch((error) => {
  console.error(`[tlsn-replay-validation] ${error instanceof Error ? error.message : "validation_failed"}`);
  process.exitCode = 1;
});
