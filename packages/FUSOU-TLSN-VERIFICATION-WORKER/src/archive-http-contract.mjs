import { canonicalJson, sha256Base64Url } from "./origin-trust-contract.mjs";

export const ARCHIVE_HTTP_PATH = "/internal/tlsn/archive-readback/v1";
export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const ARCHIVE_WORKFLOW_REF = "tsukasa-u/FUSOU/.github/workflows/tlsn-release-eligibility.yml@refs/heads/main";
export const MAX_ARCHIVE_OBJECT_BYTES = 8 * 1024 * 1024;
export class ArchiveTransportError extends Error {
  constructor(code, status = 403) { super(code); this.code = code; this.status = status; }
}
export function transportRequire(condition, code, status = 403) {
  if (!condition) throw new ArchiveTransportError(code, status);
}
const text = (value) => typeof value === "string" && value.length > 0 && value.length <= 512;
const sha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const digest = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const timestamp = (value) => Number.isSafeInteger(value) && value >= 0;
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
export const archivePolicyBytes = (policy) => new TextEncoder().encode(canonicalJson(policy));

export async function validateArchiveTransportSpec(spec) {
  transportRequire(spec?.policy && digest(spec.policy_sha256) &&
    await sha256Base64Url(archivePolicyBytes(spec.policy)) === spec.policy_sha256, "ARCHIVE_HTTP_POLICY_PIN_MISSING_OR_MISMATCH", 503);
  const p = spec.policy;
  let endpoint;
  try { endpoint = new URL(p.endpoint); } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new ArchiveTransportError("ARCHIVE_HTTP_ENDPOINT_INVALID", 503);
  }
  transportRequire(p.schema_version === 1 && p.scope === "fusou-github-oidc-archive-read-v1" &&
    endpoint.protocol === "https:" && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash &&
    endpoint.pathname === ARCHIVE_HTTP_PATH && endpoint.href === p.endpoint && p.audience === p.endpoint &&
    p.repository === "tsukasa-u/FUSOU" && typeof p.repository_id === "string" && /^[1-9][0-9]*$/.test(p.repository_id) &&
    p.workflow_ref === ARCHIVE_WORKFLOW_REF && p.event_name === "workflow_run" && p.ref === "refs/heads/main" &&
    Number.isInteger(p.clock_skew_seconds) && p.clock_skew_seconds >= 0 && p.clock_skew_seconds <= 60 &&
    positive(p.max_token_age_seconds) && p.max_token_age_seconds <= 600 &&
    positive(p.max_object_bytes) && p.max_object_bytes <= MAX_ARCHIVE_OBJECT_BYTES &&
    Array.isArray(p.grants) && p.grants.length > 0 && p.grants.length <= 128 &&
    (p.job_workflow_ref === undefined && p.job_workflow_sha === undefined ||
      p.job_workflow_ref === ARCHIVE_WORKFLOW_REF && sha(p.job_workflow_sha)), "ARCHIVE_HTTP_POLICY_INVALID", 503);
  const ids = new Set();
  for (const g of p.grants) {
    transportRequire(sha(g.workflow_sha) && sha(g.source_sha) && positive(g.run_id) && positive(g.run_attempt) &&
      digest(g.capture_id) && g.capture_id === g.binding_id && text(g.verification_attempt_id) &&
      g.lookup && ["session_id", "canonical_user_id", "device_id", "verification_job_id"].every((key) => text(g.lookup[key])) &&
      timestamp(g.not_before_ms) && timestamp(g.expires_at_ms) && g.expires_at_ms > g.not_before_ms &&
      timestamp(g.capture_not_before_ms) && positive(g.capture_max_age_ms), "ARCHIVE_HTTP_GRANT_INVALID", 503);
    const id = `${g.run_id}/${g.run_attempt}/${g.capture_id}`;
    transportRequire(!ids.has(id), "ARCHIVE_HTTP_GRANT_AMBIGUOUS", 503); ids.add(id);
  }
  return structuredClone(p);
}

export function archiveTransportGrant(policy, request, nowMs) {
  const keys = ["source_sha", "workflow_sha", "run_id", "run_attempt", "capture_id", "session_id", "job_id",
    "verification_attempt_id", "binding_id", "role"];
  transportRequire(request && Object.keys(request).length === keys.length && keys.every((key) => Object.hasOwn(request, key)) &&
    ["presentation", "result"].includes(request.role) && timestamp(nowMs), "ARCHIVE_HTTP_REQUEST_INVALID", 400);
  const grant = policy.grants.find((g) => ["source_sha", "workflow_sha", "run_id", "run_attempt", "capture_id", "binding_id",
    "verification_attempt_id"].every((key) => g[key] === request[key]) &&
    g.lookup.session_id === request.session_id && g.lookup.verification_job_id === request.job_id);
  transportRequire(grant && nowMs >= grant.not_before_ms && nowMs < grant.expires_at_ms, "ARCHIVE_HTTP_GRANT_MISSING_OR_EXPIRED");
  return grant;
}

export function assertCatalogGrant(catalog, grant, policy, nowMs) {
  const created = Date.parse(catalog?.created_at);
  const catalogKeys = ["schema_version", "scope", "capture_id", "source_sha", "writer", "session_id", "job_id",
    "verification_attempt_id", "binding_id", "created_at", "authority_used_at", "validity_scope", "objects",
    "result_envelope_sha256", "generation_semantics", "previous_generation_retrieval", "retention_status"];
  if (catalog?.verifier_execution_receipt_sha256 !== undefined) catalogKeys.push("verifier_execution_receipt_sha256");
  transportRequire(exactKeys(catalog, catalogKeys) && catalog.schema_version === 1 && catalog.scope === "fusou-consumed-archive-catalog-v1" &&
    ["source_sha", "capture_id", "binding_id", "verification_attempt_id"].every((key) => catalog[key] === grant[key]) &&
    catalog.session_id === grant.lookup.session_id && catalog.job_id === grant.lookup.verification_job_id &&
    exactKeys(catalog.writer, ["authority_binding", "archive_binding"]) && exactKeys(catalog.objects, ["presentation", "result"]) &&
    catalog.writer.authority_binding === "TLSN_BINDINGS" && catalog.writer.archive_binding === "TLSN_PRESENTATIONS" &&
    catalog.validity_scope === "EXACT_CONSUMED_BINDING" && Number.isFinite(Date.parse(catalog.authority_used_at)) &&
    created >= grant.capture_not_before_ms && created <= nowMs && nowMs - created <= grant.capture_max_age_ms &&
    catalog.generation_semantics === "CURRENT_OBJECT_VERSION_EQUALITY" &&
    catalog.previous_generation_retrieval === "NOT_IMPLEMENTED" && catalog.retention_status === "NOT_CHECKED",
  "ARCHIVE_HTTP_CATALOG_SCOPE_OR_FRESHNESS");
  for (const role of ["presentation", "result"]) {
    const o = catalog.objects?.[role];
    transportRequire(exactKeys(o, ["role", "source_sha", "binding_id", "session_id", "job_id", "verification_attempt_id",
      "object_key", "version_id", "sha256", "byte_length"]) &&
      o.role === role && ["source_sha", "binding_id", "verification_attempt_id"].every((key) => o[key] === grant[key]) &&
      o.session_id === catalog.session_id && o.job_id === catalog.job_id &&
      o.object_key === `tlsn-verification/${grant.verification_attempt_id}/${role}.${role === "presentation" ? "bin" : "json"}` &&
      text(o.version_id) && digest(o.sha256) && positive(o.byte_length) && o.byte_length <= policy.max_object_bytes,
    "ARCHIVE_HTTP_CATALOG_OBJECT_INVALID");
  }
  transportRequire(catalog.result_envelope_sha256 === catalog.objects.result.sha256 &&
    (catalog.verifier_execution_receipt_sha256 === undefined || digest(catalog.verifier_execution_receipt_sha256)),
  "ARCHIVE_HTTP_CATALOG_RESULT_BINDING");
}

export async function boundedBody(message, limit) {
  const length = message.headers.get("content-length");
  transportRequire(length === null || /^[0-9]+$/.test(length) && Number(length) <= limit, "ARCHIVE_HTTP_BODY_TOO_LARGE", 413);
  transportRequire(message.body, "ARCHIVE_HTTP_BODY_MISSING", 400);
  const reader = message.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ArchiveTransportError("ARCHIVE_HTTP_BODY_TOO_LARGE", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export function parseArchiveJson(bytes) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch (error) {
    if (!(error instanceof SyntaxError || error instanceof TypeError)) throw error;
    throw new ArchiveTransportError("ARCHIVE_HTTP_JSON_INVALID", 400);
  }
}
export function archiveAuthorization(policy, policySha256, request) {
  return { kind: "TRUSTED_PRODUCER_HTTPS_FETCH", issuer: GITHUB_OIDC_ISSUER, audience: policy.audience,
    repository: policy.repository, repository_id: policy.repository_id, workflow_ref: policy.workflow_ref,
    workflow_sha: request.workflow_sha, run_id: request.run_id, run_attempt: request.run_attempt,
    source_sha: request.source_sha, capture_id: request.capture_id, policy_sha256: policySha256 };
}
export function archiveReadRequest(context, expected, role) {
  const o = expected.objects[role];
  return { source_sha: context.source_sha, workflow_sha: context.workflow_sha, run_id: context.run_id, run_attempt: context.run_attempt,
    capture_id: expected.capture_id, session_id: expected.session_id, job_id: o.job_id, verification_attempt_id: o.verification_attempt_id,
    binding_id: o.binding_id, role };
}
export function decodeArchiveBytes(value) {
  transportRequire(typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value), "ARCHIVE_HTTP_BYTES_INVALID");
  let bytes;
  try { bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)); }
  catch (error) {
    if (!(error instanceof DOMException)) throw error;
    throw new ArchiveTransportError("ARCHIVE_HTTP_BYTES_INVALID");
  }
  transportRequire(encodeArchiveBytes(bytes) === value, "ARCHIVE_HTTP_BYTES_NONCANONICAL");
  return bytes;
}
export function encodeArchiveBytes(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export async function verifyArchiveHttpResponse(raw, { spec, policy, request, expected, nowMs }) {
  const grant = archiveTransportGrant(policy, request, nowMs), response = parseArchiveJson(raw);
  transportRequire(exactKeys(response, ["schema_version", "scope", "authorization", "observed_at_ms", "catalog", "bytes"]) &&
    new TextDecoder().decode(raw) === canonicalJson(response) &&
    response.schema_version === 1 && response.scope === "fusou-archive-http-response-v1" &&
    canonicalJson(response.authorization) === canonicalJson(archiveAuthorization(policy, spec.policy_sha256, request)) &&
    timestamp(response.observed_at_ms) && response.observed_at_ms <= nowMs &&
    response.observed_at_ms >= grant.not_before_ms && response.observed_at_ms < grant.expires_at_ms &&
    Number.isSafeInteger(expected.max_age_ms) && nowMs - response.observed_at_ms <= expected.max_age_ms, "ARCHIVE_HTTP_RESPONSE_CONTEXT");
  assertCatalogGrant(response.catalog, grant, policy, nowMs);
  const snapshot = response.catalog.objects[request.role], identity = expected.objects[request.role];
  transportRequire(["role", "source_sha", "binding_id", "verification_attempt_id", "session_id", "job_id", "object_key", "version_id", "sha256"]
    .every((key) => snapshot[key] === identity[key]) && identity.capture_id === response.catalog.capture_id &&
    identity.backend_id === policy.endpoint, "ARCHIVE_HTTP_RESPONSE_INDEPENDENT_CATALOG_MISMATCH");
  const bytes = decodeArchiveBytes(response.bytes);
  transportRequire(bytes.byteLength === snapshot.byte_length && await sha256Base64Url(bytes) === snapshot.sha256,
    "ARCHIVE_HTTP_RESPONSE_RAW_BYTES_MISMATCH");
  return { ...identity, byte_length: bytes.byteLength, bytes, retention_status: "NOT_CHECKED" };
}
