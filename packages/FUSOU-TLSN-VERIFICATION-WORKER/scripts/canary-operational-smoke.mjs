import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  assertCanaryRuntimeAttestationSignature,
  signCanaryRuntimeAttestation,
} from "./canary-runtime-attestation-signing.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";
import { deploymentManifestIdentity } from "./canary-deployment-manifest.mjs";

export const CANARY_OPERATIONAL_SMOKE_SCHEMA_VERSION = 2;
export const CANARY_OPERATIONAL_SMOKE_SCOPE = "tlsn-canary-operational-smoke";
export const CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY = "bounded-reuse-within-attestation-window";
export const CANARY_OPERATIONAL_SMOKE_COMPONENTS = Object.freeze([
  "main_worker",
  "verifier",
  "callback",
  "trigger",
  "session_binding",
  "DO",
  "R2",
  "Notary",
  "Auth",
  "Presentation",
]);

const COMPONENT_STATUSES = new Set(["PASS", "FAIL", "NOT_IMPLEMENTED", "NOT_RUN"]);
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INVOCATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SMOKE_AGE_MS = 30 * 60 * 1000;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed`);
}

function assertTimestamp(value, label) {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} is invalid`);
  }
  return Date.parse(value);
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort().join("\0");
  const expected = [...keys].sort().join("\0");
  if (actual !== expected) throw new Error(`${label} fields are invalid`);
}

function expectedIdentity(runtimeIdentity, deploymentManifest, readinessInvocationId) {
  const verifier = runtimeIdentity?.verifier_identity;
  if (
    runtimeIdentity?.status !== "VALID" ||
    runtimeIdentity.signature_valid !== true ||
    runtimeIdentity.cross_binding?.attestation_fresh !== true ||
    verifier?.status !== "VALID"
  ) {
    throw new Error("a fresh signed Canary Runtime Attestation is required for operational smoke");
  }
  assertObject(deploymentManifest, "validated Canary deployment manifest");
  if (
    typeof runtimeIdentity.manifest_id !== "string" ||
    deploymentManifest.manifest_id !== runtimeIdentity.manifest_id ||
    deploymentManifestIdentity(deploymentManifest) !== deploymentManifest.manifest_id
  ) {
    throw new Error("validated deployment manifest does not match the signed Runtime Attestation");
  }
  if (
    !deploymentManifest.target || !deploymentManifest.notary ||
    !Array.isArray(deploymentManifest.inputs) || !Array.isArray(deploymentManifest.artifacts)
  ) {
    throw new Error("validated deployment manifest is missing trust configuration fields");
  }
  if (!INVOCATION_ID_PATTERN.test(readinessInvocationId ?? "")) {
    throw new Error("independent readiness invocation ID must be a UUID v4");
  }
  const trustConfiguration = {
    target: deploymentManifest.target,
    notary: deploymentManifest.notary,
    secret_provider: deploymentManifest.secret_provider,
    inputs: deploymentManifest.inputs.map(({ name, value_sha256, provenance }) => ({ name, value_sha256, provenance }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    artifacts: deploymentManifest.artifacts.map(({ name, path, sha256 }) => ({ name, path, sha256 }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
  const identity = {
    manifest_id: deploymentManifest.manifest_id,
    trust_configuration_sha256: createHash("sha256").update(canonicalJson(trustConfiguration)).digest("base64url"),
    readiness_invocation_id: readinessInvocationId,
    git_commit_sha: runtimeIdentity.git_commit_sha,
    workflow_run_id: runtimeIdentity.workflow_run_id,
    workflow_run_attempt: runtimeIdentity.workflow_run_attempt,
    main_deployment_id: runtimeIdentity.deployment_id,
    main_worker_name: runtimeIdentity.worker_name,
    main_version_id: runtimeIdentity.version_id,
    main_platform_deployment_id: runtimeIdentity.platform_deployment_id,
    verifier_deployment_id: verifier.deployment_id,
    verifier_worker_name: verifier.worker_name,
    verifier_version_id: verifier.version_id,
    verifier_key_id: verifier.verifier_key_id,
    verifier_key_registry_sha256: verifier.key_registry_sha256,
    runtime_attestation_signer_key_id: runtimeIdentity.attestation_signer_key_id,
  };
  for (const [field, value] of Object.entries(identity)) {
    if (typeof value !== "string" || value.length === 0) throw new Error(`trusted Runtime Attestation is missing ${field}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(identity.git_commit_sha) || !/^[1-9][0-9]*$/.test(identity.workflow_run_id) || !/^[1-9][0-9]*$/.test(identity.workflow_run_attempt)) {
    throw new Error("trusted Runtime Attestation workflow identity is invalid");
  }
  return identity;
}

function overallStatus(checks) {
  const statuses = Object.values(checks).map((check) => check.status);
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.every((status) => status === "PASS")) return "PASS";
  if (statuses.includes("NOT_IMPLEMENTED")) return "NOT_IMPLEMENTED";
  return "NOT_RUN";
}

export function createCanaryOperationalSmokeNotRun({ capturedAt = new Date().toISOString() } = {}) {
  assertTimestamp(capturedAt, "operational smoke captured_at");
  return {
    schema_version: CANARY_OPERATIONAL_SMOKE_SCHEMA_VERSION,
    scope: CANARY_OPERATIONAL_SMOKE_SCOPE,
    status: "NOT_RUN",
    readiness: "BLOCKED",
    captured_at: capturedAt,
    evidence: {
      source: "repository-default",
      synthetic: true,
      replay_policy: CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY,
    },
    checks: Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, {
      status: "NOT_RUN",
      source: "not-run",
      observed_at: null,
      probe_id: null,
      evidence_artifact: null,
      evidence_sha256: null,
    }])),
  };
}

export function createCanaryOperationalSmokeArtifact({
  observations,
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId,
  signingPrivateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  evidenceArtifacts,
  capturedAt = new Date().toISOString(),
  signingNow = capturedAt,
} = {}) {
  const identity = expectedIdentity(trustedRuntimeIdentity, deploymentManifest, readinessInvocationId);
  if (signerKeyId !== identity.runtime_attestation_signer_key_id) {
    throw new Error("operational smoke must use the Runtime Attestation signer bound to the current deployment");
  }
  const capturedAtMs = assertTimestamp(capturedAt, "operational smoke captured_at");
  const attestationCapturedAtMs = assertTimestamp(trustedRuntimeIdentity.verifier_identity.attestation_captured_at, "Verifier Runtime Attestation captured_at");
  const attestationExpiresAtMs = assertTimestamp(trustedRuntimeIdentity.verifier_identity.attestation_expires_at, "Verifier Runtime Attestation expires_at");
  if (capturedAtMs < attestationCapturedAtMs || capturedAtMs >= attestationExpiresAtMs) {
    throw new Error("operational smoke capture is outside the Verifier Runtime Attestation validity window");
  }
  assertObject(observations, "operational smoke observations");
  assertExactKeys(observations, CANARY_OPERATIONAL_SMOKE_COMPONENTS, "operational smoke observations");
  const checks = Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => {
    const observation = observations[component];
    assertObject(observation, `operational smoke ${component}`);
    assertExactKeys(observation, ["status", "observed_at", "probe_id", "evidence_artifact"], `operational smoke ${component}`);
    if (observation.status === "PASS" || observation.status === "FAIL") {
      throw new Error("operational smoke semantic validators are not implemented; PASS/FAIL is forbidden");
    }
    if (!COMPONENT_STATUSES.has(observation.status)) throw new Error(`operational smoke ${component} status is invalid`);
    if (observation.observed_at !== null || observation.probe_id !== null || observation.evidence_artifact !== null) {
      throw new Error(`operational smoke ${component} non-run status cannot claim live evidence`);
    }
    return [component, {
      status: observation.status,
      source: "not-run",
      observed_at: null,
      probe_id: null,
      evidence_artifact: null,
      evidence_sha256: null,
    }];
  }));
  const status = overallStatus(checks);
  const unsigned = {
    schema_version: CANARY_OPERATIONAL_SMOKE_SCHEMA_VERSION,
    scope: CANARY_OPERATIONAL_SMOKE_SCOPE,
    status,
    readiness: status === "PASS" ? "OPERATIONAL_SMOKE_VERIFIED" : "BLOCKED",
    captured_at: capturedAt,
    readiness_invocation_id: readinessInvocationId,
    evidence: {
      source: "semantic-validators-not-implemented",
      synthetic: true,
      replay_policy: CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY,
    },
    bound_identity: identity,
    checks,
  };
  return signCanaryRuntimeAttestation(unsigned, {
    signerKeyId,
    signingPrivateKeyPkcs8,
    registry: runtimeAttestationKeyRegistry,
    now: signingNow,
  });
}

export function assertCanaryOperationalSmokeArtifact(artifact, {
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  runtimeAttestationKeyRegistry,
  currentHead,
  expectedDeploymentId,
  evidenceArtifacts,
  allowNonPass = false,
  now = new Date(),
} = {}) {
  assertObject(artifact, "Canary operational smoke artifact");
  if (artifact.schema_version !== CANARY_OPERATIONAL_SMOKE_SCHEMA_VERSION || artifact.scope !== CANARY_OPERATIONAL_SMOKE_SCOPE) {
    throw new Error("Canary operational smoke artifact scope is invalid");
  }
  assertExactKeys(artifact, [
    "schema_version",
    "scope",
    "status",
    "readiness",
    "captured_at",
    "readiness_invocation_id",
    "evidence",
    "bound_identity",
    "checks",
    "attestation_signer_key_id",
    "signature_algorithm",
    "signature_base64url",
  ], "Canary operational smoke artifact");
  const signature = assertCanaryRuntimeAttestationSignature(artifact, { registry: runtimeAttestationKeyRegistry });
  if (Object.values(artifact.checks ?? {}).some((check) => check?.status === "PASS" || check?.status === "FAIL")) {
    throw new Error("Canary operational smoke semantic validators are not implemented; PASS/FAIL is forbidden");
  }
  if (
    artifact.evidence?.source !== "semantic-validators-not-implemented" ||
    artifact.evidence.synthetic !== true ||
    artifact.evidence.replay_policy !== CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY
  ) {
    throw new Error("operational smoke artifact is not a runner-incomplete contract artifact");
  }
  const identity = expectedIdentity(trustedRuntimeIdentity, deploymentManifest, readinessInvocationId);
  if (signature.signer_key_id !== identity.runtime_attestation_signer_key_id) {
    throw new Error("Canary operational smoke signer does not match the current Runtime Attestation signer");
  }
  assertExactKeys(artifact.evidence, ["source", "synthetic", "replay_policy"], "Canary operational smoke evidence metadata");
  if (artifact.readiness_invocation_id !== readinessInvocationId) {
    throw new Error("Canary operational smoke belongs to another readiness invocation");
  }
  assertExactKeys(artifact.bound_identity, Object.keys(identity), "Canary operational smoke bound identity");
  for (const [field, expected] of Object.entries(identity)) {
    if (artifact.bound_identity[field] !== expected) throw new Error(`Canary operational smoke ${field} does not match the current Runtime Attestation`);
  }
  if (identity.git_commit_sha !== currentHead || identity.main_deployment_id !== expectedDeploymentId) {
    throw new Error("Canary operational smoke belongs to another HEAD or deployment");
  }
  const capturedAtMs = assertTimestamp(artifact.captured_at, "Canary operational smoke captured_at");
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const attestationCapturedAtMs = assertTimestamp(trustedRuntimeIdentity.verifier_identity.attestation_captured_at, "Verifier Runtime Attestation captured_at");
  const attestationExpiresAtMs = assertTimestamp(trustedRuntimeIdentity.verifier_identity.attestation_expires_at, "Verifier Runtime Attestation expires_at");
  if (!Number.isFinite(nowMs) || capturedAtMs > nowMs || capturedAtMs < attestationCapturedAtMs || capturedAtMs >= attestationExpiresAtMs) {
    throw new Error("Canary operational smoke artifact is stale or outside its Runtime Attestation validity window");
  }
  if (nowMs - capturedAtMs > MAX_SMOKE_AGE_MS) throw new Error("Canary operational smoke artifact is stale");
  assertObject(artifact.checks, "Canary operational smoke checks");
  assertExactKeys(artifact.checks, CANARY_OPERATIONAL_SMOKE_COMPONENTS, "Canary operational smoke checks");
  for (const component of CANARY_OPERATIONAL_SMOKE_COMPONENTS) {
    const check = artifact.checks[component];
    assertObject(check, `Canary operational smoke ${component}`);
    assertExactKeys(check, ["status", "source", "observed_at", "probe_id", "evidence_artifact", "evidence_sha256"], `Canary operational smoke ${component}`);
    if (!COMPONENT_STATUSES.has(check.status)) throw new Error(`Canary operational smoke ${component} status is invalid`);
    if (check.status === "PASS" || check.status === "FAIL") {
      throw new Error("Canary operational smoke semantic validators are not implemented; PASS/FAIL is forbidden");
    }
    if (check.source !== "not-run" || check.observed_at !== null || check.probe_id !== null || check.evidence_artifact !== null || check.evidence_sha256 !== null) {
      throw new Error(`Canary operational smoke ${component} non-run status contains live claims`);
    }
  }
  const status = overallStatus(artifact.checks);
  const readiness = status === "PASS" ? "OPERATIONAL_SMOKE_VERIFIED" : "BLOCKED";
  if (artifact.status !== status || artifact.readiness !== readiness) {
    throw new Error("Canary operational smoke aggregate status does not match its component matrix");
  }
  if (status !== "PASS" && !allowNonPass) throw new Error("Canary operational smoke is not a complete PASS");
  return {
    status,
    readiness,
    deployment_id: identity.main_deployment_id,
    verifier_deployment_id: identity.verifier_deployment_id,
    verifier_version_id: identity.verifier_version_id,
    verifier_key_id: identity.verifier_key_id,
    captured_at: artifact.captured_at,
    manifest_id: identity.manifest_id,
    trust_configuration_sha256: identity.trust_configuration_sha256,
    readiness_invocation_id: identity.readiness_invocation_id,
    replay_policy: CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY,
    signer_key_id: signature.signer_key_id,
    components: Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, artifact.checks[component].status])),
  };
}

export async function loadCanaryOperationalSmokeArtifact({
  artifactPath,
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  runtimeAttestationKeyRegistry,
  currentHead,
  expectedDeploymentId,
  now = new Date(),
} = {}) {
  if (typeof artifactPath !== "string" || artifactPath.trim().length === 0) throw new Error("Canary operational smoke artifact path is missing");
  const artifactBytes = await readFile(resolve(artifactPath));
  if (artifactBytes.length === 0 || artifactBytes.length > 256 * 1024) throw new Error("Canary operational smoke artifact size is invalid");
  let artifact;
  try {
    artifact = JSON.parse(artifactBytes.toString("utf8"));
  } catch {
    throw new Error("Canary operational smoke artifact is invalid JSON");
  }
  if (artifact?.schema_version !== CANARY_OPERATIONAL_SMOKE_SCHEMA_VERSION || artifact?.scope !== CANARY_OPERATIONAL_SMOKE_SCOPE) {
    throw new Error("Canary operational smoke artifact scope is invalid");
  }
  if (artifact.evidence?.source === "repository-default" && artifact.evidence.synthetic === true && artifact.status === "NOT_RUN") {
    const canonicalDefault = createCanaryOperationalSmokeNotRun({ capturedAt: artifact.captured_at });
    if (JSON.stringify(artifact) !== JSON.stringify(canonicalDefault)) {
      throw new Error("Canary operational smoke synthetic default is invalid");
    }
    return {
      status: "NOT_RUN",
      readiness: "BLOCKED",
      captured_at: artifact.captured_at,
      components: Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, "NOT_RUN"])),
    };
  }
  const identity = expectedIdentity(trustedRuntimeIdentity, deploymentManifest, readinessInvocationId);
  const signature = assertCanaryRuntimeAttestationSignature(artifact, { registry: runtimeAttestationKeyRegistry });
  if (signature.signer_key_id !== identity.runtime_attestation_signer_key_id) {
    throw new Error("Canary operational smoke signer does not match the current Runtime Attestation signer");
  }
  const actualArtifactPath = await realpath(resolve(artifactPath));
  if (Object.values(artifact.checks ?? {}).some((check) => check?.status === "PASS" || check?.status === "FAIL")) {
    throw new Error("Canary operational smoke semantic validators are not implemented; PASS/FAIL is forbidden");
  }
  const result = assertCanaryOperationalSmokeArtifact(artifact, {
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    runtimeAttestationKeyRegistry,
    currentHead,
    expectedDeploymentId,
    allowNonPass: true,
    now,
  });
  return {
    ...result,
    artifact_path: actualArtifactPath,
    artifact_sha256: operationalSmokeEvidenceSha256(artifactBytes),
  };
}

export function operationalSmokeEvidenceSha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}