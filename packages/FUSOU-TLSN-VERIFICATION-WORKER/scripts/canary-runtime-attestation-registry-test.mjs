#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  assertCanaryRuntimeAttestationKeyRegistry,
  CANARY_RUNTIME_ATTESTATION_KEY_REGISTRY_SCOPE,
  loadCanaryRuntimeAttestationKeyRegistry,
  canaryRuntimeAttestationKeyRegistrySha256,
} from "./canary-runtime-attestation-key-registry.mjs";

const EXPECTED_REPOSITORY_REGISTRY_SHA256 = "jg-HDJmXXpdUjRoqJ7WUg__SC0gZUrrsbb2u_qqZJDw";
const { registry, rawRegistry } = await loadCanaryRuntimeAttestationKeyRegistry();
const activeKeys = registry.keys.filter((key) => key.status === "ACTIVE");
assert.equal(registry.schema_version, 1);
assert.equal(registry.scope, CANARY_RUNTIME_ATTESTATION_KEY_REGISTRY_SCOPE);
assert.equal(activeKeys.length, 1, "repository registry must have exactly one current signer");
assert.equal(canaryRuntimeAttestationKeyRegistrySha256(rawRegistry), EXPECTED_REPOSITORY_REGISTRY_SHA256);

const currentKey = activeKeys[0];
assertCanaryRuntimeAttestationKeyRegistry(registry, {
  currentKeyId: currentKey.key_id,
  currentPublicKeySpki: currentKey.public_key_spki,
  now: "2026-09-25T00:00:00.000Z",
});

for (const [label, mutate] of [
  ["schema version", (value) => ({ ...value, schema_version: 2 })],
  ["scope", (value) => ({ ...value, scope: "other-trust-root" })],
  ["algorithm/public key", (value) => ({ ...value, keys: [{ ...value.keys[0], public_key_spki: value.keys[0].public_key_spki.slice(0, -1) }] })],
  ["status", (value) => ({ ...value, keys: [{ ...value.keys[0], status: "UNKNOWN" }] })],
  ["validity", (value) => ({ ...value, keys: [{ ...value.keys[0], not_before: "2027-01-01T00:00:00.000Z" }] })],
]) {
  assert.throws(() => assertCanaryRuntimeAttestationKeyRegistry(mutate(registry), {
    currentKeyId: currentKey.key_id,
    currentPublicKeySpki: currentKey.public_key_spki,
    now: "2026-09-25T00:00:00.000Z",
  }), undefined, `${label} mutation must fail closed`);
}

assert.throws(() => assertCanaryRuntimeAttestationKeyRegistry(registry, {
  currentKeyId: currentKey.key_id,
  currentPublicKeySpki: `${currentKey.public_key_spki.slice(0, -1)}A`,
  now: "2026-09-25T00:00:00.000Z",
}), /published registry key/);

console.log("[tlsn-canary-runtime-attestation-registry] repository-root schema, digest, current-key, algorithm, status, and validity contract PASS");