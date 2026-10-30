import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  authenticateDeviceProof,
  authenticateTlsnDeviceProof,
  tlsnDeviceProofSigningBytes,
} from "../src/device-proof-client.ts";

const user = "11111111-1111-4111-8111-111111111111";
const device = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const other = "44444444-4444-4444-8444-444444444444";
const subject = { canonicalUserId: user, accessToken: "offline-unit-not-a-credential" };
const authentication = { device_id: device, nonce: "a".repeat(64), sig: "offline-signature" };
const proof = {
  device_id: device, session_id: session, binding_value: "offline-binding",
  challenge: Buffer.alloc(32, 7).toString("base64url"), sig: "offline-signature",
};
const endpoint = "https://owner.example.test/api/auth/anonymous-sync/v2/tlsn-device-proof";
const authenticationEndpoint = "https://owner.example.test/api/auth/anonymous-sync/v2/device-proof";
const accepted = { authenticated: true, canonical_user_id: user, device_id: device };
const digest = (value) => createHash("sha256")
  .update(tlsnDeviceProofSigningBytes(value, Buffer.from(value.challenge, "base64url")))
  .digest("hex");
const reply = (status, body) => async () => Response.json(body, { status });
const possess = (fetcher, value = proof, expected) =>
  authenticateTlsnDeviceProof(subject, value, endpoint, digest(value), expected, fetcher);

test("caller forwards the exact proof and bearer once, without following a redirect", async () => {
  let calls = 0;
  const result = await authenticateDeviceProof(subject, authentication, authenticationEndpoint, async (url, init) => {
    calls++;
    assert.equal(url, authenticationEndpoint);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Authorization, `Bearer ${subject.accessToken}`);
    assert.equal(init.body, JSON.stringify(authentication));
    return Response.json(accepted);
  });
  assert.deepEqual(result, { ok: true, canonicalUserId: user, deviceId: device });
  assert.equal(calls, 1);
});

for (const [status, error, expectedStatus, expectedError] of [
  [403, "device_owner_mismatch", 403, "device_owner_mismatch"],
  [409, "device_revoked", 409, "device_revoked"],
  [409, "nonce_already_used", 409, "device_nonce_replayed"],
  [401, "nonce_invalid_or_expired", 401, "device_nonce_invalid"],
  [404, "device_unknown", 401, "device_unauthorized"],
  [503, "database_unavailable", 503, "device_auth_unavailable"],
  [302, "redirect", 503, "device_auth_unavailable"],
]) {
  test(`authentication ${status}/${error} fails closed`, async () => {
    assert.deepEqual(await authenticateDeviceProof(subject, authentication, authenticationEndpoint, reply(status, { error })),
      { ok: false, status: expectedStatus, error: expectedError });
  });
}

for (const mutation of [
  { canonical_user_id: other }, { device_id: other }, { authenticated: false }, { unexpected: true },
]) {
  test(`authentication response context/schema rejects ${Object.keys(mutation)[0]}`, async () => {
    const result = await authenticateDeviceProof(subject, authentication, authenticationEndpoint, reply(200, { ...accepted, ...mutation }));
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });
}

test("network failure and malformed JSON cannot authenticate or trigger retries", async () => {
  let calls = 0;
  const failing = async () => { calls++; throw new Error("offline interruption"); };
  assert.equal((await authenticateDeviceProof(subject, authentication, authenticationEndpoint, failing)).error, "device_auth_unavailable");
  assert.equal(calls, 1);
  assert.equal((await authenticateDeviceProof(subject, authentication, authenticationEndpoint,
    async () => new Response("{", { status: 200 }))).ok, false);
  assert.equal((await possess(failing)).error, "device_possession_unavailable");
  assert.equal(calls, 2);
});

test("possession response must match the independently computed current proof digest", async () => {
  let calls = 0;
  assert.deepEqual(await possess(async (url, init) => {
    calls++;
    assert.equal(url, endpoint);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Authorization, `Bearer ${subject.accessToken}`);
    assert.equal(init.body, JSON.stringify(proof));
    return Response.json({ ...accepted, replay_digest_hex: digest(proof) });
  }),
    { ok: true, canonicalUserId: user, deviceId: device, replayDigestHex: digest(proof) });
  assert.equal(calls, 1);
  assert.deepEqual(await possess(reply(200, { ...accepted, replay_digest_hex: "b".repeat(64) })),
    { ok: false, status: 503, error: "device_possession_unavailable" });
});

for (const mutation of [
  { canonical_user_id: other }, { device_id: other }, { authenticated: false }, { unexpected: true },
]) {
  test(`possession response context/schema rejects ${Object.keys(mutation)[0]}`, async () => {
    assert.equal((await possess(reply(200, {
      ...accepted, replay_digest_hex: digest(proof), ...mutation,
    }))).error, "device_possession_owner_mismatch");
  });
}

for (const [field, value] of [
  ["session_id", other], ["binding_value", "another-binding"],
  ["challenge", Buffer.alloc(32, 8).toString("base64url")],
]) {
  test(`a valid-shaped old response cannot authorize another ${field}`, async () => {
    const changed = { ...proof, [field]: value };
    assert.notEqual(digest(changed), digest(proof));
    assert.equal((await possess(reply(200, { ...accepted, replay_digest_hex: digest(proof) }), changed)).ok, false);
  });
}

for (const [status, error, expectedStatus, expectedError] of [
  [403, "owner", 403, "device_possession_owner_mismatch"],
  [409, "device_revoked", 409, "device_possession_revoked"],
  [409, "device_proof_replayed", 409, "device_possession_replayed"],
  [503, "unavailable", 503, "device_possession_unavailable"],
  [302, "redirect", 503, "device_possession_unavailable"],
]) {
  test(`possession ${status}/${error} fails closed`, async () => {
    assert.deepEqual(await possess(reply(status, { error })),
      { ok: false, status: expectedStatus, error: expectedError });
  });
}

test("replay acknowledgement is limited to the exact previously expected digest, never revocation", async () => {
  assert.equal((await possess(reply(409, { error: "device_proof_replayed" }), proof, digest(proof))).ok, true);
  assert.equal((await possess(reply(409, { error: "device_proof_replayed" }), proof, "c".repeat(64))).ok, false);
  assert.equal((await possess(reply(409, { error: "device_revoked" }), proof, digest(proof))).ok, false);
});

test("proof framing matches the Rust u16 big-endian fields and excludes signature bytes", () => {
  const fields = [device, session, proof.binding_value].map((s) => Buffer.from(s));
  fields.push(Buffer.from(proof.challenge, "base64url"));
  const expected = Buffer.concat([Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0"),
    ...fields.flatMap((field) => {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(field.length);
      return [length, field];
    })]);
  assert.deepEqual(Buffer.from(tlsnDeviceProofSigningBytes(proof, fields[3])), expected);
  assert.equal(digest({ ...proof, sig: "different-signature" }), digest(proof));
  assert.throws(() => tlsnDeviceProofSigningBytes(proof, Buffer.alloc(31)), /32 bytes/);
  assert.throws(() => tlsnDeviceProofSigningBytes({ ...proof, binding_value: "x".repeat(65536) }, fields[3]), /too large/);
});

test("owner response size is enforced before reading and while streaming, without retry", async () => {
  for (const declared of [true, false]) {
    let cancelled = false;
    let calls = 0;
    const fetcher = async (_url, init) => {
      calls++;
      assert.ok(init.signal instanceof AbortSignal);
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); },
        cancel() { cancelled = true; },
      }), { headers: declared ? { "Content-Length": String(16 * 1024 + 1) } : {} });
    };
    assert.equal((await authenticateDeviceProof(subject, authentication, authenticationEndpoint, fetcher)).error,
      "device_auth_unavailable");
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
  }
});
