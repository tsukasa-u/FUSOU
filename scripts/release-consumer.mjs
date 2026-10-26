import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { evaluateReleaseRun, TAG_WORKFLOW_PATH } from "./release-eligibility.mjs";
import { assertProducerRun, verifyProducerBuild, parseReleaseRecord, requireRelease, producerWorkflow } from "./release-build-proof.mjs";
import { acquireReleaseTransport, ReleaseBlocked } from "./release-transport.mjs";
import { sha256, encodeReleaseManifest, validateReleaseManifest, assertReleaseRuntimeConfigBinding } from "./release-manifest.mjs";
import { checkContext, verifyReleaseChecks } from "./release-checks.mjs";
import { createCrossRunExecutionIntake } from "./release-execution-intake.mjs";
import { EVIDENCE_PRODUCTION_SCOPE, EVIDENCE_IMPLEMENTATION_BLOCKERS } from "./release-evidence-producer.mjs";

const repository = { owner: "tsukasa-u", repo: "FUSOU" };
const checks = ["locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"];
const bytes = (value) => {
  requireRelease(typeof value === "string", "independent public bytes missing");
  const raw = Buffer.from(value, "base64url");
  requireRelease(raw.toString("base64url") === value, "independent public bytes encoding");
  return raw;
};
async function verifyRuntime(raw, verification) {
  const { verifyTlsnRuntimeConfigProductionEnvelope } = await import(
    "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest.mjs");
  return verifyTlsnRuntimeConfigProductionEnvelope(raw, verification);
}
export function parseConsumerInputs(raw, pin, nowMs = Date.now()) {
  if (raw === undefined || !pin) throw new ReleaseBlocked("PINNED_INDEPENDENT_CONSUMER_INPUTS_MISSING");
  requireRelease(sha256(raw) === pin, "independent consumer input digest mismatch");
  const input = parseReleaseRecord(raw);
  requireRelease(input.schema_version === 1 && input.scope === "fusou-release-consumer-inputs-v1" &&
    Object.keys(input).sort().join() === "required_app_platforms,runtime_envelope,schema_version,scope,verification" &&
    Array.isArray(input.required_app_platforms) && input.required_app_platforms.length > 0 &&
    new Set(input.required_app_platforms).size === input.required_app_platforms.length, "consumer input schema");
  const verification = input.verification;
  requireRelease(verification?.policy && verification.independentInputs && Number.isSafeInteger(nowMs), "consumer verification policy");
  // Freshness is checked at consumer execution, never at a timestamp supplied by an artifact.
  verification.policy.now_ms = nowMs;
  for (const key of ["worker_reference_raw", "origin_inventory_raw", "target_approval_raw",
    "security_registry_set_raw", "result_registry_envelope_raw"]) {
    verification.independentInputs[key] = bytes(verification.independentInputs[key]);
  }
  return { ...input, runtime_envelope: bytes(input.runtime_envelope) };
}
function collectCheckEvidence({ eligibility, run, build, files }, { allowMissing = false } = {}) {
  const evidenceBytes = new Map(build.evidenceBytes);
  const add = (raw) => { const hash = sha256(raw); evidenceBytes.set(hash, Buffer.from(raw)); return hash; };
  for (const [name, raw] of files) {
    const match = /^evidence-([A-Za-z0-9_-]{43})\.bin$/.exec(name);
    if (match) {
      requireRelease(sha256(raw) === match[1], "check evidence raw filename/hash");
      add(raw);
    }
  }
  const records = {}, checkDigests = {};
  for (const key of checks) {
    const raw = files.get(`check-${key}.json`);
    if (!raw) {
      if (allowMissing) continue;
      // Producer diagnostics can explain a missing check, never authorize a successful one.
      const production = build.report.evidence_production, blocked = production?.checks?.[key];
      if (production?.schema_version === 1 && production.scope === EVIDENCE_PRODUCTION_SCOPE &&
        Object.entries(checkContext(run, eligibility.commit_sha)).every(([name, value]) => production[name] === value) &&
        blocked?.status === "BLOCKED_IMPLEMENTATION" && blocked.blocker === EVIDENCE_IMPLEMENTATION_BLOCKERS[key] &&
        typeof blocked.blocker === "string") {
        throw new ReleaseBlocked(blocked.blocker, "BLOCKED_IMPLEMENTATION");
      }
      throw new ReleaseBlocked("REQUIRED_RELEASE_CHECK_RECORDS_MISSING");
    }
    const record = parseReleaseRecord(raw);
    const evidence = files.get(`evidence-${record.evidence_sha256}.bin`);
    requireRelease(evidence instanceof Uint8Array && sha256(evidence) === record.evidence_sha256 &&
      record.check === key && record.status === "PASS" && record.source_sha === eligibility.commit_sha &&
      record.run_id === run.id && record.run_attempt === run.run_attempt && record.workflow_sha === run.head_sha,
    "check evidence source/run/readback");
    records[key] = record; checkDigests[key] = add(raw); add(evidence);
  }
  return { records, evidenceBytes, checkDigests, add };
}
export async function assembleReleaseManifest({ eligibility, run, build, files, inputs },
  { verifyRuntimeEnvelope = verifyRuntime, verifyCheckEvidence, checkVerification } = {}) {
  const workers = build.artifacts.filter((a) => a.role === "worker");
  if (workers.length !== 1) throw new ReleaseBlocked("ACTUAL_WORKER_BUNDLE_AND_BUILD_RECORD_MISSING", "BLOCKED_IMPLEMENTATION");
  const platforms = build.artifacts.filter((a) => a.role === "app").map((a) => a.platform).sort();
  requireRelease(canonicalJson(platforms) === canonicalJson([...inputs.required_app_platforms].sort()), "required APP platform inventory");
  const envelope = inputs.runtime_envelope, verification = inputs.verification;
  const verified = await verifyRuntimeEnvelope(envelope, verification), payload = verified.payload;
  requireRelease(verified.state === "MANIFEST_AND_SIGNED_PINS_VERIFIED", "Runtime Config verification incomplete");
  const independent = verification.independentInputs;
  const { records, evidenceBytes, checkDigests, add } = collectCheckEvidence({ eligibility, run, build, files });
  const security = JSON.parse(independent.security_registry_set_raw.toString("utf8"));
  // A PASS string and hash are not an offline-verifier or archive execution receipt.
  const verify = verifyCheckEvidence ?? ((args) => verifyReleaseChecks(args, checkVerification));
  const checkResult = await verify({ records, evidenceBytes, build, eligibility, inputs, payload, run });
  const expected = {
    schema_version: 1, scope: "fusou-release-manifest-v1",
    release: { repository: "tsukasa-u/FUSOU", tag: eligibility.tag, kind: "production",
      commit_sha: eligibility.commit_sha, app_version: eligibility.tag.slice("fusou-v".length) },
    validation: { run_id: eligibility.validation_run_id, run_attempt: eligibility.validation_run_attempt,
      workflow_path: TAG_WORKFLOW_PATH, workflow_blob_sha: eligibility.validation_workflow_blob_sha,
      source_sha: eligibility.commit_sha },
    eligibility: { run_id: run.id, run_attempt: run.run_attempt, coordinator_sha: run.head_sha, status: "PRODUCTION_ELIGIBLE" },
    artifacts: build.artifacts,
    worker: { name: payload.source.script_name, source_sha: eligibility.commit_sha,
      artifact_sha256: workers[0].sha256, version_id: payload.source.active_version_id },
    runtime_config: { schema_version: 2, epoch: payload.epoch, manifest_sha256: add(envelope),
      signer_key_id: verification.trustedSigner.key_id,
      trust_root_sha256: add(bytes(verification.trustedSigner.public_key_spki)) },
    registries: { result_signer_key_id: payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID,
      result_registry_sha256: add(Buffer.from(payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY)),
      notary_registry_sha256: add(Buffer.from(canonicalJson(security.notary_registry))),
      session_authority_key_id: payload.compile_inputs.FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID,
      security_registry_set_sha256: add(independent.security_registry_set_raw) },
    targets: { origin_inventory_sha256: add(independent.origin_inventory_raw),
      target_approval_artifact_sha256: add(independent.target_approval_raw) },
    checks: checkDigests, deployment: { status: "NOT_CHECKED" },
  };
  requireRelease(build.report.build.worker_version_id === expected.worker.version_id, "build/Runtime Config Worker version mismatch");
  assertReleaseRuntimeConfigBinding(expected, payload, envelope);
  const manifestBytes = encodeReleaseManifest(expected);
  if (files.has("release-manifest.json")) {
    requireRelease(Buffer.from(files.get("release-manifest.json")).equals(manifestBytes), "candidate manifest differs from independent assembly");
  }
  return { status: "MANIFEST_ASSEMBLED", manifestBytes, checkResult,
    observations: { expected, ...build, evidenceBytes, observedRuns: new Map([[`${run.id}:${run.run_attempt}`, run]]) } };
}
export async function consumeReleaseRun({ github, runId, runAttempt, trustedSha, downloadArchive,
  publicInputsBytes, publicInputsSha256, publicBuildInputsBytes, publicBuildInputsSha256,
  checkPolicyBytes, checkPolicySha256, nowMs }, dependencies = {}) {
  requireRelease(/^[0-9a-f]{40}$/.test(trustedSha), "trusted main SHA missing");
  const run = (await github.rest.actions.getWorkflowRun({ ...repository, run_id: runId })).data;
  assertProducerRun(run, runId, runAttempt);
  const mainSha = (await github.rest.repos.getBranch({ ...repository, branch: "main" })).data.commit?.sha;
  requireRelease(/^[0-9a-f]{40}$/.test(mainSha), "main SHA unavailable");
  const ancestry = (await github.rest.repos.compareCommitsWithBasehead({
    ...repository, basehead: `${run.head_sha}...${mainSha}`,
  })).data;
  requireRelease(["ahead", "identical"].includes(ancestry.status) &&
    ancestry.merge_base_commit?.sha === run.head_sha, "producer is not in main history");
  const workflows = await Promise.all([run.head_sha, trustedSha].map(async (ref) =>
    (await github.rest.repos.getContent({ ...repository, path: producerWorkflow, ref })).data));
  requireRelease(workflows.every((f) => f.type === "file" && /^[0-9a-f]{40}$/.test(f.sha)) &&
    workflows[0].sha === workflows[1].sha, "producer workflow differs from trusted consumer revision");
  const result = { schema_version: 1, status: "BLOCKED_EXTERNAL_INPUTS", tag_status: "NOT_CHECKED",
    build_status: "NOT_CHECKED", artifact_status: "NOT_CHECKED", signature_status: "NOT_CHECKED",
    deployment_status: "NOT_CHECKED", publication_authorized: false, production_acceptance: "BLOCKED", blockers: [] };
  let finalRecheck, executionIntake;
  try {
    const downloaded = await acquireReleaseTransport({ github, run, downloadArchive, ...dependencies.transport });
    result.transport = downloaded.origin;
    result.archive_byte_length = downloaded.archive_byte_length;
    const report = parseReleaseRecord(downloaded.files.get("release-report.json"));
    const evaluate = () => evaluateReleaseRun({ github, repository, runId: report.validation_run_id, trustedSha });
    const eligibility = await evaluate();
    if (eligibility.status === "DEVELOPMENT_VALIDATED" && report.status === eligibility.status &&
      report.tag === eligibility.tag && report.commit_sha === eligibility.commit_sha) {
      return { ...result, status: "NOT_APPLICABLE", tag_status: eligibility.status };
    }
    requireRelease(eligibility.status === "PRODUCTION_ELIGIBLE" && report.tag === eligibility.tag &&
      report.commit_sha === eligibility.commit_sha && report.validation_run_attempt === eligibility.validation_run_attempt,
    "coordinator/live eligibility mismatch");
    result.tag_status = eligibility.status; result.tag = eligibility.tag; result.commit_sha = eligibility.commit_sha;
    const recheck = async () => {
      const fresh = await evaluate();
      requireRelease(["tag", "commit_sha", "validation_run_attempt", "validation_workflow_blob_sha"].every(
        (key) => fresh[key] === eligibility[key]), "release changed during consumption");
      if (executionIntake) await executionIntake.recheck();
    };
    finalRecheck = recheck;
    if (report.build?.status === "BLOCKED_EXTERNAL_INPUTS") {
      await recheck();
      result.build_status = "BLOCKED_EXTERNAL_INPUTS";
      result.blockers.push("BUILD_OUTPUTS_NOT_GENERATED");
      return result;
    }
    const build = verifyProducerBuild({ run, ...downloaded, eligibility });
    executionIntake = createCrossRunExecutionIntake({ github, run, trustedSha, downloaded, eligibility, publicBuildInputsSha256, checkPolicySha256 });
    result.build_status = "BUILD_OUTPUTS_VERIFIED";
    if (!build.artifacts.some((a) => a.role === "worker")) {
      const blocked = build.report.build.worker_build;
      result.status = blocked?.status === "BLOCKED_EXTERNAL_INPUTS" ? "BLOCKED_EXTERNAL_INPUTS" : "BLOCKED_IMPLEMENTATION";
      result.blockers.push(...(blocked?.blockers?.length ? blocked.blockers : ["ACTUAL_WORKER_BUNDLE_AND_BUILD_RECORD_MISSING"]));
    }
    let inputs;
    if (!publicInputsBytes || !publicInputsSha256) result.blockers.push("PINNED_INDEPENDENT_CONSUMER_INPUTS_MISSING");
    else inputs = parseConsumerInputs(publicInputsBytes, publicInputsSha256, nowMs);
    if (result.blockers.length) {
      const checkData = collectCheckEvidence({ eligibility, run, build, files: downloaded.files }, { allowMissing: true });
      const verify = dependencies.verifyCheckEvidence ?? ((args) => verifyReleaseChecks(args,
        { github, publicBuildInputsBytes, publicBuildInputsSha256, checkPolicyBytes, checkPolicySha256,
          authenticateOfflineExecution: dependencies.authenticateOfflineExecution,
          authenticateArchiveReadback: dependencies.authenticateArchiveReadback,
          authenticateCheckExecution: dependencies.authenticateCheckExecution ?? executionIntake.authenticate, nowMs }));
      try {
        const partial = await verify({ ...checkData, build, eligibility, run });
        result.check_results = partial?.checks;
      } catch (error) {
        if (!(error instanceof ReleaseBlocked)) throw error;
        result.check_results = error.check_results;
        result.blockers.push(error.code);
      }
      await recheck(); return result;
    }
    const assembled = await assembleReleaseManifest({ eligibility, run, build, files: downloaded.files, inputs },
      { ...dependencies, checkVerification: { github, publicBuildInputsBytes, publicBuildInputsSha256,
        checkPolicyBytes, checkPolicySha256, authenticateOfflineExecution: dependencies.authenticateOfflineExecution,
        authenticateArchiveReadback: dependencies.authenticateArchiveReadback,
        authenticateCheckExecution: dependencies.authenticateCheckExecution ?? executionIntake.authenticate, nowMs } });
    const validated = validateReleaseManifest(assembled.manifestBytes, assembled.observations);
    await recheck();
    return { ...result, ...validated, artifact_status: "RELEASE_ARTIFACTS_VALIDATED",
      signature_status: "RUNTIME_CONFIG_AND_INDEPENDENT_PINS_VERIFIED",
      manifest_base64url: assembled.manifestBytes.toString("base64url"), check_results: assembled.checkResult?.checks, blockers: [] };
  } catch (error) {
    if (!(error instanceof ReleaseBlocked)) throw error;
    if (finalRecheck) await finalRecheck();
    result.status = error.status;
    if (error.check_results) result.check_results = error.check_results;
    result.blockers.push(error.code);
    return result;
  }
}
