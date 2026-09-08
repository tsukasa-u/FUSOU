import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const ATTESTATION_SCHEMA_VERSION = 1;
export const EVIDENCE_CONTEXT_FIELDS = [
  "workflow_run_id",
  "workflow_run_attempt",
  "git_commit_sha",
  "repository",
  "workflow_file_identity",
  "deployment_role",
];
export const SECURITY_IDENTITY_FIELDS = [
  "git_commit_sha",
  "server_identity",
  "profile_sha256",
  "verifier_key_id",
  "notary_key_id",
  "security_registry_set_sha256",
  "notary_registry_sha256",
  "binding_authority",
];
export const DEPLOYMENT_IDENTITY_FIELDS = [
  "deployment_id",
  "deployment_role",
  "binding_mode",
  "trust_root_certificate_sha256",
  "worker_name",
];
export const RESULT_IDENTITY_FIELDS = ["result_public_key_spki"];
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requiredEnvironment(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`missing required workflow evidence variable: ${name}`);
  return value;
}

export function workflowContextFromEnvironment(environment, role) {
  const context = {
    workflow_run_id: requiredEnvironment(environment, "TLSN_WORKFLOW_RUN_ID"),
    workflow_run_attempt: requiredEnvironment(environment, "TLSN_WORKFLOW_RUN_ATTEMPT"),
    git_commit_sha: requiredEnvironment(environment, "TLSN_GIT_COMMIT_SHA").toLowerCase(),
    repository: requiredEnvironment(environment, "TLSN_REPOSITORY"),
    workflow_file_identity: requiredEnvironment(environment, "TLSN_WORKFLOW_FILE_IDENTITY"),
    deployment_role: role,
  };
  if (!/^\d+$/.test(context.workflow_run_id) || BigInt(context.workflow_run_id) < 1n) {
    throw new Error("workflow_run_id must be a positive integer");
  }
  if (!/^\d+$/.test(context.workflow_run_attempt) || BigInt(context.workflow_run_attempt) < 1n) {
    throw new Error("workflow_run_attempt must be a positive integer");
  }
  if (!GIT_COMMIT_PATTERN.test(context.git_commit_sha)) throw new Error("git_commit_sha must be a 40-character SHA");
  if (!/^[^/\s]+\/[^/\s]+$/.test(context.repository)) throw new Error("repository must be owner/name");
  if (!/\.github\/workflows\/[^\s@]+\.ya?ml@[^\s]+$/.test(context.workflow_file_identity)) {
    throw new Error("workflow_file_identity must identify a workflow file and ref");
  }
  if (role !== "canary" && role !== "production") throw new Error("deployment_role must be canary or production");
  return context;
}

export function checkoutCommit(cwd) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim().toLowerCase();
}

export function assertCheckoutCommit(context, cwd) {
  const actual = checkoutCommit(cwd);
  if (actual !== context.git_commit_sha) {
    throw new Error(`git_commit_sha does not match checked-out HEAD: ${actual}`);
  }
}

export function assertEvidenceContext(actual, expected, label) {
  for (const field of EVIDENCE_CONTEXT_FIELDS) {
    if (actual?.[field] !== expected?.[field]) throw new Error(`${label} mismatch: ${field}`);
  }
}

export function assertTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

export function assertValidationWindow(startedAt, finishedAt) {
  assertTimestamp(startedAt, "validation_started_at");
  assertTimestamp(finishedAt, "validation_finished_at");
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error("validation_finished_at precedes validation_started_at");
}

export function assertValidationId(value) {
  if (!UUID_PATTERN.test(value ?? "")) throw new Error("validation_id is invalid");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Base64Url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

export async function sha256File(path) {
  return sha256Base64Url(await readFile(path));
}

export function assertProvenanceEvidence(provenance, expectedContext, role) {
  if (
    provenance?.schema_version !== 2 ||
    provenance?.scope !== "tlsn-deployment-provenance" ||
    provenance?.status !== "PASS" ||
    provenance?.environment !== "production" ||
    provenance?.deployment_role !== role
  ) throw new Error(`invalid ${role} provenance manifest`);
  assertEvidenceContext(provenance, { ...expectedContext, deployment_role: role }, `${role} provenance`);
  assertTimestamp(provenance.created_at, `${role} provenance created_at`);
  for (const [name, fields] of [
    ["security_identity", SECURITY_IDENTITY_FIELDS],
    ["deployment_identity", DEPLOYMENT_IDENTITY_FIELDS],
    ["result_identity", RESULT_IDENTITY_FIELDS],
  ]) {
    for (const field of fields) {
      if (typeof provenance[name]?.[field] !== "string" || provenance[name][field].length === 0) {
        throw new Error(`${role} provenance is missing ${name}.${field}`);
      }
    }
  }
  if (provenance.security_identity.git_commit_sha !== expectedContext.git_commit_sha) {
    throw new Error(`${role} provenance security identity commit mismatch`);
  }
}

export function assertRemoteReportGate(report) {
  if (report?.schema_version !== 2 || report?.scope !== "remote-deployed-synthetic") {
    throw new Error("remote validation report schema or scope is invalid");
  }
  if (report?.summary?.fail !== 0 || report?.summary?.blocking_blocked !== 0) {
    throw new Error("remote validation did not PASS all required synthetic checks");
  }
  if (report.production_evidence !== "BLOCKED" || report.p0_05 !== "BLOCKED") {
    throw new Error("production evidence and P0-05 must remain BLOCKED");
  }
  if (report.checks?.remote_worker_identity?.status !== "PASS") {
    throw new Error("remote Worker identity check did not PASS");
  }
  if (report.deployment_identity?.deployment_role !== "canary") {
    throw new Error("remote validation must target the canary Worker");
  }
}

export function assertRemoteAttestation(attestation, expectedContext, canaryProvenance, remoteReport, canaryBytes, reportBytes) {
  if (
    attestation?.schema_version !== ATTESTATION_SCHEMA_VERSION ||
    attestation?.scope !== "tlsn-remote-validation-attestation" ||
    attestation?.status !== "PASS"
  ) throw new Error("invalid remote validation attestation");
  assertEvidenceContext(attestation, { ...expectedContext, deployment_role: "canary" }, "remote attestation");
  assertTimestamp(attestation.created_at, "remote attestation created_at");
  assertValidationWindow(attestation.validation_started_at, attestation.validation_finished_at);
  if (!UUID_PATTERN.test(attestation.validation_id)) throw new Error("remote attestation validation_id is invalid");
  if (attestation.validation_id !== remoteReport.validation_id) throw new Error("remote attestation validation_id mismatch");
  if (attestation.validation_started_at !== remoteReport.validation_started_at || attestation.validation_finished_at !== remoteReport.validation_finished_at) {
    throw new Error("remote attestation validation window mismatch");
  }
  if (attestation.canary_provenance_sha256 !== sha256Base64Url(canaryBytes)) throw new Error("canary provenance hash mismatch");
  if (attestation.remote_report_sha256 !== sha256Base64Url(reportBytes)) throw new Error("remote report hash mismatch");
  if (attestation.security_identity_sha256 !== sha256Base64Url(canonicalJson(canaryProvenance.security_identity))) {
    throw new Error("security identity hash mismatch");
  }
  assertRemoteReportGate(remoteReport);
  assertEvidenceContext(remoteReport, expectedContext, "remote report");
  assertTimestamp(remoteReport.created_at, "remote report created_at");
  assertValidationWindow(remoteReport.validation_started_at, remoteReport.validation_finished_at);
  assertValidationId(remoteReport.validation_id);
  assertProvenanceEvidence(canaryProvenance, expectedContext, "canary");
  if (canonicalJson(remoteReport.security_identity) !== canonicalJson(canaryProvenance.security_identity)) {
    throw new Error("remote report security identity mismatch");
  }
  if (canonicalJson(remoteReport.deployment_identity) !== canonicalJson(canaryProvenance.deployment_identity)) {
    throw new Error("remote report deployment identity mismatch");
  }
  if (canonicalJson(remoteReport.result_identity) !== canonicalJson(canaryProvenance.result_identity)) {
    throw new Error("remote report result identity mismatch");
  }
}

export function createRemoteAttestation({ expectedContext, canaryProvenance, remoteReport, canaryBytes, reportBytes }) {
  return {
    schema_version: ATTESTATION_SCHEMA_VERSION,
    scope: "tlsn-remote-validation-attestation",
    status: "PASS",
    ...expectedContext,
    created_at: new Date().toISOString(),
    validation_started_at: remoteReport.validation_started_at,
    validation_finished_at: remoteReport.validation_finished_at,
    validation_id: remoteReport.validation_id,
    canary_provenance_sha256: sha256Base64Url(canaryBytes),
    remote_report_sha256: sha256Base64Url(reportBytes),
    security_identity_sha256: sha256Base64Url(canonicalJson(canaryProvenance.security_identity)),
  };
}

export async function writeImmutableJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o444 });
  await chmod(path, 0o444);
}