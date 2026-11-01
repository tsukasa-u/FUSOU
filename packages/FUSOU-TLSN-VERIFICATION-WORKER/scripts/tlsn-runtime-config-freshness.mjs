import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./production-trust-contract.mjs";

export const TLSN_RUNTIME_CONFIG_FRESHNESS = Object.freeze({
  requestScope: "fusou-tlsn-runtime-config-freshness-request-v1",
  responseEnvelopeScope: "fusou-tlsn-runtime-config-freshness-envelope-v1",
  responsePayloadScope: "fusou-tlsn-runtime-config-freshness-response-v1",
  delegationEnvelopeScope: "fusou-tlsn-runtime-config-delegation-envelope-v1",
  delegationPayloadScope: "fusou-tlsn-runtime-config-delegation-v1",
  releaseEnvelopeScope: "fusou-tlsn-runtime-config-release-commit-envelope-v1",
  releasePayloadScope: "fusou-tlsn-runtime-config-release-commit-v1",
  requestPath: "/tlsn/runtime-config/v2/freshness/v1",
  immutableManifestPrefix: "tlsn/runtime-config/v2/manifests/",
  releaseAudiencePrefix: "fusou-tlsn-runtime-config-v2:",
  maxRequestBytes: 1024,
  maxResponseBytes: 65_536,
  maxIssueLeaseMs: 8_000,
  maxResponseLifetimeMs: 30_000,
  maxFreshnessDelegationLifetimeSeconds: 86_400,
  maxReleaseDelegationLifetimeSeconds: 2_592_000,
  maxClockSkewMs: 30_000,
  delegationDomain: Buffer.from("FUSOU-TLSN-RUNTIME-CONFIG-DELEGATION-V1\0"),
  releaseDomain: Buffer.from("FUSOU-TLSN-RUNTIME-CONFIG-RELEASE-COMMIT-V1\0"),
  freshnessDomain: Buffer.from("FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-RESPONSE-V1\0"),
});

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ED25519_SPKI_PREFIX = Buffer.from(
  "302a300506032b6570032100",
  "hex",
);
const DNS_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UINT64_MAX = 18_446_744_073_709_551_615n;

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

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} has missing or unknown fields`);
  }
}

function parseCanonicalJson(raw, fields, label, maxBytes) {
  const bytes = Buffer.from(raw);
  if (bytes.length > maxBytes) throw new Error(`${label} exceeds its byte limit`);
  let text;
  let value;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON`);
  }
  assertExactKeys(value, fields, label);
  assertWellFormedJsonStrings(value, label);
  if (!Buffer.from(canonicalJson(value), "utf8").equals(bytes)) {
    throw new Error(`${label} is not canonical JSON`);
  }
  return value;
}

function assertWellFormedJsonStrings(value, label) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      for (let index = 0; index < current.length; index += 1) {
        const code = current.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = current.charCodeAt(index + 1);
          if (!(next >= 0xdc00 && next <= 0xdfff)) {
            throw new Error(`${label} contains an invalid Unicode string`);
          }
          index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          throw new Error(`${label} contains an invalid Unicode string`);
        }
      }
    } else if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
    } else if (current && typeof current === "object") {
      for (const [key, item] of Object.entries(current)) pending.push(key, item);
    }
  }
}

function decodeBase64Url(value, label, expectedLength) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new Error(`${label} is not canonical unpadded base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) {
    throw new Error(`${label} is not canonical unpadded base64url`);
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(`${label} has an invalid byte length`);
  }
  return bytes;
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !SHA256_BASE64URL_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 base64url digest`);
  }
  decodeBase64Url(value, label, 32);
  return value;
}

function assertKeyId(value, label) {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function importEd25519Spki(value, label) {
  const spki = decodeBase64Url(value, `${label} SPKI`, 44);
  if (!ED25519_SPKI_PREFIX.every((byte, index) => spki[index] === byte)) {
    throw new Error(`${label} SPKI is not canonical Ed25519`);
  }
  let publicKey;
  try {
    publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
  } catch {
    throw new Error(`${label} SPKI is invalid`);
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`${label} key is not Ed25519`);
  }
  return publicKey;
}

function assertUuidV4(value, label) {
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase canonical UUIDv4`);
  }
}

function parseTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new Error(`${label} must be canonical UTC millisecond time`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} is not a valid canonical UTC timestamp`);
  }
  return milliseconds;
}

function parseUnsigned(value, label, { allowZero = false } = {}) {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/.test(value) ||
    (!allowZero && value === "0")
  ) {
    throw new Error(`${label} is not a canonical unsigned decimal string`);
  }
  const number = BigInt(value);
  if (number > UINT64_MAX) throw new Error(`${label} exceeds UInt64`);
  return number;
}

function sha256Base64Url(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

export function runtimeConfigFreshnessSigningBytes(domain, keyId, payloadBytes) {
  assertKeyId(keyId, "signer key ID");
  const keyIdBytes = Buffer.from(keyId, "ascii");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(keyIdBytes.length);
  return Buffer.concat([domain, length, keyIdBytes, payloadBytes]);
}

function verifyEd25519(spkiBase64Url, bytes, signatureBase64Url, label) {
  const publicKey = importEd25519Spki(spkiBase64Url, label);
  const signature = decodeBase64Url(signatureBase64Url, `${label} signature`, 64);
  if (!verifySignature(null, bytes, publicKey, signature)) {
    throw new Error(`${label} signature verification failed`);
  }
}

function parseDelegationEnvelope(raw) {
  const envelope = parseCanonicalJson(
    raw,
    DELEGATION_ENVELOPE_FIELDS,
    "delegation envelope",
    16_384,
  );
  if (
    envelope.schema_version !== 1 ||
    envelope.scope !== TLSN_RUNTIME_CONFIG_FRESHNESS.delegationEnvelopeScope ||
    envelope.signature_algorithm !== "Ed25519"
  ) {
    throw new Error("delegation envelope schema or algorithm is invalid");
  }
  assertKeyId(envelope.root_key_id, "delegation root key ID");
  return envelope;
}

export function verifyRuntimeConfigDelegation(raw, {
  rootSigner,
  expectedPurpose,
  expectedEnvironment,
  expectedAudience,
  signerNowMs,
}) {
  if (
    !rootSigner ||
    rootSigner.scope !== "fusou-tlsn-runtime-config-signing-root-v2"
  ) {
    throw new Error("Bootstrap signer is not scoped to Runtime Config");
  }
  assertKeyId(rootSigner.key_id, "Bootstrap signer key ID");
  const envelope = parseDelegationEnvelope(raw);
  if (envelope.root_key_id !== rootSigner.key_id) {
    throw new Error("delegation root key ID does not match the Bootstrap pin");
  }
  const payloadBytes = decodeBase64Url(
    envelope.payload_base64url,
    "delegation payload",
  );
  verifyEd25519(
    rootSigner.public_key_spki,
    runtimeConfigFreshnessSigningBytes(
      TLSN_RUNTIME_CONFIG_FRESHNESS.delegationDomain,
      envelope.root_key_id,
      payloadBytes,
    ),
    envelope.signature_base64url,
    "delegation",
  );
  const payload = parseCanonicalJson(
    payloadBytes,
    DELEGATION_PAYLOAD_FIELDS,
    "delegation payload",
    8_192,
  );
  const maxValidity = expectedPurpose === "freshness-response-v1"
    ? TLSN_RUNTIME_CONFIG_FRESHNESS.maxFreshnessDelegationLifetimeSeconds
    : TLSN_RUNTIME_CONFIG_FRESHNESS.maxReleaseDelegationLifetimeSeconds;
  if (
    payload.schema_version !== 1 ||
    payload.scope !== TLSN_RUNTIME_CONFIG_FRESHNESS.delegationPayloadScope ||
    payload.signature_algorithm !== "Ed25519" ||
    payload.revocation_mode !== "expiry-only-v1" ||
    payload.purpose !== expectedPurpose ||
    payload.environment !== expectedEnvironment ||
    payload.audience !== expectedAudience ||
    payload.max_validity_seconds !== maxValidity
  ) {
    throw new Error("delegation scope, purpose, audience, or algorithm is invalid");
  }
  assertUuidV4(payload.delegation_id, "delegation ID");
  parseUnsigned(payload.delegation_generation, "delegation generation");
  assertKeyId(payload.key_id, "delegated key ID");
  importEd25519Spki(payload.public_key_spki, "delegated key");
  const issuedAt = parseTimestamp(payload.issued_at, "delegation issued_at");
  const notBefore = parseTimestamp(payload.not_before, "delegation not_before");
  const notAfter = parseTimestamp(payload.not_after, "delegation not_after");
  if (
    issuedAt > notBefore ||
    notBefore >= notAfter ||
    notAfter - issuedAt > maxValidity * 1000
  ) {
    throw new Error("delegation validity interval exceeds its strict lifetime");
  }
  const generation = BigInt(payload.delegation_generation);
  if (generation === 1n) {
    if (payload.previous_delegation_sha256 !== null) {
      throw new Error("first delegation must not have a previous digest");
    }
  } else {
    assertDigest(payload.previous_delegation_sha256, "previous delegation digest");
  }
  if (signerNowMs !== undefined) {
    if (!Number.isSafeInteger(signerNowMs)) {
      throw new Error("delegation signer time is invalid");
    }
    if (signerNowMs < notBefore || signerNowMs >= notAfter) {
      throw new Error("delegation is not active at signer time");
    }
  }
  return {
    envelope,
    payload,
    digest: sha256Base64Url(Buffer.from(raw)),
    raw: Buffer.from(raw),
    issuedAt,
    notBefore,
    notAfter,
  };
}

function parseReleaseEnvelope(raw) {
  const envelope = parseCanonicalJson(
    raw,
    RELEASE_ENVELOPE_FIELDS,
    "Release Commit Record envelope",
    16_384,
  );
  if (
    envelope.schema_version !== 1 ||
    envelope.scope !== TLSN_RUNTIME_CONFIG_FRESHNESS.releaseEnvelopeScope ||
    envelope.signature_algorithm !== "Ed25519"
  ) {
    throw new Error("Release Commit Record envelope schema or algorithm is invalid");
  }
  assertKeyId(envelope.signer_key_id, "Release Authority signer key ID");
  return envelope;
}

export function verifyRuntimeConfigReleaseCommitRecord(raw, {
  rootSigner,
  environment,
  releaseDelegationRaw,
  appendedAt,
}) {
  const releaseDelegation = verifyRuntimeConfigDelegation(releaseDelegationRaw, {
    rootSigner,
    expectedPurpose: "release-commit-record-v1",
    expectedEnvironment: environment,
    expectedAudience: `${TLSN_RUNTIME_CONFIG_FRESHNESS.releaseAudiencePrefix}${environment}`,
  });
  const envelope = parseReleaseEnvelope(raw);
  if (envelope.signer_key_id !== releaseDelegation.payload.key_id) {
    throw new Error("Release Authority signer key ID does not match its delegation");
  }
  const payloadBytes = decodeBase64Url(
    envelope.payload_base64url,
    "Release Commit Record payload",
  );
  verifyEd25519(
    releaseDelegation.payload.public_key_spki,
    runtimeConfigFreshnessSigningBytes(
      TLSN_RUNTIME_CONFIG_FRESHNESS.releaseDomain,
      envelope.signer_key_id,
      payloadBytes,
    ),
    envelope.signature_base64url,
    "Release Commit Record",
  );
  const payload = parseCanonicalJson(
    payloadBytes,
    RELEASE_PAYLOAD_FIELDS,
    "Release Commit Record payload",
    8_192,
  );
  if (
    payload.schema_version !== 1 ||
    payload.scope !== TLSN_RUNTIME_CONFIG_FRESHNESS.releasePayloadScope ||
    payload.environment !== environment ||
    payload.commit_authorization !== "AUTHORIZE_JOURNAL_APPEND" ||
    payload.manifest_schema_version !== 2 ||
    payload.release_authority_delegation_id !== releaseDelegation.payload.delegation_id ||
    payload.release_authority_delegation_sha256 !== releaseDelegation.digest
  ) {
    throw new Error("Release Commit Record fields do not match its delegation");
  }
  parseUnsigned(payload.commit_generation, "commit generation");
  parseUnsigned(payload.manifest_epoch, "Manifest epoch");
  assertDigest(payload.manifest_sha256, "Manifest digest");
  assertDigest(payload.release_authority_delegation_sha256, "Release delegation digest");
  assertUuidV4(payload.release_commit_id, "release commit ID");
  if (
    payload.manifest_ref !==
    `${TLSN_RUNTIME_CONFIG_FRESHNESS.immutableManifestPrefix}${payload.manifest_sha256}`
  ) {
    throw new Error("Release Commit Record Manifest reference is not content addressed");
  }
  if (
    typeof payload.pointer_etag !== "string" ||
    rustTrimHasBoundaryWhitespace(payload.pointer_etag)
  ) {
    throw new Error("Release Commit Record pointer ETag is invalid");
  }
  const generation = BigInt(payload.commit_generation);
  if (generation === 1n) {
    if (
      payload.previous_commit_generation !== null ||
      payload.previous_commit_record_sha256 !== null
    ) {
      throw new Error("genesis Release Commit Record has an invalid previous head");
    }
  } else {
    const previousGeneration = parseUnsigned(
      payload.previous_commit_generation,
      "previous commit generation",
    );
    if (previousGeneration + 1n !== generation) {
      throw new Error("Release Commit Record generation is not contiguous");
    }
    assertDigest(
      payload.previous_commit_record_sha256,
      "previous Release Commit Record digest",
    );
  }
  const authorizedAt = parseTimestamp(payload.authorized_at, "authorized_at");
  const appendedAtMs = parseTimestamp(appendedAt, "Journal appended_at");
  if (
    authorizedAt < releaseDelegation.notBefore ||
    authorizedAt >= releaseDelegation.notAfter ||
    appendedAtMs < releaseDelegation.notBefore ||
    appendedAtMs >= releaseDelegation.notAfter ||
    authorizedAt > appendedAtMs
  ) {
    throw new Error("Release authorization and Journal append times are outside delegation");
  }
  return {
    envelope,
    payload,
    delegation: releaseDelegation,
    digest: sha256Base64Url(Buffer.from(raw)),
    appendedAt: appendedAtMs,
  };
}

function rustTrimHasBoundaryWhitespace(value) {
  const codePoints = Array.from(value, (character) => character.codePointAt(0));
  const isWhitespace = (codePoint) =>
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
    isWhitespace(codePoints[0]) ||
    isWhitespace(codePoints[codePoints.length - 1])
  );
}

export function createRuntimeConfigFreshnessRequest({
  environment,
  manifestUrl,
  requestNonce,
}) {
  let url;
  try {
    url = new URL(manifestUrl);
  } catch {
    throw new Error("Freshness request Manifest URL is invalid");
  }
  if (environment !== "production") {
    throw new Error("Freshness request environment is not Production");
  }
  if (
    typeof manifestUrl !== "string" ||
    url.protocol !== "https:" ||
    !DNS_HOSTNAME_PATTERN.test(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/tlsn/runtime-config/v2/manifest.json" ||
    url.href !== manifestUrl
  ) {
    throw new Error("Freshness request Manifest URL is invalid");
  }
  const nonce = Buffer.from(requestNonce);
  if (nonce.length !== 32) throw new Error("Freshness request nonce must be 32 bytes");
  const request = {
    schema_version: 1,
    scope: TLSN_RUNTIME_CONFIG_FRESHNESS.requestScope,
    environment,
    audience_manifest_url_sha256: sha256Base64Url(Buffer.from(manifestUrl, "utf8")),
    request_nonce: nonce.toString("base64url"),
  };
  const raw = Buffer.from(canonicalJson(request), "utf8");
  if (raw.length > TLSN_RUNTIME_CONFIG_FRESHNESS.maxRequestBytes) {
    throw new Error("Freshness request exceeds its byte limit");
  }
  return Object.freeze({ request, raw });
}

export function verifyRuntimeConfigFreshnessRequest(raw, {
  expectedEnvironment,
  expectedAudience,
}) {
  const request = parseCanonicalJson(
    raw,
    REQUEST_FIELDS,
    "Freshness request",
    TLSN_RUNTIME_CONFIG_FRESHNESS.maxRequestBytes,
  );
  if (
    request.schema_version !== 1 ||
    request.scope !== TLSN_RUNTIME_CONFIG_FRESHNESS.requestScope ||
    request.environment !== expectedEnvironment ||
    request.audience_manifest_url_sha256 !== expectedAudience
  ) {
    throw new Error("Freshness request scope, environment, or audience is invalid");
  }
  decodeBase64Url(request.request_nonce, "request nonce", 32);
  return Object.freeze(request);
}

function responseIsWithinSkew(payload, nowMs) {
  const issuedAt = parseTimestamp(payload.issued_at, "Freshness issued_at");
  const expiresAt = parseTimestamp(payload.expires_at, "Freshness expires_at");
  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > TLSN_RUNTIME_CONFIG_FRESHNESS.maxResponseLifetimeMs ||
    issuedAt > nowMs + TLSN_RUNTIME_CONFIG_FRESHNESS.maxClockSkewMs ||
    expiresAt <= nowMs - TLSN_RUNTIME_CONFIG_FRESHNESS.maxClockSkewMs
  ) {
    throw new Error("Freshness response is outside its permitted time window");
  }
  return { issuedAt, expiresAt };
}

function assertFreshnessDelegationActive(delegation, appNowMs) {
  if (
    appNowMs - TLSN_RUNTIME_CONFIG_FRESHNESS.maxClockSkewMs < delegation.notBefore ||
    appNowMs + TLSN_RUNTIME_CONFIG_FRESHNESS.maxClockSkewMs >= delegation.notAfter
  ) {
    throw new Error("Freshness delegation is outside the conservative APP validity window");
  }
}

function checkDelegationHighWater(delegation, highWater) {
  if (!highWater) return;
  const priorGeneration = parseUnsigned(
    highWater.generation,
    "persisted Freshness delegation generation",
  );
  const currentGeneration = BigInt(delegation.payload.delegation_generation);
  if (currentGeneration < priorGeneration) {
    throw new Error("Freshness delegation generation rollback");
  }
  if (currentGeneration === priorGeneration) {
    if (delegation.digest !== highWater.digest) {
      throw new Error("same Freshness delegation generation has different bytes");
    }
    return;
  }
  if (
    currentGeneration !== priorGeneration + 1n ||
    delegation.payload.previous_delegation_sha256 !== highWater.digest
  ) {
    throw new Error("Freshness delegation chain does not extend persisted state");
  }
}

export function verifyRuntimeConfigFreshnessResponse(raw, {
  bootstrapSigner,
  manifestUrl,
  request,
  nowMs,
  highWater,
}) {
  if (!Number.isSafeInteger(nowMs)) throw new Error("APP verification time is invalid");
  const audience = sha256Base64Url(Buffer.from(manifestUrl, "utf8"));
  const envelope = parseCanonicalJson(
    raw,
    RESPONSE_ENVELOPE_FIELDS,
    "Freshness response envelope",
    TLSN_RUNTIME_CONFIG_FRESHNESS.maxResponseBytes,
  );
  if (
    envelope.schema_version !== 1 ||
    envelope.scope !== TLSN_RUNTIME_CONFIG_FRESHNESS.responseEnvelopeScope ||
    envelope.signature_algorithm !== "Ed25519"
  ) {
    throw new Error("Freshness response envelope schema or algorithm is invalid");
  }
  assertKeyId(envelope.signer_key_id, "Freshness signer key ID");
  if (
    request?.schema_version !== 1 ||
    request?.scope !== TLSN_RUNTIME_CONFIG_FRESHNESS.requestScope ||
    request?.environment !== "production" ||
    request?.audience_manifest_url_sha256 !== audience
  ) {
    throw new Error("outstanding APP challenge does not match the Manifest URL");
  }
  decodeBase64Url(request.request_nonce, "outstanding request nonce", 32);

  const freshnessDelegationRaw = decodeBase64Url(
    envelope.freshness_delegation_base64url,
    "Freshness delegation",
  );
  const releaseDelegationRaw = decodeBase64Url(
    envelope.release_authority_delegation_base64url,
    "Release Authority delegation",
  );
  const recordRaw = decodeBase64Url(
    envelope.release_commit_record_base64url,
    "Release Commit Record",
  );
  const payloadBytes = decodeBase64Url(
    envelope.payload_base64url,
    "Freshness response payload",
  );
  const freshnessDelegation = verifyRuntimeConfigDelegation(freshnessDelegationRaw, {
    rootSigner: bootstrapSigner,
    expectedPurpose: "freshness-response-v1",
    expectedEnvironment: "production",
    expectedAudience: audience,
  });
  assertFreshnessDelegationActive(freshnessDelegation, nowMs);
  if (envelope.signer_key_id !== freshnessDelegation.payload.key_id) {
    throw new Error("Freshness response key ID does not match its delegation");
  }
  verifyEd25519(
    freshnessDelegation.payload.public_key_spki,
    runtimeConfigFreshnessSigningBytes(
      TLSN_RUNTIME_CONFIG_FRESHNESS.freshnessDomain,
      envelope.signer_key_id,
      payloadBytes,
    ),
    envelope.signature_base64url,
    "Freshness response",
  );
  const payload = parseCanonicalJson(
    payloadBytes,
    RESPONSE_PAYLOAD_FIELDS,
    "Freshness response payload",
    16_384,
  );
  if (
    payload.schema_version !== 1 ||
    payload.scope !== TLSN_RUNTIME_CONFIG_FRESHNESS.responsePayloadScope ||
    payload.freshness_semantics !== "LATEST_AT_ISSUANCE" ||
    payload.environment !== "production" ||
    payload.audience_manifest_url_sha256 !== audience ||
    payload.request_nonce !== request.request_nonce ||
    payload.freshness_signer_key_id !== envelope.signer_key_id ||
    payload.freshness_delegation_id !== freshnessDelegation.payload.delegation_id ||
    payload.freshness_delegation_sha256 !== freshnessDelegation.digest
  ) {
    throw new Error("Freshness response does not bind the outstanding APP challenge");
  }
  const freshnessTimes = responseIsWithinSkew(payload, nowMs);
  if (
    freshnessTimes.issuedAt < freshnessDelegation.notBefore ||
    freshnessTimes.issuedAt >= freshnessDelegation.notAfter ||
    freshnessTimes.expiresAt > freshnessDelegation.notAfter
  ) {
    throw new Error("Freshness response validity exceeds its delegation");
  }
  checkDelegationHighWater(freshnessDelegation, highWater);

  const releaseDelegation = verifyRuntimeConfigDelegation(releaseDelegationRaw, {
    rootSigner: bootstrapSigner,
    expectedPurpose: "release-commit-record-v1",
    expectedEnvironment: "production",
    expectedAudience: `${TLSN_RUNTIME_CONFIG_FRESHNESS.releaseAudiencePrefix}production`,
  });
  if (
    payload.release_authority_key_id !== releaseDelegation.payload.key_id ||
    payload.release_authority_delegation_id !== releaseDelegation.payload.delegation_id ||
    payload.release_authority_delegation_sha256 !== releaseDelegation.digest
  ) {
    throw new Error("Freshness response Release Authority delegation binding is invalid");
  }
  const releaseRecord = verifyRuntimeConfigReleaseCommitRecord(recordRaw, {
    rootSigner: bootstrapSigner,
    environment: "production",
    releaseDelegationRaw,
    appendedAt: payload.release_commit_record_appended_at,
  });
  const appendedAt = parseTimestamp(
    payload.release_commit_record_appended_at,
    "Journal appended_at",
  );
  if (
    payload.release_commit_record_sha256 !== releaseRecord.digest ||
    payload.release_commit_id !== releaseRecord.payload.release_commit_id ||
    payload.pointer_generation !== releaseRecord.payload.commit_generation ||
    payload.latest_epoch !== releaseRecord.payload.manifest_epoch ||
    payload.manifest_schema_version !== releaseRecord.payload.manifest_schema_version ||
    payload.manifest_sha256 !== releaseRecord.payload.manifest_sha256 ||
    payload.manifest_ref !== releaseRecord.payload.manifest_ref ||
    appendedAt < parseTimestamp(releaseRecord.payload.authorized_at, "authorized_at") ||
    appendedAt > freshnessTimes.issuedAt
  ) {
    throw new Error("Freshness response does not bind the current Release Commit Record");
  }
  parseUnsigned(payload.latest_epoch, "latest Manifest epoch");
  parseUnsigned(payload.pointer_generation, "pointer generation");
  assertDigest(payload.manifest_sha256, "Freshness Manifest digest");
  assertDigest(payload.release_commit_record_sha256, "Release Commit Record digest");
  assertUuidV4(payload.release_commit_id, "release commit ID");

  return Object.freeze({
    payload: Object.freeze(payload),
    freshnessDelegation: Object.freeze(freshnessDelegation),
    releaseDelegation: Object.freeze(releaseDelegation),
    releaseRecord: Object.freeze(releaseRecord),
    freshnessTimes: Object.freeze(freshnessTimes),
  });
}

export function verifyFreshnessManifestBinding(verifiedResponse, rawManifestBytes) {
  const raw = Buffer.from(rawManifestBytes);
  const digest = sha256Base64Url(raw);
  if (
    digest !== verifiedResponse.payload.manifest_sha256 ||
    digest !== verifiedResponse.releaseRecord.payload.manifest_sha256
  ) {
    throw new Error("immutable Manifest bytes do not match the signed Freshness digest");
  }
  return raw;
}
