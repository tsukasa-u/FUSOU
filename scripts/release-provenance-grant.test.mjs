// Key-free contract tests: all API/authority/OIDC results are explicit doubles; no external calls.
import test from "node:test";
import assert from "node:assert/strict";
import { provenanceFixture } from "./release-provenance-fixture.mjs";
import { acquireReleaseTransport, decodeReleaseTransport } from "./release-transport.mjs";
import { reauthenticateSavedArchive } from "./release-archive-provenance.mjs";
import { deriveArchiveGrant } from "./release-grant-provider.mjs";
import { produceArchiveJob } from "./release-archive-job.mjs";
import { collectReleaseEvidence } from "./release-evidence-producer.mjs";
import { consumeReleaseRun } from "./release-consumer.mjs";
import { executionSubject } from "./release-execution-origin.mjs";
import { jsonBytes } from "./release-checks.mjs";
import { archivePolicyBytes, archiveTransportGrant } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs";
import { handleArchiveHttp } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs";
import { sha256 } from "./release-bytes.mjs";

function savedOptions(t) {
  const files = decodeReleaseTransport(t.produced.transport), record = JSON.parse(files.get("check-archive_readback.json"));
  const receipt = JSON.parse(files.get(`evidence-${record.evidence_sha256}.bin`));
  return { ...t.f.options, expected: { verification_mode: "GITHUB_API_REACQUISITION", repository: "tsukasa-u/FUSOU", repository_id: 7,
    workflow_sha: t.f.run.head_sha, trusted_sha: t.f.options.trustedSha, source_sha: t.f.eligibility.commit_sha,
    run_id: t.f.run.id, run_attempt: t.f.run.run_attempt, validation_run_id: t.f.eligibility.validation_run_id,
    validation_run_attempt: t.f.eligibility.validation_run_attempt },
  savedInputs: new Map(Object.entries(receipt.inputs).map(([name, d]) => [name, files.get(`evidence-${d.sha256}.bin`)])) };
}
function enableProvider(t) {
  delete t.f.checkPolicy.archive_transport;
  t.f.checkPolicy.grant_provider = structuredClone(t.providerConfig); t.syncPolicy();
  t.f.report.evidence_production.check_policy_sha256 = t.f.options.checkPolicySha256;
  t.f.files.set("release-report.json", jsonBytes(t.f.report));
  const origin = JSON.parse(t.f.files.get("release-execution-origin.json")); origin.subject = executionSubject(t.f.report);
  t.f.files.set("release-execution-origin.json", jsonBytes(origin)); t.f.sync();
}
async function grantOptions(t) {
  const downloaded = await acquireReleaseTransport({ github: t.f.github, run: t.f.run,
    downloadArchive: t.f.options.downloadArchive, ...t.f.dependencies.transport });
  return { github: t.f.github, run: t.f.run, trustedSha: t.f.options.trustedSha, downloaded,
    checkPolicyBytes: t.f.options.checkPolicyBytes, checkPolicySha256: t.f.options.checkPolicySha256,
    publicBuildInputsSha256: t.f.options.publicBuildInputsSha256 };
}

test("saved raw evidence is reauthenticated by fresh independent GitHub reacquisition, not its stored authenticated label", async () => {
  const t = await provenanceFixture(), options = savedOptions(t);
  const result = await reauthenticateSavedArchive(options, { transport: t.f.dependencies.transport });
  assert.equal(result.verification_mode, "GITHUB_API_REACQUISITION");
  assert.equal(result.offline_signature_verification, "NOT_IMPLEMENTED");
  assert.equal(result.archive_artifact.id, t.metadata.id);
  assert.equal(result.consumer_native_crypto_reexecution, "NOT_CHECKED");
  const consumer = await consumeReleaseRun(t.f.options, { transport: t.f.dependencies.transport,
    verifyRuntimeEnvelope: t.f.dependencies.verifyRuntimeEnvelope });
  assert.equal(consumer.archive_acquisition_status, "AUTHENTICATED_PRODUCER_REPORT_VERIFIED");
  assert.deepEqual(consumer.archive_provenance, result);
  assert.equal(consumer.publication_authorized, false); assert.equal(consumer.production_acceptance, "BLOCKED");
  assert.deepEqual(consumer.blockers, ["FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED"]);
});
for (const field of ["repository_id", "workflow_sha", "source_sha", "run_id", "run_attempt", "validation_run_attempt"]) {
  test(`saved report cannot supply its own independent ${field} expectation`, async () => {
    const t = await provenanceFixture(), options = savedOptions(t);
    options.expected[field] = typeof options.expected[field] === "number" ? 99 : "e".repeat(40);
    await assert.rejects(reauthenticateSavedArchive(options, { transport: t.f.dependencies.transport }),
      /run|workflow|release|identity/);
  });
}
for (const field of ["workflow_path", "run_id", "run_attempt", "workflow_sha"]) {
  test(`correct raw report bytes with wrong origin issuer ${field} are not authenticated`, async () => {
    const t = await provenanceFixture(), options = savedOptions(t), files = decodeReleaseTransport(t.produced.transport);
    const seal = JSON.parse(files.get("release-execution-origin.json"));
    seal.issuer[field] = typeof seal.issuer[field] === "number" ? 99 : "untrusted";
    files.set("release-execution-origin.json", jsonBytes(seal)); t.replaceArchive(files);
    await assert.rejects(reauthenticateSavedArchive(options, { transport: t.f.dependencies.transport }), /issuer\/subject/);
  });
}
test("correct issuer does not make tampered saved raw bytes, input inventory or API archive digest acceptable", async () => {
  const t = await provenanceFixture();
  for (const mutation of ["bytes", "missing"]) {
    const options = savedOptions(t);
    if (mutation === "bytes") options.savedInputs.set("readback_result", Buffer.from("changed raw archive"));
    else options.savedInputs.delete("http_result");
    await assert.rejects(reauthenticateSavedArchive(options, { transport: t.f.dependencies.transport }), /saved archive bytes/);
  }
  t.metadata.digest = `sha256:${"f".repeat(64)}`;
  await assert.rejects(reauthenticateSavedArchive(savedOptions(t), { transport: t.f.dependencies.transport }), /archive digest mismatch/);
});
for (const field of ["capture_id", "session_id", "job_id", "binding_id", "verification_attempt_id"]) {
  test(`independent pinned capture ${field} defeats authentic producer evidence for another target`, async () => {
    const t = await provenanceFixture(), options = savedOptions(t), policy = structuredClone(t.f.checkPolicy);
    policy.archive.objects.result[field] = "foreign";
    options.checkPolicyBytes = jsonBytes(policy); options.checkPolicySha256 = sha256(options.checkPolicyBytes);
    await assert.rejects(reauthenticateSavedArchive(options, { transport: t.f.dependencies.transport }),
      /archive|CATALOG|policy/);
  });
}
test("unregistered attestations, including wrong subject/signer, cannot replace online authentication", async () => {
  for (const attestation of [{ subject_digest: "wrong", signer_workflow: "trusted-looking" },
    { subject_digest: "correct-looking", signer_workflow: "attacker" }]) {
    await assert.rejects(reauthenticateSavedArchive({ expected: { verification_mode: "GITHUB_ARTIFACT_ATTESTATION", attestation } }),
      /PROVENANCE_MODE_NOT_REGISTERED/);
  }
  await assert.rejects(reauthenticateSavedArchive({ expected: { verification_mode: "GITHUB_API_REACQUISITION", authenticated: true } }),
    /REACQUISITION_NOT_CONFIGURED/);
});
test("authenticated artifact availability or trusted implementation changes invalidate later provenance rechecks", async () => {
  const t = await provenanceFixture(), options = savedOptions(t);
  t.metadata.expired = true;
  await assert.rejects(reauthenticateSavedArchive(options, { transport: t.f.dependencies.transport }), /artifact API metadata/);
  t.metadata.expired = false;
  const get = t.f.github.rest.repos.getContent;
  t.f.github.rest.repos.getContent = async (p) => p.path === "scripts/release-archive-provenance.mjs" && p.ref === t.f.run.head_sha ?
    { data: { type: "file", sha: "f".repeat(40) } } : get(p);
  options.expected.trusted_sha = "c".repeat(40);
  await assert.rejects(reauthenticateSavedArchive(options, { transport: t.f.dependencies.transport }), /untrusted execution producer/);
});
test("compiler derives run/source/capture/digests from API, pinned inputs and authority, without any prior run grant", async () => {
  const t = await provenanceFixture(); enableProvider(t);
  const options = await grantOptions(t), deps = { authority: t.authority, now: () => 1000 };
  const a = await deriveArchiveGrant(options, deps), b = await deriveArchiveGrant(options, deps);
  assert.deepEqual(a, b);
  assert.equal(a.status, "DERIVED_NOT_AUTHORIZED"); assert.equal(a.publication_authorized, false);
  assert.equal(a.grant.run_id, t.f.run.id); assert.equal(a.grant.run_attempt, t.f.run.run_attempt);
  assert.equal(a.grant.source_sha, t.f.eligibility.commit_sha);
  assert.notEqual(a.grant.source_sha, a.grant.workflow_sha);
  assert.equal(a.grant.binding_id, t.consumed.record.binding_id);
  assert.equal(a.bindings.check_policy_sha256, t.f.options.checkPolicySha256);
  assert.equal(a.bindings.public_build_inputs_sha256, t.f.options.publicBuildInputsSha256);
  assert.equal(a.bindings.objects.result.version_id, t.consumed.archive_catalog.objects.result.version_id);
  assert.equal(a.bindings.result_envelope_sha256, t.consumed.record.result_sha256);
  assert.equal(a.authorization_status, "BLOCKED_IMPLEMENTATION");
  assert.equal(a.blocker, "ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED");
});
for (const mutation of ["authority absent", "self-asserted authority", "raw transport", "release source", "public input pin", "capture digest", "version", "subject"]) {
  test(`grant compiler rejects ${mutation} rather than reusing request self-claims`, async () => {
    const t = await provenanceFixture(); enableProvider(t);
    const options = await grantOptions(t), deps = { authority: t.authority, now: () => 1000 };
    if (mutation === "authority absent") delete deps.authority;
    if (mutation === "self-asserted authority") deps.authority = { authenticated: true, catalog: t.consumed.archive_catalog };
    if (mutation === "raw transport") options.downloaded = { ...options.downloaded, authenticationProof: { authenticated: true } };
    if (mutation === "public input pin") options.publicBuildInputsSha256 = "Q".repeat(43);
    const policy = structuredClone(t.f.checkPolicy);
    if (mutation === "release source") policy.source_sha = "e".repeat(40);
    if (mutation === "capture digest") policy.archive.objects.result.sha256 = "Z".repeat(43);
    if (mutation === "version") policy.archive.objects.result.version_id = "another-generation";
    if (mutation === "subject") policy.grant_provider.subject.device_id = "foreign-device";
    if (["release source", "capture digest", "version", "subject"].includes(mutation)) {
      options.checkPolicyBytes = jsonBytes(policy); options.checkPolicySha256 = sha256(options.checkPolicyBytes);
      t.f.report.evidence_production.check_policy_sha256 = options.checkPolicySha256;
      t.f.files.set("release-report.json", jsonBytes(t.f.report)); t.f.sync();
      options.downloaded = (await grantOptions(t)).downloaded;
    }
    await assert.rejects(deriveArchiveGrant(options, deps), /GRANT_AUTHORITY|transport|identity|generation\/digest|subject\/job/);
  });
}
test("independent run metadata denies another attempt and template identity, not just a matching self-reported source", async () => {
  const t = await provenanceFixture(); enableProvider(t);
  const options = await grantOptions(t), get = t.f.github.rest.actions.getWorkflowRun;
  t.f.github.rest.actions.getWorkflowRun = async (p) => p.run_id === t.f.run.id ?
    { data: { ...t.f.run, run_attempt: 2 } } : get(p);
  await assert.rejects(deriveArchiveGrant(options, { authority: t.authority, now: () => 1000 }), /independent GitHub run/);
});
test("new provider mode never falls back to static grants or emits successful checks before authenticated publication", async () => {
  const t = await provenanceFixture(); enableProvider(t);
  const args = { github: t.f.github, run: t.f.run, eligibility: t.f.eligibility, identity: t.identity,
    checkPolicyBytes: t.f.options.checkPolicyBytes, checkPolicySha256: t.f.options.checkPolicySha256,
    publicBuildInputsSha256: t.f.options.publicBuildInputsSha256, downloadArchive: t.f.options.downloadArchive };
  const missing = await produceArchiveJob(args, { transport: t.f.dependencies.transport, now: () => 1000 });
  assert.equal(missing.report.blocker, "ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED");
  const derived = await produceArchiveJob(args, { transport: t.f.dependencies.transport, grantAuthority: t.authority, now: () => 1000 });
  const files = decodeReleaseTransport(derived.transport);
  assert.equal(JSON.parse(files.get("archive-grant-candidate.json")).status, "DERIVED_NOT_AUTHORIZED");
  assert.equal(files.has("check-archive_readback.json"), false); assert.equal(files.has("release-execution-origin.json"), false);
  assert.equal(derived.report.blocker, "ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED");
  assert.equal(derived.report.offline_verification, "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED");
  assert.equal(derived.report.deployment_status, "NOT_CHECKED");
  assert.equal(derived.report.production_acceptance, "BLOCKED");
  const producer = await collectReleaseEvidence({ report: t.f.report, identity: t.identity,
    checkPolicyBytes: t.f.options.checkPolicyBytes, checkPolicySha256: t.f.options.checkPolicySha256 });
  assert.equal(producer.executions.size, 0);
  const consumer = await consumeReleaseRun(t.f.options, { transport: t.f.dependencies.transport,
    verifyRuntimeEnvelope: t.f.dependencies.verifyRuntimeEnvelope });
  assert.deepEqual(consumer.blockers, ["ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED"]);
  assert.equal(consumer.archive_acquisition_status, undefined);
  assert.equal(consumer.publication_authorized, false); assert.equal(consumer.production_acceptance, "BLOCKED");
});
test("saved-byte verifier also refuses static-grant fallback when dynamic grant publication is unregistered", async () => {
  const t = await provenanceFixture(), options = savedOptions(t), policy = structuredClone(t.f.checkPolicy);
  policy.grant_provider = t.providerConfig;
  options.checkPolicyBytes = jsonBytes(policy); options.checkPolicySha256 = sha256(options.checkPolicyBytes);
  await assert.rejects(reauthenticateSavedArchive(options, { transport: t.f.dependencies.transport }),
    /ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED/);
});
for (const mutation of ["expired", "not yet valid", "unknown capture", "another run", "another attempt", "workflow SHA as source SHA"]) {
  test(`an independently pinned grant cannot be replayed with ${mutation}`, async () => {
    const t = await provenanceFixture(), policy = structuredClone(t.spec.policy), g = policy.grants[0];
    const request = { source_sha: g.source_sha, workflow_sha: g.workflow_sha, run_id: g.run_id, run_attempt: g.run_attempt,
      capture_id: g.capture_id, session_id: g.lookup.session_id, job_id: g.lookup.verification_job_id,
      verification_attempt_id: g.verification_attempt_id, binding_id: g.binding_id, role: "result" };
    if (mutation === "expired") g.expires_at_ms = 1000;
    if (mutation === "not yet valid") g.not_before_ms = 1001;
    if (mutation === "unknown capture") request.capture_id = "unknown";
    if (mutation === "another run") request.run_id++;
    if (mutation === "another attempt") request.run_attempt++;
    if (mutation === "workflow SHA as source SHA") request.source_sha = g.workflow_sha;
    assert.throws(() => archiveTransportGrant(policy, request, 1000), /ARCHIVE_HTTP_GRANT_MISSING_OR_EXPIRED/);
  });
}
test("accepted OIDC adapter output cannot replace an independent release/run grant", async () => {
  const t = await provenanceFixture(), policy = structuredClone(t.spec.policy);
  policy.grants[0].run_attempt = 99;
  let verified = 0, reads = 0;
  const request = { source_sha: t.f.context.source_sha, workflow_sha: t.f.context.workflow_sha, run_id: t.f.run.id,
    run_attempt: t.f.run.run_attempt, capture_id: t.consumed.record.binding_id, session_id: t.consumed.record.session_id,
    job_id: t.consumed.record.verification_job_id, verification_attempt_id: t.consumed.record.verification_attempt_id,
    binding_id: t.consumed.record.binding_id, role: "result" };
  const response = await handleArchiveHttp(new Request(policy.endpoint, { method: "POST", headers: {
    authorization: "Bearer synthetic.synthetic.synthetic", "content-type": "application/json" }, body: JSON.stringify(request) }),
  { policyRaw: new TextDecoder().decode(archivePolicyBytes(policy)), policySha256: sha256(archivePolicyBytes(policy)),
    authority: t.authority, bucket: { get: async () => { reads++; throw new Error("must not read"); } } },
  { now: () => 1000, verifyToken: async () => { verified++; return { workflow_sha: t.f.run.head_sha,
    run_id: String(t.f.run.id), run_attempt: String(t.f.run.run_attempt) }; } });
  assert.equal(verified, 1); assert.equal(response.status, 403); assert.equal(reads, 0);
});
test("expired capture, missing authority Result, or forged retention cannot become an authorization candidate", async () => {
  for (const mutation of ["expired capture", "missing Result", "retention"]) {
    const t = await provenanceFixture(); enableProvider(t);
    if (mutation === "missing Result") t.consumed.bytes = new Uint8Array();
    if (mutation === "retention") t.consumed.archive_catalog.retention_status = "VERIFIED";
    await assert.rejects(deriveArchiveGrant(await grantOptions(t), {
      authority: t.authority, now: () => mutation === "expired capture" ? 100_000 : 1000,
    }), /FRESHNESS|consumed authority Result|catalog\/authority mismatch/);
  }
});
test("raw bytes with an authentic issuer still require the raw response/catalog digest contract", async () => {
  const t = await provenanceFixture(), options = savedOptions(t), files = decodeReleaseTransport(t.produced.transport);
  const record = JSON.parse(files.get("check-archive_readback.json"));
  const receipt = JSON.parse(files.get(`evidence-${record.evidence_sha256}.bin`));
  const rawName = `evidence-${receipt.inputs.http_result.sha256}.bin`;
  const response = JSON.parse(files.get(rawName)); response.bytes = "Zm9yZ2Vk";
  const raw = archivePolicyBytes(response);
  files.delete(rawName); files.set(`evidence-${sha256(raw)}.bin`, raw);
  receipt.inputs.http_result = { sha256: sha256(raw), byte_length: raw.length };
  receipt.input_sha256 = sha256(jsonBytes(receipt.inputs));
  receipt.output.transport.responses_sha256.result = sha256(raw);
  const receiptRaw = jsonBytes(receipt);
  files.set(`evidence-${sha256(receiptRaw)}.bin`, receiptRaw);
  record.evidence_sha256 = sha256(receiptRaw); const recordRaw = jsonBytes(record); files.set("check-archive_readback.json", recordRaw);
  t.replaceArchive(files);
  await assert.rejects(reauthenticateSavedArchive(options, { transport: t.f.dependencies.transport }), /RAW_BYTES_MISMATCH/);
});
