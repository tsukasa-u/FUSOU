#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);

const PUBLIC_INPUTS = [
  "TLSN_ENVIRONMENT",
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
  "TLSN_TEST_DEVICE_ID",
  "TLSN_TEST_DEVICE_PUBLIC_KEY",
  "TLSN_SUPABASE_URL",
  "TLSN_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_EXECUTION_MODE",
  "TLSN_TRIGGER_API_URL",
  "TLSN_TRIGGER_TASK_ID",
  "TLSN_BENCHMARK_TIMINGS",
];

const SECRET_INPUTS = [
  "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_TRUST_ROOT_CERTIFICATE_DER",
  "TLSN_TEST_AUTH_USERS",
  "TLSN_TEST_BINDING_VALUE",
  "TLSN_TRIGGER_SECRET_KEY",
  "TLSN_TRIGGER_CALLBACK_SECRET",
  "TLSN_QUEUE_CALLBACK_SECRET",
  "TLSN_DIRECT_CALLBACK_SECRET",
  "TLSN_TEST_COMPLETION_DELAY_MS",
  "TLSN_TEST_COMPLETION_DELAY_ONCE",
  "TLSN_TEST_VERIFICATION_LEASE_MS",
  "TLSN_TEST_POST_RESULT_DELAY_MS",
  "TLSN_TEST_POST_RESULT_DELAY_ONCE",
  "TLSN_TEST_DIRECT_INVOCATION_TIMEOUT_MS",
  "TLSN_TEST_DIRECT_VERIFIER_MODE",
  "TLSN_TEST_DIRECT_VERIFIER_DELAY_MS",
];

const REQUIRED_PUBLIC_INPUTS = PUBLIC_INPUTS.filter((name) => ![
  "TLSN_ENVIRONMENT",
  "TLSN_SUPABASE_URL",
  "TLSN_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_EXECUTION_MODE",
  "TLSN_TRIGGER_API_URL",
  "TLSN_TRIGGER_TASK_ID",
  "TLSN_TEST_DEVICE_ID",
  "TLSN_TEST_DEVICE_PUBLIC_KEY",
].includes(name));

function fail(message) {
  console.error(`[tlsn-deploy-test] ${message}`);
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required dotenvx variable: ${name}`);
  return value;
}

function run(command, argumentsList, environment = process.env) {
  const result = spawnSync(command, argumentsList, {
    cwd: packageDirectory,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
  if (process.env.TLSN_ENVIRONMENT && process.env.TLSN_ENVIRONMENT !== "test") {
    throw new Error("TLSN_ENVIRONMENT must be test for the manual test deployment");
  }
  for (const prefix of ["TLSN_CANARY_", "TLSN_PRODUCTION_", "TLSN_CANDIDATE_"]) {
    const forbidden = Object.keys(process.env).find((name) => name.startsWith(prefix));
    if (forbidden) throw new Error(`${forbidden} must not be present in a test deployment environment`);
  }

  const workerName = process.env.TLSN_TEST_WORKER_NAME?.trim() || "fusou-tlsn-verification-test";
  if (!/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(workerName)) {
    throw new Error("TLSN_TEST_WORKER_NAME must be a valid Worker name");
  }
  const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (cloudflareApiToken && !cloudflareAccountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required when CLOUDFLARE_API_TOKEN is set");
  }
  for (const name of REQUIRED_PUBLIC_INPUTS) required(name);
  for (const name of [
    "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
    "TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
    "TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  ]) required(name);

  const executionMode = process.env.TLSN_EXECUTION_MODE?.trim() || "sync";
  if (!new Set(["sync", "trigger", "queue", "direct"]).has(executionMode)) {
    throw new Error("TLSN_EXECUTION_MODE must be sync, trigger, queue, or direct");
  }
  const triggerMode = executionMode === "trigger";
  const queueMode = executionMode === "queue";
  if (triggerMode) {
    required("TLSN_TRIGGER_API_URL");
    required("TLSN_TRIGGER_TASK_ID");
    required("TLSN_TRIGGER_SECRET_KEY");
    required("TLSN_TRIGGER_CALLBACK_SECRET");
  }
  if (queueMode) {
    required("TLSN_QUEUE_CALLBACK_SECRET");
  }
  const directMode = executionMode === "direct";
  if (directMode) {
    required("TLSN_DIRECT_CALLBACK_SECRET");
    if (workerName !== "fusou-tlsn-verification-test") {
      throw new Error("direct test deployment requires TLSN_TEST_WORKER_NAME=fusou-tlsn-verification-test");
    }
  }
  if (!process.env.TLSN_TEST_AUTH_USERS && (!process.env.TLSN_SUPABASE_URL || !process.env.TLSN_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error("set TLSN_TEST_AUTH_USERS or both TLSN_SUPABASE_URL and TLSN_SUPABASE_PUBLISHABLE_KEY");
  }
  const testDeviceId = process.env.TLSN_TEST_DEVICE_ID?.trim();
  const testDevicePublicKey = process.env.TLSN_TEST_DEVICE_PUBLIC_KEY?.trim();
  if ((testDeviceId && !testDevicePublicKey) || (!testDeviceId && testDevicePublicKey)) {
    throw new Error("set both TLSN_TEST_DEVICE_ID and TLSN_TEST_DEVICE_PUBLIC_KEY for self-contained test device auth");
  }

  const deploymentEnvironment = {
    ...process.env,
    TLSN_ENVIRONMENT: "test",
  };
  run("pnpm", ["run", "build:wasm"], deploymentEnvironment);

  const deployArguments = ["exec", "wrangler", "deploy", "--env", "test", "--name", workerName];
  const verifierDeployArguments = [
    "exec",
    "wrangler",
    "deploy",
    "--config",
    "wrangler.verifier-test.toml",
    "--name",
    "fusou-tlsn-verifier-test",
  ];
  for (const name of PUBLIC_INPUTS) {
    const value = deploymentEnvironment[name];
    if (value !== undefined && value !== "") {
      deployArguments.push("--var", `${name}:${value}`);
      verifierDeployArguments.push("--var", `${name}:${value}`);
    }
  }

  const secretDirectory = await mkdtemp(join(tmpdir(), "tlsn-test-secrets-"));
  const secretsPath = join(secretDirectory, "secrets.json");
  try {
    const secrets = Object.fromEntries(
      SECRET_INPUTS
        .filter((name) => deploymentEnvironment[name] !== undefined)
        .map((name) => [name, deploymentEnvironment[name]]),
    );
    await writeFile(secretsPath, JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 });
    deployArguments.push("--secrets-file", secretsPath);
    const childEnvironment = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...(cloudflareApiToken ? { CLOUDFLARE_API_TOKEN: cloudflareApiToken } : {}),
      ...(cloudflareAccountId ? { CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId } : {}),
    };
    if (directMode) {
      verifierDeployArguments.push("--secrets-file", secretsPath);
      run("pnpm", verifierDeployArguments, childEnvironment);
    }
    run("pnpm", deployArguments, childEnvironment);
  } finally {
    await rm(secretDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));