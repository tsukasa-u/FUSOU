import { assertAuthenticatedReleaseTransport, ReleaseBlocked } from "./release-transport.mjs";
import { parseReleaseRecord, producerWorkflow, requireRelease } from "./release-build-proof.mjs";
import { assertArchiveReadbackPolicy, parsePinnedCheckInputs } from "./release-checks.mjs";
import { assertTrustedExecutionImplementation } from "./release-execution-intake.mjs";
import { evaluateReleaseRun } from "./release-eligibility.mjs";
import { readAuthorityArchiveCatalog } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs";
import { archivePolicyBytes, assertCatalogGrant, validateArchiveTransportSpec } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs";
import { sha256 } from "./release-bytes.mjs";

// This compiler does not publish an authorization policy or serialize an authority capability.
export async function deriveArchiveGrant({ github, run, trustedSha, downloaded, checkPolicyBytes, checkPolicySha256,
  publicBuildInputsSha256 }, { authority, now = () => Date.now() } = {}) {
  assertAuthenticatedReleaseTransport(downloaded, run);
  const policy = parsePinnedCheckInputs(checkPolicyBytes, checkPolicySha256, "fusou-release-check-inputs-v1");
  const config = policy.grant_provider;
  if (!config) throw new ReleaseBlocked("ARCHIVE_GRANT_PROVIDER_POLICY_MISSING");
  requireRelease(config.schema_version === 1 && config.scope === "fusou-release-grant-provider-v1" &&
    config.template && !Object.hasOwn(config.template, "grants") &&
    Number.isSafeInteger(config.grant_ttl_ms) && config.grant_ttl_ms > 0 && config.grant_ttl_ms <= 600_000 &&
    Number.isSafeInteger(config.capture_not_before_ms) && config.capture_not_before_ms >= 0 &&
    Number.isSafeInteger(config.capture_max_age_ms) && config.capture_max_age_ms > 0 &&
    typeof config.subject?.canonical_user_id === "string" && config.subject.canonical_user_id &&
    typeof config.subject.device_id === "string" && config.subject.device_id,
  "independent grant provider template/subject/lifetime");
  assertArchiveReadbackPolicy(policy.archive);
  const fresh = (await github.rest.actions.getWorkflowRun({ owner: "tsukasa-u", repo: "FUSOU", run_id: run.id })).data;
  requireRelease(fresh.id === run.id && fresh.run_attempt === run.run_attempt && fresh.head_sha === run.head_sha &&
    fresh.repository?.full_name === "tsukasa-u/FUSOU" && fresh.head_repository?.full_name === "tsukasa-u/FUSOU" &&
    Number.isSafeInteger(fresh.repository.id) && fresh.repository.id > 0 && fresh.repository.id === run.repository.id &&
    fresh.head_repository.id === fresh.repository.id && String(fresh.repository.id) === config.template.repository_id &&
    fresh.event === "workflow_run" && fresh.path === producerWorkflow && fresh.head_branch === "main" &&
    (fresh.status === "in_progress" || fresh.status === "completed" && fresh.conclusion === "success"),
  "grant independent GitHub run/repository/workflow identity");
  await assertTrustedExecutionImplementation({ github, run: fresh, trustedSha });
  const report = parseReleaseRecord(downloaded.files.get("release-report.json"));
  const eligibility = await evaluateReleaseRun({ github, repository: { owner: "tsukasa-u", repo: "FUSOU" },
    runId: report.validation_run_id, trustedSha });
  requireRelease(eligibility.status === "PRODUCTION_ELIGIBLE" &&
    ["status", "tag", "commit_sha", "validation_run_id", "validation_run_attempt"].every((key) => report[key] === eligibility[key]) &&
    report.coordinator_sha === fresh.head_sha && report.eligibility_run?.run_id === fresh.id &&
    report.eligibility_run.run_attempt === fresh.run_attempt && report.eligibility_run.coordinator_sha === fresh.head_sha &&
    policy.source_sha === eligibility.commit_sha && policy.archive.source_sha === eligibility.commit_sha &&
    report.evidence_production?.check_policy_sha256 === checkPolicySha256 &&
    publicBuildInputsSha256 && report.build?.public_inputs_sha256 === publicBuildInputsSha256 &&
    report.build.status === "BUILD_OUTPUTS_GENERATED", "grant independent live release/source/input identity");
  if (typeof authority?.getConsumedVerificationResult !== "function") {
    throw new ReleaseBlocked("ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED", "BLOCKED_IMPLEMENTATION");
  }
  const lookup = { session_id: policy.archive.session_id, verification_job_id: policy.archive.objects.result.job_id,
    canonical_user_id: config.subject.canonical_user_id, device_id: config.subject.device_id };
  const catalog = await readAuthorityArchiveCatalog(authority, policy.archive.capture_id, lookup);
  requireRelease(catalog.source_sha === eligibility.commit_sha, "grant authority writer/release source");
  for (const role of ["presentation", "result"]) {
    const expected = policy.archive.objects[role], observed = catalog.objects[role];
    requireRelease(["role", "source_sha", "session_id", "job_id", "verification_attempt_id", "binding_id", "object_key", "version_id", "sha256"]
      .every((key) => expected[key] === observed[key]) && expected.capture_id === catalog.capture_id &&
      expected.backend_id === config.template.endpoint &&
      (expected.byte_length === undefined || expected.byte_length === observed.byte_length),
    "grant independent capture policy/catalog generation/digest");
  }
  const nowMs = now();
  requireRelease(Number.isSafeInteger(nowMs) && nowMs >= 0 && Number.isSafeInteger(nowMs + config.grant_ttl_ms), "grant provider clock");
  const grant = { workflow_sha: fresh.head_sha, run_id: fresh.id, run_attempt: fresh.run_attempt,
    source_sha: eligibility.commit_sha, capture_id: catalog.capture_id, binding_id: catalog.binding_id,
    verification_attempt_id: catalog.verification_attempt_id, lookup, not_before_ms: nowMs,
    expires_at_ms: nowMs + config.grant_ttl_ms, capture_not_before_ms: config.capture_not_before_ms,
    capture_max_age_ms: config.capture_max_age_ms };
  const candidatePolicy = { ...config.template, grants: [grant] };
  const spec = { policy: candidatePolicy, policy_sha256: sha256(archivePolicyBytes(candidatePolicy)) };
  await validateArchiveTransportSpec(spec);
  assertCatalogGrant(catalog, grant, candidatePolicy, nowMs);
  assertAuthenticatedReleaseTransport(downloaded, run);
  return { schema_version: 1, scope: "fusou-derived-archive-grant-candidate-v1", status: "DERIVED_NOT_AUTHORIZED",
    issuer: { kind: "TRUSTED_COORDINATOR_LOCAL_DERIVATION", repository: "tsukasa-u/FUSOU", workflow_sha: fresh.head_sha },
    grant, candidate_policy: spec,
    bindings: { primary_artifact: downloaded.origin, report_sha256: sha256(downloaded.files.get("release-report.json")),
      public_build_inputs_sha256: publicBuildInputsSha256, check_policy_sha256: checkPolicySha256,
      capture_policy_sha256: sha256(archivePolicyBytes(policy.archive)), catalog_sha256: sha256(archivePolicyBytes(catalog)),
      objects: catalog.objects, result_envelope_sha256: catalog.result_envelope_sha256,
      ...(catalog.verifier_execution_receipt_sha256 ? { verifier_execution_receipt_sha256: catalog.verifier_execution_receipt_sha256 } : {}) },
    publication_authorized: false, authorization_status: "BLOCKED_IMPLEMENTATION",
    blocker: "ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED" };
}
