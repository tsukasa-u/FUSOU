#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  assertManifest,
  DEPLOYMENT_AUTH_INPUTS,
  FORBIDDEN_CANARY_INPUTS,
  inputsForRole,
  RUNTIME_INPUTS,
  secretInputsForRole,
} from "./deployment-contract.mjs";
import { CANARY_EXTERNAL_INPUT_INTAKE } from "./canary-external-input-intake.mjs";
import { attestCanaryDeployment } from "./canary-deployment-attestation.mjs";
import {
  assertCanaryDeploymentAuthorized,
  authorizeCanaryDeployment,
} from "./canary-deployment-authorization.mjs";
import {
  assertCanonicalCanaryWorkerName,
  CANARY_BOOTSTRAP_WORKER_NAME,
  CANARY_VERIFIER_WORKER_NAME,
  CANARY_WORKER_NAME,
} from "./canary-deployment-target.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const inputManifestPath = resolve(packageDirectory, "scripts/production-inputs.json");
const deploymentAuthInputs = DEPLOYMENT_AUTH_INPUTS;
const inheritedRuntimeInputs = RUNTIME_INPUTS;
const remoteValidationOnlyInputs = new Set(
  CANARY_EXTERNAL_INPUT_INTAKE
    .filter((entry) => entry.phase === "REMOTE_VALIDATION_ONLY")
    .map((entry) => entry.name),
);

function runGit(argumentsList) {
  const result = spawnSync("git", argumentsList, { cwd: packageDirectory, encoding: "utf8" });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.trim() || "git command failed");
  return result.stdout.trim();
}

function fail(message) {
  console.error(`[tlsn-deploy-canary] ${message}`);
  process.exitCode = 1;
}

function runCaptured(command, argumentsList, environment) {
  const result = spawnSync(command, argumentsList, {
    cwd: packageDirectory,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${command} ${argumentsList.join(" ")} failed with status ${result.status}`);
  return result.stdout;
}

async function main() {
  assertCanonicalCanaryWorkerName(process.env.TLSN_CANARY_WORKER_NAME?.trim());
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
  const deploymentEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !remoteValidationOnlyInputs.has(name)),
  );
  Object.assign(deploymentEnvironment, {
    TLSN_DEPLOYMENT_ROLE: "canary",
    TLSN_GIT_COMMIT_SHA: gitCommitSha,
  });
  const preflight = spawnSync("pnpm", ["run", "preflight:production"], {
    cwd: packageDirectory,
    env: deploymentEnvironment,
    stdio: "inherit",
  });
  if (preflight.error) throw preflight.error;
  if (preflight.status !== 0) return void (process.exitCode = preflight.status ?? 1);
  const deploymentAuthorization = await authorizeCanaryDeployment({
    manifestPath: deploymentEnvironment.TLSN_CANARY_DEPLOYMENT_MANIFEST,
    environment: deploymentEnvironment,
    currentHead: gitCommitSha,
    preflightReportPath: deploymentEnvironment.TLSN_PREFLIGHT_REPORT_PATH
      ?? resolve(packageDirectory, "artifacts/tlsn-deployment-preflight.json"),
  });
  assertCanaryDeploymentAuthorized(deploymentAuthorization);

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
  const bootstrapDeployArguments = [
    "exec", "wrangler", "deploy", "--config", "wrangler.canary-bootstrap.toml", "--name", CANARY_BOOTSTRAP_WORKER_NAME,
  ];
  const deploymentMessage = `FUSOU Canary deployment ${gitCommitSha}`;
  const deploymentTag = `canary-${gitCommitSha.slice(0, 12)}`;
  const deployArguments = [
    "exec", "wrangler", "deploy", "--env", "canary", "--name", CANARY_WORKER_NAME,
    "--tag", deploymentTag, "--message", deploymentMessage,
  ];
  const verifierDeployArguments = [
    "exec", "wrangler", "deploy", "--name", CANARY_VERIFIER_WORKER_NAME,
  ];
  for (const name of allowedInputs) {
    if (!secretInputs.has(name)) {
      bootstrapDeployArguments.push("--var", `${name}:${deploymentEnvironment[name]}`);
      deployArguments.push("--var", `${name}:${deploymentEnvironment[name]}`);
      verifierDeployArguments.push("--var", `${name}:${deploymentEnvironment[name]}`);
    }
  }
  const secretDirectory = await mkdtemp(join(tmpdir(), "tlsn-canary-secrets-"));
  const secretsPath = join(secretDirectory, "secrets.json");
  const verifierConfigPath = join(
    packageDirectory,
    `.wrangler.verifier-canary-${basename(secretDirectory)}.toml`,
  );
  try {
    const verifierConfig = (await readFile(resolve(packageDirectory, "wrangler.verifier-canary.toml"), "utf8"))
      .replace('script_name = "fusou-tlsn-verification-canary"', `script_name = "${CANARY_WORKER_NAME}"`);
    await writeFile(verifierConfigPath, verifierConfig, "utf8");
    verifierDeployArguments.push("--config", verifierConfigPath);
    await writeFile(secretsPath, JSON.stringify(Object.fromEntries([...secretInputs].map((name) => [name, deploymentEnvironment[name]]))), { encoding: "utf8", mode: 0o600 });
    bootstrapDeployArguments.push("--secrets-file", secretsPath);
    deployArguments.push("--secrets-file", secretsPath);
    verifierDeployArguments.push("--secrets-file", secretsPath);
    const bootstrapDeploy = spawnSync("pnpm", bootstrapDeployArguments, { cwd: packageDirectory, env: childEnvironment, stdio: "inherit" });
    if (bootstrapDeploy.error) throw bootstrapDeploy.error;
    if (bootstrapDeploy.status !== 0) {
      process.exitCode = bootstrapDeploy.status ?? 1;
      return;
    }
    const verifierDeploy = spawnSync("pnpm", verifierDeployArguments, { cwd: packageDirectory, env: childEnvironment, stdio: "inherit" });
    if (verifierDeploy.error) throw verifierDeploy.error;
    if (verifierDeploy.status !== 0) {
      process.exitCode = verifierDeploy.status ?? 1;
      return;
    }
    const deploymentStartedAt = new Date();
    const deployOutput = runCaptured("pnpm", deployArguments, childEnvironment);
    const deployedVersionMatch = deployOutput.match(/Current Version ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (!deployedVersionMatch) throw new Error("Wrangler Canary deploy output did not include the deployed version ID");
    const workflow = {
      workflow_run_id: deploymentEnvironment.TLSN_WORKFLOW_RUN_ID ?? null,
      workflow_run_attempt: deploymentEnvironment.TLSN_WORKFLOW_RUN_ATTEMPT ?? null,
      repository: deploymentEnvironment.TLSN_REPOSITORY ?? null,
      workflow_file_identity: deploymentEnvironment.TLSN_WORKFLOW_FILE_IDENTITY ?? null,
    };
    const artifactSuffix = workflow.workflow_run_id && workflow.workflow_run_attempt
      ? `-${workflow.workflow_run_id}-${workflow.workflow_run_attempt}`
      : `-${deploymentEnvironment.TLSN_CANARY_DEPLOYMENT_ID.replace(/[^A-Za-z0-9._-]/g, "-")}`;
    const artifactPath = deploymentEnvironment.TLSN_CANARY_DEPLOYMENT_ATTESTATION_PATH
      ?? resolve(packageDirectory, `artifacts/tlsn-canary-deployment-runtime-attestation${artifactSuffix}.json`);
    const { platform } = await attestCanaryDeployment({
      workerName: CANARY_WORKER_NAME,
      expectedDeploymentId: deploymentEnvironment.TLSN_CANARY_DEPLOYMENT_ID,
      expectedGitCommitSha: gitCommitSha,
      expectedVersionId: deployedVersionMatch[1],
      expectedDeploymentMessage: deploymentMessage,
      expectedDeploymentTag: deploymentTag,
      deploymentStartedAt,
      runtimeUrl: deploymentEnvironment.TLSN_CANARY_WORKER_INTERNAL_URL,
      environment: childEnvironment,
      workflow,
      artifactPath,
    });
    console.log(JSON.stringify({
      status: "PASS",
      readiness: "READY_FOR_HUMAN_GAMEPLAY",
      worker_name: CANARY_WORKER_NAME,
      authorized_deployment_id: deploymentEnvironment.TLSN_CANARY_DEPLOYMENT_ID,
      platform_deployment_id: platform.deployment.id,
      version_id: platform.version.id,
      attestation_path: artifactPath,
    }));
  } finally {
    await rm(verifierConfigPath, { force: true });
    await rm(secretDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));