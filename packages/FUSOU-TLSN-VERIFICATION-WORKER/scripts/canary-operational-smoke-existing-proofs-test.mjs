import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  consumeReceiptSigningBytes,
  sessionReceiptSigningBytes,
  tlsnDeviceProofSigningBytes,
} from "./device-evidence.mjs";
import { resultSigningBytes, sparseResultSigningBytes as resultSparseSigningBytes } from "./production-evidence.mjs";
import { createSignedResultRegistryEnvelope } from "./result-registry-envelope.mjs";
import {
  verifyCanaryExistingSourceProofBundle,
  verifyCanaryDeviceAuthenticationProof,
  verifyCanaryOfflineCryptographicProofs,
  verifyCanaryResultSignature,
  verifyCanarySessionBindingReceipts,
  verifyCanaryTlsnDevicePossessionProof,
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
const { privateKey: devicePrivateKey, publicKey: devicePublicKey } = generateKeyPairSync("ed25519");
const { privateKey: resultPrivateKey, publicKey: resultPublicKey } = generateKeyPairSync("ed25519");
const { privateKey: resultRootPrivateKey, publicKey: resultRootPublicKey } = generateKeyPairSync("ed25519");
const sessionPublicKeySpki = sessionPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const bindingPublicKeySpki = bindingPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const devicePublicKeyBytes = Buffer.from(devicePublicKey.export({ format: "der", type: "spki" })).subarray(-32);
const devicePublicKeyB64url = devicePublicKeyBytes.toString("base64url");
const resultPublicKeySpki = resultPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const resultRootPublicKeySpki = resultRootPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
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
const deviceIdentity = {
  canonical_user_id: userId,
  device_id: deviceId,
  device_public_key: devicePublicKeyB64url,
  device_public_key_sha256: createHash("sha256").update(devicePublicKeyBytes).digest("base64url"),
  authority_state: "UNVERIFIED",
};

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
const deviceAuthenticationNonce = "a".repeat(64);
const deviceAuthentication = {
  request: {
    device_id: deviceId,
    nonce: deviceAuthenticationNonce,
    sig: sign(null, Buffer.from(deviceAuthenticationNonce, "utf8"), devicePrivateKey).toString("base64url"),
  },
  worker_acceptance: { status: 201, device_id: deviceId, session_id: sessionId },
};
const sessionReceipt = {
  schema_version: 1,
  type: "attestation-session-issued",
  signature_algorithm: "Ed25519",
  signer_key_id: sessionSignerKeyId,
  session_id: sessionId,
  canonical_user_id: userId,
  device_id: deviceId,
  device_auth_nonce: deviceAuthenticationNonce,
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

const tlsnPossessionMessage = tlsnDeviceProofSigningBytes(
  deviceId,
  sessionId,
  bindingValue,
  session.device_challenge,
);
const tlsnPossessionDigest = createHash("sha256").update(tlsnPossessionMessage);
const possessionProof = {
  device_id: deviceId,
  session_id: sessionId,
  binding_value: bindingValue,
  challenge: session.device_challenge,
  sig: sign(null, tlsnPossessionMessage, devicePrivateKey).toString("base64url"),
  message_sha256: tlsnPossessionDigest.copy().digest("base64url"),
  message_sha256_hex: tlsnPossessionDigest.copy().digest("hex"),
  replay_digest: tlsnPossessionDigest.copy().digest("base64url"),
  replay_digest_hex: tlsnPossessionDigest.digest("hex"),
};

const resultKeyId = "result-offline-test";
const resultRootKeyId = "result-root-offline-test";
const resultKeyRegistry = {
  schema_version: 1,
  scope: "tlsn-result-signing-key-registry",
  keys: [{
    key_id: resultKeyId,
    public_key_spki: resultPublicKeySpki,
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: null,
  }],
};
const resultKeyRegistryRawBytes = Buffer.from(JSON.stringify(resultKeyRegistry), "utf8");
const resultRegistryEnvelope = createSignedResultRegistryEnvelope({
  registry: resultKeyRegistry,
  registryRaw: resultKeyRegistryRawBytes,
  rootKeyId: resultRootKeyId,
  rootPublicKeySpki: resultRootPublicKeySpki,
  rootPrivateKeyPkcs8: resultRootPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
});
const registryEnvelopeRawBytes = Buffer.from(JSON.stringify(resultRegistryEnvelope), "utf8");
const resultAuthority = {
  publicKeySpki: resultPublicKeySpki,
  signerKeyId: resultKeyId,
  keyRegistry: resultKeyRegistry,
  keyRegistryRawBytes: resultKeyRegistryRawBytes,
  registryEnvelope: resultRegistryEnvelope,
  registryEnvelopeRawBytes,
  trustedRootKeyId: resultRootKeyId,
  trustedRootPublicKeySpki: resultRootPublicKeySpki,
};
const unsignedResult = {
  version: 1,
  profile_id: "fusou-require-info-v1",
  profile_sha256: Buffer.alloc(32, 0x31).toString("base64url"),
  issuer: "fusou-tlsn-verifier",
  proof_purpose: "GAME_ACCOUNT_IDENTITY_V1",
  canonical_user_id: userId,
  device_id: deviceId,
  device_challenge: session.device_challenge,
  verified_member_id: "16189463",
  attestation_session_id: sessionId,
  binding_nonce: session.challenge,
  binding_value: bindingValue,
  verifier_key_id: "verifier-offline-test",
  notary_key_id: "notary-offline-test",
  tlsn_attestation_id: Buffer.alloc(16, 0x42).toString("base64url"),
  server_identity: "game.example.net",
  request_transcript_size: 0,
  request_transcript_sha256: Buffer.alloc(32, 0x51).toString("base64url"),
  revealed_request_ranges: [],
  response_transcript_size: 0,
  response_transcript_sha256: Buffer.alloc(32, 0x62).toString("base64url"),
  revealed_response_ranges: [],
};
const signedResult = {
  ...unsignedResult,
  signature: sign(null, resultSigningBytes(unsignedResult), resultPrivateKey).toString("base64url"),
};
const finalResponse = {
  verified: true,
  result: signedResult,
  signer_key_id: resultKeyId,
  signature_algorithm: "Ed25519",
};

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

const verifiedDeviceAuthentication = verifyCanaryDeviceAuthenticationProof({
  deviceAuthentication,
  deviceIdentity,
  session,
});
assert.equal(verifiedDeviceAuthentication.status, "PASS");
assert.equal(verifiedDeviceAuthentication.signature_algorithm, "Ed25519");
assert.equal(verifiedDeviceAuthentication.nonce_freshness, "UNVERIFIED");
assert.equal(verifiedDeviceAuthentication.nonce_replay_state, "UNVERIFIED");

const verifiedPossessionProof = verifyCanaryTlsnDevicePossessionProof({
  possessionProof,
  deviceIdentity,
  session,
});
assert.equal(verifiedPossessionProof.status, "PASS");
assert.equal(verifiedPossessionProof.replay_digest_sha256, possessionProof.replay_digest);

const resultSignature = verifyCanaryResultSignature({ finalResponse, resultAuthority, now });
assert.equal(resultSignature.status, "PASS");
assert.equal(resultSignature.result_signature_valid, true);
assert.equal(resultSignature.signature_algorithm, "Ed25519");
assert.equal(resultSignature.deployment_binding, "UNVERIFIED");

const combinedCryptographicProofs = verifyCanaryOfflineCryptographicProofs({
  session,
  deviceAuthentication,
  deviceIdentity,
  possessionProof,
  finalResponse,
  resultAuthority,
  now,
});
assert.equal(combinedCryptographicProofs.status, "PASS");
assert.equal(combinedCryptographicProofs.scope, "provided device signatures and root-pinned Result signer registry only");
assert.equal(combinedCryptographicProofs.components.device_auth_signature.status, "PASS");
assert.equal(combinedCryptographicProofs.components.tlsn_device_possession.status, "PASS");
assert.equal(combinedCryptographicProofs.components.result_signature.status, "PASS");

const sparseResultUnsigned = {
  ...unsignedResult,
  version: 2,
  profile_id: "fusou-require-info-v2-sparse",
  disclosure_mode: "sparse",
  notary_key_sha256: Buffer.alloc(32, 0x33).toString("base64url"),
  tlsn_attestation_id: Buffer.alloc(16, 0x42).toString("base64url"),
  presentation_sha256: Buffer.alloc(32, 0x72).toString("base64url"),
  request_transcript_size: "2",
  revealed_request_ranges: [{ start: "0", length: "1", bytes: Buffer.from([0x47]).toString("base64url") }],
  response_transcript_size: "2",
  revealed_response_ranges: [{ start: "1", length: "1", bytes: Buffer.from([0x48]).toString("base64url") }],
};
delete sparseResultUnsigned.request_transcript_sha256;
delete sparseResultUnsigned.response_transcript_sha256;
const sparseResult = {
  ...sparseResultUnsigned,
  signature: sign(null, resultSparseSigningBytes(sparseResultUnsigned), resultPrivateKey).toString("base64url"),
};
const sparseFinalResponse = {
  verified: true,
  result: sparseResult,
  signer_key_id: resultKeyId,
  signature_algorithm: "Ed25519",
};
const sparseSignature = verifyCanaryResultSignature({
  finalResponse: sparseFinalResponse,
  resultAuthority,
  now,
});
assert.equal(sparseSignature.status, "PASS");
assert.match(sparseSignature.signed_bytes_format, /SPARSE-RESULT/);
assert.throws(() => verifyCanaryResultSignature({
  finalResponse: { ...sparseFinalResponse, result: { ...sparseResult, verified_member_id: "16189464" } },
  resultAuthority,
  now,
}), /sparse verifier result signature is invalid/);

assert.throws(() => verifyCanaryDeviceAuthenticationProof({
  deviceAuthentication: {
    ...deviceAuthentication,
    request: { ...deviceAuthentication.request, nonce: "b".repeat(64) },
  },
  deviceIdentity,
  session,
}), /device authentication signature is invalid/);

assert.throws(() => verifyCanaryDeviceAuthenticationProof({
  deviceAuthentication: {
    ...deviceAuthentication,
    request: {
      ...deviceAuthentication.request,
      sig: `${deviceAuthentication.request.sig[0] === "A" ? "B" : "A"}${deviceAuthentication.request.sig.slice(1)}`,
    },
  },
  deviceIdentity,
  session,
}), /device authentication signature is invalid/);

const { publicKey: wrongDevicePublicKey } = generateKeyPairSync("ed25519");
const wrongDevicePublicKeyBytes = Buffer.from(wrongDevicePublicKey.export({ format: "der", type: "spki" })).subarray(-32);
assert.throws(() => verifyCanaryDeviceAuthenticationProof({
  deviceAuthentication,
  deviceIdentity: {
    ...deviceIdentity,
    device_public_key: wrongDevicePublicKeyBytes.toString("base64url"),
    device_public_key_sha256: createHash("sha256").update(wrongDevicePublicKeyBytes).digest("base64url"),
  },
  session,
}), /device authentication signature is invalid/);

assert.throws(() => verifyCanaryDeviceAuthenticationProof({
  deviceAuthentication: {
    ...deviceAuthentication,
    request: { ...deviceAuthentication.request, device_id: "c73fded7-d9af-4f0a-b87b-c626d30d55bd" },
  },
  deviceIdentity,
  session,
}), /device authentication request is invalid/);

const validSignatureForWrongNonce = {
  ...deviceAuthentication,
  request: {
    ...deviceAuthentication.request,
    nonce: "c".repeat(64),
    sig: sign(null, Buffer.from("c".repeat(64), "utf8"), devicePrivateKey).toString("base64url"),
  },
};
assert.equal(verifyCanaryDeviceAuthenticationProof({
  deviceAuthentication: validSignatureForWrongNonce,
  deviceIdentity,
  session,
}).status, "PASS");
assert.throws(() => verifyCanarySessionBindingReceipts({
  session,
  deviceAuthentication: validSignatureForWrongNonce,
  consumeReceipt,
  presentationBytes,
  sessionAuthority,
  bindingAuthority,
  now,
}), /session receipt mismatch: device_auth_nonce/);

assert.throws(() => verifyCanaryDeviceAuthenticationProof({
  deviceAuthentication: {
    ...deviceAuthentication,
    worker_acceptance: { ...deviceAuthentication.worker_acceptance, session_id: "c73fded7-d9af-4f0a-b87b-c626d30d55bd" },
  },
  deviceIdentity,
  session,
}), /not bound to session issuance/);

assert.throws(() => verifyCanaryDeviceAuthenticationProof({
  deviceAuthentication,
  deviceIdentity: { ...deviceIdentity, canonical_user_id: "c73fded7-d9af-4f0a-b87b-c626d30d55bd" },
  session,
}), /captured device key is not bound to the Session identity/);

assert.throws(() => verifyCanaryTlsnDevicePossessionProof({
  possessionProof: { ...possessionProof, session_id: "c73fded7-d9af-4f0a-b87b-c626d30d55bd" },
  deviceIdentity,
  session,
}), /TLSN device possession fields are not bound to the session/);

assert.throws(() => verifyCanaryTlsnDevicePossessionProof({
  possessionProof: { ...possessionProof, binding_value: `${bindingValue}x` },
  deviceIdentity,
  session,
}), /TLSN device possession fields are not bound to the session/);

assert.throws(() => verifyCanaryTlsnDevicePossessionProof({
  possessionProof: {
    ...possessionProof,
    challenge: Buffer.alloc(32, 0x63).toString("base64url"),
  },
  deviceIdentity,
  session,
}), /TLSN device possession fields are not bound to the session/);

assert.throws(() => verifyCanaryTlsnDevicePossessionProof({
  possessionProof: {
    ...possessionProof,
    sig: `${possessionProof.sig[0] === "A" ? "B" : "A"}${possessionProof.sig.slice(1)}`,
  },
  deviceIdentity,
  session,
}), /TLSN device possession signature is invalid/);

assert.throws(() => verifyCanaryTlsnDevicePossessionProof({
  possessionProof: {
    ...possessionProof,
    replay_digest: `${possessionProof.replay_digest[0] === "A" ? "B" : "A"}${possessionProof.replay_digest.slice(1)}`,
  },
  deviceIdentity,
  session,
}), /replay digest mismatch/);

const possessionWithUnverifiedAuthorityClaims = verifyCanaryTlsnDevicePossessionProof({
  possessionProof,
  deviceIdentity: {
    ...deviceIdentity,
    authoritative: true,
    authority: "fusou-web-user-devices",
    revoked_at: "2026-10-01T11:00:00.000Z",
  },
  session,
});
assert.equal(possessionWithUnverifiedAuthorityClaims.status, "PASS");
assert.equal(possessionWithUnverifiedAuthorityClaims.authority_state, "UNVERIFIED");

assert.throws(() => verifyCanaryResultSignature({
  finalResponse: { ...finalResponse, result: { ...signedResult, verified_member_id: "16189464" } },
  resultAuthority,
  now,
}), /production verifier result signature is invalid/);

assert.throws(() => verifyCanaryResultSignature({
  finalResponse: {
    ...finalResponse,
    result: {
      ...signedResult,
      signature: `${signedResult.signature[0] === "A" ? "B" : "A"}${signedResult.signature.slice(1)}`,
    },
  },
  resultAuthority,
  now,
}), /production verifier result signature is invalid/);

const { publicKey: wrongResultPublicKey } = generateKeyPairSync("ed25519");
assert.throws(() => verifyCanaryResultSignature({
  finalResponse,
  resultAuthority: {
    ...resultAuthority,
    publicKeySpki: wrongResultPublicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  },
  now,
}), /current result signing key is not the published registry key/);

assert.throws(() => verifyCanaryResultSignature({
  finalResponse,
  resultAuthority: { ...resultAuthority, trustedRootKeyId: "other-result-root" },
  now,
}), /root identity does not match the trusted pin/);

assert.throws(() => verifyCanaryResultSignature({
  finalResponse,
  resultAuthority: {
    ...resultAuthority,
    registryEnvelope: {
      ...resultRegistryEnvelope,
      signature_base64url: `${resultRegistryEnvelope.signature_base64url[0] === "A" ? "B" : "A"}${resultRegistryEnvelope.signature_base64url.slice(1)}`,
    },
  },
  now,
}), /envelope object does not match its exact captured bytes/);

assert.throws(() => verifyCanaryResultSignature({
  finalResponse: { ...finalResponse, signer_key_id: "unknown-result-key" },
  resultAuthority: { ...resultAuthority, signerKeyId: "unknown-result-key" },
  now,
}), /current result signing key is not the published registry key/);

assert.throws(() => verifyCanaryResultSignature({
  finalResponse,
  resultAuthority: {
    ...resultAuthority,
    keyRegistry: { ...resultKeyRegistry, keys: [] },
  },
  now,
}), /registry object does not match its exact captured bytes/);

assert.throws(() => verifyCanaryResultSignature({
  finalResponse: { ...finalResponse, signer_key_id: "other-result-key" },
  resultAuthority,
  now,
}), /does not match the trusted Result authority/);

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

const smokeSource = await readFile(new URL("./canary-operational-smoke.mjs", import.meta.url), "utf8");
const runnerSource = await readFile(new URL("./canary-operational-smoke-runner.mjs", import.meta.url), "utf8");
const readinessSource = await readFile(new URL("./canary-readiness-test.mjs", import.meta.url), "utf8");
for (const source of [smokeSource, runnerSource, readinessSource]) {
  assert.doesNotMatch(source, /canary-operational-smoke-existing-proofs/);
}

  const realAlpha15ProofBundle = "UNAVAILABLE";
  assert.equal(realAlpha15ProofBundle, "UNAVAILABLE");

await assert.rejects(() => verifyCanaryExistingSourceProofBundle({
  deploymentManifest: {
    target: { server_identity: "game.example.net" },
    notary: { key_id: "notary-test", verifying_key: "AA", registry_sha256: "A".repeat(43) },
    artifacts: [{ name: "profile", sha256: "B".repeat(43) }],
  },
  profileSha256: "C".repeat(43),
}), /profile does not match the validated deployment manifest/);

console.log("[tlsn-canary-existing-proofs:synthetic-authority-offline] device signatures, complete+sparse Result signatures, receipt bindings, and smoke/readiness separation PASS");
console.log(`[tlsn-canary-existing-proofs] NON_SYNTHETIC_ALPHA15_PROOF_BUNDLE=${realAlpha15ProofBundle}; full presentation bundle verification NOT_RUN`);