import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { canonicalJson } from "./deployment-attestation.mjs";
import {
  assertCanaryRuntimeAttestationKeyRegistry,
  resolveCanaryRuntimeAttestationKey,
} from "./canary-runtime-attestation-key-registry.mjs";

export const CANARY_RUNTIME_ATTESTATION_SIGNATURE_ALGORITHM = "Ed25519";

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ED25519_SIGNATURE_LENGTH = 64;

function requiredKeyId(value, label) {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function decodeBase64Url(value, label, expectedLength) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) throw new Error(`${label} must be canonical base64url`);
  if (expectedLength !== undefined && bytes.length !== expectedLength) throw new Error(`${label} has an invalid length`);
  return bytes;
}

function privateKeyFromPkcs8(value) {
  const privateKey = createPrivateKey({
    key: decodeBase64Url(value, "Canary Runtime Attestation signing private key"),
    format: "der",
    type: "pkcs8",
  });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Canary Runtime Attestation signing key is not Ed25519");
  return privateKey;
}

function publicKeyFromSpki(value, label) {
  const publicKey = createPublicKey({
    key: decodeBase64Url(value, label),
    format: "der",
    type: "spki",
  });
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error(`${label} is not Ed25519`);
  return publicKey;
}

function derivedPublicKeySpki(privateKey) {
  return createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64url");
}

function capturedAtMilliseconds(attestation) {
  const capturedAt = Date.parse(attestation?.captured_at ?? "");
  if (!Number.isFinite(capturedAt)) throw new Error("Canary Runtime Attestation captured_at is invalid");
  return capturedAt;
}

function validateCanaryRuntimeAttestationSigner({
  signerKeyId,
  signingPrivateKeyPkcs8,
  registry,
  now = new Date(),
} = {}) {
  const keyId = requiredKeyId(signerKeyId, "Canary Runtime Attestation signer key ID");
  const privateKey = privateKeyFromPkcs8(signingPrivateKeyPkcs8);
  const publicKeySpki = derivedPublicKeySpki(privateKey);
  assertCanaryRuntimeAttestationKeyRegistry(registry, {
    currentKeyId: keyId,
    currentPublicKeySpki: publicKeySpki,
    now,
  });
  return { keyId, privateKey, publicKeySpki };
}

export function assertCanaryRuntimeAttestationSigner(options = {}) {
  const { keyId, publicKeySpki } = validateCanaryRuntimeAttestationSigner(options);
  return {
    signer_key_id: keyId,
    public_key_spki: publicKeySpki,
  };
}

export function canonicalCanaryRuntimeAttestationPayload(attestation) {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
    throw new Error("Canary Runtime Attestation signing payload is malformed");
  }
  const payload = { ...attestation };
  delete payload.signature_base64url;
  return canonicalJson(payload);
}

export function signCanaryRuntimeAttestation(
  attestation,
  {
    signerKeyId,
    signingPrivateKeyPkcs8,
    registry,
    now = new Date(),
  } = {},
) {
  if (attestation?.attestation_signer_key_id !== undefined || attestation?.signature_algorithm !== undefined || attestation?.signature_base64url !== undefined) {
    throw new Error("Canary Runtime Attestation must be unsigned before signing");
  }
  const { keyId, privateKey } = validateCanaryRuntimeAttestationSigner({
    signerKeyId,
    signingPrivateKeyPkcs8,
    registry,
    now,
  });
  const signed = {
    ...attestation,
    attestation_signer_key_id: keyId,
    signature_algorithm: CANARY_RUNTIME_ATTESTATION_SIGNATURE_ALGORITHM,
  };
  return {
    ...signed,
    signature_base64url: sign(null, Buffer.from(canonicalCanaryRuntimeAttestationPayload(signed), "utf8"), privateKey).toString("base64url"),
  };
}

export function assertCanaryRuntimeAttestationSignature(attestation, { registry } = {}) {
  const keyId = requiredKeyId(attestation?.attestation_signer_key_id, "Canary Runtime Attestation signer key ID");
  if (attestation?.signature_algorithm !== CANARY_RUNTIME_ATTESTATION_SIGNATURE_ALGORITHM) {
    throw new Error("Canary Runtime Attestation signature algorithm is invalid");
  }
  const capturedAt = capturedAtMilliseconds(attestation);
  assertCanaryRuntimeAttestationKeyRegistry(registry);
  const publicKeySpki = resolveCanaryRuntimeAttestationKey(registry, { keyId, at: new Date(capturedAt) });
  const publicKey = publicKeyFromSpki(publicKeySpki, "Canary Runtime Attestation signer public key");
  const signature = decodeBase64Url(attestation.signature_base64url, "Canary Runtime Attestation signature", ED25519_SIGNATURE_LENGTH);
  if (!verify(null, Buffer.from(canonicalCanaryRuntimeAttestationPayload(attestation), "utf8"), publicKey, signature)) {
    throw new Error("Canary Runtime Attestation signature is invalid");
  }
  return {
    status: "VALID",
    signer_key_id: keyId,
    signature_algorithm: CANARY_RUNTIME_ATTESTATION_SIGNATURE_ALGORITHM,
  };
}