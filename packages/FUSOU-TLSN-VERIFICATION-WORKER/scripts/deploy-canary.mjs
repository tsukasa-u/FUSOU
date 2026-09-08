#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  assertManifest,
  DEPLOYMENT_AUTH_INPUTS,
  FORBIDDEN_CANARY_INPUTS,
  inputsForRole,
  RUNTIME_INPUTS,
  secretInputsForRole,
} from "./deployment-contract.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const inputManifestPath = resolve(packageDirectory, "scripts/production-inputs.json");
const deploymentAuthInputs = DEPLOYMENT_AUTH_INPUTS;
const inheritedRuntimeInputs = RUNTIME_INPUTS;

function runGit(argumentsList) {
  const result = spawnSync("git", argumentsList, { cwd: packageDirectory, encoding: "utf8" });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.trim() || "git command failed");
  return result.stdout.trim();
}

function fail(message) {
  console.error(`[tlsn-deploy-canary] ${message}`);
  process.exitCode = 1;
}

async function main() {
  const workerName = process.env.TLSN_CANARY_WORKER_NAME?.trim();
  if (!workerName || !/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(workerName)) {
    throw new Error("TLSN_CANARY_WORKER_NAME must be a valid non-production Worker name");
  }
  for (const name of FORBIDDEN_CANARY_INPUTS) {
    if (process.env[name] !== undefined) throw new Error(`${name} must not be present in a canary deployment`);
  }
  if (runGit(["status", "--porcelain=v1"])) throw new Error("refusing canary deploy from a dirty git worktree");
  const gitCommitSha = runGit(["rev-parse", "HEAD"]);
  if (process.env.TLSN_GIT_COMMIT_SHA && process.env.TLSN_GIT_COMMIT_SHA !== gitCommitSha) {
    throw new Error("TLSN_GIT_COMMIT_SHA does not match the checked-out commit");
  }
  const manifest = JSON.parse(await readFile(inputManifestPath, "utf8"));
  assertManifest(manifest);
  const allowedInputs = inputsForRole("canary");
  const secretInputs = new Set(secretInputsForRole("canary"));
  const deploymentEnvironment = {
    ...process.env,
    TLSN_DEPLOYMENT_ROLE: "canary",
    TLSN_GIT_COMMIT_SHA: gitCommitSha,
  };
  const preflight = spawnSync("pnpm", ["run", "preflight:production"], {
    cwd: packageDirectory,
    env: deploymentEnvironment,
    stdio: "inherit",
  });
  if (preflight.error) throw preflight.error;
  if (preflight.status !== 0) return void (process.exitCode = preflight.status ?? 1);

  const build = spawnSync("pnpm", ["run", "build:wasm"], {
    cwd: packageDirectory,
    env: Object.fromEntries(Object.entries(deploymentEnvironment).filter(([name]) => inheritedRuntimeInputs.includes(name))),
    stdio: "inherit",
  });
  if (build.error) throw build.error;
  if (build.status !== 0) return void (process.exitCode = build.status ?? 1);

  const allowedChildEnvironment = new Set([...allowedInputs, ...deploymentAuthInputs, ...inheritedRuntimeInputs]);
  const childEnvironment = Object.fromEntries(
    Object.entries(deploymentEnvironment).filter(([name]) => allowedChildEnvironment.has(name) && !secretInputs.has(name)),
  );
  const deployArguments = ["exec", "wrangler", "deploy", "--env", "canary", "--name", workerName];
  for (const name of allowedInputs) {
    if (!secretInputs.has(name)) deployArguments.push("--var", `${name}:${deploymentEnvironment[name]}`);
  }
  const secretDirectory = await mkdtemp(join(tmpdir(), "tlsn-canary-secrets-"));
  const secretsPath = join(secretDirectory, "secrets.json");
  try {
    await writeFile(secretsPath, JSON.stringify(Object.fromEntries([...secretInputs].map((name) => [name, deploymentEnvironment[name]]))), { encoding: "utf8", mode: 0o600 });
    deployArguments.push("--secrets-file", secretsPath);
    const deploy = spawnSync("pnpm", deployArguments, { cwd: packageDirectory, env: childEnvironment, stdio: "inherit" });
    if (deploy.error) throw deploy.error;
    process.exitCode = deploy.status ?? 1;
  } finally {
    await rm(secretDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));