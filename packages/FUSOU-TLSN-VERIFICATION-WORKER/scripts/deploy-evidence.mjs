#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);

const PUBLIC_INPUTS = [
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
  "TLSN_TEST_DEVICE_ID",
  "TLSN_TEST_DEVICE_PUBLIC_KEY",
  "TLSN_SUPABASE_URL",
  "TLSN_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_EXECUTION_MODE",
  "TLSN_BENCHMARK_TIMINGS",
  "TLSN_TEST_DIRECT_SYNCHRONOUS_CANDIDATE",
];

const SECRET_INPUTS = [
  "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_TRUST_ROOT_CERTIFICATE_DER",
  "TLSN_TEST_AUTH_USERS",
  "TLSN_TEST_BINDING_VALUE",
  "TLSN_TEST_BINDING_VALUES",
  "TLSN_TEST_COMPLETION_DELAY_MS",
  "TLSN_TEST_COMPLETION_DELAY_ONCE",
  "TLSN_TEST_VERIFICATION_LEASE_MS",
  "TLSN_TEST_POST_RESULT_DELAY_MS",
  "TLSN_TEST_POST_RESULT_DELAY_ONCE",
  "TLSN_TEST_DIRECT_INVOCATION_TIMEOUT_MS",
  "TLSN_TEST_DIRECT_VERIFIER_MODE",
  "TLSN_TEST_DIRECT_VERIFIER_DELAY_MS",
  "TLSN_DIRECT_CALLBACK_SECRET",
];

const FORBIDDEN_PREFIXES = ["TLSN_CANARY_", "TLSN_PRODUCTION_", "TLSN_CANDIDATE_"];

function fail(message) {
  console.error(`[tlsn-deploy-evidence] ${message}`);
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required dotenvx variable: ${name}`);
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

async function main() {
  if (process.env.TLSN_ENVIRONMENT && process.env.TLSN_ENVIRONMENT !== "test") {
    throw new Error("TLSN_ENVIRONMENT must be test for the evidence deployment");
  }
  for (const prefix of FORBIDDEN_PREFIXES) {
    const forbidden = Object.keys(process.env).find((name) => name.startsWith(prefix));
    if (forbidden) throw new Error(`${forbidden} must not be present in an evidence deployment environment`);
  }

  const workerName = process.env.TLSN_EVIDENCE_WORKER_NAME?.trim() || "fusou-tlsn-verification-evidence";
  const verifierName = process.env.TLSN_EVIDENCE_VERIFIER_NAME?.trim() || "fusou-tlsn-verifier-evidence";
  for (const [name, value] of [["TLSN_EVIDENCE_WORKER_NAME", workerName], ["TLSN_EVIDENCE_VERIFIER_NAME", verifierName]]) {
    if (!/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(value)) throw new Error(`${name} must be a valid Worker name`);
  }
  const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (cloudflareApiToken && !cloudflareAccountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required when CLOUDFLARE_API_TOKEN is set");
  for (const name of [
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
  ]) required(name);
  for (const name of [
    "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
    "TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
    "TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
    "TLSN_TRUST_ROOT_CERTIFICATE_DER",
    "TLSN_DIRECT_CALLBACK_SECRET",
  ]) required(name);
  if (!process.env.TLSN_TEST_AUTH_USERS && (!process.env.TLSN_SUPABASE_URL || !process.env.TLSN_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error("set TLSN_TEST_AUTH_USERS or both TLSN_SUPABASE_URL and TLSN_SUPABASE_PUBLISHABLE_KEY");
  }
  if ((process.env.TLSN_EXECUTION_MODE?.trim() || "sync") !== "direct") {
    throw new Error("TLSN_EXECUTION_MODE=direct is required for the evidence deployment");
  }

  const deploymentEnvironment = {
    ...process.env,
    TLSN_ENVIRONMENT: "test",
    TLSN_DEPLOYMENT_ROLE: "evidence",
  };
  run("pnpm", ["run", "build:wasm"], deploymentEnvironment);

  const deployArguments = ["exec", "wrangler", "deploy", "--env", "evidence", "--name", workerName];
  const bootstrapDeployArguments = [
    "exec", "wrangler", "deploy", "--config", "wrangler.evidence-bootstrap.toml", "--name", workerName,
  ];
  const verifierDeployArguments = [
    "exec", "wrangler", "deploy", "--config", "wrangler.verifier-evidence.toml", "--name", verifierName,
  ];
  for (const name of PUBLIC_INPUTS) {
    const value = deploymentEnvironment[name];
    if (value !== undefined && value !== "") {
      deployArguments.push("--var", `${name}:${value}`);
        bootstrapDeployArguments.push("--var", `${name}:${value}`);
      verifierDeployArguments.push("--var", `${name}:${value}`);
    }
  }

  const secretDirectory = await mkdtemp(join(tmpdir(), "tlsn-evidence-secrets-"));
  const secretsPath = join(secretDirectory, "secrets.json");
  try {
    const secrets = Object.fromEntries(
      SECRET_INPUTS
        .filter((name) => deploymentEnvironment[name] !== undefined)
        .map((name) => [name, deploymentEnvironment[name]]),
    );
    await writeFile(secretsPath, JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 });
    bootstrapDeployArguments.push("--secrets-file", secretsPath);
    deployArguments.push("--secrets-file", secretsPath);
    verifierDeployArguments.push("--secrets-file", secretsPath);
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

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
