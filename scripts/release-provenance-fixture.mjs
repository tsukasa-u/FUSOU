// Key-free synthetic API/authority/HTTPS fixture. No service, OIDC signature or native execution.
import { createHash } from "node:crypto";
import { checkFixture } from "./release-check-fixture.mjs";
import { sha256 } from "./release-bytes.mjs";
import { jsonBytes } from "./release-checks.mjs";
import { collectReleaseEvidence } from "./release-evidence-producer.mjs";
import { produceArchiveJob } from "./release-archive-job.mjs";
import { encodeReleaseTransport } from "./release-transport.mjs";
import { EXECUTION_ORIGIN_FILE, executionSubject } from "./release-execution-origin.mjs";
import { createConsumedArchiveCatalog } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs";
import { ARCHIVE_HTTP_PATH, ARCHIVE_WORKFLOW_REF, archiveAuthorization, archivePolicyBytes, encodeArchiveBytes } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs";

export async function provenanceFixture() {
  const f = await checkFixture(), expected = f.checkPolicy.archive, endpoint = `https://archive.example.test${ARCHIVE_HTTP_PATH}`;
  expected.capture_id = expected.objects.result.binding_id;
  for (const o of Object.values(expected.objects)) Object.assign(o, { capture_id: expected.capture_id, backend_id: endpoint });
  const identity = { repository: "tsukasa-u/FUSOU", workflow_ref: ARCHIVE_WORKFLOW_REF, workflow_sha: f.context.workflow_sha,
    event_name: "workflow_run", ref: "refs/heads/main", run_id: f.context.run_id, run_attempt: f.context.run_attempt };
  const lookup = { session_id: expected.session_id, canonical_user_id: "synthetic-user", device_id: "synthetic-device",
    verification_job_id: expected.objects.result.job_id };
  const grant = { source_sha: f.context.source_sha, workflow_sha: f.context.workflow_sha, run_id: f.context.run_id, run_attempt: f.context.run_attempt,
    capture_id: expected.capture_id, binding_id: expected.capture_id, verification_attempt_id: expected.objects.result.verification_attempt_id,
    lookup, not_before_ms: 0, expires_at_ms: 100_000, capture_not_before_ms: 0, capture_max_age_ms: 50_000 };
  const policy = { schema_version: 1, scope: "fusou-github-oidc-archive-read-v1", endpoint, audience: endpoint, repository: identity.repository,
    repository_id: "7", repository_owner_id: "11", workflow_ref: identity.workflow_ref, event_name: identity.event_name, ref: identity.ref,
    clock_skew_seconds: 0, max_token_age_seconds: 60, max_object_bytes: 4096, grants: [grant] };
  const spec = { policy, policy_sha256: sha256(archivePolicyBytes(policy)) };
  const record = { ...lookup, status: "consumed", binding_id: grant.binding_id, verification_job_id: lookup.verification_job_id,
    verification_attempt_id: grant.verification_attempt_id, result_object_key: expected.objects.result.object_key,
    result_sha256: expected.objects.result.sha256, presentation_id: expected.objects.presentation.sha256,
    used_at: new Date(850).toISOString(), archive_catalog_created_at: new Date(900).toISOString() };
  const snapshots = Object.values(expected.objects).map(({ backend_id, capture_id, ...o }) => ({ ...o, byte_length: f.saved.get(o.role).length }));
  const consumed = { record, bytes: Uint8Array.from(f.saved.get("result")), verifier_execution_receipt_bytes: Buffer.from("synthetic execution receipt") };
  consumed.archive_catalog = await createConsumedArchiveCatalog(record, snapshots, consumed.bytes, consumed.verifier_execution_receipt_bytes);
  const authority = { getConsumedVerificationResult: async () => structuredClone(consumed) };
  const httpDependencies = { getToken: async () => "synthetic.synthetic.synthetic", fetchArchive: async (url, init) => {
    if (url !== endpoint || init.redirect !== "error") throw new Error("unexpected mock transport");
    const request = JSON.parse(init.body);
    return new Response(archivePolicyBytes({ schema_version: 1, scope: "fusou-archive-http-response-v1",
      authorization: archiveAuthorization(policy, spec.policy_sha256, request), observed_at_ms: 1000,
      catalog: consumed.archive_catalog, bytes: encodeArchiveBytes(f.saved.get(request.role)) }),
    { headers: { "content-type": "application/json" } });
  } };
  f.checkPolicy.archive_transport = spec;
  const syncPolicy = () => Object.assign(f.options, { checkPolicyBytes: jsonBytes(f.checkPolicy), checkPolicySha256: sha256(jsonBytes(f.checkPolicy)) });
  syncPolicy();
  for (const check of ["archive_readback", "offline_verification"]) f.files.delete(`check-${check}.json`);
  f.report.evidence_production = (await collectReleaseEvidence({ report: f.report, identity,
    checkPolicyBytes: f.options.checkPolicyBytes, checkPolicySha256: f.options.checkPolicySha256 }, { httpEnabled: false })).report;
  f.files.set("release-report.json", jsonBytes(f.report));
  const origin = JSON.parse(f.files.get(EXECUTION_ORIGIN_FILE));
  origin.subject = executionSubject(f.report); delete origin.checks.archive_readback; delete origin.checks.offline_verification;
  f.files.set(EXECUTION_ORIGIN_FILE, jsonBytes(origin)); f.sync();
  const produced = await produceArchiveJob({ github: f.github, run: f.run, eligibility: f.eligibility, identity,
    checkPolicyBytes: f.options.checkPolicyBytes, checkPolicySha256: f.options.checkPolicySha256,
    publicBuildInputsSha256: f.options.publicBuildInputsSha256, downloadArchive: f.options.downloadArchive },
  { transport: f.dependencies.transport, httpDependencies, now: () => 1000 });
  let archiveRaw = produced.transport;
  const metadata = { ...f.metadata(), id: 51, name: `fusou-archive-${f.run.id}-${f.run.run_attempt}` };
  const sync = () => {
    metadata.size_in_bytes = archiveRaw.length; metadata.digest = `sha256:${createHash("sha256").update(archiveRaw).digest("hex")}`;
  };
  sync();
  f.github.rest.actions.listWorkflowRunArtifacts = async ({ name }) => ({ data: { total_count: 1, artifacts: [name === metadata.name ? metadata : f.metadata()] } });
  f.github.rest.actions.getArtifact = async ({ artifact_id }) => ({ data: artifact_id === metadata.id ? metadata : f.metadata() });
  const primaryDownload = f.options.downloadArchive;
  f.options.downloadArchive = async (id) => id === metadata.id ? archiveRaw : primaryDownload(id);
  const { grants, ...template } = policy;
  const providerConfig = { schema_version: 1, scope: "fusou-release-grant-provider-v1", template,
    grant_ttl_ms: 10_000, capture_not_before_ms: 0, capture_max_age_ms: 50_000,
    subject: { canonical_user_id: lookup.canonical_user_id, device_id: lookup.device_id } };
  return { f, identity, spec, authority, consumed, metadata, produced, providerConfig, syncPolicy, httpDependencies,
    replaceArchive(files) { archiveRaw = encodeReleaseTransport(files); sync(); } };
}
