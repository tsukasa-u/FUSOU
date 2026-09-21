#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const publicInputs = [
  "TLSN_ENVIRONMENT",
  "TLSN_DEPLOYMENT_ROLE",
  "TLSN_BINDING_TTL_SECONDS",
  "TLSN_SERVER_IDENTITY",
  "TLSN_PROFILE_SHA256",
  "TLSN_SPARSE_PROFILE_SHA256",
  "TLSN_VERIFIER_KEY_ID",
  "TLSN_NOTARY_KEY_ID",
  "TLSN_NOTARY_REGISTRY",
  "TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_SESSION_AUTHORITY_KEY_ID",
  "TLSN_SESSION_AUTHORITY_KEY_REGISTRY",
  "TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_BINDING_AUTHORITY_KEY_ID",
  "TLSN_BINDING_AUTHORITY_KEY_REGISTRY",
  "TLSN_DEVICE_AUTH_URL",
  "TLSN_DEVICE_POSSESSION_AUTH_URL",
  "TLSN_SUPABASE_URL",
  "TLSN_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_EXECUTION_MODE",
  "TLSN_BENCHMARK_TIMINGS",
  "TLSN_GIT_COMMIT_SHA",
  "TLSN_REPLAY_DEPLOYMENT_ID",
  "TLSN_REPLAY_WORKER_NAME",
];
const secretInputs = [
  "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_TRUST_ROOT_CERTIFICATE_DER",
  "TLSN_TEST_BINDING_VALUE",
  "TLSN_DIRECT_CALLBACK_SECRET",
];
const forbiddenPrefixes = ["TLSN_CANARY_", "TLSN_PRODUCTION_", "TLSN_CANDIDATE_"];
const forbiddenNames = [
  "TLSN_TEST_AUTH_USERS",
  "TLSN_TEST_DEVICE_ID",
  "TLSN_TEST_DEVICE_PUBLIC_KEY",
  "TLSN_TEST_BINDING_VALUES",
  "TLSN_TEST_COMPLETION_DELAY_MS",
  "TLSN_TEST_COMPLETION_DELAY_ONCE",
  "TLSN_TEST_POST_RESULT_DELAY_MS",
  "TLSN_TEST_POST_RESULT_DELAY_ONCE",
  "TLSN_TEST_DIRECT_INVOCATION_TIMEOUT_MS",
  "TLSN_TEST_DIRECT_VERIFIER_MODE",
  "TLSN_TEST_DIRECT_VERIFIER_DELAY_MS",
  "TLSN_TEST_VERIFICATION_LEASE_MS",
  "TLSN_TEST_BINDING_VALUE",
  "TLSN_SUPABASE_URL",
  "TLSN_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_DEVICE_AUTH_URL",
  "TLSN_DEVICE_POSSESSION_AUTH_URL",
];

function required(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`missing required replay input: ${name}`);
  return value;
}

function run(command, argumentsList, environment) {
  const result = spawnSync(command, argumentsList, {
    cwd: packageDirectory,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function gitOutput(argumentsList) {
  const result = spawnSync("git", argumentsList, {
    cwd: packageDirectory,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr.trim() || "git command failed");
  }
  return result.stdout.trim();
}

function assertWorkerName(name, variable) {
  if (!/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(name)) {
    throw new Error(`${variable} must be a valid Worker name`);
  }
}

function requiredHttpsUrl(name, pathname) {
  const value = required(name);
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.hostname.includes("kancolle") ||
    /(?:^|\.)(?:example|invalid)$/i.test(url.hostname)
  ) {
    throw new Error(`${name} must be a non-placeholder HTTPS URL`);
  }
  if (pathname !== undefined && url.pathname !== pathname) {
    throw new Error(`${name} must use the exact path ${pathname}`);
  }
  return value;
}

async function main() {
  if (process.env.TLSN_ENVIRONMENT && process.env.TLSN_ENVIRONMENT !== "test") {
    throw new Error("TLSN_ENVIRONMENT must be test for the replay deployment");
  }
  if (process.env.TLSN_DEPLOYMENT_ROLE && process.env.TLSN_DEPLOYMENT_ROLE !== "replay") {
    throw new Error("TLSN_DEPLOYMENT_ROLE must be replay for the replay deployment");
  }
  for (const prefix of forbiddenPrefixes) {
    const forbidden = Object.keys(process.env).find((name) => name.startsWith(prefix));
    if (forbidden) throw new Error(`${forbidden} must not be present in a replay deployment environment`);
  }
  for (const name of forbiddenNames) {
    if (process.env[name] !== undefined) throw new Error(`${name} must not be present in a replay deployment environment`);
  }

  const workerName = process.env.TLSN_REPLAY_WORKER_NAME?.trim() || "fusou-tlsn-verification-replay";
  const deploymentId = process.env.TLSN_REPLAY_DEPLOYMENT_ID?.trim();
  assertWorkerName(workerName, "TLSN_REPLAY_WORKER_NAME");
  if (!deploymentId || !/^[A-Za-z0-9._-]{1,128}$/.test(deploymentId)) {
    throw new Error("TLSN_REPLAY_DEPLOYMENT_ID must be a safe deployment identity");
  }
  if (process.env.TLSN_REPLAY_ENVIRONMENT_CONFIRMATION !== "non-production-synthetic") {
    throw new Error("TLSN_REPLAY_ENVIRONMENT_CONFIRMATION must be non-production-synthetic");
  }
  const replaySupabaseUrl = requiredHttpsUrl("TLSN_REPLAY_SUPABASE_URL");
  const replayDeviceAuthUrl = requiredHttpsUrl(
    "TLSN_REPLAY_DEVICE_AUTH_URL",
    "/api/auth/anonymous-sync/v2/device-proof",
  );
  const replayDevicePossessionAuthUrl = requiredHttpsUrl(
    "TLSN_REPLAY_DEVICE_POSSESSION_AUTH_URL",
    "/api/auth/anonymous-sync/v2/tlsn-device-proof",
  );
  const replaySupabasePublishableKey = required("TLSN_REPLAY_SUPABASE_PUBLISHABLE_KEY");
  const replayBindingValue = required("TLSN_REPLAY_BINDING_VALUE");
  required("TLSN_DIRECT_CALLBACK_SECRET");

  const deploymentEnvironment = {
    ...process.env,
    TLSN_ENVIRONMENT: "test",
    TLSN_DEPLOYMENT_ROLE: "replay",
    TLSN_EXECUTION_MODE: "direct",
    TLSN_BENCHMARK_TIMINGS: "true",
    TLSN_REPLAY_DEPLOYMENT_ID: deploymentId,
    TLSN_REPLAY_WORKER_NAME: workerName,
    TLSN_SUPABASE_URL: replaySupabaseUrl,
    TLSN_SUPABASE_PUBLISHABLE_KEY: replaySupabasePublishableKey,
    TLSN_DEVICE_AUTH_URL: replayDeviceAuthUrl,
    TLSN_DEVICE_POSSESSION_AUTH_URL: replayDevicePossessionAuthUrl,
    TLSN_TEST_BINDING_VALUE: replayBindingValue,
  };
  if (gitOutput(["status", "--porcelain=v1"])) {
    throw new Error("refusing replay deploy from a dirty git worktree");
  }
  const gitCommitSha = gitOutput(["rev-parse", "HEAD"]);
  if (process.env.TLSN_GIT_COMMIT_SHA && process.env.TLSN_GIT_COMMIT_SHA !== gitCommitSha) {
    throw new Error("TLSN_GIT_COMMIT_SHA does not match the checked-out commit");
  }
  for (const name of publicInputs.filter((input) => ![
    "TLSN_ENVIRONMENT",
    "TLSN_DEPLOYMENT_ROLE",
    "TLSN_EXECUTION_MODE",
    "TLSN_BENCHMARK_TIMINGS",
    "TLSN_GIT_COMMIT_SHA",
    "TLSN_REPLAY_WORKER_NAME",
    "TLSN_REPLAY_DEPLOYMENT_ID",
  ].includes(input))) required(name, deploymentEnvironment);
  for (const name of secretInputs.filter((input) => input !== "TLSN_TEST_BINDING_VALUE")) {
    required(name, deploymentEnvironment);
  }

  const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (cloudflareApiToken && !cloudflareAccountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required when CLOUDFLARE_API_TOKEN is set");
  }
  run("pnpm", ["run", "build:wasm"], deploymentEnvironment);

  const deployArguments = ["exec", "wrangler", "deploy", "--config", "wrangler.replay.toml", "--name", workerName];
  const bootstrapDeployArguments = ["exec", "wrangler", "deploy", "--config", "wrangler.replay-bootstrap.toml", "--name", workerName];
  const verifierDeployArguments = ["exec", "wrangler", "deploy", "--config", "wrangler.verifier-replay.toml", "--name", "fusou-tlsn-verifier-replay"];
  for (const name of publicInputs) {
    const value = deploymentEnvironment[name];
    if (value !== undefined && value !== "") {
      deployArguments.push("--var", `${name}:${value}`);
      bootstrapDeployArguments.push("--var", `${name}:${value}`);
      verifierDeployArguments.push("--var", `${name}:${value}`);
    }
  }

  const secretDirectory = await mkdtemp(join(tmpdir(), "tlsn-replay-secrets-"));
  const secretsPath = join(secretDirectory, "secrets.json");
  try {
    const secrets = Object.fromEntries(
      secretInputs.map((name) => [name, deploymentEnvironment[name] ?? (name === "TLSN_TEST_BINDING_VALUE" ? deploymentEnvironment.TLSN_TEST_BINDING_VALUE : undefined)])
        .filter(([, value]) => value !== undefined),
    );
    await writeFile(secretsPath, JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 });
    for (const argumentsList of [bootstrapDeployArguments, deployArguments, verifierDeployArguments]) {
      argumentsList.push("--secrets-file", secretsPath);
    }
    const childEnvironment = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...(cloudflareApiToken ? { CLOUDFLARE_API_TOKEN: cloudflareApiToken } : {}),
      ...(cloudflareAccountId ? { CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId } : {}),
    };
    run("pnpm", bootstrapDeployArguments, childEnvironment);
    run("pnpm", verifierDeployArguments, childEnvironment);
    run("pnpm", deployArguments, childEnvironment);
  } finally {
    await rm(secretDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[tlsn-deploy-replay] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
