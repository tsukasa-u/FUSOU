const REQUEST_SCOPE = "fusou-tlsn-runtime-config-freshness-request-v1";
const RESPONSE_ENVELOPE_SCOPE =
  "fusou-tlsn-runtime-config-freshness-envelope-v1";
const RESPONSE_PAYLOAD_SCOPE =
  "fusou-tlsn-runtime-config-freshness-response-v1";
const DELEGATION_ENVELOPE_SCOPE =
  "fusou-tlsn-runtime-config-delegation-envelope-v1";
const DELEGATION_PAYLOAD_SCOPE =
  "fusou-tlsn-runtime-config-delegation-v1";
const RELEASE_ENVELOPE_SCOPE =
  "fusou-tlsn-runtime-config-release-commit-envelope-v1";
const RELEASE_PAYLOAD_SCOPE =
  "fusou-tlsn-runtime-config-release-commit-v1";
const RUNTIME_CONFIG_MANIFEST_ENVELOPE_SCOPE =
  "fusou-tlsn-runtime-config-envelope-v2";
const RUNTIME_CONFIG_DELEGATED_MANIFEST_ENVELOPE_SCOPE =
  "fusou-tlsn-runtime-config-envelope-v3";
const RUNTIME_CONFIG_MANIFEST_PAYLOAD_SCOPE =
  "fusou-tlsn-runtime-config-manifest-v2";
const RUNTIME_CONFIG_MANIFEST_DELEGATION_SCOPE =
  "fusou-tlsn-runtime-config-manifest-delegation-v1";
const RUNTIME_CONFIG_MANIFEST_DELEGATION_PURPOSE =
  "runtime-config-manifest-v1";
const FRESHNESS_DELEGATION_DOMAIN = new TextEncoder().encode(
  "FUSOU-TLSN-RUNTIME-CONFIG-DELEGATION-V1\0",
);
const RELEASE_COMMIT_DOMAIN = new TextEncoder().encode(
  "FUSOU-TLSN-RUNTIME-CONFIG-RELEASE-COMMIT-V1\0",
);
const RUNTIME_CONFIG_MANIFEST_DOMAIN = new TextEncoder().encode(
  "FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V2\0",
);
const RUNTIME_CONFIG_DELEGATED_MANIFEST_DOMAIN = new TextEncoder().encode(
  "FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V3\0",
);
const RUNTIME_CONFIG_MANIFEST_DELEGATION_DOMAIN = new TextEncoder().encode(
  "FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-DELEGATION-V1\0",
);
const FRESHNESS_RESPONSE_DOMAIN = new TextEncoder().encode(
  "FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-RESPONSE-V1\0",
);
const RELEASE_AUDIENCE_PREFIX = "fusou-tlsn-runtime-config-v2:";
const IMMUTABLE_MANIFEST_PREFIX = "tlsn/runtime-config/v2/manifests/";
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DNS_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const MAX_REQUEST_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_FRESHNESS_DELEGATION_SECONDS = 86_400;
const MAX_RELEASE_DELEGATION_SECONDS = 2_592_000;
const MAX_RESPONSE_LIFETIME_MS = 30_000;
const MAX_CLOCK_SKEW_MS = 30_000;

const REQUEST_FIELDS = [
  "schema_version",
  "scope",
  "environment",
  "audience_manifest_url_sha256",
  "request_nonce",
];
const DELEGATION_ENVELOPE_FIELDS = [
  "schema_version",
  "scope",
  "signature_algorithm",
  "root_key_id",
  "payload_base64url",
  "signature_base64url",
];
const DELEGATION_PAYLOAD_FIELDS = [
  "schema_version",
  "scope",
  "delegation_id",
  "delegation_generation",
  "environment",
  "purpose",
  "key_id",
  "public_key_spki",
  "signature_algorithm",
  "audience",
  "issued_at",
  "not_before",
  "not_after",
  "max_validity_seconds",
  "revocation_mode",
  "previous_delegation_sha256",
];
const RELEASE_ENVELOPE_FIELDS = [
  "schema_version",
  "scope",
  "signature_algorithm",
  "signer_key_id",
  "payload_base64url",
  "signature_base64url",
];
const RELEASE_PAYLOAD_FIELDS = [
  "schema_version",
  "scope",
  "environment",
  "commit_authorization",
  "commit_generation",
  "release_commit_id",
  "manifest_schema_version",
  "manifest_epoch",
  "manifest_sha256",
  "manifest_ref",
  "pointer_etag",
  "previous_commit_generation",
  "previous_commit_record_sha256",
  "authorized_at",
  "release_authority_delegation_id",
  "release_authority_delegation_sha256",
];
const RUNTIME_CONFIG_MANIFEST_ENVELOPE_FIELDS = [
  "schema_version",
  "scope",
  "signature_algorithm",
  "signer_key_id",
  "payload_base64url",
  "signature_base64url",
];
const RUNTIME_CONFIG_DELEGATED_MANIFEST_ENVELOPE_FIELDS = [
  ...RUNTIME_CONFIG_MANIFEST_ENVELOPE_FIELDS,
  "manifest_authority_delegation_base64url",
];
const RUNTIME_CONFIG_MANIFEST_PAYLOAD_FIELDS = [
  "schema_version",
  "scope",
  "environment",
  "epoch",
  "issued_at",
  "not_before",
  "expires_at",
  "source",
  "compile_inputs",
  "production_authority_pins",
  "result_registry_pins",
];
const RUNTIME_CONFIG_MANIFEST_DELEGATION_ENVELOPE_FIELDS = [
  "schema_version",
  "scope",
  "signature_algorithm",
  "root_key_id",
  "payload_base64url",
  "signature_base64url",
];
const RUNTIME_CONFIG_MANIFEST_DELEGATION_PAYLOAD_FIELDS = [
  "schema_version",
  "scope",
  "purpose",
  "environment",
  "key_id",
  "public_key_spki",
  "signature_algorithm",
  "audience_manifest_url_sha256",
  "manifest_envelope_schema_version",
  "manifest_payload_schema_version",
  "approved_config_sha256",
  "delegation_generation",
  "issued_at",
  "not_before",
  "not_after",
  "max_validity_seconds",
  "revocation_mode",
];
const RUNTIME_CONFIG_MANIFEST_SOURCE_FIELDS = [
  "worker_reference_sha256",
  "observed_at",
  "account_id",
  "script_name",
  "logical_deployment_id",
  "cloudflare_deployment_id",
  "active_version_id",
  "worker_git_commit_sha",
  "disclosure_mode",
];
const RUNTIME_CONFIG_MANIFEST_COMPILE_INPUT_FIELDS = [
  "FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID",
  "FUSOU_TLSN_EXPECTED_BINDING_MODE",
  "FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID",
  "FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA",
  "FUSOU_TLSN_EXPECTED_WORKER_NAME",
  "FUSOU_TLSN_NOTARY_ENDPOINT",
  "FUSOU_TLSN_NOTARY_VERIFYING_KEY",
  "FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI",
  "FUSOU_TLSN_RESULT_SIGNER_KEY_ID",
  "FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY",
  "FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT",
  "FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT",
  "FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID",
  "FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY",
  "FUSOU_TLSN_VERIFICATION_ENDPOINT",
];
const RUNTIME_CONFIG_MANIFEST_AUTHORITY_PIN_FIELDS = [
  "origin_inventory_sha256",
  "target_approval_artifact_sha256",
  "security_registry_set_sha256",
];
const RUNTIME_CONFIG_MANIFEST_RESULT_PIN_FIELDS = [
  "result_registry_sha256",
  "result_registry_envelope_sha256",
  "result_registry_root_key_id",
  "result_registry_root_public_key_spki",
];
const RUNTIME_CONFIG_MANIFEST_MAX_DELEGATION_SECONDS = 86_400;
const RUNTIME_CONFIG_MANIFEST_REVOCATION_MODE =
  "expiry-and-client-high-water-v1";
const RESPONSE_ENVELOPE_FIELDS = [
  "schema_version",
  "scope",
  "signature_algorithm",
  "signer_key_id",
  "freshness_delegation_base64url",
  "release_authority_delegation_base64url",
  "release_commit_record_base64url",
  "payload_base64url",
  "signature_base64url",
];
const RESPONSE_PAYLOAD_FIELDS = [
  "schema_version",
  "scope",
  "freshness_semantics",
  "environment",
  "audience_manifest_url_sha256",
  "request_nonce",
  "issued_at",
  "expires_at",
  "latest_epoch",
  "manifest_schema_version",
  "manifest_sha256",
  "manifest_ref",
  "pointer_generation",
  "release_commit_id",
  "release_commit_record_sha256",
  "release_commit_record_appended_at",
  "freshness_signer_key_id",
  "freshness_delegation_id",
  "freshness_delegation_sha256",
  "release_authority_key_id",
  "release_authority_delegation_id",
  "release_authority_delegation_sha256",
];

export type RuntimeConfigDomainErrorCode =
  | "INVALID_WIRE"
  | "INVALID_SIGNATURE"
  | "INVALID_BINDING"
  | "INVALID_TIME";

export class RuntimeConfigDomainError extends Error {
  readonly code: RuntimeConfigDomainErrorCode;

  constructor(code: RuntimeConfigDomainErrorCode, message: string) {
    super(message);
    this.name = "RuntimeConfigDomainError";
    this.code = code;
  }
}

export interface FreshnessRequest {
  readonly schema_version: 1;
  readonly scope: typeof REQUEST_SCOPE;
  readonly environment: "production";
  readonly audience_manifest_url_sha256: string;
  readonly request_nonce: string;
}

export interface DelegationEnvelope {
  readonly schema_version: 1;
  readonly scope: typeof DELEGATION_ENVELOPE_SCOPE;
  readonly signature_algorithm: "Ed25519";
  readonly root_key_id: string;
  readonly payload_base64url: string;
  readonly signature_base64url: string;
}

export type DelegationPurpose =
  | "freshness-response-v1"
  | "release-commit-record-v1";

export interface DelegationPayload {
  readonly schema_version: 1;
  readonly scope: typeof DELEGATION_PAYLOAD_SCOPE;
  readonly delegation_id: string;
  readonly delegation_generation: string;
  readonly environment: "production";
  readonly purpose: DelegationPurpose;
  readonly key_id: string;
  readonly public_key_spki: string;
  readonly signature_algorithm: "Ed25519";
  readonly audience: string;
  readonly issued_at: string;
  readonly not_before: string;
  readonly not_after: string;
  readonly max_validity_seconds: number;
  readonly revocation_mode: "expiry-only-v1";
  readonly previous_delegation_sha256: string | null;
}

export interface ReleaseCommitRecordEnvelope {
  readonly schema_version: 1;
  readonly scope: typeof RELEASE_ENVELOPE_SCOPE;
  readonly signature_algorithm: "Ed25519";
  readonly signer_key_id: string;
  readonly payload_base64url: string;
  readonly signature_base64url: string;
}

export interface ReleaseCommitRecordPayload {
  readonly schema_version: 1;
  readonly scope: typeof RELEASE_PAYLOAD_SCOPE;
  readonly environment: "production";
  readonly commit_authorization: "AUTHORIZE_JOURNAL_APPEND";
  readonly commit_generation: string;
  readonly release_commit_id: string;
  readonly manifest_schema_version: 2;
  readonly manifest_epoch: string;
  readonly manifest_sha256: string;
  readonly manifest_ref: string;
  readonly pointer_etag: string;
  readonly previous_commit_generation: string | null;
  readonly previous_commit_record_sha256: string | null;
  readonly authorized_at: string;
  readonly release_authority_delegation_id: string;
  readonly release_authority_delegation_sha256: string;
}

export interface FreshnessResponseEnvelope {
  readonly schema_version: 1;
  readonly scope: typeof RESPONSE_ENVELOPE_SCOPE;
  readonly signature_algorithm: "Ed25519";
  readonly signer_key_id: string;
  readonly freshness_delegation_base64url: string;
  readonly release_authority_delegation_base64url: string;
  readonly release_commit_record_base64url: string;
  readonly payload_base64url: string;
  readonly signature_base64url: string;
}

export interface FreshnessResponsePayload {
  readonly schema_version: 1;
  readonly scope: typeof RESPONSE_PAYLOAD_SCOPE;
  readonly freshness_semantics: "LATEST_AT_ISSUANCE";
  readonly environment: "production";
  readonly audience_manifest_url_sha256: string;
  readonly request_nonce: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly latest_epoch: string;
  readonly manifest_schema_version: 2;
  readonly manifest_sha256: string;
  readonly manifest_ref: string;
  readonly pointer_generation: string;
  readonly release_commit_id: string;
  readonly release_commit_record_sha256: string;
  readonly release_commit_record_appended_at: string;
  readonly freshness_signer_key_id: string;
  readonly freshness_delegation_id: string;
  readonly freshness_delegation_sha256: string;
  readonly release_authority_key_id: string;
  readonly release_authority_delegation_id: string;
  readonly release_authority_delegation_sha256: string;
}

export interface RuntimeConfigRootSigner {
  readonly scope: "fusou-tlsn-runtime-config-signing-root-v2";
  readonly key_id: string;
  readonly public_key_spki: string;
}

export interface VerifiedRuntimeConfigManifestEpochPointer {
  readonly epoch: string;
  readonly manifestSha256: string;
  readonly issuedAtMs: number;
  readonly notBeforeMs: number;
  readonly expiresAtMs: number;
  readonly envelopeSchemaVersion: 2 | 3;
  readonly signerKeyId: string;
  readonly manifestAuthorityGeneration: string | null;
  readonly manifestAuthorityDelegationSha256: string | null;
  readonly approvedConfigSha256: string | null;
}

export interface VerifiedDelegation<P extends DelegationPurpose = DelegationPurpose> {
  readonly payload: DelegationPayload & { readonly purpose: P };
  readonly digest: string;
  readonly raw: Uint8Array;
  readonly notBeforeMs: number;
  readonly notAfterMs: number;
}

export interface VerifiedReleaseCommitRecord {
  readonly envelope: ReleaseCommitRecordEnvelope;
  readonly payload: ReleaseCommitRecordPayload;
  readonly delegation: VerifiedDelegation<"release-commit-record-v1">;
  readonly digest: string;
  readonly appendedAtMs: number;
}

export interface VerifiedFreshnessResponse {
  readonly envelope: FreshnessResponseEnvelope;
  readonly payload: FreshnessResponsePayload;
  readonly freshnessDelegation: VerifiedDelegation<"freshness-response-v1">;
  readonly releaseCommit: VerifiedReleaseCommitRecord;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

export interface PendingReleaseAttemptBinding {
  readonly attempt_id: string;
  readonly environment: "production";
  readonly commit_generation: string;
  readonly release_commit_id: string;
  readonly manifest_schema_version: 2;
  readonly manifest_epoch: string;
  readonly manifest_sha256: string;
  readonly manifest_ref: string;
  readonly pointer_etag: string;
  readonly previous_commit_generation: string | null;
  readonly previous_commit_record_sha256: string | null;
  readonly release_authority_delegation_id: string;
  readonly release_authority_delegation_sha256: string;
}

export interface VerifiedJournalHeadBinding {
  readonly generation: string;
  readonly record_sha256: string;
  readonly manifest_epoch: string;
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  assertWellFormedJson(value, "JSON value");
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(canonicalize(value));
  } catch {
    invalid("INVALID_WIRE", "JSON value cannot be canonically serialized");
  }
  if (encoded === undefined) {
    invalid("INVALID_WIRE", "JSON value cannot be canonically serialized");
  }
  return new TextEncoder().encode(encoded);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    invalid("INVALID_WIRE", "JSON number is not finite");
  }
  return value;
}

function assertWellFormedJson(value: unknown, label: string): void {
  // Rust's serde_json rejects lone UTF-16 surrogates instead of canonicalizing them.
  if (typeof value === "string") {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          invalid("INVALID_WIRE", `${label} contains an unpaired surrogate`);
        }
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        invalid("INVALID_WIRE", `${label} contains an unpaired surrogate`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertWellFormedJson(item, label);
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      assertWellFormedJson(key, label);
      assertWellFormedJson(item, label);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseCanonicalObject<T extends object>(
  raw: Uint8Array,
  expectedFields: readonly string[],
  label: string,
  maxBytes: number,
  isExpectedType: (value: unknown) => value is T,
): T {
  if (raw.byteLength > maxBytes) {
    invalid("INVALID_WIRE", `${label} exceeds its byte limit`);
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    invalid("INVALID_WIRE", `${label} is not valid UTF-8 JSON`);
  }
  if (!isRecord(value)) invalid("INVALID_WIRE", `${label} must be a JSON object`);
  assertWellFormedJson(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expectedFields].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    invalid("INVALID_WIRE", `${label} has missing or unknown fields`);
  }
  if (!isExpectedType(value)) invalid("INVALID_WIRE", `${label} has invalid field types`);
  if (!bytesEqual(canonicalJsonBytes(value), raw)) {
    invalid("INVALID_WIRE", `${label} is not canonical JSON`);
  }
  return value;
}

function isFreshnessRequest(value: unknown): value is FreshnessRequest {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    value.scope === REQUEST_SCOPE &&
    typeof value.environment === "string" &&
    typeof value.audience_manifest_url_sha256 === "string" &&
    typeof value.request_nonce === "string"
  );
}

function isDelegationEnvelope(value: unknown): value is DelegationEnvelope {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    value.scope === DELEGATION_ENVELOPE_SCOPE &&
    value.signature_algorithm === "Ed25519" &&
    typeof value.root_key_id === "string" &&
    typeof value.payload_base64url === "string" &&
    typeof value.signature_base64url === "string"
  );
}

function isDelegationPayload(value: unknown): value is DelegationPayload {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    value.scope === DELEGATION_PAYLOAD_SCOPE &&
    typeof value.delegation_id === "string" &&
    typeof value.delegation_generation === "string" &&
    typeof value.environment === "string" &&
    typeof value.purpose === "string" &&
    typeof value.key_id === "string" &&
    typeof value.public_key_spki === "string" &&
    value.signature_algorithm === "Ed25519" &&
    typeof value.audience === "string" &&
    typeof value.issued_at === "string" &&
    typeof value.not_before === "string" &&
    typeof value.not_after === "string" &&
    typeof value.max_validity_seconds === "number" &&
    Number.isSafeInteger(value.max_validity_seconds) &&
    value.revocation_mode === "expiry-only-v1" &&
    (value.previous_delegation_sha256 === null ||
      typeof value.previous_delegation_sha256 === "string")
  );
}

function isReleaseEnvelope(
  value: unknown,
): value is ReleaseCommitRecordEnvelope {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    value.scope === RELEASE_ENVELOPE_SCOPE &&
    value.signature_algorithm === "Ed25519" &&
    typeof value.signer_key_id === "string" &&
    typeof value.payload_base64url === "string" &&
    typeof value.signature_base64url === "string"
  );
}

interface RuntimeConfigManifestEnvelope {
  readonly schema_version: 2;
  readonly scope: typeof RUNTIME_CONFIG_MANIFEST_ENVELOPE_SCOPE;
  readonly signature_algorithm: "Ed25519";
  readonly signer_key_id: string;
  readonly payload_base64url: string;
  readonly signature_base64url: string;
}

interface RuntimeConfigDelegatedManifestEnvelope {
  readonly schema_version: 3;
  readonly scope: typeof RUNTIME_CONFIG_DELEGATED_MANIFEST_ENVELOPE_SCOPE;
  readonly signature_algorithm: "Ed25519";
  readonly signer_key_id: string;
  readonly manifest_authority_delegation_base64url: string;
  readonly payload_base64url: string;
  readonly signature_base64url: string;
}

interface RuntimeConfigManifestDelegationEnvelope {
  readonly schema_version: 1;
  readonly scope: typeof RUNTIME_CONFIG_MANIFEST_DELEGATION_SCOPE;
  readonly signature_algorithm: "Ed25519";
  readonly root_key_id: string;
  readonly payload_base64url: string;
  readonly signature_base64url: string;
}

interface RuntimeConfigManifestDelegationPayload {
  readonly schema_version: 1;
  readonly scope: typeof RUNTIME_CONFIG_MANIFEST_DELEGATION_SCOPE;
  readonly purpose: typeof RUNTIME_CONFIG_MANIFEST_DELEGATION_PURPOSE;
  readonly environment: "production";
  readonly key_id: string;
  readonly public_key_spki: string;
  readonly signature_algorithm: "Ed25519";
  readonly audience_manifest_url_sha256: string;
  readonly manifest_envelope_schema_version: 3;
  readonly manifest_payload_schema_version: 2;
  readonly approved_config_sha256: string;
  readonly delegation_generation: string;
  readonly issued_at: string;
  readonly not_before: string;
  readonly not_after: string;
  readonly max_validity_seconds: number;
  readonly revocation_mode: typeof RUNTIME_CONFIG_MANIFEST_REVOCATION_MODE;
}

interface RuntimeConfigManifestPayload {
  readonly schema_version: 2;
  readonly scope: typeof RUNTIME_CONFIG_MANIFEST_PAYLOAD_SCOPE;
  readonly environment: string;
  readonly epoch: string;
  readonly issued_at: string;
  readonly not_before: string;
  readonly expires_at: string;
  readonly source: unknown;
  readonly compile_inputs: unknown;
  readonly production_authority_pins: unknown;
  readonly result_registry_pins: unknown;
}

function isRuntimeConfigManifestEnvelope(
  value: unknown,
): value is RuntimeConfigManifestEnvelope {
  return (
    isRecord(value) &&
    value.schema_version === 2 &&
    value.scope === RUNTIME_CONFIG_MANIFEST_ENVELOPE_SCOPE &&
    value.signature_algorithm === "Ed25519" &&
    typeof value.signer_key_id === "string" &&
    typeof value.payload_base64url === "string" &&
    typeof value.signature_base64url === "string"
  );
}

function isRuntimeConfigDelegatedManifestEnvelope(
  value: unknown,
): value is RuntimeConfigDelegatedManifestEnvelope {
  return (
    isRecord(value) &&
    value.schema_version === 3 &&
    value.scope === RUNTIME_CONFIG_DELEGATED_MANIFEST_ENVELOPE_SCOPE &&
    value.signature_algorithm === "Ed25519" &&
    typeof value.signer_key_id === "string" &&
    typeof value.manifest_authority_delegation_base64url === "string" &&
    typeof value.payload_base64url === "string" &&
    typeof value.signature_base64url === "string"
  );
}

function isRuntimeConfigManifestDelegationEnvelope(
  value: unknown,
): value is RuntimeConfigManifestDelegationEnvelope {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    value.scope === RUNTIME_CONFIG_MANIFEST_DELEGATION_SCOPE &&
    value.signature_algorithm === "Ed25519" &&
    typeof value.root_key_id === "string" &&
    typeof value.payload_base64url === "string" &&
    typeof value.signature_base64url === "string"
  );
}

function isRuntimeConfigManifestDelegationPayload(
  value: unknown,
): value is RuntimeConfigManifestDelegationPayload {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    value.scope === RUNTIME_CONFIG_MANIFEST_DELEGATION_SCOPE &&
    value.purpose === RUNTIME_CONFIG_MANIFEST_DELEGATION_PURPOSE &&
    value.environment === "production" &&
    typeof value.key_id === "string" &&
    typeof value.public_key_spki === "string" &&
    value.signature_algorithm === "Ed25519" &&
    typeof value.audience_manifest_url_sha256 === "string" &&
    value.manifest_envelope_schema_version === 3 &&
    value.manifest_payload_schema_version === 2 &&
    typeof value.approved_config_sha256 === "string" &&
    typeof value.delegation_generation === "string" &&
    typeof value.issued_at === "string" &&
    typeof value.not_before === "string" &&
    typeof value.not_after === "string" &&
    typeof value.max_validity_seconds === "number" &&
    Number.isSafeInteger(value.max_validity_seconds) &&
    value.revocation_mode === RUNTIME_CONFIG_MANIFEST_REVOCATION_MODE
  );
}

function isRuntimeConfigManifestPayload(
  value: unknown,
): value is RuntimeConfigManifestPayload {
  return (
    isRecord(value) &&
    value.schema_version === 2 &&
    value.scope === RUNTIME_CONFIG_MANIFEST_PAYLOAD_SCOPE &&
    typeof value.environment === "string" &&
    typeof value.epoch === "string" &&
    typeof value.issued_at === "string" &&
    typeof value.not_before === "string" &&
    typeof value.expires_at === "string" &&
    "source" in value &&
    "compile_inputs" in value &&
    "production_authority_pins" in value &&
    "result_registry_pins" in value
  );
}

function isReleasePayload(
  value: unknown,
): value is ReleaseCommitRecordPayload {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    value.scope === RELEASE_PAYLOAD_SCOPE &&
    typeof value.environment === "string" &&
    value.commit_authorization === "AUTHORIZE_JOURNAL_APPEND" &&
    typeof value.commit_generation === "string" &&
    typeof value.release_commit_id === "string" &&
    value.manifest_schema_version === 2 &&
    typeof value.manifest_epoch === "string" &&
    typeof value.manifest_sha256 === "string" &&
    typeof value.manifest_ref === "string" &&
    typeof value.pointer_etag === "string" &&
    (value.previous_commit_generation === null ||
      typeof value.previous_commit_generation === "string") &&
    (value.previous_commit_record_sha256 === null ||
      typeof value.previous_commit_record_sha256 === "string") &&
    typeof value.authorized_at === "string" &&
    typeof value.release_authority_delegation_id === "string" &&
    typeof value.release_authority_delegation_sha256 === "string"
  );
}

function isResponseEnvelope(
  value: unknown,
): value is FreshnessResponseEnvelope {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    value.scope === RESPONSE_ENVELOPE_SCOPE &&
    value.signature_algorithm === "Ed25519" &&
    typeof value.signer_key_id === "string" &&
    typeof value.freshness_delegation_base64url === "string" &&
    typeof value.release_authority_delegation_base64url === "string" &&
    typeof value.release_commit_record_base64url === "string" &&
    typeof value.payload_base64url === "string" &&
    typeof value.signature_base64url === "string"
  );
}

function isResponsePayload(
  value: unknown,
): value is FreshnessResponsePayload {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    value.scope === RESPONSE_PAYLOAD_SCOPE &&
    value.freshness_semantics === "LATEST_AT_ISSUANCE" &&
    typeof value.environment === "string" &&
    typeof value.audience_manifest_url_sha256 === "string" &&
    typeof value.request_nonce === "string" &&
    typeof value.issued_at === "string" &&
    typeof value.expires_at === "string" &&
    typeof value.latest_epoch === "string" &&
    value.manifest_schema_version === 2 &&
    typeof value.manifest_sha256 === "string" &&
    typeof value.manifest_ref === "string" &&
    typeof value.pointer_generation === "string" &&
    typeof value.release_commit_id === "string" &&
    typeof value.release_commit_record_sha256 === "string" &&
    typeof value.release_commit_record_appended_at === "string" &&
    typeof value.freshness_signer_key_id === "string" &&
    typeof value.freshness_delegation_id === "string" &&
    typeof value.freshness_delegation_sha256 === "string" &&
    typeof value.release_authority_key_id === "string" &&
    typeof value.release_authority_delegation_id === "string" &&
    typeof value.release_authority_delegation_sha256 === "string"
  );
}

function parseRequest(raw: Uint8Array): FreshnessRequest {
  return parseCanonicalObject(
    raw,
    REQUEST_FIELDS,
    "Freshness request",
    MAX_REQUEST_BYTES,
    isFreshnessRequest,
  );
}

function parseDelegationEnvelope(raw: Uint8Array): DelegationEnvelope {
  const envelope = parseCanonicalObject(
    raw,
    DELEGATION_ENVELOPE_FIELDS,
    "delegation envelope",
    MAX_RESPONSE_BYTES,
    isDelegationEnvelope,
  );
  assertKeyId(envelope.root_key_id, "delegation root key ID");
  return envelope;
}

function parseDelegationPayload(raw: Uint8Array): DelegationPayload {
  return parseCanonicalObject(
    raw,
    DELEGATION_PAYLOAD_FIELDS,
    "delegation payload",
    MAX_RESPONSE_BYTES,
    isDelegationPayload,
  );
}

function parseReleaseEnvelope(raw: Uint8Array): ReleaseCommitRecordEnvelope {
  const envelope = parseCanonicalObject(
    raw,
    RELEASE_ENVELOPE_FIELDS,
    "Release Commit Record envelope",
    MAX_RESPONSE_BYTES,
    isReleaseEnvelope,
  );
  assertKeyId(envelope.signer_key_id, "Release Authority signer key ID");
  return envelope;
}

function parseReleasePayload(raw: Uint8Array): ReleaseCommitRecordPayload {
  return parseCanonicalObject(
    raw,
    RELEASE_PAYLOAD_FIELDS,
    "Release Commit Record payload",
    MAX_RESPONSE_BYTES,
    isReleasePayload,
  );
}

function parseResponseEnvelope(raw: Uint8Array): FreshnessResponseEnvelope {
  const envelope = parseCanonicalObject(
    raw,
    RESPONSE_ENVELOPE_FIELDS,
    "Freshness response envelope",
    MAX_RESPONSE_BYTES,
    isResponseEnvelope,
  );
  assertKeyId(envelope.signer_key_id, "Freshness signer key ID");
  return envelope;
}

function parseResponsePayload(raw: Uint8Array): FreshnessResponsePayload {
  return parseCanonicalObject(
    raw,
    RESPONSE_PAYLOAD_FIELDS,
    "Freshness response payload",
    MAX_RESPONSE_BYTES,
    isResponsePayload,
  );
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeCanonicalBase64Url(
  value: string,
  label: string,
  expectedLength?: number,
): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    invalid("INVALID_WIRE", `${label} is not canonical unpadded base64url`);
  }
  let decoded: string;
  try {
    const standard = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
    decoded = atob(padded);
  } catch {
    invalid("INVALID_WIRE", `${label} is not canonical unpadded base64url`);
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (
    encodeBase64Url(bytes) !== value ||
    (expectedLength !== undefined && bytes.byteLength !== expectedLength)
  ) {
    invalid("INVALID_WIRE", `${label} is not canonical unpadded base64url`);
  }
  return bytes;
}

export function parseCanonicalUnsignedDecimal(
  value: string,
  label: string,
  allowZero = false,
): bigint {
  if (
    !/^(?:0|[1-9][0-9]*)$/u.test(value) ||
    (!allowZero && value === "0")
  ) {
    invalid("INVALID_WIRE", `${label} is not a canonical unsigned decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT64_MAX) invalid("INVALID_WIRE", `${label} exceeds UInt64`);
  return parsed;
}

function assertKeyId(value: string, label: string): void {
  if (!KEY_ID_PATTERN.test(value)) invalid("INVALID_WIRE", `${label} is invalid`);
}

function assertDigest(value: string, label: string): void {
  if (!SHA256_BASE64URL_PATTERN.test(value)) {
    invalid("INVALID_WIRE", `${label} must be a SHA-256 base64url digest`);
  }
  decodeCanonicalBase64Url(value, label, 32);
}

function assertUuidV4(value: string, label: string): void {
  if (!UUID_V4_PATTERN.test(value)) {
    invalid("INVALID_WIRE", `${label} must be a lowercase canonical UUIDv4`);
  }
}

function parseTimestamp(value: string, label: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    invalid("INVALID_TIME", `${label} must be canonical UTC millisecond time`);
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    invalid("INVALID_TIME", `${label} is not a valid canonical UTC timestamp`);
  }
  return milliseconds;
}

function rustTrimHasBoundaryWhitespace(value: string): boolean {
  const codePoints = Array.from(value, (character) => character.codePointAt(0)!);
  const isWhitespace = (codePoint: number): boolean =>
    (codePoint >= 0x09 && codePoint <= 0x0d) ||
    codePoint === 0x20 ||
    codePoint === 0x85 ||
    codePoint === 0xa0 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000;
  return (
    codePoints.length === 0 ||
    isWhitespace(codePoints[0]!) ||
    isWhitespace(codePoints[codePoints.length - 1]!)
  );
}

function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", toArrayBuffer(bytes))
    .then((digest) => encodeBase64Url(new Uint8Array(digest)));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function concatenateBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function signaturePreimage(
  domain: Uint8Array,
  keyId: string,
  payloadBytes: Uint8Array,
): Uint8Array {
  assertKeyId(keyId, "signer key ID");
  const keyIdBytes = new TextEncoder().encode(keyId);
  if (keyIdBytes.byteLength > 0xffff) {
    invalid("INVALID_WIRE", "signer key ID is too long");
  }
  const length = new Uint8Array([keyIdBytes.byteLength >>> 8, keyIdBytes.byteLength & 0xff]);
  return concatenateBytes(domain, length, keyIdBytes, payloadBytes);
}

async function verifyEd25519(
  publicKeySpki: string,
  domain: Uint8Array,
  keyId: string,
  payloadBytes: Uint8Array,
  signatureBase64Url: string,
  label: string,
): Promise<void> {
  const spki = decodeCanonicalBase64Url(publicKeySpki, `${label} SPKI`, 44);
  if (!ED25519_SPKI_PREFIX.every((byte, index) => spki[index] === byte)) {
    invalid("INVALID_WIRE", `${label} SPKI is not canonical Ed25519`);
  }
  const signature = decodeCanonicalBase64Url(
    signatureBase64Url,
    `${label} signature`,
    64,
  );
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(spki),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    invalid("INVALID_WIRE", `${label} SPKI cannot be imported as Ed25519`);
  }
  const verified = await crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    toArrayBuffer(signature),
    toArrayBuffer(signaturePreimage(domain, keyId, payloadBytes)),
  );
  if (!verified) invalid("INVALID_SIGNATURE", `${label} signature verification failed`);
}

export async function createRuntimeConfigFreshnessRequest(options: {
  readonly manifestUrl: string;
  readonly requestNonce: Uint8Array;
}): Promise<{ readonly request: FreshnessRequest; readonly raw: Uint8Array }> {
  if (options.requestNonce.byteLength !== 32) {
    invalid("INVALID_WIRE", "Freshness request nonce must be 32 bytes");
  }
  const request: FreshnessRequest = Object.freeze({
    schema_version: 1,
    scope: REQUEST_SCOPE,
    environment: "production",
    audience_manifest_url_sha256: await runtimeConfigManifestAudienceSha256(
      options.manifestUrl,
    ),
    request_nonce: encodeBase64Url(options.requestNonce),
  });
  const raw = canonicalJsonBytes(request);
  if (raw.byteLength > MAX_REQUEST_BYTES) {
    invalid("INVALID_WIRE", "Freshness request exceeds its byte limit");
  }
  return Object.freeze({ request, raw });
}

function validateManifestUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid("INVALID_WIRE", "Freshness request Manifest URL is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    !DNS_HOSTNAME_PATTERN.test(parsed.hostname) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== "/tlsn/runtime-config/v2/manifest.json" ||
    parsed.href !== value
  ) {
    invalid("INVALID_WIRE", "Freshness request Manifest URL is invalid");
  }
  return value;
}

export async function runtimeConfigManifestAudienceSha256(
  manifestUrl: string,
): Promise<string> {
  const validatedUrl = validateManifestUrl(manifestUrl);
  return sha256Base64Url(new TextEncoder().encode(validatedUrl));
}

export async function verifyRuntimeConfigFreshnessRequest(
  raw: Uint8Array,
  expected: {
    readonly environment: "production";
    readonly audienceManifestUrlSha256: string;
  },
): Promise<FreshnessRequest> {
  const request = parseRequest(raw);
  if (
    request.schema_version !== 1 ||
    request.scope !== REQUEST_SCOPE ||
    request.environment !== expected.environment ||
    request.audience_manifest_url_sha256 !== expected.audienceManifestUrlSha256
  ) {
    invalid("INVALID_BINDING", "Freshness request scope, environment, or audience is invalid");
  }
  assertDigest(request.audience_manifest_url_sha256, "Freshness request audience");
  decodeCanonicalBase64Url(request.request_nonce, "Freshness request nonce", 32);
  return request;
}

export async function verifyRuntimeConfigDelegation<P extends DelegationPurpose>(options: {
  readonly raw: Uint8Array;
  readonly rootSigner: RuntimeConfigRootSigner;
  readonly expectedPurpose: P;
  readonly expectedEnvironment: "production";
  readonly expectedAudience: string;
  readonly signerNowMs?: number;
}): Promise<VerifiedDelegation<P>> {
  if (options.rootSigner.scope !== "fusou-tlsn-runtime-config-signing-root-v2") {
    invalid("INVALID_BINDING", "Bootstrap signer is not scoped to Runtime Config");
  }
  assertKeyId(options.rootSigner.key_id, "Bootstrap signer key ID");
  const envelope = parseDelegationEnvelope(options.raw);
  if (envelope.root_key_id !== options.rootSigner.key_id) {
    invalid("INVALID_BINDING", "delegation root key ID does not match the Bootstrap pin");
  }
  const payloadBytes = decodeCanonicalBase64Url(
    envelope.payload_base64url,
    "delegation payload",
  );
  await verifyEd25519(
    options.rootSigner.public_key_spki,
    FRESHNESS_DELEGATION_DOMAIN,
    envelope.root_key_id,
    payloadBytes,
    envelope.signature_base64url,
    "delegation",
  );
  const payload = parseDelegationPayload(payloadBytes);
  const expectedLifetime =
    options.expectedPurpose === "freshness-response-v1"
      ? MAX_FRESHNESS_DELEGATION_SECONDS
      : MAX_RELEASE_DELEGATION_SECONDS;
  if (
    payload.schema_version !== 1 ||
    payload.scope !== DELEGATION_PAYLOAD_SCOPE ||
    payload.signature_algorithm !== "Ed25519" ||
    payload.revocation_mode !== "expiry-only-v1" ||
    payload.purpose !== options.expectedPurpose ||
    payload.environment !== options.expectedEnvironment ||
    payload.audience !== options.expectedAudience ||
    payload.max_validity_seconds !== expectedLifetime
  ) {
    invalid("INVALID_BINDING", "delegation scope, purpose, audience, or algorithm is invalid");
  }
  assertUuidV4(payload.delegation_id, "delegation ID");
  assertKeyId(payload.key_id, "delegated key ID");
  const delegatedSpki = decodeCanonicalBase64Url(
    payload.public_key_spki,
    "delegated Ed25519 SPKI",
    44,
  );
  if (!ED25519_SPKI_PREFIX.every((byte, index) => delegatedSpki[index] === byte)) {
    invalid("INVALID_WIRE", "delegated SPKI is not canonical Ed25519");
  }
  try {
    await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(delegatedSpki),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    invalid("INVALID_WIRE", "delegated SPKI cannot be imported as Ed25519");
  }
  const generation = parseCanonicalUnsignedDecimal(
    payload.delegation_generation,
    "delegation generation",
  );
  const issuedAtMs = parseTimestamp(payload.issued_at, "delegation issued_at");
  const notBeforeMs = parseTimestamp(payload.not_before, "delegation not_before");
  const notAfterMs = parseTimestamp(payload.not_after, "delegation not_after");
  if (
    issuedAtMs > notBeforeMs ||
    notBeforeMs >= notAfterMs ||
    notAfterMs - issuedAtMs > expectedLifetime * 1_000
  ) {
    invalid("INVALID_TIME", "delegation validity interval exceeds its strict lifetime");
  }
  if (generation === 1n) {
    if (payload.previous_delegation_sha256 !== null) {
      invalid("INVALID_BINDING", "first delegation must not have a previous digest");
    }
  } else {
    assertDigest(payload.previous_delegation_sha256 ?? "", "previous delegation digest");
  }
  if (options.signerNowMs !== undefined) {
    if (!Number.isSafeInteger(options.signerNowMs)) {
      invalid("INVALID_TIME", "delegation signer time is invalid");
    }
    if (options.signerNowMs < notBeforeMs || options.signerNowMs >= notAfterMs) {
      invalid("INVALID_TIME", "delegation is not active at signer time");
    }
  }
  const verifiedPayload: DelegationPayload & { readonly purpose: P } = {
    ...payload,
    purpose: options.expectedPurpose,
  };
  return Object.freeze({
    payload: Object.freeze(verifiedPayload),
    digest: await sha256Base64Url(options.raw),
    raw: options.raw.slice(),
    notBeforeMs,
    notAfterMs,
  });
}

export function assertFreshnessDelegationActive(
  delegation: VerifiedDelegation<"freshness-response-v1">,
  appNowMs: number,
): void {
  if (!Number.isSafeInteger(appNowMs)) {
    invalid("INVALID_TIME", "APP verification time is invalid");
  }
  if (
    appNowMs - MAX_CLOCK_SKEW_MS < delegation.notBeforeMs ||
    appNowMs + MAX_CLOCK_SKEW_MS >= delegation.notAfterMs
  ) {
    invalid("INVALID_TIME", "Freshness delegation is outside the conservative APP validity window");
  }
}

export async function verifyRuntimeConfigReleaseCommitRecord(options: {
  readonly raw: Uint8Array;
  readonly rootSigner: RuntimeConfigRootSigner;
  readonly environment: "production";
  readonly releaseDelegationRaw: Uint8Array;
  readonly appendedAt: string;
}): Promise<VerifiedReleaseCommitRecord> {
  const delegation = await verifyRuntimeConfigDelegation({
    raw: options.releaseDelegationRaw,
    rootSigner: options.rootSigner,
    expectedPurpose: "release-commit-record-v1",
    expectedEnvironment: options.environment,
    expectedAudience: `${RELEASE_AUDIENCE_PREFIX}${options.environment}`,
  });
  const envelope = parseReleaseEnvelope(options.raw);
  if (envelope.signer_key_id !== delegation.payload.key_id) {
    invalid("INVALID_BINDING", "Release Authority signer key ID does not match its delegation");
  }
  const payloadBytes = decodeCanonicalBase64Url(
    envelope.payload_base64url,
    "Release Commit Record payload",
  );
  await verifyEd25519(
    delegation.payload.public_key_spki,
    RELEASE_COMMIT_DOMAIN,
    envelope.signer_key_id,
    payloadBytes,
    envelope.signature_base64url,
    "Release Commit Record",
  );
  const payload = parseReleasePayload(payloadBytes);
  if (
    payload.schema_version !== 1 ||
    payload.scope !== RELEASE_PAYLOAD_SCOPE ||
    payload.environment !== options.environment ||
    payload.commit_authorization !== "AUTHORIZE_JOURNAL_APPEND" ||
    payload.manifest_schema_version !== 2 ||
    payload.release_authority_delegation_id !== delegation.payload.delegation_id ||
    payload.release_authority_delegation_sha256 !== delegation.digest
  ) {
    invalid("INVALID_BINDING", "Release Commit Record fields do not match its delegation");
  }
  const generation = parseCanonicalUnsignedDecimal(
    payload.commit_generation,
    "commit generation",
  );
  parseCanonicalUnsignedDecimal(payload.manifest_epoch, "Manifest epoch");
  assertDigest(payload.manifest_sha256, "Manifest digest");
  assertDigest(
    payload.release_authority_delegation_sha256,
    "Release delegation digest",
  );
  assertUuidV4(payload.release_commit_id, "release commit ID");
  if (
    payload.manifest_ref !==
    `${IMMUTABLE_MANIFEST_PREFIX}${payload.manifest_sha256}`
  ) {
    invalid("INVALID_BINDING", "Release Commit Record Manifest reference is not content addressed");
  }
  if (rustTrimHasBoundaryWhitespace(payload.pointer_etag)) {
    invalid("INVALID_WIRE", "Release Commit Record pointer ETag is invalid");
  }
  if (generation === 1n) {
    if (
      payload.previous_commit_generation !== null ||
      payload.previous_commit_record_sha256 !== null
    ) {
      invalid("INVALID_BINDING", "genesis Release Commit Record has an invalid previous head");
    }
  } else {
    const previousGeneration = parseCanonicalUnsignedDecimal(
      payload.previous_commit_generation ?? "",
      "previous commit generation",
    );
    if (previousGeneration + 1n !== generation) {
      invalid("INVALID_BINDING", "Release Commit Record generation is not contiguous");
    }
    assertDigest(
      payload.previous_commit_record_sha256 ?? "",
      "previous Release Commit Record digest",
    );
  }
  const authorizedAtMs = parseTimestamp(payload.authorized_at, "authorized_at");
  const appendedAtMs = parseTimestamp(options.appendedAt, "Journal appended_at");
  if (
    authorizedAtMs < delegation.notBeforeMs ||
    authorizedAtMs >= delegation.notAfterMs ||
    appendedAtMs < delegation.notBeforeMs ||
    appendedAtMs >= delegation.notAfterMs ||
    authorizedAtMs > appendedAtMs
  ) {
    invalid("INVALID_TIME", "Release authorization and Journal append times are outside delegation");
  }
  return Object.freeze({
    envelope,
    payload,
    delegation,
    digest: await sha256Base64Url(options.raw),
    appendedAtMs,
  });
}

function assertManifestExactKeys(
  value: unknown,
  fields: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) invalid("INVALID_WIRE", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    invalid("INVALID_WIRE", `${label} has missing or unknown fields`);
  }
}

async function manifestApprovedConfigurationSha256(
  payload: RuntimeConfigManifestPayload,
  manifestUrl: string,
): Promise<string> {
  assertManifestExactKeys(payload.source, RUNTIME_CONFIG_MANIFEST_SOURCE_FIELDS, "Manifest source");
  assertManifestExactKeys(
    payload.compile_inputs,
    RUNTIME_CONFIG_MANIFEST_COMPILE_INPUT_FIELDS,
    "Manifest compile inputs",
  );
  assertManifestExactKeys(
    payload.production_authority_pins,
    RUNTIME_CONFIG_MANIFEST_AUTHORITY_PIN_FIELDS,
    "Manifest Production authority pins",
  );
  assertManifestExactKeys(
    payload.result_registry_pins,
    RUNTIME_CONFIG_MANIFEST_RESULT_PIN_FIELDS,
    "Manifest Result registry pins",
  );
  const source = payload.source;
  const compileInputs = payload.compile_inputs;
  const authorityPins = payload.production_authority_pins;
  const resultPins = payload.result_registry_pins;
  for (const [label, value] of [
    ...Object.entries(source),
    ...Object.entries(compileInputs),
    ...Object.entries(authorityPins),
    ...Object.entries(resultPins),
  ]) {
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      invalid("INVALID_WIRE", `Manifest approved configuration field ${label} is invalid`);
    }
  }
  const sourceProjection = Object.fromEntries(
    [
      "account_id",
      "script_name",
      "logical_deployment_id",
      "cloudflare_deployment_id",
      "active_version_id",
      "worker_git_commit_sha",
      "disclosure_mode",
    ].map((key) => [key, source[key]]),
  );
  const projection = {
    schema_version: 1,
    scope: "fusou-tlsn-runtime-config-approved-config-v1",
    environment: payload.environment,
    manifest_url_sha256: await runtimeConfigManifestAudienceSha256(manifestUrl),
    manifest_payload_schema_version: payload.schema_version,
    source: sourceProjection,
    compile_inputs: compileInputs,
    production_authority_pins: authorityPins,
    result_registry_pins: resultPins,
  };
  return sha256Base64Url(canonicalJsonBytes(projection));
}

async function verifyManifestAuthorityDelegation(options: {
  readonly raw: Uint8Array;
  readonly rootSigner: RuntimeConfigRootSigner;
  readonly payload: RuntimeConfigManifestPayload;
  readonly manifestUrl: string;
  readonly nowMs: number;
  readonly maxClockSkewSeconds: number;
}): Promise<{
  readonly generation: string;
  readonly digest: string;
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly approvedConfigSha256: string;
  readonly audienceSha256: string;
  readonly notBeforeMs: number;
  readonly notAfterMs: number;
}> {
  const envelope = parseCanonicalObject(
    options.raw,
    RUNTIME_CONFIG_MANIFEST_DELEGATION_ENVELOPE_FIELDS,
    "Manifest authority delegation envelope",
    16_384,
    isRuntimeConfigManifestDelegationEnvelope,
  );
  if (envelope.root_key_id !== options.rootSigner.key_id) {
    invalid("INVALID_BINDING", "Manifest delegation root key ID does not match the bootstrap root");
  }
  const payloadBytes = decodeCanonicalBase64Url(
    envelope.payload_base64url,
    "Manifest authority delegation payload",
  );
  await verifyEd25519(
    options.rootSigner.public_key_spki,
    RUNTIME_CONFIG_MANIFEST_DELEGATION_DOMAIN,
    envelope.root_key_id,
    payloadBytes,
    envelope.signature_base64url,
    "Manifest authority delegation",
  );
  const delegation = parseCanonicalObject(
    payloadBytes,
    RUNTIME_CONFIG_MANIFEST_DELEGATION_PAYLOAD_FIELDS,
    "Manifest authority delegation payload",
    16_384,
    isRuntimeConfigManifestDelegationPayload,
  );
  assertKeyId(delegation.key_id, "Manifest child key ID");
  assertDigest(delegation.audience_manifest_url_sha256, "Manifest authority audience");
  assertDigest(delegation.approved_config_sha256, "Manifest approved configuration digest");
  const generation = parseCanonicalUnsignedDecimal(
    delegation.delegation_generation,
    "Manifest authority generation",
  );
  if (
    generation === 0n ||
    delegation.key_id === options.rootSigner.key_id ||
    delegation.public_key_spki === options.rootSigner.public_key_spki
  ) {
    invalid("INVALID_BINDING", "Manifest child key must be distinct from the bootstrap root");
  }
  const audienceSha256 = await runtimeConfigManifestAudienceSha256(options.manifestUrl);
  if (delegation.audience_manifest_url_sha256 !== audienceSha256) {
    invalid("INVALID_BINDING", "Manifest authority audience does not match the bootstrap URL");
  }
  const expectedConfigSha256 = await manifestApprovedConfigurationSha256(
    options.payload,
    options.manifestUrl,
  );
  if (delegation.approved_config_sha256 !== expectedConfigSha256) {
    invalid("INVALID_BINDING", "Manifest differs from the root-approved configuration");
  }

  const issuedAtMs = parseTimestamp(delegation.issued_at, "Manifest delegation issued_at");
  const notBeforeMs = parseTimestamp(delegation.not_before, "Manifest delegation not_before");
  const notAfterMs = parseTimestamp(delegation.not_after, "Manifest delegation not_after");
  const maxValidityMs = delegation.max_validity_seconds * 1_000;
  const skewMs = options.maxClockSkewSeconds * 1_000;
  if (
    delegation.schema_version !== 1 ||
    delegation.scope !== RUNTIME_CONFIG_MANIFEST_DELEGATION_SCOPE ||
    delegation.purpose !== RUNTIME_CONFIG_MANIFEST_DELEGATION_PURPOSE ||
    delegation.environment !== "production" ||
    delegation.signature_algorithm !== "Ed25519" ||
    delegation.manifest_envelope_schema_version !== 3 ||
    delegation.manifest_payload_schema_version !== 2 ||
    delegation.revocation_mode !== RUNTIME_CONFIG_MANIFEST_REVOCATION_MODE ||
    !Number.isSafeInteger(delegation.max_validity_seconds) ||
    delegation.max_validity_seconds < 1 ||
    delegation.max_validity_seconds > RUNTIME_CONFIG_MANIFEST_MAX_DELEGATION_SECONDS ||
    !Number.isSafeInteger(options.maxClockSkewSeconds) ||
    options.maxClockSkewSeconds < 0 ||
    issuedAtMs > notBeforeMs ||
    notBeforeMs >= notAfterMs ||
    notAfterMs - issuedAtMs > maxValidityMs ||
    notAfterMs - issuedAtMs >
      RUNTIME_CONFIG_MANIFEST_MAX_DELEGATION_SECONDS * 1_000 ||
    issuedAtMs > options.nowMs + skewMs ||
    notBeforeMs > options.nowMs + skewMs ||
    notAfterMs <= options.nowMs - skewMs
  ) {
    invalid("INVALID_TIME", "Manifest delegation is outside its root-issued validity");
  }
  return Object.freeze({
    generation: delegation.delegation_generation,
    digest: await sha256Base64Url(options.raw),
    keyId: delegation.key_id,
    publicKeySpki: delegation.public_key_spki,
    approvedConfigSha256: delegation.approved_config_sha256,
    audienceSha256,
    notBeforeMs,
    notAfterMs,
  });
}

export async function verifyRuntimeConfigManifestEpochPointer(options: {
  readonly raw: Uint8Array;
  readonly trustedSigner: RuntimeConfigRootSigner;
  readonly maxEnvelopeBytes?: number;
  readonly manifestUrl?: string;
  readonly nowMs?: number;
  readonly maxClockSkewSeconds?: number;
  readonly lastAcceptedEpoch?: string;
  readonly lastAcceptedManifestSha256?: string | null;
  readonly lastAcceptedManifestAuthorityGeneration?: string;
  readonly lastAcceptedManifestAuthorityDelegationSha256?: string | null;
}): Promise<VerifiedRuntimeConfigManifestEpochPointer> {
  const maxEnvelopeBytes = options.maxEnvelopeBytes ?? 1_048_576;
  if (
    !Number.isSafeInteger(maxEnvelopeBytes) ||
    maxEnvelopeBytes < 1 ||
    options.raw.byteLength > maxEnvelopeBytes
  ) {
    invalid("INVALID_WIRE", "Runtime Config Manifest envelope byte limit is invalid");
  }
  if (
    options.trustedSigner.scope !==
    "fusou-tlsn-runtime-config-signing-root-v2"
  ) {
    invalid("INVALID_BINDING", "Manifest signer is not scoped to Runtime Config");
  }
  assertKeyId(options.trustedSigner.key_id, "Manifest signer key ID");
  let envelopeHeader: unknown;
  try {
    envelopeHeader = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(options.raw));
  } catch {
    invalid("INVALID_WIRE", "Runtime Config Manifest envelope is malformed JSON");
  }
  if (!isRecord(envelopeHeader)) {
    invalid("INVALID_WIRE", "Runtime Config Manifest envelope must be an object");
  }
  const generationBefore = options.lastAcceptedManifestAuthorityGeneration ?? "0";
  const previousGeneration = parseCanonicalUnsignedDecimal(
    generationBefore,
    "persisted Manifest authority generation",
    true,
  );
  const previousDelegationDigest =
    options.lastAcceptedManifestAuthorityDelegationSha256 ?? null;
  if (
    (previousGeneration === 0n && previousDelegationDigest !== null) ||
    (previousGeneration > 0n && previousDelegationDigest === null)
  ) {
    invalid("INVALID_BINDING", "Persisted Manifest authority high-water is inconsistent");
  }
  if (previousDelegationDigest !== null) {
    assertDigest(previousDelegationDigest, "persisted Manifest authority delegation digest");
  }
  const previousEpoch = parseCanonicalUnsignedDecimal(
    options.lastAcceptedEpoch ?? "0",
    "persisted Manifest epoch",
    true,
  );
  const previousManifestDigest = options.lastAcceptedManifestSha256 ?? null;
  if (
    (previousEpoch === 0n && previousManifestDigest !== null) ||
    (previousEpoch > 0n && previousManifestDigest === null)
  ) {
    invalid("INVALID_BINDING", "Persisted Manifest epoch high-water is inconsistent");
  }
  if (previousManifestDigest !== null) {
    assertDigest(previousManifestDigest, "persisted Manifest digest");
  }

  let payload: RuntimeConfigManifestPayload;
  let signerKeyId: string;
  let envelopeSchemaVersion: 2 | 3;
  let authorityGeneration: string | null = null;
  let authorityDigest: string | null = null;
  let approvedConfigSha256: string | null = null;
  if (envelopeHeader.schema_version === 2) {
    if (previousGeneration > 0n) {
      invalid("INVALID_BINDING", "Runtime Config Manifest authentication downgrade is not allowed");
    }
    const envelope = parseCanonicalObject(
      options.raw,
      RUNTIME_CONFIG_MANIFEST_ENVELOPE_FIELDS,
      "Runtime Config Manifest envelope",
      maxEnvelopeBytes,
      isRuntimeConfigManifestEnvelope,
    );
    if (envelope.signer_key_id !== options.trustedSigner.key_id) {
      invalid("INVALID_BINDING", "Manifest v2 signer does not match the external root pin");
    }
    const payloadBytes = decodeCanonicalBase64Url(
      envelope.payload_base64url,
      "Runtime Config Manifest payload",
    );
    await verifyEd25519(
      options.trustedSigner.public_key_spki,
      RUNTIME_CONFIG_MANIFEST_DOMAIN,
      envelope.signer_key_id,
      payloadBytes,
      envelope.signature_base64url,
      "Runtime Config Manifest",
    );
    payload = parseCanonicalObject(
      payloadBytes,
      RUNTIME_CONFIG_MANIFEST_PAYLOAD_FIELDS,
      "Runtime Config Manifest payload",
      maxEnvelopeBytes,
      isRuntimeConfigManifestPayload,
    );
    signerKeyId = envelope.signer_key_id;
    envelopeSchemaVersion = 2;
  } else if (envelopeHeader.schema_version === 3) {
    const nowMs = options.nowMs;
    const maxClockSkewSeconds = options.maxClockSkewSeconds ?? 30;
    if (
      typeof options.manifestUrl !== "string" ||
      typeof nowMs !== "number" ||
      !Number.isSafeInteger(nowMs) ||
      !Number.isSafeInteger(maxClockSkewSeconds) ||
      maxClockSkewSeconds < 0
    ) {
      invalid("INVALID_BINDING", "Delegated Manifest verification context is incomplete");
    }
    const envelope = parseCanonicalObject(
      options.raw,
      RUNTIME_CONFIG_DELEGATED_MANIFEST_ENVELOPE_FIELDS,
      "Delegated Runtime Config Manifest envelope",
      maxEnvelopeBytes,
      isRuntimeConfigDelegatedManifestEnvelope,
    );
    const payloadBytes = decodeCanonicalBase64Url(
      envelope.payload_base64url,
      "Runtime Config Manifest payload",
    );
    payload = parseCanonicalObject(
      payloadBytes,
      RUNTIME_CONFIG_MANIFEST_PAYLOAD_FIELDS,
      "Runtime Config Manifest payload",
      maxEnvelopeBytes,
      isRuntimeConfigManifestPayload,
    );
    if (payload.environment !== "production") {
      invalid("INVALID_BINDING", "Runtime Config Manifest environment is invalid");
    }
    const authorityRaw = decodeCanonicalBase64Url(
      envelope.manifest_authority_delegation_base64url,
      "Manifest authority delegation bytes",
    );
    const authority = await verifyManifestAuthorityDelegation({
      raw: authorityRaw,
      rootSigner: options.trustedSigner,
      payload,
      manifestUrl: options.manifestUrl,
      nowMs,
      maxClockSkewSeconds,
    });
    if (envelope.signer_key_id !== authority.keyId) {
      invalid("INVALID_BINDING", "Manifest child signer does not match its root delegation");
    }
    const issuedAt = parseTimestamp(payload.issued_at, "Manifest issued_at");
    const notBefore = parseTimestamp(payload.not_before, "Manifest not_before");
    const expiresAt = parseTimestamp(payload.expires_at, "Manifest expires_at");
    const skewMs = maxClockSkewSeconds * 1_000;
    if (
      issuedAt < authority.notBeforeMs ||
      issuedAt >= authority.notAfterMs ||
      notBefore < authority.notBeforeMs ||
      expiresAt > authority.notAfterMs ||
      issuedAt > nowMs + skewMs ||
      notBefore > nowMs + skewMs ||
      expiresAt <= nowMs - skewMs ||
      expiresAt - notBefore > 3_600_000
    ) {
      invalid("INVALID_TIME", "Manifest validity exceeds its root delegation");
    }
    if (
      BigInt(authority.generation) < previousGeneration ||
      (BigInt(authority.generation) === previousGeneration &&
        authority.digest !== previousDelegationDigest)
    ) {
      invalid("INVALID_BINDING", "Manifest authority is below persisted high-water");
    }
    await verifyEd25519(
      authority.publicKeySpki,
      RUNTIME_CONFIG_DELEGATED_MANIFEST_DOMAIN,
      envelope.signer_key_id,
      payloadBytes,
      envelope.signature_base64url,
      "Delegated Runtime Config Manifest",
    );
    signerKeyId = envelope.signer_key_id;
    envelopeSchemaVersion = 3;
    authorityGeneration = authority.generation;
    authorityDigest = authority.digest;
    approvedConfigSha256 = authority.approvedConfigSha256;
  } else {
    invalid("INVALID_WIRE", "Runtime Config Manifest envelope version is unsupported");
  }
  if (payload.environment !== "production") {
    invalid("INVALID_BINDING", "Runtime Config Manifest environment is invalid");
  }
  parseCanonicalUnsignedDecimal(payload.epoch, "Runtime Config Manifest epoch");
  const issuedAtMs = parseTimestamp(payload.issued_at, "Manifest issued_at");
  const notBeforeMs = parseTimestamp(payload.not_before, "Manifest not_before");
  const expiresAtMs = parseTimestamp(payload.expires_at, "Manifest expires_at");
  if (issuedAtMs > notBeforeMs || notBeforeMs >= expiresAtMs) {
    invalid(
      "INVALID_TIME",
      "Runtime Config Manifest validity timestamps are invalid",
    );
  }

  const manifestSha256 = await sha256Base64Url(options.raw);
  const manifestEpoch = parseCanonicalUnsignedDecimal(
    payload.epoch,
    "Manifest epoch",
  );
  if (
    manifestEpoch < previousEpoch ||
    (manifestEpoch === previousEpoch &&
      manifestSha256 !== previousManifestDigest)
  ) {
    invalid("INVALID_BINDING", "Manifest epoch is below or conflicts with persisted high-water");
  }
  return Object.freeze({
    epoch: payload.epoch,
    manifestSha256,
    issuedAtMs,
    notBeforeMs,
    expiresAtMs,
    envelopeSchemaVersion,
    signerKeyId,
    manifestAuthorityGeneration: authorityGeneration,
    manifestAuthorityDelegationSha256: authorityDigest,
    approvedConfigSha256,
  });
}

export async function signRuntimeConfigFreshnessResponseEnvelope(options: {
  readonly payload: FreshnessResponsePayload;
  readonly signerKeyId: string;
  readonly privateKey: CryptoKey;
  readonly freshnessDelegationBytes: Uint8Array;
  readonly releaseDelegationBytes: Uint8Array;
  readonly releaseRecordBytes: Uint8Array;
}): Promise<Uint8Array> {
  assertKeyId(options.signerKeyId, "Freshness signer key ID");
  if (
    options.privateKey.type !== "private" ||
    options.privateKey.algorithm.name !== "Ed25519" ||
    !options.privateKey.usages.includes("sign")
  ) {
    invalid("INVALID_BINDING", "Freshness signer key is not an Ed25519 signing key");
  }
  const payloadBytes = canonicalJsonBytes(options.payload);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      options.privateKey,
      toArrayBuffer(signaturePreimage(
        FRESHNESS_RESPONSE_DOMAIN,
        options.signerKeyId,
        payloadBytes,
      )),
    ),
  );
  return canonicalJsonBytes({
    schema_version: 1,
    scope: RESPONSE_ENVELOPE_SCOPE,
    signature_algorithm: "Ed25519",
    signer_key_id: options.signerKeyId,
    freshness_delegation_base64url: encodeBase64Url(
      options.freshnessDelegationBytes,
    ),
    release_authority_delegation_base64url: encodeBase64Url(
      options.releaseDelegationBytes,
    ),
    release_commit_record_base64url: encodeBase64Url(
      options.releaseRecordBytes,
    ),
    payload_base64url: encodeBase64Url(payloadBytes),
    signature_base64url: encodeBase64Url(signature),
  });
}

export function assertReleaseCommitRecordMatchesAttempt(
  record: VerifiedReleaseCommitRecord,
  attempt: PendingReleaseAttemptBinding,
): void {
  const payload = record.payload;
  if (
    attempt.attempt_id !== payload.release_commit_id ||
    attempt.environment !== payload.environment ||
    attempt.commit_generation !== payload.commit_generation ||
    attempt.release_commit_id !== payload.release_commit_id ||
    attempt.manifest_schema_version !== payload.manifest_schema_version ||
    attempt.manifest_epoch !== payload.manifest_epoch ||
    attempt.manifest_sha256 !== payload.manifest_sha256 ||
    attempt.manifest_ref !== payload.manifest_ref ||
    attempt.pointer_etag !== payload.pointer_etag ||
    attempt.previous_commit_generation !== payload.previous_commit_generation ||
    attempt.previous_commit_record_sha256 !==
      payload.previous_commit_record_sha256 ||
    attempt.release_authority_delegation_id !==
      payload.release_authority_delegation_id ||
    attempt.release_authority_delegation_sha256 !==
      payload.release_authority_delegation_sha256
  ) {
    invalid("INVALID_BINDING", "Release Commit Record is not for the exact pending attempt");
  }
}

export async function verifyRuntimeConfigFreshnessResponse(options: {
  readonly raw: Uint8Array;
  readonly bootstrapSigner: RuntimeConfigRootSigner;
  readonly manifestUrl: string;
  readonly request: FreshnessRequest;
  readonly nowMs: number;
  readonly highWater?: { readonly generation: string; readonly digest: string };
}): Promise<VerifiedFreshnessResponse> {
  if (!Number.isSafeInteger(options.nowMs)) {
    invalid("INVALID_TIME", "APP verification time is invalid");
  }
  const manifestUrl = validateManifestUrl(options.manifestUrl);
  const audience = await sha256Base64Url(new TextEncoder().encode(manifestUrl));
  if (
    options.request.schema_version !== 1 ||
    options.request.scope !== REQUEST_SCOPE ||
    options.request.environment !== "production" ||
    options.request.audience_manifest_url_sha256 !== audience
  ) {
    invalid("INVALID_BINDING", "outstanding APP challenge does not match the Manifest URL");
  }
  decodeCanonicalBase64Url(options.request.request_nonce, "outstanding request nonce", 32);
  const envelope = parseResponseEnvelope(options.raw);
  const freshnessDelegationRaw = decodeCanonicalBase64Url(
    envelope.freshness_delegation_base64url,
    "Freshness delegation",
  );
  const releaseDelegationRaw = decodeCanonicalBase64Url(
    envelope.release_authority_delegation_base64url,
    "Release Authority delegation",
  );
  const recordRaw = decodeCanonicalBase64Url(
    envelope.release_commit_record_base64url,
    "Release Commit Record",
  );
  const payloadBytes = decodeCanonicalBase64Url(
    envelope.payload_base64url,
    "Freshness response payload",
  );
  const freshnessDelegation = await verifyRuntimeConfigDelegation({
    raw: freshnessDelegationRaw,
    rootSigner: options.bootstrapSigner,
    expectedPurpose: "freshness-response-v1",
    expectedEnvironment: "production",
    expectedAudience: audience,
  });
  assertFreshnessDelegationActive(freshnessDelegation, options.nowMs);
  if (envelope.signer_key_id !== freshnessDelegation.payload.key_id) {
    invalid("INVALID_BINDING", "Freshness response key ID does not match its delegation");
  }
  await verifyEd25519(
    freshnessDelegation.payload.public_key_spki,
    FRESHNESS_RESPONSE_DOMAIN,
    envelope.signer_key_id,
    payloadBytes,
    envelope.signature_base64url,
    "Freshness response",
  );
  const payload = parseResponsePayload(payloadBytes);
  if (
    payload.schema_version !== 1 ||
    payload.scope !== RESPONSE_PAYLOAD_SCOPE ||
    payload.freshness_semantics !== "LATEST_AT_ISSUANCE" ||
    payload.environment !== "production" ||
    payload.audience_manifest_url_sha256 !== audience ||
    payload.request_nonce !== options.request.request_nonce ||
    payload.freshness_signer_key_id !== envelope.signer_key_id ||
    payload.freshness_delegation_id !== freshnessDelegation.payload.delegation_id ||
    payload.freshness_delegation_sha256 !== freshnessDelegation.digest
  ) {
    invalid("INVALID_BINDING", "Freshness response does not bind the outstanding APP challenge");
  }
  if (options.highWater) {
    const previousGeneration = parseCanonicalUnsignedDecimal(
      options.highWater.generation,
      "persisted Freshness delegation generation",
    );
    const currentGeneration = parseCanonicalUnsignedDecimal(
      freshnessDelegation.payload.delegation_generation,
      "Freshness delegation generation",
    );
    if (currentGeneration < previousGeneration) {
      invalid("INVALID_BINDING", "Freshness delegation generation rollback");
    }
    if (currentGeneration === previousGeneration) {
      if (freshnessDelegation.digest !== options.highWater.digest) {
        invalid("INVALID_BINDING", "same Freshness delegation generation has different bytes");
      }
    } else if (
      currentGeneration !== previousGeneration + 1n ||
      freshnessDelegation.payload.previous_delegation_sha256 !==
        options.highWater.digest
    ) {
      invalid("INVALID_BINDING", "Freshness delegation chain does not extend persisted state");
    }
  }
  const issuedAtMs = parseTimestamp(payload.issued_at, "Freshness issued_at");
  const expiresAtMs = parseTimestamp(payload.expires_at, "Freshness expires_at");
  if (
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > MAX_RESPONSE_LIFETIME_MS ||
    issuedAtMs > options.nowMs + MAX_CLOCK_SKEW_MS ||
    expiresAtMs <= options.nowMs - MAX_CLOCK_SKEW_MS
  ) {
    invalid("INVALID_TIME", "Freshness response is outside its permitted time window");
  }
  if (
    issuedAtMs < freshnessDelegation.notBeforeMs ||
    issuedAtMs >= freshnessDelegation.notAfterMs ||
    expiresAtMs > freshnessDelegation.notAfterMs
  ) {
    invalid("INVALID_TIME", "Freshness response validity exceeds its delegation");
  }
  const releaseDelegation = await verifyRuntimeConfigDelegation({
    raw: releaseDelegationRaw,
    rootSigner: options.bootstrapSigner,
    expectedPurpose: "release-commit-record-v1",
    expectedEnvironment: "production",
    expectedAudience: `${RELEASE_AUDIENCE_PREFIX}production`,
  });
  if (
    payload.release_authority_key_id !== releaseDelegation.payload.key_id ||
    payload.release_authority_delegation_id !== releaseDelegation.payload.delegation_id ||
    payload.release_authority_delegation_sha256 !== releaseDelegation.digest
  ) {
    invalid("INVALID_BINDING", "Freshness response Release Authority delegation binding is invalid");
  }
  const releaseCommit = await verifyRuntimeConfigReleaseCommitRecord({
    raw: recordRaw,
    rootSigner: options.bootstrapSigner,
    environment: "production",
    releaseDelegationRaw,
    appendedAt: payload.release_commit_record_appended_at,
  });
  const appendedAtMs = parseTimestamp(
    payload.release_commit_record_appended_at,
    "Journal appended_at",
  );
  if (
    payload.release_commit_record_sha256 !== releaseCommit.digest ||
    payload.release_commit_id !== releaseCommit.payload.release_commit_id ||
    payload.pointer_generation !== releaseCommit.payload.commit_generation ||
    payload.latest_epoch !== releaseCommit.payload.manifest_epoch ||
    payload.manifest_schema_version !== releaseCommit.payload.manifest_schema_version ||
    payload.manifest_sha256 !== releaseCommit.payload.manifest_sha256 ||
    payload.manifest_ref !== releaseCommit.payload.manifest_ref ||
    appendedAtMs < parseTimestamp(releaseCommit.payload.authorized_at, "authorized_at") ||
    appendedAtMs > issuedAtMs
  ) {
    invalid("INVALID_BINDING", "Freshness response does not bind the current Release Commit Record");
  }
  parseCanonicalUnsignedDecimal(payload.latest_epoch, "latest Manifest epoch");
  parseCanonicalUnsignedDecimal(payload.pointer_generation, "pointer generation");
  assertDigest(payload.manifest_sha256, "Freshness Manifest digest");
  assertDigest(payload.release_commit_record_sha256, "Release Commit Record digest");
  assertUuidV4(payload.release_commit_id, "release commit ID");
  if (
    payload.manifest_ref !==
    `${IMMUTABLE_MANIFEST_PREFIX}${payload.manifest_sha256}`
  ) {
    invalid("INVALID_BINDING", "Freshness Manifest reference is not content addressed");
  }
  return Object.freeze({
    envelope,
    payload,
    freshnessDelegation,
    releaseCommit,
    issuedAtMs,
    expiresAtMs,
  });
}

export async function verifyFreshnessManifestBinding(
  response: VerifiedFreshnessResponse,
  rawManifestBytes: Uint8Array,
): Promise<Uint8Array> {
  const digest = await sha256Base64Url(rawManifestBytes);
  if (
    digest !== response.payload.manifest_sha256 ||
    digest !== response.releaseCommit.payload.manifest_sha256
  ) {
    invalid("INVALID_BINDING", "immutable Manifest bytes do not match the signed Freshness digest");
  }
  return rawManifestBytes.slice();
}

export const runtimeConfigFreshnessWire = Object.freeze({
  requestScope: REQUEST_SCOPE,
  responseEnvelopeScope: RESPONSE_ENVELOPE_SCOPE,
  responsePayloadScope: RESPONSE_PAYLOAD_SCOPE,
  delegationEnvelopeScope: DELEGATION_ENVELOPE_SCOPE,
  delegationPayloadScope: DELEGATION_PAYLOAD_SCOPE,
  releaseEnvelopeScope: RELEASE_ENVELOPE_SCOPE,
  releasePayloadScope: RELEASE_PAYLOAD_SCOPE,
  requestPath: "/tlsn/runtime-config/v2/freshness/v1",
  immutableManifestPrefix: IMMUTABLE_MANIFEST_PREFIX,
  releaseAudiencePrefix: RELEASE_AUDIENCE_PREFIX,
  maxRequestBytes: MAX_REQUEST_BYTES,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxFreshnessDelegationLifetimeSeconds: MAX_FRESHNESS_DELEGATION_SECONDS,
  maxReleaseDelegationLifetimeSeconds: MAX_RELEASE_DELEGATION_SECONDS,
  maxResponseLifetimeMs: MAX_RESPONSE_LIFETIME_MS,
  maxClockSkewMs: MAX_CLOCK_SKEW_MS,
});

function invalid(code: RuntimeConfigDomainErrorCode, message: string): never {
  throw new RuntimeConfigDomainError(code, message);
}
