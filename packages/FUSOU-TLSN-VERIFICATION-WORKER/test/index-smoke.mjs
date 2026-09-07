import assert from "node:assert/strict";
import { createHash, createPublicKey, sign as signSignature, verify as verifySignature } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url");
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

function assertFullDisclosure(ranges, transcript) {
  assert.ok(ranges.length > 0);
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

async function issueSession(fetch, expectedBinding, accessToken = "test-token-a") {
  const response = await fetch("https://verify.test/attestation/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      device_id: "33333333-3333-4333-8333-333333333333",
      nonce: "a".repeat(64),
      sig: "synthetic-device-signature",
    }),
  });
  assert.equal(response.status, 201);
  const session = await response.json();
  assert.equal(session.binding, expectedBinding);
  assert.equal(session.device_id, "33333333-3333-4333-8333-333333333333");
  assert.match(session.session_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(session.challenge, /^[A-Za-z0-9_-]+$/);
  assert.match(session.device_challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.match(session.expires_at, /^20[0-9]{2}-/);
  return session;
}

function tlsnDeviceProofMessage(deviceId, sessionId, bindingValue, challenge) {
  const chunks = [Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  pushLengthPrefixed(chunks, deviceId);
  pushLengthPrefixed(chunks, sessionId);
  pushLengthPrefixed(chunks, bindingValue);
  pushLengthPrefixed(chunks, decodeBase64Url(challenge));
  return Buffer.concat(chunks);
}

function createDeviceProof(session, privateKey, overrides = {}) {
  const challenge = overrides.challenge ?? session.device_challenge;
  const bindingValue = overrides.bindingValue ?? session.binding;
  const signature = signSignature(
    null,
    tlsnDeviceProofMessage(session.device_id, session.session_id, bindingValue, challenge),
    privateKey,
  ).toString("base64url");
  return { challenge, sig: overrides.sig ?? signature };
}

function verificationBody(presentationBase64, session, privateKey, extra = {}) {
  return JSON.stringify({
    presentation_base64: presentationBase64,
    session_id: session.session_id,
    binding: session.binding,
    device_id: session.device_id,
    device_proof: createDeviceProof(session, privateKey),
    ...extra,
  });
}

async function postVerification(fetch, body, accessToken = "test-token-a") {
  return fetch("https://verify.test/verify/tlsn", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body,
  });
}

export async function runSmokeTest(fetch, fixture, publicKeyDerBase64url, devicePrivateKey) {
  const healthResponse = await fetch("https://verify.test/health");
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    verifier: "tlsn-alpha15-wasm",
  });

  const session = await issueSession(fetch, fixture.binding_value);
  const extraMemberIdResponse = await postVerification(
    fetch,
    verificationBody(fixture.presentation_base64, session, devicePrivateKey, { member_id: "16189463" }),
  );
  assert.equal(extraMemberIdResponse.status, 400);
  assert.deepEqual(await extraMemberIdResponse.json(), { error: "invalid_request" });

  const invalidPresentationResponse = await postVerification(
    fetch,
    verificationBody("AQ", session, devicePrivateKey),
  );
  assert.equal(invalidPresentationResponse.status, 422);
  assert.deepEqual(await invalidPresentationResponse.json(), {
    verified: false,
    error: "verification_failed",
  });

  const fixturePath = fileURLToPath(
    new URL(
      "../../FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-upstream-presentation.bin",
      import.meta.url,
    ),
  );
  const upstreamFixture = await readFile(fixturePath);
  const upstreamResponse = await postVerification(
    fetch,
    verificationBody(base64Url(upstreamFixture), session, devicePrivateKey),
  );
  assert.equal(upstreamResponse.status, 422);
  assert.deepEqual(await upstreamResponse.json(), {
    verified: false,
    error: "verification_failed",
  });

  const tamperedPresentation = decodeBase64Url(fixture.presentation_base64);
  tamperedPresentation[Math.floor(tamperedPresentation.length / 2)] ^= 1;
  const tamperedResponse = await postVerification(
    fetch,
    verificationBody(base64Url(tamperedPresentation), session, devicePrivateKey),
  );
  assert.equal(tamperedResponse.status, 422);
  assert.deepEqual(await tamperedResponse.json(), {
    verified: false,
    error: "verification_failed",
  });

  const invalidDeviceProofResponse = await postVerification(
    fetch,
    verificationBody(fixture.presentation_base64, session, devicePrivateKey, {
      device_proof: { challenge: session.device_challenge, sig: "AA" },
    }),
  );
  assert.equal(invalidDeviceProofResponse.status, 401);
  assert.deepEqual(await invalidDeviceProofResponse.json(), {
    verified: false,
    error: "device_possession_unauthorized",
  });

  const validResponse = await postVerification(
    fetch,
    verificationBody(fixture.presentation_base64, session, devicePrivateKey),
  );
  assert.equal(validResponse.status, 200);
  const validPayload = await validResponse.json();
  assert.equal(validPayload.verified, true);
  assert.equal(validPayload.signature_algorithm, "Ed25519");
  const result = validPayload.result;
  const requestBytes = decodeBase64Url(fixture.authenticated_request_base64);
  const responseBytes = decodeBase64Url(fixture.authenticated_response_base64);
  assert.deepEqual(Object.keys(result), [
    "version",
    "profile_id",
    "profile_sha256",
    "issuer",
    "proof_purpose",
    "canonical_user_id",
    "device_id",
    "device_challenge",
    "verified_member_id",
    "attestation_session_id",
    "binding_nonce",
    "binding_value",
    "verifier_key_id",
    "notary_key_id",
    "tlsn_attestation_id",
    "server_identity",
    "request_transcript_size",
    "request_transcript_sha256",
    "response_transcript_size",
    "response_transcript_sha256",
    "revealed_request_ranges",
    "revealed_response_ranges",
    "signature",
  ]);
  assert.equal(result.version, 1);
  assert.equal(result.profile_id, "fusou-require-info-v1");
  assert.equal(result.profile_sha256, base64Url(Buffer.alloc(32)));
  assert.equal(result.issuer, "fusou-tlsn-verifier");
  assert.equal(result.proof_purpose, "GAME_ACCOUNT_IDENTITY_V1");
  assert.equal(result.canonical_user_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.device_id, "33333333-3333-4333-8333-333333333333");
  assert.equal(result.device_challenge, session.device_challenge);
  assert.equal(result.verified_member_id, "16189463");
  assert.equal(result.server_identity, "game.example.test");
  assert.equal(result.attestation_session_id, session.session_id);
  assert.equal(result.binding_nonce, base64Url(Buffer.alloc(32, 0x42)));
  assert.equal(result.binding_value, fixture.binding_value);
  assert.equal(result.verifier_key_id, "worker-test");
  assert.equal(result.notary_key_id, "notary-test");
  assert.equal(decodeBase64Url(result.tlsn_attestation_id).length, 16);
  assert.equal(decodeBase64Url(result.signature).length, 64);
  assert.equal(result.request_transcript_size, String(requestBytes.length));
  assert.equal(result.response_transcript_size, String(responseBytes.length));
  assert.equal(result.request_transcript_sha256, createHash("sha256").update(requestBytes).digest("base64url"));
  assert.equal(result.response_transcript_sha256, createHash("sha256").update(responseBytes).digest("base64url"));
  assertFullDisclosure(result.revealed_request_ranges, requestBytes);
  assertFullDisclosure(result.revealed_response_ranges, responseBytes);

  const publicKey = createPublicKey({
    key: Buffer.from(publicKeyDerBase64url, "base64url"),
    format: "der",
    type: "spki",
  });
  const signature = decodeBase64Url(result.signature);
  assert.equal(verifySignature(null, signingBytes(result), publicKey, signature), true);
  const reorderedResult = Object.fromEntries(Object.entries(result).reverse());
  assert.equal(verifySignature(null, signingBytes(reorderedResult), publicKey, signature), true);
  const mutatedResult = { ...result, verified_member_id: "16189464" };
  assert.equal(verifySignature(null, signingBytes(mutatedResult), publicKey, signature), false);
  const mutatedUserResult = { ...result, canonical_user_id: "22222222-2222-4222-8222-222222222222" };
  assert.equal(verifySignature(null, signingBytes(mutatedUserResult), publicKey, signature), false);
  const mutatedDeviceResult = { ...result, device_id: "44444444-4444-4444-8444-444444444444" };
  assert.equal(verifySignature(null, signingBytes(mutatedDeviceResult), publicKey, signature), false);

  const replayResponse = await postVerification(
    fetch,
    verificationBody(fixture.presentation_base64, session, devicePrivateKey),
  );
  assert.equal(replayResponse.status, 409);
  assert.deepEqual(await replayResponse.json(), {
    verified: false,
    error: "binding_consumed",
  });
  console.log("[tlsn-verification-worker] session, positive, signature, negative, and replay paths OK");
}

export async function runUnconfiguredSmokeTest(fetch) {
  const response = await fetch("https://verify.test/verify/tlsn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presentation_base64: "AQ" }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "verifier_unconfigured" });
  console.log("[tlsn-verification-worker] unconfigured fail-closed path OK");
}

export async function runMismatchedIdentitySmokeTest(fetch, fixture, devicePrivateKey) {
  const session = await issueSession(fetch, fixture.binding_value);
  const response = await postVerification(fetch, verificationBody(fixture.presentation_base64, session, devicePrivateKey));
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { verified: false, error: "verification_failed" });
  console.log("[tlsn-verification-worker] mismatched identity fail-closed path OK");
}

export async function runMismatchedNotarySmokeTest(fetch, fixture, devicePrivateKey) {
  const session = await issueSession(fetch, fixture.binding_value);
  const response = await postVerification(fetch, verificationBody(fixture.presentation_base64, session, devicePrivateKey));
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { verified: false, error: "verification_failed" });
  console.log("[tlsn-verification-worker] mismatched Notary registry fail-closed path OK");
}

export async function runConcurrentReplaySmokeTest(fetch, fixture, devicePrivateKey) {
  const session = await issueSession(fetch, fixture.binding_value);
  const body = verificationBody(fixture.presentation_base64, session, devicePrivateKey);
  const responses = await Promise.all([
    postVerification(fetch, body),
    postVerification(fetch, body),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const payloads = await Promise.all(responses.map((response) => response.json()));
  assert.equal(payloads.filter((payload) => payload.verified === true).length, 1);
  assert.equal(payloads.filter((payload) => payload.error === "device_possession_replayed").length, 1);
  console.log("[tlsn-verification-worker] concurrent single-use replay path OK");
}

export async function runExpiredBindingSmokeTest(fetch, fixture, devicePrivateKey) {
  const session = await issueSession(fetch, fixture.binding_value);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const response = await postVerification(fetch, verificationBody(fixture.presentation_base64, session, devicePrivateKey));
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { verified: false, error: "binding_expired" });
  console.log("[tlsn-verification-worker] binding expiry path OK");
}

export async function runBindingContextNegativeSmokeTest(fetch, fixture, devicePrivateKey) {
  const session = await issueSession(fetch, fixture.binding_value);
  const wrongSessionResponse = await postVerification(fetch, JSON.stringify({
    presentation_base64: fixture.presentation_base64,
    session_id: "123e4567-e89b-42d3-a456-426614174001",
    binding: session.binding,
    device_id: session.device_id,
    device_proof: createDeviceProof(session, devicePrivateKey),
  }));
  assert.equal(wrongSessionResponse.status, 409);
  assert.deepEqual(await wrongSessionResponse.json(), { verified: false, error: "session_mismatch" });

  const unknownBindingResponse = await postVerification(fetch, JSON.stringify({
    presentation_base64: fixture.presentation_base64,
    session_id: session.session_id,
    binding: "AQ",
    device_id: session.device_id,
    device_proof: createDeviceProof(session, devicePrivateKey),
  }));
  assert.equal(unknownBindingResponse.status, 422);
  assert.deepEqual(await unknownBindingResponse.json(), { verified: false, error: "binding_unknown" });
  console.log("[tlsn-verification-worker] binding context rejection paths OK");
}

export async function runAuthenticatedOwnershipSmokeTest(fetch, fixture, devicePrivateKey) {
  const missingAuthResponse = await fetch("https://verify.test/attestation/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(missingAuthResponse.status, 401);
  assert.deepEqual(await missingAuthResponse.json(), { error: "unauthorized" });

  const missingDeviceProofResponse = await fetch("https://verify.test/attestation/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token-a",
    },
    body: "{}",
  });
  assert.equal(missingDeviceProofResponse.status, 400);
  assert.deepEqual(await missingDeviceProofResponse.json(), { error: "invalid_request" });

  const session = await issueSession(fetch, fixture.binding_value, "test-token-a");
  const stolenBindingResponse = await postVerification(
    fetch,
    verificationBody(fixture.presentation_base64, session, devicePrivateKey),
    "test-token-b",
  );
  assert.equal(stolenBindingResponse.status, 409);
  assert.deepEqual(await stolenBindingResponse.json(), {
    verified: false,
    error: "user_mismatch",
  });

  const validResponse = await postVerification(
    fetch,
    verificationBody(fixture.presentation_base64, session, devicePrivateKey),
    "test-token-a",
  );
  assert.equal(validResponse.status, 200);
  assert.equal((await validResponse.json()).verified, true);

  const unknownAuthResponse = await fetch("https://verify.test/attestation/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer expired-or-unknown-token",
    },
    body: "{}",
  });
  assert.equal(unknownAuthResponse.status, 401);
  assert.deepEqual(await unknownAuthResponse.json(), { error: "unauthorized" });
  console.log("[tlsn-verification-worker] authenticated ownership and auth failure paths OK");
}

export async function runProductionTrustRootSmokeTest(fetch) {
  const response = await fetch("https://verify.test/attestation/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  console.log("[tlsn-verification-worker] production trust and endpoint configuration gate OK");
}

export async function runProductionEndpointPolicySmokeTest(fetch) {
  const response = await fetch("https://verify.test/attestation/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "verifier_unconfigured" });
  console.log("[tlsn-verification-worker] production endpoint policy fail-closed path OK");
}
