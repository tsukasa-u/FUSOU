import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { assertCanaryVerifierExecutionReceipt } from "./canary-verifier-identity.mjs";

export const CANARY_EXECUTION_EVIDENCE_SCHEMA_VERSION = 1;
export const CANARY_EXECUTION_EVIDENCE_SCOPE = "tlsn-canary-verifier-execution-evidence";
export const CANARY_EXECUTION_EVIDENCE_BUNDLE_SCOPE = "tlsn-canary-verifier-execution-evidence-bundle";
export const CANARY_EXECUTION_TRUST_GRAPH = Object.freeze({
  schema_version: 1,
  nodes: Object.freeze([
    { id: "presentation", authority: "tlsn-alpha15-presentation" },
    { id: "result", authority: "fusou-tlsn-result-signer" },
    { id: "runtime_attestation", authority: "canary-runtime-attestation-signer" },
    { id: "verifier_runtime", authority: "cloudflare-canary-verifier-deployment" },
    { id: "verifier_execution", authority: "canary-verifier-identity-key" },
  ]),
  edges: Object.freeze([
    {
      id: "presentation-hash-is-signed-by-execution-receipt",
      source: "presentation",
      target: "verifier_execution",
      binding_fields: ["presentation_sha256", "job_id", "verification_attempt_id"],
      evidence_artifact: "verifier_execution_receipt",
      authority: "canary-verifier-identity-key",
    },
    {
      id: "result-hash-is-signed-by-execution-receipt",
      source: "result",
      target: "verifier_execution",
      binding_fields: ["result_sha256", "job_id", "verification_attempt_id"],
      evidence_artifact: "verifier_execution_receipt",
      authority: "canary-verifier-identity-key",
    },
    {
      id: "execution-identity-matches-attested-verifier-runtime",
      source: "verifier_runtime",
      target: "verifier_execution",
      binding_fields: ["deployment_id", "worker_name", "runtime_version_id", "verifier_key_id", "verifier_public_key_spki_sha256"],
      evidence_artifact: "verifier_execution_receipt",
      authority: "canary-verifier-identity-key",
    },
    {
      id: "runtime-attestation-authorizes-verifier-runtime",
      source: "runtime_attestation",
      target: "verifier_runtime",
      binding_fields: ["deployment_id", "worker_name", "version_id", "verifier_key_id", "key_registry_sha256"],
      evidence_artifact: "canary_runtime_attestation",
      authority: "canary-runtime-attestation-signer",
    },
  ]),
});

const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new Error(`${label} must be an authoritative UUID`);
  return value;
}

function requiredBytes(value, label) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  throw new Error(`${label} bytes are required`);
}

function sha256Base64Url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function parseCanonicalReceiptBytes(receiptBytes) {
  const raw = requiredBytes(receiptBytes, "Canary Verifier execution receipt");
  let receipt;
  try {
    receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new Error("Canary Verifier execution receipt artifact is not valid UTF-8 JSON");
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || JSON.stringify(receipt) !== raw.toString("utf8")) {
    throw new Error("Canary Verifier execution receipt artifact is not canonically serialized");
  }
  return { receipt, raw };
}

function assertBundlePath(value, label) {
  if (
    typeof value !== "string" || value.length === 0 || isAbsolute(value) ||
    value.includes("\\") || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return value;
}

async function readBundleArtifact(bundleRoot, artifactPath, label, maximumBytes) {
  const target = resolve(bundleRoot, assertBundlePath(artifactPath, label));
  const actualPath = await realpath(target);
  const escaped = relative(bundleRoot, actualPath).startsWith("..") || isAbsolute(relative(bundleRoot, actualPath));
  if (escaped) throw new Error(`${label} resolves outside the evidence bundle`);
  const metadata = await stat(actualPath);
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > maximumBytes) {
    throw new Error(`${label} artifact size or file type is invalid`);
  }
  return readFile(actualPath);
}

export async function loadCanaryVerifierExecutionEvidenceBundle({
  bundlePath,
  verifierIdentityKeyRegistry,
  trustedRuntimeIdentity,
  expectedJobId,
  expectedVerificationAttemptId,
  now = new Date(),
} = {}) {
  if (typeof bundlePath !== "string" || bundlePath.trim().length === 0) throw new Error("Canary Verifier execution evidence bundle path is missing");
  const manifestPath = resolve(bundlePath);
  const manifestBytes = await readFile(manifestPath);
  const bundleRoot = await realpath(dirname(manifestPath));
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Canary Verifier execution evidence bundle manifest is invalid JSON");
  }
  const manifestFields = [
    "schema_version",
    "scope",
    "main_deployment_id",
    "main_worker_name",
    "main_version_id",
    "main_platform_deployment_id",
    "git_commit_sha",
    "workflow_run_id",
    "workflow_run_attempt",
    "job_id",
    "verification_attempt_id",
    "artifacts",
  ];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || Object.keys(manifest).sort().join("\0") !== [...manifestFields].sort().join("\0")) {
    throw new Error("Canary Verifier execution evidence bundle fields are invalid");
  }
  if (manifest.schema_version !== CANARY_EXECUTION_EVIDENCE_SCHEMA_VERSION || manifest.scope !== CANARY_EXECUTION_EVIDENCE_BUNDLE_SCOPE) {
    throw new Error("Canary Verifier execution evidence bundle scope is invalid");
  }
  const expectedJob = requiredUuid(expectedJobId, "Expected Canary verification job ID");
  const expectedAttempt = requiredUuid(expectedVerificationAttemptId, "Expected Canary verification attempt ID");
  if (manifest.job_id !== expectedJob || manifest.verification_attempt_id !== expectedAttempt) {
    throw new Error("Canary execution evidence bundle does not match the expected job or attempt");
  }
  const runtimeIdentity = trustedRuntimeIdentity;
  const expectedMainIdentity = {
    main_deployment_id: runtimeIdentity?.deployment_id,
    main_worker_name: runtimeIdentity?.worker_name,
    main_version_id: runtimeIdentity?.version_id,
    main_platform_deployment_id: runtimeIdentity?.platform_deployment_id,
    git_commit_sha: runtimeIdentity?.git_commit_sha,
    workflow_run_id: runtimeIdentity?.workflow_run_id,
    workflow_run_attempt: runtimeIdentity?.workflow_run_attempt,
  };
  for (const [field, expected] of Object.entries(expectedMainIdentity)) {
    if (typeof expected !== "string" || expected.length === 0 || manifest[field] !== expected) {
      throw new Error(`Canary execution evidence bundle ${field} does not match the current Runtime Attestation`);
    }
  }
  if (!manifest.artifacts || typeof manifest.artifacts !== "object" || Array.isArray(manifest.artifacts)) {
    throw new Error("Canary Verifier execution evidence bundle artifacts are invalid");
  }
  const artifactNames = ["presentation", "result", "verifier_execution_receipt"];
  if (Object.keys(manifest.artifacts).sort().join("\0") !== [...artifactNames].sort().join("\0")) {
    throw new Error("Canary Verifier execution evidence bundle artifact set is invalid");
  }
  const artifactPaths = Object.values(manifest.artifacts);
  if (new Set(artifactPaths).size !== artifactPaths.length) throw new Error("Canary execution evidence bundle reuses an artifact path");
  const [presentationBytes, resultBytes, receiptBytes] = await Promise.all([
    readBundleArtifact(bundleRoot, manifest.artifacts.presentation, "Canary Presentation", 8 * 1024 * 1024),
    readBundleArtifact(bundleRoot, manifest.artifacts.result, "Canary Result", 256 * 1024),
    readBundleArtifact(bundleRoot, manifest.artifacts.verifier_execution_receipt, "Canary Verifier receipt", 16 * 1024),
  ]);
  const result = assertCanaryVerifierExecutionEvidence({
    receiptBytes,
    presentationBytes,
    resultBytes,
    verifierIdentityKeyRegistry,
    trustedRuntimeIdentity,
    expectedJobId: expectedJob,
    expectedVerificationAttemptId: expectedAttempt,
    now,
  });
  return {
    ...result,
    bundle: {
      path: manifestPath,
      manifest_sha256: sha256Base64Url(manifestBytes),
      presentation_path: manifest.artifacts.presentation,
      result_path: manifest.artifacts.result,
      verifier_execution_receipt_path: manifest.artifacts.verifier_execution_receipt,
    },
  };
}

export function assertCanaryVerifierExecutionEvidence({
  receiptBytes,
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry,
  trustedRuntimeIdentity,
  expectedJobId,
  expectedVerificationAttemptId,
  now = new Date(),
} = {}) {
  const expectedJob = requiredUuid(expectedJobId, "Expected Canary verification job ID");
  const expectedAttempt = requiredUuid(expectedVerificationAttemptId, "Expected Canary verification attempt ID");
  const presentation = requiredBytes(presentationBytes, "Canary Presentation");
  const result = requiredBytes(resultBytes, "Canary Result");
  const { receipt, raw: rawReceipt } = parseCanonicalReceiptBytes(receiptBytes);
  const execution = assertCanaryVerifierExecutionReceipt(receipt, {
    presentationBytes: presentation,
    resultBytes: result,
    verifierIdentityKeyRegistry,
    trustedRuntimeIdentity,
    expectedJobId: expectedJob,
    expectedVerificationAttemptId: expectedAttempt,
    now,
  });
  const verifierIdentity = trustedRuntimeIdentity.verifier_identity;
  if (!SHA256_BASE64URL_PATTERN.test(execution.presentation_sha256) || !SHA256_BASE64URL_PATTERN.test(execution.result_sha256)) {
    throw new Error("Canary Verifier execution evidence contains an invalid byte digest");
  }
  return {
    schema_version: CANARY_EXECUTION_EVIDENCE_SCHEMA_VERSION,
    scope: CANARY_EXECUTION_EVIDENCE_SCOPE,
    status: "PASS",
    evidence: {
      source: "signed-canary-verifier-execution-receipt",
      synthetic: false,
      verifier_execution_receipt_sha256: sha256Base64Url(rawReceipt),
      presentation_sha256: sha256Base64Url(presentation),
      result_sha256: sha256Base64Url(result),
    },
    execution: {
      receipt_id: execution.receipt_id,
      job_id: expectedJob,
      verification_attempt_id: expectedAttempt,
      issued_at: receipt.issued_at,
      verifier_key_id: execution.verifier_key_id,
      verifier_deployment_id: execution.deployment_id,
      verifier_worker_name: execution.worker_name,
      verifier_version_id: execution.runtime_version_id,
      presentation_sha256: execution.presentation_sha256,
      result_sha256: execution.result_sha256,
    },
    verifier_runtime: {
      deployment_id: verifierIdentity.deployment_id,
      worker_name: verifierIdentity.worker_name,
      version_id: verifierIdentity.version_id,
      verifier_key_id: verifierIdentity.verifier_key_id,
      public_key_spki_sha256: verifierIdentity.public_key_spki_sha256,
      key_registry_sha256: verifierIdentity.key_registry_sha256,
      runtime_attestation_captured_at: verifierIdentity.attestation_captured_at,
      runtime_attestation_expires_at: verifierIdentity.attestation_expires_at,
    },
    trust_graph: CANARY_EXECUTION_TRUST_GRAPH,
  };
}