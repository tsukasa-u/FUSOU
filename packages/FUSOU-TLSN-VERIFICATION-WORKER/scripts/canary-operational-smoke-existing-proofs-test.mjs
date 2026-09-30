import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  consumeReceiptSigningBytes,
  sessionReceiptSigningBytes,
} from "./device-evidence.mjs";
import {
  verifyCanaryExistingSourceProofBundle,
  verifyCanarySessionBindingReceipts,
} from "./canary-operational-smoke-existing-proofs.mjs";

const now = new Date("2026-10-01T12:00:00.000Z");
const sessionId = "f73fded7-d9af-4f0a-b87b-c626d30d55bd";
const userId = "a73fded7-d9af-4f0a-b87b-c626d30d55bd";
const deviceId = "b73fded7-d9af-4f0a-b87b-c626d30d55bd";
const sessionSignerKeyId = "session-authority-test";
const bindingSignerKeyId = "binding-authority-test";
const presentationBytes = Buffer.from("offline Presentation bytes");
const { privateKey: sessionPrivateKey, publicKey: sessionPublicKey } = generateKeyPairSync("ed25519");
const { privateKey: bindingPrivateKey, publicKey: bindingPublicKey } = generateKeyPairSync("ed25519");
const sessionPublicKeySpki = sessionPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const bindingPublicKeySpki = bindingPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const authority = (scope, keyId, publicKeySpki) => ({
  publicKeySpki,
  signerKeyId: keyId,
  keyRegistry: {
    schema_version: 1,
    scope,
    keys: [{
      key_id: keyId,
      public_key_spki: publicKeySpki,
      status: "ACTIVE",
      not_before: "2026-01-01T00:00:00.000Z",
      not_after: null,
    }],
  },
});
const sessionAuthority = authority(
  "tlsn-session-authority-key-registry",
  sessionSignerKeyId,
  sessionPublicKeySpki,
);
const bindingAuthority = authority(
  "tlsn-binding-authority-key-registry",
  bindingSignerKeyId,
  bindingPublicKeySpki,
);

const bindingNonce = Buffer.alloc(32, 0x51);
const bindingValue = Buffer.concat([
  Buffer.from("FUSOU-ATTESTATION-BINDING-V1\0"),
  Buffer.from([0, 16]),
  Buffer.from(sessionId.replaceAll("-", ""), "hex"),
  Buffer.from([0, 32]),
  bindingNonce,
]).toString("base64url");
const session = {
  session_id: sessionId,
  canonical_user_id: userId,
  device_id: deviceId,
  challenge: bindingNonce.toString("base64url"),
  device_challenge: Buffer.alloc(32, 0x62).toString("base64url"),
  binding: bindingValue,
  expires_at: "2026-10-01T12:30:00.000Z",
};
const deviceAuthentication = { request: { nonce: "a".repeat(64) } };
const sessionReceipt = {
  schema_version: 1,
  type: "attestation-session-issued",
  signature_algorithm: "Ed25519",
  signer_key_id: sessionSignerKeyId,
  session_id: sessionId,
  canonical_user_id: userId,
  device_id: deviceId,
  device_auth_nonce: deviceAuthentication.request.nonce,
  nonce: session.challenge,
  device_challenge: session.device_challenge,
  binding_value: bindingValue,
  created_at: "2026-10-01T11:55:00.000Z",
  expires_at: session.expires_at,
};
sessionReceipt.signature = sign(null, sessionReceiptSigningBytes(sessionReceipt), sessionPrivateKey).toString("base64url");
session.session_receipt = sessionReceipt;

const consumeReceipt = {
  schema_version: 1,
  type: "attestation-binding-consumed",
  signature_algorithm: "Ed25519",
  signer_key_id: bindingSignerKeyId,
  session_id: sessionId,
  canonical_user_id: userId,
  device_id: deviceId,
  nonce: session.challenge,
  binding_value: bindingValue,
  presentation_id: createHash("sha256").update(presentationBytes).digest("base64url"),
  used_at: "2026-10-01T11:59:00.000Z",
};
consumeReceipt.signature = sign(null, consumeReceiptSigningBytes(consumeReceipt), bindingPrivateKey).toString("base64url");

const proof = verifyCanarySessionBindingReceipts({
  session,
  deviceAuthentication,
  consumeReceipt,
  presentationBytes,
  sessionAuthority,
  bindingAuthority,
  now,
});
assert.equal(proof.status, "PASS");
assert.equal(proof.presentation_sha256, createHash("sha256").update(presentationBytes).digest("base64url"));
assert.equal(JSON.stringify(proof).includes(userId), false);

assert.throws(() => verifyCanarySessionBindingReceipts({
  session: { ...session, binding: `${bindingValue}x` },
  deviceAuthentication,
  consumeReceipt,
  presentationBytes,
  sessionAuthority,
  bindingAuthority,
  now,
}), /session receipt mismatch|binding framing mismatch/);

assert.throws(() => verifyCanarySessionBindingReceipts({
  session,
  deviceAuthentication,
  consumeReceipt,
  presentationBytes: Buffer.from("mutated Presentation bytes"),
  sessionAuthority,
  bindingAuthority,
  now,
}), /consume receipt mismatch: presentation_id/);

assert.throws(() => verifyCanarySessionBindingReceipts({
  session: { ...session, canonical_user_id: "c73fded7-d9af-4f0a-b87b-c626d30d55bd" },
  deviceAuthentication,
  consumeReceipt,
  presentationBytes,
  sessionAuthority,
  bindingAuthority,
  now,
}), /session receipt mismatch: canonical_user_id/);

assert.throws(() => verifyCanarySessionBindingReceipts({
  session: { ...session, device_id: "d73fded7-d9af-4f0a-b87b-c626d30d55bd" },
  deviceAuthentication,
  consumeReceipt,
  presentationBytes,
  sessionAuthority,
  bindingAuthority,
  now,
}), /session receipt mismatch: device_id/);

assert.throws(() => verifyCanarySessionBindingReceipts({
  session: { ...session, session_receipt: {
    ...sessionReceipt,
    signature: `${sessionReceipt.signature[0] === "A" ? "B" : "A"}${sessionReceipt.signature.slice(1)}`,
  } },
  deviceAuthentication,
  consumeReceipt,
  presentationBytes,
  sessionAuthority,
  bindingAuthority,
  now,
}), /attestation-session-issued receipt signature is invalid/);

assert.throws(() => verifyCanarySessionBindingReceipts({
  session,
  deviceAuthentication,
  consumeReceipt: {
    ...consumeReceipt,
    signature: `${consumeReceipt.signature[0] === "A" ? "B" : "A"}${consumeReceipt.signature.slice(1)}`,
  },
  presentationBytes,
  sessionAuthority,
  bindingAuthority,
  now,
}), /signature is invalid/);

assert.throws(() => verifyCanarySessionBindingReceipts({
  session,
  deviceAuthentication,
  consumeReceipt,
  presentationBytes,
  sessionAuthority: {
    ...sessionAuthority,
    keyRegistry: { ...sessionAuthority.keyRegistry, scope: "wrong-authority" },
  },
  bindingAuthority,
  now,
}), /invalid session authority key registry schema/);

assert.throws(() => verifyCanarySessionBindingReceipts({
  session,
  deviceAuthentication,
  consumeReceipt,
  presentationBytes,
  sessionAuthority,
  bindingAuthority,
  now: new Date("2026-10-01T12:30:00.000Z"),
}), /stale/);

await assert.rejects(() => verifyCanaryExistingSourceProofBundle({
  deploymentManifest: {
    target: { server_identity: "game.example.net" },
    notary: { key_id: "notary-test", verifying_key: "AA", registry_sha256: "A".repeat(43) },
    artifacts: [{ name: "profile", sha256: "B".repeat(43) }],
  },
  profileSha256: "C".repeat(43),
}), /profile does not match the validated deployment manifest/);

console.log("[tlsn-canary-operational-smoke-existing-proofs] signed receipts, byte binding, freshness, and manifest pinning PASS");