import { createHash } from "node:crypto";
import { canonicalJson } from "./deployment-attestation.mjs";

export const CANDIDATE_ARTIFACT_IDENTITY_SCHEMA_VERSION = 1;
export const CANDIDATE_ARTIFACT_IDENTITY_SCOPE = "fusou-tlsn-candidate-artifact-identity";
export const CANDIDATE_ARTIFACT_IDENTITY_CANONICALIZATION = "FUSOU-CANONICAL-JSON-V1";
export const CANDIDATE_METADATA_SCHEMA_VERSION = 2;
export const APP_CONFIGURATION_FINGERPRINT_SCHEMA_VERSION = 2;
export const APP_CONFIGURATION_FINGERPRINT_SCOPE = "fusou-tlsn-app-public-configuration";
export const CANDIDATE_IDENTITY_BODY_FIELDS = [
  "schema_version",
  "scope",
  "canonicalization",
  "candidate_capture_id",
  "session_id",
  "request_id",
  "request_sha256",
  "binding_identifier",
  "created_at",
  "presentation_sha256",
  "metadata_sha256",
  "app_configuration",
  "binding_status",
  "authority_status",
  "independent_authentication",
];

const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function parseCanonicalJson(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON`);
  }
  if (canonicalJson(value) !== bytes.toString("utf8")) {
    throw new Error(`${label} is not canonical JSON`);
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is missing`);
  return value;
}

function requiredHash(value, label) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) throw new Error(`${label} is invalid`);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) throw new Error(`${label} is not canonical SHA-256`);
  return value;
}

export function createCandidateArtifactIdentity({ metadataBytes, presentationBytes } = {}) {
  if (!Buffer.isBuffer(metadataBytes) || !Buffer.isBuffer(presentationBytes)) {
    throw new Error("candidate metadata and Presentation bytes are required");
  }
  const metadata = parseCanonicalJson(metadataBytes, "candidate metadata");
  const fingerprints = metadata?.proxy_provenance?.app_public_configuration_fingerprints;
  if (
    metadata?.schema_version !== CANDIDATE_METADATA_SCHEMA_VERSION ||
    fingerprints?.schema_version !== APP_CONFIGURATION_FINGERPRINT_SCHEMA_VERSION ||
    fingerprints?.scope !== APP_CONFIGURATION_FINGERPRINT_SCOPE ||
    fingerprints?.candidate_binding_status !== "UNBOUND"
  ) {
    throw new Error("candidate APP configuration fingerprint contract is invalid or claims a binding");
  }
  const presentationSha256 = sha256(presentationBytes);
  if (metadata.presentation_sha256 !== presentationSha256) {
    throw new Error("candidate metadata Presentation digest does not match exact bytes");
  }
  const createdAt = requiredString(metadata.capture_timestamp, "candidate metadata capture_timestamp");
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("candidate metadata capture_timestamp is invalid");

  const body = {
    schema_version: CANDIDATE_ARTIFACT_IDENTITY_SCHEMA_VERSION,
    scope: CANDIDATE_ARTIFACT_IDENTITY_SCOPE,
    canonicalization: CANDIDATE_ARTIFACT_IDENTITY_CANONICALIZATION,
    candidate_capture_id: requiredString(metadata.candidate_capture_id, "candidate_capture_id"),
    session_id: requiredString(metadata.session_id, "candidate session_id"),
    request_id: requiredString(metadata.request_id, "candidate request_id"),
    request_sha256: requiredHash(metadata.authenticated_request_sha256, "candidate authenticated_request_sha256"),
    binding_identifier: requiredHash(metadata.binding_identifier, "candidate binding_identifier"),
    created_at: createdAt,
    presentation_sha256: presentationSha256,
    metadata_sha256: sha256(metadataBytes),
    app_configuration: {
      schema_version: fingerprints.schema_version,
      scope: fingerprints.scope,
      combined_sha256: requiredHash(fingerprints.combined_sha256, "APP combined configuration fingerprint"),
    },
    binding_status: "CRYPTOGRAPHICALLY_BOUND",
    authority_status: "LOCAL_CONSISTENCY",
    independent_authentication: "UNVERIFIED",
  };
  return {
    ...body,
    candidate_artifact_id: sha256(Buffer.from(canonicalJson(body), "utf8")),
  };
}

export function assertCandidateArtifactIdentity({
  identityBytes,
  metadataBytes,
  presentationBytes,
  expectedCandidateArtifactId,
} = {}) {
  const identity = parseCanonicalJson(identityBytes, "candidate artifact identity");
  const expected = createCandidateArtifactIdentity({ metadataBytes, presentationBytes });
  if (canonicalJson(identity) !== canonicalJson(expected)) {
    throw new Error("candidate artifact identity does not match its exact bytes or capture context");
  }
  if (identity.candidate_artifact_id !== expectedCandidateArtifactId) {
    throw new Error("candidate artifact identity does not match the candidate manifest");
  }
  return {
    candidate_artifact_id: identity.candidate_artifact_id,
    binding_status: identity.binding_status,
    authority_status: identity.authority_status,
    independent_authentication: identity.independent_authentication,
  };
}