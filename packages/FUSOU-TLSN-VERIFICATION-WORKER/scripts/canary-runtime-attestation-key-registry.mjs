import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertAuthorityKeyRegistry,
  authorityKeyRegistrySha256,
  resolveAuthorityKey,
} from "./authority-key-registry.mjs";

export const CANARY_RUNTIME_ATTESTATION_KEY_REGISTRY_SCOPE = "tlsn-canary-runtime-attestation-key-registry";
export const CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID_INPUT = "TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID";
export const CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT = "TLSN_CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8";
export const CANARY_RUNTIME_ATTESTATION_KEY_REGISTRY_PATH = resolve(new URL("./canary-runtime-attestation-key-registry.json", import.meta.url).pathname);

export function assertCanaryRuntimeAttestationKeyRegistry(registry, options = {}) {
  return assertAuthorityKeyRegistry(registry, {
    ...options,
    scope: CANARY_RUNTIME_ATTESTATION_KEY_REGISTRY_SCOPE,
    label: "Canary Runtime Attestation",
  });
}

export function resolveCanaryRuntimeAttestationKey(registry, { keyId, at } = {}) {
  return resolveAuthorityKey(registry, {
    scope: CANARY_RUNTIME_ATTESTATION_KEY_REGISTRY_SCOPE,
    keyId,
    at,
    label: "Canary Runtime Attestation",
  });
}

export function canaryRuntimeAttestationKeyRegistrySha256(rawRegistry) {
  return authorityKeyRegistrySha256(rawRegistry);
}

export async function loadCanaryRuntimeAttestationKeyRegistry(path = CANARY_RUNTIME_ATTESTATION_KEY_REGISTRY_PATH) {
  const rawRegistry = await readFile(path, "utf8");
  let registry;
  try {
    registry = JSON.parse(rawRegistry);
  } catch {
    throw new Error("Canary Runtime Attestation key registry is not valid JSON");
  }
  assertCanaryRuntimeAttestationKeyRegistry(registry);
  return { registry, rawRegistry };
}