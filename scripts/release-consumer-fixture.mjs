// Synthetic data and mock APIs only. Nothing here represents an executable bundle or a signed envelope.
import { createHash } from "node:crypto";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { sha256 } from "./release-bytes.mjs";
import { encodeReleaseTransport, decodeReleaseTransport } from "./release-transport.mjs";
import { producerArtifactName } from "./release-build-proof.mjs";

export const recordBytes = (value) => Buffer.from(canonicalJson(value));
export function consumerFixture({ includeWorker = true } = {}) {
  const commit = "a".repeat(40), coordinator = "b".repeat(40), version = "11111111-1111-1111-1111-111111111111";
  const repository = { id: 7, full_name: "tsukasa-u/FUSOU" };
  const run = { id: 30, run_attempt: 1, repository, head_repository: repository, event: "workflow_run",
    path: ".github/workflows/tlsn-release-eligibility.yml", head_branch: "main", head_sha: coordinator,
    status: "completed", conclusion: "success" };
  const eligibility = { schema_version: 2, status: "PRODUCTION_ELIGIBLE", tag: "fusou-v0.6.0", commit_sha: commit,
    validation_run_id: 10, validation_run_attempt: 1, validation_workflow_blob_sha: coordinator, coordinator_sha: coordinator };
  const files = new Map(), claims = [];
  for (const role of includeWorker ? ["app", "worker"] : ["app"]) {
    const platform = role === "app" ? "linux-x86_64" : "cloudflare-workers", raw = Buffer.from(`synthetic ${role} bytes`);
    const context = { source_sha: commit, platform, run_id: 30, run_attempt: 1, workflow_sha: coordinator };
    const detail = recordBytes({ schema_version: 1, scope: "fusou-release-artifact-build-record-v1", ...context,
      artifact_sha256: sha256(raw), byte_length: raw.length, worker_version_id: version,
      details: role === "app" ? {
        schema_version: 3, scope: "fusou-tlsn-app-operator-build-record",
        app_source_sha: commit, worker_source_sha: commit, active_version_id: version,
        artifact: { sha256: sha256(raw), byte_length: raw.length }, authority_status: "UNVERIFIED",
        compiled_input_comparison: "VERIFIED", runtime_config_bootstrap_comparison: "VERIFIED",
        public_app_configuration_comparison: "VERIFIED",
      } : { synthetic: true } });
    const provenance = recordBytes({ schema_version: 1, scope: "fusou-release-build-provenance-v1",
      ...context, artifact_sha256: sha256(raw), input_record_sha256: sha256(detail) });
    const claim = { name: role, role, platform, file: `${role}.bin`, build_record_file: `${role}-record.json`,
      provenance_file: `${role}-provenance.json`, sha256: sha256(raw), byte_length: raw.length,
      build_record_sha256: sha256(detail), provenance_sha256: sha256(provenance) };
    files.set(claim.file, raw); files.set(claim.build_record_file, detail); files.set(claim.provenance_file, provenance);
    claims.push(claim);
  }
  const report = { ...eligibility, eligibility_run: { run_id: 30, run_attempt: 1, coordinator_sha: coordinator },
    build: { status: "BUILD_OUTPUTS_GENERATED", source_sha: commit, worker_version_id: version, artifacts: claims } };
  files.set("release-report.json", recordBytes(report));
  for (const check of ["locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"]) {
    const evidence = Buffer.from(`synthetic ${check} evidence`), hash = sha256(evidence);
    files.set(`evidence-${hash}.bin`, evidence);
    files.set(`check-${check}.json`, recordBytes({ schema_version: 1, scope: "fusou-release-check-v1", check,
      status: "PASS", source_sha: commit, run_id: 30, run_attempt: 1, workflow_sha: coordinator, evidence_sha256: hash }));
  }
  const raw = (label) => Buffer.from(label);
  const independent = { origin_inventory_raw: raw("synthetic inventory"), target_approval_raw: raw("synthetic approval"),
    security_registry_set_raw: recordBytes({ notary_registry: { notary: "synthetic public reference" } }),
    worker_reference_raw: raw("synthetic Worker reference"), result_registry_envelope_raw: raw("synthetic registry envelope"), pins: {} };
  const resultRegistry = canonicalJson({ result: "synthetic public reference" });
  const payload = { epoch: "1", source: { worker_git_commit_sha: commit, active_version_id: version, script_name: "fusou-verifier" },
    production_authority_pins: { origin_inventory_sha256: sha256(independent.origin_inventory_raw),
      target_approval_artifact_sha256: sha256(independent.target_approval_raw),
      security_registry_set_sha256: sha256(independent.security_registry_set_raw) },
    result_registry_pins: { result_registry_sha256: sha256(Buffer.from(resultRegistry)) },
    compile_inputs: { FUSOU_TLSN_RESULT_SIGNER_KEY_ID: "result", FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID: "authority",
      FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY: resultRegistry } };
  const publicInput = { schema_version: 1, scope: "fusou-release-consumer-inputs-v1", required_app_platforms: ["linux-x86_64"],
    runtime_envelope: raw("synthetic envelope, not signed").toString("base64url"),
    verification: { trustedSigner: { key_id: "runtime", public_key_spki: raw("not a real DER key").toString("base64url") },
      policy: { last_accepted_epoch: "0" }, independentInputs: Object.fromEntries(Object.entries(independent).map(
        ([key, value]) => [key, Buffer.isBuffer(value) ? value.toString("base64url") : value])) } };
  let tagSha = commit, archive, metadata;
  const sync = () => {
    archive = encodeReleaseTransport(files);
    metadata = { id: 50, name: producerArtifactName(30, 1), expired: false, size_in_bytes: archive.length,
      digest: `sha256:${createHash("sha256").update(archive).digest("hex")}`,
      workflow_run: { id: 30, repository_id: 7, head_repository_id: 7, head_branch: "main", head_sha: coordinator } };
  };
  sync();
  const github = { rest: {
    actions: {
      getWorkflowRun: async ({ run_id }) => ({ data: run_id === 30 ? run : { ...run, id: 10, event: "push",
        path: ".github/workflows/tlsn-tag-validation.yml", head_branch: eligibility.tag, head_sha: commit } }),
      listWorkflowRunArtifacts: async () => ({ data: { total_count: 1, artifacts: [metadata] } }),
      getArtifact: async () => ({ data: metadata }),
    },
    repos: {
      getBranch: async () => ({ data: { commit: { sha: coordinator } } }),
      compareCommitsWithBasehead: async ({ basehead }) => ({ data: {
        status: "ahead", merge_base_commit: { sha: basehead.split("...")[0] } } }),
      getContent: async () => ({ data: { type: "file", sha: coordinator } }),
    },
    git: { getRef: async () => ({ data: { object: { type: "commit", sha: tagSha } } }) },
  } };
  return { run, eligibility, files, report, github, publicInput, payload, sync, metadata: () => metadata,
    moveTag: () => { tagSha = coordinator; },
    options: { github, runId: 30, runAttempt: 1, trustedSha: coordinator,
      downloadArchive: async () => archive, publicInputsBytes: recordBytes(publicInput), publicInputsSha256: sha256(recordBytes(publicInput)) },
    dependencies: { transport: { readArchive: async (data) => decodeReleaseTransport(data) },
      verifyRuntimeEnvelope: async () => ({ state: "MANIFEST_AND_SIGNED_PINS_VERIFIED", payload }),
      verifyCheckEvidence: async () => undefined },
  };
}
