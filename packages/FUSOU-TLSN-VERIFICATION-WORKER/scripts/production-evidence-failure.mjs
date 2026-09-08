import { sha256Base64Url } from "./deployment-attestation.mjs";

const SENSITIVE_KEY = /authorization|binding|challenge|cookie|password|private|secret|token/i;

function bodyBytes(body) {
  if (body === undefined || body === null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  return null;
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) ?? undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function safePath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "[invalid-url]";
  }
}

function hashDescriptor(bytes) {
  return bytes ? { bytes: bytes.length, sha256: sha256Base64Url(bytes) } : null;
}

function redactValue(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
}

function safeHealth(value) {
  if (!value || typeof value !== "object") return null;
  return redactValue(value);
}

export function createProductionEvidenceFailureBundle({ captureId, startedAt }) {
  return {
    schema_version: 1,
    scope: "tlsn-production-evidence-failure",
    status: "FAILED",
    capture_id: captureId,
    started_at: startedAt,
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
  const requestBody = bodyBytes(options.body);
  const request = {
    method: options.method ?? "GET",
    path: safePath(url),
    content_type: headerValue(options.headers, "content-type") ?? null,
    body: hashDescriptor(requestBody),
  };
  const exchange = {
    request,
    response: response
      ? {
          status: response.status,
          content_type: response.headers.get("content-type") ?? null,
          body: hashDescriptor(responseBytes),
        }
      : null,
    error: error ? { name: error.name ?? "Error", message: String(error.message ?? error) } : null,
  };
  bundle.requests.push(exchange);
  return exchange;
}

export function recordFailure(bundle, { stage, error, finishedAt }) {
  bundle.finished_at = finishedAt;
  bundle.error = {
    stage,
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function recordHealth(bundle, health) {
  bundle.health = safeHealth(health);
}

export function recordSession(bundle, session) {
  if (!session || typeof session !== "object") return;
  bundle.session = {
    session_id: session.session_id ?? null,
    device_id: session.device_id ?? null,
    expires_at: session.expires_at ?? null,
    binding_sha256: typeof session.binding === "string" ? sha256Base64Url(session.binding) : null,
    challenge_sha256: typeof session.challenge === "string" ? sha256Base64Url(session.challenge) : null,
    device_challenge_sha256: typeof session.device_challenge === "string" ? sha256Base64Url(session.device_challenge) : null,
    session_receipt: session.session_receipt
      ? {
          session_id: session.session_receipt.session_id ?? null,
          signer_key_id: session.session_receipt.signer_key_id ?? null,
          created_at: session.session_receipt.created_at ?? null,
          expires_at: session.session_receipt.expires_at ?? null,
          signature_present: typeof session.session_receipt.signature === "string",
        }
      : null,
  };
}

export function recordConsume(bundle, consume) {
  if (!consume || typeof consume !== "object") return;
  bundle.consume = {
    status: consume.status ?? null,
    error: consume.error ?? null,
    session_id: consume.session_id ?? null,
    device_id: consume.device_id ?? null,
    presentation_id: consume.presentation_id ?? null,
    used_at: consume.used_at ?? null,
    signer_key_id: consume.signer_key_id ?? null,
    signature_present: typeof consume.signature === "string",
  };
}

export function recordHash(bundle, name, bytes) {
  if (!bytes) return;
  bundle.hashes[name] = hashDescriptor(bytes);
}

export function recordProvenance(bundle, provenance) {
  if (!provenance || typeof provenance !== "object") return;
  const snapshot = redactValue(provenance);
  const signature = provenance.proxy_provenance?.signature;
  if (typeof signature === "string") {
    snapshot.proxy_provenance.signature = {
      present: true,
      sha256: sha256Base64Url(Buffer.from(signature)),
    };
  }
  bundle.provenance = snapshot;
}

export function finalizeProductionEvidenceFailureBundle(bundle, finishedAt) {
  return {
    ...bundle,
    finished_at: finishedAt,
    redaction: {
      "raw request/response bodies omitted": true,
      "credential-bearing fields omitted_or_hashed": true,
      sensitive_key_pattern: SENSITIVE_KEY.source,
    },
  };
}