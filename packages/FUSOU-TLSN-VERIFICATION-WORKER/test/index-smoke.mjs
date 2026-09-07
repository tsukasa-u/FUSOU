import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

export async function runSmokeTest(fetch) {
  const healthResponse = await fetch("https://verify.test/health");
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    verifier: "tlsn-alpha15-wasm",
  });

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
  const fixture = await readFile(fixturePath);
  const fixtureResponse = await fetch(
    "https://verify.test/verify/tlsn",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentation_base64: base64Url(fixture) }),
    },
  );
  assert.equal(fixtureResponse.status, 422);
  assert.deepEqual(await fixtureResponse.json(), {
    verified: false,
    error: "verification_failed",
  });

  console.log("[tlsn-verification-worker] negative verification paths OK");
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