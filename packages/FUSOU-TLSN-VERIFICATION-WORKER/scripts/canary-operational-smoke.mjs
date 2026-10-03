import { createHash } from "node:crypto";
import { mkdir, open, readFile, realpath, rmdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  assertCanaryRuntimeAttestationSignature,
  signCanaryRuntimeAttestation,
} from "./canary-runtime-attestation-signing.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";
import { deploymentManifestIdentity } from "./canary-deployment-manifest.mjs";
import {
  CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES,
  validateCanaryOperationalSmokeEvidenceSet,
} from "./canary-operational-smoke-semantic.mjs";

export const CANARY_OPERATIONAL_SMOKE_SCHEMA_VERSION = 3;
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

const COMPONENT_STATUSES = new Set(["PASS", "FAIL", "BLOCKED", "NOT_IMPLEMENTED", "NOT_RUN"]);
const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INVOCATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SMOKE_AGE_MS = 30 * 60 * 1000;
const MAX_COMPONENT_EVIDENCE_BYTES = 64 * 1024;
const HEALTH_EVIDENCE_COMPONENTS = Object.freeze(["main_worker", "verifier"]);
const LIVE_HEALTH_SOURCE_PROOF = Symbol("manifest-bound-live-health-probes");

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

function safeEvidenceArtifactPath(value) {
  if (
    typeof value !== "string" || value.length === 0 || isAbsolute(value) || value.includes("\\") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw new Error("Canary operational smoke evidence path must be a safe relative path");
  return value;
}

function evidenceArtifactBytes(evidenceArtifacts, artifactPath) {
  const evidence = evidenceArtifacts?.[artifactPath];
  if (Buffer.isBuffer(evidence) || evidence instanceof Uint8Array) return Buffer.from(evidence);
  if (typeof evidence === "string") return Buffer.from(evidence, "utf8");
  if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
    return Buffer.from(JSON.stringify(evidence), "utf8");
  }
  throw new Error(`Canary operational smoke evidence artifact is missing: ${artifactPath}`);
}

function parseEvidenceBytes(bytes, component) {
  if (bytes.length === 0 || bytes.length > MAX_COMPONENT_EVIDENCE_BYTES) {
    throw new Error(`Canary operational smoke ${component} evidence artifact size is invalid`);
  }
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Canary operational smoke ${component} evidence artifact is invalid JSON`);
  }
  return evidence;
}

function cleanSmokeHealthOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an approved HTTPS origin`);
  }
  if (
    parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) throw new Error(`${label} must be a clean HTTPS origin`);
  return parsed.origin;
}

function assertManifestBoundHealthOrigin(value, label, inputName, deploymentManifest) {
  const origin = cleanSmokeHealthOrigin(value, label);
  const input = deploymentManifest.inputs.find((entry) => entry?.name === inputName);
  const suppliedFingerprint = createHash("sha256").update(value.trim(), "utf8").digest("base64url");
  if (!input || input.value_sha256 !== suppliedFingerprint) {
    throw new Error(`${label} does not match its validated deployment manifest input`);
  }
  return origin;
}

async function readCanaryHealthBody(response) {
  const contentLength = Number(response.headers?.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_COMPONENT_EVIDENCE_BYTES) {
    throw new Error("health response size is invalid");
  }
  if (!response.body) throw new Error("health response body is missing");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_COMPONENT_EVIDENCE_BYTES) {
        await reader.cancel();
        throw new Error("health response size is invalid");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function fetchCanarySmokeHealth(origin, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(new URL("/health", `${origin}/`), {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    const bytes = await readCanaryHealthBody(response);
    if (bytes.length === 0 || bytes.length > MAX_COMPONENT_EVIDENCE_BYTES) {
      throw new Error("health response size is invalid");
    }
    let body;
    try {
      body = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("health response is invalid JSON");
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function createLiveHealthEvidence(component, claims, readinessInvocationId, boundIdentity, observedAt) {
  return {
    schema_version: 1,
    scope: "tlsn-canary-operational-smoke-live-evidence",
    component,
    source: "canary-live-runner",
    synthetic: false,
    readiness_invocation_id: readinessInvocationId,
    probe_id: crypto.randomUUID(),
    observed_at: observedAt,
    bound_identity: boundIdentity,
    claims,
  };
}

function expectedIdentity(runtimeIdentity, deploymentManifest, readinessInvocationId) {
  const verifier = runtimeIdentity?.verifier_identity;
  const resultSigner = runtimeIdentity?.result_signer_identity;
  if (
    runtimeIdentity?.status !== "VALID" ||
    runtimeIdentity.signature_valid !== true ||
    runtimeIdentity.cross_binding?.attestation_fresh !== true ||
    verifier?.status !== "VALID" ||
    resultSigner?.status !== "VALID" ||
    resultSigner.deployment_id !== runtimeIdentity.deployment_id ||
    resultSigner.worker_name !== runtimeIdentity.worker_name ||
    resultSigner.version_id !== runtimeIdentity.version_id
  ) {
    throw new Error("a fresh signed Canary Runtime Attestation with bound Main Worker and Result signer identities is required for operational smoke");
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
    result_signer_key_id: resultSigner.signer_key_id,
    result_signer_public_key_spki_sha256: resultSigner.public_key_spki_sha256,
    result_signer_key_registry_sha256: resultSigner.key_registry_sha256,
    result_signer_registry_envelope_sha256: resultSigner.key_registry_envelope_sha256,
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
  if (statuses.includes("BLOCKED")) return "BLOCKED";
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
      semantic_status: "NOT_RUN",
      source: "not-run",
      observed_at: null,
      probe_id: null,
      evidence_artifact: null,
      evidence_sha256: null,
      source_authentication: {
        status: "NOT_RUN",
        authority: CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component].authority,
        reason: CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component].reason,
      },
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
  sourceProofToken,
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
  const pendingChecks = Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => {
    const observation = observations[component];
    assertObject(observation, `operational smoke ${component}`);
    assertExactKeys(observation, ["status", "observed_at", "probe_id", "evidence_artifact"], `operational smoke ${component}`);
    if (!COMPONENT_STATUSES.has(observation.status)) throw new Error(`operational smoke ${component} status is invalid`);
    if (observation.status === "NOT_RUN" || observation.status === "NOT_IMPLEMENTED") {
      if (observation.observed_at !== null || observation.probe_id !== null || observation.evidence_artifact !== null) {
        throw new Error(`operational smoke ${component} non-run status cannot claim live evidence`);
      }
      return [component, {
        status: observation.status,
        semantic_status: observation.status,
        source: "not-run",
        observed_at: null,
        probe_id: null,
        evidence_artifact: null,
        evidence_sha256: null,
        source_authentication: {
          status: "NOT_RUN",
          authority: CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component].authority,
          reason: CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component].reason,
        },
      }];
    }
    assertTimestamp(observation.observed_at, `operational smoke ${component} observed_at`);
    if (!INVOCATION_ID_PATTERN.test(observation.probe_id ?? "")) throw new Error(`operational smoke ${component} probe_id is invalid`);
    return [component, {
      status: observation.status,
      semantic_status: "NOT_RUN",
      source: "live-runner",
      observed_at: observation.observed_at,
      probe_id: observation.probe_id,
      evidence_artifact: safeEvidenceArtifactPath(observation.evidence_artifact),
      evidence_sha256: null,
      source_authentication: {
        status: "NOT_RUN",
        authority: CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component].authority,
        reason: "Source authenticity has not been evaluated.",
      },
    }];
  }));
  const hasLiveEvidence = Object.values(pendingChecks).some((check) => check.source === "live-runner");
  let checks = pendingChecks;
  if (hasLiveEvidence) {
    if (HEALTH_EVIDENCE_COMPONENTS.some((component) => pendingChecks[component].source !== "live-runner")
      || CANARY_OPERATIONAL_SMOKE_COMPONENTS.some((component) => !HEALTH_EVIDENCE_COMPONENTS.includes(component)
        && pendingChecks[component].source !== "not-run")) {
      throw new Error("Canary operational smoke accepts only both direct health probes; other source evidence is blocked");
    }
    const evidenceByComponent = {};
    for (const component of HEALTH_EVIDENCE_COMPONENTS) {
      const check = pendingChecks[component];
      const bytes = evidenceArtifactBytes(evidenceArtifacts, check.evidence_artifact);
      const evidence = parseEvidenceBytes(bytes, component);
      if (evidence.component !== component || evidence.probe_id !== check.probe_id || evidence.observed_at !== check.observed_at) {
        throw new Error(`Canary operational smoke ${component} evidence does not match its observation`);
      }
      evidenceByComponent[component] = evidence;
      check.evidence_sha256 = operationalSmokeEvidenceSha256(bytes);
    }
    const semanticResults = validateCanaryOperationalSmokeEvidenceSet(evidenceByComponent, {
      components: HEALTH_EVIDENCE_COMPONENTS,
      boundIdentity: identity,
      deploymentManifest,
      readinessInvocationId,
      attestationCapturedAt: trustedRuntimeIdentity.verifier_identity.attestation_captured_at,
      attestationExpiresAt: trustedRuntimeIdentity.verifier_identity.attestation_expires_at,
      now: new Date(capturedAtMs),
    });
    checks = Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => {
      const check = pendingChecks[component];
      if (!HEALTH_EVIDENCE_COMPONENTS.includes(component)) {
        return [component, {
          status: "BLOCKED",
          semantic_status: "NOT_RUN",
          source: "source-authentication-blocked",
          observed_at: null,
          probe_id: null,
          evidence_artifact: null,
          evidence_sha256: null,
          source_authentication: {
            status: "BLOCKED",
            authority: CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component].authority,
            reason: CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component].reason,
          },
        }];
      }
      const result = semanticResults[component];
      const sourceAuthenticated = HEALTH_EVIDENCE_COMPONENTS.includes(component)
        && sourceProofToken === LIVE_HEALTH_SOURCE_PROOF;
      const status = result.semantic_status === "FAIL"
        ? "FAIL"
        : !sourceAuthenticated
          ? "BLOCKED"
          : check.status === "PASS" && result.semantic_status === "PASS" ? "PASS" : "FAIL";
      const sourceAuthentication = {
        status: sourceAuthenticated ? "PASS" : "BLOCKED",
        authority: CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component].authority,
        reason: CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component].reason,
      };
      if (!sourceAuthenticated) {
        return [component, {
          status,
          semantic_status: result.semantic_status,
          source: "source-authentication-blocked",
          observed_at: null,
          probe_id: null,
          evidence_artifact: null,
          evidence_sha256: null,
          source_authentication: sourceAuthentication,
        }];
      }
      return [component, {
        ...check,
        status,
        semantic_status: result.semantic_status,
        source_authentication: sourceAuthentication,
      }];
    }));
  }
  const status = overallStatus(checks);
  const unsigned = {
    schema_version: CANARY_OPERATIONAL_SMOKE_SCHEMA_VERSION,
    scope: CANARY_OPERATIONAL_SMOKE_SCOPE,
    status,
    readiness: status === "PASS" ? "OPERATIONAL_SMOKE_VERIFIED" : "BLOCKED",
    captured_at: capturedAt,
    readiness_invocation_id: readinessInvocationId,
    evidence: {
      source: HEALTH_EVIDENCE_COMPONENTS.some((component) => checks[component].source_authentication?.status === "PASS")
        ? "manifest-bound-live-health-probes"
        : hasLiveEvidence ? "source-authentication-blocked" : "live-inputs-unavailable",
      synthetic: false,
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
  if (Object.values(artifact.checks ?? {}).some((check) => check?.status === "PASS" || check?.source === "live-runner")) {
    if (!evidenceArtifacts) throw new Error("Canary operational smoke raw evidence artifacts are required");
  }
  assertExactKeys(artifact.evidence, ["source", "synthetic", "replay_policy"], "Canary operational smoke evidence metadata");
  if (!new Set(["manifest-bound-live-health-probes", "source-authentication-blocked", "live-inputs-unavailable"]).has(artifact.evidence.source)
    || artifact.evidence.synthetic !== false
    || artifact.evidence.replay_policy !== CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY) {
    throw new Error("operational smoke artifact does not have live-runner evidence provenance");
  }
  const identity = expectedIdentity(trustedRuntimeIdentity, deploymentManifest, readinessInvocationId);
  if (signature.signer_key_id !== identity.runtime_attestation_signer_key_id) {
    throw new Error("Canary operational smoke signer does not match the current Runtime Attestation signer");
  }
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
  const evidenceByComponent = {};
  for (const component of CANARY_OPERATIONAL_SMOKE_COMPONENTS) {
    const check = artifact.checks[component];
    assertObject(check, `Canary operational smoke ${component}`);
    assertExactKeys(check, ["status", "semantic_status", "source", "observed_at", "probe_id", "evidence_artifact", "evidence_sha256", "source_authentication"], `Canary operational smoke ${component}`);
    if (!COMPONENT_STATUSES.has(check.status)) throw new Error(`Canary operational smoke ${component} status is invalid`);
    const sourcePolicy = CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component];
    assertObject(check.source_authentication, `Canary operational smoke ${component} source authentication`);
    assertExactKeys(check.source_authentication, ["status", "authority", "reason"], `Canary operational smoke ${component} source authentication`);
    if (check.source_authentication.authority !== sourcePolicy.authority || check.source_authentication.reason !== sourcePolicy.reason) {
      throw new Error(`Canary operational smoke ${component} source-authentication policy mismatch`);
    }
    if (check.source === "not-run") {
      if (!new Set(["NOT_RUN", "NOT_IMPLEMENTED"]).has(check.status)
        || check.semantic_status !== check.status || check.source_authentication.status !== "NOT_RUN"
        || check.observed_at !== null || check.probe_id !== null || check.evidence_artifact !== null || check.evidence_sha256 !== null) {
        throw new Error(`Canary operational smoke ${component} non-run status contains live claims`);
      }
      continue;
    }
    if (check.source === "source-authentication-blocked") {
      const expectedStatus = check.semantic_status === "FAIL" ? "FAIL" : "BLOCKED";
      if (!new Set(["PASS", "FAIL", "NOT_RUN"]).has(check.semantic_status)
        || check.status !== expectedStatus || check.source_authentication.status !== "BLOCKED"
        || check.observed_at !== null || check.probe_id !== null || check.evidence_artifact !== null || check.evidence_sha256 !== null) {
        throw new Error(`Canary operational smoke ${component} blocked source metadata is invalid`);
      }
      continue;
    }
    if (check.source !== "live-runner" || !HEALTH_EVIDENCE_COMPONENTS.includes(component)
      || check.source_authentication.status !== "PASS" || check.semantic_status !== check.status
      || !new Set(["PASS", "FAIL"]).has(check.status)
      || !INVOCATION_ID_PATTERN.test(check.probe_id ?? "") || !HASH_PATTERN.test(check.evidence_sha256 ?? "")) {
      throw new Error(`Canary operational smoke ${component} live evidence metadata is invalid`);
    }
    const artifactPath = safeEvidenceArtifactPath(check.evidence_artifact);
    const bytes = evidenceArtifactBytes(evidenceArtifacts, artifactPath);
    if (operationalSmokeEvidenceSha256(bytes) !== check.evidence_sha256) {
      throw new Error(`Canary operational smoke ${component} evidence artifact digest mismatch`);
    }
    evidenceByComponent[component] = parseEvidenceBytes(bytes, component);
  }
  const hasLiveEvidence = Object.keys(evidenceByComponent).length > 0;
  if (hasLiveEvidence && Object.keys(evidenceByComponent).length !== HEALTH_EVIDENCE_COMPONENTS.length) {
    throw new Error("Canary operational smoke requires both manifest-bound live health probes");
  }
  if (hasLiveEvidence) {
    const semanticResults = validateCanaryOperationalSmokeEvidenceSet(evidenceByComponent, {
      components: HEALTH_EVIDENCE_COMPONENTS,
      boundIdentity: identity,
      deploymentManifest,
      readinessInvocationId,
      attestationCapturedAt: trustedRuntimeIdentity.verifier_identity.attestation_captured_at,
      attestationExpiresAt: trustedRuntimeIdentity.verifier_identity.attestation_expires_at,
      now,
    });
    for (const component of HEALTH_EVIDENCE_COMPONENTS) {
      const check = artifact.checks[component];
      if (evidenceByComponent[component].probe_id !== check.probe_id || evidenceByComponent[component].observed_at !== check.observed_at) {
        throw new Error(`Canary operational smoke ${component} evidence does not match its signed observation`);
      }
      const expectedStatus = semanticResults[component].status;
      if (check.status !== expectedStatus) throw new Error(`Canary operational smoke ${component} semantic status mismatch`);
      if (check.semantic_status !== semanticResults[component].status || check.source_authentication.status !== "PASS") {
        throw new Error(`Canary operational smoke ${component} source-authentication result mismatch`);
      }
    }
  }
  const hasBlockedEvidence = Object.values(artifact.checks).some((check) => check.source === "source-authentication-blocked");
  const expectedEvidenceSource = hasLiveEvidence
    ? "manifest-bound-live-health-probes"
    : hasBlockedEvidence ? "source-authentication-blocked" : "live-inputs-unavailable";
  if (artifact.evidence.source !== expectedEvidenceSource) {
    throw new Error("Canary operational smoke evidence source does not match its component matrix");
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
    source_authentication: Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, {
      status: artifact.checks[component].source_authentication.status,
      authority: artifact.checks[component].source_authentication.authority,
      reason: artifact.checks[component].source_authentication.reason,
    }])),
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
      source_authentication: Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, {
        status: "NOT_RUN",
        authority: CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component].authority,
        reason: CANARY_SMOKE_SOURCE_AUTHENTICITY_POLICIES[component].reason,
      }])),
    };
  }
  const identity = expectedIdentity(trustedRuntimeIdentity, deploymentManifest, readinessInvocationId);
  const signature = assertCanaryRuntimeAttestationSignature(artifact, { registry: runtimeAttestationKeyRegistry });
  if (signature.signer_key_id !== identity.runtime_attestation_signer_key_id) {
    throw new Error("Canary operational smoke signer does not match the current Runtime Attestation signer");
  }
  const actualArtifactPath = await realpath(resolve(artifactPath));
  const result = assertCanaryOperationalSmokeArtifact(artifact, {
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    runtimeAttestationKeyRegistry,
    evidenceArtifacts: await readCanarySmokeEvidenceArtifacts(artifactPath, artifact.checks),
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

async function readCanarySmokeEvidenceArtifacts(artifactPath, checks) {
  const artifactDirectory = await realpath(dirname(resolve(artifactPath)));
  const evidenceArtifacts = {};
  for (const check of Object.values(checks ?? {})) {
    if (check?.source !== "live-runner") continue;
    const relativePath = safeEvidenceArtifactPath(check.evidence_artifact);
    const targetPath = resolve(artifactDirectory, relativePath);
    const actualPath = await realpath(targetPath);
    const resolvedRelativePath = relative(artifactDirectory, actualPath);
    if (resolvedRelativePath.startsWith("..") || isAbsolute(resolvedRelativePath)) {
      throw new Error("Canary operational smoke evidence artifact escapes its directory");
    }
    const metadata = await stat(actualPath);
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_COMPONENT_EVIDENCE_BYTES) {
      throw new Error("Canary operational smoke evidence artifact size or file type is invalid");
    }
    evidenceArtifacts[relativePath] = await readFile(actualPath);
  }
  return evidenceArtifacts;
}

export async function runCanaryOperationalSmokeFromLiveEvidence({
  outputPath,
  mainWorkerOrigin,
  verifierOrigin,
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId,
  signingPrivateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const missingInputs = [];
  if (typeof outputPath !== "string" || outputPath.trim().length === 0) {
    missingInputs.push("TLSN_CANARY_OPERATIONAL_SMOKE_PATH");
  }
  if (typeof mainWorkerOrigin !== "string" || mainWorkerOrigin.trim().length === 0) {
    missingInputs.push("TLSN_CANARY_WORKER_INTERNAL_URL");
  }
  if (typeof verifierOrigin !== "string" || verifierOrigin.trim().length === 0) {
    missingInputs.push("TLSN_CANARY_VERIFIER_WORKER_INTERNAL_URL");
  }
  if (!trustedRuntimeIdentity || !deploymentManifest || !runtimeAttestationKeyRegistry) {
    missingInputs.push("validated_runtime_identity_manifest_and_registries");
  }
  if (!readinessInvocationId || !signerKeyId || !signingPrivateKeyPkcs8) {
    missingInputs.push("readiness_invocation_and_runtime_attestation_signer");
  }
  if (missingInputs.length > 0) {
    return {
      status: "NOT_RUN",
      readiness: "BLOCKED",
      missing_inputs: missingInputs,
      reason: "Manifest-bound Main/Verifier health origins and current Canary trust inputs are required; no fixture fallback is available.",
    };
  }

  const mainOrigin = assertManifestBoundHealthOrigin(
    mainWorkerOrigin,
    "Main Worker origin",
    "TLSN_CANARY_WORKER_INTERNAL_URL",
    deploymentManifest,
  );
  const verifierHealthOrigin = assertManifestBoundHealthOrigin(
    verifierOrigin,
    "Dedicated Verifier origin",
    "TLSN_CANARY_VERIFIER_WORKER_INTERNAL_URL",
    deploymentManifest,
  );
  const identity = expectedIdentity(trustedRuntimeIdentity, deploymentManifest, readinessInvocationId);
  const evidenceByComponent = {};
  const inputBytesByComponent = {};
  let mainHealth;
  let verifierHealth;
  try {
    [mainHealth, verifierHealth] = await Promise.all([
      fetchCanarySmokeHealth(mainOrigin, fetchImpl),
      fetchCanarySmokeHealth(verifierHealthOrigin, fetchImpl),
    ]);
  } catch {
    return {
      status: "FAIL",
      readiness: "BLOCKED",
      missing_inputs: [],
      reason: "Live Main or Dedicated Verifier health probe failed; no fixture fallback is available.",
    };
  }

  const mainBody = mainHealth.body;
  const mainDeployment = mainBody?.deployment_identity;
  const mainRuntime = mainBody?.runtime_version;
  if (!mainDeployment || !mainRuntime || typeof mainBody.git_commit_sha !== "string") {
    return { status: "FAIL", readiness: "BLOCKED", missing_inputs: [], reason: "Live Main health response is missing runtime identity fields." };
  }
  const verifierBody = verifierHealth.body;
  const verifierRuntime = verifierBody?.runtime_version;
  const verifierIdentity = verifierBody?.verifier_identity;
  if (!verifierRuntime || !verifierIdentity) {
    return { status: "FAIL", readiness: "BLOCKED", missing_inputs: [], reason: "Live Verifier health response is missing execution identity fields." };
  }
  const probeObservedAt = now instanceof Date ? now.toISOString() : now;
  evidenceByComponent.main_worker = createLiveHealthEvidence("main_worker", {
    http_status: mainHealth.status,
    deployment_id: mainDeployment.deployment_id,
    worker_name: mainDeployment.worker_name,
    version_id: mainRuntime.version_id,
    origin_sha256: deploymentManifest.inputs.find((input) => input.name === "TLSN_CANARY_WORKER_INTERNAL_URL").value_sha256,
    git_commit_sha: mainBody.git_commit_sha,
    deployment_role: mainDeployment.deployment_role,
    execution_mode: mainBody.execution_mode,
  }, readinessInvocationId, identity, probeObservedAt);
  evidenceByComponent.verifier = createLiveHealthEvidence("verifier", {
    http_status: verifierHealth.status,
    deployment_id: verifierBody.deployment_id,
    worker_name: verifierBody.worker_name,
    version_id: verifierRuntime.version_id,
    origin_sha256: deploymentManifest.inputs.find((input) => input.name === "TLSN_CANARY_VERIFIER_WORKER_INTERNAL_URL").value_sha256,
    verifier_key_id: verifierIdentity.key_id,
    keypair_valid: verifierIdentity.keypair_valid,
  }, readinessInvocationId, identity, probeObservedAt);

  const outputAbsolutePath = resolve(outputPath);
  const outputDirectory = dirname(outputAbsolutePath);
  const evidenceDirectoryName = `${basename(outputAbsolutePath)}.evidence`;
  const evidenceOutputDirectory = join(outputDirectory, evidenceDirectoryName);
  const observations = {};
  const evidenceArtifacts = {};
  for (const component of HEALTH_EVIDENCE_COMPONENTS) {
    const evidence = evidenceByComponent[component];
    const artifactPath = `${evidenceDirectoryName}/${component}.json`;
    observations[component] = {
      status: "PASS",
      observed_at: evidence.observed_at,
      probe_id: evidence.probe_id,
      evidence_artifact: artifactPath,
    };
    inputBytesByComponent[component] = Buffer.from(JSON.stringify(evidence), "utf8");
    evidenceArtifacts[artifactPath] = inputBytesByComponent[component];
  }
  for (const component of CANARY_OPERATIONAL_SMOKE_COMPONENTS) {
    if (HEALTH_EVIDENCE_COMPONENTS.includes(component)) continue;
    observations[component] = {
      status: "NOT_RUN",
      observed_at: null,
      probe_id: null,
      evidence_artifact: null,
    };
  }
  const artifact = createCanaryOperationalSmokeArtifact({
    observations,
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    signerKeyId,
    signingPrivateKeyPkcs8,
    runtimeAttestationKeyRegistry,
    evidenceArtifacts,
    sourceProofToken: LIVE_HEALTH_SOURCE_PROOF,
    capturedAt: now instanceof Date ? now.toISOString() : now,
    signingNow: now,
  });

  await mkdir(outputDirectory, { recursive: true });
  const createdPaths = [];
  let createdEvidenceDirectory = false;
  try {
    await mkdir(evidenceOutputDirectory, { recursive: false });
    createdEvidenceDirectory = true;
    for (const component of HEALTH_EVIDENCE_COMPONENTS) {
      const evidencePath = join(evidenceOutputDirectory, `${component}.json`);
      const evidenceHandle = await open(evidencePath, "wx", 0o600);
      createdPaths.push(evidencePath);
      try {
        await evidenceHandle.writeFile(inputBytesByComponent[component]);
      } finally {
        await evidenceHandle.close();
      }
    }
    const artifactHandle = await open(outputAbsolutePath, "wx", 0o600);
    createdPaths.push(outputAbsolutePath);
    try {
      await artifactHandle.writeFile(`${JSON.stringify(artifact)}\n`, "utf8");
    } finally {
      await artifactHandle.close();
    }
  } catch (error) {
    await Promise.all(createdPaths.map((path) => unlink(path).catch(() => {})));
    if (createdEvidenceDirectory) await rmdir(evidenceOutputDirectory).catch(() => {});
    throw new Error("Canary operational smoke output already exists or could not be written", { cause: error });
  }
  return {
    status: artifact.status,
    readiness: artifact.readiness,
    artifact_path: outputAbsolutePath,
    evidence_directory: evidenceOutputDirectory,
    components: Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, artifact.checks[component].status])),
    source_authentication: Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, artifact.checks[component].source_authentication])),
  };
}

export function operationalSmokeEvidenceSha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}