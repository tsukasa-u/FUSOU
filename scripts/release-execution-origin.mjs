import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { sha256 } from "./release-bytes.mjs";
import { parseReleaseRecord, producerWorkflow, requireRelease } from "./release-build-proof.mjs";
import { assertLocalBuildCheckExecution } from "./release-build.mjs";
import { assertLocalCapturedExecution } from "./release-checks.mjs";

export const EXECUTION_ORIGIN_FILE = "release-execution-origin.json";
export function executionSubject(report) {
  requireRelease(/^[A-Za-z0-9_-]{43}$/.test(report.build.public_inputs_sha256 ?? "") &&
    /^[0-9a-f]{40}$/.test(report.commit_sha ?? ""), "execution subject release source/input digest");
  return { repository: "tsukasa-u/FUSOU", source_sha: report.commit_sha, tag: report.tag,
    validation_run_id: report.validation_run_id, validation_run_attempt: report.validation_run_attempt,
    public_build_inputs_sha256: report.build.public_inputs_sha256,
    report_sha256: sha256(Buffer.from(canonicalJson(report))) };
}
export function executionDescriptor(recordRaw, receiptRaw) {
  const receipt = parseReleaseRecord(receiptRaw);
  return { record_sha256: sha256(recordRaw), receipt_sha256: sha256(receiptRaw), input_sha256: receipt.input_sha256 };
}
export function createProducerExecutionOrigin({ report, files, context, executionProofs = {} }) {
  requireRelease(context?.repository === "tsukasa-u/FUSOU" && context.source_sha === report.commit_sha &&
    context.run_id === report.eligibility_run?.run_id && context.run_attempt === report.eligibility_run.run_attempt &&
    context.workflow_sha === report.coordinator_sha, "execution origin producer context");
  const checks = {}, unattested = [];
  for (const check of ["locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"]) {
    const raw = files.get(`check-${check}.json`);
    if (!raw) continue;
    const record = parseReleaseRecord(raw), receiptRaw = files.get(`evidence-${record.evidence_sha256}.bin`);
    const receipt = parseReleaseRecord(receiptRaw);
    requireRelease(record.check === check && record.evidence_sha256 === sha256(receiptRaw) &&
      Object.entries(context).every(([key, value]) => receipt[key] === value), "execution origin receipt context");
    const inputs = new Map(Object.entries(receipt.inputs).map(([name, d]) => {
      const bytes = files.get(`evidence-${d.sha256}.bin`);
      requireRelease(bytes instanceof Uint8Array && sha256(bytes) === d.sha256 && bytes.length === d.byte_length,
        "execution origin required raw input");
      return [name, bytes];
    }));
    const proof = ["locked_dependencies", "compiled_inputs"].includes(check) ?
      report.build.executionProof : executionProofs[check];
    if (!proof) { unattested.push(check); continue; }
    if (["locked_dependencies", "compiled_inputs"].includes(check)) {
      assertLocalBuildCheckExecution(proof, { build: report.build, check, recordRaw: raw, receiptRaw });
    } else assertLocalCapturedExecution(proof, { check, receipt, inputs });
    checks[check] = executionDescriptor(raw, receiptRaw);
  }
  return Buffer.from(canonicalJson({ schema_version: 1, scope: "fusou-release-execution-origin-v1",
    issuer: { kind: "github-actions-artifact", repository: context.repository, workflow_path: producerWorkflow,
      run_id: context.run_id, run_attempt: context.run_attempt, workflow_sha: context.workflow_sha },
    subject: executionSubject(report), checks, unattested_checks: unattested }));
}
