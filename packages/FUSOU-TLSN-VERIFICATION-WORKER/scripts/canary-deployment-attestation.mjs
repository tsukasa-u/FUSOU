#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import {
  assertCanonicalCanaryDeploymentWorkerName,
  assertCanonicalCanaryWorkerName,
  CANARY_VERIFIER_WORKER_NAME,
} from "./canary-deployment-target.mjs";
import { canaryDeploymentManifestBinding, deploymentManifestIdentity } from "./canary-deployment-manifest.mjs";
import { canonicalJson } from "./deployment-attestation.mjs";
import { assertSignedResultRegistryEnvelope, resultRegistryEnvelopeHash } from "./result-registry-envelope.mjs";
import { assertSigningKeyRegistry } from "./signing-key-registry.mjs";
import { loadCanaryRuntimeAttestationKeyRegistry } from "./canary-runtime-attestation-key-registry.mjs";
import {
  assertCanaryVerifierIdentityKeyRegistry,
  canaryVerifierIdentityKeyRegistrySha256,
} from "./canary-verifier-identity.mjs";
import {
  assertCanaryRuntimeAttestationSignature,
  signCanaryRuntimeAttestation,
} from "./canary-runtime-attestation-signing.mjs";

export const CANARY_DEPLOYMENT_ATTESTATION_SCHEMA_VERSION = 2;
export const CANARY_DEPLOYMENT_ATTESTATION_SCOPE = "tlsn-canary-deployment-runtime-attestation";
export const CANARY_DEPLOYMENT_FIXTURE_SCOPE = "tlsn-canary-deployment-runtime-attestation-fixture";
export const CANARY_DEPLOYMENT_READINESS = "CANARY_RUNTIME_IDENTITY_VERIFIED";
export const CANARY_DEPLOYMENT_NOT_READY = "NOT_READY";
export const CANARY_DEPLOYMENT_BINDING_SCHEMA_VERSION = 1;

const VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REQUIRED_RUNTIME_ATTESTATION_CHECKS = [
  "synthetic_evidence_rejected",
  "runtime_is_production_canary",
  "runtime_deployment_matches_authorized_identity",
  "runtime_version_matches_platform_version",
  "runtime_git_sha_matches_head",
  "verifier_platform_identity_matches_authorized_deployment",
  "verifier_runtime_matches_platform_version",
  "verifier_identity_key_matches_active_registry",
  "result_signer_deployment_binding",
];
const CANARY_RESULT_SIGNER_INPUTS = [
  "TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_RESULT_SIGNER_KEY_ID",
  "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY",
  "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE",
  "TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID",
  "TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI",
];

export function canaryDeploymentAttestationArtifactPath({
  baseDirectory = process.cwd(),
  explicitPath,
  deploymentId,
  workflowRunId,
  workflowRunAttempt,
} = {}) {
  if (typeof explicitPath === "string" && explicitPath.trim().length > 0) {
    return resolve(baseDirectory, explicitPath.trim());
  }
  const suffix = workflowRunId && workflowRunAttempt
    ? `-${workflowRunId}-${workflowRunAttempt}`
    : deploymentId
      ? `-${String(deploymentId).replace(/[^A-Za-z0-9._-]/g, "-")}`
      : "";
  return resolve(baseDirectory, `artifacts/tlsn-canary-deployment-runtime-attestation${suffix}.json`);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed`);
}

function assertExactString(value, expected, label) {
  if (value !== expected) throw new Error(`${label} does not match the expected Runtime Attestation value`);
}

function timestampMilliseconds(value, label) {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) throw new Error(`${label} is invalid`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

function validationNowMilliseconds(now) {
  const parsed = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(parsed)) throw new Error("Runtime Attestation validation time is invalid");
  return parsed;
}

function assertCanaryDeploymentAttestationFreshness(attestation, manifest, now) {
  const capturedAt = timestampMilliseconds(attestation.captured_at, "Runtime Attestation captured_at");
  const validationNow = validationNowMilliseconds(now);
  const manifestBinding = canaryDeploymentManifestBinding(manifest);
  const issuedAt = timestampMilliseconds(manifestBinding.issued_at, "Canary deployment manifest.issued_at");
  const expiresAt = timestampMilliseconds(manifestBinding.expires_at, "Canary deployment manifest.expires_at");
  if (expiresAt <= issuedAt || issuedAt > validationNow || expiresAt <= validationNow) {
    throw new Error("Canary deployment manifest validity window is not current");
  }
  if (capturedAt > validationNow) throw new Error("Runtime Attestation captured_at is in the future");
  if (capturedAt < issuedAt || capturedAt > expiresAt) {
    throw new Error("Runtime Attestation captured_at is outside the deployment manifest validity window");
  }
  return true;
}

function canaryResultSignerInputs(environment, now = new Date()) {
  assertObject(environment, "current Canary environment");
  const values = Object.fromEntries(CANARY_RESULT_SIGNER_INPUTS.map((name) => [
    name,
    requiredString(environment[name], `current Canary environment.${name}`),
  ]));
  let keyRegistry;
  let registryEnvelope;
  try {
    keyRegistry = JSON.parse(values.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY);
    registryEnvelope = JSON.parse(values.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE);
  } catch {
    throw new Error("current Canary Result signer registry or envelope is invalid JSON");
  }
  const registryBytes = Buffer.from(values.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY, "utf8");
  const envelopeBytes = Buffer.from(values.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE, "utf8");
  assertSignedResultRegistryEnvelope(registryEnvelope, {
    registry: keyRegistry,
    registryRaw: registryBytes,
    trustedRootKeyId: values.TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID,
    trustedRootPublicKeySpki: values.TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI,
  });
  const signerKeyId = values.TLSN_CANARY_RESULT_SIGNER_KEY_ID;
  const publicKeySpki = values.TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI;
  assertSigningKeyRegistry(keyRegistry, { currentKeyId: signerKeyId, currentPublicKeySpki: publicKeySpki, now });
  return {
    signer_key_id: signerKeyId,
    public_key_spki: publicKeySpki,
    public_key_spki_sha256: createHash("sha256").update(Buffer.from(publicKeySpki, "base64url")).digest("base64url"),
    key_registry_sha256: createHash("sha256").update(registryBytes).digest("base64url"),
    key_registry_envelope_sha256: resultRegistryEnvelopeHash(envelopeBytes),
    registry_root_key_id: values.TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID,
    registry_root_public_key_spki: values.TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI,
  };
}

function assertResultSignerDeploymentBinding(attestation, deploymentManifest, environment) {
  const manifestBinding = canaryDeploymentManifestBinding(deploymentManifest);
  assertExactString(deploymentManifestIdentity(deploymentManifest), manifestBinding.manifest_id, "Canary deployment manifest content hash");
  const manifestInputs = new Map((deploymentManifest.inputs ?? []).map((input) => [input?.name, input]));
  const expectedSigner = canaryResultSignerInputs(environment, new Date(attestation.captured_at));
  for (const name of CANARY_RESULT_SIGNER_INPUTS) {
    const input = manifestInputs.get(name);
    if (!input || typeof input.value_sha256 !== "string") {
      throw new Error(`Canary deployment manifest is missing Result signer input ${name}`);
    }
    const rawValue = requiredString(environment[name], `current Canary environment.${name}`);
    const bytes = name.endsWith("_REGISTRY_ENVELOPE")
      ? Buffer.from(canonicalJson(JSON.parse(rawValue)), "utf8")
      : Buffer.from(rawValue, "utf8");
    const expectedHash = createHash("sha256").update(bytes).digest("base64url");
    assertExactString(input.value_sha256, expectedHash, `Canary deployment manifest ${name} fingerprint`);
  }
  const resultIdentity = attestation.result_signer_identity;
  assertObject(resultIdentity, "Runtime Attestation result_signer_identity");
  for (const [field, expected] of Object.entries({
    ...expectedSigner,
    deployment_id: manifestBinding.deployment_id,
    worker_name: manifestBinding.worker_name,
    version_id: attestation.version.version_id,
  })) {
    assertExactString(resultIdentity[field], expected, `Runtime Attestation Result signer ${field}`);
  }
  return {
    status: "VALID",
    ...expectedSigner,
    deployment_id: manifestBinding.deployment_id,
    worker_name: manifestBinding.worker_name,
    version_id: attestation.version.version_id,
  };
}

function requiredWorkflowMetadata(workflow, label = "current workflow") {
  assertObject(workflow, label);
  return {
    workflow_run_id: requiredString(workflow.workflow_run_id ?? workflow.run_id, `${label}.workflow_run_id`),
    workflow_run_attempt: requiredString(workflow.workflow_run_attempt ?? workflow.run_attempt, `${label}.workflow_run_attempt`),
    repository: requiredString(workflow.repository, `${label}.repository`),
    workflow_file_identity: requiredString(workflow.workflow_file_identity, `${label}.workflow_file_identity`),
    git_commit_sha: requiredString(workflow.git_commit_sha ?? workflow.commit_sha, `${label}.git_commit_sha`).toLowerCase(),
  };
}

function requiredEnvironmentWorkflowMetadata(environment) {
  assertObject(environment, "current Canary environment");
  return requiredWorkflowMetadata({
    workflow_run_id: environment.TLSN_WORKFLOW_RUN_ID,
    workflow_run_attempt: environment.TLSN_WORKFLOW_RUN_ATTEMPT,
    repository: environment.TLSN_REPOSITORY,
    workflow_file_identity: environment.TLSN_WORKFLOW_FILE_IDENTITY,
    git_commit_sha: environment.TLSN_GIT_COMMIT_SHA,
  }, "current Canary environment");
}

function assertCanaryDeploymentCrossBinding(attestation, {
  currentHead,
  workflow,
  deploymentManifest,
  environment,
  now,
  servingVersionId,
} = {}) {
  const expectedHead = requiredString(currentHead, "current HEAD").toLowerCase();
  const expectedWorkflow = requiredWorkflowMetadata(workflow);
  const repository = attestation.repository;
  const attestationWorkflow = {
    workflow_run_id: requiredString(repository.workflow_run_id, "Runtime Attestation repository.workflow_run_id"),
    workflow_run_attempt: requiredString(repository.workflow_run_attempt, "Runtime Attestation repository.workflow_run_attempt"),
    repository: requiredString(repository.repository, "Runtime Attestation repository.repository"),
    workflow_file_identity: requiredString(repository.workflow_file_identity, "Runtime Attestation repository.workflow_file_identity"),
    git_commit_sha: requiredString(repository.git_commit_sha, "Runtime Attestation repository.git_commit_sha").toLowerCase(),
  };
  for (const field of ["workflow_run_id", "workflow_run_attempt", "repository", "workflow_file_identity", "git_commit_sha"]) {
    assertExactString(attestationWorkflow[field], expectedWorkflow[field], `Runtime Attestation workflow ${field}`);
  }
  assertExactString(attestationWorkflow.git_commit_sha, expectedHead, "Runtime Attestation workflow git_commit_sha");
  const manifest = canaryDeploymentManifestBinding(deploymentManifest);
  assertExactString(attestation.deployment.manifest_id, manifest.manifest_id, "Runtime Attestation manifest ID");
  assertExactString(attestation.deployment.authorized_deployment_id, manifest.deployment_id, "Runtime Attestation manifest deployment ID");
  assertExactString(attestation.deployment.worker_name, manifest.worker_name, "Runtime Attestation manifest worker name");
  assertExactString(attestation.deployment.deployment_role, manifest.deployment_role, "Runtime Attestation manifest deployment role");
  assertExactString(attestation.repository.git_commit_sha.toLowerCase(), manifest.commit_sha.toLowerCase(), "Runtime Attestation manifest commit");
  assertExactString(attestation.repository.workflow_run_id, manifest.workflow_run_id, "Runtime Attestation manifest workflow run ID");
  assertExactString(attestation.repository.workflow_run_attempt, manifest.workflow_run_attempt, "Runtime Attestation manifest workflow run attempt");
  assertExactString(attestation.repository.repository, manifest.repository, "Runtime Attestation manifest repository");
  assertExactString(attestation.repository.workflow_file_identity, manifest.workflow_file_identity, "Runtime Attestation manifest workflow identity");
  assertExactString(servingVersionId, attestation.deployment.versions[0].version_id, "Runtime Attestation serving version");

  const expectedEnvironment = requiredEnvironmentWorkflowMetadata(environment);
  assertExactString(requiredString(environment.TLSN_CANARY_DEPLOYMENT_ID, "current Canary environment.TLSN_CANARY_DEPLOYMENT_ID"), attestation.deployment.authorized_deployment_id, "Runtime Attestation environment deployment ID");
  assertExactString(requiredString(environment.TLSN_CANARY_WORKER_NAME, "current Canary environment.TLSN_CANARY_WORKER_NAME"), attestation.deployment.worker_name, "Runtime Attestation environment worker name");
  for (const field of ["workflow_run_id", "workflow_run_attempt", "repository", "workflow_file_identity", "git_commit_sha"]) {
    assertExactString(expectedEnvironment[field], attestationWorkflow[field], `Runtime Attestation environment ${field}`);
  }
  assertExactString(attestation.runtime_self_reported_identity.deployment_id, attestation.deployment.authorized_deployment_id, "Runtime Attestation runtime deployment ID");
  assertExactString(attestation.runtime_self_reported_identity.worker_name, attestation.deployment.worker_name, "Runtime Attestation runtime worker name");
  assertExactString(attestation.runtime_self_reported_identity.runtime_version.version_id, servingVersionId, "Runtime Attestation runtime serving version");
  assertResultSignerDeploymentBinding(attestation, deploymentManifest, environment);
  const verifierDeployment = attestation.verifier_deployment;
  const verifierVersion = attestation.verifier_version;
  const verifierRuntimeIdentity = attestation.verifier_runtime_identity;
  const verifierIdentity = attestation.verifier_identity;
  assertObject(verifierDeployment, "Runtime Attestation verifier_deployment");
  assertObject(verifierVersion, "Runtime Attestation verifier_version");
  assertObject(verifierRuntimeIdentity, "Runtime Attestation verifier_runtime_identity");
  assertObject(verifierIdentity, "Runtime Attestation verifier_identity");
  const verifierDeploymentId = requiredString(environment.TLSN_CANARY_VERIFIER_DEPLOYMENT_ID, "current Canary verifier deployment ID");
  const verifierKeyId = requiredString(environment.TLSN_CANARY_VERIFIER_IDENTITY_KEY_ID, "current Canary verifier identity key ID");
  const verifierPublicKeySpki = requiredString(environment.TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI, "current Canary verifier identity public key");
  const verifierWorkerName = assertCanonicalCanaryDeploymentWorkerName(verifierDeployment.worker_name);
  if (verifierWorkerName !== CANARY_VERIFIER_WORKER_NAME) throw new Error("Runtime Attestation verifier Worker is not canonical");
  assertExactString(verifierDeployment.deployment_role, "canary", "Runtime Attestation verifier deployment role");
  assertExactString(verifierDeployment.authorized_deployment_id, verifierDeploymentId, "Runtime Attestation verifier deployment ID");
  requiredString(verifierDeployment.platform_deployment_id, "Runtime Attestation verifier platform deployment ID");
  if (!Array.isArray(verifierDeployment.versions) || verifierDeployment.versions.length !== 1 || verifierDeployment.versions[0]?.percentage !== 100) {
    throw new Error("Runtime Attestation Verifier deployment is not serving exactly one version at 100 percent");
  }
  const verifierServingVersionId = requiredVersionId(verifierVersion.version_id, "Runtime Attestation verifier version ID");
  assertExactString(verifierDeployment.versions[0].version_id, verifierServingVersionId, "Runtime Attestation verifier serving version");
  if (verifierVersion.serving_percentage !== 100) throw new Error("Runtime Attestation verifier version is not serving at 100 percent");
  assertExactString(verifierIdentity.key_id, verifierKeyId, "Runtime Attestation verifier key ID");
  assertExactString(verifierIdentity.public_key_spki, verifierPublicKeySpki, "Runtime Attestation verifier public key");
  assertExactString(verifierIdentity.deployment_id, verifierDeploymentId, "Runtime Attestation verifier key deployment ID");
  assertExactString(verifierIdentity.worker_name, CANARY_VERIFIER_WORKER_NAME, "Runtime Attestation verifier key Worker name");
  assertExactString(verifierRuntimeIdentity.deployment_id, verifierDeploymentId, "Runtime Attestation verifier runtime deployment ID");
  assertExactString(verifierRuntimeIdentity.deployment_role, "canary", "Runtime Attestation verifier runtime role");
  assertExactString(verifierRuntimeIdentity.worker_name, CANARY_VERIFIER_WORKER_NAME, "Runtime Attestation verifier runtime Worker name");
  assertExactString(String(verifierRuntimeIdentity.git_commit_sha).toLowerCase(), expectedHead, "Runtime Attestation verifier runtime Git SHA");
  assertExactString(verifierRuntimeIdentity.runtime_version?.version_id, verifierServingVersionId, "Runtime Attestation verifier runtime version");
  assertExactString(verifierRuntimeIdentity.verifier_identity?.key_id, verifierKeyId, "Runtime Attestation verifier live key ID");
  assertExactString(verifierRuntimeIdentity.verifier_identity?.public_key_spki, verifierPublicKeySpki, "Runtime Attestation verifier live public key");
  assertExactString(verifierRuntimeIdentity.verifier_identity?.keypair_valid, true, "Runtime Attestation verifier live signing keypair");
  const verifierRegistryFromEnvironment = JSON.parse(requiredString(environment.TLSN_CANARY_VERIFIER_IDENTITY_KEY_REGISTRY, "current Canary verifier identity key registry"));
  if (canaryVerifierIdentityKeyRegistrySha256(verifierRegistryFromEnvironment) !== verifierIdentity.key_registry_sha256) {
    throw new Error("Runtime Attestation verifier key registry does not match the current deployment input");
  }
  assertCanaryVerifierIdentityKeyRegistry(verifierIdentity.key_registry, {
    now: new Date(attestation.captured_at),
    currentIdentity: {
      status: "VALID",
      verifier_key_id: verifierKeyId,
      public_key_spki: verifierPublicKeySpki,
      deployment_id: verifierDeploymentId,
      worker_name: CANARY_VERIFIER_WORKER_NAME,
    },
  });
  assertExactString(
    canaryVerifierIdentityKeyRegistrySha256(verifierIdentity.key_registry),
    canaryVerifierIdentityKeyRegistrySha256(verifierRegistryFromEnvironment),
    "Runtime Attestation verifier identity key registry",
  );
  const verifierPlatformDeploymentMessage = verifierDeployment.annotations?.["workers/message"];
  const verifierPlatformVersionMessage = verifierVersion.annotations?.["workers/message"];
  if (verifierPlatformDeploymentMessage !== verifierPlatformVersionMessage) {
    throw new Error("Runtime Attestation verifier deployment and version messages differ");
  }
  verifyCanaryDeploymentMessage({
    message: verifierPlatformDeploymentMessage,
    deploymentId: verifierDeploymentId,
    workerName: CANARY_VERIFIER_WORKER_NAME,
    gitCommitSha: expectedHead,
    bindingAuthorityKeyId: environment.TLSN_CANARY_BINDING_AUTHORITY_KEY_ID,
    bindingAuthorityPublicKeySpki: environment.TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI,
    label: "Runtime Attestation Cloudflare verifier deployment",
  });
  verifyCanaryDeploymentMessage({
    message: verifierPlatformVersionMessage,
    deploymentId: verifierDeploymentId,
    workerName: CANARY_VERIFIER_WORKER_NAME,
    gitCommitSha: expectedHead,
    bindingAuthorityKeyId: environment.TLSN_CANARY_BINDING_AUTHORITY_KEY_ID,
    bindingAuthorityPublicKeySpki: environment.TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI,
    label: "Runtime Attestation Cloudflare verifier version",
  });
  assertExactString(verifierDeployment.annotations?.["workers/tag"], `verifier-canary-${expectedHead.slice(0, 12)}`, "Runtime Attestation verifier deployment tag");
  assertExactString(verifierVersion.annotations?.["workers/tag"], `verifier-canary-${expectedHead.slice(0, 12)}`, "Runtime Attestation verifier version tag");
  const currentNow = validationNowMilliseconds(now);
  assertCanaryVerifierIdentityKeyRegistry(verifierIdentity.key_registry, {
    now: new Date(currentNow),
    currentIdentity: {
      status: "VALID",
      verifier_key_id: verifierKeyId,
      public_key_spki: verifierPublicKeySpki,
      deployment_id: verifierDeploymentId,
      worker_name: CANARY_VERIFIER_WORKER_NAME,
    },
  });
  const attestationFresh = assertCanaryDeploymentAttestationFreshness(attestation, deploymentManifest, now);
  return {
    status: "PASS",
    workflow_attestation: true,
    manifest_attestation: true,
    environment_attestation: true,
    version_serving: true,
    verifier_identity_binding: true,
    result_signer_deployment_binding: true,
    attestation_fresh: attestationFresh,
  };
}

export function assertCanaryDeploymentRuntimeAttestation(attestation, {
  currentHead,
  workflow,
  deploymentManifest,
  environment,
  runtimeAttestationKeyRegistry,
  now = new Date(),
} = {}) {
  assertObject(attestation, "Runtime Attestation");
  assertExactString(attestation.schema_version, CANARY_DEPLOYMENT_ATTESTATION_SCHEMA_VERSION, "Runtime Attestation schema_version");
  assertExactString(attestation.scope, CANARY_DEPLOYMENT_ATTESTATION_SCOPE, "Runtime Attestation scope");
  assertExactString(attestation.status, "PASS", "Runtime Attestation status");
  assertExactString(attestation.readiness, CANARY_DEPLOYMENT_READINESS, "Runtime Attestation readiness");
  const signature = assertCanaryRuntimeAttestationSignature(attestation, {
    registry: runtimeAttestationKeyRegistry,
  });
  assertObject(attestation.evidence, "Runtime Attestation evidence");
  assertExactString(attestation.evidence.synthetic, false, "Runtime Attestation evidence.synthetic");
  assertExactString(attestation.evidence.source, "cloudflare-platform-and-live-health", "Runtime Attestation evidence.source");
  assertObject(attestation.repository, "Runtime Attestation repository");
  const expectedHead = requiredString(currentHead, "current HEAD").toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) throw new Error("current HEAD is invalid");
  assertExactString(String(attestation.repository.git_commit_sha).toLowerCase(), expectedHead, "Runtime Attestation repository.git_commit_sha");
  assertObject(attestation.deployment, "Runtime Attestation deployment");
  assertExactString(attestation.deployment.deployment_role, "canary", "Runtime Attestation deployment.deployment_role");
  const authorizedDeploymentId = requiredString(attestation.deployment.authorized_deployment_id, "Runtime Attestation deployment.authorized_deployment_id");
  requiredString(attestation.deployment.platform_deployment_id, "Runtime Attestation deployment.platform_deployment_id");
  const deploymentWorkerName = assertCanonicalCanaryWorkerName(attestation.deployment.worker_name);
  if (!Array.isArray(attestation.deployment.versions) || attestation.deployment.versions.length !== 1 || attestation.deployment.versions[0]?.percentage !== 100) {
    throw new Error("Runtime Attestation deployment is not serving exactly one version at 100 percent");
  }
  assertObject(attestation.version, "Runtime Attestation version");
  const servingVersionId = requiredVersionId(attestation.version.version_id, "Runtime Attestation version.version_id");
  assertExactString(attestation.deployment.versions[0].version_id, servingVersionId, "Runtime Attestation serving version");
  if (attestation.version.serving_percentage !== 100) throw new Error("Runtime Attestation version is not serving at 100 percent");
  assertObject(attestation.runtime_self_reported_identity, "Runtime Attestation runtime_self_reported_identity");
  assertExactString(attestation.runtime_self_reported_identity.deployment_role, "canary", "Runtime Attestation runtime_self_reported_identity.deployment_role");
  assertExactString(String(attestation.runtime_self_reported_identity.git_commit_sha).toLowerCase(), expectedHead, "Runtime Attestation runtime_self_reported_identity.git_commit_sha");
  assertExactString(attestation.runtime_self_reported_identity.deployment_id, authorizedDeploymentId, "Runtime Attestation runtime deployment ID");
  assertExactString(attestation.runtime_self_reported_identity.worker_name, deploymentWorkerName, "Runtime Attestation runtime worker name");
  assertObject(attestation.runtime_self_reported_identity.runtime_version, "Runtime Attestation runtime_self_reported_identity.runtime_version");
  assertExactString(attestation.runtime_self_reported_identity.runtime_version.version_id, servingVersionId, "Runtime Attestation runtime version");
  assertObject(attestation.verifier_deployment, "Runtime Attestation verifier_deployment");
  assertObject(attestation.verifier_version, "Runtime Attestation verifier_version");
  assertObject(attestation.verifier_runtime_identity, "Runtime Attestation verifier_runtime_identity");
  assertObject(attestation.verifier_identity, "Runtime Attestation verifier_identity");
  assertObject(attestation.result_signer_identity, "Runtime Attestation result_signer_identity");
  if (attestation.verifier_deployment.deployment_role !== "canary") throw new Error("Runtime Attestation verifier is not a Canary deployment");
  assertCanonicalCanaryDeploymentWorkerName(attestation.verifier_deployment.worker_name);
  if (attestation.verifier_deployment.worker_name !== CANARY_VERIFIER_WORKER_NAME) throw new Error("Runtime Attestation verifier Worker is not canonical");
  if (!Array.isArray(attestation.verifier_deployment.versions) || attestation.verifier_deployment.versions.length !== 1 || attestation.verifier_deployment.versions[0]?.percentage !== 100) {
    throw new Error("Runtime Attestation verifier deployment is not serving exactly one version at 100 percent");
  }
  const verifierServingVersionId = requiredVersionId(attestation.verifier_version.version_id, "Runtime Attestation verifier version.version_id");
  assertExactString(attestation.verifier_deployment.versions[0].version_id, verifierServingVersionId, "Runtime Attestation verifier serving version");
  if (attestation.verifier_version.serving_percentage !== 100) throw new Error("Runtime Attestation verifier version is not serving at 100 percent");
  assertCanaryVerifierIdentityKeyRegistry(attestation.verifier_identity.key_registry, {
    now: new Date(attestation.captured_at),
    currentIdentity: {
      status: "VALID",
      verifier_key_id: attestation.verifier_identity.key_id,
      public_key_spki: attestation.verifier_identity.public_key_spki,
      deployment_id: attestation.verifier_deployment.authorized_deployment_id,
      worker_name: CANARY_VERIFIER_WORKER_NAME,
    },
  });
  assertExactString(canaryVerifierIdentityKeyRegistrySha256(attestation.verifier_identity.key_registry), attestation.verifier_identity.key_registry_sha256, "Runtime Attestation verifier key registry hash");
  assertObject(attestation.checks, "Runtime Attestation checks");
  for (const check of REQUIRED_RUNTIME_ATTESTATION_CHECKS) assertExactString(attestation.checks[check], true, `Runtime Attestation checks.${check}`);
  const crossBinding = assertCanaryDeploymentCrossBinding(attestation, {
    currentHead: expectedHead,
    workflow,
    deploymentManifest,
    environment,
    now,
    servingVersionId,
  });
  const deploymentManifestBinding = canaryDeploymentManifestBinding(deploymentManifest);
  return {
    status: "VALID",
    readiness: attestation.readiness,
    git_commit_sha: attestation.repository.git_commit_sha,
    deployment_id: authorizedDeploymentId,
    worker_name: deploymentWorkerName,
    workflow_run_id: attestation.repository.workflow_run_id,
    workflow_run_attempt: attestation.repository.workflow_run_attempt,
    repository: attestation.repository.repository,
    workflow_file_identity: attestation.repository.workflow_file_identity,
    version_id: servingVersionId,
    platform_deployment_id: attestation.deployment.platform_deployment_id,
    attestation_signer_key_id: signature.signer_key_id,
    signature_algorithm: signature.signature_algorithm,
    signature_valid: true,
    verifier_identity: {
      status: "VALID",
      deployment_id: attestation.verifier_deployment.authorized_deployment_id,
      worker_name: attestation.verifier_deployment.worker_name,
      version_id: attestation.verifier_version.version_id,
      verifier_key_id: attestation.verifier_identity.key_id,
      public_key_spki_sha256: attestation.verifier_identity.public_key_spki_sha256,
      key_registry_sha256: attestation.verifier_identity.key_registry_sha256,
      attestation_captured_at: attestation.captured_at,
      attestation_expires_at: deploymentManifestBinding.expires_at,
    },
    result_signer_identity: {
      status: "VALID",
      ...attestation.result_signer_identity,
    },
    cross_binding: crossBinding,
  };
}

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
  const canonicalWorkerName = assertCanonicalCanaryDeploymentWorkerName(workerName);
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
  const canonicalWorkerName = assertCanonicalCanaryDeploymentWorkerName(workerName);
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
  resultSignerEnvironment,
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
  if (runtimeHealth.schema_version !== 3 || runtimeHealth.ok !== true) throw new Error("Canary /health response is not a passing schema");
  if (runtimeHealth.environment !== "production" || runtimeHealth.deployment_role !== "canary") throw new Error("runtime is not production Canary");
  if (runtimeHealth.git_commit_sha !== commitSha) throw new Error("runtime Git SHA does not match checked-out HEAD");
  if (runtimeHealth.deployment_id !== deploymentId) throw new Error("runtime deployment identity does not match the authorized Canary deployment");
  if (runtimeHealth.binding_mode !== "fixed_canary") throw new Error("runtime binding mode is not fixed_canary");
  const runtimeIdentity = runtimeHealth.deployment_identity;
  if (!runtimeIdentity || runtimeIdentity.deployment_id !== deploymentId || runtimeIdentity.deployment_role !== "canary" || runtimeIdentity.binding_mode !== "fixed_canary" || runtimeIdentity.worker_name !== canonicalWorkerName) {
    throw new Error("runtime deployment identity is inconsistent with the authorized Canary");
  }
  if (runtimeHealth.runtime_version?.version_id !== versionId) throw new Error("runtime version does not match the Cloudflare platform version");
  const expectedResultSigner = canaryResultSignerInputs(resultSignerEnvironment);
  const liveResultSigner = runtimeHealth.result_identity;
  assertObject(liveResultSigner, "Canary Result signer live identity");
  for (const [field, expected] of Object.entries({
    result_public_key_spki: expectedResultSigner.public_key_spki,
    result_public_key_spki_sha256: expectedResultSigner.public_key_spki_sha256,
    result_signer_key_id: expectedResultSigner.signer_key_id,
    result_key_registry_sha256: expectedResultSigner.key_registry_sha256,
    result_key_registry_envelope_sha256: expectedResultSigner.key_registry_envelope_sha256,
    result_registry_root_key_id: expectedResultSigner.registry_root_key_id,
    result_registry_root_public_key_spki: expectedResultSigner.registry_root_public_key_spki,
  })) {
    assertExactString(liveResultSigner[field], expected, `Canary live Result signer ${field}`);
  }
  assertExactString(runtimeHealth.result_public_key_spki, expectedResultSigner.public_key_spki, "Canary live Result public key");
  const resultSignerIdentity = {
    ...expectedResultSigner,
    deployment_id: deploymentId,
    worker_name: canonicalWorkerName,
    version_id: versionId,
  };
  return {
    platform_deployment_id: platform.deployment.id,
    platform_version_id: platform.version.id,
    runtime_deployment_id: runtimeHealth.deployment_id,
    runtime_version_id: runtimeHealth.runtime_version.version_id,
    worker_name: canonicalWorkerName,
    deployment_role: "canary",
    git_commit_sha: commitSha,
    deployment_binding: deploymentBinding,
    result_signer_identity: resultSignerIdentity,
  };
}

export function verifyCanaryVerifierRuntime({
  platform,
  runtimeHealth,
  expectedDeploymentId,
  expectedGitCommitSha,
  expectedVersionId,
  expectedDeploymentMessage,
  expectedDeploymentTag,
  expectedBindingAuthorityKeyId,
  expectedBindingAuthorityPublicKeySpki,
  verifierKeyId,
  verifierPublicKeySpki,
  verifierIdentityKeyRegistry,
  deploymentStartedAt,
}) {
  if (!platform || platform.worker_name !== CANARY_VERIFIER_WORKER_NAME) {
    throw new Error("platform Worker identity does not match canonical Canary Verifier");
  }
  const deploymentId = requiredString(expectedDeploymentId, "Canary Verifier deployment identity");
  const commitSha = requiredString(expectedGitCommitSha, "checked-out Git SHA").toLowerCase();
  if (!SHA_PATTERN.test(commitSha)) throw new Error("checked-out Git SHA is invalid");
  const versionId = requiredVersionId(expectedVersionId, "Canary Verifier deployed version ID");
  if (
    platform.version?.id !== versionId ||
    platform.deployment?.versions?.length !== 1 ||
    platform.deployment.versions[0]?.version_id !== versionId ||
    platform.deployment.versions[0]?.percentage !== 100 ||
    platform.serving_percentage !== 100
  ) {
    throw new Error("Canary Verifier platform is not serving exactly the expected version at 100 percent");
  }
  const deploymentMessage = platform.deployment.annotations?.["workers/message"];
  const versionMessage = platform.version.annotations?.["workers/message"];
  if (deploymentMessage !== versionMessage || deploymentMessage !== expectedDeploymentMessage) {
    throw new Error("Canary Verifier deployment and version message bindings do not match");
  }
  const deploymentBinding = verifyCanaryDeploymentMessage({
    message: deploymentMessage,
    deploymentId,
    workerName: CANARY_VERIFIER_WORKER_NAME,
    gitCommitSha: commitSha,
    bindingAuthorityKeyId: expectedBindingAuthorityKeyId,
    bindingAuthorityPublicKeySpki: expectedBindingAuthorityPublicKeySpki,
    label: "Cloudflare Verifier deployment",
  });
  verifyCanaryDeploymentMessage({
    message: versionMessage,
    deploymentId,
    workerName: CANARY_VERIFIER_WORKER_NAME,
    gitCommitSha: commitSha,
    bindingAuthorityKeyId: expectedBindingAuthorityKeyId,
    bindingAuthorityPublicKeySpki: expectedBindingAuthorityPublicKeySpki,
    label: "Cloudflare Verifier version",
  });
  expectedAnnotation(platform.deployment.annotations, "workers/message", expectedDeploymentMessage, "Canary Verifier deployment");
  expectedAnnotation(platform.version.annotations, "workers/message", expectedDeploymentMessage, "Canary Verifier version");
  if (expectedDeploymentTag !== undefined) {
    expectedAnnotation(platform.version.annotations, "workers/tag", expectedDeploymentTag, "Canary Verifier version");
    if (platform.deployment.annotations["workers/tag"] !== undefined) {
      expectedAnnotation(platform.deployment.annotations, "workers/tag", expectedDeploymentTag, "Canary Verifier deployment");
    }
  }
  if (deploymentStartedAt !== undefined) {
    const startedAt = deploymentStartedAt instanceof Date ? deploymentStartedAt.getTime() : Date.parse(deploymentStartedAt);
    if (!Number.isFinite(startedAt) || Date.parse(platform.deployment.created_on) < startedAt - 120_000) {
      throw new Error("Canary Verifier platform deployment predates the current deployment attempt");
    }
  }
  if (
    !runtimeHealth || typeof runtimeHealth !== "object" || Array.isArray(runtimeHealth) ||
    runtimeHealth.schema_version !== 1 || runtimeHealth.ok !== true ||
    runtimeHealth.environment !== "production" || runtimeHealth.deployment_role !== "canary"
  ) {
    throw new Error("Canary Verifier /health response is not a passing production Canary identity");
  }
  if (
    runtimeHealth.deployment_id !== deploymentId ||
    runtimeHealth.worker_name !== CANARY_VERIFIER_WORKER_NAME ||
    runtimeHealth.git_commit_sha !== commitSha ||
    runtimeHealth.runtime_version?.version_id !== versionId
  ) {
    throw new Error("Canary Verifier live identity does not match the authorized platform deployment");
  }
  const liveVerifierIdentity = runtimeHealth.verifier_identity;
  if (
    !liveVerifierIdentity || liveVerifierIdentity.key_id !== verifierKeyId ||
    liveVerifierIdentity.public_key_spki !== verifierPublicKeySpki ||
    liveVerifierIdentity.deployment_id !== deploymentId ||
    liveVerifierIdentity.worker_name !== CANARY_VERIFIER_WORKER_NAME ||
    liveVerifierIdentity.keypair_valid !== true
  ) {
    throw new Error("Canary Verifier live key identity or signing keypair does not match the authorized deployment");
  }
  assertCanaryVerifierIdentityKeyRegistry(verifierIdentityKeyRegistry, {
    now: new Date(),
    currentIdentity: {
      status: "VALID",
      verifier_key_id: verifierKeyId,
      public_key_spki: verifierPublicKeySpki,
      deployment_id: deploymentId,
      worker_name: CANARY_VERIFIER_WORKER_NAME,
    },
  });
  const publicKeyBytes = Buffer.from(verifierPublicKeySpki, "base64url");
  return {
    status: "PASS",
    platform_deployment_id: platform.deployment.id,
    platform_version_id: platform.version.id,
    deployment_id: deploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
    version_id: versionId,
    git_commit_sha: commitSha,
    verifier_key_id: verifierKeyId,
    public_key_spki: verifierPublicKeySpki,
    public_key_spki_sha256: createHash("sha256").update(publicKeyBytes).digest("base64url"),
    key_registry_sha256: canaryVerifierIdentityKeyRegistrySha256(verifierIdentityKeyRegistry),
    key_registry: verifierIdentityKeyRegistry,
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
  verifierVerification,
  verifierPlatform,
  verifierRuntimeHealth,
  expectedDeploymentId,
  expectedGitCommitSha,
  expectedDeploymentMessage,
  expectedDeploymentTag,
  expectedVerifierDeploymentMessage,
  expectedVerifierDeploymentTag,
  workflow,
  deploymentManifestId,
  runtimeAttestationSignerKeyId,
  runtimeAttestationSigningPrivateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  signingNow,
  capturedAt = new Date().toISOString(),
  evidenceMode = "real",
}) {
  const fixture = evidenceMode === "fixture";
  const workflowMetadata = fixture ? null : requiredWorkflowMetadata(workflow, "Runtime Attestation workflow");
  if (!fixture && workflowMetadata.git_commit_sha !== requiredString(expectedGitCommitSha, "Runtime Attestation expected Git SHA").toLowerCase()) {
    throw new Error("Runtime Attestation workflow Git SHA does not match the expected Git SHA");
  }
  if (!fixture && (typeof deploymentManifestId !== "string" || !HASH_PATTERN.test(deploymentManifestId))) {
    throw new Error("Runtime Attestation deployment manifest ID is missing or invalid");
  }
  if (!fixture && (!verifierVerification || !verifierPlatform || !verifierRuntimeHealth)) {
    throw new Error("Runtime Attestation requires independently verified Canary Verifier deployment and health evidence");
  }
  timestampMilliseconds(capturedAt, "Runtime Attestation captured_at");
  const status = fixture ? "FIXTURE_ONLY" : "PASS";
  const unsignedAttestation = {
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
      workflow_run_id: workflowMetadata?.workflow_run_id ?? null,
      workflow_run_attempt: workflowMetadata?.workflow_run_attempt ?? null,
      repository: workflowMetadata?.repository ?? null,
      workflow_file_identity: workflowMetadata?.workflow_file_identity ?? null,
    },
    deployment: {
      authorized_deployment_id: expectedDeploymentId,
      manifest_id: fixture ? null : deploymentManifestId,
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
    result_signer_identity: fixture ? null : verification.result_signer_identity,
    verifier_deployment: fixture ? null : {
      authorized_deployment_id: verifierVerification.deployment_id,
      platform_deployment_id: verifierPlatform.deployment.id,
      worker_name: verifierVerification.worker_name,
      deployment_role: "canary",
      created_on: verifierPlatform.deployment.created_on,
      source: verifierPlatform.deployment.source,
      strategy: verifierPlatform.deployment.strategy,
      annotations: verifierPlatform.deployment.annotations,
      versions: verifierPlatform.deployment.versions,
      binding: verifierVerification.deployment_binding,
      requested_message: expectedVerifierDeploymentMessage ?? null,
      requested_tag: expectedVerifierDeploymentTag ?? null,
    },
    verifier_version: fixture ? null : {
      version_id: verifierPlatform.version.id,
      metadata: verifierPlatform.version.metadata,
      annotations: verifierPlatform.version.annotations,
      serving_percentage: verifierPlatform.serving_percentage,
    },
    verifier_runtime_identity: fixture ? null : {
      deployment_id: verifierRuntimeHealth.deployment_id,
      deployment_role: verifierRuntimeHealth.deployment_role,
      worker_name: verifierRuntimeHealth.worker_name,
      git_commit_sha: verifierRuntimeHealth.git_commit_sha,
      runtime_version: verifierRuntimeHealth.runtime_version,
      verifier_identity: verifierRuntimeHealth.verifier_identity,
    },
    verifier_identity: fixture ? null : {
      key_id: verifierVerification.verifier_key_id,
      public_key_spki: verifierVerification.public_key_spki,
      public_key_spki_sha256: verifierVerification.public_key_spki_sha256,
      deployment_id: verifierVerification.deployment_id,
      worker_name: verifierVerification.worker_name,
      key_registry_sha256: verifierVerification.key_registry_sha256,
      key_registry: verifierVerification.key_registry,
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
      verifier_platform_identity_matches_authorized_deployment: !fixture,
      verifier_runtime_matches_platform_version: !fixture,
      verifier_identity_key_matches_active_registry: !fixture,
      result_signer_deployment_binding: !fixture,
      synthetic_evidence_rejected: !fixture,
    },
  };
  if (fixture) return unsignedAttestation;
  return signCanaryRuntimeAttestation(unsignedAttestation, {
    signerKeyId: runtimeAttestationSignerKeyId,
    signingPrivateKeyPkcs8: runtimeAttestationSigningPrivateKeyPkcs8,
    registry: runtimeAttestationKeyRegistry,
    now: signingNow ?? capturedAt,
  });
}

export async function attestCanaryDeployment({
  workerName,
  expectedDeploymentId,
  expectedGitCommitSha,
  expectedVersionId,
  expectedDeploymentMessage,
  expectedDeploymentTag,
  expectedVerifierDeploymentId,
  expectedVerifierVersionId,
  expectedVerifierDeploymentMessage,
  expectedVerifierDeploymentTag,
  deploymentStartedAt,
  verifierDeploymentStartedAt,
  runtimeUrl,
  verifierRuntimeUrl,
  environment,
  workflow,
  deploymentManifestId,
  runtimeAttestationSignerKeyId,
  runtimeAttestationSigningPrivateKeyPkcs8,
  artifactPath,
}) {
  if (environment?.TLSN_CANARY_FIXTURE_ONLY?.trim() === "true") throw new Error("fixture-only Canary deployment cannot produce a real attestation");
  const platform = await platformMetadataAfterDeploy({ workerName, expectedVersionId, environment });
  const runtimeHealth = await fetchCanaryHealth(runtimeUrl);
  const verifierPlatform = await platformMetadataAfterDeploy({
    workerName: CANARY_VERIFIER_WORKER_NAME,
    expectedVersionId: expectedVerifierVersionId,
    environment,
  });
  const verifierRuntimeHealth = await fetchCanaryHealth(verifierRuntimeUrl);
  let verifierIdentityKeyRegistry;
  try {
    verifierIdentityKeyRegistry = JSON.parse(requiredString(
      environment?.TLSN_CANARY_VERIFIER_IDENTITY_KEY_REGISTRY,
      "Canary Verifier identity key registry",
    ));
  } catch {
    throw new Error("Canary Verifier identity key registry is missing or invalid JSON");
  }
  const { registry: runtimeAttestationKeyRegistry } = await loadCanaryRuntimeAttestationKeyRegistry();
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
    resultSignerEnvironment: environment,
  });
  const verifierVerification = verifyCanaryVerifierRuntime({
    platform: verifierPlatform,
    runtimeHealth: verifierRuntimeHealth,
    expectedDeploymentId: expectedVerifierDeploymentId,
    expectedGitCommitSha,
    expectedVersionId: expectedVerifierVersionId,
    expectedDeploymentMessage: expectedVerifierDeploymentMessage,
    expectedDeploymentTag: expectedVerifierDeploymentTag,
    expectedBindingAuthorityKeyId: environment?.TLSN_CANARY_BINDING_AUTHORITY_KEY_ID,
    expectedBindingAuthorityPublicKeySpki: environment?.TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI,
    verifierKeyId: environment?.TLSN_CANARY_VERIFIER_IDENTITY_KEY_ID,
    verifierPublicKeySpki: environment?.TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI,
    verifierIdentityKeyRegistry,
    deploymentStartedAt: verifierDeploymentStartedAt,
  });
  const attestation = createCanaryDeploymentAttestation({
    verification,
    platform,
    runtimeHealth,
    verifierVerification,
    verifierPlatform,
    verifierRuntimeHealth,
    expectedDeploymentId,
    expectedGitCommitSha,
    expectedDeploymentMessage,
    expectedDeploymentTag,
    expectedVerifierDeploymentMessage,
    expectedVerifierDeploymentTag,
    workflow,
    deploymentManifestId,
    runtimeAttestationSignerKeyId,
    runtimeAttestationSigningPrivateKeyPkcs8,
    runtimeAttestationKeyRegistry,
  });
  await writeImmutableCanaryAttestation(artifactPath, attestation);
  return { attestation, platform, runtimeHealth, verifierPlatform, verifierRuntimeHealth, verifierVerification };
}
