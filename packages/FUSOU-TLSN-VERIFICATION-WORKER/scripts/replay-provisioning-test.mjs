#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeReplayDeploymentEnvironment } from "./replay-deployment-environment.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const deployReplay = await readFile(resolve(packageDirectory, "scripts/deploy-replay.mjs"), "utf8");
const replayProvisioning = await readFile(resolve(packageDirectory, "scripts/provision-tlsn-replay.mjs"), "utf8");
const replayValidation = await readFile(resolve(packageDirectory, "scripts/remote-replay-validation.mjs"), "utf8");
const replayConfig = await readFile(resolve(packageDirectory, "wrangler.replay.toml"), "utf8");
const replayBootstrapConfig = await readFile(resolve(packageDirectory, "wrangler.replay-bootstrap.toml"), "utf8");
const replayVerifierConfig = await readFile(resolve(packageDirectory, "wrangler.verifier-replay.toml"), "utf8");
const source = await readFile(resolve(packageDirectory, "src/index.ts"), "utf8");
const envExample = await readFile(resolve(packageDirectory, ".env.example"), "utf8");
const packageJson = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"));

assert.match(packageJson.scripts["deploy:replay"], /deploy-replay\.mjs/);
assert.match(packageJson.scripts["test:replay-provisioning"], /replay-provisioning-test\.mjs/);
assert.match(packageJson.scripts["provision:replay"], /provision-tlsn-replay\.mjs/);
assert.match(packageJson.scripts["validate:replay"], /remote-replay-validation\.mjs/);
assert.match(deployReplay, /normalizeReplayDeploymentEnvironment\(process\.env\)/);
assert.match(deployReplay, /gitOutput\(\["status", "--porcelain=v1"\]\)/);
assert.match(deployReplay, /gitOutput\(\["rev-parse", "HEAD"\]\)/);
for (const input of [
  "TLSN_REPLAY_ENVIRONMENT_CONFIRMATION",
  "TLSN_REPLAY_SUPABASE_URL",
  "TLSN_REPLAY_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_REPLAY_DEVICE_AUTH_URL",
  "TLSN_REPLAY_DEVICE_POSSESSION_AUTH_URL",
  "TLSN_REPLAY_AUTH_USERS",
  "TLSN_REPLAY_DEVICE_ID",
  "TLSN_REPLAY_DEVICE_PUBLIC_KEY",
]) {
  assert.match(envExample, new RegExp(`^${input}=`, "m"));
}

const replayInput = {
  TLSN_REPLAY_ENVIRONMENT_CONFIRMATION: "non-production-synthetic",
  TLSN_REPLAY_SUPABASE_URL: "https://supabase.synthetic.local",
  TLSN_REPLAY_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
  TLSN_REPLAY_DEVICE_AUTH_URL: "https://auth.synthetic.local/api/auth/anonymous-sync/v2/device-proof",
  TLSN_REPLAY_DEVICE_POSSESSION_AUTH_URL: "https://auth.synthetic.local/api/auth/anonymous-sync/v2/tlsn-device-proof",
  TLSN_REPLAY_AUTH_USERS: JSON.stringify({ "synthetic-token": { id: "55555555-5555-4555-8555-555555555555", is_anonymous: false } }),
  TLSN_REPLAY_DEVICE_ID: "33333333-3333-4333-8333-333333333333",
  TLSN_REPLAY_DEVICE_PUBLIC_KEY: "A".repeat(43),
  TLSN_REPLAY_BINDING_VALUE: "synthetic-binding-value",
  TLSN_REPLAY_DEPLOYMENT_ID: "replay-current-test",
  TLSN_REPLAY_WORKER_NAME: "fusou-tlsn-verification-replay",
};
const normalized = normalizeReplayDeploymentEnvironment(replayInput);
assert.equal(normalized.TLSN_SUPABASE_URL, replayInput.TLSN_REPLAY_SUPABASE_URL);
assert.equal(normalized.TLSN_SUPABASE_PUBLISHABLE_KEY, replayInput.TLSN_REPLAY_SUPABASE_PUBLISHABLE_KEY);
assert.equal(normalized.TLSN_DEVICE_AUTH_URL, replayInput.TLSN_REPLAY_DEVICE_AUTH_URL);
assert.equal(normalized.TLSN_DEVICE_POSSESSION_AUTH_URL, replayInput.TLSN_REPLAY_DEVICE_POSSESSION_AUTH_URL);
assert.equal(normalized.TLSN_TEST_BINDING_VALUE, replayInput.TLSN_REPLAY_BINDING_VALUE);
assert.equal(normalized.TLSN_REPLAY_AUTH_USERS, replayInput.TLSN_REPLAY_AUTH_USERS);
assert.equal(normalized.TLSN_REPLAY_DEVICE_ID, replayInput.TLSN_REPLAY_DEVICE_ID);
assert.equal(normalized.TLSN_REPLAY_DEVICE_PUBLIC_KEY, replayInput.TLSN_REPLAY_DEVICE_PUBLIC_KEY);
assert.equal(normalized.TLSN_ENVIRONMENT, "test");
assert.equal(normalized.TLSN_DEPLOYMENT_ROLE, "replay");
assert.equal(normalized.TLSN_EXECUTION_MODE, "direct");
assert.equal(normalized.TLSN_BENCHMARK_TIMINGS, "true");
assert.equal(replayInput.TLSN_SUPABASE_URL, undefined);
const replayInputWithoutWorkerName = { ...replayInput };
delete replayInputWithoutWorkerName.TLSN_REPLAY_WORKER_NAME;
assert.equal(
  normalizeReplayDeploymentEnvironment(replayInputWithoutWorkerName).TLSN_REPLAY_WORKER_NAME,
  "fusou-tlsn-verification-replay",
);

function assertRejectsWithoutSecret(environment, pattern, secret) {
  assert.throws(() => normalizeReplayDeploymentEnvironment(environment), (error) => {
    assert.match(error.message, pattern);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
}

for (const forbiddenInput of [
  "TLSN_SUPABASE_URL",
  "TLSN_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_DEVICE_AUTH_URL",
  "TLSN_DEVICE_POSSESSION_AUTH_URL",
]) {
  assertRejectsWithoutSecret(
    { ...replayInput, [forbiddenInput]: "caller-internal-secret" },
    new RegExp(`${forbiddenInput} must not be present`),
    "caller-internal-secret",
  );
}
for (const forbiddenPrefix of ["TLSN_CANARY_", "TLSN_PRODUCTION_", "TLSN_CANDIDATE_"]) {
  assertRejectsWithoutSecret(
    { ...replayInput, [`${forbiddenPrefix}BACKEND_URL`]: "contamination" },
    new RegExp(`${forbiddenPrefix}BACKEND_URL must not be present`),
    "contamination",
  );
}

for (const invalidUrl of [
  "http://auth.synthetic.local",
  "https://user:password@auth.synthetic.local",
  "https://auth.synthetic.local:8443",
  "https://auth.synthetic.local?query=1",
  "https://auth.synthetic.local#fragment",
  "https://auth.example",
  "https://kancolle-server.com",
]) {
  assertRejectsWithoutSecret(
    { ...replayInput, TLSN_REPLAY_SUPABASE_URL: invalidUrl },
    /TLSN_REPLAY_SUPABASE_URL must be a non-placeholder HTTPS URL/,
    invalidUrl,
  );
}
assertRejectsWithoutSecret(
  {
    ...replayInput,
    TLSN_REPLAY_DEVICE_AUTH_URL: "https://auth.synthetic.local/wrong-path",
  },
  /TLSN_REPLAY_DEVICE_AUTH_URL must use the exact path/,
  "wrong-path",
);

for (const config of [replayConfig, replayBootstrapConfig]) {
  assert.match(config, /fusou-tlsn-verification-replay/);
  assert.match(config, /fusou-tlsn-verification-replay/);
  assert.doesNotMatch(config, /fusou-tlsn-verification-(?:test|canary|production|evidence)/);
  assert.match(config, /bucket_name = "fusou-tlsn-verification-replay"/);
  assert.match(config, /new_sqlite_classes = \["TlsnBindingAuthorityDurableObject"\]/);
}
assert.match(replayVerifierConfig, /name = "fusou-tlsn-verifier-replay"/);
assert.match(replayVerifierConfig, /script_name = "fusou-tlsn-verification-replay"/);
assert.match(replayVerifierConfig, /bucket_name = "fusou-tlsn-verification-replay"/);
assert.doesNotMatch(replayVerifierConfig, /fusou-tlsn-verifier-(?:test|canary|evidence)/);

assert.match(source, /role === "replay"/);
assert.match(source, /bindingMode[\s\S]*?"fixed"/);
assert.match(source, /TLSN_REPLAY_DEPLOYMENT_ID/);
assert.match(source, /TLSN_REPLAY_WORKER_NAME/);
assert.match(source, /env\.TLSN_TEST_AUTH_USERS/);
assert.match(source, /env\.TLSN_TEST_DEVICE_ID/);
assert.match(source, /env\.TLSN_TEST_DEVICE_PUBLIC_KEY/);
assert.match(source, /env\.TLSN_REPLAY_AUTH_USERS/);
assert.match(source, /env\.TLSN_REPLAY_DEVICE_ID/);
assert.match(source, /env\.TLSN_REPLAY_DEVICE_PUBLIC_KEY/);
assert.match(replayProvisioning, /setup-tlsn-remote-test\.mjs/);
assert.match(replayProvisioning, /TLSN_REPLAY_AUTH_USERS/);
assert.doesNotMatch(replayProvisioning, /TLSN_TEST_AUTH_USERS=.*TLSN_TEST_AUTH_USERS/);
assert.match(replayValidation, /deployment_role, "replay"/);
assert.match(replayValidation, /successful_verifications: successes\.length/);
assert.match(replayValidation, /commit_verified_result/);

console.log("[tlsn-replay-provisioning] isolated fixed-binding replay contract OK");
