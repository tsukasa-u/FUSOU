#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const deployReplay = await readFile(resolve(packageDirectory, "scripts/deploy-replay.mjs"), "utf8");
const replayConfig = await readFile(resolve(packageDirectory, "wrangler.replay.toml"), "utf8");
const replayBootstrapConfig = await readFile(resolve(packageDirectory, "wrangler.replay-bootstrap.toml"), "utf8");
const replayVerifierConfig = await readFile(resolve(packageDirectory, "wrangler.verifier-replay.toml"), "utf8");
const source = await readFile(resolve(packageDirectory, "src/index.ts"), "utf8");
const envExample = await readFile(resolve(packageDirectory, ".env.example"), "utf8");
const packageJson = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"));

assert.match(packageJson.scripts["deploy:replay"], /deploy-replay\.mjs/);
assert.match(packageJson.scripts["test:replay-provisioning"], /replay-provisioning-test\.mjs/);
assert.match(deployReplay, /TLSN_REPLAY_BINDING_VALUE/);
assert.match(deployReplay, /TLSN_REPLAY_DEPLOYMENT_ID/);
assert.match(deployReplay, /TLSN_REPLAY_WORKER_NAME/);
assert.match(deployReplay, /function required\(name, environment = process\.env\)/);
assert.match(deployReplay, /required\(name, deploymentEnvironment\)/);
assert.match(deployReplay, /TLSN_SUPABASE_URL: replaySupabaseUrl/);
assert.match(deployReplay, /TLSN_SUPABASE_PUBLISHABLE_KEY: replaySupabasePublishableKey/);
assert.match(deployReplay, /TLSN_DEVICE_AUTH_URL: replayDeviceAuthUrl/);
assert.match(deployReplay, /TLSN_DEVICE_POSSESSION_AUTH_URL: replayDevicePossessionAuthUrl/);
assert.match(deployReplay, /TLSN_TEST_BINDING_VALUE: replayBindingValue/);
for (const forbiddenInput of [
  "TLSN_SUPABASE_URL",
  "TLSN_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_DEVICE_AUTH_URL",
  "TLSN_DEVICE_POSSESSION_AUTH_URL",
]) {
  assert.match(deployReplay, new RegExp(`"${forbiddenInput}"`));
}
assert.match(deployReplay, /TLSN_TEST_AUTH_USERS/);
assert.match(deployReplay, /TLSN_TEST_DEVICE_ID/);
assert.match(deployReplay, /TLSN_TEST_DEVICE_PUBLIC_KEY/);
assert.match(deployReplay, /TLSN_CANDIDATE_/);
assert.match(deployReplay, /gitOutput\(\["status", "--porcelain=v1"\]\)/);
assert.match(deployReplay, /gitOutput\(\["rev-parse", "HEAD"\]\)/);
for (const input of [
  "TLSN_REPLAY_ENVIRONMENT_CONFIRMATION",
  "TLSN_REPLAY_SUPABASE_URL",
  "TLSN_REPLAY_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_REPLAY_DEVICE_AUTH_URL",
  "TLSN_REPLAY_DEVICE_POSSESSION_AUTH_URL",
]) {
  assert.match(envExample, new RegExp(`^${input}=`, "m"));
}
const replayValidationOffset = deployReplay.indexOf("const replaySupabaseUrl = requiredHttpsUrl");
const runtimeNormalizationOffset = deployReplay.indexOf("TLSN_SUPABASE_URL: replaySupabaseUrl");
const genericValidationOffset = deployReplay.indexOf("for (const name of publicInputs.filter");
assert.ok(replayValidationOffset >= 0);
assert.ok(runtimeNormalizationOffset > replayValidationOffset);
assert.ok(genericValidationOffset > runtimeNormalizationOffset);

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

console.log("[tlsn-replay-provisioning] isolated fixed-binding replay contract OK");
