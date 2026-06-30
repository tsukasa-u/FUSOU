/**
 * Anonymous sync v2 — pepper ベースの匿名同期エンドポイント群。
 *
 * 設計概要:
 *   1. クライアントは `api_member_id` を直接 (TLS で) サーバーに送る
 *   2. サーバーが `pid = HMAC-SHA256(pepper_current, api_member_id)` を計算する
 *      (pepper は Wrangler secret。クライアントには絶対に渡さない)
 *   3. 端末は Ed25519 keypair をローカル生成・保管し、`/v2/register` で公開鍵を登録する
 *   4. 以降の `/v2/refresh` は stateless challenge nonce に対する署名で本人性を担保
 *   5. `/v2/revoke` は別の自端末から既存端末を失効させる経路 (端末紛失時の自己復旧用)
 *
 * 旧 `/anonymous-sync` (v1) は salt をクライアントが持って `member_id_hash` を計算する
 * 設計だったが、salt 漏洩で任意アカウントの dataset_token を取得できる弱点があった。
 * v2 は pepper をサーバー側 secret に閉じ込めることでこのリスクを解消する。
 * v1 はクライアント移行猶予期間中の互換維持として無変更で並走させる。
 *
 * セキュリティ前提:
 *   - first-write-wins は意図的に残存。`/v2/register` で同一 pid が 2 端末から到達した
 *     場合、両方とも user_devices に追加され同じ canonical_user_id を共有する。
 *     api_member_id は KC のランキング等で半公開情報のため「ユーザー操作ゼロ」制約下では
 *     初回登録ゲートに本人証明を要求できず、現行と同等のリスクを許容する。
 *   - `/v2/refresh` 以降は Ed25519 デバイス鍵を持たない攻撃者は通過できない。
 *   - challenge nonce は KV を使わず HMAC で stateless 発行する。
 *   - ワンタイム消費は DB テーブル `anon_sync_nonce_consumptions` の一意制約で担保する。
 *   - 同一 nonce での重複 refresh は `refresh-result:{device_id}:{nonce}` の結果再生で
 *     冪等にする (ネットワーク再送に強い)。
 *   - user_devices.canonical_user_id は Supabase の匿名ユーザー削除 (30 日非活動) に
 *     ON DELETE CASCADE で追従。新規 register で透過的に復旧する。
 */

import { Hono } from "hono";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import {
  createEnvContext,
  getEnv,
  resolveSupabaseConfig,
  safeWaitUntil,
} from "../utils";
import type { TrustTag } from "../types";
import {
  determineTrustTag,
  normalizeTrustTag,
  type TrustInput,
} from "../utils/trust-tag";
import {
  verifyAttestation,
  type AttestationReport,
} from "../utils/attestation-verifier";
import { logToAdminSpreadsheet } from "../utils/admin-logger";
import {
  CHALLENGE_BUCKET_SECONDS,
  computePid,
  computeRecoveryId,
  detectPepperVersionFor,
  detectRecoveryVersionFor,
  encodeBytesToBase64,
  decodeBase64ToBytes,
  issueChallengeNonce,
  resolvePepperConfigFromVault,
  resolveRecoveryConfigFromVault,
  verifyChallengeNonce,
  verifyDeviceSig,
} from "../utils/pepper";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// ========================
// 共通定数 / 補助
// ========================

const DATASET_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_RESULT_TTL_SECONDS = 300;
const RATE_LIMIT_PER_HOUR = 20;
const NONCE_CLEANUP_RETENTION_MS = 30 * 60 * 1000;
const NONCE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let lastNonceCleanupAt = 0;

const API_MEMBER_ID_PATTERN = /^[0-9]{1,16}$/;
const DEVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ATTESTATION_FIELD_LENGTH = 16 * 1024;
const MAX_ATTESTATION_FORMAT_LENGTH = 128;
const MAX_ATTESTATION_CERT_CHAIN_LENGTH = 6;
const MAX_ATTESTATION_CERT_B64_LENGTH = 12 * 1024;
export const DEFAULT_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256 = [
  "c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050",
  "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179",
];
export const DEFAULT_TPM_AK_TRUSTED_ROOT_SHA256 = [
  "ceee658bdd5591cb707444f6c50a810c3ecf85c40d591f015e5e2f0e4b1f13d3",
];

type RateLimitContext = {
  kv?: KVNamespace;
  pid: string;
};

async function consumeRateLimit(ctx: RateLimitContext): Promise<boolean> {
  if (!ctx.kv) return true;
  const rateKey = `anon-sync-v2-rate:${ctx.pid}`;
  const raw = await ctx.kv.get(rateKey);
  const parsed = raw ? parseInt(raw, 10) : 0;
  const current = isNaN(parsed) ? 0 : parsed;
  if (current >= RATE_LIMIT_PER_HOUR) {
    return false;
  }
  await ctx.kv.put(rateKey, String(current + 1), { expirationTtl: 3600 });
  return true;
}

function maskPid(pid: string): string {
  return `${pid.substring(0, 8)}...`;
}

function normalizeApiMemberId(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    const text = String(value);
    return API_MEMBER_ID_PATTERN.test(text) ? text : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return API_MEMBER_ID_PATTERN.test(trimmed) ? trimmed : null;
  }
  return null;
}

function normalizeDeviceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return DEVICE_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function normalizePubkey(value: unknown): {
  raw: Uint8Array;
  base64: string;
} | null {
  if (typeof value !== "string") return null;
  const bytes = decodeBase64ToBytes(value);
  if (!bytes || bytes.length !== 32) return null;
  return { raw: bytes, base64: encodeBytesToBase64(bytes) };
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

function parseAttestationReport(
  value: unknown,
): { report: AttestationReport | null; malformed: boolean } {
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
      : normalizeBoundedString(
          raw.attestation_data,
          MAX_ATTESTATION_FIELD_LENGTH,
        );
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

  const report: AttestationReport = {
    attestation_level: level,
    ...(attestationData ? { attestation_data: attestationData } : {}),
    ...(attestationSignature
      ? { attestation_signature: attestationSignature }
      : {}),
    ...(publicKey ? { public_key: publicKey } : {}),
    ...(attestationFormat ? { attestation_format: attestationFormat } : {}),
    ...(certificateChain ? { certificate_chain: certificateChain } : {}),
  };

  if (raw.fingerprint && typeof raw.fingerprint === "object") {
    const fp = raw.fingerprint as Record<string, unknown>;
    report.fingerprint = {
      cpu_brand: String(fp.cpu_brand ?? ""),
      cpu_cores: Number(fp.cpu_cores ?? 0),
      total_memory_mb: Number(fp.total_memory_mb ?? 0),
      os_name: String(fp.os_name ?? ""),
      os_version: String(fp.os_version ?? ""),
      hostname_hash: String(fp.hostname_hash ?? ""),
      machine_id_hash: String(fp.machine_id_hash ?? ""),
    };
  }

  if (raw.environment && typeof raw.environment === "object") {
    const env = raw.environment as Record<string, unknown>;
    report.environment = {
      environment_type:
        typeof env.environment_type === "string"
          ? env.environment_type
          : undefined,
      debugger_attached:
        typeof env.debugger_attached === "boolean"
          ? env.debugger_attached
          : undefined,
      hooks_detected: Array.isArray(env.hooks_detected)
        ? env.hooks_detected.filter((item): item is string => typeof item === "string")
        : undefined,
    };
  }

  return { report, malformed: false };
}

export function parseTrustedRootList(raw: string | undefined): string[] {
  if (!raw) return [];

  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        );
      }
    } catch {
      // Fallback to delimiter-based parsing.
    }
  }

  return trimmed
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isHardwareAttestationLevel(level: string): boolean {
  return level === "tpm" || level === "secure_enclave";
}

export type RefreshAttestationPolicyDecision =
  | {
      allow: true;
      trustTag: TrustTag;
      attestationLevelForLog: string;
      attestationValidForLog: boolean;
    }
  | {
      allow: false;
      status: 400 | 401;
      error: string;
      attestationLevelForLog: string;
      attestationValidForLog: boolean;
    };

export function decideRefreshAttestationPolicy(options: {
  parsedAttestationMalformed: boolean;
  hasAttestationReport: boolean;
  trustInput: TrustInput | null;
}): RefreshAttestationPolicyDecision {
  if (options.parsedAttestationMalformed) {
    return {
      allow: false,
      status: 400,
      error: "attestation_report_malformed",
      attestationLevelForLog: "malformed",
      attestationValidForLog: false,
    };
  }

  if (!options.hasAttestationReport || !options.trustInput) {
    return {
      allow: true,
      trustTag: "unverified",
      attestationLevelForLog: "none",
      attestationValidForLog: false,
    };
  }

  const { trustInput } = options;
  const hardwareLevel = isHardwareAttestationLevel(trustInput.attestation_level);

  if (!trustInput.schema_fingerprint_valid) {
    return {
      allow: false,
      status: 400,
      error: "attestation_report_invalid",
      attestationLevelForLog: trustInput.attestation_level,
      attestationValidForLog: trustInput.attestation_valid,
    };
  }

  if (hardwareLevel && !trustInput.attestation_valid) {
    return {
      allow: false,
      status: 401,
      error: "attestation_verification_failed",
      attestationLevelForLog: trustInput.attestation_level,
      attestationValidForLog: false,
    };
  }

  return {
    allow: true,
    trustTag: determineTrustTag(trustInput),
    attestationLevelForLog: trustInput.attestation_level,
    attestationValidForLog: trustInput.attestation_valid,
  };
}

function resolveSecureEnclaveTrustedRoots(c: { env: Bindings }): string[] {
  const envCtx = createEnvContext({ env: c.env });
  const raw = getEnv(envCtx, "INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256");
  const parsed = parseTrustedRootList(raw);
  return parsed.length > 0 ? parsed : DEFAULT_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256;
}

function resolveTpmAkTrustedRoots(c: { env: Bindings }): string[] {
  const envCtx = createEnvContext({ env: c.env });
  const raw = getEnv(envCtx, "INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256");
  const parsed = parseTrustedRootList(raw);
  return parsed.length > 0 ? parsed : DEFAULT_TPM_AK_TRUSTED_ROOT_SHA256;
}

function scheduleSuspiciousAdminLog(
  c: any,
  options: {
    envCtx: ReturnType<typeof createEnvContext>;
    datasetId: string;
    trustTag: TrustTag;
    attestationLevel: string;
    details: Record<string, unknown>;
  },
): void {
  if (options.trustTag !== "suspicious") {
    return;
  }

  const spreadsheetId = getEnv(options.envCtx, "GOOGLE_SHEETS_ADMIN_LOG_ID");
  const serviceAccountKey = getEnv(options.envCtx, "GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!spreadsheetId || !serviceAccountKey) {
    return;
  }

  safeWaitUntil(
    c,
    logToAdminSpreadsheet({
      spreadsheetId,
      sheetName: "security_log",
      googleServiceAccountKey: serviceAccountKey,
      row: {
        timestamp: new Date().toISOString(),
        event_type: "suspicious_upload",
        dataset_id: options.datasetId,
        trust_tag: options.trustTag,
        attestation_level: options.attestationLevel,
        details: JSON.stringify(options.details),
      },
    }).catch((err) => {
      console.warn("[anonymous-sync-v2] failed to write admin spreadsheet log", err);
    }),
  );
}

function extractAccessToken(c: {
  req: { header: (name: string) => string | undefined };
}): string | null {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = c.req.header("Cookie");
  if (!cookieHeader) return null;

  const match = cookieHeader.match(
    /(?:^|;\s*)(?:sb-access-token|__Secure-sb-access-token)=([^;]+)/,
  );
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function assertCsrfSafe(
  c: {
    req: { header: (name: string) => string | undefined };
    env: { PUBLIC_SITE_URL?: string };
  },
  hasCookieAuth: boolean,
): boolean {
  if (!hasCookieAuth) return true;

  const envCtx = createEnvContext({ env: c.env });
  const siteUrl = getEnv(envCtx, "PUBLIC_SITE_URL")?.trim();
  if (!siteUrl) return false;

  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(siteUrl).origin;
  } catch {
    return false;
  }

  const requestOrigin = c.req.header("Origin");
  if (!requestOrigin) return false;

  try {
    return new URL(requestOrigin).origin === allowedOrigin;
  } catch {
    return false;
  }
}

async function verifySupabaseAccessToken(options: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
}): Promise<{ id: string; email?: string } | null> {
  try {
    const response = await fetch(`${options.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: options.anonKey,
        Authorization: `Bearer ${options.accessToken}`,
      },
    });

    if (!response.ok) return null;
    const user = (await response.json()) as { id?: string; email?: string };
    if (!user?.id || typeof user.id !== "string") return null;
    return { id: user.id, email: user.email };
  } catch (err) {
    console.warn("[anonymous-sync-v2] verifySupabaseAccessToken failed:", err);
    return null;
  }
}

async function issueDatasetToken(options: {
  secret: string;
  canonicalUserId: string;
  pid: string;
  now: number;
  trustTag?: TrustTag;
}): Promise<{ token: string; expiresAt: number }> {
  const secretKey = new TextEncoder().encode(options.secret);
  const expiresAt = options.now + DATASET_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({
    sub: options.canonicalUserId,
    dataset_id: options.pid,
    typ: "dataset",
    aud: "fusou-upload",
    trust_tag: options.trustTag ?? "unverified",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(options.now)
    .setExpirationTime(expiresAt)
    .sign(secretKey);
  return { token, expiresAt };
}

type BaseConfig = {
  envCtx: ReturnType<typeof createEnvContext>;
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
};

type BaseConfigResult =
  | { ok: true; config: BaseConfig }
  | { ok: false; reason: string };

type SecretResult =
  | { ok: true; secret: string }
  | { ok: false; reason: string };

/**
 * Supabase 接続情報だけを解決する。pepper bundle や HMAC secret は
 * それぞれ必要な経路で別途解決する。
 */
function resolveBaseConfig(c: { env: Bindings }): BaseConfigResult {
  const envCtx = createEnvContext({ env: c.env });
  const supabaseConfig = resolveSupabaseConfig(envCtx);

  if (!supabaseConfig.url || !supabaseConfig.serviceRoleKey) {
    return { ok: false, reason: "supabase_config_missing" };
  }
  if (!supabaseConfig.publishableKey) {
    return { ok: false, reason: "supabase_publishable_key_missing" };
  }

  return {
    ok: true,
    config: {
      envCtx,
      supabaseUrl: supabaseConfig.url,
      serviceRoleKey: supabaseConfig.serviceRoleKey,
      anonKey: supabaseConfig.publishableKey,
    },
  };
}

function resolveDatasetTokenSecret(c: { env: Bindings }): SecretResult {
  const envCtx = createEnvContext({ env: c.env });
  const datasetTokenSecret = getEnv(envCtx, "DATASET_TOKEN_SECRET");
  if (!datasetTokenSecret || datasetTokenSecret.length < 32) {
    return { ok: false, reason: "dataset_token_secret_invalid" };
  }
  return { ok: true, secret: datasetTokenSecret };
}

function resolveChallengeSecret(c: { env: Bindings }): SecretResult {
  const envCtx = createEnvContext({ env: c.env });
  const challengeSecret = getEnv(envCtx, "CHALLENGE_HMAC_SECRET");
  if (!challengeSecret || challengeSecret.length < 32) {
    return { ok: false, reason: "challenge_hmac_secret_invalid" };
  }
  return { ok: true, secret: challengeSecret };
}

/**
 * Supabase RPC `get_anon_sync_pepper_bundle` を呼んで Vault からの
 * pepper bundle を解決する。失敗時は null を返し、呼び出し側は
 * 500 ("pepper_bundle_unavailable") を返却する。
 *
 * service-role クライアントは呼び出し側 (register/refresh) で必要に応じて
 * 再利用できるよう、戻り値に同梱して返す。
 */
async function resolvePepperBundle(options: {
  base: BaseConfig;
  supabaseAdmin?: any;
}) {
  const supabaseAdmin =
    options.supabaseAdmin ??
    createClient(options.base.supabaseUrl, options.base.serviceRoleKey);
  const bundle = await resolvePepperConfigFromVault(
    () => supabaseAdmin.rpc("get_anon_sync_pepper_bundle"),
    {
      supabaseUrl: options.base.supabaseUrl,
      serviceRoleKey: options.base.serviceRoleKey,
    },
  );
  if (!bundle) {
    return { ok: false as const, reason: "pepper_bundle_unavailable" };
  }
  return {
    ok: true as const,
    pepperConfig: bundle.config,
    supabaseAdmin,
  };
}

async function resolveRecoveryBundle(options: {
  base: BaseConfig;
  supabaseAdmin?: any;
}) {
  const supabaseAdmin =
    options.supabaseAdmin ??
    createClient(options.base.supabaseUrl, options.base.serviceRoleKey);
  const bundle = await resolveRecoveryConfigFromVault(
    () => supabaseAdmin.rpc("get_anon_sync_recovery_bundle"),
    {
      supabaseUrl: options.base.supabaseUrl,
      serviceRoleKey: options.base.serviceRoleKey,
    },
  );
  if (!bundle) {
    return { ok: false as const, reason: "recovery_bundle_unavailable" };
  }
  return {
    ok: true as const,
    recoveryConfig: bundle.config,
    supabaseAdmin,
  };
}

function isSchemaObjectMissingError(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown } | null;
  const code = typeof err?.code === "string" ? err.code : null;
  if (code === "42P01" || code === "42703") {
    return true;
  }
  const message = typeof err?.message === "string" ? err.message : "";
  return /does not exist/i.test(message);
}

export function isSupabaseUserNotFoundError(error: unknown): boolean {
  const err = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  } | null;

  if (typeof err?.status === "number" && err.status === 404) {
    return true;
  }

  const code = typeof err?.code === "string" ? err.code.toLowerCase() : "";
  if (code === "user_not_found" || code === "not_found") {
    return true;
  }

  const message =
    typeof err?.message === "string" ? err.message.toLowerCase() : "";
  return message.includes("user") && message.includes("not found");
}

async function consumeDeviceNonce(options: {
  supabaseAdmin: any;
  deviceId: string;
  nonce: string;
  context: "refresh" | "revoke";
}): Promise<{ ok: true } | { ok: false; status: 401 | 500; error: string }> {
  const nowMs = Date.now();
  const nonceInsert = await options.supabaseAdmin
    .from("anon_sync_nonce_consumptions")
    .insert({
      device_id: options.deviceId,
      nonce: options.nonce,
    });

  if (!nonceInsert.error) {
    // テーブル肥大を抑えるため、インスタンスごとに一定間隔で古い nonce を掃除する。
    if (nowMs - lastNonceCleanupAt >= NONCE_CLEANUP_INTERVAL_MS) {
      lastNonceCleanupAt = nowMs;
      const cutoffIso = new Date(
        nowMs - NONCE_CLEANUP_RETENTION_MS,
      ).toISOString();
      const { error: cleanupError } = await options.supabaseAdmin
        .from("anon_sync_nonce_consumptions")
        .delete()
        .lt("consumed_at", cutoffIso);
      if (cleanupError && !isSchemaObjectMissingError(cleanupError)) {
        console.warn(
          `[anonymous-sync-v2/${options.context}] nonce cleanup failed:`,
          cleanupError,
        );
      }
    }
    return { ok: true };
  }

  const errCode = (nonceInsert.error as { code?: unknown })?.code;
  if (errCode === "23505") {
    return { ok: false, status: 401, error: "nonce_already_used" };
  }

  if (!isSchemaObjectMissingError(nonceInsert.error)) {
    console.error(
      `[anonymous-sync-v2/${options.context}] nonce consumption insert failed:`,
      nonceInsert.error,
    );
    return { ok: false, status: 500, error: "Database error" };
  }

  console.error(
    `[anonymous-sync-v2/${options.context}] nonce consumption table is unavailable; refusing request to avoid replay risk`,
  );
  return { ok: false, status: 500, error: "Server configuration error" };
}

async function insertRecoveryRelinkAudit(options: {
  supabaseAdmin: any;
  canonicalUserId: string;
  deviceId: string;
  outcome: string;
  reason: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await options.supabaseAdmin
    .from("recovery_relink_audit")
    .insert({
      canonical_user_id: options.canonicalUserId,
      device_id: options.deviceId,
      outcome: options.outcome,
      reason: options.reason,
      details: options.details ?? null,
    });

  if (!error) {
    return;
  }

  if (isSchemaObjectMissingError(error)) {
    console.warn(
      "[anonymous-sync-v2] recovery_relink_audit unavailable; skipping audit insert",
    );
    return;
  }

  console.warn("[anonymous-sync-v2] recovery relink audit insert failed:", {
    message: (error as { message?: unknown })?.message,
    code: (error as { code?: unknown })?.code,
  });
}

async function insertSuspiciousTrustAudit(options: {
  supabaseAdmin: any;
  canonicalUserId: string;
  deviceId: string;
  datasetId: string;
  trustTag: TrustTag;
  attestationLevel: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  if (options.trustTag !== "suspicious") {
    return;
  }

  const { error } = await options.supabaseAdmin
    .from("suspicious_trust_audit")
    .insert({
      canonical_user_id: options.canonicalUserId,
      device_id: options.deviceId,
      dataset_id: options.datasetId,
      trust_tag: options.trustTag,
      attestation_level: options.attestationLevel,
      details: options.details ?? null,
    });

  if (!error) {
    return;
  }

  if (isSchemaObjectMissingError(error)) {
    console.warn(
      "[anonymous-sync-v2] suspicious_trust_audit unavailable; skipping durable audit insert",
    );
    return;
  }

  console.warn("[anonymous-sync-v2] suspicious trust audit insert failed:", {
    message: (error as { message?: unknown })?.message,
    code: (error as { code?: unknown })?.code,
  });
}

// ========================
// POST /anonymous-sync/v2/register
// ========================

app.post("/anonymous-sync/v2/register", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_json" }, 400);
    }

    const apiMemberId = normalizeApiMemberId((body as any).api_member_id);
    if (!apiMemberId) {
      return c.json(
        {
          error: "api_member_id must be a positive integer (string or number)",
        },
        400,
      );
    }

    const pubkey = normalizePubkey((body as any).device_pub);
    if (!pubkey) {
      return c.json(
        { error: "device_pub must be base64-encoded Ed25519 raw 32 bytes" },
        400,
      );
    }

    const attestation = (body as any).attestation;
    if (typeof attestation !== "string" || attestation.length === 0) {
      return c.json({ error: "attestation is required" }, 400);
    }

    const base = resolveBaseConfig(c);
    if (!base.ok) {
      console.error(
        "[anonymous-sync-v2/register] config invalid:",
        base.reason,
      );
      return c.json({ error: "Server configuration error" }, 500);
    }

    const datasetSecretResolved = resolveDatasetTokenSecret(c);
    if (!datasetSecretResolved.ok) {
      console.error(
        "[anonymous-sync-v2/register] dataset token secret invalid:",
        datasetSecretResolved.reason,
      );
      return c.json({ error: "Server configuration error" }, 500);
    }

    // attestation の検証 (端末が秘密鍵を保持していることの証明)
    const attestationMessage = `register|${apiMemberId}`;
    const attestationValid = await verifyDeviceSig({
      publicKeyB64: pubkey.base64,
      message: attestationMessage,
      signatureB64: attestation,
    });
    if (!attestationValid) {
      return c.json({ error: "attestation_invalid" }, 401);
    }

    const pepperResolved = await resolvePepperBundle({ base: base.config });
    if (!pepperResolved.ok) {
      console.error(
        "[anonymous-sync-v2/register] pepper resolution failed:",
        pepperResolved.reason,
      );
      return c.json({ error: "Server configuration error" }, 500);
    }
    const config = {
      ...base.config,
      pepperConfig: pepperResolved.pepperConfig,
    };
    const supabaseAdmin = pepperResolved.supabaseAdmin;

    const recoveryResolved = await resolveRecoveryBundle({
      base: base.config,
      supabaseAdmin,
    });
    const recoveryConfig = recoveryResolved.ok
      ? recoveryResolved.recoveryConfig
      : null;
    if (!recoveryResolved.ok) {
      console.warn(
        "[anonymous-sync-v2/register] recovery bundle unavailable; register will proceed without recovery continuity",
      );
    }

    const pidByVersion = new Map<string, string>();
    for (const entry of config.pepperConfig.accept) {
      const candidatePid = await computePid(entry.secret, apiMemberId);
      pidByVersion.set(entry.version, candidatePid);
    }

    const pidCurrent = pidByVersion.get(config.pepperConfig.current.version);
    if (!pidCurrent) {
      console.error(
        "[anonymous-sync-v2/register] current version pid resolution failed",
      );
      return c.json({ error: "Server configuration error" }, 500);
    }

    const ridByVersion = new Map<string, string>();
    if (recoveryConfig) {
      for (const entry of recoveryConfig.accept) {
        const candidateRid = await computeRecoveryId(entry.secret, apiMemberId);
        ridByVersion.set(entry.version, candidateRid);
      }
    }
    const ridCurrent = recoveryConfig
      ? (ridByVersion.get(recoveryConfig.current.version) ?? null)
      : null;
    if (recoveryConfig && !ridCurrent) {
      console.error(
        "[anonymous-sync-v2/register] current version rid resolution failed",
      );
      return c.json({ error: "Server configuration error" }, 500);
    }

    const acceptedPids = Array.from(new Set(pidByVersion.values()));
    const acceptedRids = recoveryConfig
      ? Array.from(new Set(ridByVersion.values()))
      : [];

    // Rate limit (pid 単位)。ローテーション中も current pid で一貫して制御する。
    const rateOk = await consumeRateLimit({
      kv: c.env.DATA_LOADER_CACHE_KV,
      pid: pidCurrent,
    });
    if (!rateOk) {
      console.warn(
        `[anonymous-sync-v2/register] rate limit exceeded: ${maskPid(pidCurrent)}`,
      );
      return c.json({ error: "Too many requests" }, 429);
    }

    // pepper 解決時に作った admin クライアントを再利用する (TLS 接続再確立を避ける)
    const anonClient = createClient(config.supabaseUrl, config.anonKey);

    // user_member_map を accept_versions 全候補 pid で LOOKUP。
    // ローテーション途中 (旧世代 pid 残存) でも canonical owner を継承する。
    type MappingRow = {
      user_id: string;
      member_id_hash: string;
      salt_version: string | null;
      recovery_id_hash: string | null;
      recovery_version: string | null;
    };

    const mappingWithRecovery = await supabaseAdmin
      .from("user_member_map")
      .select(
        "user_id, member_id_hash, salt_version, recovery_id_hash, recovery_version",
      )
      .in("member_id_hash", acceptedPids);

    let mappingRows: MappingRow[] = [];
    let mappingError: unknown = mappingWithRecovery.error;
    if (isSchemaObjectMissingError(mappingWithRecovery.error)) {
      const fallbackLookup = await supabaseAdmin
        .from("user_member_map")
        .select("user_id, member_id_hash, salt_version")
        .in("member_id_hash", acceptedPids);

      mappingError = fallbackLookup.error;
      if (Array.isArray(fallbackLookup.data)) {
        mappingRows = fallbackLookup.data.map(
          (row: {
            user_id: string;
            member_id_hash: string;
            salt_version: string | null;
          }) => ({
            user_id: row.user_id,
            member_id_hash: row.member_id_hash,
            salt_version: row.salt_version,
            recovery_id_hash: null,
            recovery_version: null,
          }),
        );
      }
    } else if (Array.isArray(mappingWithRecovery.data)) {
      mappingRows = mappingWithRecovery.data as MappingRow[];
    }

    if (mappingError) {
      console.error(
        "[anonymous-sync-v2/register] user_member_map lookup failed:",
        mappingError,
      );
      return c.json({ error: "Database error" }, 500);
    }

    const mappings = mappingRows;
    let mapping: MappingRow | null = null;
    if (mappings.length > 0) {
      mapping =
        mappings.find((row) => row.member_id_hash === pidCurrent) ??
        mappings[0] ??
        null;

      if (mappings.length > 1) {
        console.warn(
          "[anonymous-sync-v2/register] multiple mappings resolved for accepted pids; preferring current or first",
          {
            current_pid: maskPid(pidCurrent),
            count: mappings.length,
          },
        );
      }
    }

    type AnchorRow = {
      canonical_user_id: string;
      recovery_id_hash: string;
      recovery_version: string | null;
    };

    let anchor: AnchorRow | null = null;
    let resolvedRecoveryVersion: string | null =
      recoveryConfig?.current.version ?? null;
    if (recoveryConfig && acceptedRids.length > 0) {
      const { data: anchorRows, error: anchorError } = await supabaseAdmin
        .from("user_identity_anchor")
        .select("canonical_user_id, recovery_id_hash, recovery_version")
        .in("recovery_id_hash", acceptedRids);

      if (anchorError) {
        if (isSchemaObjectMissingError(anchorError)) {
          console.warn(
            "[anonymous-sync-v2/register] user_identity_anchor unavailable; skipping continuity anchor lookup",
          );
        } else {
          console.error(
            "[anonymous-sync-v2/register] user_identity_anchor lookup failed:",
            anchorError,
          );
          return c.json({ error: "Database error" }, 500);
        }
      } else {
        const anchors = Array.isArray(anchorRows)
          ? (anchorRows as AnchorRow[])
          : [];
        anchor =
          anchors.find((row) => row.recovery_id_hash === ridCurrent) ??
          anchors[0] ??
          null;

        if (anchor) {
          const matchedRecoveryVersion = recoveryConfig.accept.find(
            (entry) =>
              ridByVersion.get(entry.version) === anchor!.recovery_id_hash,
          )?.version;
          resolvedRecoveryVersion =
            matchedRecoveryVersion ??
            anchor.recovery_version ??
            resolvedRecoveryVersion;
        }
      }
    }

    let pid = mapping?.member_id_hash ?? pidCurrent;
    const matchedVersion = mapping
      ? config.pepperConfig.accept.find(
          (entry) =>
            pidByVersion.get(entry.version) === mapping!.member_id_hash,
        )?.version
      : null;
    const resolvedSaltVersion =
      matchedVersion ??
      mapping?.salt_version ??
      config.pepperConfig.current.version;

    let canonicalUserId: string | null =
      mapping?.user_id ?? anchor?.canonical_user_id ?? null;
    let missingCanonicalUserIdForRelink: string | null = null;

    if (mapping && anchor && mapping.user_id !== anchor.canonical_user_id) {
      console.warn(
        "[anonymous-sync-v2/register] mapping and anchor resolved different users; preferring mapping",
        {
          mapped_user_id: mapping.user_id,
          anchor_user_id: anchor.canonical_user_id,
          pid: maskPid(pid),
        },
      );
    }

    // canonical user が削除されていれば新規化する (recreated 相当)。
    // getUserById の一時障害ではデータ破壊を避けるため再生成せず、そのまま継続する。
    if (canonicalUserId) {
      try {
        const { data: existingUser, error: existingUserError } =
          await supabaseAdmin.auth.admin.getUserById(canonicalUserId);
        if (existingUserError) {
          if (!isSupabaseUserNotFoundError(existingUserError)) {
            console.warn(
              "[anonymous-sync-v2/register] getUserById failed with transient error; keeping canonical mapping",
              {
                pid: maskPid(pid),
                canonical_user_id: canonicalUserId,
                error: existingUserError,
              },
            );
          } else {
            missingCanonicalUserIdForRelink = canonicalUserId;
            console.warn(
              "[anonymous-sync-v2/register] mapped user missing, will recreate",
              {
                pid: maskPid(pid),
                missing_user_id: canonicalUserId,
                error: existingUserError?.message,
              },
            );
            canonicalUserId = null;
          }
        } else if (!existingUser?.user) {
          missingCanonicalUserIdForRelink = canonicalUserId;
          console.warn(
            "[anonymous-sync-v2/register] mapped user missing, will recreate",
            {
              pid: maskPid(pid),
              missing_user_id: canonicalUserId,
              error: "user_not_found",
            },
          );
          canonicalUserId = null;
        }
      } catch (err) {
        console.warn(
          "[anonymous-sync-v2/register] getUserById threw; keeping canonical mapping",
          {
            pid: maskPid(pid),
            canonical_user_id: canonicalUserId,
            error: err,
          },
        );
      }
    }

    if (!canonicalUserId) {
      // 新規 user を作成
      const { data: sessionData, error: sessionError } =
        await anonClient.auth.signInAnonymously();
      if (sessionError || !sessionData.session || !sessionData.user) {
        console.error(
          "[anonymous-sync-v2/register] signInAnonymously failed:",
          {
            message: (sessionError as any)?.message,
            status: (sessionError as any)?.status,
          },
        );
        return c.json({ error: "Failed to create session" }, 500);
      }
      const newUserId = sessionData.user.id;

      if (mapping) {
        const mappingUpdatePayload: Record<string, unknown> = {
          user_id: newUserId,
          salt_version: resolvedSaltVersion,
          hash_algorithm: "hmac-sha256",
        };
        if (recoveryConfig && ridCurrent) {
          mappingUpdatePayload.recovery_id_hash = ridCurrent;
          mappingUpdatePayload.recovery_version =
            resolvedRecoveryVersion ?? recoveryConfig.current.version;
        }

        const { error: updateError } = await supabaseAdmin
          .from("user_member_map")
          .update(mappingUpdatePayload)
          .eq("member_id_hash", pid);
        if (updateError) {
          console.error(
            "[anonymous-sync-v2/register] mapping UPDATE failed:",
            updateError,
          );
          return c.json({ error: "Failed to update mapping" }, 500);
        }
      } else {
        const { error: insertError } = await supabaseAdmin
          .from("user_member_map")
          .upsert(
            {
              user_id: newUserId,
              member_id_hash: pidCurrent,
              salt_version: config.pepperConfig.current.version,
              hash_algorithm: "hmac-sha256",
              ...(recoveryConfig && ridCurrent
                ? {
                    recovery_id_hash: ridCurrent,
                    recovery_version:
                      resolvedRecoveryVersion ?? recoveryConfig.current.version,
                  }
                : {}),
            },
            { onConflict: "user_id" },
          );
        if (insertError) {
          // 23505 = unique_violation. 並行 register でレース敗北したケースを救う。
          if ((insertError as any).code === "23505") {
            const { data: winner, error: winnerErr } = await supabaseAdmin
              .from("user_member_map")
              .select("user_id, member_id_hash")
              .eq("member_id_hash", pidCurrent)
              .maybeSingle();
            if (winnerErr) {
              console.error(
                "[anonymous-sync-v2/register] race recovery failed:",
                winnerErr,
              );
              return c.json({ error: "Failed to create mapping" }, 500);
            }

            if (winner) {
              canonicalUserId = winner.user_id;
              pid = winner.member_id_hash;
            } else {
              const { data: ownRow, error: ownRowErr } = await supabaseAdmin
                .from("user_member_map")
                .select("user_id, member_id_hash")
                .eq("user_id", newUserId)
                .maybeSingle();
              if (ownRowErr || !ownRow) {
                console.error(
                  "[anonymous-sync-v2/register] race recovery (own row) failed:",
                  ownRowErr,
                );
                return c.json({ error: "Failed to create mapping" }, 500);
              }
              canonicalUserId = ownRow.user_id;
              pid = ownRow.member_id_hash;
            }
          } else {
            console.error(
              "[anonymous-sync-v2/register] mapping UPSERT failed:",
              insertError,
            );
            return c.json({ error: "Failed to create mapping" }, 500);
          }
        } else {
          pid = pidCurrent;
          mapping = {
            user_id: newUserId,
            member_id_hash: pidCurrent,
            salt_version: config.pepperConfig.current.version,
            recovery_id_hash: recoveryConfig && ridCurrent ? ridCurrent : null,
            recovery_version:
              recoveryConfig && ridCurrent
                ? (resolvedRecoveryVersion ?? recoveryConfig.current.version)
                : null,
          };
        }
      }

      if (!canonicalUserId) {
        canonicalUserId = newUserId;
      }
    }

    if (canonicalUserId && !mapping) {
      const { error: ensureUpsertError } = await supabaseAdmin
        .from("user_member_map")
        .upsert(
          {
            user_id: canonicalUserId,
            member_id_hash: pidCurrent,
            salt_version: config.pepperConfig.current.version,
            hash_algorithm: "hmac-sha256",
            ...(recoveryConfig && ridCurrent
              ? {
                  recovery_id_hash: ridCurrent,
                  recovery_version:
                    resolvedRecoveryVersion ?? recoveryConfig.current.version,
                }
              : {}),
          },
          { onConflict: "user_id" },
        );

      if (ensureUpsertError) {
        if ((ensureUpsertError as any).code === "23505") {
          const { data: winner, error: winnerErr } = await supabaseAdmin
            .from("user_member_map")
            .select("user_id, member_id_hash")
            .eq("member_id_hash", pidCurrent)
            .maybeSingle();

          if (winnerErr) {
            console.error(
              "[anonymous-sync-v2/register] ensure mapping race recovery failed:",
              winnerErr,
            );
            return c.json({ error: "Failed to create mapping" }, 500);
          }

          if (winner) {
            canonicalUserId = (winner as { user_id: string }).user_id;
            pid = (winner as { member_id_hash: string }).member_id_hash;
          } else {
            const { data: ownRow, error: ownRowErr } = await supabaseAdmin
              .from("user_member_map")
              .select("user_id, member_id_hash")
              .eq("user_id", canonicalUserId)
              .maybeSingle();
            if (ownRowErr || !ownRow) {
              console.error(
                "[anonymous-sync-v2/register] ensure mapping recovery by user_id failed:",
                ownRowErr,
              );
              return c.json({ error: "Failed to create mapping" }, 500);
            }
            canonicalUserId = (ownRow as { user_id: string }).user_id;
            pid = (ownRow as { member_id_hash: string }).member_id_hash;
          }
        } else if (!isSchemaObjectMissingError(ensureUpsertError)) {
          console.error(
            "[anonymous-sync-v2/register] ensure mapping UPSERT failed:",
            ensureUpsertError,
          );
          return c.json({ error: "Failed to create mapping" }, 500);
        }
      } else {
        pid = pidCurrent;
      }
    }

    if (!canonicalUserId) {
      console.error(
        "[anonymous-sync-v2/register] canonical user resolution failed",
      );
      return c.json({ error: "Failed to create mapping" }, 500);
    }

    if (
      missingCanonicalUserIdForRelink &&
      missingCanonicalUserIdForRelink !== canonicalUserId &&
      acceptedPids.length > 0
    ) {
      const acceptedPidFilter = acceptedPids.join(",");
      const { error: relinkError } = await supabaseAdmin
        .from("member_id_hash_rotations")
        .update({ canonical_user_id: canonicalUserId })
        .eq("canonical_user_id", missingCanonicalUserIdForRelink)
        .or(
          `pid_from.in.(${acceptedPidFilter}),pid_to.in.(${acceptedPidFilter})`,
        );

      if (relinkError) {
        if (isSchemaObjectMissingError(relinkError)) {
          console.warn(
            "[anonymous-sync-v2/register] member_id_hash_rotations unavailable; skipping continuity relink",
          );
        } else {
          console.warn(
            "[anonymous-sync-v2/register] member_id_hash_rotations continuity relink failed",
            {
              old_canonical_user_id: missingCanonicalUserIdForRelink,
              new_canonical_user_id: canonicalUserId,
              code: (relinkError as { code?: unknown }).code,
              message: (relinkError as { message?: unknown }).message,
            },
          );
        }
      } else {
        console.log(
          "[anonymous-sync-v2/register] relinked member_id_hash_rotations to recreated canonical user",
          {
            old_canonical_user_id: missingCanonicalUserIdForRelink,
            new_canonical_user_id: canonicalUserId,
            accepted_pid_count: acceptedPids.length,
          },
        );
      }
    }

    if (recoveryConfig && ridCurrent) {
      const { error: anchorUpsertError } = await supabaseAdmin
        .from("user_identity_anchor")
        .upsert(
          {
            canonical_user_id: canonicalUserId,
            recovery_id_hash: ridCurrent,
            recovery_version:
              resolvedRecoveryVersion ?? recoveryConfig.current.version,
            assurance_level: "device_signature",
            last_verified_at: new Date().toISOString(),
          },
          { onConflict: "canonical_user_id" },
        );

      if (anchorUpsertError) {
        if (isSchemaObjectMissingError(anchorUpsertError)) {
          console.warn(
            "[anonymous-sync-v2/register] user_identity_anchor unavailable; skipping upsert",
          );
        } else if ((anchorUpsertError as any).code === "23505") {
          console.warn(
            "[anonymous-sync-v2/register] recovery id conflict during anchor upsert",
            { canonical_user_id: canonicalUserId },
          );
          return c.json({ error: "recovery_id_conflict" }, 409);
        } else {
          console.error(
            "[anonymous-sync-v2/register] user_identity_anchor upsert failed:",
            anchorUpsertError,
          );
          return c.json({ error: "Database error" }, 500);
        }
      }
    }

    // user_devices に端末を追加 (UNIQUE(pid, device_pubkey) で重複は無視)
    const pubkeyHex = `\\x${Array.from(pubkey.raw)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;

    type DeviceRow = { device_id: string; revoked_at: string | null };

    const { data: existingDeviceRaw, error: existingDeviceError } =
      await supabaseAdmin
        .from("user_devices")
        .select("device_id, revoked_at")
        .eq("pid", pid)
        .eq("device_pubkey", pubkeyHex)
        .maybeSingle();
    const existingDevice = (existingDeviceRaw ?? null) as DeviceRow | null;
    if (existingDeviceError) {
      console.error(
        "[anonymous-sync-v2/register] user_devices lookup failed:",
        existingDeviceError,
      );
      return c.json({ error: "Database error" }, 500);
    }

    let deviceId: string;
    if (existingDevice && !existingDevice.revoked_at) {
      deviceId = existingDevice.device_id;
      // last_seen_at を更新する程度に留める
      await supabaseAdmin
        .from("user_devices")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("device_id", deviceId);
    } else if (existingDevice && existingDevice.revoked_at) {
      // 失効済みの公開鍵が再登録要求されたケース。意図せぬ再活性化を防ぐため拒否。
      console.warn("[anonymous-sync-v2/register] revoked device re-register", {
        device_id: existingDevice.device_id,
      });
      return c.json({ error: "device_revoked" }, 409);
    } else {
      const { data: inserted, error: insertDeviceError } = await supabaseAdmin
        .from("user_devices")
        .insert({
          canonical_user_id: canonicalUserId,
          pid,
          device_pubkey: pubkeyHex,
        })
        .select("device_id")
        .single();
      if (insertDeviceError) {
        if ((insertDeviceError as any).code === "23505") {
          const { data: winnerDevice, error: winnerDeviceErr } =
            await supabaseAdmin
              .from("user_devices")
              .select("device_id, revoked_at")
              .eq("pid", pid)
              .eq("device_pubkey", pubkeyHex)
              .maybeSingle();

          if (winnerDeviceErr || !winnerDevice) {
            console.error(
              "[anonymous-sync-v2/register] user_devices race recovery failed:",
              winnerDeviceErr,
            );
            return c.json({ error: "Failed to register device" }, 500);
          }
          if (winnerDevice.revoked_at) {
            return c.json({ error: "device_revoked" }, 409);
          }
          deviceId = winnerDevice.device_id;
        } else {
          console.error(
            "[anonymous-sync-v2/register] user_devices INSERT failed:",
            insertDeviceError,
          );
          return c.json({ error: "Failed to register device" }, 500);
        }
      } else if (
        !inserted ||
        typeof (inserted as { device_id?: unknown }).device_id !== "string"
      ) {
        console.error(
          "[anonymous-sync-v2/register] user_devices INSERT missing row",
        );
        return c.json({ error: "Failed to register device" }, 500);
      } else {
        deviceId = (inserted as { device_id: string }).device_id;
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const { token, expiresAt } = await issueDatasetToken({
      secret: datasetSecretResolved.secret,
      canonicalUserId,
      pid,
      now,
      trustTag: "unverified",
    });

    console.log(
      `[anonymous-sync-v2/register] ok pid=${maskPid(pid)} device=${deviceId}`,
    );

    return c.json({
      device_id: deviceId,
      pid,
      dataset_token: token,
      dataset_token_expires_at: expiresAt,
      trust_tag: "unverified",
      salt_version: config.pepperConfig.current.version,
    });
  } catch (err) {
    console.error("[anonymous-sync-v2/register] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ========================
// GET /anonymous-sync/v2/challenge?device_id=...
// ========================

app.get("/anonymous-sync/v2/devices", async (c) => {
  try {
    const accessToken = extractAccessToken(c);
    if (!accessToken) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const base = resolveBaseConfig(c);
    if (!base.ok) {
      console.error("[anonymous-sync-v2/devices] config invalid:", base.reason);
      return c.json({ error: "Server configuration error" }, 500);
    }

    const user = await verifySupabaseAccessToken({
      supabaseUrl: base.config.supabaseUrl,
      anonKey: base.config.anonKey,
      accessToken,
    });
    if (!user) {
      return c.json({ error: "invalid_token" }, 401);
    }

    const includeRevokedQuery = c.req.query("include_revoked")?.toLowerCase();
    const includeRevoked =
      includeRevokedQuery === "1" || includeRevokedQuery === "true";

    const supabaseAdmin = createClient(
      base.config.supabaseUrl,
      base.config.serviceRoleKey,
    );

    let query = supabaseAdmin
      .from("user_devices")
      .select(
        "device_id, pid, created_at, last_seen_at, revoked_at, revoked_reason",
      )
      .eq("canonical_user_id", user.id)
      .order("created_at", { ascending: false });

    if (!includeRevoked) {
      query = query.is("revoked_at", null);
    }

    type DeviceRow = {
      device_id: string;
      pid: string;
      created_at: string;
      last_seen_at: string | null;
      revoked_at: string | null;
      revoked_reason: string | null;
    };

    const { data, error } = await query.returns<DeviceRow[]>();
    if (error) {
      console.error("[anonymous-sync-v2/devices] lookup failed:", error);
      return c.json({ error: "Database error" }, 500);
    }

    const devices = (data ?? []).map((row) => ({
      device_id: row.device_id,
      pid_masked: maskPid(row.pid),
      created_at: row.created_at,
      last_seen_at: row.last_seen_at,
      revoked_at: row.revoked_at,
      revoked_reason: row.revoked_reason,
    }));

    return c.json({ devices, include_revoked: includeRevoked });
  } catch (err) {
    console.error("[anonymous-sync-v2/devices] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/anonymous-sync/v2/challenge", async (c) => {
  try {
    const deviceId = normalizeDeviceId(c.req.query("device_id"));
    if (!deviceId) {
      return c.json({ error: "device_id must be a UUID" }, 400);
    }

    const base = resolveBaseConfig(c);
    if (!base.ok) {
      console.error(
        "[anonymous-sync-v2/challenge] config invalid:",
        base.reason,
      );
      return c.json({ error: "Server configuration error" }, 500);
    }

    const challengeResolved = resolveChallengeSecret(c);
    if (!challengeResolved.ok) {
      console.error(
        "[anonymous-sync-v2/challenge] challenge secret invalid:",
        challengeResolved.reason,
      );
      return c.json({ error: "Server configuration error" }, 500);
    }

    // challenge は HMAC nonce 発行のみで pepper を必要としない (Vault RPC を呼ばない)
    const { nonce, expiresAt } = await issueChallengeNonce(
      challengeResolved.secret,
      deviceId,
    );

    return c.json({
      nonce,
      expires_at: expiresAt,
      window_seconds: CHALLENGE_BUCKET_SECONDS,
      attestation_required: true,
    });
  } catch (err) {
    console.error("[anonymous-sync-v2/challenge] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ========================
// POST /anonymous-sync/v2/refresh
// ========================

type RefreshCachedResult = {
  status: "ok";
  device_id: string;
  pid: string;
  dataset_token: string;
  dataset_token_expires_at: number;
  trust_tag: TrustTag;
  salt_version: string;
};

app.post("/anonymous-sync/v2/refresh", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_json" }, 400);
    }

    const deviceId = normalizeDeviceId((body as any).device_id);
    if (!deviceId) {
      return c.json({ error: "device_id must be a UUID" }, 400);
    }

    const apiMemberId = normalizeApiMemberId((body as any).api_member_id);
    if (!apiMemberId) {
      return c.json(
        {
          error: "api_member_id must be a positive integer (string or number)",
        },
        400,
      );
    }

    const nonce =
      typeof (body as any).nonce === "string"
        ? (body as any).nonce.trim().toLowerCase()
        : "";
    if (!/^[a-f0-9]{64}$/.test(nonce)) {
      return c.json({ error: "nonce malformed" }, 400);
    }

    const sig = (body as any).sig;
    if (typeof sig !== "string" || sig.length === 0) {
      return c.json({ error: "sig is required" }, 400);
    }

    const parsedAttestation = parseAttestationReport(
      (body as any).attestation_report,
    );

    const base = resolveBaseConfig(c);
    if (!base.ok) {
      console.error("[anonymous-sync-v2/refresh] config invalid:", base.reason);
      return c.json({ error: "Server configuration error" }, 500);
    }

    const challengeResolved = resolveChallengeSecret(c);
    if (!challengeResolved.ok) {
      console.error(
        "[anonymous-sync-v2/refresh] challenge secret invalid:",
        challengeResolved.reason,
      );
      return c.json({ error: "Server configuration error" }, 500);
    }

    const datasetSecretResolved = resolveDatasetTokenSecret(c);
    if (!datasetSecretResolved.ok) {
      console.error(
        "[anonymous-sync-v2/refresh] dataset token secret invalid:",
        datasetSecretResolved.reason,
      );
      return c.json({ error: "Server configuration error" }, 500);
    }

    // nonce が我々の HMAC で発行されたものか (pepper を必要とせず challenge HMAC のみ)
    const nonceValid = await verifyChallengeNonce(
      challengeResolved.secret,
      deviceId,
      nonce,
    );
    if (!nonceValid) {
      return c.json({ error: "nonce_invalid_or_expired" }, 401);
    }

    const kv = c.env.DATA_LOADER_CACHE_KV;
    const cacheKey = `refresh-result:${deviceId}:${nonce}`;
    const supabaseAdmin = createClient(
      base.config.supabaseUrl,
      base.config.serviceRoleKey,
    );

    type DeviceLookup = {
      canonical_user_id: string;
      pid: string;
      device_pubkey: string; // bytea => "\xABCD..." の hex 文字列
      revoked_at: string | null;
    };
    const { data: device, error: deviceErr } = await supabaseAdmin
      .from("user_devices")
      .select("canonical_user_id, pid, device_pubkey, revoked_at")
      .eq("device_id", deviceId)
      .maybeSingle<DeviceLookup>();
    if (deviceErr) {
      console.error(
        "[anonymous-sync-v2/refresh] user_devices lookup failed:",
        deviceErr,
      );
      return c.json({ error: "Database error" }, 500);
    }
    if (!device || device.revoked_at) {
      return c.json({ error: "device_unknown_or_revoked" }, 404);
    }

    // bytea hex → base64 (PostgREST は bytea を `\xHEX` で返す)
    const hexBody = device.device_pubkey.startsWith("\\x")
      ? device.device_pubkey.slice(2)
      : device.device_pubkey;
    if (hexBody.length !== 64 || !/^[0-9a-fA-F]+$/.test(hexBody)) {
      console.error(
        "[anonymous-sync-v2/refresh] device_pubkey not a 32-byte hex value",
      );
      return c.json({ error: "Internal server error" }, 500);
    }
    const pubBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      pubBytes[i] = parseInt(hexBody.slice(i * 2, i * 2 + 2), 16);
    }
    const publicKeyB64 = encodeBytesToBase64(pubBytes);

    const sigValid = await verifyDeviceSig({
      publicKeyB64,
      message: nonce,
      signatureB64: sig,
    });
    if (!sigValid) {
      return c.json({ error: "signature_invalid" }, 401);
    }

    // idempotent retry: nonce + 署名の正当性を満たした再送だけ結果再生を許可する。
    if (kv) {
      const cached = await kv.get(cacheKey, { type: "json" });
      if (cached && typeof cached === "object") {
        const parsed = cached as Partial<RefreshCachedResult>;
        if (
          typeof parsed.device_id === "string" &&
          typeof parsed.pid === "string" &&
          typeof parsed.dataset_token === "string" &&
          typeof parsed.dataset_token_expires_at === "number" &&
          normalizeTrustTag(parsed.trust_tag) !== null &&
          typeof parsed.salt_version === "string"
        ) {
          const trustTag = normalizeTrustTag(parsed.trust_tag)!;
          const replay: RefreshCachedResult = {
            status: "ok",
            device_id: parsed.device_id,
            pid: parsed.pid,
            dataset_token: parsed.dataset_token,
            dataset_token_expires_at: parsed.dataset_token_expires_at,
            trust_tag: trustTag,
            salt_version: parsed.salt_version,
          };
          return c.json(replay);
        }
      }
    }

    // ワンタイム消費: DB 一意制約で原子的に確定する。
    // 旧環境互換のため、テーブル未適用時のみ KV へフォールバックする。
    const nonceConsume = await consumeDeviceNonce({
      supabaseAdmin,
      deviceId,
      nonce,
      context: "refresh",
    });
    if (!nonceConsume.ok) {
      return c.json({ error: nonceConsume.error }, nonceConsume.status);
    }

    const trustInput = parsedAttestation.report
      ? await verifyAttestation(parsedAttestation.report, nonce, {
          secureEnclaveTrustedRootSha256: resolveSecureEnclaveTrustedRoots(c),
          tpmAkTrustedRootSha256: resolveTpmAkTrustedRoots(c),
        })
      : null;

    const attestationPolicyDecision = decideRefreshAttestationPolicy({
      parsedAttestationMalformed: parsedAttestation.malformed,
      hasAttestationReport: parsedAttestation.report != null,
      trustInput,
    });

    if (!attestationPolicyDecision.allow) {
      console.warn(
        "[anonymous-sync-v2/refresh] rejected by attestation policy",
        {
          device_id: deviceId,
          reason: attestationPolicyDecision.error,
          status: attestationPolicyDecision.status,
          attestation_level: attestationPolicyDecision.attestationLevelForLog,
          attestation_valid: attestationPolicyDecision.attestationValidForLog,
          malformed_attestation_report: parsedAttestation.malformed,
        },
      );
      return c.json(
        { error: attestationPolicyDecision.error },
        attestationPolicyDecision.status,
      );
    }

    const trustTag: TrustTag = attestationPolicyDecision.trustTag;
    const attestationLevelForLog =
      attestationPolicyDecision.attestationLevelForLog;
    const attestationValidForLog =
      attestationPolicyDecision.attestationValidForLog;

    // ここで初めて Vault RPC を叩く (nonce/署名が無効なリクエストで Vault を消費しない)
    const pepperResolved = await resolvePepperBundle({
      base: base.config,
      supabaseAdmin,
    });
    if (!pepperResolved.ok) {
      console.error(
        "[anonymous-sync-v2/refresh] pepper resolution failed:",
        pepperResolved.reason,
      );
      return c.json({ error: "Server configuration error" }, 500);
    }
    const config = {
      ...base.config,
      pepperConfig: pepperResolved.pepperConfig,
    };
    const recoveryResolved = await resolveRecoveryBundle({
      base: base.config,
      supabaseAdmin,
    });
    if (!recoveryResolved.ok) {
      console.warn(
        "[anonymous-sync-v2/refresh] recovery bundle unavailable; fallback continuity is disabled",
      );
    }

    const canonicalUserId = device.canonical_user_id;
    let recoveryCurrentId: string | null = null;
    let recoveryDetectedVersion: string | null = null;
    let usedRecoveryFallback = false;

    if (recoveryResolved.ok) {
      recoveryCurrentId = await computeRecoveryId(
        recoveryResolved.recoveryConfig.current.secret,
        apiMemberId,
      );

      const { data: anchorRaw, error: anchorErr } = await supabaseAdmin
        .from("user_identity_anchor")
        .select("recovery_id_hash, recovery_version")
        .eq("canonical_user_id", canonicalUserId)
        .maybeSingle();

      if (anchorErr) {
        if (isSchemaObjectMissingError(anchorErr)) {
          console.warn(
            "[anonymous-sync-v2/refresh] user_identity_anchor unavailable; cannot evaluate recovery fallback",
          );
        } else {
          console.error(
            "[anonymous-sync-v2/refresh] user_identity_anchor lookup failed:",
            anchorErr,
          );
          return c.json({ error: "Database error" }, 500);
        }
      } else {
        const anchor = (anchorRaw ?? null) as {
          recovery_id_hash: string;
          recovery_version: string | null;
        } | null;

        if (anchor?.recovery_id_hash) {
          const detectedRecovery = await detectRecoveryVersionFor(
            recoveryResolved.recoveryConfig,
            apiMemberId,
            anchor.recovery_id_hash,
          );
          if (detectedRecovery) {
            recoveryDetectedVersion = detectedRecovery.entry.version;
          }
        }
      }
    }

    // pepper バージョン解決: 保存 pid と一致する世代を特定
    const detected = await detectPepperVersionFor(
      config.pepperConfig,
      apiMemberId,
      device.pid,
    );
    if (!detected) {
      if (!recoveryDetectedVersion) {
        // 保存 pid が現行 accept 集合のどの世代でも再現できない
        // (= pepper が完全に退役した / 端末データ破損)
        console.warn(
          "[anonymous-sync-v2/refresh] stored pid cannot be reproduced by any accepted pepper",
          { device_id: deviceId, pid: maskPid(device.pid) },
        );
        await insertRecoveryRelinkAudit({
          supabaseAdmin,
          canonicalUserId,
          deviceId,
          outcome: "rejected",
          reason: "pepper_version_unknown",
          details: {
            recovery_available: recoveryResolved.ok,
          },
        });
        return c.json({ error: "pepper_version_unknown" }, 410);
      }

      usedRecoveryFallback = true;
      console.warn(
        "[anonymous-sync-v2/refresh] recovered continuity using recovery HMAC fallback",
        {
          device_id: deviceId,
          recovery_version: recoveryDetectedVersion,
        },
      );
    }

    const pidNew = await computePid(
      config.pepperConfig.current.secret,
      apiMemberId,
    );

    // pepper ローテーション中: 保存 pid が旧世代なら user_member_map と user_devices を更新
    if (pidNew !== device.pid) {
      // user_member_map を canonical_user_id 基準で現行値に寄せる
      const mapUpsertPayload: Record<string, unknown> = {
        user_id: canonicalUserId,
        member_id_hash: pidNew,
        salt_version: config.pepperConfig.current.version,
        hash_algorithm: "hmac-sha256",
      };
      if (recoveryResolved.ok && recoveryCurrentId) {
        mapUpsertPayload.recovery_id_hash = recoveryCurrentId;
        mapUpsertPayload.recovery_version =
          recoveryResolved.recoveryConfig.current.version;
      }

      const { error: mapUpdateErr } = await supabaseAdmin
        .from("user_member_map")
        .upsert(mapUpsertPayload, { onConflict: "user_id" });
      if (mapUpdateErr) {
        console.error(
          "[anonymous-sync-v2/refresh] user_member_map rotation UPSERT failed:",
          mapUpdateErr,
        );
        return c.json({ error: "Failed to rotate mapping" }, 500);
      }

      // この pid に紐づく全 user_devices.pid をまとめて更新
      const { error: devicesUpdateErr } = await supabaseAdmin
        .from("user_devices")
        .update({ pid: pidNew })
        .eq("pid", device.pid);
      if (devicesUpdateErr) {
        console.error(
          "[anonymous-sync-v2/refresh] user_devices rotation UPDATE failed:",
          devicesUpdateErr,
        );
        return c.json({ error: "Failed to rotate devices" }, 500);
      }

      // rotations 履歴へ追記 (canonical user 削除に追従させないため CASCADE しない)
      // recovery fallback で復元した場合も監査上の連続性を保つため履歴を残す。
      const saltVersionFrom =
        detected?.entry.version ?? recoveryDetectedVersion;
      if (saltVersionFrom) {
        const { error: rotInsertErr } = await supabaseAdmin
          .from("member_id_hash_rotations")
          .insert({
            canonical_user_id: canonicalUserId,
            pid_from: device.pid,
            salt_version_from: saltVersionFrom,
            pid_to: pidNew,
            salt_version_to: config.pepperConfig.current.version,
          });
        if (rotInsertErr) {
          // 履歴失敗は warn にとどめ refresh 自体は通す (運用上の重複検知用)
          console.warn(
            "[anonymous-sync-v2/refresh] rotation history insert failed:",
            rotInsertErr,
          );
        }
      }
    }

    if (recoveryResolved.ok && recoveryCurrentId) {
      const { error: anchorUpsertErr } = await supabaseAdmin
        .from("user_identity_anchor")
        .upsert(
          {
            canonical_user_id: canonicalUserId,
            recovery_id_hash: recoveryCurrentId,
            recovery_version: recoveryResolved.recoveryConfig.current.version,
            assurance_level: "device_signature",
            last_verified_at: new Date().toISOString(),
          },
          { onConflict: "canonical_user_id" },
        );

      if (anchorUpsertErr) {
        if (isSchemaObjectMissingError(anchorUpsertErr)) {
          console.warn(
            "[anonymous-sync-v2/refresh] user_identity_anchor unavailable; skipping upsert",
          );
        } else if ((anchorUpsertErr as any).code === "23505") {
          return c.json({ error: "recovery_id_conflict" }, 409);
        } else {
          console.error(
            "[anonymous-sync-v2/refresh] user_identity_anchor upsert failed:",
            anchorUpsertErr,
          );
          return c.json({ error: "Database error" }, 500);
        }
      }
    }

    // last_seen_at 更新 (失敗しても致命的ではない)
    await supabaseAdmin
      .from("user_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("device_id", deviceId);

    const now = Math.floor(Date.now() / 1000);
    const { token, expiresAt } = await issueDatasetToken({
      secret: datasetSecretResolved.secret,
      canonicalUserId,
      pid: pidNew,
      now,
      trustTag,
    });

    const result: RefreshCachedResult = {
      status: "ok",
      device_id: deviceId,
      pid: pidNew,
      dataset_token: token,
      dataset_token_expires_at: expiresAt,
      trust_tag: trustTag,
      salt_version: config.pepperConfig.current.version,
    };

    if (kv) {
      await kv.put(cacheKey, JSON.stringify(result), {
        expirationTtl: REFRESH_RESULT_TTL_SECONDS,
      });
    }

    if (usedRecoveryFallback) {
      await insertRecoveryRelinkAudit({
        supabaseAdmin,
        canonicalUserId,
        deviceId,
        outcome: "accepted",
        reason: "pepper_version_unknown_recovered",
        details: {
          recovery_version: recoveryDetectedVersion,
          pepper_version_to: config.pepperConfig.current.version,
        },
      });
    }

    const suspiciousDetails = {
      device_id: deviceId,
      attestation_valid: attestationValidForLog,
      malformed_attestation_report: parsedAttestation.malformed,
    };

    await insertSuspiciousTrustAudit({
      supabaseAdmin,
      canonicalUserId,
      deviceId,
      datasetId: pidNew,
      trustTag,
      attestationLevel: attestationLevelForLog,
      details: suspiciousDetails,
    });

    scheduleSuspiciousAdminLog(c, {
      envCtx: base.config.envCtx,
      datasetId: pidNew,
      trustTag,
      attestationLevel: attestationLevelForLog,
      details: suspiciousDetails,
    });

    console.log(
      `[anonymous-sync-v2/refresh] ok device=${deviceId} pid=${maskPid(pidNew)}` +
        (pidNew !== device.pid && (detected || recoveryDetectedVersion)
          ? ` rotated_from=${detected?.entry.version ?? recoveryDetectedVersion}`
          : "") +
        (usedRecoveryFallback ? " recovered_via_recovery=1" : ""),
    );
    return c.json(result);
  } catch (err) {
    console.error("[anonymous-sync-v2/refresh] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ========================
// POST /anonymous-sync/v2/revoke
// ========================

app.post("/anonymous-sync/v2/revoke", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_json" }, 400);
    }

    const deviceId = normalizeDeviceId((body as any).device_id);
    const targetDeviceId = normalizeDeviceId((body as any).target_device_id);
    if (!deviceId || !targetDeviceId) {
      return c.json(
        { error: "device_id and target_device_id must be UUIDs" },
        400,
      );
    }

    const nonce =
      typeof (body as any).nonce === "string"
        ? (body as any).nonce.trim().toLowerCase()
        : "";
    if (!/^[a-f0-9]{64}$/.test(nonce)) {
      return c.json({ error: "nonce malformed" }, 400);
    }

    const sig = (body as any).sig;
    if (typeof sig !== "string" || sig.length === 0) {
      return c.json({ error: "sig is required" }, 400);
    }

    const reason =
      typeof (body as any).reason === "string"
        ? (body as any).reason.trim().slice(0, 200)
        : "user_revoke";

    const base = resolveBaseConfig(c);
    if (!base.ok) {
      console.error("[anonymous-sync-v2/revoke] config invalid:", base.reason);
      return c.json({ error: "Server configuration error" }, 500);
    }

    const challengeResolved = resolveChallengeSecret(c);
    if (!challengeResolved.ok) {
      console.error(
        "[anonymous-sync-v2/revoke] challenge secret invalid:",
        challengeResolved.reason,
      );
      return c.json({ error: "Server configuration error" }, 500);
    }

    // revoke は pid を再計算しないため pepper bundle (Vault RPC) を必要としない
    const nonceValid = await verifyChallengeNonce(
      challengeResolved.secret,
      deviceId,
      nonce,
    );
    if (!nonceValid) {
      return c.json({ error: "nonce_invalid_or_expired" }, 401);
    }

    const supabaseAdmin = createClient(
      base.config.supabaseUrl,
      base.config.serviceRoleKey,
    );

    type DeviceLookup = {
      canonical_user_id: string;
      pid: string;
      device_pubkey: string;
      revoked_at: string | null;
    };
    const { data: caller, error: callerErr } = await supabaseAdmin
      .from("user_devices")
      .select("canonical_user_id, pid, device_pubkey, revoked_at")
      .eq("device_id", deviceId)
      .maybeSingle<DeviceLookup>();
    if (callerErr) {
      console.error(
        "[anonymous-sync-v2/revoke] caller lookup failed:",
        callerErr,
      );
      return c.json({ error: "Database error" }, 500);
    }
    if (!caller || caller.revoked_at) {
      return c.json({ error: "device_unknown_or_revoked" }, 404);
    }

    const hexBody = caller.device_pubkey.startsWith("\\x")
      ? caller.device_pubkey.slice(2)
      : caller.device_pubkey;
    if (hexBody.length !== 64 || !/^[0-9a-fA-F]+$/.test(hexBody)) {
      console.error(
        "[anonymous-sync-v2/revoke] device_pubkey not a 32-byte hex value",
      );
      return c.json({ error: "Internal server error" }, 500);
    }
    const pubBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      pubBytes[i] = parseInt(hexBody.slice(i * 2, i * 2 + 2), 16);
    }

    const message = `revoke|${deviceId}|${targetDeviceId}|${nonce}`;
    const sigValid = await verifyDeviceSig({
      publicKeyB64: encodeBytesToBase64(pubBytes),
      message,
      signatureB64: sig,
    });
    if (!sigValid) {
      return c.json({ error: "signature_invalid" }, 401);
    }

    // 署名検証を通過したリクエストのみ nonce を原子的に消費する。
    const nonceConsume = await consumeDeviceNonce({
      supabaseAdmin,
      deviceId,
      nonce,
      context: "revoke",
    });
    if (!nonceConsume.ok) {
      return c.json({ error: nonceConsume.error }, nonceConsume.status);
    }

    // 自分自身の canonical_user_id 配下の端末しか失効できない
    const { data: target, error: targetErr } = await supabaseAdmin
      .from("user_devices")
      .select("canonical_user_id, revoked_at")
      .eq("device_id", targetDeviceId)
      .maybeSingle<{ canonical_user_id: string; revoked_at: string | null }>();
    if (targetErr) {
      console.error(
        "[anonymous-sync-v2/revoke] target lookup failed:",
        targetErr,
      );
      return c.json({ error: "Database error" }, 500);
    }
    if (!target) {
      return c.json({ error: "target_unknown" }, 404);
    }
    if (target.canonical_user_id !== caller.canonical_user_id) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (target.revoked_at) {
      return new Response(null, { status: 204 });
    }

    const { error: updateErr } = await supabaseAdmin
      .from("user_devices")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: reason,
      })
      .eq("device_id", targetDeviceId);
    if (updateErr) {
      console.error(
        "[anonymous-sync-v2/revoke] revoke UPDATE failed:",
        updateErr,
      );
      return c.json({ error: "Failed to revoke device" }, 500);
    }

    console.log(
      `[anonymous-sync-v2/revoke] ok caller=${deviceId} target=${targetDeviceId}`,
    );
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[anonymous-sync-v2/revoke] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.delete("/anonymous-sync/v2/devices/:deviceId", async (c) => {
  try {
    const accessToken = extractAccessToken(c);
    if (!accessToken) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const hasCookieAuth = !c.req.header("Authorization")?.startsWith("Bearer ");
    if (!assertCsrfSafe(c, hasCookieAuth)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const deviceId = normalizeDeviceId(c.req.param("deviceId"));
    if (!deviceId) {
      return c.json({ error: "device_id must be a UUID" }, 400);
    }

    const base = resolveBaseConfig(c);
    if (!base.ok) {
      console.error(
        "[anonymous-sync-v2/devices/:id] config invalid:",
        base.reason,
      );
      return c.json({ error: "Server configuration error" }, 500);
    }

    const user = await verifySupabaseAccessToken({
      supabaseUrl: base.config.supabaseUrl,
      anonKey: base.config.anonKey,
      accessToken,
    });
    if (!user) {
      return c.json({ error: "invalid_token" }, 401);
    }

    const reasonRaw = c.req.query("reason") ?? "user_revoke_from_web";
    const reason = reasonRaw.trim().slice(0, 200) || "user_revoke_from_web";

    const supabaseAdmin = createClient(
      base.config.supabaseUrl,
      base.config.serviceRoleKey,
    );

    const { data: target, error: targetErr } = await supabaseAdmin
      .from("user_devices")
      .select("canonical_user_id, revoked_at")
      .eq("device_id", deviceId)
      .maybeSingle<{ canonical_user_id: string; revoked_at: string | null }>();

    if (targetErr) {
      console.error(
        "[anonymous-sync-v2/devices/:id] lookup failed:",
        targetErr,
      );
      return c.json({ error: "Database error" }, 500);
    }
    if (!target || target.canonical_user_id !== user.id) {
      return c.json({ error: "not_found" }, 404);
    }
    if (target.revoked_at) {
      return new Response(null, { status: 204 });
    }

    const { error: updateErr } = await supabaseAdmin
      .from("user_devices")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: reason,
      })
      .eq("device_id", deviceId)
      .eq("canonical_user_id", user.id)
      .is("revoked_at", null);

    if (updateErr) {
      console.error(
        "[anonymous-sync-v2/devices/:id] revoke update failed:",
        updateErr,
      );
      return c.json({ error: "Failed to revoke device" }, 500);
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[anonymous-sync-v2/devices/:id] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default app;
