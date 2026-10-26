import { isDeepStrictEqual } from "node:util";
import { acquireReleaseTransport, assertAuthenticatedReleaseTransport, ReleaseBlocked } from "./release-transport.mjs";
import { assertProducerRun, parseReleaseRecord, requireRelease, verifyProducerBuild } from "./release-build-proof.mjs";
import { evaluateReleaseRun } from "./release-eligibility.mjs";
import { checkContext, parsePinnedCheckInputs, receiptFor, verifyArchiveReadback } from "./release-checks.mjs";
import { createCrossRunExecutionIntake } from "./release-execution-intake.mjs";
import { verifyArchiveHttpExecution } from "./release-archive-http.mjs";
import { sha256 } from "./release-bytes.mjs";

export async function authenticateArchiveSupplement({ github, run, trustedSha, primary, supplemental, eligibility, build,
  publicBuildInputsSha256, checkPolicySha256, checkPolicyBytes, nowMs }) {
  assertAuthenticatedReleaseTransport(primary, run);
  assertAuthenticatedReleaseTransport(supplemental, run);
  const checkPolicy = parsePinnedCheckInputs(checkPolicyBytes, checkPolicySha256, "fusou-release-check-inputs-v1");
  if (checkPolicy.grant_provider) throw new ReleaseBlocked("ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED", "BLOCKED_IMPLEMENTATION");
  requireRelease(Buffer.from(supplemental.files.get("release-report.json") ?? []).equals(primary.files.get("release-report.json")),
    "archive artifact/build release report mismatch");
  if (!supplemental.files.has("check-archive_readback.json") || !supplemental.files.has("release-execution-origin.json")) {
    throw new ReleaseBlocked("AUTHENTICATED_ARCHIVE_HTTP_EXECUTION_MISSING");
  }
  const seal = parseReleaseRecord(supplemental.files.get("release-execution-origin.json"));
  requireRelease(seal.checks && Object.keys(seal.checks).every((check) => check === "archive_readback"),
    "archive artifact cannot replace build/native origin");
  const files = new Map(), evidence = new Map();
  for (const [name, raw] of supplemental.files) {
    if (name === "release-report.json" || name === "release-execution-origin.json" || name === "archive-production.json") continue;
    requireRelease(name === "check-archive_readback.json" || /^evidence-[A-Za-z0-9_-]{43}\.bin$/.test(name),
      "archive supplemental file inventory");
    requireRelease(!primary.files.has(name) || Buffer.from(primary.files.get(name)).equals(raw), "conflicting archive supplemental evidence");
    files.set(name, raw);
    const match = /^evidence-([A-Za-z0-9_-]{43})\.bin$/.exec(name);
    if (match) { requireRelease(sha256(raw) === match[1], "supplemental archive evidence hash"); evidence.set(match[1], raw); }
  }
  const context = checkContext(run, eligibility.commit_sha);
  const record = parseReleaseRecord(files.get("check-archive_readback.json"));
  const execution = receiptFor("archive_readback", { archive_readback: record }, evidence, context);
  verifyArchiveReadback({ ...execution, policy: checkPolicy.archive, httpTransportSpec: checkPolicy.archive_transport, nowMs });
  await verifyArchiveHttpExecution({ ...execution, expected: checkPolicy.archive, spec: checkPolicy.archive_transport, context, nowMs });
  const intake = createCrossRunExecutionIntake({ github, run, trustedSha, downloaded: supplemental, eligibility,
    publicBuildInputsSha256, checkPolicySha256 });
  await intake.authenticate({ ...execution, check: "archive_readback", context, build });
  return { files, intake, inputs: execution.inputs, provenance: {
    schema_version: 1, scope: "fusou-archive-online-provenance-v1",
    verification_mode: "GITHUB_API_REACQUISITION", offline_signature_verification: "NOT_IMPLEMENTED",
    repository: "tsukasa-u/FUSOU", repository_id: run.repository.id, workflow_sha: run.head_sha,
    run_id: run.id, run_attempt: run.run_attempt, source_sha: eligibility.commit_sha,
    primary_artifact: primary.origin, archive_artifact: supplemental.origin,
    report_sha256: sha256(primary.files.get("release-report.json")), receipt_sha256: sha256(files.get(`evidence-${record.evidence_sha256}.bin`)),
    public_build_inputs_sha256: publicBuildInputsSha256, check_policy_sha256: checkPolicySha256,
    archive_integrity: "RAW_VERSION_SIZE_DIGEST_CHECKED", consumer_native_crypto_reexecution: "NOT_CHECKED",
  } };
}

export async function reauthenticateSavedArchive({ github, expected, savedInputs, downloadArchive,
  checkPolicyBytes, checkPolicySha256, publicBuildInputsSha256, nowMs = Date.now() }, { transport } = {}) {
  if (expected?.verification_mode !== "GITHUB_API_REACQUISITION") throw new ReleaseBlocked("ARCHIVE_PROVENANCE_MODE_NOT_REGISTERED");
  if (typeof github?.rest?.actions?.getWorkflowRun !== "function" || typeof downloadArchive !== "function") {
    throw new ReleaseBlocked("ARCHIVE_PROVENANCE_REACQUISITION_NOT_CONFIGURED");
  }
  requireRelease(expected.repository === "tsukasa-u/FUSOU" && Number.isSafeInteger(expected.repository_id) && expected.repository_id > 0 &&
    /^[0-9a-f]{40}$/.test(expected.source_sha) && /^[0-9a-f]{40}$/.test(expected.workflow_sha) &&
    /^[0-9a-f]{40}$/.test(expected.trusted_sha) && Number.isSafeInteger(expected.validation_run_id) && expected.validation_run_id > 0,
  "independent saved archive expectations");
  const run = (await github.rest.actions.getWorkflowRun({ owner: "tsukasa-u", repo: "FUSOU", run_id: expected.run_id })).data;
  assertProducerRun(run, expected.run_id, expected.run_attempt);
  requireRelease(run.repository.id === expected.repository_id && run.head_sha === expected.workflow_sha, "saved archive independent run/workflow identity");
  const eligibility = await evaluateReleaseRun({ github, repository: { owner: "tsukasa-u", repo: "FUSOU" },
    runId: expected.validation_run_id, trustedSha: expected.trusted_sha });
  requireRelease(eligibility.status === "PRODUCTION_ELIGIBLE" && eligibility.commit_sha === expected.source_sha &&
    eligibility.validation_run_attempt === expected.validation_run_attempt, "saved archive independent live release identity");
  const primary = await acquireReleaseTransport({ github, run, downloadArchive, ...transport });
  const supplemental = await acquireReleaseTransport({ github, run, downloadArchive, ...transport, artifactKind: "archive" });
  const build = verifyProducerBuild({ run, ...primary, eligibility });
  const authenticated = await authenticateArchiveSupplement({ github, run, trustedSha: expected.trusted_sha, primary, supplemental,
    eligibility, build, publicBuildInputsSha256, checkPolicySha256, checkPolicyBytes, nowMs });
  requireRelease(savedInputs instanceof Map && isDeepStrictEqual([...savedInputs.keys()].sort(), [...authenticated.inputs.keys()].sort()) &&
    [...savedInputs].every(([name, raw]) => raw instanceof Uint8Array && Buffer.from(raw).equals(authenticated.inputs.get(name))),
  "saved archive bytes differ from independently reacquired evidence");
  await authenticated.intake.recheck();
  await createCrossRunExecutionIntake({ github, run, trustedSha: expected.trusted_sha, downloaded: primary, eligibility,
    publicBuildInputsSha256, checkPolicySha256 }).recheck();
  return authenticated.provenance;
}
