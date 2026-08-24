import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { SignJWT } from "jose";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  firstSchemaError,
  RevokeRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  UserMemberMapRowSchema,
  UserDeviceListRowSchema,
  UserDeviceLookupRowSchema,
  UserDeviceRevokeTargetRowSchema,
  UserDeviceWebRevokeTargetRowSchema,
  UserDeviceRefreshRowSchema,
  PendingSyncCompleteRequestSchema,
  SupabaseAccessTokenUserSchema,
} from "../schemas/anonymous-sync-v2";
import {
  createEnvContext,
  getEnv,
  resolvePublicIdsForUser,
  resolveSupabaseConfig,
  validateDatasetTokenWithConstraints,
} from "../utils";
import {
  CHALLENGE_BUCKET_SECONDS,
  encodeBytesToBase64,
  decodeBase64ToBytes,
  issueChallengeNonce,
  verifyChallengeNonce,
  verifyDeviceSig,
} from "../utils/pepper";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

const DATASET_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_RESULT_TTL_SECONDS = 300;
const RATE_LIMIT_PER_HOUR = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const AUTH_BODY_MAX_BYTES = 64 * 1024;
const NONCE_CLEANUP_RETENTION_MS = 30 * 60 * 1000;
const NONCE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const API_MEMBER_ID_PATTERN = /^[0-9]{1,16}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let lastNonceCleanupAt = 0;

type RequestBodyResult =
  | { kind: "ok"; data: Uint8Array }
  | { kind: "too_large" };

export async function readRequestBodyWithinLimit(
  request: Request,
  maxBytes: number = AUTH_BODY_MAX_BYTES,
): Promise<RequestBodyResult> {
  const rawLength = request.headers.get("Content-Length");
  if (rawLength !== null) {
    const length = Number(rawLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      return { kind: "too_large" };
    }
  }

  if (!request.body) return { kind: "ok", data: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalLength += value.byteLength;
      if (totalLength > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The request is already being rejected; cancellation is best effort.
        }
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const data = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", data };
}

async function readJsonBodyWithinLimit(
  request: Request,
): Promise<
  | { kind: "ok"; body: unknown }
  | { kind: "invalid_json" }
  | { kind: "too_large" }
> {
  const result = await readRequestBodyWithinLimit(request);
  if (result.kind === "too_large") return result;
  try {
    return {
      kind: "ok",
      body: JSON.parse(new TextDecoder().decode(result.data)),
    };
  } catch {
    return { kind: "invalid_json" };
  }
}

function requestClientKey(c: {
  req: { header: (name: string) => string | undefined };
}): string {
  return c.req.header("CF-Connecting-IP")?.trim() || "unknown";
}

type RateLimitContext = {
  supabaseAdmin: SupabaseClient;
  keys: string[];
  limit?: number;
  windowSeconds?: number;
};

async function consumeRateLimit(ctx: RateLimitContext): Promise<boolean> {
  for (const key of ctx.keys) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(key),
    );
    const digestHex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const { data, error } = await ctx.supabaseAdmin.rpc(
      "rpc_consume_anon_sync_rate_limit",
      {
        p_bucket_key: digestHex,
        p_limit: ctx.limit ?? RATE_LIMIT_PER_HOUR,
        p_window_seconds: ctx.windowSeconds ?? RATE_LIMIT_WINDOW_SECONDS,
      },
    );
    if (error || data !== true) {
      if (error) console.error("[anonymous-sync-v2] rate limit RPC failed:", error);
      return false;
    }
  }
  return true;
}

function maskPublicId(publicId: string): string {
  return `${publicId.substring(0, 8)}...`;
}

function normalizeApiMemberId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return API_MEMBER_ID_PATTERN.test(trimmed) ? trimmed : null;
  }
  return null;
}

function normalizeUuidV4(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_V4_PATTERN.test(normalized) ? normalized : null;
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

function storedPubkeyToBase64(value: string): string | null {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index++) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return encodeBytesToBase64(bytes);
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

type AccessTokenAuth = {
  token: string;
  fromCookie: boolean;
};

function extractAccessToken(c: {
  req: { header: (name: string) => string | undefined };
}): AccessTokenAuth | null {
  const authorization = c.req.header("Authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7).trim();
    return token ? { token, fromCookie: false } : null;
  }

  const cookieHeader = c.req.header("Cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    /(?:^|;\s*)(?:sb-access-token|__Secure-sb-access-token)=([^;]+)/,
  );
  if (!match?.[1]) return null;
  try {
    return { token: decodeURIComponent(match[1]), fromCookie: true };
  } catch {
    return { token: match[1], fromCookie: true };
  }
}

async function verifySupabaseAccessToken(options: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
}): Promise<{ id: string } | null> {
  try {
    const response = await fetch(`${options.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: options.anonKey,
        Authorization: `Bearer ${options.accessToken}`,
      },
    });
    if (!response.ok) return null;
    const parsed = SupabaseAccessTokenUserSchema.safeParse(
      await response.json(),
    );
    return parsed.success ? { id: parsed.data.id } : null;
  } catch (error) {
    console.warn("[anonymous-sync-v2] access token verification failed:", error);
    return null;
  }
}

async function issueDatasetToken(options: {
  secret: string;
  canonicalUserId: string;
  publicId: string;
  deviceId: string;
  now: number;
}): Promise<{ token: string; expiresAt: number }> {
  const secretKey = new TextEncoder().encode(options.secret);
  const expiresAt = options.now + DATASET_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({
    sub: options.canonicalUserId,
    dataset_id: options.publicId,
    device_id: options.deviceId,
    typ: "dataset",
    aud: "fusou-upload",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(options.now)
    .setExpirationTime(expiresAt)
    .sign(secretKey);
  return { token, expiresAt };
}

type BaseConfig = {
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
      supabaseUrl: supabaseConfig.url,
      serviceRoleKey: supabaseConfig.serviceRoleKey,
      anonKey: supabaseConfig.publishableKey,
    },
  };
}

function resolveDatasetTokenSecret(c: { env: Bindings }): SecretResult {
  const envCtx = createEnvContext({ env: c.env });
  const secret = getEnv(envCtx, "DATASET_TOKEN_SECRET");
  if (!secret || secret.length < 32) {
    return { ok: false, reason: "dataset_token_secret_invalid" };
  }
  return { ok: true, secret };
}

function resolveChallengeSecret(c: { env: Bindings }): SecretResult {
  const envCtx = createEnvContext({ env: c.env });
  const secret = getEnv(envCtx, "CHALLENGE_HMAC_SECRET");
  if (!secret || secret.length < 32) {
    return { ok: false, reason: "challenge_hmac_secret_invalid" };
  }
  return { ok: true, secret };
}

function isSchemaObjectMissingError(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown } | null;
  if (err?.code === "42P01" || err?.code === "42703") return true;
  return typeof err?.message === "string" && /does not exist/i.test(err.message);
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

export function isSupabaseUserNotFoundError(error: unknown): boolean {
  const err = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  } | null;
  if (err?.status === 404) return true;
  if (err?.code === "user_not_found" || err?.code === "not_found") return true;
  return (
    typeof err?.message === "string" &&
    /user/i.test(err.message) &&
    /not found/i.test(err.message)
  );
}

async function resolvePublicId(
  supabaseAdmin: SupabaseClient,
  rpcName: "rpc_register_public_id" | "rpc_get_registered_public_id",
  apiMemberId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc(rpcName, {
    p_api_member_id: apiMemberId,
  });
  if (error) {
    console.error(`[anonymous-sync-v2/${rpcName}] RPC failed:`, {
      code: getErrorCode(error),
      message: (error as { message?: unknown }).message,
    });
    return null;
  }
  const publicId = normalizeUuidV4(data);
  if (!publicId) {
    console.error(`[anonymous-sync-v2/${rpcName}] RPC returned invalid UUID v4`);
    return null;
  }
  return publicId;
}

async function ensureCanonicalUserForPublicId(options: {
  supabaseAdmin: SupabaseClient;
  anonKey: string;
  supabaseUrl: string;
  publicId: string;
}): Promise<string | null> {
  const existing = await options.supabaseAdmin
    .from("user_member_map")
    .select("user_id, public_id")
    .eq("public_id", options.publicId)
    .maybeSingle();
  if (existing.error) {
    console.error("[anonymous-sync-v2/register] public_id mapping lookup failed:", existing.error);
    return null;
  }
  if (existing.data) {
    const parsed = UserMemberMapRowSchema.safeParse(existing.data);
    if (!parsed.success) {
      console.error("[anonymous-sync-v2/register] public_id mapping shape invalid:", parsed.error);
      return null;
    }
    return parsed.data.user_id;
  }

  const anonClient = createClient(options.supabaseUrl, options.anonKey);
  const { data: sessionData, error: sessionError } =
    await anonClient.auth.signInAnonymously();
  if (sessionError || !sessionData.user) {
    console.error("[anonymous-sync-v2/register] signInAnonymously failed:", {
      message: sessionError?.message,
      status: sessionError?.status,
    });
    return null;
  }

  const inserted = await options.supabaseAdmin
    .from("user_member_map")
    .insert({ user_id: sessionData.user.id, public_id: options.publicId })
    .select("user_id, public_id")
    .single();
  if (!inserted.error) return sessionData.user.id;

  if (getErrorCode(inserted.error) !== "23505") {
    console.error("[anonymous-sync-v2/register] public_id mapping insert failed:", inserted.error);
    return null;
  }

  const orphanCleanup = await options.supabaseAdmin.auth.admin.deleteUser(
    sessionData.user.id,
  );
  if (orphanCleanup.error) {
    console.warn(
      "[anonymous-sync-v2/register] failed to remove anonymous user after mapping race:",
      orphanCleanup.error,
    );
  }

  const winner = await options.supabaseAdmin
    .from("user_member_map")
    .select("user_id, public_id")
    .eq("public_id", options.publicId)
    .maybeSingle();
  if (winner.error || !winner.data) {
    console.error("[anonymous-sync-v2/register] public_id mapping race recovery failed:", winner.error);
    return null;
  }
  const parsedWinner = UserMemberMapRowSchema.safeParse(winner.data);
  return parsedWinner.success ? parsedWinner.data.user_id : null;
}

async function consumeDeviceNonce(options: {
  supabaseAdmin: SupabaseClient;
  deviceId: string;
  nonce: string;
  context: "register" | "refresh" | "revoke";
  refreshResult?: {
    token: string;
    expiresAt: number;
  };
}): Promise<{ ok: true } | { ok: false; status: 401 | 500; error: string }> {
  const nowMs = Date.now();
  const noncePayload = {
    device_id: options.deviceId,
    nonce: options.nonce,
    ...(options.refreshResult
      ? {
          refresh_result_token: options.refreshResult.token,
          refresh_result_expires_at: options.refreshResult.expiresAt,
        }
      : {}),
  };
  const nonceInsert = await options.supabaseAdmin
    .from("anon_sync_nonce_consumptions")
    .insert(noncePayload);

  if (!nonceInsert.error) {
    if (nowMs - lastNonceCleanupAt >= NONCE_CLEANUP_INTERVAL_MS) {
      lastNonceCleanupAt = nowMs;
      const cutoffIso = new Date(nowMs - NONCE_CLEANUP_RETENTION_MS).toISOString();
      const { error: cleanupError } = await options.supabaseAdmin
        .from("anon_sync_nonce_consumptions")
        .delete()
        .lt("consumed_at", cutoffIso);
      if (cleanupError && !isSchemaObjectMissingError(cleanupError)) {
        console.warn(`[anonymous-sync-v2/${options.context}] nonce cleanup failed:`, cleanupError);
      }
    }
    return { ok: true };
  }

  if (getErrorCode(nonceInsert.error) === "23505") {
    return { ok: false, status: 401, error: "nonce_already_used" };
  }
  if (!isSchemaObjectMissingError(nonceInsert.error)) {
    console.error(`[anonymous-sync-v2/${options.context}] nonce consumption insert failed:`, nonceInsert.error);
    return { ok: false, status: 500, error: "Database error" };
  }
  console.error(`[anonymous-sync-v2/${options.context}] nonce consumption table unavailable`);
  return { ok: false, status: 500, error: "Server configuration error" };
}

async function readRefreshResultFromDatabase(
  supabaseAdmin: SupabaseClient,
  deviceId: string,
  nonce: string,
): Promise<RefreshCachedResult | null> {
  try {
    const result = await supabaseAdmin
      .from("anon_sync_nonce_consumptions")
      .select("refresh_result_token, refresh_result_expires_at")
      .eq("device_id", deviceId)
      .eq("nonce", nonce)
      .maybeSingle();
    if (result.error || !result.data) return null;

    const row = result.data as {
      refresh_result_token?: unknown;
      refresh_result_expires_at?: unknown;
    };
    const expiresAt =
      typeof row.refresh_result_expires_at === "number"
        ? row.refresh_result_expires_at
        : typeof row.refresh_result_expires_at === "string"
          ? Number(row.refresh_result_expires_at)
          : Number.NaN;
    return parseRefreshCachedResult(
      {
        status: "ok",
        device_id: deviceId,
        dataset_token: row.refresh_result_token,
        dataset_token_expires_at: expiresAt,
      },
      deviceId,
    );
  } catch (error) {
    console.warn("[anonymous-sync-v2/refresh] result lookup failed:", error);
    return null;
  }
}

async function waitForRefreshResultFromDatabase(
  supabaseAdmin: SupabaseClient,
  deviceId: string,
  nonce: string,
): Promise<RefreshCachedResult | null> {
  for (const delayMs of [0, 25, 75, 150]) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    const result = await readRefreshResultFromDatabase(
      supabaseAdmin,
      deviceId,
      nonce,
    );
    if (result) return result;
  }
  return null;
}

app.post("/anonymous-sync/v2/register", async (c) => {
  try {
    const bodyResult = await readJsonBodyWithinLimit(c.req.raw);
    if (bodyResult.kind === "too_large") return c.json({ error: "request_too_large" }, 413);
    if (bodyResult.kind === "invalid_json") return c.json({ error: "invalid_json" }, 400);
    const rawBody = bodyResult.body;
    const parsedBody = RegisterRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json({ error: firstSchemaError(parsedBody.error) }, 400);
    }
    const apiMemberId = normalizeApiMemberId(parsedBody.data.api_member_id);
    if (!apiMemberId) {
      return c.json({ error: "api_member_id must be 1..=16 ASCII digits" }, 400);
    }
    const pubkey = normalizePubkey(parsedBody.data.device_pub);
    if (!pubkey) {
      return c.json({ error: "device_pub must be base64-encoded Ed25519 raw 32 bytes" }, 400);
    }

    const recovery = parsedBody.data.recovery;
    let recoveryDeviceId: string | null = null;
    let recoveryNonce: string | null = null;
    if (recovery) {
      recoveryDeviceId = normalizeUuidV4(recovery.device_id);
      recoveryNonce = recovery.nonce.trim().toLowerCase();
      if (!recoveryDeviceId) {
        return c.json({ error: "recovery.device_id must be a UUID v4" }, 400);
      }
      if (!/^[a-f0-9]{64}$/.test(recoveryNonce)) {
        return c.json({ error: "recovery.nonce malformed" }, 400);
      }
    }

    const base = resolveBaseConfig(c);
    if (!base.ok) {
      console.error("[anonymous-sync-v2/register] config invalid:", base.reason);
      return c.json({ error: "Server configuration error" }, 500);
    }
    const datasetSecret = resolveDatasetTokenSecret(c);
    if (!datasetSecret.ok) {
      console.error("[anonymous-sync-v2/register] dataset token secret invalid:", datasetSecret.reason);
      return c.json({ error: "Server configuration error" }, 500);
    }

    const supabaseAdmin = createClient(base.config.supabaseUrl, base.config.serviceRoleKey);
    const rateOk = await consumeRateLimit({
      supabaseAdmin,
      keys: [
        `register:ip:${requestClientKey(c)}`,
        `register:pubkey:${pubkey.base64}`,
        `register:member:${apiMemberId}`,
      ],
    });
    if (!rateOk) return c.json({ error: "Too many requests" }, 429);
    const publicId = await resolvePublicId(
      supabaseAdmin,
      recovery ? "rpc_get_registered_public_id" : "rpc_register_public_id",
      apiMemberId,
    );
    if (!publicId) return c.json({ error: "Failed to register public id" }, 500);

    let recoveryCanonicalUserId: string | null = null;
    if (recovery && recoveryDeviceId && recoveryNonce) {
      const challengeSecret = resolveChallengeSecret(c);
      if (!challengeSecret.ok) return c.json({ error: "Server configuration error" }, 500);

      const recoveryDeviceRaw = await supabaseAdmin
        .from("user_devices")
        .select("canonical_user_id, public_id, device_pubkey, revoked_at")
        .eq("device_id", recoveryDeviceId)
        .maybeSingle();
      if (recoveryDeviceRaw.error) return c.json({ error: "Database error" }, 500);
      if (!recoveryDeviceRaw.data) {
        return c.json({ error: "recovery_device_unknown" }, 401);
      }
      const recoveryDevice = UserDeviceRefreshRowSchema.safeParse(recoveryDeviceRaw.data);
      if (!recoveryDevice.success) return c.json({ error: "Database error" }, 500);
      if (recoveryDevice.data.revoked_at) {
        return c.json({ error: "device_revoked" }, 409);
      }
      if (recoveryDevice.data.public_id !== publicId) {
        return c.json({ error: "recovery_device_mismatch" }, 403);
      }

      const nonceValid = await verifyChallengeNonce(
        challengeSecret.secret,
        recoveryDeviceId,
        recoveryNonce,
      );
      if (!nonceValid) return c.json({ error: "nonce_invalid_or_expired" }, 401);

      const recoveryPublicKey = storedPubkeyToBase64(recoveryDevice.data.device_pubkey);
      if (!recoveryPublicKey) return c.json({ error: "Database error" }, 500);
      const signatureValid = await verifyDeviceSig({
        publicKeyB64: recoveryPublicKey,
        message: `register|${recoveryDeviceId}|${apiMemberId}|${recoveryNonce}`,
        signatureB64: recovery.sig,
      });
      if (!signatureValid) return c.json({ error: "signature_invalid" }, 401);

      const nonceConsume = await consumeDeviceNonce({
        supabaseAdmin,
        deviceId: recoveryDeviceId,
        nonce: recoveryNonce,
        context: "register",
      });
      if (!nonceConsume.ok) return c.json({ error: nonceConsume.error }, nonceConsume.status);
      recoveryCanonicalUserId = recoveryDevice.data.canonical_user_id;
    }

    const canonicalUserId = await ensureCanonicalUserForPublicId({
      supabaseAdmin,
      anonKey: base.config.anonKey,
      supabaseUrl: base.config.supabaseUrl,
      publicId,
    });
    if (!canonicalUserId) return c.json({ error: "Failed to create mapping" }, 500);
    if (recoveryCanonicalUserId && recoveryCanonicalUserId !== canonicalUserId) {
      return c.json({ error: "recovery_device_mismatch" }, 403);
    }

    const pubkeyHex = `\\x${Array.from(pubkey.raw)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
    const deviceRegistration = await supabaseAdmin.rpc("rpc_register_user_device", {
      p_public_id: publicId,
      p_device_pubkey_hex: pubkeyHex.slice(2),
    });
    if (deviceRegistration.error) {
      const message = (deviceRegistration.error as { message?: unknown }).message;
      if (typeof message === "string" && message.includes("device_revoked")) {
        return c.json({ error: "device_revoked" }, 409);
      }
      if (typeof message === "string" && message.includes("device_limit_reached")) {
        return c.json({ error: "device_limit_reached" }, 409);
      }
      console.error("[anonymous-sync-v2/register] device registration failed:", {
        code: getErrorCode(deviceRegistration.error),
        message,
      });
      return c.json({ error: "Failed to register device" }, 500);
    }
    const deviceId = normalizeUuidV4(deviceRegistration.data);
    if (!deviceId) return c.json({ error: "Failed to register device" }, 500);

    const now = Math.floor(Date.now() / 1000);
    const issued = await issueDatasetToken({
      secret: datasetSecret.secret,
      canonicalUserId,
      publicId,
      deviceId,
      now,
    });
    console.log(`[anonymous-sync-v2/register] ok public_id=${maskPublicId(publicId)} device=${deviceId}`);
    return c.json({
      device_id: deviceId,
      dataset_token: issued.token,
      dataset_token_expires_at: issued.expiresAt,
    });
  } catch (err) {
    console.error("[anonymous-sync-v2/register] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/anonymous-sync/v2/pending", async (c) => {
  try {
    const bodyResult = await readRequestBodyWithinLimit(c.req.raw);
    if (bodyResult.kind === "too_large") return c.json({ error: "request_too_large" }, 413);
    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const supabaseAdmin = createClient(base.config.supabaseUrl, base.config.serviceRoleKey);
    const rateOk = await consumeRateLimit({
      supabaseAdmin,
      keys: [`pending:ip:${requestClientKey(c)}`],
    });
    if (!rateOk) return c.json({ error: "Too many requests" }, 429);
    const cleanupResult = await supabaseAdmin
      .from("pending_member_syncs")
      .delete()
      .lt("expires_at", new Date().toISOString());
    if (cleanupResult.error) {
      console.warn("[anonymous-sync-v2/pending] expired row cleanup failed", {
        error: cleanupResult.error,
      });
    }
    const { error } = await supabaseAdmin.from("pending_member_syncs").insert({
      token,
      expires_at: expiresAt,
    });
    if (error) {
      console.error("[anonymous-sync-v2/pending] insert failed:", error);
      return c.json({ error: "Database error" }, 500);
    }
    setCookie(c, "sb-pending-sync-token", token, {
      path: "/",
      httpOnly: true,
      secure: import.meta.env.PROD,
      sameSite: "lax",
      maxAge: 5 * 60,
    });
    return c.json({ token, expires_at: expiresAt });
  } catch (err) {
    console.error("[anonymous-sync-v2/pending] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/anonymous-sync/v2/pending/:token", async (c) => {
  try {
    const token = normalizeUuidV4(c.req.param("token"));
    if (!token) return c.json({ error: "invalid_sync_token" }, 400);
    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);

    const supabaseAdmin = createClient(base.config.supabaseUrl, base.config.serviceRoleKey);
    const rateOk = await consumeRateLimit({
      supabaseAdmin,
      keys: [`pending-poll:ip:${requestClientKey(c)}`],
      limit: 180,
      windowSeconds: 5 * 60,
    });
    if (!rateOk) return c.json({ error: "Too many requests" }, 429);
    const { data, error } = await supabaseAdmin
      .from("pending_member_syncs")
      .select("public_id, expires_at, synced_at")
      .eq("token", token)
      .maybeSingle();
    if (error) return c.json({ error: "Database error" }, 500);
    if (!data) return c.json({ status: "expired" }, 410);
    if (new Date(data.expires_at).getTime() <= Date.now()) {
      await supabaseAdmin.from("pending_member_syncs").delete().eq("token", token);
      return c.json({ status: "expired" }, 410);
    }
    if (!data.public_id || !data.synced_at) return c.json({ status: "pending" });
    return c.json({ status: "completed", public_id: data.public_id });
  } catch (err) {
    console.error("[anonymous-sync-v2/pending/:token] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/anonymous-sync/v2/pending/:token/complete", async (c) => {
  try {
    const token = normalizeUuidV4(c.req.param("token"));
    if (!token) return c.json({ error: "invalid_sync_token" }, 400);
    const bodyResult = await readJsonBodyWithinLimit(c.req.raw);
    if (bodyResult.kind === "too_large") return c.json({ error: "request_too_large" }, 413);
    if (bodyResult.kind === "invalid_json") return c.json({ error: "invalid_json" }, 400);
    const rawBody = bodyResult.body;
    const parsedBody = PendingSyncCompleteRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) return c.json({ error: firstSchemaError(parsedBody.error) }, 400);

    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);
    const supabaseAdmin = createClient(base.config.supabaseUrl, base.config.serviceRoleKey);
    const rateOk = await consumeRateLimit({
      supabaseAdmin,
      keys: [`pending-complete:ip:${requestClientKey(c)}`],
    });
    if (!rateOk) return c.json({ error: "Too many requests" }, 429);
    const datasetSecret = resolveDatasetTokenSecret(c);
    if (!datasetSecret.ok) return c.json({ error: "Server configuration error" }, 500);
    const tokenValidation = await validateDatasetTokenWithConstraints({
      token: parsedBody.data.dataset_token,
      secret: datasetSecret.secret,
      revocation: {
        supabaseUrl: base.config.supabaseUrl,
        serviceRoleKey: base.config.serviceRoleKey,
      },
    });
    if (!tokenValidation.ok || !tokenValidation.token) {
      return c.json(
        { error: tokenValidation.error ?? "Invalid or expired dataset_token" },
        tokenValidation.status ?? 401,
      );
    }

    const { data, error } = await supabaseAdmin
      .from("pending_member_syncs")
      .update({
        public_id: tokenValidation.token.dataset_id,
        app_instance_id: parsedBody.data.app_instance_id,
        synced_at: new Date().toISOString(),
      })
      .eq("token", token)
      .is("synced_at", null)
      .is("public_id", null)
      .gt("expires_at", new Date().toISOString())
      .select("public_id, synced_at")
      .maybeSingle();
    if (error) return c.json({ error: "Database error" }, 500);
    if (!data) {
      const completed = await supabaseAdmin
        .from("pending_member_syncs")
        .select("public_id, expires_at, synced_at")
        .eq("token", token)
        .maybeSingle();
      if (completed.error) return c.json({ error: "Database error" }, 500);
      if (
        completed.data &&
        new Date(completed.data.expires_at).getTime() > Date.now() &&
        completed.data.synced_at &&
        completed.data.public_id === tokenValidation.token.dataset_id
      ) {
        return c.json({
          status: "completed",
          public_id: completed.data.public_id,
        });
      }
      return c.json({ error: "sync_expired_or_completed" }, 409);
    }
    return c.json({ status: "completed", public_id: data.public_id });
  } catch (err) {
    console.error("[anonymous-sync-v2/pending/:token/complete] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/anonymous-sync/v2/devices", async (c) => {
  try {
    const auth = extractAccessToken(c);
    if (!auth) return c.json({ error: "unauthorized" }, 401);
    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);
    const user = await verifySupabaseAccessToken({
      supabaseUrl: base.config.supabaseUrl,
      anonKey: base.config.anonKey,
      accessToken: auth.token,
    });
    if (!user) return c.json({ error: "invalid_token" }, 401);

    const includeRevokedQuery = c.req.query("include_revoked")?.toLowerCase();
    const includeRevoked =
      includeRevokedQuery === "1" || includeRevokedQuery === "true";
    const supabaseAdmin = createClient(
      base.config.supabaseUrl,
      base.config.serviceRoleKey,
    );
    const ownership = await resolvePublicIdsForUser({
      supabaseAdmin,
      userId: user.id,
    });
    if (ownership.publicIds.length === 0) {
      return c.json({ devices: [], include_revoked: includeRevoked });
    }
    let query = supabaseAdmin
      .from("user_devices")
      .select(
        "device_id, public_id, created_at, last_seen_at, revoked_at, revoked_reason",
      )
      .in("public_id", ownership.publicIds)
      .order("created_at", { ascending: false });
    if (!includeRevoked) query = query.is("revoked_at", null);
    const { data, error } = await query;
    if (error) return c.json({ error: "Database error" }, 500);
    const parsedDevices = UserDeviceListRowSchema.array().safeParse(data);
    if (!parsedDevices.success) return c.json({ error: "Database error" }, 500);
    return c.json({
      devices: parsedDevices.data.map((device) => ({
        device_id: device.device_id,
        public_id_masked: maskPublicId(device.public_id),
        created_at: device.created_at,
        last_seen_at: device.last_seen_at,
        revoked_at: device.revoked_at,
        revoked_reason: device.revoked_reason,
      })),
      include_revoked: includeRevoked,
    });
  } catch (err) {
    console.error("[anonymous-sync-v2/devices] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/anonymous-sync/v2/challenge", async (c) => {
  try {
    const deviceId = normalizeUuidV4(c.req.query("device_id"));
    if (!deviceId) return c.json({ error: "device_id must be a UUID v4" }, 400);
    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);
    const challengeSecret = resolveChallengeSecret(c);
    if (!challengeSecret.ok) return c.json({ error: "Server configuration error" }, 500);
    const supabaseAdmin = createClient(base.config.supabaseUrl, base.config.serviceRoleKey);
    const rateOk = await consumeRateLimit({
      supabaseAdmin,
      keys: [
        `challenge:ip:${requestClientKey(c)}`,
        `challenge:device:${deviceId}`,
      ],
    });
    if (!rateOk) return c.json({ error: "Too many requests" }, 429);
    const deviceRaw = await supabaseAdmin
      .from("user_devices")
      .select("device_id, revoked_at")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (deviceRaw.error) return c.json({ error: "Database error" }, 500);
    const parsedDevice = UserDeviceLookupRowSchema.safeParse(deviceRaw.data);
    if (!parsedDevice.success) {
      return c.json({ error: deviceRaw.data ? "Database error" : "device_unknown" }, deviceRaw.data ? 500 : 404);
    }
    if (parsedDevice.data.revoked_at) return c.json({ error: "device_revoked" }, 409);
    const { nonce, expiresAt } = await issueChallengeNonce(challengeSecret.secret, deviceId);
    return c.json({ nonce, expires_at: expiresAt, window_seconds: CHALLENGE_BUCKET_SECONDS });
  } catch (err) {
    console.error("[anonymous-sync-v2/challenge] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

type RefreshCachedResult = {
  status: "ok";
  device_id: string;
  dataset_token: string;
  dataset_token_expires_at: number;
};

function parseRefreshCachedResult(
  value: unknown,
  deviceId: string,
): RefreshCachedResult | null {
  if (value === null || typeof value !== "object") return null;
  const result = value as Partial<RefreshCachedResult>;
  if (
    result.status !== "ok" ||
    result.device_id !== deviceId ||
    typeof result.dataset_token !== "string" ||
    result.dataset_token.length === 0 ||
    !Number.isSafeInteger(result.dataset_token_expires_at)
  ) {
    return null;
  }
  return result as RefreshCachedResult;
}

async function readRefreshCachedResult(
  kv: NonNullable<Bindings["DATA_LOADER_CACHE_KV"]>,
  cacheKey: string,
  deviceId: string,
): Promise<RefreshCachedResult | null> {
  try {
    return parseRefreshCachedResult(
      await kv.get(cacheKey, { type: "json" }),
      deviceId,
    );
  } catch (error) {
    console.warn("[anonymous-sync-v2/refresh] cache read failed:", error);
    return null;
  }
}

async function waitForRefreshCachedResult(
  kv: NonNullable<Bindings["DATA_LOADER_CACHE_KV"]>,
  cacheKey: string,
  deviceId: string,
): Promise<RefreshCachedResult | null> {
  for (const delayMs of [0, 25, 75, 150]) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    const result = await readRefreshCachedResult(kv, cacheKey, deviceId);
    if (result) return result;
  }
  return null;
}

app.post("/anonymous-sync/v2/refresh", async (c) => {
  try {
    const bodyResult = await readJsonBodyWithinLimit(c.req.raw);
    if (bodyResult.kind === "too_large") return c.json({ error: "request_too_large" }, 413);
    if (bodyResult.kind === "invalid_json") return c.json({ error: "invalid_json" }, 400);
    const rawBody = bodyResult.body;
    const parsedBody = RefreshRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) return c.json({ error: firstSchemaError(parsedBody.error) }, 400);
    const body = parsedBody.data;
    const deviceId = normalizeUuidV4(body.device_id);
    const apiMemberId = normalizeApiMemberId(body.api_member_id);
    if (!deviceId) return c.json({ error: "device_id must be a UUID v4" }, 400);
    if (!apiMemberId) return c.json({ error: "api_member_id must be 1..=16 ASCII digits" }, 400);
    const nonce = body.nonce.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(nonce)) return c.json({ error: "nonce malformed" }, 400);

    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);
    const challengeSecret = resolveChallengeSecret(c);
    if (!challengeSecret.ok) return c.json({ error: "Server configuration error" }, 500);
    const datasetSecret = resolveDatasetTokenSecret(c);
    if (!datasetSecret.ok) return c.json({ error: "Server configuration error" }, 500);
    const supabaseAdmin = createClient(base.config.supabaseUrl, base.config.serviceRoleKey);
    const rateOk = await consumeRateLimit({
      supabaseAdmin,
      keys: [
        `refresh:ip:${requestClientKey(c)}`,
        `refresh:device:${deviceId}`,
      ],
    });
    if (!rateOk) return c.json({ error: "Too many requests" }, 429);
    const nonceValid = await verifyChallengeNonce(challengeSecret.secret, deviceId, nonce);
    if (!nonceValid) return c.json({ error: "nonce_invalid_or_expired" }, 401);

    const deviceRaw = await supabaseAdmin
      .from("user_devices")
      .select("canonical_user_id, public_id, device_pubkey, revoked_at")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (deviceRaw.error) return c.json({ error: "Database error" }, 500);
    if (!deviceRaw.data) return c.json({ error: "device_unknown_or_revoked" }, 404);
    const parsedDevice = UserDeviceRefreshRowSchema.safeParse(deviceRaw.data);
    if (!parsedDevice.success) return c.json({ error: "Database error" }, 500);
    const device = parsedDevice.data;
    if (device.revoked_at) return c.json({ error: "device_revoked" }, 409);

    const publicKeyB64 = storedPubkeyToBase64(device.device_pubkey);
    if (!publicKeyB64) return c.json({ error: "Internal server error" }, 500);
    const signatureValid = await verifyDeviceSig({
      publicKeyB64,
      message: nonce,
      signatureB64: body.sig,
    });
    if (!signatureValid) return c.json({ error: "signature_invalid" }, 401);

    const publicId = await resolvePublicId(
      supabaseAdmin,
      "rpc_get_registered_public_id",
      apiMemberId,
    );
    if (!publicId || publicId !== device.public_id) {
      return c.json({ error: "public_id_mismatch" }, 401);
    }

    const kv = c.env.DATA_LOADER_CACHE_KV;
    const cacheKey = `refresh-result:${deviceId}:${nonce}`;
    if (kv) {
      const cached = await readRefreshCachedResult(kv, cacheKey, deviceId);
      if (cached) {
        return c.json(cached);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const issued = await issueDatasetToken({
      secret: datasetSecret.secret,
      canonicalUserId: device.canonical_user_id,
      publicId,
      deviceId,
      now,
    });
    const result: RefreshCachedResult = {
      status: "ok",
      device_id: deviceId,
      dataset_token: issued.token,
      dataset_token_expires_at: issued.expiresAt,
    };

    const nonceConsume = await consumeDeviceNonce({
      supabaseAdmin,
      deviceId,
      nonce,
      context: "refresh",
      refreshResult: {
        token: result.dataset_token,
        expiresAt: result.dataset_token_expires_at,
      },
    });
    if (!nonceConsume.ok) {
      if (nonceConsume.error === "nonce_already_used") {
        const databaseResult = await waitForRefreshResultFromDatabase(
          supabaseAdmin,
          deviceId,
          nonce,
        );
        if (databaseResult) return c.json(databaseResult);
        if (kv) {
          const cached = await waitForRefreshCachedResult(kv, cacheKey, deviceId);
          if (cached) return c.json(cached);
        }
      }
      return c.json({ error: nonceConsume.error }, nonceConsume.status);
    }

    await supabaseAdmin
      .from("user_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("device_id", deviceId);

    if (kv) {
      try {
        await kv.put(cacheKey, JSON.stringify(result), {
          expirationTtl: REFRESH_RESULT_TTL_SECONDS,
        });
      } catch (error) {
        console.warn("[anonymous-sync-v2/refresh] cache write failed:", error);
      }
    }
    console.log(`[anonymous-sync-v2/refresh] ok device=${deviceId} public_id=${maskPublicId(publicId)}`);
    return c.json(result);
  } catch (err) {
    console.error("[anonymous-sync-v2/refresh] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/anonymous-sync/v2/revoke", async (c) => {
  try {
    const bodyResult = await readJsonBodyWithinLimit(c.req.raw);
    if (bodyResult.kind === "too_large") return c.json({ error: "request_too_large" }, 413);
    if (bodyResult.kind === "invalid_json") return c.json({ error: "invalid_json" }, 400);
    const parsedBody = RevokeRequestSchema.safeParse(bodyResult.body);
    if (!parsedBody.success) return c.json({ error: firstSchemaError(parsedBody.error) }, 400);
    const body = parsedBody.data;
    const deviceId = normalizeUuidV4(body.device_id);
    const targetDeviceId = normalizeUuidV4(body.target_device_id);
    if (!deviceId || !targetDeviceId) {
      return c.json({ error: "device_id and target_device_id must be UUID v4" }, 400);
    }
    const nonce = body.nonce.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(nonce)) return c.json({ error: "nonce malformed" }, 400);

    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);
    const challengeSecret = resolveChallengeSecret(c);
    if (!challengeSecret.ok) return c.json({ error: "Server configuration error" }, 500);
    const supabaseAdmin = createClient(
      base.config.supabaseUrl,
      base.config.serviceRoleKey,
    );
    const rateOk = await consumeRateLimit({
      supabaseAdmin,
      keys: [
        `revoke:ip:${requestClientKey(c)}`,
        `revoke:device:${deviceId}`,
      ],
    });
    if (!rateOk) return c.json({ error: "Too many requests" }, 429);

    const nonceValid = await verifyChallengeNonce(
      challengeSecret.secret,
      deviceId,
      nonce,
    );
    if (!nonceValid) return c.json({ error: "nonce_invalid_or_expired" }, 401);

    const callerRaw = await supabaseAdmin
      .from("user_devices")
      .select("canonical_user_id, public_id, device_pubkey, revoked_at")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (callerRaw.error) return c.json({ error: "Database error" }, 500);
    if (!callerRaw.data) return c.json({ error: "device_unknown_or_revoked" }, 404);
    const callerParsed = UserDeviceRefreshRowSchema.safeParse(callerRaw.data);
    if (!callerParsed.success || callerParsed.data.revoked_at) {
      return c.json({ error: "device_unknown_or_revoked" }, 404);
    }

    const publicKeyB64 = storedPubkeyToBase64(callerParsed.data.device_pubkey);
    if (!publicKeyB64) return c.json({ error: "Internal server error" }, 500);
    const signatureValid = await verifyDeviceSig({
      publicKeyB64,
      message: `revoke|${deviceId}|${targetDeviceId}|${nonce}`,
      signatureB64: body.sig,
    });
    if (!signatureValid) return c.json({ error: "signature_invalid" }, 401);

    const nonceConsume = await consumeDeviceNonce({
      supabaseAdmin,
      deviceId,
      nonce,
      context: "revoke",
    });
    if (!nonceConsume.ok) return c.json({ error: nonceConsume.error }, nonceConsume.status);

    const targetRaw = await supabaseAdmin
      .from("user_devices")
      .select("canonical_user_id, revoked_at")
      .eq("device_id", targetDeviceId)
      .maybeSingle();
    if (targetRaw.error) return c.json({ error: "Database error" }, 500);
    if (!targetRaw.data) return c.json({ error: "target_unknown" }, 404);
    const targetParsed = UserDeviceRevokeTargetRowSchema.safeParse(targetRaw.data);
    if (!targetParsed.success) return c.json({ error: "Database error" }, 500);
    if (targetParsed.data.canonical_user_id !== callerParsed.data.canonical_user_id) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (targetParsed.data.revoked_at) return new Response(null, { status: 204 });

    const updateResult = await supabaseAdmin
      .from("user_devices")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: body.reason?.trim().slice(0, 200) || "user_revoke",
      })
      .eq("device_id", targetDeviceId)
      .eq("canonical_user_id", callerParsed.data.canonical_user_id)
      .is("revoked_at", null);
    if (updateResult.error) return c.json({ error: "Failed to revoke device" }, 500);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[anonymous-sync-v2/revoke] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.delete("/anonymous-sync/v2/devices/:deviceId", async (c) => {
  try {
    const auth = extractAccessToken(c);
    if (!auth) return c.json({ error: "unauthorized" }, 401);
    if (!assertCsrfSafe(c, auth.fromCookie)) return c.json({ error: "forbidden" }, 403);
    const deviceId = normalizeUuidV4(c.req.param("deviceId"));
    if (!deviceId) return c.json({ error: "device_id must be a UUID v4" }, 400);

    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);
    const user = await verifySupabaseAccessToken({
      supabaseUrl: base.config.supabaseUrl,
      anonKey: base.config.anonKey,
      accessToken: auth.token,
    });
    if (!user) return c.json({ error: "invalid_token" }, 401);

    const supabaseAdmin = createClient(
      base.config.supabaseUrl,
      base.config.serviceRoleKey,
    );
    const ownership = await resolvePublicIdsForUser({
      supabaseAdmin,
      userId: user.id,
    });
    const targetRaw = await supabaseAdmin
      .from("user_devices")
      .select("public_id, revoked_at")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (targetRaw.error) return c.json({ error: "Database error" }, 500);
    if (!targetRaw.data) return c.json({ error: "not_found" }, 404);
    const targetParsed = UserDeviceWebRevokeTargetRowSchema.safeParse(targetRaw.data);
    if (!targetParsed.success || !ownership.publicIds.includes(targetParsed.data.public_id)) {
      return c.json({ error: "not_found" }, 404);
    }
    if (targetParsed.data.revoked_at) return new Response(null, { status: 204 });

    const reason = c.req.query("reason")?.trim().slice(0, 200) || "user_revoke_from_web";
    const updateResult = await supabaseAdmin
      .from("user_devices")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq("device_id", deviceId)
      .in("public_id", ownership.publicIds)
      .is("revoked_at", null);
    if (updateResult.error) return c.json({ error: "Failed to revoke device" }, 500);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[anonymous-sync-v2/devices/:id] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default app;
