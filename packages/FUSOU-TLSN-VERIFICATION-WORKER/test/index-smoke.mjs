import assert from "node:assert/strict";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
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

export async function runSmokeTest(fetch, fixture, publicKeyDerBase64url) {
  const healthResponse = await fetch("https://verify.test/health");
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    verifier: "tlsn-alpha15-wasm",
  });

  const validResponse = await fetch(
    "https://verify.test/verify/tlsn",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentation_base64: fixture.presentation_base64 }),
    },
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
  assert.equal(result.verified_member_id, "16189463");
  assert.equal(result.server_identity, "game.example.test");
  assert.equal(result.attestation_session_id, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(result.binding_nonce, base64Url(Buffer.alloc(32, 0x42)));
  assert.equal(result.binding_value, fixture.binding_value);
  assert.equal(result.verifier_key_id, "worker-test");
  assert.equal(result.notary_key_id, "notary-test");
  assert.equal(decodeBase64Url(result.tlsn_attestation_id).length, 16);
  assert.equal(decodeBase64Url(result.signature).length, 64);
  assert.equal(result.request_transcript_size, String(requestBytes.length));
  assert.equal(result.response_transcript_size, String(responseBytes.length));
  assert.equal(
    result.request_transcript_sha256,
    createHash("sha256").update(requestBytes).digest("base64url"),
  );
  assert.equal(
    result.response_transcript_sha256,
    createHash("sha256").update(responseBytes).digest("base64url"),
  );
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

  const extraMemberIdResponse = await fetch(
    "https://verify.test/verify/tlsn",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentation_base64: "AQ", member_id: "16189463" }),
    },
  );
  assert.equal(extraMemberIdResponse.status, 400);
  assert.deepEqual(await extraMemberIdResponse.json(), { error: "invalid_request" });

  const invalidPresentationResponse = await fetch(
    "https://verify.test/verify/tlsn",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentation_base64: "AQ" }),
    },
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
  const fixtureResponse = await fetch(
    "https://verify.test/verify/tlsn",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentation_base64: base64Url(upstreamFixture) }),
    },
  );
  assert.equal(fixtureResponse.status, 422);
  assert.deepEqual(await fixtureResponse.json(), {
    verified: false,
    error: "verification_failed",
  });

  const tamperedPresentation = decodeBase64Url(fixture.presentation_base64);
  tamperedPresentation[Math.floor(tamperedPresentation.length / 2)] ^= 1;
  const tamperedResponse = await fetch(
    "https://verify.test/verify/tlsn",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentation_base64: base64Url(tamperedPresentation) }),
    },
  );
  assert.equal(tamperedResponse.status, 422);
  assert.deepEqual(await tamperedResponse.json(), {
    verified: false,
    error: "verification_failed",
  });

  console.log("[tlsn-verification-worker] positive, signature, and negative paths OK");
}

export async function runUnconfiguredSmokeTest(fetch) {
  const unconfiguredResponse = await fetch(
    "https://verify.test/verify/tlsn",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentation_base64: "AQ" }),
    },
  );
  assert.equal(unconfiguredResponse.status, 503);
  assert.deepEqual(await unconfiguredResponse.json(), { error: "verifier_unconfigured" });
  console.log("[tlsn-verification-worker] unconfigured fail-closed path OK");
}

export async function runMismatchedIdentitySmokeTest(fetch, fixture) {
  const response = await fetch(
    "https://verify.test/verify/tlsn",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentation_base64: fixture.presentation_base64 }),
    },
  );
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    verified: false,
    error: "verification_failed",
  });
  console.log("[tlsn-verification-worker] mismatched identity fail-closed path OK");
}