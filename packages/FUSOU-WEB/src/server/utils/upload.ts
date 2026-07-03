import type { R2BucketBinding } from "../types";
import { SIGNED_URL_TTL_SECONDS } from "../constants";

/**
 * Common two-stage upload handler for secure, hash-verified uploads
 *
 * Provides unified authentication and hash verification flow for:
 * - fleet.ts (snapshots)
 * - asset.ts (static assets)
 * - r2.ts (shared database)
 */

export interface PrepareResult {
  tokenPayload?: Record<string, any>;
  fields?: Record<string, any>;
}

export interface ExecuteResult {
  response: any; // Custom response data to return
}

export interface UploadAuthContext {
  datasetToken?: {
    dataset_id: string;
    user_id: string;
    trust_tag: "hw_verified" | "sw_verified" | "unverified" | "suspicious";
  };
}

type UploadGuardStatus = 200 | 400 | 401 | 403 | 409 | 500 | 503;

type UploadAttestationRequirement =
  | "optional"
  | "require_report"
  | "require_hardware";

export type UploadTrustDecision = {
  allow: boolean;
  status: UploadGuardStatus;
  error?: string;
  trustTag: "hw_verified" | "sw_verified" | "unverified" | "suspicious";
  attestationLevel: string;
  attestationValid: boolean;
};

const SECURE_ENCLAVE_TRUSTED_ROOT_ENV =
  "INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256";
const TPM_AK_TRUSTED_ROOT_ENV = "INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256";
const MAX_ATTESTATION_FIELD_LENGTH = 8 * 1024;
const MAX_ATTESTATION_FORMAT_LENGTH = 128;
const MAX_ATTESTATION_CERT_CHAIN_LENGTH = 8;
const MAX_ATTESTATION_CERT_B64_LENGTH = 12 * 1024;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const UPLOAD_ATTESTATION_NONCE_MAX_AGE_MS = 10 * 60 * 1000;
const REPLAY_GUARD_MIN_TTL_SECONDS = 120;

function normalizeSha256Hex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return SHA256_HEX_PATTERN.test(normalized) ? normalized : null;
}

function extractNonceBoundContentHash(nonce: string): string | null {
  const normalized = nonce.trim().toLowerCase();
  const match = normalized.match(/^upload:\d{10,}:([a-f0-9]{64})$/);
  return match ? match[1] : null;
}

function extractNonceTimestampMs(nonce: string): number | null {
  const normalized = nonce.trim().toLowerCase();
  const match = normalized.match(/^upload:(\d{10,}):[a-f0-9]{64}$/);
  if (!match) return null;
  const ts = Number.parseInt(match[1], 10);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return ts;
}

function resolveReplayGuardKV(c: any): KVNamespace | null {
  return (
    ((c as any)?.env?.DATA_LOADER_CACHE_KV as KVNamespace | undefined) ??
    ((c as any)?.env?.env?.DATA_LOADER_CACHE_KV as KVNamespace | undefined) ??
    null
  );
}

async function consumeReplayGuard(options: {
  c: any;
  key: string;
  ttlSeconds: number;
}): Promise<{ ok: true } | { ok: false; status: UploadGuardStatus; error: string }> {
  const kv = resolveReplayGuardKV(options.c);
  if (!kv) {
    return {
      ok: false,
      status: 503,
      error: "replay_protection_unavailable",
    };
  }

  const existing = await kv.get(options.key);
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: "replay_detected",
    };
  }

  const ttlSeconds = Math.max(REPLAY_GUARD_MIN_TTL_SECONDS, options.ttlSeconds);
  await kv.put(options.key, "1", { expirationTtl: ttlSeconds });
  return { ok: true };
}

function normalizeBoundedString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function parseUploadAttestationReport(
  value: unknown,
): {
  report:
    | {
        attestation_level: "tpm" | "secure_enclave" | "software_fingerprint" | "none";
        attestation_data?: string;
        attestation_signature?: string;
        public_key?: string;
        certificate_chain?: string[];
        attestation_format?: string;
        fingerprint?: Record<string, unknown>;
        environment?: Record<string, unknown>;
      }
    | null;
  malformed: boolean;
} {
  if (value == null) {
    return { report: null, malformed: false };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { report: null, malformed: true };
  }

  const raw = value as Record<string, unknown>;
  const level = raw.attestation_level;
  if (
    level !== "tpm" &&
    level !== "secure_enclave" &&
    level !== "software_fingerprint" &&
    level !== "none"
  ) {
    return { report: null, malformed: true };
  }

  const attestationData =
    raw.attestation_data === undefined
      ? undefined
      : normalizeBoundedString(raw.attestation_data, MAX_ATTESTATION_FIELD_LENGTH);
  if (raw.attestation_data !== undefined && attestationData == null) {
    return { report: null, malformed: true };
  }

  const attestationSignature =
    raw.attestation_signature === undefined
      ? undefined
      : normalizeBoundedString(
          raw.attestation_signature,
          MAX_ATTESTATION_FIELD_LENGTH,
        );
  if (raw.attestation_signature !== undefined && attestationSignature == null) {
    return { report: null, malformed: true };
  }

  const publicKey =
    raw.public_key === undefined
      ? undefined
      : normalizeBoundedString(raw.public_key, MAX_ATTESTATION_FIELD_LENGTH);
  if (raw.public_key !== undefined && publicKey == null) {
    return { report: null, malformed: true };
  }

  const attestationFormat =
    raw.attestation_format === undefined
      ? undefined
      : normalizeBoundedString(
          raw.attestation_format,
          MAX_ATTESTATION_FORMAT_LENGTH,
        );
  if (raw.attestation_format !== undefined && attestationFormat == null) {
    return { report: null, malformed: true };
  }

  let certificateChain: string[] | undefined;
  if (raw.certificate_chain !== undefined) {
    if (!Array.isArray(raw.certificate_chain)) {
      return { report: null, malformed: true };
    }
    if (raw.certificate_chain.length > MAX_ATTESTATION_CERT_CHAIN_LENGTH) {
      return { report: null, malformed: true };
    }

    const normalizedChain: string[] = [];
    for (const item of raw.certificate_chain) {
      const normalized = normalizeBoundedString(
        item,
        MAX_ATTESTATION_CERT_B64_LENGTH,
      );
      if (!normalized) {
        return { report: null, malformed: true };
      }
      normalizedChain.push(normalized);
    }
    certificateChain = normalizedChain;
  }

  return {
    malformed: false,
    report: {
      attestation_level: level,
      ...(attestationData ? { attestation_data: attestationData } : {}),
      ...(attestationSignature
        ? { attestation_signature: attestationSignature }
        : {}),
      ...(publicKey ? { public_key: publicKey } : {}),
      ...(certificateChain ? { certificate_chain: certificateChain } : {}),
      ...(attestationFormat ? { attestation_format: attestationFormat } : {}),
      ...(raw.fingerprint && typeof raw.fingerprint === "object"
        ? { fingerprint: raw.fingerprint as Record<string, unknown> }
        : {}),
      ...(raw.environment && typeof raw.environment === "object"
        ? { environment: raw.environment as Record<string, unknown> }
        : {}),
    },
  };
}

function resolveRequiredTrustedRootEnv(options: {
  attestationLevel: string;
  secureEnclaveTrustedRoots: string[];
  tpmAkTrustedRoots: string[];
}): string | null {
  if (
    options.attestationLevel === "secure_enclave" &&
    options.secureEnclaveTrustedRoots.length === 0
  ) {
    return SECURE_ENCLAVE_TRUSTED_ROOT_ENV;
  }
  if (options.attestationLevel === "tpm" && options.tpmAkTrustedRoots.length === 0) {
    return TPM_AK_TRUSTED_ROOT_ENV;
  }
  return null;
}

function parseTrustedRootList(raw: string | undefined): string[] {
  if (!raw) return [];

  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      }
    } catch {
      // Fallback to delimiter-based parsing below.
    }
  }

  return trimmed
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function resolveUploadTrustTag(options: {
  c: any;
  body: any;
  requirement: UploadAttestationRequirement;
  datasetId?: string;
}): Promise<UploadTrustDecision> {
  const parsed = parseUploadAttestationReport(options.body?.attestation_report);

  if (parsed.malformed) {
    return {
      allow: false,
      status: 400,
      error: "attestation_report_malformed",
      trustTag: "suspicious",
      attestationLevel: "malformed",
      attestationValid: false,
    };
  }

  const report = parsed.report;
  if (!report) {
    const reportRequired =
      options.requirement === "require_report" ||
      options.requirement === "require_hardware";
    return {
      allow: !reportRequired,
      status: reportRequired ? 401 : 200,
      ...(reportRequired
        ? { error: "attestation_report_required" }
        : {}),
      trustTag: "unverified",
      attestationLevel: "none",
      attestationValid: false,
    };
  }

  const level = report.attestation_level;

  // Hardware attestation verification is nonce-bound. If upload nonce is not
  // provided, we keep behavior lenient and downgrade to unverified.
  const nonce =
    typeof options.body?.attestation_nonce === "string"
      ? options.body.attestation_nonce.trim()
      : "";
  const contentHash = normalizeSha256Hex(options.body?.content_hash);

  if (level === "tpm" || level === "secure_enclave") {
    if (!contentHash) {
      return {
        allow: false,
        status: 400,
        error: "content_hash_required_for_hardware_attestation",
        trustTag: "suspicious",
        attestationLevel: level,
        attestationValid: false,
      };
    }

    const nonceBoundHash = extractNonceBoundContentHash(nonce);
    if (!nonceBoundHash || nonceBoundHash !== contentHash) {
      return {
        allow: false,
        status: 401,
        error: "attestation_nonce_content_hash_mismatch",
        trustTag: "suspicious",
        attestationLevel: level,
        attestationValid: false,
      };
    }

    const nonceTimestamp = extractNonceTimestampMs(nonce);
    if (!nonceTimestamp) {
      return {
        allow: false,
        status: 401,
        error: "attestation_nonce_malformed",
        trustTag: "suspicious",
        attestationLevel: level,
        attestationValid: false,
      };
    }

    const nonceAgeMs = Math.abs(Date.now() - nonceTimestamp);
    if (nonceAgeMs > UPLOAD_ATTESTATION_NONCE_MAX_AGE_MS) {
      return {
        allow: false,
        status: 401,
        error: "attestation_nonce_expired",
        trustTag: "suspicious",
        attestationLevel: level,
        attestationValid: false,
      };
    }

    const datasetScope = (options.datasetId ?? "").trim() || "unknown";
    const nonceConsume = await consumeReplayGuard({
      c: options.c,
      key: `upload-attestation-nonce:${datasetScope}:${nonce}`,
      ttlSeconds: Math.ceil(UPLOAD_ATTESTATION_NONCE_MAX_AGE_MS / 1000),
    });
    if (!nonceConsume.ok) {
      return {
        allow: false,
        status: nonceConsume.status,
        error: nonceConsume.error,
        trustTag: "suspicious",
        attestationLevel: level,
        attestationValid: false,
      };
    }
  }

  if ((level === "tpm" || level === "secure_enclave") && !nonce) {
    console.warn(
      "[upload] attestation_report provided without attestation_nonce; falling back to unverified",
    );
    const hardwareRequired = options.requirement === "require_hardware";
    return {
      allow: !hardwareRequired,
      status: hardwareRequired ? 401 : 200,
      ...(hardwareRequired
        ? { error: "attestation_nonce_required" }
        : {}),
      trustTag: hardwareRequired ? "suspicious" : "unverified",
      attestationLevel: level,
      attestationValid: false,
    };
  }

  const { createEnvContext, getEnv } = await import("../utils");
  const { verifyAttestation } = await import("./attestation-verifier");
  const { determineTrustTag } = await import("./trust-tag");

  const env = createEnvContext(options.c);
  const secureEnclaveRoots = parseTrustedRootList(
    getEnv(env, SECURE_ENCLAVE_TRUSTED_ROOT_ENV),
  );
  const tpmAkRoots = parseTrustedRootList(getEnv(env, TPM_AK_TRUSTED_ROOT_ENV));

  const missingRootEnv = resolveRequiredTrustedRootEnv({
    attestationLevel: level,
    secureEnclaveTrustedRoots: secureEnclaveRoots,
    tpmAkTrustedRoots: tpmAkRoots,
  });
  if (missingRootEnv) {
    console.error(
      `[upload] missing trusted root env for hardware attestation: ${missingRootEnv}`,
    );
    return {
      allow: false,
      status: 503,
      error: "attestation_trusted_root_unconfigured",
      trustTag: "suspicious",
      attestationLevel: level,
      attestationValid: false,
    };
  }

  const trustInput = await verifyAttestation(report as any, nonce, {
    secureEnclaveTrustedRootSha256: secureEnclaveRoots,
    tpmAkTrustedRootSha256: tpmAkRoots,
  });

  const trustTag = determineTrustTag(trustInput);
  const requireHardware = options.requirement === "require_hardware";
  const isHardwareLevel =
    trustInput.attestation_level === "tpm" ||
    trustInput.attestation_level === "secure_enclave";

  if (requireHardware && (!isHardwareLevel || trustTag !== "hw_verified")) {
    return {
      allow: false,
      status: 403,
      error: "hardware_attestation_required",
      trustTag,
      attestationLevel: trustInput.attestation_level,
      attestationValid: trustInput.attestation_valid,
    };
  }

  const requireReport = options.requirement === "require_report";
  if (requireReport && trustInput.attestation_level === "none") {
    return {
      allow: false,
      status: 401,
      error: "attestation_report_required",
      trustTag,
      attestationLevel: trustInput.attestation_level,
      attestationValid: trustInput.attestation_valid,
    };
  }

  return {
    allow: true,
    status: 200,
    trustTag,
    attestationLevel: trustInput.attestation_level,
    attestationValid: trustInput.attestation_valid,
  };
}

export async function resolveUploadTrustDecision(options: {
  c: any;
  body: any;
  requirement?: "optional" | "require_report" | "require_hardware";
  datasetId?: string;
}): Promise<UploadTrustDecision> {
  return resolveUploadTrustTag({
    c: options.c,
    body: options.body,
    requirement: options.requirement ?? "optional",
    datasetId: options.datasetId,
  });
}

export async function enforceUploadExecutionSecurityGuards(options: {
  c: any;
  request: Request;
  tokenPayload: Record<string, any>;
  requireDatasetToken?: boolean;
}): Promise<{ ok: true } | { ok: false; status: UploadGuardStatus; error: string }> {
  if (!options.requireDatasetToken) {
    return { ok: true };
  }

  const {
    createEnvContext,
    getEnv,
    resolveDatasetToken,
    validateDatasetTokenWithConstraints,
  } = await import("../utils");
  const env = createEnvContext(options.c);
  const datasetToken = resolveDatasetToken(
    options.request.headers.get("X-Dataset-Token"),
    undefined,
  );

  const tokenValidation = await validateDatasetTokenWithConstraints({
    token: datasetToken,
    secret: getEnv(env, "DATASET_TOKEN_SECRET"),
  });
  if (!tokenValidation.ok) {
    return {
      ok: false,
      status: tokenValidation.status ?? 401,
      error: tokenValidation.error ?? "Invalid or expired dataset_token",
    };
  }

  const payloadDatasetId =
    typeof options.tokenPayload.dataset_id === "string"
      ? options.tokenPayload.dataset_id.trim()
      : "";
  const tokenDatasetId = tokenValidation.token?.dataset_id?.trim() ?? "";
  if (payloadDatasetId && tokenDatasetId !== payloadDatasetId) {
    return {
      ok: false,
      status: 403,
      error: "dataset_id does not match token",
    };
  }

  const uploadJti =
    typeof options.tokenPayload.upload_jti === "string"
      ? options.tokenPayload.upload_jti.trim()
      : "";
  if (!uploadJti) {
    return {
      ok: false,
      status: 400,
      error: "Invalid token payload (missing upload_jti)",
    };
  }

  const expSeconds =
    typeof options.tokenPayload.exp === "number" &&
    Number.isFinite(options.tokenPayload.exp)
      ? options.tokenPayload.exp
      : null;
  const ttlSeconds = expSeconds
    ? Math.max(1, Math.ceil(expSeconds - Date.now() / 1000))
    : 600;

  const jtiConsume = await consumeReplayGuard({
    c: options.c,
    key: `upload-jti:${uploadJti}`,
    ttlSeconds,
  });
  if (!jtiConsume.ok) {
    return {
      ok: false,
      status: jtiConsume.status,
      error: jtiConsume.error,
    };
  }

  return { ok: true };
}

export async function readUploadRequestBodyWithLimit(options: {
  request: Request;
  maxBodySize: number;
}): Promise<
  | { ok: true; data: Uint8Array }
  | { ok: false; status: 400 | 413; error: string; limit?: number; actual?: number }
> {
  if (!Number.isFinite(options.maxBodySize) || options.maxBodySize <= 0) {
    return { ok: false, status: 400, error: "Invalid maxBodySize" };
  }

  const bodyStream = options.request.body;
  if (!bodyStream) {
    return { ok: false, status: 400, error: "Upload payload is missing" };
  }

  const contentLength = parseRequestContentLength(
    options.request.headers.get("Content-Length"),
  );
  if (contentLength != null && contentLength > options.maxBodySize) {
    return {
      ok: false,
      status: 413,
      error: "Upload payload too large",
      limit: options.maxBodySize,
      actual: contentLength,
    };
  }

  try {
    const data = await readRequestBodyWithLimit(bodyStream, options.maxBodySize);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return {
        ok: false,
        status: 413,
        error: "Upload payload too large",
        limit: error.limit,
        actual: error.actual,
      };
    }
    throw error;
  }
}

export interface UploadConfig {
  bucket: R2BucketBinding;
  signingSecret: string;
  tokenTTL?: number;
  maxBodySize?: number;
  requireDatasetToken?: boolean;
  attestationRequirement?: UploadAttestationRequirement;
  preparationValidator: (
    body: any,
    user: { id: string; [key: string]: any },
    authContext: UploadAuthContext,
  ) => Promise<PrepareResult | Response>;
  executionProcessor: (
    tokenPayload: any,
    data: Uint8Array,
    user: { id: string; [key: string]: any },
  ) => Promise<ExecuteResult | Response>;
}

class BodyTooLargeError extends Error {
  constructor(
    public readonly limit: number,
    public readonly actual: number,
  ) {
    super("Upload payload exceeds configured maxBodySize");
    this.name = "BodyTooLargeError";
  }
}

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
}

function resolveMaxBodySize(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

function parseRequestContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

async function readRequestBodyWithLimit(
  bodyStream: ReadableStream<Uint8Array>,
  maxBodySize: number | null,
): Promise<Uint8Array> {
  if (maxBodySize == null) {
    const arrayBuf = await new Response(bodyStream).arrayBuffer();
    return new Uint8Array(arrayBuf);
  }

  const reader = bodyStream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value || value.byteLength === 0) {
      continue;
    }

    total += value.byteLength;
    if (total > maxBodySize) {
      try {
        await reader.cancel("max body size exceeded");
      } catch {
        // Ignore cancellation errors.
      }
      throw new BodyTooLargeError(maxBodySize, total);
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

/**
 * Generic two-stage upload handler
 *
 * Stage 1 (Preparation):
 *   - Validates JWT
 *   - Runs custom validation via preparationValidator
 *   - Generates signed token with user_id + custom payload
 *   - Returns upload URL with token
 *
 * Stage 2 (Execution):
 *   - Validates signed token
 *   - Validates JWT matches token's user_id
 *   - Verifies content hash (SHA-256)
 *   - Runs custom processing via executionProcessor
 *   - Uploads to R2 bucket
 */
export async function handleTwoStageUpload(
  c: any,
  config: UploadConfig,
): Promise<Response> {
  const { bucket, signingSecret } = config;

  if (!bucket || !signingSecret) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  const url = new URL(c.req.url);
  const request = c.req.raw;

  // Route to execution phase if X-Upload-Token header is present
  const hasTokenHeader = !!request.headers.get("X-Upload-Token");

  if (!hasTokenHeader) {
    return await handlePreparation(c, request, url, config);
  }

  return await handleExecution(c, request, url, config);
}

async function handlePreparation(
  c: any,
  request: Request,
  url: URL,
  config: UploadConfig,
): Promise<Response> {
  const { signingSecret, preparationValidator, tokenTTL, requireDatasetToken } =
    config;
  const authContext: UploadAuthContext = {};

  const { validateJWT } = await import("../utils");
  const bearerToken = extractBearerToken(request);
  if (!bearerToken) {
    return c.json(
      { error: "Missing Authorization bearer token", code: "AUTH_MISSING" },
      401,
    );
  }
  const supabaseUser = await validateJWT(bearerToken);
  if (!supabaseUser) {
    return c.json({ error: "Invalid or expired JWT token" }, 401);
  }

  // Parse body
  let body: any;
  try {
    body = await request.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (requireDatasetToken) {
    const {
      createEnvContext,
      getEnv,
      resolveDatasetToken,
      validateDatasetTokenWithConstraints,
    } = await import("../utils");
    const env = createEnvContext(c);
    const datasetToken = resolveDatasetToken(
      request.headers.get("X-Dataset-Token"),
      body?.dataset_token,
    );
    const tokenValidation = await validateDatasetTokenWithConstraints({
      token: datasetToken,
      secret: getEnv(env, "DATASET_TOKEN_SECRET"),
      // expectedUserId は検証しない: 複数端末では端末ごとの匿名 user_id が異なるため。
      // dataset_token.sub は最初にマッピングを作成した端末の user_id であり、
      // JWT user_id と一致することを要求するとマルチデバイスで 403 になる。
      // データ帰属はdataset_id (member_id_hash) の照合で担保する。
    });
    if (!tokenValidation.ok) {
      return c.json(
        { error: tokenValidation.error },
        tokenValidation.status ?? 401,
      );
    }
    authContext.datasetToken = tokenValidation.token;
  }

  // actingUserId: dataset_token が存在する場合はその sub を使用（全端末で一貫した帰属者）。
  // そうでない場合は JWT user_id を使用。
  const actingUserId = authContext.datasetToken?.user_id ?? supabaseUser.id;

  const actingUser = { id: actingUserId } as { id: string; [key: string]: any };

  // Run custom validation
  const validationResult = await preparationValidator(
    body,
    actingUser,
    authContext,
  );
  if (validationResult instanceof Response) {
    return validationResult; // Validation error
  }

  const { tokenPayload = {}, fields } = validationResult;
  const uploadTrust = await resolveUploadTrustTag({
    c,
    body,
    requirement: config.attestationRequirement ?? "optional",
    datasetId: authContext.datasetToken?.dataset_id,
  });
  if (!uploadTrust.allow) {
    return c.json(
      { error: uploadTrust.error ?? "attestation_policy_rejected" },
      uploadTrust.status,
    );
  }
  const effectiveTokenPayload: Record<string, any> = {
    ...tokenPayload,
    upload_jti: crypto.randomUUID(),
    trust_tag: uploadTrust.trustTag,
    attestation_level: uploadTrust.attestationLevel,
    attestation_valid: uploadTrust.attestationValid,
    // Dataset token trust is retained for audit only.
    token_trust_tag_audit: authContext.datasetToken?.trust_tag ?? null,
  };

  // [Issue #15] UPDATED: Dynamic TTL based on expected file size
  // Large files need more time to upload to R2 and process
  // Formula: estimated_time = (file_size_MB * 30s) + 300s, capped at 1 hour
  // Examples:
  //   - 1 MB file: 330s (5.5 min)
  //   - 10 MB file: 600s (10 min)
  //   - 100 MB file: 3600s (1 hour)
  let effectiveTTL = tokenTTL ?? SIGNED_URL_TTL_SECONDS;

  // If declared_size is provided in tokenPayload, calculate dynamic TTL
  if (
    effectiveTokenPayload.declared_size &&
    typeof effectiveTokenPayload.declared_size === "number"
  ) {
    const expectedSizeMB = effectiveTokenPayload.declared_size / (1024 * 1024);
    const estimatedSeconds = Math.ceil(expectedSizeMB * 30) + 300;
    effectiveTTL = Math.min(
      3600, // max 1 hour
      Math.max(
        60, // min 1 minute
        estimatedSeconds,
      ),
    );
  }

  // Generate signed token with user_id binding
  const { generateSignedToken } = await import("../utils");
  const signedToken = await generateSignedToken(
    { ...effectiveTokenPayload, user_id: actingUserId },
    signingSecret,
    effectiveTTL,
  );

  // Build upload URL for Stage 2.
  // stripApiPrefix() in [...route].ts always removes the /api/ segment before Hono sees
  // the request, so c.req.url never starts with /api/. Re-add it so Stage-2 clients
  // POST to the correct publicly-accessible path.
  const uploadUrl = new URL(url);
  if (!uploadUrl.pathname.startsWith("/api/")) {
    uploadUrl.pathname =
      "/api" +
      (uploadUrl.pathname.startsWith("/")
        ? uploadUrl.pathname
        : "/" + uploadUrl.pathname);
  }

  // Token is returned in response body only (not in URL)
  // Clients must send it via X-Upload-Token header in Stage 2
  return c.json({
    uploadUrl: uploadUrl.toString(),
    token: signedToken,
    expiresAt: new Date(Date.now() + effectiveTTL * 1000).toISOString(),
    ...(fields && { fields }),
  });
}

async function handleExecution(
  c: any,
  request: Request,
  _url: URL,
  config: UploadConfig,
): Promise<Response> {
  const { signingSecret, executionProcessor } = config;
  const maxBodySize = resolveMaxBodySize(config.maxBodySize);

  const { verifySignedToken, validateJWT } = await import("../utils");
  const jwtToken = extractBearerToken(request);

  if (!jwtToken) {
    return c.json(
      {
        error: "Missing Authorization bearer token",
        code: "AUTH_MISSING",
      },
      401,
    );
  }

  // Extract upload token from X-Upload-Token header
  const uploadToken = request.headers.get("X-Upload-Token");

  if (!uploadToken) {
    return c.json(
      {
        error: "Missing upload token in X-Upload-Token header",
        code: "UPLOAD_TOKEN_MISSING",
      },
      400,
    );
  }

  // Verify signed upload token
  const tokenPayload = await verifySignedToken(uploadToken, signingSecret);
  if (!tokenPayload) {
    return c.json({ error: "Invalid or expired upload token" }, 401);
  }

  // Validate JWT before consuming replay guards to avoid unauthenticated
  // requests burning a one-time upload_jti.
  const jwtValid = await validateJWT(jwtToken);
  if (!jwtValid) {
    console.warn(
      `[Upload] JWT validation failed: token=${jwtToken.substring(0, 20)}...`,
    );
    return c.json(
      {
        error: "Invalid or expired JWT token. Please refresh your session.",
        code: "AUTH_EXPIRED",
      },
      401,
    );
  }

  const securityGuards = await enforceUploadExecutionSecurityGuards({
    c,
    request,
    tokenPayload,
    requireDatasetToken: config.requireDatasetToken,
  });
  if (!securityGuards.ok) {
    return c.json({ error: securityGuards.error }, securityGuards.status);
  }

  const expectedHash = tokenPayload.content_hash;
  const tokenUserId = tokenPayload.user_id;

  if (!expectedHash) {
    return c.json({ error: "Invalid token payload" }, 400);
  }

  // upload token の user_id は dataset_token.sub（全端末共通の帰属者）であり、
  // JWT user_id（端末固有）と一致しないことがあるため user_id 照合は行わない。
  // actingUser は upload token 内の user_id（dataset_token.sub）を使用する。
  const actingUser = { id: tokenUserId } as { id: string; [key: string]: any };

  // Read body
  const bodyStream = request.body;
  if (!bodyStream) {
    return c.json({ error: "Upload payload is missing" }, 400);
  }

  const contentLength = parseRequestContentLength(
    request.headers.get("Content-Length"),
  );
  if (maxBodySize != null && contentLength != null && contentLength > maxBodySize) {
    return c.json(
      {
        error: "Upload payload too large",
        code: "UPLOAD_TOO_LARGE",
        limit: maxBodySize,
        actual: contentLength,
      },
      413,
    );
  }

  try {
    // Read body into memory for processing with optional max size enforcement.
    const data = await readRequestBodyWithLimit(bodyStream, maxBodySize);

    // Hash verification is performed inside executionProcessor (e.g. master_data.ts)
    // where actual vs. token-embedded expected hash is compared.

    // Run custom processing
    const processingResult = await executionProcessor(
      tokenPayload,
      data,
      actingUser,
    );
    if (processingResult instanceof Response) {
      return processingResult; // Processing error
    }

    const { response } = processingResult;

    return c.json(response);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return c.json(
        {
          error: "Upload payload too large",
          code: "UPLOAD_TOO_LARGE",
          limit: error.limit,
          actual: error.actual,
        },
        413,
      );
    }

    console.error("[Upload] Upload error:", error);
    return c.json({ error: "Upload failed" }, 500);
  }
}
