import {
  assertAuthorityKeyRegistry,
  authorityKeyRegistrySha256,
  AUTHORITY_KEY_REGISTRY_SCHEMA_VERSION,
  AUTHORITY_KEY_STATUSES,
} from "./authority-key-registry.mjs";

export const SIGNING_KEY_REGISTRY_SCHEMA_VERSION = AUTHORITY_KEY_REGISTRY_SCHEMA_VERSION;
export const SIGNING_KEY_REGISTRY_SCOPE = "tlsn-result-signing-key-registry";
export const SIGNING_KEY_STATUSES = AUTHORITY_KEY_STATUSES;

export function assertSigningKeyRegistry(registry, {
  currentKeyId,
  currentPublicKeySpki,
  now = new Date(),
} = {}) {
  return assertAuthorityKeyRegistry(registry, {
    scope: SIGNING_KEY_REGISTRY_SCOPE,
    currentKeyId,
    currentPublicKeySpki,
    now,
    label: "result signing",
  });
}

export function signingKeyRegistrySha256(rawRegistry) {
  return authorityKeyRegistrySha256(rawRegistry);
}