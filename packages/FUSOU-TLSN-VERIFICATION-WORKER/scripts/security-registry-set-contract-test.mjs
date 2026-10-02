#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  productionSecurityRegistrySetHash,
  securityRegistrySetHash,
} from "./security-registry-set-contract.mjs";
import { loadOriginInventoryContract } from "./origin-inventory-contract.mjs";

const notaryKeyId = "notary-production-2026";
const alternateNotaryKeyId = "notary-production-2025";
const notaryRegistry = JSON.stringify({
  [notaryKeyId]: "ASEAAAAAAAAAAxuExVZ7EmRAmV0-1aq6BWXXHhg0YEgZ_5wX9enV3QeP",
});
const registryWithAlternateKey = JSON.stringify({
  [notaryKeyId]: "ASEAAAAAAAAAAxuExVZ7EmRAmV0-1aq6BWXXHhg0YEgZ_5wX9enV3QeP",
  [alternateNotaryKeyId]: "ASEAAAAAAAAAAwdAv1ROf_qFyznpNgrsGYoIZ-ACK18PYlD8vV2IuVmO",
});
const baseInputs = {
  notaryKeyId,
  notaryRegistryRaw: notaryRegistry,
  profileSha256: Buffer.alloc(32, 1).toString("base64url"),
  serverIdentity: "canary.example.net",
  sparseProfileSha256: Buffer.alloc(32, 2).toString("base64url"),
};
const base = securityRegistrySetHash(baseInputs);

assert.deepEqual(Object.keys(base.payload), [
  "notary_key_id",
  "notary_registry",
  "profile_sha256",
  "server_identity",
  "sparse_profile_sha256",
]);

for (const [label, inputs] of [
  ["Notary registry", { notaryRegistryRaw: registryWithAlternateKey }],
  ["Notary key ID", { notaryKeyId: alternateNotaryKeyId, notaryRegistryRaw: registryWithAlternateKey }],
  ["complete profile hash", { profileSha256: Buffer.alloc(32, 3).toString("base64url") }],
  ["sparse profile hash", { sparseProfileSha256: Buffer.alloc(32, 4).toString("base64url") }],
  ["server identity", { serverIdentity: "other.example.net" }],
]) {
  assert.notEqual(
    securityRegistrySetHash({ ...baseInputs, ...inputs }).sha256,
    base.sha256,
    `${label} mutation must change the security registry set hash`,
  );
}

assert.equal(
  securityRegistrySetHash({
    ...baseInputs,
    deploymentId: "different-deployment",
    responseMode: "sync",
    workerName: "different-worker",
    trustRoot: "different-trust-root",
    resultSigningKey: "different-result-key",
    callbackSecret: "different-callback-secret",
    accessToken: "different-access-token",
  }).sha256,
  base.sha256,
  "excluded deployment and runtime values must not change the security registry set hash",
);

assert.throws(
  () => securityRegistrySetHash({ ...baseInputs, notaryKeyId: "missing-key" }),
  /notary_key_id must be present/,
);
assert.throws(
  () => securityRegistrySetHash({ ...baseInputs, notaryKeyId: "bad key" }),
  /notary_key_id must be a valid key ID/,
);

const production = productionSecurityRegistrySetHash({ notaryKeyId, notaryRegistryRaw: notaryRegistry });
assert.deepEqual(Object.keys(production.payload), [
  "notary_key_id",
  "notary_registry",
  "origin_inventory_sha256",
  "profile_policy_sha256",
]);
assert.equal(production.payload.origin_inventory_sha256, loadOriginInventoryContract().sha256);
assert.match(production.payload.profile_policy_sha256, /^[A-Za-z0-9_-]{43}$/);
assert.equal(
  productionSecurityRegistrySetHash({
    notaryKeyId,
    notaryRegistryRaw: notaryRegistry,
    serverIdentity: "unbound.example.net",
    profileSha256: Buffer.alloc(32, 3).toString("base64url"),
    sparseProfileSha256: Buffer.alloc(32, 4).toString("base64url"),
  }).sha256,
  production.sha256,
  "Production trust-set hash must not bind a single candidate identity or profile digest",
);
assert.notEqual(
  productionSecurityRegistrySetHash({
    notaryKeyId: alternateNotaryKeyId,
    notaryRegistryRaw: registryWithAlternateKey,
  }).sha256,
  production.sha256,
  "Production selected Notary identity remains hash-bound",
);

console.log("[security-registry-set-contract] role-specific identity, inventory, profile-policy, and Notary bindings PASS");
