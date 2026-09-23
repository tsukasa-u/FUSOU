#!/usr/bin/env node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  assertCanonicalTestWorkerName,
  TEST_WORKER_NAME,
} from "./test-deployment-target.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);

const PUBLIC_INPUTS = [
  "TLSN_ENVIRONMENT",
  "TLSN_GIT_COMMIT_SHA",
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
  "TLSN_RESULT_PUBLIC_KEY_SPKI",
  "TLSN_RESULT_SIGNER_KEY_ID",
  "TLSN_RESULT_SIGNING_KEY_REGISTRY",
  "TLSN_TEST_WORKER_NAME",
];

const SECRET_INPUTS = [
  "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_TRUST_ROOT_CERTIFICATE_DER",
  "TLSN_TEST_AUTH_USERS",
  "TLSN_TEST_BINDING_VALUE",
  "TLSN_TEST_BINDING_VALUES",
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
  "TLSN_GIT_COMMIT_SHA",
  "TLSN_SUPABASE_URL",
  "TLSN_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_EXECUTION_MODE",
  "TLSN_TRIGGER_API_URL",
  "TLSN_TRIGGER_TASK_ID",
  "TLSN_TEST_DEVICE_ID",
  "TLSN_TEST_DEVICE_PUBLIC_KEY",
  "TLSN_TEST_WORKER_NAME",
  "TLSN_RESULT_PUBLIC_KEY_SPKI",
  "TLSN_RESULT_SIGNER_KEY_ID",
  "TLSN_RESULT_SIGNING_KEY_REGISTRY",
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

function runCaptured(command, argumentsList, environment) {
  const result = spawnSync(command, argumentsList, {
    cwd: packageDirectory,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${argumentsList.join(" ")} failed with status ${result.status}`);
  }
  return result.stdout;
}

function jsonOutput(value, label) {
  try {
    return JSON.parse(value.trim());
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

function deriveResultIdentity(privateKeyPkcs8, keyId) {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8 must be an Ed25519 key");
  }
  const publicKeySpki = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64url");
  const registry = {
    schema_version: 1,
    scope: "tlsn-result-signing-key-registry",
    keys: [{
      key_id: keyId,
      public_key_spki: publicKeySpki,
      status: "ACTIVE",
      not_before: "2020-01-01T00:00:00.000Z",
      not_after: null,
    }],
  };
  const registryRaw = `${JSON.stringify(registry)}\n`;
  return {
    publicKeySpki,
    signerKeyId: keyId,
    registryRaw,
    registrySha256: createHash("sha256").update(registryRaw).digest("base64url"),
  };
}

async function latestDeploymentMetadata(workerName, expectedVersionId, environment) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const deploymentPayload = jsonOutput(
      runCaptured("pnpm", ["exec", "wrangler", "deployments", "list", "--name", workerName, "--json"], environment),
      "Wrangler deployment metadata",
    );
    const versionPayload = jsonOutput(
      runCaptured("pnpm", ["exec", "wrangler", "versions", "list", "--name", workerName, "--json"], environment),
      "Wrangler version metadata",
    );
    const deployments = Array.isArray(deploymentPayload)
      ? deploymentPayload
      : deploymentPayload?.result?.deployments;
    const versions = Array.isArray(versionPayload)
      ? versionPayload
      : versionPayload?.result?.items;
    const deployment = deployments?.find((candidate) =>
      candidate?.versions?.some((entry) => entry?.version_id === expectedVersionId),
    );
    if (deployment?.id && Array.isArray(deployment.versions)) {
      const servingVersions = deployment.versions.filter((entry) => entry?.percentage === 100);
      if (deployment.versions.length !== 1 || servingVersions.length !== 1) {
        throw new Error("Test deployment is not a single 100% serving version");
      }
      const servingVersionId = servingVersions[0].version_id;
      if (servingVersionId !== expectedVersionId) {
        throw new Error("deployed Test version is not the 100% serving version");
      }
      const version = versions?.find((entry) => entry?.id === servingVersionId);
      if (!version?.id) throw new Error("active Test deployment version was not found in version metadata");
      return {
        deployment,
        version,
        servingVersionId,
      };
    }
    if (attempt < 5) await new Promise((resolveAttempt) => setTimeout(resolveAttempt, 2000));
  }
  throw new Error("new Test deployment was not yet visible in Wrangler deployment metadata");
}

async function writeDeploymentAttestation(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function main() {
  if (process.env.TLSN_ENVIRONMENT && process.env.TLSN_ENVIRONMENT !== "test") {
    throw new Error("TLSN_ENVIRONMENT must be test for the manual test deployment");
  }
  for (const prefix of ["TLSN_CANARY_", "TLSN_PRODUCTION_", "TLSN_CANDIDATE_"]) {
    const forbidden = Object.keys(process.env).find((name) => name.startsWith(prefix));
    if (forbidden) throw new Error(`${forbidden} must not be present in a test deployment environment`);
  }

  const workerName = assertCanonicalTestWorkerName(
    process.env.TLSN_TEST_WORKER_NAME?.trim() || TEST_WORKER_NAME,
  );
  const gitCommitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: packageDirectory,
    encoding: "utf8",
  }).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(gitCommitSha)) throw new Error("checked-out HEAD is not a full Git SHA");
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
  const resultSignerKeyId = process.env.TLSN_RESULT_SIGNER_KEY_ID?.trim() || required("TLSN_VERIFIER_KEY_ID");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(resultSignerKeyId)) {
    throw new Error("TLSN_RESULT_SIGNER_KEY_ID is invalid");
  }
  const resultIdentity = deriveResultIdentity(required("TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8"), resultSignerKeyId);

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
    TLSN_GIT_COMMIT_SHA: gitCommitSha,
    TLSN_TEST_WORKER_NAME: workerName,
    TLSN_RESULT_PUBLIC_KEY_SPKI: resultIdentity.publicKeySpki,
    TLSN_RESULT_SIGNER_KEY_ID: resultIdentity.signerKeyId,
    TLSN_RESULT_SIGNING_KEY_REGISTRY: resultIdentity.registryRaw,
  };
  run("pnpm", ["run", "build:wasm"], deploymentEnvironment);

  const deploymentStartedAt = new Date();
  const deploymentMessage = `FUSOU Test deployment ${gitCommitSha}`;
  const deploymentTag = `test-${gitCommitSha.slice(0, 12)}`;
  const deployArguments = [
    "exec", "wrangler", "deploy", "--env", "test", "--name", workerName,
    "--tag", deploymentTag, "--message", deploymentMessage,
  ];
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
    const deployOutput = runCaptured("pnpm", deployArguments, childEnvironment);
    const deployedVersionMatch = deployOutput.match(/Current Version ID:\s*([0-9a-f-]{36})/i);
    if (!deployedVersionMatch) throw new Error("Wrangler deploy output did not include the deployed version ID");
    const deployedVersionId = deployedVersionMatch[1];
    const platform = await latestDeploymentMetadata(workerName, deployedVersionId, childEnvironment);
    const observedDeploymentMessage = platform.deployment.annotations?.["workers/message"];
    if (observedDeploymentMessage !== undefined && observedDeploymentMessage !== deploymentMessage) {
      throw new Error("latest Test deployment message does not match this checked-out HEAD");
    }
    if (Date.parse(platform.deployment.created_on) < deploymentStartedAt.getTime() - 120_000) {
      throw new Error("latest Test deployment predates the current deployment attempt");
    }
    const attestation = {
      schema_version: 1,
      scope: "tlsn-test-deployment-attestation",
      status: "PASS",
      captured_at: new Date().toISOString(),
      repository: {
        head_sha: gitCommitSha,
        head_checked_before_deploy: true,
      },
      deployment: {
        worker_name: workerName,
        deployment_id: platform.deployment.id,
        created_on: platform.deployment.created_on,
        source: platform.deployment.source,
        strategy: platform.deployment.strategy,
        annotations: platform.deployment.annotations ?? null,
        requested_message: deploymentMessage,
        requested_tag: deploymentTag,
        message_observation_status: observedDeploymentMessage === undefined ? "UNAVAILABLE" : "MATCH",
        versions: platform.deployment.versions,
      },
      version: {
        version_id: platform.version.id,
        metadata: platform.version.metadata ?? null,
        serving_percentage: 100,
      },
      runtime: {
        observed_version_id: null,
        observation_status: "PENDING_REMOTE_HEALTH_CHECK",
      },
      result_identity: {
        signer_key_id: resultIdentity.signerKeyId,
        public_key_spki: resultIdentity.publicKeySpki,
        public_key_spki_sha256: createHash("sha256").update(Buffer.from(resultIdentity.publicKeySpki, "base64url")).digest("base64url"),
        registry_sha256: resultIdentity.registrySha256,
      },
      evidence_identity: {
        canonical_target_checked: true,
        deployment_input_head_sha: gitCommitSha,
        platform_metadata_captured_after_deploy: true,
        active_version_is_100_percent: true,
      },
    };
    const attestationPath = process.env.TLSN_TEST_DEPLOYMENT_ATTESTATION_PATH?.trim();
    if (attestationPath) await writeDeploymentAttestation(attestationPath, attestation);
    console.log(JSON.stringify({
      status: attestation.status,
      worker_name: workerName,
      deployment_id: platform.deployment.id,
      version_id: platform.version.id,
      attestation_path: attestationPath ?? null,
    }));
  } finally {
    await rm(secretDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));