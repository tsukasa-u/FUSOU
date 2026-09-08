import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertProductionEvidenceBlocked } from "./production-evidence-contract.mjs";

export const ATTESTATION_SCHEMA_VERSION = 2;
export const ATTESTATION_SCOPE = "tlsn-remote-validation-attestation";
export const ATTESTATION_SIGNATURE_ALGORITHM = "Ed25519";
export const DEFAULT_MAX_ATTESTATION_AGE_SECONDS = 900;
export const ATTESTATION_PAYLOAD_FIELDS = [
  "schema_version",
  "scope",
  "status",
  "workflow_run_id",
  "workflow_run_attempt",
  "git_commit_sha",
  "repository",
  "workflow_file_identity",
  "deployment_role",
  "validation_id",
  "validation_started_at",
  "validation_finished_at",
  "canary_provenance_sha256",
  "remote_report_sha256",
  "security_identity_sha256",
  "created_at",
];
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
export const RESULT_IDENTITY_FIELDS = [
  "result_public_key_spki",
  "result_signer_key_id",
  "result_key_registry_sha256",
];
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function decodeBase64Url(value, label) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) throw new Error(`${label} is not canonical base64url`);
  return bytes;
}

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

export function maxAttestationAgeSecondsFromEnvironment(environment) {
  const raw = environment.TLSN_MAX_ATTESTATION_AGE_SECONDS?.trim();
  if (!raw) return DEFAULT_MAX_ATTESTATION_AGE_SECONDS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400) {
    throw new Error("TLSN_MAX_ATTESTATION_AGE_SECONDS must be an integer from 1 through 86400");
  }
  return value;
}

export function assertAttestationFreshness(finishedAt, { now = new Date(), maxAgeSeconds = DEFAULT_MAX_ATTESTATION_AGE_SECONDS } = {}) {
  assertTimestamp(finishedAt, "validation_finished_at");
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("attestation validation time is invalid");
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) throw new Error("maximum attestation age is invalid");
  const finishedMs = Date.parse(finishedAt);
  if (finishedMs > nowMs) throw new Error("attestation validation_finished_at is in the future");
  if (nowMs - finishedMs > maxAgeSeconds * 1000) throw new Error("attestation is older than the maximum allowed age");
}

export function assertValidationId(value) {
  if (!UUID_PATTERN.test(value ?? "")) throw new Error("validation_id is invalid");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("canonical JSON does not support undefined values");
  return encoded;
}

export function canonicalAttestationPayload(attestation) {
  const payload = {};
  for (const field of ATTESTATION_PAYLOAD_FIELDS) {
    if (!(field in (attestation ?? {}))) throw new Error(`attestation payload is missing ${field}`);
    payload[field] = attestation[field];
  }
  return canonicalJson(payload);
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
  assertProductionEvidenceBlocked(report);
  if (report.checks?.remote_worker_identity?.status !== "PASS") {
    throw new Error("remote Worker identity check did not PASS");
  }
  if (report.deployment_identity?.deployment_role !== "canary") {
    throw new Error("remote validation must target the canary Worker");
  }
}

export function assertSignedAttestation(attestation, expectedSignerKeyId, expectedSignerPublicKeySpki) {
  if (!KEY_ID_PATTERN.test(attestation?.attestation_signer_key_id ?? "")) {
    throw new Error("attestation signer key ID is invalid");
  }
  if (attestation.attestation_signer_key_id !== expectedSignerKeyId) {
    throw new Error("attestation signer key ID mismatch");
  }
  if (attestation.signature_algorithm !== ATTESTATION_SIGNATURE_ALGORITHM) {
    throw new Error("attestation signature algorithm is invalid");
  }
  const signature = decodeBase64Url(attestation.signature_base64url, "attestation signature");
  if (signature.length !== 64) throw new Error("attestation signature has an invalid length");
  const publicKeyBytes = decodeBase64Url(expectedSignerPublicKeySpki, "attestation signer public key");
  const publicKey = createPublicKey({ key: publicKeyBytes, format: "der", type: "spki" });
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("attestation signer public key is not Ed25519");
  if (!verify(null, Buffer.from(canonicalAttestationPayload(attestation)), publicKey, signature)) {
    throw new Error("remote validation attestation signature is invalid");
  }
}

export function assertRemoteAttestation(
  attestation,
  expectedContext,
  canaryProvenance,
  remoteReport,
  canaryBytes,
  reportBytes,
  { expectedSignerKeyId, expectedSignerPublicKeySpki, now = new Date(), maxAgeSeconds = DEFAULT_MAX_ATTESTATION_AGE_SECONDS } = {},
) {
  if (
    attestation?.schema_version !== ATTESTATION_SCHEMA_VERSION ||
    attestation?.scope !== ATTESTATION_SCOPE ||
    attestation?.status !== "PASS"
  ) throw new Error("invalid remote validation attestation");
  assertEvidenceContext(attestation, { ...expectedContext, deployment_role: "canary" }, "remote attestation");
  assertTimestamp(attestation.created_at, "remote attestation created_at");
  assertValidationWindow(attestation.validation_started_at, attestation.validation_finished_at);
  assertAttestationFreshness(attestation.validation_finished_at, { now, maxAgeSeconds });
  if (!expectedSignerKeyId || !expectedSignerPublicKeySpki) throw new Error("attestation signer trust anchor is required");
  assertSignedAttestation(attestation, expectedSignerKeyId, expectedSignerPublicKeySpki);
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
    scope: ATTESTATION_SCOPE,
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

export function signRemoteAttestation(attestation, { signerKeyId, signingPrivateKeyPkcs8, signerPublicKeySpki }) {
  if (!KEY_ID_PATTERN.test(signerKeyId ?? "")) throw new Error("attestation signer key ID is invalid");
  const privateKeyBytes = decodeBase64Url(signingPrivateKeyPkcs8, "attestation signing private key");
  const privateKey = createPrivateKey({ key: privateKeyBytes, format: "der", type: "pkcs8" });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("attestation signing key is not Ed25519");
  const derivedPublicKeySpki = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64url");
  if (derivedPublicKeySpki !== signerPublicKeySpki) throw new Error("attestation private key does not match trusted public key");
  const signed = {
    ...attestation,
    attestation_signer_key_id: signerKeyId,
    signature_algorithm: ATTESTATION_SIGNATURE_ALGORITHM,
  };
  return {
    ...signed,
    signature_base64url: sign(null, Buffer.from(canonicalAttestationPayload(signed)), privateKey).toString("base64url"),
  };
}

export function createSignedRemoteAttestation({ expectedContext, canaryProvenance, remoteReport, canaryBytes, reportBytes, signerKeyId, signingPrivateKeyPkcs8, signerPublicKeySpki }) {
  return signRemoteAttestation(
    createRemoteAttestation({ expectedContext, canaryProvenance, remoteReport, canaryBytes, reportBytes }),
    { signerKeyId, signingPrivateKeyPkcs8, signerPublicKeySpki },
  );
}

export async function writeImmutableJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o444 });
  await chmod(path, 0o444);
}