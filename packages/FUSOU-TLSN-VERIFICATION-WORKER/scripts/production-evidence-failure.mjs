import { sha256Base64Url } from "./deployment-attestation.mjs";

const OMITTED_ERROR_MESSAGE = "Details omitted to prevent sensitive-data disclosure";
const FAILURE_BUNDLE_SCHEMA_VERSION = 2;
const FAILURE_BUNDLE_SCOPE = "tlsn-production-evidence-failure";
const FAILURE_STAGES = new Set([
  "initialization",
  "configuration",
  "presentation_capture",
  "worker_health",
  "supabase_user",
  "session_issue",
  "tlsn_verify",
  "tlsn_replay",
]);
const HTTP_METHODS = new Set(["GET", "POST"]);
const HTTP_PATHS = new Set([
  "/health",
  "/auth/v1/user",
  "/api/auth/anonymous-sync/v2/device-identity",
  "/api/auth/anonymous-sync/v2/challenge",
  "/api/auth/anonymous-sync/v2/device-proof",
  "/api/auth/anonymous-sync/v2/tlsn-device-proof",
  "/attestation/session",
  "/verify/tlsn",
]);
const CONTENT_TYPES = new Set(["application/json", "application/octet-stream", "text/plain"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WORKER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const PROXY_BINARY_PATTERN = /^proxy-https:\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

// Field names are an allowlist, not a redaction hint. Their value formats are also validated.
export const FAILURE_BUNDLE_SAFE_FIELD_CONTRACT = Object.freeze({
  health: Object.freeze([
    "schema_version", "ok", "verifier", "environment", "deployment_role", "git_commit_sha",
    "deployment_id", "runtime_version", "binding_mode", "execution_mode", "security_identity",
    "deployment_identity",
  ]),
  health_runtime_version: Object.freeze(["version_id", "version_tag", "version_timestamp"]),
  health_security_identity: Object.freeze([
    "verifier_key_id", "notary_key_id", "security_registry_set_sha256", "notary_registry_sha256",
    "trust_contract_valid",
  ]),
  health_deployment_identity: Object.freeze(["deployment_id", "deployment_role", "binding_mode", "worker_name"]),
  provenance: Object.freeze([
    "schema_version", "capture_provenance", "capture_source", "synthetic", "test", "canary", "local",
    "capture_timestamp", "proxy_provenance",
  ]),
  proxy_provenance: Object.freeze([
    "declared", "cryptographic_status", "proxy_identity", "proxy_deployment_id", "proxy_binary_identity",
    "presentation_sha256", "created_at", "signer_key_id", "authority", "signature_present",
  ]),
  proxy_authority: Object.freeze(["type", "status"]),
  session: Object.freeze(["session_id", "expires_at", "session_receipt"]),
  session_receipt: Object.freeze([
    "session_id", "signer_key_id", "signature_algorithm", "created_at", "expires_at", "signature_present",
  ]),
  consume: Object.freeze([
    "type", "signer_key_id", "signature_algorithm", "used_at", "signature_present", "error_code",
  ]),
  http_request: Object.freeze(["method", "path", "content_type", "body_bytes"]),
  http_response: Object.freeze(["status", "content_type", "body_bytes"]),
  http_exchange: Object.freeze(["request", "response", "error"]),
  http_error: Object.freeze(["code"]),
  capture_error: Object.freeze(["stage", "code", "message"]),
  hash_descriptor: Object.freeze(["bytes", "sha256"]),
  hashes: Object.freeze(["presentation"]),
});
const FAILURE_BUNDLE_SAFE_FIELD_SETS = new Map(
  Object.entries(FAILURE_BUNDLE_SAFE_FIELD_CONTRACT).map(([group, fields]) => [group, new Set(fields)]),
);

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownValue(value, key) {
  if (!isRecord(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function addField(target, source, group, key, validate) {
  if (!FAILURE_BUNDLE_SAFE_FIELD_SETS.get(group)?.has(key)) return;
  const value = validate(ownValue(source, key));
  addSafeField(target, group, key, value);
}

function addSafeField(target, group, key, value) {
  if (value !== undefined && FAILURE_BUNDLE_SAFE_FIELD_SETS.get(group)?.has(key)) {
    target[key] = value;
  }
}

function enumValue(value, allowed) {
  return typeof value === "string" && allowed.has(value) ? value : undefined;
}

function identifier(value) {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value) ? value : undefined;
}

function uuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function commit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function digest(value) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value ? value : undefined;
}

function timestamp(value) {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

function boolean(value) {
  return typeof value === "boolean" ? value : undefined;
}

function signaturePresence(value) {
  return typeof ownValue(value, "signature") === "string"
    ? true
    : boolean(ownValue(value, "signature_present")) ?? false;
}

function smallInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined;
}

function safeRuntimeVersion(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  addField(result, value, "health_runtime_version", "version_id", uuid);
  addField(result, value, "health_runtime_version", "version_tag", (entry) =>
    typeof entry === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(entry) ? entry : undefined);
  addField(result, value, "health_runtime_version", "version_timestamp", timestamp);
  return Object.keys(result).length ? result : undefined;
}

function safeSecurityIdentity(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  addField(result, value, "health_security_identity", "verifier_key_id", identifier);
  addField(result, value, "health_security_identity", "notary_key_id", identifier);
  addField(result, value, "health_security_identity", "security_registry_set_sha256", digest);
  addField(result, value, "health_security_identity", "notary_registry_sha256", digest);
  addField(result, value, "health_security_identity", "trust_contract_valid", boolean);
  return Object.keys(result).length ? result : undefined;
}

function safeDeploymentIdentity(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  addField(result, value, "health_deployment_identity", "deployment_id", identifier);
  addField(result, value, "health_deployment_identity", "deployment_role", (entry) => enumValue(entry, new Set(["production", "canary", "replay", "test", "synthetic-test"])));
  addField(result, value, "health_deployment_identity", "binding_mode", (entry) => enumValue(entry, new Set(["fixed_canary", "fixed", "fixed_test", "random"])));
  addField(result, value, "health_deployment_identity", "worker_name", (entry) =>
    typeof entry === "string" && WORKER_NAME_PATTERN.test(entry) ? entry : undefined);
  return Object.keys(result).length ? result : undefined;
}

function safeHealth(value) {
  if (!isRecord(value)) return null;
  const result = {};
  addField(result, value, "health", "schema_version", (entry) => entry === 3 ? entry : undefined);
  addField(result, value, "health", "ok", boolean);
  addField(result, value, "health", "verifier", (entry) => enumValue(entry, new Set(["tlsn-alpha15-wasm"])));
  addField(result, value, "health", "environment", (entry) => enumValue(entry, new Set(["production", "test", "replay"])));
  addField(result, value, "health", "deployment_role", (entry) => enumValue(entry, new Set(["production", "canary", "replay", "test", "synthetic-test"])));
  addField(result, value, "health", "git_commit_sha", commit);
  addField(result, value, "health", "deployment_id", identifier);
  addField(result, value, "health", "runtime_version", safeRuntimeVersion);
  addField(result, value, "health", "binding_mode", (entry) => enumValue(entry, new Set(["fixed_canary", "fixed", "fixed_test", "random"])));
  addField(result, value, "health", "execution_mode", (entry) => enumValue(entry, new Set(["trigger", "queue", "direct", "sync"])));
  addField(result, value, "health", "security_identity", safeSecurityIdentity);
  addField(result, value, "health", "deployment_identity", safeDeploymentIdentity);
  return Object.keys(result).length ? result : null;
}

function safeProxyAuthority(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  addField(result, value, "proxy_authority", "type", (entry) => enumValue(entry, new Set(["externally-pinned-production-proxy-key"])));
  addField(result, value, "proxy_authority", "status", (entry) => enumValue(entry, new Set(["UNVERIFIED", "EXTERNALLY_PINNED"])));
  return Object.keys(result).length ? result : undefined;
}

function safeProxyProvenance(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  addField(result, value, "proxy_provenance", "declared", (entry) => enumValue(entry, new Set(["production", "unavailable"])));
  addField(result, value, "proxy_provenance", "cryptographic_status", (entry) => enumValue(entry, new Set(["UNVERIFIED", "VERIFIED", "INVALID"])));
  addField(result, value, "proxy_provenance", "proxy_identity", (entry) =>
    typeof entry === "string" && /^fusou-proxy(?:-[a-z0-9]+)*$/.test(entry) ? entry : undefined);
  addField(result, value, "proxy_provenance", "proxy_deployment_id", (entry) => entry === null ? null : identifier(entry));
  addField(result, value, "proxy_provenance", "proxy_binary_identity", (entry) =>
    typeof entry === "string" && PROXY_BINARY_PATTERN.test(entry) ? entry : undefined);
  addField(result, value, "proxy_provenance", "presentation_sha256", digest);
  addField(result, value, "proxy_provenance", "created_at", timestamp);
  addField(result, value, "proxy_provenance", "signer_key_id", identifier);
  addField(result, value, "proxy_provenance", "authority", safeProxyAuthority);
  addSafeField(result, "proxy_provenance", "signature_present", signaturePresence(value));
  return result;
}

function safeProvenance(value) {
  if (!isRecord(value)) return null;
  const result = {};
  addField(result, value, "provenance", "schema_version", (entry) => entry === 2 ? entry : undefined);
  addField(result, value, "provenance", "capture_provenance", (entry) =>
    enumValue(entry, new Set(["production", "unavailable", "synthetic-alpha15-test-fixture"])));
  addField(result, value, "provenance", "capture_source", (entry) =>
    enumValue(entry, new Set(["fusou-proxy-production-tlsn", "synthetic-alpha15-test-fixture"])));
  for (const field of ["synthetic", "test", "canary", "local"]) addField(result, value, "provenance", field, boolean);
  addField(result, value, "provenance", "capture_timestamp", timestamp);
  addField(result, value, "provenance", "proxy_provenance", safeProxyProvenance);
  return Object.keys(result).length ? result : null;
}

function safeSessionReceipt(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  addField(result, value, "session_receipt", "session_id", uuid);
  addField(result, value, "session_receipt", "signer_key_id", identifier);
  addField(result, value, "session_receipt", "signature_algorithm", (entry) => enumValue(entry, new Set(["Ed25519"])));
  addField(result, value, "session_receipt", "created_at", timestamp);
  addField(result, value, "session_receipt", "expires_at", timestamp);
  addSafeField(result, "session_receipt", "signature_present", signaturePresence(value));
  return Object.keys(result).length ? result : undefined;
}

function safeSession(value) {
  if (!isRecord(value)) return null;
  const result = {};
  addField(result, value, "session", "session_id", uuid);
  addField(result, value, "session", "expires_at", timestamp);
  addField(result, value, "session", "session_receipt", safeSessionReceipt);
  return Object.keys(result).length ? result : null;
}

function safeConsume(value) {
  if (!isRecord(value)) return null;
  const result = {};
  addField(result, value, "consume", "type", (entry) => enumValue(entry, new Set(["attestation-binding-consumed"])));
  addField(result, value, "consume", "signer_key_id", identifier);
  addField(result, value, "consume", "signature_algorithm", (entry) => enumValue(entry, new Set(["Ed25519"])));
  addField(result, value, "consume", "used_at", timestamp);
  addSafeField(result, "consume", "signature_present", signaturePresence(value));
  const error = ownValue(value, "error");
  if (ownValue(value, "error_code") === "CONSUME_FAILED" || (error !== undefined && error !== null)) {
    addSafeField(result, "consume", "error_code", "CONSUME_FAILED");
  }
  return Object.keys(result).length ? result : null;
}

function byteLength(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  if (typeof value === "string") return Buffer.byteLength(value);
  return undefined;
}

function safePath(url) {
  try {
    const path = new URL(url).pathname;
    return HTTP_PATHS.has(path) ? path : "[other]";
  } catch {
    return "[invalid]";
  }
}

function safeContentType(value) {
  if (typeof value !== "string") return undefined;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return CONTENT_TYPES.has(mediaType) ? mediaType : undefined;
}

function requestContentType(headers) {
  try {
    if (headers instanceof Headers) return safeContentType(headers.get("content-type"));
    return safeContentType(ownValue(headers, "content-type") ?? ownValue(headers, "Content-Type"));
  } catch {
    return undefined;
  }
}

function safeRequest(value) {
  if (!isRecord(value)) return null;
  const result = {};
  addField(result, value, "http_request", "method", (entry) => enumValue(entry, HTTP_METHODS));
  addField(result, value, "http_request", "path", (entry) => enumValue(entry, new Set([...HTTP_PATHS, "[other]", "[invalid]" ])));
  addField(result, value, "http_request", "content_type", safeContentType);
  addField(result, value, "http_request", "body_bytes", (entry) => smallInteger(entry, 0, 64 * 1024 * 1024));
  return result;
}

function safeResponse(value) {
  if (!isRecord(value)) return null;
  const result = {};
  addField(result, value, "http_response", "status", (entry) => smallInteger(entry, 100, 599));
  addField(result, value, "http_response", "content_type", safeContentType);
  addField(result, value, "http_response", "body_bytes", (entry) => smallInteger(entry, 0, 64 * 1024 * 1024));
  return result;
}

function safeHttpExchange(value) {
  if (!isRecord(value)) return null;
  const request = safeRequest(ownValue(value, "request"));
  if (!request) return null;
  const result = {};
  addSafeField(result, "http_exchange", "request", request);
  const responseValue = ownValue(value, "response");
  const response = responseValue === undefined || responseValue === null ? null : safeResponse(responseValue);
  addSafeField(result, "http_exchange", "response", response);
  const errorValue = ownValue(value, "error");
  const error = errorValue === null || errorValue === undefined
    ? null
    : isRecord(errorValue) && ownValue(errorValue, "code") === "HTTP_REQUEST_FAILED"
      ? { code: "HTTP_REQUEST_FAILED" }
      : null;
  addSafeField(result, "http_exchange", "error", error);
  return result;
}

function safeFailureError(value) {
  if (!isRecord(value) || ownValue(value, "code") !== "CAPTURE_FAILED") return null;
  const result = {};
  addSafeField(result, "capture_error", "code", "CAPTURE_FAILED");
  addSafeField(result, "capture_error", "message", OMITTED_ERROR_MESSAGE);
  addField(result, value, "capture_error", "stage", (entry) => enumValue(entry, FAILURE_STAGES));
  return result;
}

function safeHashDescriptor(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  addField(result, value, "hash_descriptor", "bytes", (entry) => smallInteger(entry, 0, 64 * 1024 * 1024));
  addField(result, value, "hash_descriptor", "sha256", digest);
  return Object.keys(result).length === 2 ? result : undefined;
}

function safeHashes(value) {
  const result = {};
  if (!isRecord(value)) return result;
  addField(result, value, "hashes", "presentation", safeHashDescriptor);
  return result;
}

function safeRequests(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  try {
    for (let index = 0; index < Math.min(value.length, 32); index += 1) {
      const exchange = safeHttpExchange(value[index]);
      if (exchange) result.push(exchange);
    }
  } catch {
    return [];
  }
  return result;
}

export function createProductionEvidenceFailureBundle({ captureId, startedAt }) {
  return {
    schema_version: FAILURE_BUNDLE_SCHEMA_VERSION,
    scope: FAILURE_BUNDLE_SCOPE,
    status: "FAILED",
    capture_id: uuid(captureId) ?? null,
    started_at: timestamp(startedAt) ?? null,
    finished_at: null,
    error: null,
    requests: [],
    health: null,
    session: null,
    consume: null,
    hashes: {},
    provenance: null,
  };
}

export function recordHttpExchange(bundle, { url, options = {}, response, responseBytes, error }) {
  const optionsRecord = isRecord(options) ? options : {};
  const request = {
    method: enumValue(ownValue(optionsRecord, "method") ?? "GET", HTTP_METHODS) ?? "GET",
    path: safePath(url),
    body_bytes: byteLength(ownValue(optionsRecord, "body")) ?? null,
  };
  const contentType = requestContentType(ownValue(optionsRecord, "headers"));
  if (contentType) request.content_type = contentType;

  let responseSnapshot = null;
  if (response instanceof Response) {
    responseSnapshot = {
      status: smallInteger(response.status, 100, 599) ?? null,
      body_bytes: byteLength(responseBytes) ?? null,
    };
    const responseContentType = safeContentType(response.headers.get("content-type"));
    if (responseContentType) responseSnapshot.content_type = responseContentType;
  }

  const exchange = {};
  addSafeField(exchange, "http_exchange", "request", request);
  addSafeField(exchange, "http_exchange", "response", responseSnapshot);
  addSafeField(exchange, "http_exchange", "error",
    error === undefined || error === null ? null : { code: "HTTP_REQUEST_FAILED" });
  const requests = ownValue(bundle, "requests");
  if (Array.isArray(requests)) requests.push(exchange);
  return exchange;
}

export function recordFailure(bundle, { stage, finishedAt }) {
  if (!isRecord(bundle)) return;
  bundle.finished_at = timestamp(finishedAt) ?? null;
  const failure = {};
  addSafeField(failure, "capture_error", "stage", enumValue(stage, FAILURE_STAGES));
  addSafeField(failure, "capture_error", "code", "CAPTURE_FAILED");
  addSafeField(failure, "capture_error", "message", OMITTED_ERROR_MESSAGE);
  bundle.error = failure;
}

export function recordHealth(bundle, health) {
  if (isRecord(bundle)) bundle.health = safeHealth(health);
}

export function recordSession(bundle, session) {
  if (isRecord(bundle)) bundle.session = safeSession(session);
}

export function recordConsume(bundle, consume) {
  if (isRecord(bundle)) bundle.consume = safeConsume(consume);
}

export function recordHash(bundle, name, bytes) {
  if (!isRecord(bundle) || name !== "presentation" || !Buffer.isBuffer(bytes)) return;
  const hashes = ownValue(bundle, "hashes");
  if (!isRecord(hashes)) return;
  const descriptor = {};
  addSafeField(descriptor, "hash_descriptor", "bytes", bytes.length);
  addSafeField(descriptor, "hash_descriptor", "sha256", sha256Base64Url(bytes));
  const safeHashes = {};
  addSafeField(safeHashes, "hashes", "presentation", descriptor);
  hashes.presentation = safeHashes.presentation;
}

export function recordProvenance(bundle, provenance) {
  if (isRecord(bundle)) bundle.provenance = safeProvenance(provenance);
}

export function finalizeProductionEvidenceFailureBundle(bundle, finishedAt) {
  const source = isRecord(bundle) ? bundle : {};
  const result = {
    schema_version: FAILURE_BUNDLE_SCHEMA_VERSION,
    scope: FAILURE_BUNDLE_SCOPE,
    status: "FAILED",
    capture_id: uuid(ownValue(source, "capture_id")) ?? null,
    started_at: timestamp(ownValue(source, "started_at")) ?? null,
    finished_at: timestamp(finishedAt) ?? timestamp(ownValue(source, "finished_at")) ?? null,
    error: safeFailureError(ownValue(source, "error")),
    requests: safeRequests(ownValue(source, "requests")),
    health: safeHealth(ownValue(source, "health")),
    session: safeSession(ownValue(source, "session")),
    consume: safeConsume(ownValue(source, "consume")),
    hashes: safeHashes(ownValue(source, "hashes")),
    provenance: safeProvenance(ownValue(source, "provenance")),
    serialization: {
      policy: "FAILURE_BUNDLE_ALLOWLIST_V1",
      unknown_fields: "OMITTED",
      raw_request_response_bodies: "OMITTED",
      raw_exception_details: "OMITTED",
    },
  };
  return result;
}