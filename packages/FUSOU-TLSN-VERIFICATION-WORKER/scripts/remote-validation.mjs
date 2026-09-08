#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
    if (!replayOrigin || replayOrigin === workerOrigin) {
      blocked(
        checks,
        "remote_concurrent_replay",
        "Set TLSN_REMOTE_REPLAY_WORKER_URL to a separate fixed-binding Worker for the concurrent replay matrix.",
      );
    } else {
      await runCheck(checks, "remote_concurrent_replay", async () => {
        const replayHealth = await timedRequest(endpoint(replayOrigin, "/health"), {});
        assert.equal(replayHealth.status, 200);
        assert.equal(replayHealth.json?.binding_mode, "fixed");
        const replaySession = await issueSession(replayOrigin, webOrigin, deviceA, tokenA);
        assert.equal(replaySession.session.binding, fixture.binding_value);
        const requests = await Promise.all(
          Array.from({ length: 8 }, () => postVerification(
            replayOrigin,
            tokenA,
            verificationBody(replaySession.session, deviceA, fixture),
          )),
        );
        const successes = requests.filter((response) => response.status === 200);
        const conflicts = requests.filter((response) => response.status === 409);
        assert.equal(successes.length, 1);
        assert.equal(conflicts.length, requests.length - 1);
        for (const response of conflicts) {
          assert.ok(["binding_consumed", "device_possession_replayed"].includes(response.json?.error));
        }
        return {
          requests: requests.length,
          successful_verifications: successes.length,
          conflict_responses: conflicts.length,
          conflict_codes: [...new Set(conflicts.map((response) => response.json?.error))],
        };
      });
    }

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { blockedProductionEvidenceContract } from "./production-evidence-contract.mjs";
import {
  assertCheckoutCommit,
  assertProvenanceEvidence,
  workflowContextFromEnvironment,
} from "./deployment-attestation.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_SAMPLE_COUNT = 100;
const DEFAULT_REPORT_PATH = resolve(packageDirectory, "artifacts/tlsn-remote-validation.json");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECURITY_IDENTITY_FIELDS = [
  "git_commit_sha",
  "server_identity",
  "profile_sha256",
  "verifier_key_id",
  "notary_key_id",
  "security_registry_set_sha256",
  "notary_registry_sha256",
  "binding_authority",
];
const DEPLOYMENT_IDENTITY_FIELDS = ["deployment_id", "deployment_role", "binding_mode", "trust_root_certificate_sha256", "worker_name"];
const RESULT_IDENTITY_FIELDS = ["result_public_key_spki"];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parseBoolean(name, fallback = false) {
  const value = optional(name);
  if (!value) return fallback;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  throw new Error(`${name} must be true or false`);
}

async function loadExpectedProvenance() {
  const file = required("TLSN_REMOTE_EXPECTED_PROVENANCE_JSON");
  const parsed = JSON.parse(await readFile(file, "utf8"));
  if (
    parsed?.schema_version !== 2 ||
    parsed?.scope !== "tlsn-deployment-provenance" ||
    parsed?.status !== "PASS" ||
    parsed?.deployment_role !== "canary" ||
    parsed?.environment !== "production"
  ) {
    throw new Error("remote validation requires a production canary provenance manifest");
  }
  for (const [name, fields] of [
    ["security_identity", SECURITY_IDENTITY_FIELDS],
    ["deployment_identity", DEPLOYMENT_IDENTITY_FIELDS],
    ["result_identity", RESULT_IDENTITY_FIELDS],
  ]) {
    for (const field of fields) {
      if (typeof parsed[name]?.[field] !== "string" || parsed[name][field].length === 0) {
        throw new Error(`remote validation provenance is missing ${name}.${field}`);
      }
    }
  }
  return parsed;
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

function requireOrigin(name) {
  const value = required(name);
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.port) {
    throw new Error(`${name} must be a clean origin without credentials, port, query, or fragment`);
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(`${name} must not contain a path`);
  }
  return url.origin;
}

function endpoint(origin, pathname) {
  return new URL(pathname, `${origin}/`).toString();
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url");
}

function sha256Base64Url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

async function loadPrivateKeyAsync(prefix) {
  const file = optional(`${prefix}_PRIVATE_KEY_PKCS8_FILE`);
  const encoded = file
    ? (await readFile(file, "utf8")).trim()
    : required(`${prefix}_PRIVATE_KEY_PKCS8_B64URL`);
  const bytes = Buffer.from(encoded, "base64url");
  return createPrivateKey({ key: bytes, format: "der", type: "pkcs8" });
}

async function loadFixture(file) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  for (const field of [
    "binding_value",
    "presentation_base64",
    "authenticated_request_base64",
    "authenticated_response_base64",
  ]) {
    if (typeof parsed[field] !== "string" || parsed[field].length === 0) {
      throw new Error(`${file} is missing ${field}`);
    }
  }
  return parsed;
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

function signingBytes(result) {
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

function assertFullDisclosure(ranges, transcript) {
  assert.ok(Array.isArray(ranges) && ranges.length > 0);
  let nextStart = 0;
  const disclosed = [];
  for (const range of ranges) {
    const bytes = decodeBase64Url(range.bytes);
    assert.equal(range.start, String(nextStart));
    assert.equal(range.length, String(bytes.length));
    disclosed.push(bytes);
    nextStart += bytes.length;
  }
  assert.equal(nextStart, transcript.length);
  assert.deepEqual(Buffer.concat(disclosed), transcript);
}

function tlsnDeviceProofMessage(deviceId, sessionId, bindingValue, challenge) {
  const chunks = [Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  pushLengthPrefixed(chunks, deviceId);
  pushLengthPrefixed(chunks, sessionId);
  pushLengthPrefixed(chunks, bindingValue);
  pushLengthPrefixed(chunks, decodeBase64Url(challenge));
  return Buffer.concat(chunks);
}

function signDeviceProof(session, privateKey, overrides = {}) {
  const challenge = overrides.challenge ?? session.device_challenge;
  const bindingValue = overrides.bindingValue ?? session.binding;
  const message = tlsnDeviceProofMessage(
    session.device_id,
    session.session_id,
    bindingValue,
    challenge,
  );
  return {
    challenge,
    sig: sign(null, message, privateKey).toString("base64url"),
  };
}

function verifyExternalResult(result, fixture, publicKey, expected) {
  assert.equal(result.version, 1);
  assert.equal(result.profile_id, "fusou-require-info-v1");
  assert.equal(result.canonical_user_id, expected.userId);
  assert.equal(result.device_id, expected.deviceId);
  assert.equal(result.verified_member_id, expected.memberId);
  assert.equal(result.attestation_session_id, expected.sessionId);
  assert.equal(result.binding_value, fixture.binding_value);
  assert.equal(typeof result.device_challenge, "string");
  assert.equal(typeof result.binding_nonce, "string");
  assert.equal(typeof result.tlsn_attestation_id, "string");
  assert.equal(typeof result.verifier_key_id, "string");
  assert.equal(typeof result.notary_key_id, "string");
  assert.equal(typeof result.signature, "string");
  if (expected.profileSha256) assert.equal(result.profile_sha256, expected.profileSha256);
  if (expected.serverIdentity) assert.equal(result.server_identity, expected.serverIdentity);
  if (expected.verifierKeyId) assert.equal(result.verifier_key_id, expected.verifierKeyId);
  if (expected.notaryKeyId) assert.equal(result.notary_key_id, expected.notaryKeyId);

  const requestBytes = decodeBase64Url(fixture.authenticated_request_base64);
  const responseBytes = decodeBase64Url(fixture.authenticated_response_base64);
  assert.equal(result.request_transcript_size, String(requestBytes.length));
  assert.equal(result.response_transcript_size, String(responseBytes.length));
  assert.equal(result.request_transcript_sha256, sha256Base64Url(requestBytes));
  assert.equal(result.response_transcript_sha256, sha256Base64Url(responseBytes));
  assertFullDisclosure(result.revealed_request_ranges, requestBytes);
  assertFullDisclosure(result.revealed_response_ranges, responseBytes);

  const signature = decodeBase64Url(result.signature);
  assert.equal(signature.length, 64);
  assert.equal(verify(null, signingBytes(result), publicKey, signature), true);
  return {
    canonical_user_id_sha256: sha256Base64Url(result.canonical_user_id),
    device_id_sha256: sha256Base64Url(result.device_id),
    verified_member_id_sha256: sha256Base64Url(result.verified_member_id),
    attestation_session_id_sha256: sha256Base64Url(result.attestation_session_id),
    binding_nonce_sha256: sha256Base64Url(result.binding_nonce),
    binding_value_sha256: sha256Base64Url(result.binding_value),
    device_challenge_sha256: sha256Base64Url(result.device_challenge),
    tlsn_attestation_id_sha256: sha256Base64Url(result.tlsn_attestation_id),
    notary_key_id: result.notary_key_id,
    verifier_key_id: result.verifier_key_id,
    signature_valid: true,
  };
}

function changedString(value) {
  return `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;
}

function assertSignedResultMutations(result, publicKey) {
  const mutations = {
    canonical_user_id: "22222222-2222-4222-8222-222222222222",
    device_id: "44444444-4444-4444-8444-444444444444",
    verified_member_id: result.verified_member_id === "16189463" ? "16189464" : "0",
    attestation_session_id: "123e4567-e89b-42d3-a456-426614174001",
    binding_nonce: changedString(result.binding_nonce),
    binding_value: changedString(result.binding_value),
    device_challenge: changedString(result.device_challenge),
    tlsn_attestation_id: changedString(result.tlsn_attestation_id),
    profile_sha256: changedString(result.profile_sha256),
    server_identity: result.server_identity === "mutated.example.com" ? "other.example.com" : "mutated.example.com",
    verifier_key_id: result.verifier_key_id === "mutated-verifier" ? "other-verifier" : "mutated-verifier",
    notary_key_id: result.notary_key_id === "mutated-notary" ? "other-notary" : "mutated-notary",
    request_transcript_sha256: changedString(result.request_transcript_sha256),
    response_transcript_sha256: changedString(result.response_transcript_sha256),
  };
  const signature = decodeBase64Url(result.signature);
  for (const [field, value] of Object.entries(mutations)) {
    const mutated = { ...result, [field]: value };
    assert.equal(
      verify(null, signingBytes(mutated), publicKey, signature),
      false,
      `signature mutation unexpectedly verified: ${field}`,
    );
  }
  return { fields: Object.keys(mutations), all_invalid: true };
}

async function timedRequest(url, options) {
  const started = performance.now();
  const response = await fetch(url, { redirect: "error", ...options });
  const bytes = Buffer.from(await response.arrayBuffer());
  const latencyMs = performance.now() - started;
  let json;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    json = undefined;
  }
  return {
    status: response.status,
    latencyMs,
    bodyBytes: bytes.length,
    json,
    requestId: response.headers.get("x-request-id") ?? response.headers.get("cf-ray") ?? null,
  };
}

async function supabaseUser(supabaseOrigin, publishableKey, accessToken) {
  const response = await timedRequest(`${supabaseOrigin}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  assert.equal(response.status, 200);
  assert.equal(typeof response.json?.id, "string");
  assert.equal(response.json.is_anonymous, false);
  return { id: response.json.id, measurement: response };
}

async function issueSession(workerOrigin, webOrigin, device, token) {
  const challenge = await timedRequest(
    endpoint(webOrigin, `/api/auth/anonymous-sync/v2/challenge?device_id=${encodeURIComponent(device.id)}`),
    {},
  );
  assert.equal(challenge.status, 200);
  assert.equal(typeof challenge.json?.nonce, "string");
  const nonce = challenge.json.nonce;
  const nonceSignature = sign(null, Buffer.from(nonce), device.privateKey).toString("base64url");
  const response = await timedRequest(endpoint(workerOrigin, "/attestation/session"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ device_id: device.id, nonce, sig: nonceSignature }),
  });
  assert.equal(response.status, 201);
  assert.ok(UUID_PATTERN.test(response.json.session_id));
  assert.ok(UUID_PATTERN.test(response.json.device_id));
  assert.ok(typeof response.json.binding === "string");
  assert.ok(typeof response.json.challenge === "string");
  assert.ok(typeof response.json.device_challenge === "string");
  return { session: response.json, challenge, response };
}

function verificationBody(session, device, fixture, overrides = {}) {
  const proof = signDeviceProof(session, device.privateKey, overrides.deviceProof);
  return JSON.stringify({
    presentation_base64: overrides.presentation ?? fixture.presentation_base64,
    session_id: overrides.sessionId ?? session.session_id,
    binding: overrides.binding ?? session.binding,
    device_id: overrides.deviceId ?? session.device_id,
    device_proof: proof,
  });
}

async function postVerification(workerOrigin, token, body, options = {}) {
  return timedRequest(endpoint(workerOrigin, "/verify/tlsn"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
    ...options,
  });
}

function pQuantile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function summarizeMeasurements(measurements) {
  const values = measurements.map((entry) => entry.latencyMs).filter(Number.isFinite);
  return {
    count: values.length,
    p50_ms: pQuantile(values, 0.5),
    p95_ms: pQuantile(values, 0.95),
    p99_ms: pQuantile(values, 0.99),
    min_ms: values.length ? Math.min(...values) : null,
    max_ms: values.length ? Math.max(...values) : null,
    body_bytes_p50: pQuantile(measurements.map((entry) => entry.bodyBytes), 0.5),
  };
}

async function runCheck(checks, name, action) {
  try {
    const value = await action();
    checks[name] = { status: "PASS", ...(value ?? {}) };
    return value;
  } catch (error) {
    checks[name] = {
      status: "FAIL",
      error: error instanceof assert.AssertionError ? "assertion_failed" : "request_failed",
    };
    return undefined;
  }
}

function blocked(checks, name, reason) {
  checks[name] = { status: "BLOCKED", reason };
}

async function scanLogExport(checks, secrets) {
  const file = optional("TLSN_REMOTE_LOG_EXPORT");
  if (!file) {
    blocked(checks, "secret_leakage", "Set TLSN_REMOTE_LOG_EXPORT to a sanitized Cloudflare log export.");
    return;
  }
  const log = await readFile(file, "utf8");
  const forbidden = secrets.filter((secret) => typeof secret === "string" && secret.length > 0);
  const leaked = forbidden.filter((secret) => log.includes(secret));
  checks.secret_leakage = leaked.length === 0
    ? { status: "PASS", scanned_bytes: Buffer.byteLength(log) }
    : { status: "FAIL", reason: "configured secret material appeared in the log export" };
}

async function main() {
  const workflowContext = workflowContextFromEnvironment(process.env, "canary");
  assertCheckoutCommit(workflowContext, packageDirectory);
  const expectedProvenance = await loadExpectedProvenance();
  assertProvenanceEvidence(expectedProvenance, workflowContext, "canary");
  const workerOrigin = requireOrigin("TLSN_REMOTE_WORKER_URL");
  const benchmarkOrigin = optional("TLSN_REMOTE_SESSION_BENCHMARK_URL")
    ? requireOrigin("TLSN_REMOTE_SESSION_BENCHMARK_URL")
    : undefined;
  const revocationOrigin = optional("TLSN_REMOTE_REVOCATION_WORKER_URL")
    ? requireOrigin("TLSN_REMOTE_REVOCATION_WORKER_URL")
    : undefined;
  const expiryOrigin = optional("TLSN_REMOTE_EXPIRY_WORKER_URL")
    ? requireOrigin("TLSN_REMOTE_EXPIRY_WORKER_URL")
    : undefined;
  const replayOrigin = optional("TLSN_REMOTE_REPLAY_WORKER_URL")
    ? requireOrigin("TLSN_REMOTE_REPLAY_WORKER_URL")
    : undefined;
  const warmOrigin = optional("TLSN_REMOTE_WARM_WORKER_URL")
    ? requireOrigin("TLSN_REMOTE_WARM_WORKER_URL")
    : undefined;
  const webOrigin = requireOrigin("TLSN_REMOTE_WEB_ORIGIN");
  const supabaseOrigin = requireOrigin("TLSN_REMOTE_SUPABASE_URL");
  const publishableKey = required("TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY");
  const tokenA = required("TLSN_REMOTE_ACCESS_TOKEN_A");
  const tokenB = optional("TLSN_REMOTE_ACCESS_TOKEN_B");
  const deviceA = {
    id: required("TLSN_REMOTE_DEVICE_ID_A"),
    privateKey: await loadPrivateKeyAsync("TLSN_REMOTE_DEVICE_A"),
  };
  const deviceB = tokenB && optional("TLSN_REMOTE_DEVICE_ID_B")
    ? {
        id: required("TLSN_REMOTE_DEVICE_ID_B"),
        privateKey: await loadPrivateKeyAsync("TLSN_REMOTE_DEVICE_B"),
      }
    : undefined;
  const fixture = await loadFixture(required("TLSN_REMOTE_FIXTURE_JSON"));
  const fixtureB = await loadOptionalFixture("TLSN_REMOTE_FIXTURE_B_JSON");
  const sampleCount = parseInteger(
    "TLSN_REMOTE_SESSION_SAMPLES",
    DEFAULT_SAMPLE_COUNT,
    DEFAULT_SAMPLE_COUNT,
    10_000,
  );
  const checks = {};
  const metrics = {};
  const validationStartedAt = new Date().toISOString();
  const report = {
    schema_version: 2,
    generated_at: validationStartedAt,
    created_at: validationStartedAt,
    validation_started_at: validationStartedAt,
    validation_finished_at: null,
    validation_id: randomUUID(),
    ...workflowContext,
    scope: "remote-deployed-synthetic",
    worker_origin: workerOrigin,
    benchmark_origin: benchmarkOrigin ?? null,
    replay_origin: replayOrigin ?? null,
    warm_origin: warmOrigin ?? null,
    web_origin: webOrigin,
    checks,
    metrics,
    evidence: {
      domain: "synthetic",
      real_game_server: false,
      production_trust_material: false,
      raw_presentation_retained: false,
      raw_transcript_retained: false,
    },
    production_evidence: "BLOCKED",
    p0_05: "BLOCKED",
    production_evidence_contract: blockedProductionEvidenceContract(),
    security_identity: null,
    deployment_identity: null,
    result_identity: null,
  };
  blocked(
    checks,
    "production_evidence",
    "Synthetic validation does not establish production trust material or real Game Server evidence.",
  );
  blocked(
    checks,
    "p0_05",
    "P0-05 remains blocked until production trust material and real Game Server evidence are independently recorded.",
  );

  const health = await runCheck(checks, "remote_worker_identity", async () => {
    const response = await timedRequest(endpoint(workerOrigin, "/health"), {});
    assert.equal(response.status, 200);
    assert.equal(response.json?.ok, true);
    assert.equal(response.json?.verifier, "tlsn-alpha15-wasm");
    assert.equal(response.json?.environment, expectedProvenance.environment);
    assert.equal(response.json?.deployment_role, expectedProvenance.deployment_role);
    assert.deepEqual(response.json?.security_identity, expectedProvenance.security_identity);
    assert.deepEqual(response.json?.deployment_identity, expectedProvenance.deployment_identity);
    assert.deepEqual(response.json?.result_identity, expectedProvenance.result_identity);
    for (const [envName, field] of [
      ["TLSN_REMOTE_EXPECTED_ENVIRONMENT", "environment"],
      ["TLSN_REMOTE_EXPECTED_DEPLOYMENT_ID", "deployment_id"],
      ["TLSN_REMOTE_EXPECTED_VERIFIER_KEY_ID", "verifier_key_id"],
      ["TLSN_REMOTE_EXPECTED_PROFILE_SHA256", "profile_sha256"],
      ["TLSN_REMOTE_EXPECTED_BINDING_MODE", "binding_mode"],
    ]) {
      const expected = optional(envName);
      if (expected) assert.equal(response.json.deployment_identity[field] ?? response.json.security_identity[field], expected);
    }
    const expectedPublicKey = optional("TLSN_REMOTE_RESULT_PUBLIC_KEY_SPKI");
    if (expectedPublicKey) {
      assert.equal(expectedPublicKey, expectedProvenance.result_identity.result_public_key_spki);
      assert.equal(response.json.result_identity.result_public_key_spki, expectedPublicKey);
    }
    const expectedPublicKeyHash = optional("TLSN_REMOTE_EXPECTED_RESULT_PUBLIC_KEY_SHA256");
    if (expectedPublicKeyHash) {
      assert.equal(sha256Base64Url(response.json.result_identity.result_public_key_spki ?? ""), expectedPublicKeyHash);
    }
    const registryJson = optional("TLSN_REMOTE_RESULT_KEY_REGISTRY_JSON");
    if (registryJson) {
      const registry = JSON.parse(registryJson);
      assert.equal(typeof registry, "object");
      const hashes = Object.values(registry);
      assert.equal(new Set(hashes).size, hashes.length);
      assert.equal(registry[response.json.security_identity.verifier_key_id], sha256Base64Url(response.json.result_identity.result_public_key_spki));
    }
    return {
      security_identity: response.json.security_identity,
      deployment_identity: response.json.deployment_identity,
      result_identity: response.json.result_identity,
      latency_ms: response.latencyMs,
      body_bytes: response.bodyBytes,
    };
  });
  if (health) {
    report.security_identity = health.security_identity;
    report.deployment_identity = health.deployment_identity;
    report.result_identity = health.result_identity;
  }

  let authenticatedUserAId;
  const userA = await runCheck(checks, "remote_supabase_authentication", async () => {
    const resultA = await supabaseUser(supabaseOrigin, publishableKey, tokenA);
    authenticatedUserAId = resultA.id;
    const resultB = tokenB
      ? await supabaseUser(supabaseOrigin, publishableKey, tokenB)
      : undefined;
    metrics.supabase_authentication = summarizeMeasurements(
      [resultA.measurement, resultB?.measurement].filter(Boolean),
    );
    return {
      user_a_sha256: sha256Base64Url(resultA.id),
      user_b_sha256: resultB ? sha256Base64Url(resultB.id) : null,
      samples: resultB ? 2 : 1,
    };
  });

  if (!benchmarkOrigin || benchmarkOrigin === workerOrigin) {
    blocked(
      checks,
      "session_sampling",
      "Set TLSN_REMOTE_SESSION_BENCHMARK_URL to a separate Worker with random bindings; the verify Worker may use one fixed synthetic binding.",
    );
  } else {
    await runCheck(checks, "session_sampling", async () => {
      const benchmarkHealth = await timedRequest(endpoint(benchmarkOrigin, "/health"), {});
      assert.equal(benchmarkHealth.status, 200);
      assert.equal(benchmarkHealth.json?.binding_mode, "random");
      const sessionMeasurements = [];
      const sessionIds = new Set();
      const bindingValues = new Set();
      const deviceChallenges = new Set();
      for (let index = 0; index < sampleCount; index++) {
        try {
          const result = await issueSession(benchmarkOrigin, webOrigin, deviceA, tokenA);
          sessionMeasurements.push(result.response);
          sessionIds.add(result.session.session_id);
          bindingValues.add(result.session.binding);
          deviceChallenges.add(result.session.device_challenge);
        } catch (error) {
          sessionMeasurements.push({
            latencyMs: 0,
            bodyBytes: 0,
            status: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      metrics.attestation_session = summarizeMeasurements(sessionMeasurements);
      const successfulSessionCount = sessionMeasurements.filter((entry) => entry.status === 201).length;
      assert.equal(successfulSessionCount, sampleCount);
      assert.equal(sessionIds.size, sampleCount);
      assert.equal(bindingValues.size, sampleCount);
      assert.equal(deviceChallenges.size, sampleCount);
      return {
        samples: sampleCount,
        successful_samples: successfulSessionCount,
        unique_session_ids: sessionIds.size,
        unique_binding_values: bindingValues.size,
        unique_device_challenges: deviceChallenges.size,
        binding_mode: benchmarkHealth.json.binding_mode,
      };
    });
  }

  const wasmBenchmarkOrigin = warmOrigin ?? benchmarkOrigin;
  if (!wasmBenchmarkOrigin || wasmBenchmarkOrigin === workerOrigin) {
    blocked(
      checks,
      "remote_wasm_cold_warm",
      "Set TLSN_REMOTE_SESSION_BENCHMARK_URL or TLSN_REMOTE_WARM_WORKER_URL to a separate random-binding Worker.",
    );
  } else {
    await runCheck(checks, "remote_wasm_cold_warm", async () => {
      const benchmarkHealth = await timedRequest(endpoint(wasmBenchmarkOrigin, "/health"), {});
      assert.equal(benchmarkHealth.status, 200);
      assert.equal(benchmarkHealth.json?.binding_mode, "random");
      const coldSession = await issueSession(wasmBenchmarkOrigin, webOrigin, deviceA, tokenA);
      const cold = await postVerification(
        wasmBenchmarkOrigin,
        tokenA,
        verificationBody(coldSession.session, deviceA, fixture),
      );
      assert.equal(cold.status, 422);
      assert.equal(cold.json?.error, "binding_mismatch");
      const warmMeasurements = [];
      for (let index = 0; index < sampleCount; index++) {
        const session = await issueSession(wasmBenchmarkOrigin, webOrigin, deviceA, tokenA);
        const response = await postVerification(
          wasmBenchmarkOrigin,
          tokenA,
          verificationBody(session.session, deviceA, fixture),
        );
        assert.equal(response.status, 422);
        assert.equal(response.json?.error, "binding_mismatch");
        warmMeasurements.push(response);
      }
      metrics.tlsn_wasm = {
        cold: summarizeMeasurements([cold]),
        warm: summarizeMeasurements(warmMeasurements),
        valid_verification_samples: 0,
        binding_mismatch_wasm_samples: warmMeasurements.length + 1,
      };
      return {
        cold_status: cold.status,
        warm_samples: warmMeasurements.length,
        warm_status: 422,
        measurement_kind: "binding_mismatch_after_wasm",
      };
    });
  }

  let verificationSession;
  await runCheck(checks, "remote_device_auth_and_session", async () => {
    const result = await issueSession(workerOrigin, webOrigin, deviceA, tokenA);
    assert.equal(result.session.binding, fixture.binding_value);
    verificationSession = result.session;
    return {
      session_id_sha256: sha256Base64Url(verificationSession.session_id),
      device_id_sha256: sha256Base64Url(verificationSession.device_id),
      expires_at: verificationSession.expires_at,
      response_body_bytes: result.response.bodyBytes,
      latency_ms: result.response.latencyMs,
    };
  });

  if (verificationSession) {
    if (fixtureB) {
      await runCheck(checks, "remote_context_swapping", async () => {
        assert.notEqual(fixtureB.binding_value, fixture.binding_value);
        const response = await postVerification(
          workerOrigin,
          tokenA,
          verificationBody(verificationSession, deviceA, fixtureB),
        );
        assert.equal(response.status, 422);
        assert.equal(response.json?.verified, false);
        assert.ok(["binding_mismatch", "verification_failed"].includes(response.json?.error));
        return { status_code: response.status, failure_code: response.json.error };
      });
    } else {
      blocked(checks, "remote_context_swapping", "Set TLSN_REMOTE_FIXTURE_B_JSON with a different binding value for the presentation swap case.");
    }

    if (tokenB && deviceB) {
      await runCheck(checks, "remote_cross_user_attacks", async () => {
        const caseB = await postVerification(
          workerOrigin,
          tokenB,
          verificationBody(verificationSession, deviceA, fixture),
        );
        assert.equal(caseB.status, 409);
        assert.equal(caseB.json?.error, "user_mismatch");
        const caseC = await postVerification(
          workerOrigin,
          tokenA,
          verificationBody(verificationSession, deviceB, fixture, { deviceId: deviceB.id }),
        );
        assert.equal(caseC.status, 409);
        assert.equal(caseC.json?.error, "device_mismatch");
        const caseF = await postVerification(
          workerOrigin,
          tokenB,
          verificationBody(verificationSession, deviceB, fixture, { deviceId: deviceB.id }),
        );
        assert.equal(caseF.status, 409);
        assert.equal(caseF.json?.error, "user_mismatch");
        const sessionSwap = await postVerification(
          workerOrigin,
          tokenA,
          verificationBody(verificationSession, deviceA, fixture, {
            sessionId: "123e4567-e89b-42d3-a456-426614174001",
          }),
        );
        assert.equal(sessionSwap.status, 409);
        assert.equal(sessionSwap.json?.error, "session_mismatch");
        const bindingSwap = await postVerification(
          workerOrigin,
          tokenA,
          verificationBody(verificationSession, deviceA, fixture, { binding: "AQ" }),
        );
        assert.equal(bindingSwap.status, 422);
        assert.equal(bindingSwap.json?.error, "binding_unknown");
        const presentationSwap = fixtureB
          ? await postVerification(
              workerOrigin,
              tokenA,
              verificationBody(verificationSession, deviceA, fixtureB),
            )
          : null;
        if (presentationSwap) {
          assert.equal(presentationSwap.status, 422);
          assert.ok(["binding_mismatch", "verification_failed"].includes(presentationSwap.json?.error));
        }
        return {
          case_b: { status_code: caseB.status, failure_code: caseB.json.error },
          case_c: { status_code: caseC.status, failure_code: caseC.json.error },
          case_f: { status_code: caseF.status, failure_code: caseF.json.error },
          session_swap: { status_code: sessionSwap.status, failure_code: sessionSwap.json.error },
          binding_swap: { status_code: bindingSwap.status, failure_code: bindingSwap.json.error },
          presentation_swap: presentationSwap
            ? { status_code: presentationSwap.status, failure_code: presentationSwap.json.error }
            : null,
        };
      });
    } else {
      blocked(checks, "remote_cross_user_attacks", "Set User B token, device ID, and private key to run cross-user and context matrix cases.");
    }

    await runCheck(checks, "remote_payload_resource_validation", async () => {
      const malformed = await postVerification(
        workerOrigin,
        tokenA,
        verificationBody(verificationSession, deviceA, fixture, { presentation: "AQ+" }),
      );
      assert.equal(malformed.status, 400);
      const nonCanonical = await postVerification(
        workerOrigin,
        tokenA,
        verificationBody(verificationSession, deviceA, fixture, { presentation: "AB" }),
      );
      assert.equal(nonCanonical.status, 400);
      const maxValidPresentation = Buffer.alloc(8 * 1024 * 1024).toString("base64url");
      const maxValid = await postVerification(
        workerOrigin,
        tokenA,
        verificationBody(verificationSession, deviceA, fixture, { presentation: maxValidPresentation }),
      );
      assert.equal(maxValid.status, 422);
      const oversizedPresentation = await postVerification(
        workerOrigin,
        tokenA,
        verificationBody(verificationSession, deviceA, fixture, { presentation: "A".repeat(11 * 1024 * 1024) }),
      );
      assert.equal(oversizedPresentation.status, 400);
      const oversizedJson = await postVerification(
        workerOrigin,
        tokenA,
        `${verificationBody(verificationSession, deviceA, fixture)}${" ".repeat(13 * 1024 * 1024)}`,
      );
      assert.equal(oversizedJson.status, 400);
      const fragmentedBody = verificationBody(verificationSession, deviceA, fixture, { presentation: "AQ" });
      const fragmented = await postVerification(
        workerOrigin,
        tokenA,
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(fragmentedBody.slice(0, 17)));
            controller.enqueue(new TextEncoder().encode(fragmentedBody.slice(17)));
            controller.close();
          },
        }),
        { duplex: "half" },
      );
      assert.equal(fragmented.status, 422);
      return {
        malformed_base64: malformed.status,
        non_canonical_base64: nonCanonical.status,
        max_valid_presentation: maxValid.status,
        oversized_presentation: oversizedPresentation.status,
        oversized_json: oversizedJson.status,
        fragmented_body: fragmented.status,
      };
    });

    let verifiedResult;
    let verifiedPublicKey;
    if (userA) {
      await runCheck(checks, "remote_signed_result_verification", async () => {
        const response = await postVerification(
          workerOrigin,
          tokenA,
          verificationBody(verificationSession, deviceA, fixture),
        );
        assert.equal(response.status, 200);
        assert.equal(response.json?.verified, true);
        const publicKeyEncoded = optional("TLSN_REMOTE_RESULT_PUBLIC_KEY_SPKI")
          ?? expectedProvenance.result_identity.result_public_key_spki;
        assert.ok(publicKeyEncoded, "external result public key is required");
        const publicKey = createPublicKey({
          key: Buffer.from(publicKeyEncoded, "base64url"),
          format: "der",
          type: "spki",
        });
        verifiedResult = response.json.result;
        verifiedPublicKey = publicKey;
        const expectedMemberId = optional("TLSN_REMOTE_EXPECTED_MEMBER_ID")
          ?? fixture.expected_member_id;
        assert.ok(typeof expectedMemberId === "string" && expectedMemberId.length > 0);
        const fields = verifyExternalResult(response.json.result, fixture, publicKey, {
          userId: authenticatedUserAId,
          deviceId: deviceA.id,
          memberId: expectedMemberId,
          sessionId: verificationSession.session_id,
          profileSha256: optional("TLSN_REMOTE_EXPECTED_PROFILE_SHA256"),
          serverIdentity: optional("TLSN_REMOTE_EXPECTED_SERVER_IDENTITY"),
          verifierKeyId: optional("TLSN_REMOTE_EXPECTED_VERIFIER_KEY_ID"),
          notaryKeyId: optional("TLSN_REMOTE_EXPECTED_NOTARY_KEY_ID"),
        });
        metrics.verify_tlsn = {
          count: 1,
          p50_ms: response.latencyMs,
          p95_ms: response.latencyMs,
          p99_ms: response.latencyMs,
          body_bytes: response.bodyBytes,
        };
        return { ...fields, request_id: response.requestId, latency_ms: response.latencyMs };
      });
    } else {
      blocked(checks, "remote_signed_result_verification", "Supabase authentication did not produce User A.");
    }

    if (verifiedResult && verifiedPublicKey) {
      await runCheck(checks, "remote_signed_result_mutations", async () => (
        assertSignedResultMutations(verifiedResult, verifiedPublicKey)
      ));
    } else {
      blocked(checks, "remote_signed_result_mutations", "A valid externally verified result is required before mutation checks.");
    }

    await runCheck(checks, "remote_tlsn_binding_replay", async () => {
      const response = await postVerification(
        workerOrigin,
        tokenA,
        verificationBody(verificationSession, deviceA, fixture),
      );
      assert.equal(response.status, 409);
      assert.equal(response.json?.error, "binding_consumed");
      return { status_code: response.status, failure_code: response.json.error };
    });
  } else {
    blocked(checks, "remote_context_swapping", "Requires a remotely issued session.");
    blocked(checks, "remote_cross_user_attacks", "Requires a remotely issued session.");
    blocked(checks, "remote_payload_resource_validation", "Requires a remotely issued session.");
    blocked(checks, "remote_concurrent_replay", "Requires a remotely issued session.");
    blocked(checks, "remote_signed_result_verification", "A remote session matching the fixture binding was not issued.");
  }

  if (parseBoolean("TLSN_REMOTE_RUN_REVOCATION") && (!revocationOrigin || revocationOrigin === workerOrigin)) {
    blocked(checks, "remote_verify_time_revocation", "Set TLSN_REMOTE_REVOCATION_WORKER_URL to a separate Worker; this permanently revokes the test device.");
  } else if (parseBoolean("TLSN_REMOTE_RUN_REVOCATION")) {
    await runCheck(checks, "remote_verify_time_revocation", async () => {
      assert.ok(revocationOrigin, "set TLSN_REMOTE_REVOCATION_WORKER_URL");
      const revocationSession = await issueSession(revocationOrigin, webOrigin, deviceA, tokenA);
      assert.equal(revocationSession.session.binding, fixture.binding_value);
      const revoke = await timedRequest(
        endpoint(webOrigin, `/api/auth/anonymous-sync/v2/devices/${encodeURIComponent(deviceA.id)}`),
        { method: "DELETE", headers: { Authorization: `Bearer ${tokenA}` } },
      );
      assert.equal(revoke.status, 204);
      const response = await postVerification(
        revocationOrigin,
        tokenA,
        verificationBody(revocationSession.session, deviceA, fixture),
      );
      assert.equal(response.status, 409);
      assert.equal(response.json?.error, "device_possession_revoked");
      return { status_code: response.status, failure_code: response.json?.error ?? null };
    });
  } else {
    blocked(checks, "remote_verify_time_revocation", "Set TLSN_REMOTE_RUN_REVOCATION=true with a separate revocation Worker; this permanently revokes the test device.");
  }

  const expiryDevice = parseBoolean("TLSN_REMOTE_RUN_REVOCATION") && deviceB ? deviceB : deviceA;
  const expiryToken = parseBoolean("TLSN_REMOTE_RUN_REVOCATION") && tokenB ? tokenB : tokenA;
  if (parseBoolean("TLSN_REMOTE_RUN_EXPIRY") && (
    !expiryOrigin ||
    expiryOrigin === workerOrigin ||
    (parseBoolean("TLSN_REMOTE_RUN_REVOCATION") && (!deviceB || !tokenB))
  )) {
    blocked(checks, "remote_session_expiry", "Set a separate short-TTL expiry Worker and an unrevoked User B device when revocation also runs.");
  } else if (parseBoolean("TLSN_REMOTE_RUN_EXPIRY")) {
    await runCheck(checks, "remote_session_expiry", async () => {
      assert.ok(expiryOrigin, "set TLSN_REMOTE_EXPIRY_WORKER_URL");
      const expirySession = await issueSession(expiryOrigin, webOrigin, expiryDevice, expiryToken);
      assert.equal(expirySession.session.binding, fixture.binding_value);
      const waitMs = Math.max(0, Date.parse(expirySession.session.expires_at) - Date.now() + 250);
      await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
      const response = await postVerification(
        expiryOrigin,
        expiryToken,
        verificationBody(expirySession.session, expiryDevice, fixture),
      );
      assert.equal(response.status, 410);
      assert.equal(response.json?.error, "binding_expired");
      return { status_code: response.status, failure_code: response.json.error, waited_ms: waitMs };
    });
  } else {
    blocked(checks, "remote_session_expiry", "Set TLSN_REMOTE_RUN_EXPIRY=true with a separate short-TTL expiry Worker.");
  }

  const privateKeySecrets = [
    deviceA.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    deviceB?.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  ];
  await scanLogExport(checks, [
    tokenA,
    tokenB,
    fixture.presentation_base64,
    fixture.authenticated_request_base64,
    fixture.authenticated_response_base64,
    fixtureB?.presentation_base64,
    fixtureB?.authenticated_request_base64,
    fixtureB?.authenticated_response_base64,
    ...privateKeySecrets,
  ]);

  const statusValues = Object.values(checks).map((entry) => entry.status);
  report.summary = {
    pass: statusValues.filter((status) => status === "PASS").length,
    fail: statusValues.filter((status) => status === "FAIL").length,
    blocked: statusValues.filter((status) => status === "BLOCKED").length,
  };
  report.validation_finished_at = new Date().toISOString();
  const blockingBlockedCount = Object.entries(checks).filter(([name, entry]) => (
    entry.status === "BLOCKED" &&
    !new Set(["production_evidence", "p0_05"]).has(name)
  )).length;
  report.summary.blocking_blocked = blockingBlockedCount;
  const reportPath = optional("TLSN_REMOTE_REPORT_PATH") ?? DEFAULT_REPORT_PATH;
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report_path: reportPath, summary: report.summary }));
  if (report.summary.fail > 0) process.exitCode = 1;
  if (blockingBlockedCount > 0 && process.exitCode === undefined) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`[tlsn-remote-validation] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
