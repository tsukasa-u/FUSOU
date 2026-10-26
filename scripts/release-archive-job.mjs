import { isDeepStrictEqual } from "node:util";
import { acquireReleaseTransport, assertAuthenticatedReleaseTransport, encodeReleaseTransport } from "./release-transport.mjs";
import { parseReleaseRecord, producerWorkflow, requireRelease } from "./release-build-proof.mjs";
import { collectReleaseEvidence, producerExecutionContext } from "./release-evidence-producer.mjs";
import { createProducerExecutionOrigin, EXECUTION_ORIGIN_FILE } from "./release-execution-origin.mjs";
import { jsonBytes } from "./release-checks.mjs";

export async function produceArchiveJob({ github, run, eligibility, identity, checkPolicyBytes, checkPolicySha256,
  publicBuildInputsSha256, downloadArchive }, dependencies = {}) {
  requireRelease(run.id === identity.run_id && run.run_attempt === identity.run_attempt && run.head_sha === identity.workflow_sha &&
    run.event === "workflow_run" && run.path === producerWorkflow && run.head_branch === "main" &&
    run.repository?.full_name === identity.repository && Number.isSafeInteger(run.repository.id) && run.repository.id > 0 &&
    run.head_repository?.id === run.repository.id && run.head_repository.full_name === identity.repository &&
    ["in_progress", "completed"].includes(run.status), "archive job independent run identity");
  const downloaded = await acquireReleaseTransport({ github, run, downloadArchive, ...dependencies.transport });
  assertAuthenticatedReleaseTransport(downloaded, run);
  const rawReport = downloaded.files.get("release-report.json"), report = parseReleaseRecord(rawReport);
  requireRelease(["status", "tag", "commit_sha", "validation_run_id", "validation_run_attempt"].every(
    (key) => report[key] === eligibility[key]), "archive job independent live release eligibility");
  const files = new Map([["release-report.json", rawReport]]);
  if (eligibility.status !== "PRODUCTION_ELIGIBLE" || report.build?.status !== "BUILD_OUTPUTS_GENERATED") {
    const blocked = { status: "NOT_APPLICABLE", publication_authorized: false, deployment_status: "NOT_CHECKED", production_acceptance: "BLOCKED" };
    files.set("archive-production.json", jsonBytes(blocked));
    return { report: blocked, transport: encodeReleaseTransport(files) };
  }
  const context = producerExecutionContext(report, identity);
  requireRelease(publicBuildInputsSha256 && report.build.public_inputs_sha256 === publicBuildInputsSha256 &&
    isDeepStrictEqual(report.eligibility_run, { run_id: run.id, run_attempt: run.run_attempt, coordinator_sha: run.head_sha }),
  "archive job independent public build input pin");
  const production = await collectReleaseEvidence({ report, identity, checkPolicyBytes, checkPolicySha256 }, dependencies);
  for (const execution of production.executions.values()) for (const [name, raw] of execution.files) files.set(name, raw);
  files.set("archive-production.json", jsonBytes(production.report));
  files.set(EXECUTION_ORIGIN_FILE, createProducerExecutionOrigin({ report, files, context,
    executionProofs: Object.fromEntries([...production.executions].map(([check, execution]) => [check, execution.executionProof])) }));
  return { report: production.report, transport: encodeReleaseTransport(files) };
}
