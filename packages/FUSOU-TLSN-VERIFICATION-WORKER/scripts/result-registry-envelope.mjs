import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { assertSigningKeyRegistry } from "./signing-key-registry.mjs";
import { canonicalJson, sha256Base64Url } from "./deployment-attestation.mjs";

export const RESULT_REGISTRY_ENVELOPE_SCHEMA_VERSION = 1;
export const RESULT_REGISTRY_ENVELOPE_SCOPE = "fusou-result-signing-key-registry-envelope";
export const RESULT_REGISTRY_ENVELOPE_SIGNATURE_ALGORITHM = "Ed25519";
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ENVELOPE_PAYLOAD_FIELDS = [
  "schema_version",
  "scope",
  "signature_algorithm",
  "root_key_id",
  "root_public_key_spki",
  "registry_sha256",
  "registry",
];

function decodeBase64Url(value, label, expectedLength) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) throw new Error(`${label} is not canonical base64url`);
  if (expectedLength !== undefined && bytes.length !== expectedLength) throw new Error(`${label} has an invalid length`);
  return bytes;
}

function publicKeySpki(publicKey, label) {
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error(`${label} is not Ed25519`);
  return publicKey.export({ format: "der", type: "spki" }).toString("base64url");
}

function publicKeyFromSpki(value, label) {
  const key = createPublicKey({ key: decodeBase64Url(value, label), format: "der", type: "spki" });
  publicKeySpki(key, label);
  return key;
}

function privateKeyFromPkcs8(value, label) {
  const key = createPrivateKey({ key: decodeBase64Url(value, label), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${label} is not Ed25519`);
  return key;
}

export function resultRegistryEnvelopePayload(envelope) {
  const payload = {};
  for (const field of ENVELOPE_PAYLOAD_FIELDS) {
    if (!(field in (envelope ?? {}))) throw new Error(`result registry envelope is missing ${field}`);
    payload[field] = envelope[field];
  }
  return canonicalJson(payload);
}

export function resultRegistryRawSha256(rawRegistry) {
  return createHash("sha256").update(rawRegistry).digest("base64url");
}

export function createSignedResultRegistryEnvelope({
  registry,
  registryRaw = `${JSON.stringify(registry)}\n`,
  rootKeyId,
  rootPublicKeySpki,
  rootPrivateKeyPkcs8,
}) {
  assertSigningKeyRegistry(registry);
  if (!KEY_ID_PATTERN.test(rootKeyId ?? "")) throw new Error("result registry root key ID is invalid");
  const privateKey = privateKeyFromPkcs8(rootPrivateKeyPkcs8, "result registry root private key");
  const derivedPublicKeySpki = publicKeySpki(createPublicKey(privateKey), "result registry root key");
  if (derivedPublicKeySpki !== rootPublicKeySpki) throw new Error("result registry root key pair does not match");
  const envelope = {
    schema_version: RESULT_REGISTRY_ENVELOPE_SCHEMA_VERSION,
    scope: RESULT_REGISTRY_ENVELOPE_SCOPE,
    signature_algorithm: RESULT_REGISTRY_ENVELOPE_SIGNATURE_ALGORITHM,
    root_key_id: rootKeyId,
    root_public_key_spki: rootPublicKeySpki,
    registry_sha256: resultRegistryRawSha256(registryRaw),
    registry,
  };
  return {
    ...envelope,
    signature_base64url: sign(null, Buffer.from(resultRegistryEnvelopePayload(envelope)), privateKey).toString("base64url"),
  };
}

export function assertSignedResultRegistryEnvelope(
  envelope,
  {
    registry,
    registryRaw,
    trustedRootKeyId,
    trustedRootPublicKeySpki,
  } = {},
) {
  if (
    envelope?.schema_version !== RESULT_REGISTRY_ENVELOPE_SCHEMA_VERSION ||
    envelope?.scope !== RESULT_REGISTRY_ENVELOPE_SCOPE ||
    envelope?.signature_algorithm !== RESULT_REGISTRY_ENVELOPE_SIGNATURE_ALGORITHM
  ) throw new Error("result registry envelope schema is invalid");
  if (!KEY_ID_PATTERN.test(envelope.root_key_id ?? "")) throw new Error("result registry root key ID is invalid");
  if (envelope.root_key_id !== trustedRootKeyId || envelope.root_public_key_spki !== trustedRootPublicKeySpki) {
    throw new Error("result registry root identity does not match the trusted pin");
  }
  const publicKey = publicKeyFromSpki(trustedRootPublicKeySpki, "trusted result registry root public key");
  const signature = decodeBase64Url(envelope.signature_base64url, "result registry envelope signature", 64);
  if (!registry || !registryRaw) throw new Error("result registry bytes are required");
  assertSigningKeyRegistry(registry);
  if (canonicalJson(envelope.registry) !== canonicalJson(registry)) {
    throw new Error("result registry envelope payload does not match the captured registry");
  }
  if (envelope.registry_sha256 !== resultRegistryRawSha256(registryRaw)) {
    throw new Error("result registry envelope digest does not match the captured registry bytes");
  }
  if (!verify(null, Buffer.from(resultRegistryEnvelopePayload(envelope)), publicKey, signature)) {
    throw new Error("result registry envelope signature is invalid");
  }
  return envelope;
}

export function resultRegistryEnvelopeHash(rawEnvelope) {
  if (typeof rawEnvelope !== "string" && !Buffer.isBuffer(rawEnvelope) && !(rawEnvelope instanceof Uint8Array)) {
    throw new Error("raw result registry envelope bytes are required");
  }
  return sha256Base64Url(rawEnvelope);
}
