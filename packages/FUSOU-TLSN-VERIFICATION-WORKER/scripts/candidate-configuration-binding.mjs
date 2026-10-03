import { readFileSync } from "node:fs";
import {
  isCandidateArtifactIdentityVerificationResult,
} from "./candidate-artifact-identity.mjs";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export const CANDIDATE_CONFIGURATION_PROVENANCE_CONTRACT = deepFreeze(JSON.parse(readFileSync(
  new URL("./candidate-configuration-provenance-contract-v1.json", import.meta.url),
  "utf8",
)));
export const CANDIDATE_CONFIGURATION_BINDING_ASSESSMENT_SCHEMA_VERSION = 1;
export const CANDIDATE_CONFIGURATION_BINDING_ASSESSMENT_SCOPE = "fusou-tlsn-candidate-configuration-binding-assessment";

const SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const VERIFIED_ASSESSMENTS = new WeakSet();

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields do not match the provenance contract`);
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 512) throw new Error(`${label} is invalid`);
  return value;
}

function requiredSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new Error(`${label} is invalid`);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) throw new Error(`${label} is not canonical SHA-256`);
  return value;
}

function requiredCommit(value, label) {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requiredTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) throw new Error(`${label} is invalid`);
  return Date.parse(value);
}

function validateInterval(validFrom, validUntil, now, label) {
  const from = requiredTimestamp(validFrom, `${label}.valid_from`);
  const until = requiredTimestamp(validUntil, `${label}.valid_until`);
  if (from >= until) throw new Error(`${label} validity interval is invalid`);
  if (now < from) return "NOT_YET_VALID";
  if (now >= until) return "EXPIRED";
  return "CURRENT";
}

function validateSignature(signature, label) {
  assertExactKeys(signature, CANDIDATE_CONFIGURATION_PROVENANCE_CONTRACT.nested_fields.signature, `${label}.signature`);
  requiredString(signature.algorithm, `${label}.signature.algorithm`);
  requiredString(signature.key_id, `${label}.signature.key_id`);
  if (typeof signature.value !== "string") throw new Error(`${label}.signature.value is invalid`);
  const bytes = Buffer.from(signature.value, "base64url");
  if (bytes.length !== 64 || bytes.toString("base64url") !== signature.value) {
    throw new Error(`${label}.signature.value is not a canonical 64-byte signature`);
  }
  return { key_id: signature.key_id };
}

function validateAuthorityIdentity(identity, label) {
  assertExactKeys(identity, CANDIDATE_CONFIGURATION_PROVENANCE_CONTRACT.nested_fields.authority_identity, `${label}.authority_identity`);
  return {
    authority_id: requiredString(identity.authority_id, `${label}.authority_identity.authority_id`),
    key_id: requiredString(identity.key_id, `${label}.authority_identity.key_id`),
  };
}

function validateInput(input, inputName) {
  const contract = CANDIDATE_CONFIGURATION_PROVENANCE_CONTRACT.inputs[inputName];
  assertExactKeys(input, contract.required_fields, inputName);
  if (input.schema_version !== contract.schema_version || input.scope !== contract.scope) {
    throw new Error(`${inputName} schema version or scope is invalid`);
  }
}

function validateApprovedFingerprint(value, now) {
  validateInput(value, "APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT");
  requiredSha256(value.combined_sha256, "approved combined_sha256");
  requiredString(value.approval_id, "approved approval_id");
  requiredSha256(value.candidate_artifact_id, "approved candidate_artifact_id");
  requiredString(value.candidate_capture_id, "approved candidate_capture_id");
  requiredString(value.provenance_source, "approved provenance_source");
  requiredSha256(value.evidence_sha256, "approved evidence_sha256");
  const authorityIdentity = validateAuthorityIdentity(value.authority_identity, "approved fingerprint");
  const signature = validateSignature(value.signature, "approved fingerprint");
  if (signature.key_id !== authorityIdentity.key_id) {
    throw new Error("approved fingerprint signature key does not match authority identity");
  }
  return {
    validity: validateInterval(value.valid_from, value.valid_until, now, "approved fingerprint"),
    combined_sha256: value.combined_sha256,
    approval_id: value.approval_id,
    candidate_artifact_id: value.candidate_artifact_id,
    candidate_capture_id: value.candidate_capture_id,
    provenance_source: value.provenance_source,
    evidence_sha256: value.evidence_sha256,
  };
}

function validateCurrentBinaryIdentity(value) {
  validateInput(value, "CURRENT_BINARY_IDENTITY");
  return {
    artifact_identity: requiredString(value.artifact_identity, "current binary artifact_identity"),
    binary_sha256: requiredSha256(value.binary_sha256, "current binary binary_sha256"),
    source_commit: requiredCommit(value.source_commit, "current binary source_commit"),
    provenance_source: requiredString(value.provenance_source, "current binary provenance_source"),
    evidence_sha256: requiredSha256(value.evidence_sha256, "current binary evidence_sha256"),
  };
}

function validateBuilderProvenance(value, now) {
  validateInput(value, "AUTHENTICATED_BUILDER_PROVENANCE");
  const validated = {
    candidate_artifact_id: requiredSha256(value.candidate_artifact_id, "builder candidate_artifact_id"),
    artifact_identity: requiredString(value.artifact_identity, "builder artifact_identity"),
    binary_sha256: requiredSha256(value.binary_sha256, "builder binary_sha256"),
    source_commit: requiredCommit(value.source_commit, "builder source_commit"),
    build_workflow_identity: requiredString(value.build_workflow_identity, "builder build_workflow_identity"),
    toolchain_identity: requiredString(value.toolchain_identity, "builder toolchain_identity"),
    builder_identity: requiredString(value.builder_identity, "builder builder_identity"),
    builder_signing_key_id: requiredString(value.builder_signing_key_id, "builder builder_signing_key_id"),
    evidence_sha256: requiredSha256(value.evidence_sha256, "builder evidence_sha256"),
    validity: validateInterval(value.valid_from, value.valid_until, now, "builder provenance"),
  };
  const signature = validateSignature(value.signature, "builder provenance");
  if (signature.key_id !== validated.builder_signing_key_id) {
    throw new Error("builder signature key does not match declared builder signing key");
  }
  return validated;
}

function validateFingerprintReference(value) {
  assertExactKeys(
    value,
    CANDIDATE_CONFIGURATION_PROVENANCE_CONTRACT.nested_fields.app_configuration_fingerprint,
    "authority receipt app_configuration_fingerprint",
  );
  if (value.schema_version !== 2 || value.scope !== "fusou-tlsn-app-public-configuration") {
    throw new Error("authority receipt APP configuration fingerprint schema or scope is invalid");
  }
  return requiredSha256(value.combined_sha256, "authority receipt combined_sha256");
}

function validateDeploymentIdentity(value) {
  assertExactKeys(
    value,
    CANDIDATE_CONFIGURATION_PROVENANCE_CONTRACT.nested_fields.deployment_identity,
    "authority receipt deployment_identity",
  );
  return {
    deployment_id: requiredString(value.deployment_id, "authority receipt deployment_id"),
    worker_name: requiredString(value.worker_name, "authority receipt worker_name"),
    git_commit_sha: requiredCommit(value.git_commit_sha, "authority receipt git_commit_sha"),
  };
}

function validateCaptureIdentity(value) {
  assertExactKeys(
    value,
    CANDIDATE_CONFIGURATION_PROVENANCE_CONTRACT.nested_fields.capture_identity,
    "authority receipt capture_identity",
  );
  return {
    candidate_capture_id: requiredString(value.candidate_capture_id, "authority receipt candidate_capture_id"),
    session_id: requiredString(value.session_id, "authority receipt session_id"),
    request_id: requiredString(value.request_id, "authority receipt request_id"),
    request_sha256: requiredSha256(value.request_sha256, "authority receipt request_sha256"),
    authenticated_request_sha256: requiredSha256(
      value.authenticated_request_sha256,
      "authority receipt authenticated_request_sha256",
    ),
    binding_identifier: requiredSha256(value.binding_identifier, "authority receipt binding_identifier"),
  };
}

function validateIndependentAuthorityReceipt(value, now) {
  validateInput(value, "INDEPENDENT_AUTHORITY_RECEIPT");
  const issuedAt = requiredTimestamp(value.issued_at, "authority receipt issued_at");
  const expiresAt = requiredTimestamp(value.expires_at, "authority receipt expires_at");
  if (issuedAt >= expiresAt) throw new Error("authority receipt validity interval is invalid");
  const validity = now < issuedAt ? "NOT_YET_VALID" : now >= expiresAt ? "EXPIRED" : "CURRENT";
  const authorityIdentity = validateAuthorityIdentity(value.authority_identity, "authority receipt");
  const signature = validateSignature(value.signature, "authority receipt");
  if (signature.key_id !== authorityIdentity.key_id) {
    throw new Error("authority receipt signature key does not match authority identity");
  }
  return {
    candidate_artifact_id: requiredSha256(value.candidate_artifact_id, "authority receipt candidate_artifact_id"),
    combined_sha256: validateFingerprintReference(value.app_configuration_fingerprint),
    binary_sha256: requiredSha256(value.binary_sha256, "authority receipt binary_sha256"),
    deployment_identity: validateDeploymentIdentity(value.deployment_identity),
    capture_identity: validateCaptureIdentity(value.capture_identity),
    authority_id: value.authority_identity.authority_id,
    key_id: value.authority_identity.key_id,
    evidence_sha256: requiredSha256(value.evidence_sha256, "authority receipt evidence_sha256"),
    validity,
  };
}

function safelyValidate(value, validate) {
  if (value === null || value === undefined) return { status: "MISSING", result: null };
  try {
    return { status: "PRESENT", result: validate(value), reason: null };
  } catch (error) {
    return {
      status: "INVALID",
      result: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function captureIdentityFromVerifiedResult(identity) {
  return {
    candidate_capture_id: identity.candidate_capture_id,
    session_id: identity.session_id,
    request_id: identity.request_id,
    request_sha256: identity.request_sha256,
    authenticated_request_sha256: identity.authenticated_request_sha256,
    binding_identifier: identity.binding_identifier,
  };
}

function sameObjectFields(left, right) {
  return Object.keys(left).every((field) => left[field] === right[field]);
}

export function candidateConfigurationBindingAssessment({
  candidateArtifactIdentity = null,
  candidateBundleStatus = null,
  syntheticFixture = false,
  approvedExpectedConfigurationFingerprint = null,
  currentBinaryIdentity = null,
  trustedBuilderProvenance = null,
  independentAuthorityReceipt = null,
  expectedSourceCommit = null,
  expectedDeploymentIdentity = null,
  now = new Date(),
} = {}) {
  const hasVerifierResult = isCandidateArtifactIdentityVerificationResult(candidateArtifactIdentity);
  const identity = hasVerifierResult ? candidateArtifactIdentity : null;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("candidate configuration assessment time is invalid");

  const approved = safelyValidate(
    approvedExpectedConfigurationFingerprint,
    (value) => validateApprovedFingerprint(value, nowMs),
  );
  const binary = safelyValidate(currentBinaryIdentity, validateCurrentBinaryIdentity);
  const builder = safelyValidate(trustedBuilderProvenance, (value) => validateBuilderProvenance(value, nowMs));
  const authority = safelyValidate(independentAuthorityReceipt, (value) => validateIndependentAuthorityReceipt(value, nowMs));

  let approvedStatus = "BLOCKED_MISSING_INPUT";
  if (approved.status === "INVALID") approvedStatus = "INVALID";
  else if (approved.result) {
    if (!identity) approvedStatus = "BLOCKED_NO_LOCAL_CANDIDATE";
    else if (
      approved.result.candidate_artifact_id !== identity.candidate_artifact_id ||
      approved.result.candidate_capture_id !== identity.candidate_capture_id ||
      approved.result.combined_sha256 !== identity.app_configuration.combined_sha256
    ) approvedStatus = "MISMATCH";
    else if (approved.result.validity !== "CURRENT") approvedStatus = approved.result.validity;
    else approvedStatus = "MATCH_UNVERIFIED";
  }

  let builderStatus = "BLOCKED_NO_TRUSTED_BUILDER";
  if (builder.status === "INVALID") builderStatus = "INVALID";
  else if (builder.result) {
    if (!identity) builderStatus = "BLOCKED_NO_LOCAL_CANDIDATE";
    else if (!binary.result) builderStatus = binary.status === "INVALID" ? "INVALID_BINARY_IDENTITY" : "BLOCKED_NO_CURRENT_BINARY_IDENTITY";
    else if (
      builder.result.candidate_artifact_id !== identity.candidate_artifact_id ||
      builder.result.artifact_identity !== binary.result.artifact_identity ||
      builder.result.binary_sha256 !== binary.result.binary_sha256 ||
      builder.result.source_commit !== binary.result.source_commit ||
      (expectedSourceCommit !== null && builder.result.source_commit !== expectedSourceCommit)
    ) builderStatus = "MISMATCH";
    else if (builder.result.validity !== "CURRENT") builderStatus = builder.result.validity;
    else builderStatus = "PRESENT_UNVERIFIED";
  }

  let authorityStatus = "BLOCKED_MISSING_AUTHORITY";
  if (authority.status === "INVALID") authorityStatus = "INVALID";
  else if (authority.result) {
    if (!identity) authorityStatus = "BLOCKED_NO_LOCAL_CANDIDATE";
    else if (!binary.result) authorityStatus = binary.status === "INVALID" ? "INVALID_BINARY_IDENTITY" : "BLOCKED_NO_CURRENT_BINARY_IDENTITY";
    else if (!expectedDeploymentIdentity) authorityStatus = "BLOCKED_NO_TRUSTED_DEPLOYMENT_IDENTITY";
    else if (
      authority.result.candidate_artifact_id !== identity.candidate_artifact_id ||
      authority.result.combined_sha256 !== identity.app_configuration.combined_sha256 ||
      authority.result.binary_sha256 !== binary.result.binary_sha256 ||
      !sameObjectFields(authority.result.capture_identity, captureIdentityFromVerifiedResult(identity)) ||
      !sameObjectFields(authority.result.deployment_identity, expectedDeploymentIdentity)
    ) authorityStatus = "MISMATCH";
    else if (authority.result.validity !== "CURRENT") authorityStatus = authority.result.validity;
    else authorityStatus = "PRESENT_UNVERIFIED";
  }

  const localStatus = identity
    ? syntheticFixture ? "PASS_SYNTHETIC_LOCAL_CONSISTENCY" : "PASS_LOCAL_CONSISTENCY"
    : candidateArtifactIdentity || candidateBundleStatus === "INVALID" ? "INVALID" : "NOT_EVALUATED";
  const missingInputs = [];
  if (!identity) missingInputs.push("CANDIDATE_ARTIFACT_BUNDLE");
  if (approvedStatus !== "MATCH_UNVERIFIED") missingInputs.push("APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT");
  if (!binary.result) missingInputs.push("CURRENT_BINARY_IDENTITY");
  if (builderStatus !== "PRESENT_UNVERIFIED") missingInputs.push("AUTHENTICATED_BUILDER_PROVENANCE");
  if (authorityStatus !== "PRESENT_UNVERIFIED") missingInputs.push("INDEPENDENT_AUTHORITY_RECEIPT");

  const report = {
    schema_version: CANDIDATE_CONFIGURATION_BINDING_ASSESSMENT_SCHEMA_VERSION,
    scope: CANDIDATE_CONFIGURATION_BINDING_ASSESSMENT_SCOPE,
    status: "UNVERIFIED",
    stages: {
      candidate_fingerprint_present: identity ? "PRESENT_LOCAL_CONSISTENCY" : localStatus,
      candidate_artifact_cryptographically_bound: localStatus,
      approved_expected_fingerprint_match: approvedStatus,
      binary_provenance_authenticated: "BLOCKED_NO_TRUSTED_BUILDER",
      independent_authority_provenance_verified: "BLOCKED_MISSING_AUTHORITY",
    },
    candidate_artifact_identity: identity ? {
      status: localStatus,
      candidate_artifact_id: identity.candidate_artifact_id,
      candidate_capture_id: identity.candidate_capture_id,
      presentation_sha256: identity.presentation_sha256,
      metadata_sha256: identity.metadata_sha256,
      app_configuration_fingerprint: identity.app_configuration,
      binding_status: identity.binding_status,
      authority_status: identity.authority_status,
      independent_authentication: identity.independent_authentication,
      synthetic_fixture: syntheticFixture,
    } : {
      status: localStatus,
      candidate_artifact_id: null,
      candidate_capture_id: null,
      presentation_sha256: null,
      metadata_sha256: null,
      app_configuration_fingerprint: null,
      binding_status: "UNVERIFIED",
      authority_status: "UNVERIFIED",
      independent_authentication: "UNVERIFIED",
      synthetic_fixture: syntheticFixture,
    },
    approved_expected_fingerprint: {
      status: approvedStatus,
      approval_id: approved.result?.approval_id ?? null,
      provenance_source: approved.result?.provenance_source ?? null,
      evidence_sha256: approved.result?.evidence_sha256 ?? null,
      signature_verification: "NOT_IMPLEMENTED",
      reason: approved.reason ?? null,
    },
    current_binary_identity: {
      status: binary.status === "PRESENT" ? "PRESENT_UNVERIFIED" : binary.status,
      artifact_identity: binary.result?.artifact_identity ?? null,
      binary_sha256: binary.result?.binary_sha256 ?? null,
      source_commit: binary.result?.source_commit ?? null,
      evidence_sha256: binary.result?.evidence_sha256 ?? null,
      source_authentication: "UNVERIFIED",
      reason: binary.reason ?? null,
    },
    trusted_builder_provenance: {
      status: builderStatus,
      build_workflow_identity: builder.result?.build_workflow_identity ?? null,
      toolchain_identity: builder.result?.toolchain_identity ?? null,
      builder_identity: builder.result?.builder_identity ?? null,
      artifact_identity: builder.result?.artifact_identity ?? null,
      binary_sha256: builder.result?.binary_sha256 ?? null,
      source_commit: builder.result?.source_commit ?? null,
      evidence_sha256: builder.result?.evidence_sha256 ?? null,
      signature_verification: "NOT_IMPLEMENTED",
      authority_verification: "NOT_IMPLEMENTED",
      reason: builder.reason ?? null,
    },
    independent_authority_receipt: {
      status: authorityStatus,
      authority_id: authority.result?.authority_id ?? null,
      key_id: authority.result?.key_id ?? null,
      evidence_sha256: authority.result?.evidence_sha256 ?? null,
      signature_verification: "NOT_IMPLEMENTED",
      authority_verification: "NOT_IMPLEMENTED",
      reason: authority.reason ?? null,
    },
    authority_verification: CANDIDATE_CONFIGURATION_PROVENANCE_CONTRACT.authority_verification,
    unresolved_authority_requirements: [
      "APPROVED_FINGERPRINT_SIGNATURE_VERIFIER_AND_TRUST_ROOT",
      "TRUSTED_BUILDER_SIGNATURE_VERIFIER_AND_TRUST_ROOT",
      "INDEPENDENT_AUTHORITY_SIGNATURE_VERIFIER_AND_TRUST_ROOT",
      "AUTHENTICATED_CURRENT_BINARY_IDENTITY_SOURCE",
      "AUTHENTICATED_CURRENT_DEPLOYMENT_IDENTITY_SOURCE",
    ],
    missing_inputs: missingInputs,
    readiness_effect: "NONE",
    gameplay_effect: "NONE",
  };
  VERIFIED_ASSESSMENTS.add(report);
  return report;
}

export function isCandidateConfigurationBindingAssessment(value) {
  return !!value && VERIFIED_ASSESSMENTS.has(value);
}