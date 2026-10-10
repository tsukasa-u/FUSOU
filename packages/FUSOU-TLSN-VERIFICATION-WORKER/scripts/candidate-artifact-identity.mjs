import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalJson } from "./deployment-attestation.mjs";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export const APP_CONFIGURATION_FINGERPRINT_CONTRACT = deepFreeze(JSON.parse(readFileSync(
  new URL("./app-configuration-fingerprint-contract-v2.json", import.meta.url),
  "utf8",
)));
export const CANDIDATE_ARTIFACT_IDENTITY_SCHEMA_VERSION = 2;
export const CANDIDATE_ARTIFACT_IDENTITY_SCOPE = "fusou-tlsn-candidate-artifact-identity";
export const CANDIDATE_ARTIFACT_IDENTITY_CANONICALIZATION = "FUSOU-CANONICAL-JSON-V1";
export const CANDIDATE_METADATA_SCHEMA_VERSION = 2;
export const APP_CONFIGURATION_FINGERPRINT_SCHEMA_VERSION = APP_CONFIGURATION_FINGERPRINT_CONTRACT.schema_version;
export const APP_CONFIGURATION_FINGERPRINT_SCOPE = APP_CONFIGURATION_FINGERPRINT_CONTRACT.scope;
export const CANDIDATE_IDENTITY_BODY_FIELDS = [
  "schema_version",
  "scope",
  "canonicalization",
  "candidate_capture_id",
  "session_id",
  "request_id",
  "request_sha256",
  "authenticated_request_sha256",
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
const VERIFIED_IDENTITY_RESULTS = new WeakSet();

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

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields do not match the shared contract`);
  }
}

export function appConfigurationProjectionSha256(projection, fields) {
  const expectedFields = APP_CONFIGURATION_FINGERPRINT_CONTRACT.projection_fields[projection];
  if (!expectedFields) throw new Error("APP configuration projection is not in the shared contract");
  assertExactKeys(fields, expectedFields, `${projection} APP configuration projection`);
  const preimage = {
    fields,
    projection,
    schema_version: APP_CONFIGURATION_FINGERPRINT_CONTRACT.schema_version,
    scope: APP_CONFIGURATION_FINGERPRINT_CONTRACT.scope,
  };
  assertExactKeys(preimage, APP_CONFIGURATION_FINGERPRINT_CONTRACT.projection_hash_preimage_fields, "projection hash preimage");
  return sha256(Buffer.from(canonicalJson(preimage), "utf8"));
}

export function recomputeAppConfigurationCombinedSha256({
  schema_version,
  scope,
  compile_time_sha256,
  runtime_sha256,
} = {}) {
  const preimage = {
    compile_time_sha256: requiredHash(compile_time_sha256, "APP compile-time configuration fingerprint"),
    runtime_sha256: requiredHash(runtime_sha256, "APP runtime configuration fingerprint"),
    schema_version,
    scope,
  };
  assertExactKeys(preimage, APP_CONFIGURATION_FINGERPRINT_CONTRACT.combined_hash_preimage_fields, "combined hash preimage");
  return sha256(Buffer.from(canonicalJson(preimage), "utf8"));
}

export function verifyAppConfigurationFingerprint(fingerprints) {
  assertExactKeys(fingerprints, [
    "schema_version",
    "scope",
    "compile_time_sha256",
    "runtime_sha256",
    "combined_sha256",
    "candidate_binding_status",
  ], "APP configuration fingerprint");
  if (
    fingerprints.schema_version !== APP_CONFIGURATION_FINGERPRINT_CONTRACT.schema_version ||
    fingerprints.scope !== APP_CONFIGURATION_FINGERPRINT_CONTRACT.scope ||
    fingerprints.candidate_binding_status !== "UNBOUND"
  ) {
    throw new Error("APP configuration fingerprint schema, scope, or binding status is invalid");
  }
  const compileTimeSha256 = requiredHash(fingerprints.compile_time_sha256, "APP compile-time configuration fingerprint");
  const runtimeSha256 = requiredHash(fingerprints.runtime_sha256, "APP runtime configuration fingerprint");
  const combinedSha256 = requiredHash(fingerprints.combined_sha256, "APP combined configuration fingerprint");
  if (combinedSha256 !== recomputeAppConfigurationCombinedSha256({
    schema_version: fingerprints.schema_version,
    scope: fingerprints.scope,
    compile_time_sha256: compileTimeSha256,
    runtime_sha256: runtimeSha256,
  })) {
    throw new Error("APP combined configuration fingerprint does not match its canonical preimage");
  }
  return Object.freeze({
    schema_version: fingerprints.schema_version,
    scope: fingerprints.scope,
    compile_time_sha256: compileTimeSha256,
    runtime_sha256: runtimeSha256,
    combined_sha256: combinedSha256,
  });
}

export function createCandidateArtifactIdentity({ metadataBytes, presentationBytes } = {}) {
  if (!Buffer.isBuffer(metadataBytes) || !Buffer.isBuffer(presentationBytes)) {
    throw new Error("candidate metadata and Presentation bytes are required");
  }
  const metadata = parseCanonicalJson(metadataBytes, "candidate metadata");
  const fingerprints = metadata?.proxy_provenance?.app_public_configuration_fingerprints;
  if (
    metadata?.schema_version !== CANDIDATE_METADATA_SCHEMA_VERSION ||
    !fingerprints
  ) {
    throw new Error("candidate APP configuration fingerprint contract is invalid or claims a binding");
  }
  const appConfiguration = verifyAppConfigurationFingerprint(fingerprints);
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
    request_sha256: requiredHash(metadata.request_sha256, "candidate request_sha256"),
    authenticated_request_sha256: requiredHash(
      metadata.authenticated_request_sha256,
      "candidate authenticated_request_sha256",
    ),
    binding_identifier: requiredHash(metadata.binding_identifier, "candidate binding_identifier"),
    created_at: createdAt,
    presentation_sha256: presentationSha256,
    metadata_sha256: sha256(metadataBytes),
    app_configuration: {
      schema_version: appConfiguration.schema_version,
      scope: appConfiguration.scope,
      combined_sha256: appConfiguration.combined_sha256,
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
  const result = Object.freeze({
    candidate_artifact_id: identity.candidate_artifact_id,
    candidate_capture_id: identity.candidate_capture_id,
    session_id: identity.session_id,
    request_id: identity.request_id,
    request_sha256: identity.request_sha256,
    authenticated_request_sha256: identity.authenticated_request_sha256,
    binding_identifier: identity.binding_identifier,
    created_at: identity.created_at,
    presentation_sha256: identity.presentation_sha256,
    metadata_sha256: identity.metadata_sha256,
    binding_status: identity.binding_status,
    authority_status: identity.authority_status,
    independent_authentication: identity.independent_authentication,
    app_configuration: Object.freeze({ ...identity.app_configuration }),
  });
  VERIFIED_IDENTITY_RESULTS.add(result);
  return result;
}

export function isCandidateArtifactIdentityVerificationResult(value) {
  return !!value && VERIFIED_IDENTITY_RESULTS.has(value);
}