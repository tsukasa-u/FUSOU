import { createHash, createPublicKey, verify } from "node:crypto";
import { PRODUCTION_EVIDENCE_DEVICE_PREDICATE_DEFINITIONS } from "./production-evidence-contract.mjs";
import { resolveAuthorityKey } from "./authority-key-registry.mjs";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ED25519_RAW_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BINDING_PREFIX = Buffer.from("FUSOU-ATTESTATION-BINDING-V1\0");
const SESSION_RECEIPT_PREFIX = Buffer.from("FUSOU-ATTESTATION-SESSION-V1\0");
const CONSUME_RECEIPT_PREFIX = Buffer.from("FUSOU-ATTESTATION-CONSUME-V1\0");

export function decodeBase64Url(value, label, expectedLength) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) {
    throw new Error(`${label} is not canonical base64url`);
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(`${label} has an invalid length`);
  }
  return bytes;
}

function pushU16(chunks, value) {
  if (value > 0xffff) throw new Error("evidence field is too large");
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  chunks.push(bytes);
}

function pushLengthPrefixed(chunks, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  pushU16(chunks, bytes.length);
  chunks.push(bytes);
}

function receiptBytes(prefix, fields) {
  const chunks = [prefix, Buffer.from([0, 1])];
  for (const field of fields) pushLengthPrefixed(chunks, field);
  return Buffer.concat(chunks);
}

function uuidBytes(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be UUIDv4`);
  }
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

export function parseBindingValue(value) {
  const bytes = decodeBase64Url(value, "binding_value");
  const expectedLength = BINDING_PREFIX.length + 2 + 16 + 2 + 32;
  if (bytes.length !== expectedLength || !bytes.subarray(0, BINDING_PREFIX.length).equals(BINDING_PREFIX)) {
    throw new Error("binding has invalid framing");
  }
  let offset = BINDING_PREFIX.length;
  const sessionLength = bytes.readUInt16BE(offset);
  offset += 2;
  if (sessionLength !== 16) throw new Error("binding session ID length is invalid");
  const sessionId = `${bytes.subarray(offset, offset + 4).toString("hex")}-${bytes.subarray(offset + 4, offset + 6).toString("hex")}-${bytes.subarray(offset + 6, offset + 8).toString("hex")}-${bytes.subarray(offset + 8, offset + 10).toString("hex")}-${bytes.subarray(offset + 10, offset + 16).toString("hex")}`;
  uuidBytes(sessionId, "binding session ID");
  offset += 16;
  const nonceLength = bytes.readUInt16BE(offset);
  offset += 2;
  if (nonceLength !== 32) throw new Error("binding nonce length is invalid");
  return { sessionId, nonce: bytes.subarray(offset, offset + 32).toString("base64url") };
}

export function tlsnDeviceProofSigningBytes(deviceId, sessionId, bindingValue, challenge) {
  uuidBytes(deviceId, "device ID");
  uuidBytes(sessionId, "session ID");
  const chunks = [Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  pushLengthPrefixed(chunks, deviceId);
  pushLengthPrefixed(chunks, sessionId);
  pushLengthPrefixed(chunks, bindingValue);
  pushLengthPrefixed(chunks, decodeBase64Url(challenge, "device challenge", 32));
  return Buffer.concat(chunks);
}

export function deviceProofReplayDigest(deviceId, sessionId, bindingValue, challenge) {
  return createHash("sha256").update(tlsnDeviceProofSigningBytes(deviceId, sessionId, bindingValue, challenge)).digest("base64url");
}

export function deviceProofReplayDigestHex(deviceId, sessionId, bindingValue, challenge) {
  return createHash("sha256").update(tlsnDeviceProofSigningBytes(deviceId, sessionId, bindingValue, challenge)).digest("hex");
}

export function verifyRawEd25519(publicKey, message, signature, label = "device signature") {
  const keyBytes = decodeBase64Url(publicKey, "device public key", 32);
  const signatureBytes = decodeBase64Url(signature, label, 64);
  const key = createPublicKey({
    key: Buffer.concat([ED25519_RAW_SPKI_PREFIX, keyBytes]),
    format: "der",
    type: "spki",
  });
  if (!verify(null, message, key, signatureBytes)) throw new Error(`${label} is invalid`);
}

export function publicKeySha256(publicKey) {
  return createHash("sha256").update(decodeBase64Url(publicKey, "device public key", 32)).digest("base64url");
}

export function verifyDeviceIdentity(identity, expectedUserId, expectedDeviceId) {
  if (identity?.authoritative !== true || identity.authority !== "fusou-web-user-devices") {
    throw new Error("device identity is not an authoritative FUSOU-WEB reference");
  }
  if (identity.canonical_user_id !== expectedUserId || identity.device_id !== expectedDeviceId) {
    throw new Error("device identity owner or device mismatch");
  }
  if (identity.revoked_at !== null) throw new Error("captured device is revoked");
  const publicKey = decodeBase64Url(identity.device_public_key, "device public key", 32);
  if (identity.device_public_key_sha256 !== publicKeySha256(identity.device_public_key)) {
    throw new Error("device public key hash mismatch");
  }
  return publicKey;
}

export function verifyDeviceAuthentication(authentication, identity, expectedUserId, expectedDeviceId, expectedSessionId) {
  const publicKey = verifyDeviceIdentity(identity, expectedUserId, expectedDeviceId);
  const request = authentication?.request;
  if (request?.device_id !== expectedDeviceId || typeof request?.nonce !== "string" || !/^[a-f0-9]{64}$/.test(request.nonce)) {
    throw new Error("device authentication request is invalid");
  }
  verifyRawEd25519(identity.device_public_key, Buffer.from(request.nonce, "utf8"), request.sig, "device authentication signature");
  const acceptance = authentication?.worker_acceptance;
  if (
    acceptance?.status !== 201 ||
    acceptance.device_id !== expectedDeviceId ||
    acceptance.session_id !== expectedSessionId
  ) {
    throw new Error("device authentication is not bound to session issuance");
  }
  return { publicKey, nonce: request.nonce };
}

export function verifyTlsnDevicePossession(proof, identity, expectedUserId, expectedDeviceId, expectedSessionId, expectedBinding, expectedChallenge) {
  verifyDeviceIdentity(identity, expectedUserId, expectedDeviceId);
  if (
    proof?.device_id !== expectedDeviceId ||
    proof.session_id !== expectedSessionId ||
    proof.binding_value !== expectedBinding ||
    proof.challenge !== expectedChallenge
  ) throw new Error("TLSN device possession fields are not bound to the session");
  const signingBytes = tlsnDeviceProofSigningBytes(expectedDeviceId, expectedSessionId, expectedBinding, expectedChallenge);
  verifyRawEd25519(identity.device_public_key, signingBytes, proof.sig, "TLSN device possession signature");
  const digest = createHash("sha256").update(signingBytes).digest("base64url");
  const digestHex = createHash("sha256").update(signingBytes).digest("hex");
  if (
    proof.replay_digest !== digest ||
    proof.message_sha256 !== digest ||
    proof.replay_digest_hex !== digestHex ||
    proof.message_sha256_hex !== digestHex
  ) {
    throw new Error("TLSN device possession replay digest mismatch");
  }
  return { signingBytes, replayDigest: digest, replayDigestHex: digestHex };
}

export function sessionReceiptSigningBytes(receipt) {
  return receiptBytes(SESSION_RECEIPT_PREFIX, [
    receipt.signer_key_id,
    receipt.session_id,
    receipt.canonical_user_id,
    receipt.device_id,
    receipt.device_auth_nonce,
    receipt.nonce,
    receipt.device_challenge,
    receipt.binding_value,
    receipt.created_at,
    receipt.expires_at,
  ]);
}

export function consumeReceiptSigningBytes(receipt) {
  return receiptBytes(CONSUME_RECEIPT_PREFIX, [
    receipt.signer_key_id,
    receipt.session_id,
    receipt.canonical_user_id,
    receipt.device_id,
    receipt.nonce,
    receipt.binding_value,
    receipt.presentation_id,
    receipt.used_at,
  ]);
}

function verifyReceiptSignature(receipt, expectedType, signingBytes, publicKeySpki, expectedSignerKeyId) {
  if (
    receipt?.schema_version !== 1 ||
    receipt.type !== expectedType ||
    receipt.signature_algorithm !== "Ed25519" ||
    receipt.signer_key_id !== expectedSignerKeyId
  ) throw new Error(`${expectedType} receipt metadata is invalid`);
  const publicKey = createPublicKey({
    key: decodeBase64Url(publicKeySpki, "receipt signer public key"),
    format: "der",
    type: "spki",
  });
  const signature = decodeBase64Url(receipt.signature, `${expectedType} receipt signature`, 64);
  if (!verify(null, signingBytes, publicKey, signature)) throw new Error(`${expectedType} receipt signature is invalid`);
}

export function verifySessionReceipt(receipt, expected, {
  publicKeySpki,
  signerKeyId,
  keyRegistry,
}) {
  for (const [field, value] of Object.entries(expected)) {
    if (receipt?.[field] !== value) throw new Error(`session receipt mismatch: ${field}`);
  }
  const registryPublicKeySpki = resolveAuthorityKey(keyRegistry, {
    scope: "tlsn-session-authority-key-registry",
    keyId: receipt.signer_key_id,
    at: receipt.created_at,
    label: "session authority",
  });
  if (registryPublicKeySpki !== publicKeySpki || receipt.signer_key_id !== signerKeyId) {
    throw new Error("session receipt signer does not match the Session Authority registry");
  }
  verifyReceiptSignature(receipt, "attestation-session-issued", sessionReceiptSigningBytes(receipt), registryPublicKeySpki, signerKeyId);
  const binding = parseBindingValue(receipt.binding_value);
  if (binding.sessionId !== receipt.session_id || binding.nonce !== receipt.nonce) {
    throw new Error("session receipt binding framing mismatch");
  }
  return binding;
}

export function verifyConsumeReceipt(receipt, expected, {
  publicKeySpki,
  signerKeyId,
  keyRegistry,
}) {
  for (const [field, value] of Object.entries(expected)) {
    if (receipt?.[field] !== value) throw new Error(`consume receipt mismatch: ${field}`);
  }
  const registryPublicKeySpki = resolveAuthorityKey(keyRegistry, {
    scope: "tlsn-binding-authority-key-registry",
    keyId: receipt.signer_key_id,
    at: receipt.used_at,
    label: "binding authority",
  });
  if (registryPublicKeySpki !== publicKeySpki || receipt.signer_key_id !== signerKeyId) {
    throw new Error("consume receipt signer does not match the Binding Authority registry");
  }
  verifyReceiptSignature(receipt, "attestation-binding-consumed", consumeReceiptSigningBytes(receipt), registryPublicKeySpki, signerKeyId);
}

function devicePredicateResult(name, status, verifiedAt, evidenceArtifacts, observed = {}, detail = "") {
  const definition = PRODUCTION_EVIDENCE_DEVICE_PREDICATE_DEFINITIONS[name];
  return {
    ...definition,
    status,
    verified_at: verifiedAt,
    evidence_artifacts: [...evidenceArtifacts],
    detail,
    observed,
  };
}

function runDevicePredicate(name, verifiedAt, evidenceArtifacts, callback) {
  try {
    return devicePredicateResult(name, "PASS", verifiedAt, evidenceArtifacts, callback());
  } catch (error) {
    return devicePredicateResult(
      name,
      "FAIL",
      verifiedAt,
      evidenceArtifacts,
      {},
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function assertDevicePredicateResults(predicateResults) {
  if (!predicateResults || typeof predicateResults !== "object") throw new Error("device predicate results are required");
  for (const [name, definition] of Object.entries(PRODUCTION_EVIDENCE_DEVICE_PREDICATE_DEFINITIONS)) {
    const result = predicateResults[name];
    if (!result || !["PASS", "FAIL"].includes(result.status)) throw new Error(`device predicate result is missing or invalid: ${name}`);
    if (
      JSON.stringify(result.required_artifacts) !== JSON.stringify(definition.required_artifacts) ||
      JSON.stringify(result.required_fields) !== JSON.stringify(definition.required_fields) ||
      result.verification_method !== definition.verification_method ||
      result.authority_identity !== definition.authority_identity
    ) throw new Error(`device predicate definition was substituted: ${name}`);
    if (!Array.isArray(result.evidence_artifacts) || !Array.isArray(result.derived_fields)) {
      throw new Error(`device predicate result fields are invalid: ${name}`);
    }
  }
  return predicateResults;
}

export function verifyDevicePredicates({
  deviceIdentity,
  deviceAuthentication,
  session,
  possessionProof,
  consumeReceipt,
  replay,
  result,
  presentationBytes,
  resultPublicKeySpki,
  resultSignerKeyId,
  sessionAuthorityPublicKeySpki,
  sessionAuthoritySignerKeyId,
  sessionAuthorityKeyRegistry,
  bindingAuthorityPublicKeySpki,
  bindingAuthoritySignerKeyId,
  bindingAuthorityKeyRegistry,
  verifiedAt = new Date().toISOString(),
}) {
  const expectedUserId = result?.canonical_user_id;
  const expectedDeviceId = result?.device_id;
  const expectedPresentationId = createHash("sha256").update(presentationBytes).digest("base64url");
  const predicates = {
    device_identity_ownership: runDevicePredicate("device_identity_ownership", verifiedAt, ["device_identity"], () => {
      verifyDeviceIdentity(deviceIdentity, expectedUserId, expectedDeviceId);
      return {
        canonical_user_id: deviceIdentity.canonical_user_id,
        device_id: deviceIdentity.device_id,
        device_public_key_sha256: deviceIdentity.device_public_key_sha256,
        revoked_at: deviceIdentity.revoked_at,
      };
    }),
    device_authentication_signature: runDevicePredicate("device_authentication_signature", verifiedAt, ["device_identity", "device_authentication", "session"], () => {
      const authentication = verifyDeviceAuthentication(
        deviceAuthentication,
        deviceIdentity,
        expectedUserId,
        expectedDeviceId,
        session.session_id,
      );
      return {
        device_id: expectedDeviceId,
        nonce: authentication.nonce,
        attestation_session_id: session.session_id,
      };
    }),
    session_binding_receipt: runDevicePredicate("session_binding_receipt", verifiedAt, ["session", "session_authority_registry", "result"], () => {
      verifySessionReceipt(
        session.session_receipt,
        {
          session_id: session.session_id,
          canonical_user_id: expectedUserId,
          device_id: expectedDeviceId,
          device_auth_nonce: deviceAuthentication.request.nonce,
          nonce: session.challenge,
          device_challenge: session.device_challenge,
          binding_value: session.binding,
          created_at: session.session_receipt.created_at,
          expires_at: session.expires_at,
        },
        {
          publicKeySpki: sessionAuthorityPublicKeySpki,
          signerKeyId: sessionAuthoritySignerKeyId,
          keyRegistry: sessionAuthorityKeyRegistry,
        },
      );
      return {
        attestation_session_id: session.session_id,
        binding_value: session.binding,
        binding_nonce: session.challenge,
      };
    }),
    tlsn_device_possession_signature: runDevicePredicate("tlsn_device_possession_signature", verifiedAt, ["device_identity", "possession_proof", "session"], () => {
      verifyTlsnDevicePossession(
        possessionProof,
        deviceIdentity,
        expectedUserId,
        expectedDeviceId,
        session.session_id,
        session.binding,
        session.device_challenge,
      );
      return {
        device_id: expectedDeviceId,
        attestation_session_id: session.session_id,
        binding_value: session.binding,
        device_challenge: session.device_challenge,
      };
    }),
    binding_framing: runDevicePredicate("binding_framing", verifiedAt, ["session", "result"], () => {
      const binding = parseBindingValue(session.binding);
      if (binding.sessionId !== session.session_id || binding.nonce !== session.challenge || result.binding_nonce !== session.challenge) {
        throw new Error("binding framing does not match the signed Result");
      }
      return {
        attestation_session_id: binding.sessionId,
        binding_value: session.binding,
        binding_nonce: binding.nonce,
      };
    }),
    replay_digest: runDevicePredicate("replay_digest", verifiedAt, ["possession_proof", "replay"], () => {
      const digest = deviceProofReplayDigest(expectedDeviceId, session.session_id, session.binding, session.device_challenge);
      const digestHex = deviceProofReplayDigestHex(expectedDeviceId, session.session_id, session.binding, session.device_challenge);
      if (
        possessionProof.replay_digest !== digest ||
        possessionProof.replay_digest_hex !== digestHex ||
        replay.replay_digest !== digest ||
        replay.replay_digest_hex !== digestHex ||
        replay.stored_replay_digest_hex !== digestHex ||
        replay.session_id !== session.session_id ||
        replay.device_id !== expectedDeviceId ||
        replay.binding !== session.binding ||
        replay.consume_receipt_presentation_id !== consumeReceipt.presentation_id ||
        replay.status !== 409 ||
        !["binding_consumed", "device_possession_replayed"].includes(replay.error)
      ) throw new Error("replay digest or rejection does not match the canonical proof");
      return {
        replay_digest: digest,
        replay_digest_hex: digestHex,
        stored_replay_digest_hex: replay.stored_replay_digest_hex,
        status: replay.status,
        error: replay.error,
      };
    }),
    consume_receipt: runDevicePredicate("consume_receipt", verifiedAt, ["consume_receipt", "binding_authority_registry", "result", "presentation", "session"], () => {
      verifyConsumeReceipt(
        consumeReceipt,
        {
          session_id: session.session_id,
          canonical_user_id: expectedUserId,
          device_id: expectedDeviceId,
          nonce: session.challenge,
          binding_value: session.binding,
          presentation_id: expectedPresentationId,
          used_at: consumeReceipt.used_at,
        },
        {
          publicKeySpki: bindingAuthorityPublicKeySpki,
          signerKeyId: bindingAuthoritySignerKeyId,
          keyRegistry: bindingAuthorityKeyRegistry,
        },
      );
      return {
        session_id: session.session_id,
        binding_value: session.binding,
        presentation_id: expectedPresentationId,
        used_at: consumeReceipt.used_at,
      };
    }),
  };
  return assertDevicePredicateResults(predicates);
}
