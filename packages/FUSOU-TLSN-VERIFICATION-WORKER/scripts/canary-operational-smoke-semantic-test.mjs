import assert from "node:assert/strict";
import {
  CANARY_OPERATIONAL_SMOKE_RAW_EVIDENCE_SCOPE,
  CANARY_OPERATIONAL_SMOKE_RAW_EVIDENCE_SCHEMA_VERSION,
  validateCanaryOperationalSmokeEvidenceSet,
} from "./canary-operational-smoke-semantic.mjs";

const readinessInvocationId = "f73fded7-d9af-4f0a-b87b-c626d30d55bd";
const jobId = "a73fded7-d9af-4f0a-b87b-c626d30d55bd";
const attemptId = "b73fded7-d9af-4f0a-b87b-c626d30d55bd";
const sessionId = "session-smoke-2026-09-30";
const resultSha256 = "A".repeat(43);
const presentationSha256 = "B".repeat(43);
const subjectSha256 = "C".repeat(43);
const deviceSha256 = "D".repeat(43);
const verifierKeyId = "verifier-canary-2026-09-30";
const components = ["main_worker", "verifier", "callback", "trigger", "session_binding", "DO", "R2", "Notary", "Auth", "Presentation"];
const boundIdentity = {
  manifest_id: "manifest-2026-09-30",
  main_deployment_id: "main-canary-2026-09-30",
  main_worker_name: "fusou-tlsn-verification-canary",
  main_version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5",
  git_commit_sha: "a".repeat(40),
  verifier_deployment_id: "verifier-canary-2026-09-30",
  verifier_worker_name: "fusou-tlsn-verifier-canary",
  verifier_version_id: "5b064508-1cdb-453c-826b-bdea36a8b1e5",
  verifier_key_id: verifierKeyId,
};
const deploymentManifest = {
  target: { server_identity: "game.example.net" },
  notary: { key_id: "notary-canary-2026-09-30" },
};
const common = (component, claims, index) => ({
  schema_version: CANARY_OPERATIONAL_SMOKE_RAW_EVIDENCE_SCHEMA_VERSION,
  scope: CANARY_OPERATIONAL_SMOKE_RAW_EVIDENCE_SCOPE,
  component,
  source: "canary-live-runner",
  synthetic: false,
  readiness_invocation_id: readinessInvocationId,
  probe_id: `${index.toString(16).padStart(8, "0")}-d9af-4f0a-b87b-c626d30d55bd`,
  observed_at: "2026-09-30T12:00:00.000Z",
  bound_identity: structuredClone(boundIdentity),
  claims,
});
const jobAttempt = { job_id: jobId, attempt_id: attemptId };
const evidence = {
  main_worker: common("main_worker", {
    ...jobAttempt, http_status: 200, deployment_id: boundIdentity.main_deployment_id,
    worker_name: boundIdentity.main_worker_name, version_id: boundIdentity.main_version_id,
    git_commit_sha: boundIdentity.git_commit_sha, deployment_role: "canary", execution_mode: "trigger",
  }, 1),
  verifier: common("verifier", {
    ...jobAttempt, http_status: 200, deployment_id: boundIdentity.verifier_deployment_id,
    worker_name: boundIdentity.verifier_worker_name, version_id: boundIdentity.verifier_version_id,
    verifier_key_id: verifierKeyId, keypair_valid: true,
  }, 2),
  callback: common("callback", {
    ...jobAttempt, http_status: 200, mode: "trigger", session_id: sessionId,
    result_sha256: resultSha256, presentation_sha256: presentationSha256, receipt_sha256: "E".repeat(43),
  }, 3),
  trigger: common("trigger", {
    ...jobAttempt, state: "COMPLETED", task_id: "tlsn-verify-presentation", run_id: "run_123",
    session_id: sessionId, result_sha256: resultSha256,
  }, 4),
  session_binding: common("session_binding", {
    ...jobAttempt, session_id: sessionId, binding_sha256: "F".repeat(43),
    canonical_user_id_sha256: subjectSha256, device_id_sha256: deviceSha256,
    session_receipt_valid: true, consume_receipt_valid: true,
  }, 5),
  DO: common("DO", {
    ...jobAttempt, status: "consumed", result_sha256: resultSha256,
    result_object_key: `tlsn-verification/${attemptId}/result.json`,
  }, 6),
  R2: common("R2", {
    ...jobAttempt, object_key: `tlsn-verification/${attemptId}/result.json`, byte_length: 1024,
    readback_byte_length: 1024, result_sha256: resultSha256, readback_sha256: resultSha256,
  }, 7),
  Notary: common("Notary", {
    ...jobAttempt, key_id: deploymentManifest.notary.key_id, registry_sha256: "G".repeat(43),
    signature_valid: true, presentation_sha256: presentationSha256,
  }, 8),
  Auth: common("Auth", {
    ...jobAttempt, authority: "supabase+fusou-web", authenticated: true, is_anonymous: false,
    device_owner_match: true, canonical_user_id_sha256: subjectSha256, device_id_sha256: deviceSha256,
  }, 9),
  Presentation: common("Presentation", {
    ...jobAttempt, verified: true, profile_sha256: "H".repeat(43),
    server_identity: deploymentManifest.target.server_identity, notary_key_id: deploymentManifest.notary.key_id,
    presentation_sha256: presentationSha256, result_sha256: resultSha256,
  }, 10),
};
const options = {
  components,
  boundIdentity,
  deploymentManifest,
  readinessInvocationId,
  attestationCapturedAt: "2026-09-30T11:50:00.000Z",
  attestationExpiresAt: "2026-09-30T12:20:00.000Z",
  now: new Date("2026-09-30T12:00:00.000Z"),
};

const results = validateCanaryOperationalSmokeEvidenceSet(evidence, options);
assert.deepEqual(Object.values(results).map(({ status }) => status), Array(10).fill("PASS"));

const mutated = structuredClone(evidence);
mutated.R2.claims.readback_sha256 = "I".repeat(43);
assert.equal(validateCanaryOperationalSmokeEvidenceSet(mutated, options).R2.status, "FAIL");

const wrongAttempt = structuredClone(evidence);
wrongAttempt.trigger.claims.attempt_id = "d73fded7-d9af-4f0a-b87b-c626d30d55bd";
assert.ok(Object.values(validateCanaryOperationalSmokeEvidenceSet(wrongAttempt, options)).every(({ status }) => status === "FAIL"));

const synthetic = structuredClone(evidence);
synthetic.Presentation.synthetic = true;
assert.throws(() => validateCanaryOperationalSmokeEvidenceSet(synthetic, options), /not live-runner evidence/);

const stale = structuredClone(evidence);
stale.Auth.observed_at = "2026-09-30T11:40:00.000Z";
assert.throws(() => validateCanaryOperationalSmokeEvidenceSet(stale, options), /outside the Runtime Attestation window/);

const crossInvocation = structuredClone(evidence);
crossInvocation.callback.readiness_invocation_id = "e73fded7-d9af-4f0a-b87b-c626d30d55bd";
assert.throws(() => validateCanaryOperationalSmokeEvidenceSet(crossInvocation, options), /another readiness invocation/);

console.log("[tlsn-canary-operational-smoke-semantic] ten component validators and cross-component trust bindings PASS");