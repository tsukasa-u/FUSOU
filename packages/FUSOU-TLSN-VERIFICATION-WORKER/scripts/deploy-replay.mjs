#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  decodeReplayEnvironmentValues,
  normalizeReplayDeploymentEnvironment,
} from "./replay-deployment-environment.mjs";

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
  "TLSN_TEST_DIRECT_SYNCHRONOUS_CANDIDATE",
  "TLSN_GIT_COMMIT_SHA",
  "TLSN_REPLAY_DEPLOYMENT_ID",
  "TLSN_REPLAY_WORKER_NAME",
  "TLSN_REPLAY_AUTH_USERS",
  "TLSN_REPLAY_DEVICE_ID",
  "TLSN_REPLAY_DEVICE_PUBLIC_KEY",
];
const secretInputs = [
  "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_TRUST_ROOT_CERTIFICATE_DER",
  "TLSN_TEST_BINDING_VALUE",
  "TLSN_DIRECT_CALLBACK_SECRET",
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

async function main() {
  const deploymentEnvironment = normalizeReplayDeploymentEnvironment(decodeReplayEnvironmentValues(process.env));
  const deploymentId = deploymentEnvironment.TLSN_REPLAY_DEPLOYMENT_ID;
  const workerName = deploymentEnvironment.TLSN_REPLAY_WORKER_NAME;
  required("TLSN_DIRECT_CALLBACK_SECRET");
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
