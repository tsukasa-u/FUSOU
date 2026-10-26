import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { producerWorkflow, requireRelease } from "./release-build-proof.mjs";
import { ReleaseBlocked } from "./release-transport.mjs";
import { readRegularFile } from "./release-files.mjs";
import { sha256 } from "./release-bytes.mjs";
import { assertArchiveReadbackPolicy, captureArchiveReadback, parsePinnedCheckInputs } from "./release-checks.mjs";
import { createR2ArchiveReadbackBackend } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-readback.mjs";
import { acquireArchiveHttp } from "./release-archive-http.mjs";
import { ArchiveTransportError } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs";

export const EVIDENCE_PRODUCTION_SCOPE = "fusou-release-evidence-production-v1";
export const EVIDENCE_IMPLEMENTATION_BLOCKERS = Object.freeze({
  archive_readback: "ACTIONS_R2_BINDING_TRANSPORT_NOT_REGISTERED",
  offline_verification: "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED",
});
export function producerExecutionContext(report, identity) {
  requireRelease(identity?.repository === "tsukasa-u/FUSOU" &&
    identity.workflow_ref === `tsukasa-u/FUSOU/${producerWorkflow}@refs/heads/main` &&
    identity.event_name === "workflow_run" && identity.ref === "refs/heads/main" &&
    /^[0-9a-f]{40}$/.test(identity.workflow_sha) &&
    Number.isSafeInteger(identity.run_id) && identity.run_id > 0 &&
    Number.isSafeInteger(identity.run_attempt) && identity.run_attempt > 0 &&
    report.status === "PRODUCTION_ELIGIBLE" && /^[0-9a-f]{40}$/.test(report.commit_sha) &&
    report.coordinator_sha === identity.workflow_sha && isDeepStrictEqual(report.eligibility_run, {
      run_id: identity.run_id, run_attempt: identity.run_attempt, coordinator_sha: identity.workflow_sha,
    }), "registered main coordinator execution identity/release context");
  return { repository: identity.repository, source_sha: report.commit_sha,
    run_id: identity.run_id, run_attempt: identity.run_attempt, workflow_sha: identity.workflow_sha };
}

export async function collectReleaseEvidence({ report, identity, checkPolicyBytes, checkPolicySha256, evidenceDirectory },
  { archiveBinding, readSourceBytes, httpDependencies, httpEnabled = true, now = () => Date.now() } = {}) {
  const context = producerExecutionContext(report, identity), executions = new Map(), checks = {};
  let policyDigest;
  try {
    const policy = parsePinnedCheckInputs(checkPolicyBytes, checkPolicySha256, "fusou-release-check-inputs-v1");
    policyDigest = sha256(checkPolicyBytes);
    if (policy.grant_provider) throw new ReleaseBlocked("ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED", "BLOCKED_IMPLEMENTATION");
    requireRelease(policy.repository === context.repository && policy.source_sha === context.source_sha,
      "producer independent archive policy/release source");
    if (!policy.archive) throw new ReleaseBlocked("AUTHENTICATED_ARCHIVE_CONTEXT_MISSING");
    requireRelease(policy.archive.source_sha === context.source_sha, "producer independent archive policy/release source");
    const expected = policy.archive;
    assertArchiveReadbackPolicy(expected);
    requireRelease(expected.objects?.presentation && expected.objects?.result &&
      ["presentation", "result"].every((role) => expected.objects[role].role === role &&
        expected.objects[role].source_sha === context.source_sha &&
        expected.objects[role].capture_id === expected.capture_id &&
        expected.objects[role].session_id === expected.session_id &&
        /^[A-Za-z0-9_-]{43}$/.test(expected.objects[role].sha256) &&
        typeof expected.objects[role].version_id === "string" && expected.objects[role].version_id.length > 0),
    "producer pinned archive identity/generation/digest");
    if (policy.archive_transport) {
      requireRelease(!archiveBinding, "HTTP archive policy cannot fall back to local binding");
      if (!httpEnabled) throw new ReleaseBlocked("ARCHIVE_HTTP_ISOLATED_JOB_REQUIRED", "BLOCKED_IMPLEMENTATION");
      const acquired = await acquireArchiveHttp({ spec: policy.archive_transport, context, expected },
        { ...httpDependencies, now });
      const captured = await captureArchiveReadback({ context, expected, ...acquired, now });
      executions.set("archive_readback", captured);
      checks.archive_readback = { status: "LOCAL_CAPTURE_ONLY", evidence_sha256: sha256(captured.receipt),
        acquisition: "TRUSTED_PRODUCER_HTTPS_FETCH", retention_status: "NOT_CHECKED" };
    } else {
    if (!archiveBinding) throw new ReleaseBlocked(EVIDENCE_IMPLEMENTATION_BLOCKERS.archive_readback, "BLOCKED_IMPLEMENTATION");
    requireRelease(typeof archiveBinding.bucket?.get === "function" &&
      typeof archiveBinding.backendId === "string" && archiveBinding.backendId.length > 0 &&
      ["presentation", "result"].every((role) => expected.objects[role].backend_id === archiveBinding.backendId),
    "producer R2 binding/backend identity");
    if (!readSourceBytes && !evidenceDirectory) throw new ReleaseBlocked("ARCHIVE_SAVED_SOURCE_DIRECTORY_MISSING");
    const read = readSourceBytes ?? ((digest) => readRegularFile(join(evidenceDirectory, `evidence-${digest}.bin`)));
    const sourceBytes = new Map();
    for (const role of ["presentation", "result"]) {
      const digest = expected.objects[role].sha256;
      let raw;
      try { raw = await read(digest); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        throw new ReleaseBlocked("ARCHIVE_SAVED_SOURCE_BYTES_MISSING");
      }
      requireRelease(raw instanceof Uint8Array && sha256(raw) === digest, "producer saved archive raw bytes/digest");
      sourceBytes.set(role, Buffer.from(raw));
    }
    const backend = createR2ArchiveReadbackBackend({ bucket: archiveBinding.bucket, backendId: archiveBinding.backendId,
      resolveCapture: async (observed) => {
        const pinned = expected.objects[observed.role];
        requireRelease(pinned && ["role", "source_sha", "session_id", "job_id", "verification_attempt_id",
          "binding_id", "object_key", "version_id"].every((key) => observed[key] === pinned[key]),
        "producer independent capture catalog/generation mismatch");
        return pinned.capture_id;
      } });
    const captured = await captureArchiveReadback({ context, expected, sourceBytes, backend, now });
    executions.set("archive_readback", captured);
    checks.archive_readback = { status: "LOCAL_CAPTURE_ONLY", evidence_sha256: sha256(captured.receipt),
      retention_status: "NOT_CHECKED" };
    }
  } catch (error) {
    if (error instanceof ArchiveTransportError) {
      checks.archive_readback = { status: "BLOCKED_EXTERNAL_INPUTS", blocker: error.code };
    } else {
    if (!(error instanceof ReleaseBlocked)) throw error;
    checks.archive_readback = { status: error.status, blocker: error.code };
    }
  }
  // A semantic version is not a substitute for an authenticated builder artifact.
  checks.offline_verification = { status: "BLOCKED_IMPLEMENTATION", blocker: EVIDENCE_IMPLEMENTATION_BLOCKERS.offline_verification,
    identity_model: "AUTHENTICATED_BUILD_PROVENANCE_AND_EXECUTABLE_SHA256",
    missing_contracts: ["TRUSTED_NATIVE_BUILDER_ARTIFACT", "NATIVE_LOCKFILE_AND_RECIPE", "NATIVE_LAUNCHER_EXECUTION_CAPTURE"] };
  return { report: { schema_version: 1, scope: EVIDENCE_PRODUCTION_SCOPE, ...context,
    ...(policyDigest ? { check_policy_sha256: policyDigest } : {}), checks,
    publication_authorized: false, deployment_status: "NOT_CHECKED", production_acceptance: "BLOCKED" }, executions };
}
