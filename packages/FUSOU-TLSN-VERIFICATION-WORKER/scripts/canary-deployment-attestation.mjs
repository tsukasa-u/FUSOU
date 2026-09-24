#!/usr/bin/env node

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { assertCanonicalCanaryWorkerName } from "./canary-deployment-target.mjs";

export const CANARY_DEPLOYMENT_ATTESTATION_SCHEMA_VERSION = 1;
export const CANARY_DEPLOYMENT_ATTESTATION_SCOPE = "tlsn-canary-deployment-runtime-attestation";
export const CANARY_DEPLOYMENT_FIXTURE_SCOPE = "tlsn-canary-deployment-runtime-attestation-fixture";
export const CANARY_DEPLOYMENT_READINESS = "READY_FOR_HUMAN_GAMEPLAY";
export const CANARY_DEPLOYMENT_NOT_READY = "NOT_READY";
export const CANARY_DEPLOYMENT_BINDING_SCHEMA_VERSION = 1;

const VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is missing`);
  return value.trim();
}

function requiredVersionId(value, label) {
  const versionId = requiredString(value, label);
  if (!VERSION_ID_PATTERN.test(versionId)) throw new Error(`${label} is invalid`);
  return versionId;
}

function requiredKeyId(value, label) {
  const keyId = requiredString(value, label);
  if (!KEY_ID_PATTERN.test(keyId)) throw new Error(`${label} is invalid`);
  return keyId;
}

function bindingAuthorityPublicKey(value, label) {
  try {
    const key = createPublicKey({ key: Buffer.from(requiredString(value, label), "base64url"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

function bindingAuthorityPrivateKey(value, label) {
  try {
    const key = createPrivateKey({ key: Buffer.from(requiredString(value, label), "base64url"), format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

function bindingAuthorityPublicKeySpki(privateKey) {
  return createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64url");
}

export function canaryDeploymentBindingPayload({ deploymentId, workerName, gitCommitSha }) {
  const canonicalWorkerName = assertCanonicalCanaryWorkerName(workerName);
  const logicalDeploymentId = requiredString(deploymentId, "Canary deployment identity");
  const commitSha = requiredString(gitCommitSha, "checked-out Git SHA").toLowerCase();
  if (!SHA_PATTERN.test(commitSha)) throw new Error("checked-out Git SHA is invalid");
  return Buffer.from([
    `schema_version=${CANARY_DEPLOYMENT_BINDING_SCHEMA_VERSION}`,
    `deployment_id=${logicalDeploymentId}`,
    `worker_name=${canonicalWorkerName}`,
    `git_commit_sha=${commitSha}`,
  ].join("\n"), "utf8");
}

export function createCanaryDeploymentMessage({
  deploymentId,
  workerName,
  gitCommitSha,
  bindingAuthorityKeyId,
  bindingAuthorityPrivateKeyPkcs8,
  expectedBindingAuthorityPublicKeySpki,
}) {
  const keyId = requiredKeyId(bindingAuthorityKeyId, "Canary Binding Authority key ID");
  const privateKey = bindingAuthorityPrivateKey(bindingAuthorityPrivateKeyPkcs8, "Canary Binding Authority private key");
  const derivedPublicKeySpki = bindingAuthorityPublicKeySpki(privateKey);
  if (derivedPublicKeySpki !== requiredString(expectedBindingAuthorityPublicKeySpki, "Canary Binding Authority public key")) {
    throw new Error("Canary Binding Authority key pair does not match");
  }
  const payload = canaryDeploymentBindingPayload({ deploymentId, workerName, gitCommitSha });
  const commitSha = requiredString(gitCommitSha, "checked-out Git SHA").toLowerCase();
  return `FUSOU Canary deployment ${commitSha} binding=v${CANARY_DEPLOYMENT_BINDING_SCHEMA_VERSION}:${keyId}:${sign(null, payload, privateKey).toString("base64url")}`;
}

function verifyCanaryDeploymentMessage({
  message,
  deploymentId,
  workerName,
  gitCommitSha,
  bindingAuthorityKeyId,
  bindingAuthorityPublicKeySpki,
  label,
}) {
  const keyId = requiredKeyId(bindingAuthorityKeyId, "Canary Binding Authority key ID");
  const publicKey = bindingAuthorityPublicKey(bindingAuthorityPublicKeySpki, "Canary Binding Authority public key");
  const commitSha = requiredString(gitCommitSha, "checked-out Git SHA").toLowerCase();
  const prefix = `FUSOU Canary deployment ${commitSha} binding=v${CANARY_DEPLOYMENT_BINDING_SCHEMA_VERSION}:`;
  if (typeof message !== "string" || !message.startsWith(prefix)) throw new Error(`${label} is not an authenticated Canary deployment binding`);
  const binding = message.slice(prefix.length);
  const separator = binding.indexOf(":");
  if (separator <= 0 || binding.slice(0, separator) !== keyId) throw new Error(`${label} Canary Binding Authority key does not match`);
  let signature;
  try {
    signature = Buffer.from(binding.slice(separator + 1), "base64url");
  } catch {
    throw new Error(`${label} Canary deployment binding signature is malformed`);
  }
  if (!verify(null, canaryDeploymentBindingPayload({ deploymentId, workerName, gitCommitSha }), publicKey, signature)) {
    throw new Error(`${label} is not bound to the authorized Canary deployment identity`);
  }
  return { schema_version: CANARY_DEPLOYMENT_BINDING_SCHEMA_VERSION, authority_key_id: keyId };
}

function payloadArray(payload, key, label) {
  const value = Array.isArray(payload) ? payload : payload?.[key] ?? payload?.result?.[key];
  if (!Array.isArray(value)) throw new Error(`${label} is malformed`);
  return value;
}

function annotationsOf(value, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} annotations are malformed`);
  return value;
}

function assertTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid`);
  return value;
}

function normalizeDeployment(deployment, expectedVersionId) {
  if (!deployment || typeof deployment !== "object" || Array.isArray(deployment)) {
    throw new Error("Cloudflare deployment metadata is malformed");
  }
  const deploymentId = requiredString(deployment.id, "Cloudflare deployment ID");
  assertTimestamp(deployment.created_on, "Cloudflare deployment created_on");
  if (!Array.isArray(deployment.versions) || deployment.versions.length !== 1) {
    throw new Error("Canary deployment must contain exactly one serving version");
  }
  const servingVersion = deployment.versions[0];
  if (!servingVersion || typeof servingVersion !== "object") throw new Error("Cloudflare deployment version traffic is malformed");
  const servingVersionId = requiredVersionId(servingVersion.version_id, "Cloudflare serving version ID");
  if (servingVersionId !== expectedVersionId || servingVersion.percentage !== 100) {
    throw new Error("Canary deployment is not serving the deployed version at 100 percent");
  }
  const annotations = annotationsOf(deployment.annotations, "Cloudflare deployment");
  return {
    id: deploymentId,
    created_on: deployment.created_on,
    source: deployment.source ?? null,
    strategy: deployment.strategy ?? null,
    annotations,
    versions: [{ version_id: servingVersionId, percentage: 100 }],
  };
}

function normalizeVersion(version, expectedVersionId) {
  if (!version || typeof version !== "object" || Array.isArray(version)) {
    throw new Error("Cloudflare version metadata is malformed");
  }
  const versionId = requiredVersionId(version.id, "Cloudflare version ID");
  if (versionId !== expectedVersionId) throw new Error("Cloudflare version metadata does not match the deployed version");
  const metadata = version.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Cloudflare version metadata details are malformed");
  }
  assertTimestamp(metadata.created_on, "Cloudflare version metadata.created_on");
  return {
    id: versionId,
    metadata,
    annotations: annotationsOf(version.annotations, "Cloudflare version"),
  };
}

export function normalizeCanaryPlatformMetadata({ deploymentPayload, versionPayload, workerName, expectedVersionId }) {
  const canonicalWorkerName = assertCanonicalCanaryWorkerName(workerName);
  const versionId = requiredVersionId(expectedVersionId, "deployed version ID");
  const deployments = payloadArray(deploymentPayload, "deployments", "Cloudflare deployment metadata");
  const versions = payloadArray(versionPayload, "items", "Cloudflare version metadata");
  const matchingDeployments = deployments.filter((candidate) =>
    Array.isArray(candidate?.versions) && candidate.versions.some((entry) => entry?.version_id === versionId),
  );
  if (matchingDeployments.length !== 1) throw new Error("deployed version must identify exactly one Cloudflare deployment");
  const deployment = normalizeDeployment(matchingDeployments[0], versionId);
  const versionCandidates = versions.filter((candidate) => candidate?.id === versionId);
  if (versionCandidates.length !== 1) throw new Error("deployed version must identify exactly one Cloudflare version");
  const version = normalizeVersion(versionCandidates[0], versionId);
  return {
    worker_name: canonicalWorkerName,
    deployment,
    version,
    serving_percentage: 100,
  };
}

function expectedAnnotation(annotations, name, expected, label) {
  if (annotations[name] !== expected) throw new Error(`${label} ${name} does not match the checked-out HEAD`);
}

export function verifyCanaryDeploymentRuntime({
  platform,
  runtimeHealth,
  workerName,
  expectedDeploymentId,
  expectedGitCommitSha,
  expectedVersionId,
  expectedDeploymentMessage,
  expectedDeploymentTag,
  expectedBindingAuthorityKeyId,
  expectedBindingAuthorityPublicKeySpki,
  deploymentStartedAt,
  fixtureOnly = false,
}) {
  const canonicalWorkerName = assertCanonicalCanaryWorkerName(workerName);
  const deploymentId = requiredString(expectedDeploymentId, "Canary deployment identity");
  const commitSha = requiredString(expectedGitCommitSha, "checked-out Git SHA").toLowerCase();
  if (!SHA_PATTERN.test(commitSha)) throw new Error("checked-out Git SHA is invalid");
  const versionId = requiredVersionId(expectedVersionId, "deployed version ID");
  if (!platform || platform.worker_name !== canonicalWorkerName) throw new Error("platform Worker identity does not match canonical Canary");
  if (platform.version?.id !== versionId || platform.deployment?.versions?.[0]?.version_id !== versionId) {
    throw new Error("platform deployment and version are not bound to the deployed version");
  }
  if (platform.serving_percentage !== 100) throw new Error("platform version is not serving at 100 percent");
  const platformDeploymentMessage = platform.deployment.annotations?.["workers/message"];
  const platformVersionMessage = platform.version.annotations?.["workers/message"];
  if (platformDeploymentMessage !== platformVersionMessage) {
    throw new Error("Cloudflare deployment and version do not share the same authenticated Canary binding");
  }
  const deploymentBinding = verifyCanaryDeploymentMessage({
    message: platformDeploymentMessage,
    deploymentId,
    workerName: canonicalWorkerName,
    gitCommitSha: commitSha,
    bindingAuthorityKeyId: expectedBindingAuthorityKeyId,
    bindingAuthorityPublicKeySpki: expectedBindingAuthorityPublicKeySpki,
    label: "Cloudflare deployment",
  });
  verifyCanaryDeploymentMessage({
    message: platformVersionMessage,
    deploymentId,
    workerName: canonicalWorkerName,
    gitCommitSha: commitSha,
    bindingAuthorityKeyId: expectedBindingAuthorityKeyId,
    bindingAuthorityPublicKeySpki: expectedBindingAuthorityPublicKeySpki,
    label: "Cloudflare version",
  });
  if (expectedDeploymentMessage !== undefined) {
    expectedAnnotation(platform.version.annotations, "workers/message", expectedDeploymentMessage, "Canary version");
    expectedAnnotation(platform.deployment.annotations, "workers/message", expectedDeploymentMessage, "Canary deployment");
  }
  if (expectedDeploymentTag !== undefined) {
    expectedAnnotation(platform.version.annotations, "workers/tag", expectedDeploymentTag, "Canary version");
    if (platform.deployment.annotations["workers/tag"] !== undefined) {
      expectedAnnotation(platform.deployment.annotations, "workers/tag", expectedDeploymentTag, "Canary deployment");
    }
  }
  if (deploymentStartedAt !== undefined) {
    const startedAt = deploymentStartedAt instanceof Date ? deploymentStartedAt.getTime() : Date.parse(deploymentStartedAt);
    if (!Number.isFinite(startedAt) || Date.parse(platform.deployment.created_on) < startedAt - 120_000) {
      throw new Error("Cloudflare deployment metadata is stale or predates the current deployment attempt");
    }
  }
  if (fixtureOnly) throw new Error("fixture or synthetic Canary evidence cannot become a real attestation");
  if (!runtimeHealth || typeof runtimeHealth !== "object" || Array.isArray(runtimeHealth)) throw new Error("Canary /health response is malformed");
  if (runtimeHealth.schema_version !== 2 || runtimeHealth.ok !== true) throw new Error("Canary /health response is not a passing schema");
  if (runtimeHealth.environment !== "production" || runtimeHealth.deployment_role !== "canary") throw new Error("runtime is not production Canary");
  if (runtimeHealth.git_commit_sha !== commitSha) throw new Error("runtime Git SHA does not match checked-out HEAD");
  if (runtimeHealth.deployment_id !== deploymentId) throw new Error("runtime deployment identity does not match the authorized Canary deployment");
  if (runtimeHealth.binding_mode !== "fixed_canary") throw new Error("runtime binding mode is not fixed_canary");
  const runtimeIdentity = runtimeHealth.deployment_identity;
  if (!runtimeIdentity || runtimeIdentity.deployment_id !== deploymentId || runtimeIdentity.deployment_role !== "canary" || runtimeIdentity.binding_mode !== "fixed_canary" || runtimeIdentity.worker_name !== canonicalWorkerName) {
    throw new Error("runtime deployment identity is inconsistent with the authorized Canary");
  }
  if (runtimeHealth.runtime_version?.version_id !== versionId) throw new Error("runtime version does not match the Cloudflare platform version");
  return {
    platform_deployment_id: platform.deployment.id,
    platform_version_id: platform.version.id,
    runtime_deployment_id: runtimeHealth.deployment_id,
    runtime_version_id: runtimeHealth.runtime_version.version_id,
    worker_name: canonicalWorkerName,
    deployment_role: "canary",
    git_commit_sha: commitSha,
    deployment_binding: deploymentBinding,
  };
}

function runCaptured(command, argumentsList, environment) {
  const result = spawnSync(command, argumentsList, {
    cwd: resolve(new URL("..", import.meta.url).pathname),
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${argumentsList.join(" ")} failed with status ${result.status}: ${result.stderr.trim()}`);
  return result.stdout;
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw.trim());
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

async function platformMetadataAfterDeploy({ workerName, expectedVersionId, environment }) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const deploymentPayload = parseJson(
        runCaptured("pnpm", ["exec", "wrangler", "deployments", "list", "--name", workerName, "--json"], environment),
        "Wrangler deployment metadata",
      );
      const versionPayload = parseJson(
        runCaptured("pnpm", ["exec", "wrangler", "versions", "list", "--name", workerName, "--json"], environment),
        "Wrangler version metadata",
      );
      return normalizeCanaryPlatformMetadata({ deploymentPayload, versionPayload, workerName, expectedVersionId });
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolveAttempt) => setTimeout(resolveAttempt, 2_000));
    }
  }
  throw lastError ?? new Error("Canary platform metadata was not available");
}

export async function fetchCanaryHealth(url, fetchImpl = fetch) {
  const origin = new URL(requiredString(url, "Canary Worker internal URL"));
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.port || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Canary Worker internal URL must be a clean HTTPS origin");
  }
  const healthUrl = `${origin.origin}/health`;
  const response = await fetchImpl(healthUrl, { redirect: "error", headers: { accept: "application/json" } });
  if (response.redirected || response.url !== healthUrl) throw new Error("Canary /health response did not come from the requested canonical origin");
  if (!response.ok) throw new Error(`Canary /health returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error("Canary /health did not return JSON");
  }
}

export async function writeImmutableCanaryAttestation(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const handle = await open(target, "wx", 0o444);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
}

export function createCanaryDeploymentAttestation({
  verification,
  platform,
  runtimeHealth,
  expectedDeploymentId,
  expectedGitCommitSha,
  expectedDeploymentMessage,
  expectedDeploymentTag,
  workflow,
  capturedAt = new Date().toISOString(),
  evidenceMode = "real",
}) {
  const fixture = evidenceMode === "fixture";
  const status = fixture ? "FIXTURE_ONLY" : "PASS";
  return {
    schema_version: CANARY_DEPLOYMENT_ATTESTATION_SCHEMA_VERSION,
    scope: fixture ? CANARY_DEPLOYMENT_FIXTURE_SCOPE : CANARY_DEPLOYMENT_ATTESTATION_SCOPE,
    status,
    captured_at: capturedAt,
    readiness: fixture ? CANARY_DEPLOYMENT_NOT_READY : CANARY_DEPLOYMENT_READINESS,
    evidence: {
      source: fixture ? "repository-fixture" : "cloudflare-platform-and-live-health",
      synthetic: fixture,
      immutable_write: "create-only",
    },
    repository: {
      git_commit_sha: expectedGitCommitSha,
      workflow_run_id: workflow?.workflow_run_id ?? null,
      workflow_run_attempt: workflow?.workflow_run_attempt ?? null,
      repository: workflow?.repository ?? null,
      workflow_file_identity: workflow?.workflow_file_identity ?? null,
    },
    deployment: {
      authorized_deployment_id: expectedDeploymentId,
      platform_deployment_id: platform.deployment.id,
      worker_name: verification.worker_name,
      deployment_role: verification.deployment_role,
      created_on: platform.deployment.created_on,
      source: platform.deployment.source,
      strategy: platform.deployment.strategy,
      annotations: platform.deployment.annotations,
      versions: platform.deployment.versions,
      binding: verification.deployment_binding,
      requested_message: expectedDeploymentMessage ?? null,
      requested_tag: expectedDeploymentTag ?? null,
    },
    version: {
      version_id: platform.version.id,
      metadata: platform.version.metadata,
      annotations: platform.version.annotations,
      serving_percentage: platform.serving_percentage,
    },
    runtime_self_reported_identity: {
      deployment_id: runtimeHealth.deployment_id,
      deployment_role: runtimeHealth.deployment_role,
      worker_name: runtimeHealth.deployment_identity.worker_name,
      git_commit_sha: runtimeHealth.git_commit_sha,
      runtime_version: runtimeHealth.runtime_version,
      binding_mode: runtimeHealth.binding_mode,
    },
    checks: {
      canonical_worker: true,
      platform_deployment_contains_deployed_version: true,
      platform_deployment_binding_matches_authorized_identity: true,
      platform_version_binding_matches_authorized_identity: true,
      platform_version_serving_100_percent: true,
      deployment_message_matches_head: expectedDeploymentMessage !== undefined,
      deployment_tag_matches_head: expectedDeploymentTag !== undefined,
      runtime_is_production_canary: true,
      runtime_deployment_matches_authorized_identity: true,
      runtime_version_matches_platform_version: true,
      runtime_git_sha_matches_head: true,
      synthetic_evidence_rejected: !fixture,
    },
  };
}

export async function attestCanaryDeployment({
  workerName,
  expectedDeploymentId,
  expectedGitCommitSha,
  expectedVersionId,
  expectedDeploymentMessage,
  expectedDeploymentTag,
  deploymentStartedAt,
  runtimeUrl,
  environment,
  workflow,
  artifactPath,
}) {
  if (environment?.TLSN_CANARY_FIXTURE_ONLY?.trim() === "true") throw new Error("fixture-only Canary deployment cannot produce a real attestation");
  const platform = await platformMetadataAfterDeploy({ workerName, expectedVersionId, environment });
  const runtimeHealth = await fetchCanaryHealth(runtimeUrl);
  const verification = verifyCanaryDeploymentRuntime({
    platform,
    runtimeHealth,
    workerName,
    expectedDeploymentId,
    expectedGitCommitSha,
    expectedVersionId,
    expectedDeploymentMessage,
    expectedDeploymentTag,
    expectedBindingAuthorityKeyId: environment?.TLSN_CANARY_BINDING_AUTHORITY_KEY_ID,
    expectedBindingAuthorityPublicKeySpki: environment?.TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI,
    deploymentStartedAt,
  });
  const attestation = createCanaryDeploymentAttestation({
    verification,
    platform,
    runtimeHealth,
    expectedDeploymentId,
    expectedGitCommitSha,
    expectedDeploymentMessage,
    expectedDeploymentTag,
    workflow,
  });
  await writeImmutableCanaryAttestation(artifactPath, attestation);
  return { attestation, platform, runtimeHealth };
}
