#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";
import { unstable_dev } from "wrangler";
import { runProductionConfigurationFailClosedSmokeTest } from "../test/index-smoke.mjs";
import { productionSecurityRegistrySetHash } from "./security-registry-set-contract.mjs";

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
const notaryKeyId = "notary-production-config";
const sessionKeyId = "session-production-config";
const bindingKeyId = "binding-production-config";
const resultKeyId = "result-production-config";
const notaryRegistryRaw = JSON.stringify({
  [notaryKeyId]: "ASEAAAAAAAAAAxuExVZ7EmRAmV0-1aq6BWXXHhg0YEgZ_5wX9enV3QeP",
});
const securityRegistrySetSha256 = productionSecurityRegistrySetHash({
  notaryKeyId,
  notaryRegistryRaw,
}).sha256;
const env = {
  TLSN_ENVIRONMENT: "production",
  TLSN_DEPLOYMENT_ROLE: "production",
  TLSN_GIT_COMMIT_SHA: "a".repeat(40),
  TLSN_BINDING_TTL_SECONDS: "60",
  TLSN_CANDIDATE_VERIFIER_KEY_ID: "verifier-production-config",
  TLSN_CANDIDATE_NOTARY_KEY_ID: notaryKeyId,
  TLSN_PRODUCTION_NOTARY_REGISTRY: notaryRegistryRaw,
  TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8: result.privateKeyPkcs8,
  TLSN_PRODUCTION_DEPLOYMENT_ID: "production-config-only",
  TLSN_SECURITY_REGISTRY_SET_SHA256: securityRegistrySetSha256,
  TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: result.publicKeySpki,
  TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: resultKeyId,
  TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: keyRegistry("tlsn-result-signing-key-registry", resultKeyId, result.publicKeySpki),
  TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: session.privateKeyPkcs8,
  TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: session.publicKeySpki,
  TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID: sessionKeyId,
  TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY: keyRegistry("tlsn-session-authority-key-registry", sessionKeyId, session.publicKeySpki),
  TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: binding.privateKeyPkcs8,
  TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: binding.publicKeySpki,
  TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID: bindingKeyId,
  TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY: keyRegistry("tlsn-binding-authority-key-registry", bindingKeyId, binding.publicKeySpki),
  TLSN_CANDIDATE_DEVICE_AUTH_URL: "https://api.example.com/api/auth/anonymous-sync/v2/device-proof",
  TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL: "https://api.example.com/api/auth/anonymous-sync/v2/tlsn-device-proof",
  TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS: "api.example.com",
  TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS: "project.supabase.co",
  TLSN_CANDIDATE_SUPABASE_URL: "https://project.supabase.co",
  TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  TLSN_PRODUCTION_WORKER_NAME: "fusou-tlsn-production",
};

for (const staticOriginInput of [
  "TLSN_CANDIDATE_SERVER_IDENTITY",
  "TLSN_CANDIDATE_PROFILE_SHA256",
  "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256",
  "TLSN_PRODUCTION_ORIGIN_PORT",
]) {
  assert.equal(env[staticOriginInput], undefined);
}

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

const worker = await startWorker(env);
try {
  await runProductionConfigurationFailClosedSmokeTest(worker.fetch);
} finally {
  await worker.stop();
}

const mismatchedWorker = await startWorker({
  ...env,
  TLSN_SECURITY_REGISTRY_SET_SHA256: createHash("sha256").update("mismatched-production-trust").digest("base64url"),
});
try {
  const response = await mismatchedWorker.fetch("https://verify.test/health");
  assert.equal(response.status, 503);
  const health = await response.json();
  assert.equal(health.ok, false);
  assert.equal(health.security_identity.trust_contract_valid, false);
} finally {
  await mismatchedWorker.stop();
}