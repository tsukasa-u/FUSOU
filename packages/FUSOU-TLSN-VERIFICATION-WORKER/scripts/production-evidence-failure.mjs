import { sha256Base64Url } from "./deployment-attestation.mjs";
import failureBundleV2Schema from "../schemas/tlsn-production-evidence-failure-v2.schema.json" with { type: "json" };

const OMITTED_ERROR_MESSAGE = "Details omitted to prevent sensitive-data disclosure";
const FAILURE_BUNDLE_SCHEMA_VERSION = failureBundleV2Schema.properties.schema_version.const;
const FAILURE_BUNDLE_SCOPE = failureBundleV2Schema.properties.scope.const;
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
const HASH_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WORKER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const PROXY_BINARY_PATTERN = /^proxy-https:\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

const SAFE_FIELD_SCHEMA_GROUPS = Object.freeze({
  health: "health",
  health_runtime_version: "runtimeVersion",
  health_security_identity: "securityIdentity",
  health_deployment_identity: "deploymentIdentity",
  provenance: "provenance",
  proxy_provenance: "proxyProvenance",
  proxy_authority: "proxyAuthority",
  session: "session",
  session_receipt: "sessionReceipt",
  consume: "consume",
  http_request: "httpRequest",
  http_response: "httpResponse",
  http_exchange: "httpExchange",
  http_error: "httpError",
  capture_error: "captureError",
  hash_descriptor: "hashDescriptor",
  hashes: "hashes",
});
// Field names and accepted JSON shapes come from the dedicated v2 schema.
export const FAILURE_BUNDLE_SAFE_FIELD_CONTRACT = Object.freeze(Object.fromEntries(
  Object.entries(SAFE_FIELD_SCHEMA_GROUPS).map(([group, definition]) => [
    group,
    Object.freeze(Object.keys(failureBundleV2Schema.$defs[definition].properties)),
  ]),
));
const FAILURE_BUNDLE_SAFE_FIELD_SETS = new Map(
  Object.entries(FAILURE_BUNDLE_SAFE_FIELD_CONTRACT).map(([group, fields]) => [group, new Set(fields)]),
);
const RAW_SIGNATURE_PRESENCE = new WeakMap();

function isRecord(value) {
  if (!value || typeof value !== "object") return false;
  try {
    if (Array.isArray(value)) return false;
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

function matchesPattern(value, pattern) {
  if (typeof value !== "string") return false;
  const match = pattern.exec(value);
  return match?.index === 0 && match[0].length === value.length;
}

function identifier(value) {
  return matchesPattern(value, IDENTIFIER_PATTERN) ? value : undefined;
}

function uuid(value) {
  return matchesPattern(value, UUID_PATTERN) ? value.toLowerCase() : undefined;
}

function commit(value) {
  return matchesPattern(value, COMMIT_PATTERN) ? value.toLowerCase() : undefined;
}

function digest(value) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value ? value : undefined;
}

function timestamp(value) {
  if (!matchesPattern(value, TIMESTAMP_PATTERN)) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

function boolean(value) {
  return typeof value === "boolean" ? value : undefined;
}

function signaturePresence(value) {
  if (isRecord(value) && RAW_SIGNATURE_PRESENCE.has(value)) {
    return RAW_SIGNATURE_PRESENCE.get(value);
  }
  const signature = ownValue(value, "signature");
  return typeof signature === "string" && signature.length > 0 && signature.length <= 1024;
}

function addSignaturePresence(target, source, group) {
  const present = signaturePresence(source);
  RAW_SIGNATURE_PRESENCE.set(target, present);
  addSafeField(target, group, "signature_present", present);
}

function smallInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined;
}

function safeRuntimeVersion(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  addField(result, value, "health_runtime_version", "version_id", uuid);
  addField(result, value, "health_runtime_version", "version_tag", (entry) =>
    matchesPattern(entry, /^[A-Za-z0-9._-]{1,128}$/) ? entry : undefined);
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
    matchesPattern(entry, WORKER_NAME_PATTERN) ? entry : undefined);
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
    typeof entry === "string" && entry.length <= 128 && matchesPattern(entry, /^fusou-proxy(?:-[a-z0-9]+)*$/) ? entry : undefined);
  addField(result, value, "proxy_provenance", "proxy_deployment_id", (entry) => entry === null ? null : identifier(entry));
  addField(result, value, "proxy_provenance", "proxy_binary_identity", (entry) =>
    typeof entry === "string" && entry.length <= 128 && matchesPattern(entry, PROXY_BINARY_PATTERN) ? entry : undefined);
  addField(result, value, "proxy_provenance", "presentation_sha256", digest);
  addField(result, value, "proxy_provenance", "created_at", timestamp);
  addField(result, value, "proxy_provenance", "signer_key_id", identifier);
  addField(result, value, "proxy_provenance", "authority", safeProxyAuthority);
  addSignaturePresence(result, value, "proxy_provenance");
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
  addSignaturePresence(result, value, "session_receipt");
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
  addSignaturePresence(result, value, "consume");
  const error = ownValue(value, "error");
  if (ownValue(value, "error_code") === "CONSUME_FAILED" || (error !== undefined && error !== null)) {
    addSafeField(result, "consume", "error_code", "CONSUME_FAILED");
  }
  return Object.keys(result).length ? result : null;
}

function byteLength(value) {
  try {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
    if (typeof value === "string") return Buffer.byteLength(value);
    return undefined;
  } catch {
    return undefined;
  }
}

function safePath(url) {
  if (typeof url !== "string") return "[invalid]";
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
  try {
    if (!Array.isArray(value)) return [];
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 0) return [];
    const result = [];
    for (let index = 0; index < Math.min(length, 32); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value")) continue;
      const exchange = safeHttpExchange(descriptor.value);
      if (exchange) result.push(exchange);
    }
    return result;
  } catch {
    return [];
  }
}

function matchesJsonType(value, type) {
  if (type === "null") return value === null;
  if (type === "object") return isRecord(value);
  if (type === "array") {
    try {
      return Array.isArray(value);
    } catch {
      return false;
    }
  }
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return false;
}

function resolvesSchemaReference(reference) {
  const match = /^#\/\$defs\/([A-Za-z0-9]+)$/.exec(reference);
  return match ? failureBundleV2Schema.$defs[match[1]] : undefined;
}

function validateSchemaValue(value, schema, activeValues = new WeakSet()) {
  if (schema.$ref) {
    const referencedSchema = resolvesSchemaReference(schema.$ref);
    return referencedSchema ? validateSchemaValue(value, referencedSchema, activeValues) : false;
  }

  if (schema.anyOf) {
    return schema.anyOf.some((branch) => validateSchemaValue(value, branch, activeValues));
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesJsonType(value, type))) return false;
  }

  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) return false;
  if (schema.enum && !schema.enum.some((entry) => Object.is(value, entry))) return false;

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (schema.pattern && !matchesPattern(value, new RegExp(schema.pattern))) return false;
    if (schema.format === "date-time" && timestamp(value) !== value) return false;
    if (schema.format === "sha256-base64url-32" && digest(value) !== value) return false;
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }

  if (Array.isArray(value)) {
    if (activeValues.has(value)) return false;
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length)) return false;
    if (schema.maxItems !== undefined && length > schema.maxItems) return false;
    activeValues.add(value);
    try {
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") return false;
        if (key === "length") continue;
        if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length) return false;
      }
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) return false;
        if (schema.items && !validateSchemaValue(descriptor.value, schema.items, activeValues)) return false;
      }
      return true;
    } finally {
      activeValues.delete(value);
    }
  }

  if (isRecord(value)) {
    if (activeValues.has(value)) return false;
    activeValues.add(value);
    try {
      const properties = schema.properties ?? {};
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key !== "string")) return false;
      if (schema.minProperties !== undefined && ownKeys.length < schema.minProperties) return false;
      const descriptors = new Map();
      for (const key of ownKeys) {
        if (!Object.hasOwn(properties, key) && schema.additionalProperties === false) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) return false;
        descriptors.set(key, descriptor);
      }
      for (const required of schema.required ?? []) {
        if (!descriptors.has(required)) return false;
      }
      for (const [key, descriptor] of descriptors) {
        const propertySchema = properties[key];
        if (propertySchema && !validateSchemaValue(descriptor.value, propertySchema, activeValues)) return false;
      }
      return true;
    } finally {
      activeValues.delete(value);
    }
  }

  return true;
}

export function assertProductionEvidenceFailureBundleV2(value) {
  let isValid = false;
  try {
    isValid = validateSchemaValue(value, failureBundleV2Schema);
  } catch {
    isValid = false;
  }
  if (!isValid) {
    throw new TypeError("Production evidence failure artifact does not match schema v2");
  }
  return true;
}

export function createProductionEvidenceFailureBundle(input = {}) {
  return {
    schema_version: FAILURE_BUNDLE_SCHEMA_VERSION,
    scope: FAILURE_BUNDLE_SCOPE,
    status: "FAILED",
    capture_id: uuid(ownValue(input, "captureId")) ?? null,
    started_at: timestamp(ownValue(input, "startedAt")) ?? null,
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

export function recordHttpExchange(bundle, input = {}) {
  const url = ownValue(input, "url");
  const optionsValue = ownValue(input, "options");
  const optionsRecord = isRecord(optionsValue) ? optionsValue : {};
  const response = ownValue(input, "response");
  const responseBytes = ownValue(input, "responseBytes");
  const error = ownValue(input, "error");
  const request = {
    method: enumValue(ownValue(optionsRecord, "method") ?? "GET", HTTP_METHODS) ?? "GET",
    path: safePath(url),
    body_bytes: byteLength(ownValue(optionsRecord, "body")) ?? null,
  };
  const contentType = requestContentType(ownValue(optionsRecord, "headers"));
  if (contentType) request.content_type = contentType;

  let responseSnapshot = null;
  let isResponse = false;
  try {
    isResponse = response instanceof Response;
  } catch {
    isResponse = false;
  }
  if (isResponse) {
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

export function recordFailure(bundle, input = {}) {
  if (!isRecord(bundle)) return;
  bundle.finished_at = timestamp(ownValue(input, "finishedAt")) ?? null;
  const failure = {};
  addSafeField(failure, "capture_error", "stage", enumValue(ownValue(input, "stage"), FAILURE_STAGES));
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
  assertProductionEvidenceFailureBundleV2(result);
  return result;
}