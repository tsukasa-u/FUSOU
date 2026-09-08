import { createHash, createPublicKey } from "node:crypto";

export const AUTHORITY_KEY_REGISTRY_SCHEMA_VERSION = 1;
export const AUTHORITY_KEY_STATUSES = ["ACTIVE", "VERIFY_ONLY", "RETIRED", "REVOKED"];
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SPKI_LENGTH = 59;

function assertTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
}

function assertPublicKey(value, label) {
  if (typeof value !== "string" || value.length !== SPKI_LENGTH || !BASE64URL_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical Ed25519 SPKI public key`);
  }
  try {
    const key = createPublicKey({
      key: Buffer.from(value, "base64url"),
      format: "der",
      type: "spki",
    });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
  } catch {
    throw new Error(`${label} must be a valid Ed25519 SPKI public key`);
  }
}

export function assertAuthorityKeyRegistry(registry, {
  scope,
  currentKeyId,
  currentPublicKeySpki,
  now = new Date(),
  label = "authority",
} = {}) {
  if (
    registry?.schema_version !== AUTHORITY_KEY_REGISTRY_SCHEMA_VERSION ||
    registry?.scope !== scope ||
    !Array.isArray(registry?.keys) ||
    registry.keys.length === 0
  ) {
    throw new Error(`invalid ${label} key registry schema`);
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error(`${label} key registry validation time is invalid`);
  const seen = new Set();
  for (const [index, key] of registry.keys.entries()) {
    if (!KEY_ID_PATTERN.test(key?.key_id ?? "") || seen.has(key.key_id)) {
      throw new Error(`invalid or duplicate ${label} key ID at index ${index}`);
    }
    seen.add(key.key_id);
    assertPublicKey(key.public_key_spki, `${label} key ${key.key_id}`);
    if (!AUTHORITY_KEY_STATUSES.includes(key.status)) {
      throw new Error(`invalid status for ${label} key ${key.key_id}`);
    }
    assertTimestamp(key.not_before, `${label} key ${key.key_id}.not_before`);
    if (key.not_after !== null) assertTimestamp(key.not_after, `${label} key ${key.key_id}.not_after`);
    if (key.not_after !== null && Date.parse(key.not_after) <= Date.parse(key.not_before)) {
      throw new Error(`${label} key ${key.key_id} has an invalid validity window`);
    }
  }
  if (currentKeyId !== undefined || currentPublicKeySpki !== undefined) {
    if (typeof currentKeyId !== "string" || typeof currentPublicKeySpki !== "string") {
      throw new Error(`current ${label} key identity is required`);
    }
    const current = registry.keys.find((key) => key.key_id === currentKeyId);
    if (!current || current.public_key_spki !== currentPublicKeySpki) {
      throw new Error(`current ${label} key is not the published registry key`);
    }
    if (current.status !== "ACTIVE") throw new Error(`current ${label} key is not ACTIVE`);
    if (Date.parse(current.not_before) > nowMs || (current.not_after !== null && Date.parse(current.not_after) < nowMs)) {
      throw new Error(`current ${label} key is outside its validity window`);
    }
  }
  return registry;
}

export function resolveAuthorityKey(registry, {
  scope,
  keyId,
  at,
  label = "authority",
} = {}) {
  assertAuthorityKeyRegistry(registry, { scope, label });
  const atMs = at instanceof Date ? at.getTime() : Date.parse(at);
  if (!Number.isFinite(atMs)) throw new Error(`${label} receipt time is invalid`);
  const key = registry.keys.find((candidate) => candidate.key_id === keyId);
  if (!key) throw new Error(`${label} signer key is not in the published registry`);
  if (key.status === "REVOKED") {
    throw new Error(`${label} signer key is not valid for verification`);
  }
  if (Date.parse(key.not_before) > atMs || (key.not_after !== null && Date.parse(key.not_after) < atMs)) {
    throw new Error(`${label} signer key is outside its validity window`);
  }
  return key.public_key_spki;
}

export function authorityKeyRegistrySha256(rawRegistry) {
  return createHash("sha256").update(rawRegistry).digest("base64url");
}