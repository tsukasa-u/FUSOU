import { createHash } from "node:crypto";

const method = "operator-wrangler-v1";
const candidateWorkflow = ".github/workflows/tlsn-testplay-candidate.yml";
const workflowFields = ["workflow_run_id", "workflow_run_attempt", "git_commit_sha",
  "repository", "workflow_file_identity", "deployment_role"];
const deploymentFields = ["account_id", "script_name", "deployment_id", "version_id", "logical_deployment_id"];
const digestPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const nilUuid = "00000000-0000-0000-0000-000000000000";
const sha = /^[a-f0-9]{40}$/u;
const positiveInteger = /^[1-9][0-9]*$/u;
const sha256 = (raw) => createHash("sha256").update(raw).digest("base64url");

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    throw new Error(`invalid ${label} fields`);
  }
}

function assertCandidateCi(ci, expectedSha) {
  exactKeys(ci, ["workflow_path", "run_id", "run_attempt", "head_sha", "conclusion"], "candidate CI record");
  if (ci.workflow_path !== candidateWorkflow || ci.head_sha !== expectedSha || ci.conclusion !== "success" ||
      typeof ci.run_id !== "string" || !positiveInteger.test(ci.run_id) ||
      typeof ci.run_attempt !== "string" || !positiveInteger.test(ci.run_attempt)) {
    throw new Error("operator deployment requires successful candidate CI for the selected SHA");
  }
}

export function assertAppWorkerReleaseContext(context, cloudflare, logicalDeploymentId) {
  if (context?.deployment_method !== method) {
    exactKeys(context, workflowFields, "approved release context");
    return;
  }
  exactKeys(context, ["deployment_method", "deployment_role", "git_commit_sha", "repository",
    "candidate_ci", "approved_deployment", "operator_record_sha256"], "operator release context");
  assertCandidateCi(context.candidate_ci, context.git_commit_sha);
  exactKeys(context.approved_deployment, deploymentFields, "approved operator deployment");
  if (context.deployment_role !== "production" || !sha.test(context.git_commit_sha ?? "") ||
      typeof context.repository !== "string" || !/^[^/\s]+\/[^/\s]+$/u.test(context.repository) ||
      typeof context.operator_record_sha256 !== "string" || !digestPattern.test(context.operator_record_sha256)) {
    throw new Error("operator release context is invalid");
  }
  for (const name of deploymentFields) {
    const observed = name === "logical_deployment_id" ? logicalDeploymentId : cloudflare[name];
    if (context.approved_deployment[name] !== observed) {
      throw new Error(`active Cloudflare identity disagrees with approved operator deployment: ${name}`);
    }
  }
}

export function operatorWranglerRelease(environment, recordRaw, publicManifestRaw) {
  const expectedDigest = environment.TLSN_OPERATOR_DEPLOYMENT_APPROVED_SHA256;
  if (typeof expectedDigest !== "string" || !digestPattern.test(expectedDigest) ||
      !(typeof recordRaw === "string" || recordRaw instanceof Uint8Array) || sha256(recordRaw) !== expectedDigest) {
    throw new Error("operator deployment record digest does not match the independent approval");
  }
  let record;
  try {
    record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(recordRaw)));
  } catch {
    throw new Error("operator deployment record must be UTF-8 JSON");
  }
  exactKeys(record, ["schema_version", "scope", "git_commit_sha", "repository", "candidate_ci",
    "cloudflare", "verifier_key_id", "wasm_sha256", "public_manifest_sha256"], "operator deployment record");
  exactKeys(record.cloudflare, deploymentFields, "approved operator deployment");
  if (record.schema_version !== 1 || record.scope !== "fusou-tlsn-operator-wrangler-deployment" ||
      record.git_commit_sha !== environment.TLSN_GIT_COMMIT_SHA || record.repository !== environment.TLSN_REPOSITORY ||
      !/^[a-f0-9]{32}$/u.test(record.cloudflare.account_id ?? "") ||
      record.cloudflare.account_id !== environment.CLOUDFLARE_ACCOUNT_ID ||
      record.cloudflare.script_name !== environment.TLSN_PRODUCTION_WORKER_NAME ||
      record.cloudflare.logical_deployment_id !== environment.TLSN_PRODUCTION_DEPLOYMENT_ID ||
      !uuid.test(record.cloudflare.deployment_id ?? "") || !uuid.test(record.cloudflare.version_id ?? "") ||
      record.cloudflare.deployment_id === nilUuid || record.cloudflare.version_id === nilUuid ||
      record.cloudflare.deployment_id === record.cloudflare.version_id ||
      typeof record.verifier_key_id !== "string" || !/^[A-Za-z0-9._-]{1,128}$/u.test(record.verifier_key_id) ||
      typeof record.wasm_sha256 !== "string" || !digestPattern.test(record.wasm_sha256) ||
      !(typeof publicManifestRaw === "string" || publicManifestRaw instanceof Uint8Array) ||
      sha256(publicManifestRaw) !== record.public_manifest_sha256) {
    throw new Error("operator deployment record does not match the selected release and public manifest");
  }
  const context = {
    deployment_method: method,
    deployment_role: "production",
    git_commit_sha: record.git_commit_sha,
    repository: record.repository,
    candidate_ci: record.candidate_ci,
    approved_deployment: record.cloudflare,
    operator_record_sha256: expectedDigest,
  };
  assertAppWorkerReleaseContext(context, record.cloudflare, record.cloudflare.logical_deployment_id);
  return { context, verifierKeyId: record.verifier_key_id };
}
