import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { sha256, MAX_RELEASE_RECORD_BYTES } from "./release-bytes.mjs";

const proofs = new WeakMap();
export const producerArtifactName = (runId, attempt) => `fusou-release-${runId}-${attempt}`;
export const producerWorkflow = ".github/workflows/tlsn-release-eligibility.yml";
export function requireRelease(condition, reason) {
  if (!condition) throw new Error(`release consumer: ${reason}`);
}
export function parseReleaseRecord(bytes) {
  requireRelease(bytes instanceof Uint8Array && bytes.byteLength <= MAX_RELEASE_RECORD_BYTES, "record bytes/size");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const value = JSON.parse(text);
  requireRelease(canonicalJson(value) === text, "noncanonical/duplicate record");
  return value;
}
export function assertProducerRun(run, runId, attempt) {
  requireRelease(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(attempt) && attempt > 0 &&
    run?.id === runId && run.run_attempt === attempt && run.event === "workflow_run" &&
    run.path === producerWorkflow && run.head_branch === "main" && /^[0-9a-f]{40}$/.test(run.head_sha) &&
    run.repository?.full_name === "tsukasa-u/FUSOU" && run.head_repository?.full_name === "tsukasa-u/FUSOU" &&
    Number.isSafeInteger(run.repository.id) && run.repository.id > 0 && run.head_repository.id === run.repository.id &&
    run.status === "completed" && run.conclusion === "success", "producer run identity/attempt/status");
}
export function assertAppBuildRecordBinding(record, { sourceSha, workerVersionId, artifactBytes }) {
  requireRelease(record?.schema_version === 3 && record.scope === "fusou-tlsn-app-operator-build-record" &&
    record.app_source_sha === sourceSha && record.worker_source_sha === sourceSha &&
    record.active_version_id === workerVersionId && record.artifact?.sha256 === sha256(artifactBytes) &&
    record.artifact.byte_length === artifactBytes.byteLength && record.compiled_input_comparison === "VERIFIED" &&
    record.runtime_config_bootstrap_comparison === "VERIFIED" && record.public_app_configuration_comparison === "VERIFIED" &&
    record.authority_status === "UNVERIFIED", "detailed APP record/source/Worker/output binding");
}
export function verifyProducerBuild({ run, origin, files, eligibility }) {
  assertProducerRun(run, run.id, run.run_attempt);
  requireRelease(origin?.run_id === run.id && origin.name === producerArtifactName(run.id, run.run_attempt) &&
    origin.workflow_sha === run.head_sha && Number.isSafeInteger(origin.id) && origin.id > 0 &&
    /^sha256:[0-9a-f]{64}$/.test(origin.digest), "artifact API origin");
  const report = parseReleaseRecord(files.get("release-report.json"));
  requireRelease(report.schema_version === 2 && report.status === "PRODUCTION_ELIGIBLE" &&
    report.commit_sha === eligibility.commit_sha && report.tag === eligibility.tag &&
    report.validation_run_id === eligibility.validation_run_id &&
    report.validation_run_attempt === eligibility.validation_run_attempt &&
    report.coordinator_sha === run.head_sha &&
    isDeepStrictEqual(report.eligibility_run, { run_id: run.id, run_attempt: run.run_attempt, coordinator_sha: run.head_sha }),
  "producer report/tag/validation identity");
  requireRelease(report.build?.status === "BUILD_OUTPUTS_GENERATED" &&
    report.build.source_sha === eligibility.commit_sha &&
    Array.isArray(report.build.artifacts) && report.build.artifacts.length > 0, "build was not generated");
  const artifacts = [], buildProofs = new Map(), artifactBytes = new Map(), buildRecords = new Map(), evidenceBytes = new Map();
  for (const claim of report.build.artifacts) {
    requireRelease(["app", "worker"].includes(claim.role) && !buildProofs.has(claim.name), "duplicate/unknown producer artifact");
    const raw = files.get(claim.file), provenanceRaw = files.get(claim.provenance_file), inputRaw = files.get(claim.build_record_file);
    requireRelease(raw instanceof Uint8Array && raw.byteLength > 0 && inputRaw instanceof Uint8Array, "missing build output/record");
    const p = parseReleaseRecord(provenanceRaw), record = parseReleaseRecord(inputRaw);
    const context = { source_sha: eligibility.commit_sha, platform: claim.platform,
      run_id: run.id, run_attempt: run.run_attempt, workflow_sha: run.head_sha };
    requireRelease(Object.entries(context).every(([k, v]) => p[k] === v && record[k] === v) &&
      p.schema_version === 1 && p.scope === "fusou-release-build-provenance-v1" &&
      record.schema_version === 1 && record.scope === "fusou-release-artifact-build-record-v1" &&
      p.artifact_sha256 === sha256(raw) && p.input_record_sha256 === sha256(inputRaw) &&
      record.artifact_sha256 === sha256(raw) && record.byte_length === raw.byteLength &&
      claim.sha256 === sha256(raw) && claim.byte_length === raw.byteLength &&
      claim.build_record_sha256 === sha256(inputRaw) && claim.provenance_sha256 === sha256(provenanceRaw),
    "build output/provenance/source/platform/run mismatch");
    requireRelease(record.worker_version_id === report.build.worker_version_id, "build Worker version mismatch");
    if (claim.role === "app") assertAppBuildRecordBinding(record.details, {
      sourceSha: eligibility.commit_sha, workerVersionId: record.worker_version_id, artifactBytes: raw,
    });
    const artifact = { name: claim.name, role: claim.role, platform: claim.platform,
      sha256: sha256(raw), byte_length: raw.byteLength, source_sha: eligibility.commit_sha,
      build_run_id: run.id, build_run_attempt: run.run_attempt, build_workflow_sha: run.head_sha,
      build_record_sha256: sha256(provenanceRaw) };
    const proof = Object.freeze({ status: "BUILD_OUTPUTS_VERIFIED", artifact_id: origin.id });
    proofs.set(proof, { ...artifact });
    artifacts.push(artifact); buildProofs.set(claim.name, proof);
    artifactBytes.set(claim.name, Buffer.from(raw)); buildRecords.set(claim.name, Buffer.from(provenanceRaw));
    evidenceBytes.set(sha256(inputRaw), Buffer.from(inputRaw));
  }
  return { report, artifacts, buildProofs, artifactBytes, buildRecords, evidenceBytes };
}
export function assertArtifactBuildProof(proof, artifact) {
  requireRelease(proof && isDeepStrictEqual(proofs.get(proof), artifact), "missing/mismatched actual build proof");
}
