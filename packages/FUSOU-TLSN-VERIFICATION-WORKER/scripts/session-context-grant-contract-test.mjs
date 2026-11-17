import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { attestationSessionContextGrantSigningBytes } from "../src/attestation_receipts.ts";

const vector = JSON.parse(readFileSync(
  new URL("../../FUSOU-TLSN-VERIFIER/fixtures/session-context-grant-v1-vector.json", import.meta.url),
  "utf8",
));

test("Worker grant signing bytes and signature match the shared Rust vector", () => {
  const deviceIdSha256 = createHash("sha256")
    .update(Buffer.concat([
      Buffer.from("FUSOU-SESSION-DEVICE-COMMITMENT-V1\0"),
      Buffer.from(vector.device_id, "utf8"),
    ]))
    .digest();
  assert.equal(deviceIdSha256.toString("base64url"), vector.device_id_sha256);

  const signingBytes = attestationSessionContextGrantSigningBytes({
    signerKeyId: vector.signer_key_id,
    sessionId: vector.session_id,
    bindingValue: vector.binding_value,
    deviceIdSha256,
    deviceChallenge: Buffer.from(vector.device_challenge, "base64url"),
    issuedAtMs: vector.issued_at_ms,
    expiresAtMs: vector.expires_at_ms,
  });
  assert.equal(Buffer.from(signingBytes).toString("base64url"), vector.signing_bytes);

  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(vector.private_key_seed, "base64url"),
    ]),
    format: "der",
    type: "pkcs8",
  });
  assert.equal(
    createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64url"),
    vector.public_key_spki,
  );
  const grant = Buffer.concat([
    Buffer.from(signingBytes),
    sign(null, signingBytes, privateKey),
  ]);
  assert.equal(grant.toString("base64url"), vector.grant);
  assert.equal(createHash("sha256").update(grant).digest("base64url"), vector.grant_sha256);
});

test("Worker grant signing bytes reject invalid lengths and time windows", () => {
  const valid = {
    signerKeyId: vector.signer_key_id,
    sessionId: vector.session_id,
    bindingValue: vector.binding_value,
    deviceIdSha256: Buffer.from(vector.device_id_sha256, "base64url"),
    deviceChallenge: Buffer.from(vector.device_challenge, "base64url"),
    issuedAtMs: vector.issued_at_ms,
    expiresAtMs: vector.expires_at_ms,
  };
  assert.throws(() => attestationSessionContextGrantSigningBytes({
    ...valid,
    deviceChallenge: new Uint8Array(31),
  }), /Session context grant fields are invalid/);
  assert.throws(() => attestationSessionContextGrantSigningBytes({
    ...valid,
    expiresAtMs: valid.issuedAtMs,
  }), /Session context grant fields are invalid/);
});
