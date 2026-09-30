import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  assertCanaryRuntimeAttestationSignature,
  signCanaryRuntimeAttestation,
} from "./canary-runtime-attestation-signing.mjs";

export const CANARY_OPERATIONAL_SMOKE_SCHEMA_VERSION = 1;
export const CANARY_OPERATIONAL_SMOKE_SCOPE = "tlsn-canary-operational-smoke";
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
const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PROBE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

function expectedIdentity(runtimeIdentity) {
  const verifier = runtimeIdentity?.verifier_identity;
  if (
    runtimeIdentity?.status !== "VALID" ||
    runtimeIdentity.signature_valid !== true ||
    runtimeIdentity.cross_binding?.attestation_fresh !== true ||
    verifier?.status !== "VALID"
  ) {
    throw new Error("a fresh signed Canary Runtime Attestation is required for operational smoke");
  }
  const identity = {
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

function evidenceBytesAt(evidenceArtifacts, path, label) {
  assertObject(evidenceArtifacts, "operational smoke evidence artifacts");
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`${label} evidence artifact path is invalid`);
  }
  const value = evidenceArtifacts[path];
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) throw new Error(`${label} evidence artifact bytes are missing`);
  return Buffer.from(value);
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
  signerKeyId,
  signingPrivateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  evidenceArtifacts,
  capturedAt = new Date().toISOString(),
  signingNow = capturedAt,
} = {}) {
  const identity = expectedIdentity(trustedRuntimeIdentity);
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
  const evidencePaths = new Set();
  const probeIds = new Set();
  const checks = Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => {
    const observation = observations[component];
    assertObject(observation, `operational smoke ${component}`);
    assertExactKeys(observation, ["status", "observed_at", "probe_id", "evidence_artifact"], `operational smoke ${component}`);
    if (!COMPONENT_STATUSES.has(observation.status)) throw new Error(`operational smoke ${component} status is invalid`);
    if (observation.status === "PASS" || observation.status === "FAIL") {
      const observedAtMs = assertTimestamp(observation.observed_at, `operational smoke ${component}.observed_at`);
      if (observedAtMs < attestationCapturedAtMs || observedAtMs > capturedAtMs) {
        throw new Error(`operational smoke ${component} observation is outside the current attestation window`);
      }
      if (!PROBE_ID_PATTERN.test(observation.probe_id ?? "")) throw new Error(`operational smoke ${component} probe ID is invalid`);
      if (probeIds.has(observation.probe_id)) throw new Error("operational smoke probe IDs must be unique");
      probeIds.add(observation.probe_id);
      if (evidencePaths.has(observation.evidence_artifact)) throw new Error("operational smoke evidence artifact paths must be unique");
      evidencePaths.add(observation.evidence_artifact);
      const evidenceBytes = evidenceBytesAt(evidenceArtifacts, observation.evidence_artifact, `operational smoke ${component}`);
      const evidenceSha256 = operationalSmokeEvidenceSha256(evidenceBytes);
      return [component, {
        status: observation.status,
        source: "live-service-observation",
        observed_at: observation.observed_at,
        probe_id: observation.probe_id,
        evidence_artifact: observation.evidence_artifact,
        evidence_sha256: evidenceSha256,
      }];
    }
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
    evidence: {
      source: "live-service-observations",
      synthetic: false,
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
    "evidence",
    "bound_identity",
    "checks",
    "attestation_signer_key_id",
    "signature_algorithm",
    "signature_base64url",
  ], "Canary operational smoke artifact");
  const signature = assertCanaryRuntimeAttestationSignature(artifact, { registry: runtimeAttestationKeyRegistry });
  if (artifact.evidence?.source !== "live-service-observations" || artifact.evidence.synthetic !== false) {
    throw new Error("synthetic or non-live operational smoke cannot pass");
  }
  const identity = expectedIdentity(trustedRuntimeIdentity);
  if (signature.signer_key_id !== identity.runtime_attestation_signer_key_id) {
    throw new Error("Canary operational smoke signer does not match the current Runtime Attestation signer");
  }
  assertExactKeys(artifact.evidence, ["source", "synthetic"], "Canary operational smoke evidence metadata");
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
  const evidencePaths = new Set();
  const probeIds = new Set();
  for (const component of CANARY_OPERATIONAL_SMOKE_COMPONENTS) {
    const check = artifact.checks[component];
    assertObject(check, `Canary operational smoke ${component}`);
    assertExactKeys(check, ["status", "source", "observed_at", "probe_id", "evidence_artifact", "evidence_sha256"], `Canary operational smoke ${component}`);
    if (!COMPONENT_STATUSES.has(check.status)) throw new Error(`Canary operational smoke ${component} status is invalid`);
    if (check.status === "PASS" || check.status === "FAIL") {
      if (check.source !== "live-service-observation") throw new Error(`Canary operational smoke component is not live: ${component}`);
      const observedAtMs = assertTimestamp(check.observed_at, `Canary operational smoke ${component}.observed_at`);
      if (observedAtMs < attestationCapturedAtMs || observedAtMs < capturedAtMs - MAX_SMOKE_AGE_MS || observedAtMs > capturedAtMs) {
        throw new Error(`Canary operational smoke ${component} observation is stale or from the future`);
      }
      if (!PROBE_ID_PATTERN.test(check.probe_id ?? "") || typeof check.evidence_artifact !== "string" || !check.evidence_artifact || !HASH_PATTERN.test(check.evidence_sha256 ?? "")) {
        throw new Error(`Canary operational smoke ${component} evidence binding is invalid`);
      }
    } else {
      if (check.source !== "not-run" || check.observed_at !== null || check.probe_id !== null || check.evidence_artifact !== null || check.evidence_sha256 !== null) {
        throw new Error(`Canary operational smoke ${component} non-run status contains live claims`);
      }
      continue;
    }
    if (probeIds.has(check.probe_id)) throw new Error("Canary operational smoke probe IDs are replayed");
    probeIds.add(check.probe_id);
    if (evidencePaths.has(check.evidence_artifact)) throw new Error("Canary operational smoke evidence artifact paths are reused");
    evidencePaths.add(check.evidence_artifact);
    const evidenceBytes = evidenceBytesAt(evidenceArtifacts, check.evidence_artifact, `Canary operational smoke ${component}`);
    if (operationalSmokeEvidenceSha256(evidenceBytes) !== check.evidence_sha256) {
      throw new Error(`Canary operational smoke ${component} evidence hash mismatch`);
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
    signer_key_id: signature.signer_key_id,
    components: Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, artifact.checks[component].status])),
  };
}

export async function loadCanaryOperationalSmokeArtifact({
  artifactPath,
  trustedRuntimeIdentity,
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
  if (artifact.evidence?.synthetic === true && artifact.status === "NOT_RUN") {
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
  const signature = assertCanaryRuntimeAttestationSignature(artifact, { registry: runtimeAttestationKeyRegistry });
  if (signature.signer_key_id !== expectedIdentity(trustedRuntimeIdentity).runtime_attestation_signer_key_id) {
    throw new Error("Canary operational smoke signer does not match the current Runtime Attestation signer");
  }
  const actualArtifactPath = await realpath(resolve(artifactPath));
  const artifactRoot = await realpath(dirname(actualArtifactPath));
  const evidenceArtifacts = {};
  const evidencePaths = new Set();
  for (const component of CANARY_OPERATIONAL_SMOKE_COMPONENTS) {
    const check = artifact.checks?.[component];
    if (check?.status !== "PASS" && check?.status !== "FAIL") continue;
    const path = check.evidence_artifact;
    if (
      typeof path !== "string" || path.length === 0 || isAbsolute(path) || path.includes("\\") ||
      path.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error(`Canary operational smoke ${component} evidence path is invalid`);
    }
    if (evidencePaths.has(path)) throw new Error("Canary operational smoke evidence artifact paths are reused");
    evidencePaths.add(path);
    const actualPath = await realpath(resolve(artifactRoot, path));
    const relativePath = relative(artifactRoot, actualPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("Canary operational smoke evidence resolves outside the artifact directory");
    const metadata = await stat(actualPath);
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > 8 * 1024 * 1024) {
      throw new Error(`Canary operational smoke ${component} evidence size or file type is invalid`);
    }
    evidenceArtifacts[path] = await readFile(actualPath);
  }
  const result = assertCanaryOperationalSmokeArtifact(artifact, {
    trustedRuntimeIdentity,
    runtimeAttestationKeyRegistry,
    currentHead,
    expectedDeploymentId,
    evidenceArtifacts,
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