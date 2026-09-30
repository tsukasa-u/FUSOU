import { canonicalJson } from "./production-trust-contract.mjs";

export const CANARY_OPERATIONAL_SMOKE_RAW_EVIDENCE_SCHEMA_VERSION = 1;
export const CANARY_OPERATIONAL_SMOKE_RAW_EVIDENCE_SCOPE = "tlsn-canary-operational-smoke-live-evidence";

const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE_PATTERN = /^[A-Za-z0-9._:/-]{1,512}$/;
const COMPONENT_CLAIM_FIELDS = Object.freeze({
  main_worker: ["http_status", "deployment_id", "worker_name", "version_id", "git_commit_sha", "deployment_role", "execution_mode", "job_id", "attempt_id"],
  verifier: ["http_status", "deployment_id", "worker_name", "version_id", "verifier_key_id", "keypair_valid", "job_id", "attempt_id"],
  callback: ["http_status", "mode", "job_id", "attempt_id", "session_id", "result_sha256", "presentation_sha256", "receipt_sha256"],
  trigger: ["state", "task_id", "run_id", "job_id", "attempt_id", "session_id", "result_sha256"],
  session_binding: ["session_id", "job_id", "attempt_id", "binding_sha256", "canonical_user_id_sha256", "device_id_sha256", "session_receipt_valid", "consume_receipt_valid"],
  DO: ["status", "job_id", "attempt_id", "result_sha256", "result_object_key"],
  R2: ["job_id", "attempt_id", "object_key", "byte_length", "readback_byte_length", "result_sha256", "readback_sha256"],
  Notary: ["job_id", "attempt_id", "key_id", "registry_sha256", "signature_valid", "presentation_sha256"],
  Auth: ["job_id", "attempt_id", "authority", "authenticated", "is_anonymous", "device_owner_match", "canonical_user_id_sha256", "device_id_sha256"],
  Presentation: ["job_id", "attempt_id", "verified", "profile_sha256", "server_identity", "notary_key_id", "presentation_sha256", "result_sha256"],
});

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed`);
}

function assertExactKeys(value, fields, label) {
  if (Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")) {
    throw new Error(`${label} fields are invalid`);
  }
}

function requiredString(value, label, pattern = REFERENCE_PATTERN) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
  return value;
}

function requiredHash(value, label) {
  return requiredString(value, label, HASH_PATTERN);
}

function requiredUuid(value, label) {
  return requiredString(value, label, UUID_PATTERN);
}

function identityMatches(actual, expected) {
  return canonicalJson(actual) === canonicalJson(expected);
}

function semanticStatus(component, claims, { boundIdentity, deploymentManifest }) {
  const jobId = requiredUuid(claims.job_id, `${component} job_id`);
  const attemptId = requiredUuid(claims.attempt_id, `${component} attempt_id`);
  let passed = true;
  switch (component) {
    case "main_worker":
      passed = claims.http_status === 200
        && claims.deployment_id === boundIdentity.main_deployment_id
        && claims.worker_name === boundIdentity.main_worker_name
        && claims.version_id === boundIdentity.main_version_id
        && claims.git_commit_sha === boundIdentity.git_commit_sha
        && claims.deployment_role === "canary"
        && claims.execution_mode === "trigger";
      break;
    case "verifier":
      passed = claims.http_status === 200
        && claims.deployment_id === boundIdentity.verifier_deployment_id
        && claims.worker_name === boundIdentity.verifier_worker_name
        && claims.version_id === boundIdentity.verifier_version_id
        && claims.verifier_key_id === boundIdentity.verifier_key_id
        && claims.keypair_valid === true;
      requiredBoolean(claims.keypair_valid, "verifier keypair_valid");
      break;
    case "callback":
      requiredString(claims.session_id, "callback session_id");
      requiredHash(claims.result_sha256, "callback result_sha256");
      requiredHash(claims.presentation_sha256, "callback presentation_sha256");
      requiredHash(claims.receipt_sha256, "callback receipt_sha256");
      passed = claims.http_status === 200 && claims.mode === "trigger";
      break;
    case "trigger":
      requiredString(claims.task_id, "Trigger task_id");
      requiredString(claims.run_id, "Trigger run_id");
      requiredString(claims.session_id, "Trigger session_id");
      requiredHash(claims.result_sha256, "Trigger result_sha256");
      passed = claims.state === "COMPLETED";
      break;
    case "session_binding":
      requiredString(claims.session_id, "session binding session_id");
      requiredHash(claims.binding_sha256, "session binding binding_sha256");
      requiredHash(claims.canonical_user_id_sha256, "session binding canonical_user_id_sha256");
      requiredHash(claims.device_id_sha256, "session binding device_id_sha256");
      passed = claims.session_receipt_valid === true && claims.consume_receipt_valid === true;
      requiredBoolean(claims.session_receipt_valid, "session receipt validity");
      requiredBoolean(claims.consume_receipt_valid, "consume receipt validity");
      break;
    case "DO":
      requiredHash(claims.result_sha256, "DO result_sha256");
      requiredString(claims.result_object_key, "DO result_object_key");
      passed = claims.status === "consumed"
        && claims.result_object_key === `tlsn-verification/${attemptId}/result.json`;
      break;
    case "R2":
      requiredString(claims.object_key, "R2 object_key");
      requiredHash(claims.result_sha256, "R2 result_sha256");
      requiredHash(claims.readback_sha256, "R2 readback_sha256");
      if (!Number.isSafeInteger(claims.byte_length) || claims.byte_length <= 0) throw new Error("R2 byte_length is invalid");
      if (!Number.isSafeInteger(claims.readback_byte_length) || claims.readback_byte_length <= 0) throw new Error("R2 readback_byte_length is invalid");
      passed = claims.object_key === `tlsn-verification/${attemptId}/result.json`
        && claims.byte_length === claims.readback_byte_length
        && claims.result_sha256 === claims.readback_sha256;
      break;
    case "Notary":
      requiredHash(claims.registry_sha256, "Notary registry_sha256");
      requiredHash(claims.presentation_sha256, "Notary presentation_sha256");
      requiredBoolean(claims.signature_valid, "Notary signature_valid");
      passed = claims.key_id === deploymentManifest.notary?.key_id && claims.signature_valid === true;
      break;
    case "Auth":
      requiredHash(claims.canonical_user_id_sha256, "Auth canonical_user_id_sha256");
      requiredHash(claims.device_id_sha256, "Auth device_id_sha256");
      for (const field of ["authenticated", "is_anonymous", "device_owner_match"]) requiredBoolean(claims[field], `Auth ${field}`);
      passed = claims.authority === "supabase+fusou-web"
        && claims.authenticated === true
        && claims.is_anonymous === false
        && claims.device_owner_match === true;
      break;
    case "Presentation":
      requiredHash(claims.profile_sha256, "Presentation profile_sha256");
      requiredString(claims.server_identity, "Presentation server_identity");
      requiredString(claims.notary_key_id, "Presentation notary_key_id");
      requiredHash(claims.presentation_sha256, "Presentation presentation_sha256");
      requiredHash(claims.result_sha256, "Presentation result_sha256");
      requiredBoolean(claims.verified, "Presentation verified");
      passed = claims.verified === true
        && claims.server_identity === deploymentManifest.target?.server_identity
        && claims.notary_key_id === deploymentManifest.notary?.key_id;
      break;
    default:
      throw new Error(`unknown Canary operational smoke component: ${component}`);
  }
  return { status: passed ? "PASS" : "FAIL", job_id: jobId, attempt_id: attemptId };
}

export function validateCanaryOperationalSmokeEvidenceSet(evidenceByComponent, {
  components,
  boundIdentity,
  deploymentManifest,
  readinessInvocationId,
  attestationCapturedAt,
  attestationExpiresAt,
  now = new Date(),
} = {}) {
  assertObject(evidenceByComponent, "Canary operational smoke raw evidence set");
  assertExactKeys(evidenceByComponent, components, "Canary operational smoke raw evidence set");
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const capturedAtMs = Date.parse(attestationCapturedAt);
  const expiresAtMs = Date.parse(attestationExpiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(capturedAtMs) || !Number.isFinite(expiresAtMs)) {
    throw new Error("Canary operational smoke evidence validity window is invalid");
  }
  const results = {};
  const probeIds = new Set();
  for (const component of components) {
    const evidence = evidenceByComponent[component];
    assertObject(evidence, `Canary operational smoke ${component} evidence`);
    assertExactKeys(evidence, [
      "schema_version", "scope", "component", "source", "synthetic", "readiness_invocation_id",
      "probe_id", "observed_at", "bound_identity", "claims",
    ], `Canary operational smoke ${component} evidence`);
    if (evidence.schema_version !== CANARY_OPERATIONAL_SMOKE_RAW_EVIDENCE_SCHEMA_VERSION
      || evidence.scope !== CANARY_OPERATIONAL_SMOKE_RAW_EVIDENCE_SCOPE
      || evidence.component !== component
      || evidence.source !== "canary-live-runner"
      || evidence.synthetic !== false) {
      throw new Error(`Canary operational smoke ${component} evidence is not live-runner evidence`);
    }
    if (evidence.readiness_invocation_id !== readinessInvocationId) {
      throw new Error(`Canary operational smoke ${component} evidence belongs to another readiness invocation`);
    }
    const probeId = requiredUuid(evidence.probe_id, `${component} probe_id`);
    if (probeIds.has(probeId)) throw new Error("Canary operational smoke reuses a component probe ID");
    probeIds.add(probeId);
    const observedAt = Date.parse(requiredString(evidence.observed_at, `${component} observed_at`, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));
    if (!Number.isFinite(observedAt) || observedAt > nowMs || observedAt < capturedAtMs || observedAt >= expiresAtMs) {
      throw new Error(`Canary operational smoke ${component} evidence is stale or outside the Runtime Attestation window`);
    }
    if (!identityMatches(evidence.bound_identity, boundIdentity)) {
      throw new Error(`Canary operational smoke ${component} evidence identity does not match the Runtime Attestation`);
    }
    assertObject(evidence.claims, `Canary operational smoke ${component} claims`);
    assertExactKeys(evidence.claims, COMPONENT_CLAIM_FIELDS[component], `Canary operational smoke ${component} claims`);
    results[component] = semanticStatus(component, evidence.claims, { boundIdentity, deploymentManifest });
  }

  const claims = Object.fromEntries(components.map((component) => [component, evidenceByComponent[component].claims]));
  const same = (field, componentNames) => componentNames.every((component) => claims[component][field] === claims[componentNames[0]][field]);
  const sharedJobAttempt = components.every((component) => (
    results[component].job_id === results[components[0]].job_id
    && results[component].attempt_id === results[components[0]].attempt_id
  ));
  const sharedSession = same("session_id", ["callback", "trigger", "session_binding"]);
  const sharedResult = same("result_sha256", ["callback", "trigger", "DO", "R2", "Presentation"]);
  const sharedPresentation = same("presentation_sha256", ["callback", "Notary", "Presentation"]);
  const sharedAuthSubject = claims.Auth.canonical_user_id_sha256 === claims.session_binding.canonical_user_id_sha256
    && claims.Auth.device_id_sha256 === claims.session_binding.device_id_sha256;
  if (!sharedJobAttempt || !sharedSession || !sharedResult || !sharedPresentation || !sharedAuthSubject) {
    for (const component of components) results[component].status = "FAIL";
  }
  return results;
}