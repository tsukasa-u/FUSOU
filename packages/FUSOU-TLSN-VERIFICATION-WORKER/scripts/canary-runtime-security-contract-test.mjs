#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { resolve } from "node:path";
import { unstable_dev } from "wrangler";
import { assertCanaryHealthTrustContract } from "./deployment-attestation.mjs";
import { securityRegistrySetHash } from "./security-registry-set-contract.mjs";
import { profilesForServerIdentity } from "./profile-canonical-contract.mjs";
import {
  canonicalJson as workerCanonicalJson,
  securityRegistrySetPayload as workerSecurityRegistrySetPayload,
  sha256Base64Url,
} from "../src/origin-trust-contract.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);

function keyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

function keyRegistry(scope, keyId, publicKeySpki) {
  return JSON.stringify({
    schema_version: 1,
    scope,
    keys: [{
      key_id: keyId,
      public_key_spki: publicKeySpki,
      status: "ACTIVE",
      not_before: new Date(Date.now() - 60_000).toISOString(),
      not_after: null,
    }],
  });
}

const result = keyMaterial();
const session = keyMaterial();
const binding = keyMaterial();
const serverIdentity = "game.example.net";
const profiles = profilesForServerIdentity(serverIdentity);
const notaryKeyId = "notary-canary-runtime";
const notaryRegistryRaw = JSON.stringify({
  [notaryKeyId]: "ASEAAAAAAAAAAxuExVZ7EmRAmV0-1aq6BWXXHhg0YEgZ_5wX9enV3QeP",
});
const canaryInputs = {
  notaryKeyId,
  notaryRegistryRaw,
  profileSha256: profiles.complete.sha256,
  serverIdentity,
  sparseProfileSha256: profiles.sparse.sha256,
};
const env = {
  TLSN_ENVIRONMENT: "production",
  TLSN_DEPLOYMENT_ROLE: "canary",
  TLSN_GIT_COMMIT_SHA: "a".repeat(40),
  TLSN_BINDING_TTL_SECONDS: "60",
  TLSN_CANDIDATE_VERIFIER_KEY_ID: "verifier-canary-runtime",
  TLSN_CANDIDATE_NOTARY_KEY_ID: notaryKeyId,
  TLSN_CANDIDATE_SERVER_IDENTITY: serverIdentity,
  TLSN_CANDIDATE_PROFILE_SHA256: profiles.complete.sha256,
  TLSN_CANDIDATE_SPARSE_PROFILE_SHA256: profiles.sparse.sha256,
  TLSN_PRODUCTION_NOTARY_REGISTRY: notaryRegistryRaw,
  TLSN_SECURITY_REGISTRY_SET_SHA256: securityRegistrySetHash(canaryInputs).sha256,
  TLSN_CANDIDATE_DEVICE_AUTH_URL: "https://api.example.com/api/auth/anonymous-sync/v2/device-proof",
  TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL: "https://api.example.com/api/auth/anonymous-sync/v2/tlsn-device-proof",
  TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS: "api.example.com",
  TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS: "project.supabase.co",
  TLSN_CANDIDATE_SUPABASE_URL: "https://project.supabase.co",
  TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  TLSN_CANARY_BINDING_VALUE: Buffer.alloc(32, 9).toString("base64url"),
  TLSN_CANARY_DEPLOYMENT_ID: "canary-runtime-contract",
  TLSN_CANARY_WORKER_NAME: "fusou-tlsn-canary",
  TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8: result.privateKeyPkcs8,
  TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI: result.publicKeySpki,
  TLSN_CANARY_RESULT_SIGNER_KEY_ID: "result-canary-runtime",
  TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY: keyRegistry("tlsn-result-signing-key-registry", "result-canary-runtime", result.publicKeySpki),
  TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: session.privateKeyPkcs8,
  TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: session.publicKeySpki,
  TLSN_CANARY_SESSION_AUTHORITY_KEY_ID: "session-canary-runtime",
  TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY: keyRegistry("tlsn-session-authority-key-registry", "session-canary-runtime", session.publicKeySpki),
  TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: binding.privateKeyPkcs8,
  TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: binding.publicKeySpki,
  TLSN_CANARY_BINDING_AUTHORITY_KEY_ID: "binding-canary-runtime",
  TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY: keyRegistry("tlsn-binding-authority-key-registry", "binding-canary-runtime", binding.publicKeySpki),
};

async function startWorker(vars) {
  return unstable_dev(resolve(packageDirectory, "src/index.ts"), {
    config: resolve(packageDirectory, "wrangler.toml"),
    env: "production",
    envFiles: [],
    vars,
    persist: false,
    bundle: true,
    local: true,
    compatibilityDate: "2026-07-29",
    experimental: {
      disableExperimentalWarning: true,
      forceLocal: true,
      testMode: true,
    },
  });
}

async function observeCanary(vars) {
  const worker = await startWorker(vars);
  try {
    const sessionResponse = await worker.fetch("https://verify.test/attestation/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const healthResponse = await worker.fetch("https://verify.test/health");
    return {
      sessionStatus: sessionResponse.status,
      healthStatus: healthResponse.status,
      health: await healthResponse.json(),
    };
  } finally {
    await worker.stop();
  }
}

const valid = await observeCanary(env);
assert.equal(valid.sessionStatus, 401, "valid Canary config must pass readConfig and reach authentication");
assert.equal(valid.healthStatus, 200, "Canary health remains available for separate Runtime Attestation");
assert.equal(valid.health.security_identity.trust_contract_valid, true);
assert.equal(valid.health.security_identity.security_registry_set_sha256, env.TLSN_SECURITY_REGISTRY_SET_SHA256);
assert.equal(assertCanaryHealthTrustContract(valid.health), true);

const invalidDigestEnv = {
  ...env,
  TLSN_SECURITY_REGISTRY_SET_SHA256: createHash("sha256").update("mutated-canary-security-set").digest("base64url"),
};
const invalidDigest = await observeCanary(invalidDigestEnv);
assert.equal(invalidDigest.sessionStatus, 503, "mutated configured digest must make readConfig reject Canary");
assert.equal(invalidDigest.healthStatus, 200, "security trust failure must not suppress platform Runtime Attestation health");
assert.equal(invalidDigest.health.security_identity.trust_contract_valid, false);
assert.equal(invalidDigest.health.security_identity.security_registry_set_sha256, null);
assert.throws(() => assertCanaryHealthTrustContract(invalidDigest.health), /Canary Worker trust contract is invalid/);

const invalidNotaryRegistryRaw = JSON.stringify({ [notaryKeyId]: "A" });
const invalidNotaryPayload = workerSecurityRegistrySetPayload({
  ...canaryInputs,
  notaryRegistryRaw: invalidNotaryRegistryRaw,
});
const invalidNotaryDigest = await sha256Base64Url(
  new TextEncoder().encode(workerCanonicalJson(invalidNotaryPayload)),
);
const invalidNotary = await observeCanary({
  ...env,
  TLSN_PRODUCTION_NOTARY_REGISTRY: invalidNotaryRegistryRaw,
  TLSN_SECURITY_REGISTRY_SET_SHA256: invalidNotaryDigest,
});
assert.equal(invalidNotary.sessionStatus, 503, "unusable selected Notary key must make readConfig reject Canary");
assert.equal(invalidNotary.healthStatus, 200);
assert.equal(invalidNotary.health.security_identity.trust_contract_valid, false);
assert.equal(invalidNotary.health.security_identity.security_registry_set_sha256, null);
assert.throws(() => assertCanaryHealthTrustContract(invalidNotary.health), /Canary Worker trust contract is invalid/);

const semanticInvalidNotaryRegistryRaw = JSON.stringify({
  [notaryKeyId]: Buffer.alloc(32, 7).toString("base64url"),
});
const semanticInvalidNotaryPayload = workerSecurityRegistrySetPayload({
  ...canaryInputs,
  notaryRegistryRaw: semanticInvalidNotaryRegistryRaw,
});
const semanticInvalidNotaryDigest = await sha256Base64Url(
  new TextEncoder().encode(workerCanonicalJson(semanticInvalidNotaryPayload)),
);
const semanticInvalidNotary = await observeCanary({
  ...env,
  TLSN_PRODUCTION_NOTARY_REGISTRY: semanticInvalidNotaryRegistryRaw,
  TLSN_SECURITY_REGISTRY_SET_SHA256: semanticInvalidNotaryDigest,
});
assert.equal(semanticInvalidNotary.sessionStatus, 503, "canonical 32-byte Notary data must fail alpha.15 semantic validation");
assert.equal(semanticInvalidNotary.healthStatus, 200, "Notary trust failure must preserve Runtime Attestation health");
assert.equal(semanticInvalidNotary.health.security_identity.trust_contract_valid, false);
assert.equal(semanticInvalidNotary.health.security_identity.security_registry_set_sha256, null);
assert.throws(() => assertCanaryHealthTrustContract(semanticInvalidNotary.health), /Canary Worker trust contract is invalid/);

for (const [label, envName, changedDigest] of [
  ["complete profile", "TLSN_CANDIDATE_PROFILE_SHA256", Buffer.alloc(32, 3).toString("base64url")],
  ["sparse profile", "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256", Buffer.alloc(32, 4).toString("base64url")],
]) {
  const mutatedInputs = {
    ...canaryInputs,
    profileSha256: envName === "TLSN_CANDIDATE_PROFILE_SHA256" ? changedDigest : canaryInputs.profileSha256,
    sparseProfileSha256: envName === "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256" ? changedDigest : canaryInputs.sparseProfileSha256,
  };
  const profileMutation = await observeCanary({
    ...env,
    [envName]: changedDigest,
    TLSN_SECURITY_REGISTRY_SET_SHA256: securityRegistrySetHash(mutatedInputs).sha256,
  });
  assert.equal(profileMutation.sessionStatus, 503, `${label} hash must match the canonical fixed-origin profile`);
  assert.equal(profileMutation.health.security_identity.trust_contract_valid, false);
}

console.info("[tlsn-canary-runtime-security] canonical config, digest and profile mutation, invalid Notary keys, health, and remote-gate contracts PASS");
