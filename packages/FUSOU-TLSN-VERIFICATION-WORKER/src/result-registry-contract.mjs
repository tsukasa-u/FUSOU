import { canonicalJson, sha256Base64Url } from "./origin-trust-contract.mjs";

export const RESULT_REGISTRY_ENVELOPE_SCHEMA_VERSION = 1;
export const RESULT_REGISTRY_ENVELOPE_SCOPE = "fusou-result-signing-key-registry-envelope";
export const RESULT_REGISTRY_ENVELOPE_SIGNATURE_ALGORITHM = "Ed25519";

const ENVELOPE_FIELDS = [
  "schema_version",
  "scope",
  "signature_algorithm",
  "root_key_id",
  "root_public_key_spki",
  "registry_sha256",
  "registry",
  "signature_base64url",
];
const ENVELOPE_PAYLOAD_FIELDS = ENVELOPE_FIELDS.filter((field) => field !== "signature_base64url");
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ED25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function decodeCanonicalBase64Url(value, label, expectedLength) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) {
    throw new Error(`${label} must be canonical base64url`);
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(`${label} has an invalid length`);
  }
  return bytes;
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function parseJsonObject(raw, label) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`${label} bytes are required`);
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      new TextEncoder().encode(raw),
    ));
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function assertExactFields(value, fields, label) {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new Error(`${label} field inventory is invalid`);
  }
}

export function selectProductionResultRegistryBindings(bindings, role) {
  if (role !== "production" && role !== "canary") {
    throw new Error("Production Result registry role is invalid");
  }
  const selected = bindings?.[role];
  if (!selected || typeof selected !== "object") {
    throw new Error("Production Result registry bindings are missing");
  }
  return Object.freeze({
    publicKeySpki: selected.publicKeySpki,
    signerKeyId: selected.signerKeyId,
    registryRaw: selected.registryRaw,
    registryEnvelopeRaw: selected.registryEnvelopeRaw,
    rootKeyId: selected.rootKeyId,
    rootPublicKeySpki: selected.rootPublicKeySpki,
  });
}

export function hasActiveResultSigningKey(registry, signerKeyId, signerPublicKeySpki, nowMs = Date.now()) {
  if (
    !registry ||
    !Array.isArray(registry.keys) ||
    typeof signerKeyId !== "string" ||
    typeof signerPublicKeySpki !== "string" ||
    !Number.isFinite(nowMs)
  ) {
    return false;
  }
  const current = registry.keys.find((key) => key?.key_id === signerKeyId);
  if (
    !current ||
    current.public_key_spki !== signerPublicKeySpki ||
    current.status !== "ACTIVE"
  ) {
    return false;
  }
  const notBefore = Date.parse(current.not_before);
  if (!Number.isFinite(notBefore) || notBefore > nowMs) {
    return false;
  }
  if (current.not_after !== null) {
    const notAfter = Date.parse(current.not_after);
    if (!Number.isFinite(notAfter) || notAfter < nowMs) {
      return false;
    }
  }
  return true;
}

export async function verifySignedResultRegistryEnvelope({
  registryRaw,
  registryEnvelopeRaw,
  trustedRootKeyId,
  trustedRootPublicKeySpki,
}) {
  if (!KEY_ID_PATTERN.test(trustedRootKeyId ?? "")) {
    throw new Error("Result registry root key ID is invalid");
  }
  const trustedRootBytes = decodeCanonicalBase64Url(
    trustedRootPublicKeySpki,
    "trusted Result registry root SPKI",
    44,
  );
  if (!ED25519_SPKI_PREFIX.every((byte, index) => trustedRootBytes[index] === byte)) {
    throw new Error("trusted Result registry root is not an Ed25519 SPKI key");
  }

  const registry = parseJsonObject(registryRaw, "Result key registry");
  const envelope = parseJsonObject(registryEnvelopeRaw, "Result registry envelope");
  assertExactFields(envelope, ENVELOPE_FIELDS, "Result registry envelope");
  if (
    envelope.schema_version !== RESULT_REGISTRY_ENVELOPE_SCHEMA_VERSION ||
    envelope.scope !== RESULT_REGISTRY_ENVELOPE_SCOPE ||
    envelope.signature_algorithm !== RESULT_REGISTRY_ENVELOPE_SIGNATURE_ALGORITHM
  ) {
    throw new Error("Result registry envelope schema is invalid");
  }
  if (
    envelope.root_key_id !== trustedRootKeyId ||
    envelope.root_public_key_spki !== trustedRootPublicKeySpki
  ) {
    throw new Error("Result registry root identity does not match the Worker trust binding");
  }
  if (
    typeof envelope.registry_sha256 !== "string" ||
    !SHA256_BASE64URL_PATTERN.test(envelope.registry_sha256) ||
    envelope.registry_sha256 !== await sha256Base64Url(new TextEncoder().encode(registryRaw))
  ) {
    throw new Error("Result registry envelope digest does not match the Worker registry bytes");
  }
  if (canonicalJson(envelope.registry) !== canonicalJson(registry)) {
    throw new Error("Result registry envelope content does not match the Worker registry");
  }

  const signature = decodeCanonicalBase64Url(
    envelope.signature_base64url,
    "Result registry envelope signature",
    64,
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    trustedRootBytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const signedPayload = Object.fromEntries(
    ENVELOPE_PAYLOAD_FIELDS.map((field) => [field, envelope[field]]),
  );
  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    signature,
    new TextEncoder().encode(canonicalJson(signedPayload)),
  );
  if (!valid) {
    throw new Error("Result registry envelope signature is invalid");
  }
  return true;
}
