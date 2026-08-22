import { Hono } from "hono";
import type { KVNamespace } from "@cloudflare/workers-types";
import { SignJWT } from "jose";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  firstSchemaError,
  RefreshRequestSchema,
  RegisterRequestSchema,
  RevokeRequestSchema,
  UserMemberMapRowSchema,
  UserDeviceInsertRowSchema,
  UserDeviceLookupRowSchema,
  UserDeviceListRowSchema,
  UserDeviceRefreshRowSchema,
  UserDeviceRevokeTargetRowSchema,
  SupabaseAccessTokenUserSchema,
} from "../schemas/anonymous-sync-v2";
import { createEnvContext, getEnv, resolveSupabaseConfig } from "../utils";
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
const NONCE_CLEANUP_RETENTION_MS = 30 * 60 * 1000;
const NONCE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const API_MEMBER_ID_PATTERN = /^[0-9]{1,16}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let lastNonceCleanupAt = 0;

type RateLimitContext = {
  kv?: KVNamespace;
  key: string;
};

async function consumeRateLimit(ctx: RateLimitContext): Promise<boolean> {
  if (!ctx.kv) return true;
  const rateKey = `anon-sync-v2-rate:${ctx.key}`;
  const raw = await ctx.kv.get(rateKey);
  const parsed = raw ? parseInt(raw, 10) : 0;
  const current = Number.isNaN(parsed) ? 0 : parsed;
  if (current >= RATE_LIMIT_PER_HOUR) return false;
  await ctx.kv.put(rateKey, String(current + 1), { expirationTtl: 3600 });
  return true;
}

function maskPublicId(publicId: string): string {
  return `${publicId.substring(0, 8)}...`;
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

function extractAccessToken(c: {
  req: { header: (name: string) => string | undefined };
}): string | null {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim();

  const cookieHeader = c.req.header("Cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    /(?:^|;\s*)(?:sb-access-token|__Secure-sb-access-token)=([^;]+)/,
  );
  if (!match?.[1]) return null;
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
    const parsedUser = SupabaseAccessTokenUserSchema.safeParse(
      await response.json(),
    );
    if (!parsedUser.success) return null;
    return {
      id: parsedUser.data.id,
      ...(typeof parsedUser.data.email === "string"
        ? { email: parsedUser.data.email }
        : {}),
    };
  } catch (err) {
    console.warn("[anonymous-sync-v2] verifySupabaseAccessToken failed:", err);
    return null;
  }
}

async function issueDatasetToken(options: {
  secret: string;
  canonicalUserId: string;
  publicId: string;
  now: number;
}): Promise<{ token: string; expiresAt: number }> {
  const secretKey = new TextEncoder().encode(options.secret);
  const expiresAt = options.now + DATASET_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({
    sub: options.canonicalUserId,
    dataset_id: options.publicId,
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
    console.error("[anonymous-sync-v2/register] public_id owner lookup failed:", existing.error);
    return null;
  }
  if (existing.data) {
    const parsed = UserMemberMapRowSchema.safeParse(existing.data);
    if (!parsed.success) {
      console.error("[anonymous-sync-v2/register] public_id owner shape invalid:", parsed.error);
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
    console.error("[anonymous-sync-v2/register] public_id owner insert failed:", inserted.error);
    return null;
  }

  const winner = await options.supabaseAdmin
    .from("user_member_map")
    .select("user_id, public_id")
    .eq("public_id", options.publicId)
    .maybeSingle();
  if (winner.error || !winner.data) {
    console.error("[anonymous-sync-v2/register] public_id owner race recovery failed:", winner.error);
    return null;
  }
  const parsedWinner = UserMemberMapRowSchema.safeParse(winner.data);
  return parsedWinner.success ? parsedWinner.data.user_id : null;
}

async function consumeDeviceNonce(options: {
  supabaseAdmin: SupabaseClient;
  deviceId: string;
  nonce: string;
  context: "refresh" | "revoke";
}): Promise<{ ok: true } | { ok: false; status: 401 | 500; error: string }> {
  const nowMs = Date.now();
  const nonceInsert = await options.supabaseAdmin
    .from("anon_sync_nonce_consumptions")
    .insert({ device_id: options.deviceId, nonce: options.nonce });

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

app.post("/anonymous-sync/v2/register", async (c) => {
  try {
    const rawBody = await c.req.json().catch(() => null);
    if (rawBody === null) return c.json({ error: "invalid_json" }, 400);
    const parsedBody = RegisterRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json({ error: firstSchemaError(parsedBody.error) }, 400);
    }

    const apiMemberId = normalizeApiMemberId(parsedBody.data.api_member_id);
    if (!apiMemberId) {
      return c.json({ error: "api_member_id must be a positive integer (string or number)" }, 400);
    }
    const pubkey = normalizePubkey(parsedBody.data.device_pub);
    if (!pubkey) {
      return c.json({ error: "device_pub must be base64-encoded Ed25519 raw 32 bytes" }, 400);
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

    const rateOk = await consumeRateLimit({
      ...(c.env.DATA_LOADER_CACHE_KV === undefined ? {} : { kv: c.env.DATA_LOADER_CACHE_KV }),
      key: pubkey.base64,
    });
    if (!rateOk) return c.json({ error: "Too many requests" }, 429);

    const supabaseAdmin = createClient(base.config.supabaseUrl, base.config.serviceRoleKey);
    const publicId = await resolvePublicId(
      supabaseAdmin,
      "rpc_register_public_id",
      apiMemberId,
    );
    if (!publicId) return c.json({ error: "Failed to register public id" }, 500);

    const canonicalUserId = await ensureCanonicalUserForPublicId({
      supabaseAdmin,
      anonKey: base.config.anonKey,
      supabaseUrl: base.config.supabaseUrl,
      publicId,
    });
    if (!canonicalUserId) return c.json({ error: "Failed to create mapping" }, 500);

    const pubkeyHex = `\\x${Array.from(pubkey.raw)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
    const existingDeviceRaw = await supabaseAdmin
      .from("user_devices")
      .select("device_id, revoked_at")
      .eq("public_id", publicId)
      .eq("device_pubkey", pubkeyHex)
      .maybeSingle();
    if (existingDeviceRaw.error) {
      console.error("[anonymous-sync-v2/register] device lookup failed:", existingDeviceRaw.error);
      return c.json({ error: "Database error" }, 500);
    }

    let deviceId: string | null = null;
    if (existingDeviceRaw.data) {
      const parsedDevice = UserDeviceLookupRowSchema.safeParse(existingDeviceRaw.data);
      if (!parsedDevice.success) return c.json({ error: "Database error" }, 500);
      if (parsedDevice.data.revoked_at) return c.json({ error: "device_revoked" }, 409);
      deviceId = normalizeUuidV4(parsedDevice.data.device_id);
      if (!deviceId) return c.json({ error: "Database error" }, 500);
      await supabaseAdmin
        .from("user_devices")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("device_id", deviceId);
    } else {
      const inserted = await supabaseAdmin
        .from("user_devices")
        .insert({
          canonical_user_id: canonicalUserId,
          public_id: publicId,
          device_pubkey: pubkeyHex,
        })
        .select("device_id")
        .single();
      if (!inserted.error) {
        const parsedInserted = UserDeviceInsertRowSchema.safeParse(inserted.data);
        deviceId = parsedInserted.success ? normalizeUuidV4(parsedInserted.data.device_id) : null;
      } else if (getErrorCode(inserted.error) === "23505") {
        const winner = await supabaseAdmin
          .from("user_devices")
          .select("device_id, revoked_at")
          .eq("public_id", publicId)
          .eq("device_pubkey", pubkeyHex)
          .maybeSingle();
        const parsedWinner = UserDeviceLookupRowSchema.safeParse(winner.data);
        if (winner.error || !parsedWinner.success || parsedWinner.data.revoked_at) {
          return c.json({ error: parsedWinner.success && parsedWinner.data.revoked_at ? "device_revoked" : "Failed to register device" }, parsedWinner.success && parsedWinner.data.revoked_at ? 409 : 500);
        }
        deviceId = normalizeUuidV4(parsedWinner.data.device_id);
      } else {
        console.error("[anonymous-sync-v2/register] device insert failed:", inserted.error);
        return c.json({ error: "Failed to register device" }, 500);
      }
      if (!deviceId) return c.json({ error: "Failed to register device" }, 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const issued = await issueDatasetToken({
      secret: datasetSecret.secret,
      canonicalUserId,
      publicId,
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

app.get("/anonymous-sync/v2/devices", async (c) => {
  try {
    const accessToken = extractAccessToken(c);
    if (!accessToken) return c.json({ error: "unauthorized" }, 401);
    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);
    const user = await verifySupabaseAccessToken({
      supabaseUrl: base.config.supabaseUrl,
      anonKey: base.config.anonKey,
      accessToken,
    });
    if (!user) return c.json({ error: "invalid_token" }, 401);

    const includeRevokedQuery = c.req.query("include_revoked")?.toLowerCase();
    const includeRevoked = includeRevokedQuery === "1" || includeRevokedQuery === "true";
    const supabaseAdmin = createClient(base.config.supabaseUrl, base.config.serviceRoleKey);
    let query = supabaseAdmin
      .from("user_devices")
      .select("device_id, public_id, created_at, last_seen_at, revoked_at, revoked_reason")
      .eq("canonical_user_id", user.id)
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

app.post("/anonymous-sync/v2/refresh", async (c) => {
  try {
    const rawBody = await c.req.json().catch(() => null);
    if (rawBody === null) return c.json({ error: "invalid_json" }, 400);
    const parsedBody = RefreshRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) return c.json({ error: firstSchemaError(parsedBody.error) }, 400);
    const body = parsedBody.data;
    const deviceId = normalizeUuidV4(body.device_id);
    const apiMemberId = normalizeApiMemberId(body.api_member_id);
    if (!deviceId) return c.json({ error: "device_id must be a UUID v4" }, 400);
    if (!apiMemberId) return c.json({ error: "api_member_id must be a positive integer (string or number)" }, 400);
    const nonce = body.nonce.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(nonce)) return c.json({ error: "nonce malformed" }, 400);

    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);
    const challengeSecret = resolveChallengeSecret(c);
    if (!challengeSecret.ok) return c.json({ error: "Server configuration error" }, 500);
    const datasetSecret = resolveDatasetTokenSecret(c);
    if (!datasetSecret.ok) return c.json({ error: "Server configuration error" }, 500);
    const nonceValid = await verifyChallengeNonce(challengeSecret.secret, deviceId, nonce);
    if (!nonceValid) return c.json({ error: "nonce_invalid_or_expired" }, 401);

    const supabaseAdmin = createClient(base.config.supabaseUrl, base.config.serviceRoleKey);
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
    if (device.revoked_at) return c.json({ error: "device_unknown_or_revoked" }, 404);

    const hexBody = device.device_pubkey.startsWith("\\x")
      ? device.device_pubkey.slice(2)
      : device.device_pubkey;
    if (hexBody.length !== 64 || !/^[0-9a-fA-F]+$/.test(hexBody)) {
      return c.json({ error: "Internal server error" }, 500);
    }
    const publicKeyBytes = new Uint8Array(32);
    for (let index = 0; index < 32; index++) {
      publicKeyBytes[index] = parseInt(hexBody.slice(index * 2, index * 2 + 2), 16);
    }
    const signatureValid = await verifyDeviceSig({
      publicKeyB64: encodeBytesToBase64(publicKeyBytes),
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
      const cached = await kv.get(cacheKey, { type: "json" });
      if (cached && typeof cached === "object") {
        const result = cached as Partial<RefreshCachedResult>;
        if (
          result.status === "ok" &&
          result.device_id === deviceId &&
          typeof result.dataset_token === "string" &&
          typeof result.dataset_token_expires_at === "number"
        ) {
          return c.json(result as RefreshCachedResult);
        }
      }
    }

    const nonceConsume = await consumeDeviceNonce({
      supabaseAdmin,
      deviceId,
      nonce,
      context: "refresh",
    });
    if (!nonceConsume.ok) return c.json({ error: nonceConsume.error }, nonceConsume.status);

    await supabaseAdmin
      .from("user_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("device_id", deviceId);

    const now = Math.floor(Date.now() / 1000);
    const issued = await issueDatasetToken({
      secret: datasetSecret.secret,
      canonicalUserId: device.canonical_user_id,
      publicId,
      now,
    });
    const result: RefreshCachedResult = {
      status: "ok",
      device_id: deviceId,
      dataset_token: issued.token,
      dataset_token_expires_at: issued.expiresAt,
    };
    if (kv) {
      await kv.put(cacheKey, JSON.stringify(result), {
        expirationTtl: REFRESH_RESULT_TTL_SECONDS,
      });
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
    const rawBody = await c.req.json().catch(() => null);
    if (rawBody === null) return c.json({ error: "invalid_json" }, 400);
    const parsedBody = RevokeRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) return c.json({ error: firstSchemaError(parsedBody.error) }, 400);
    const body = parsedBody.data;
    const deviceId = normalizeUuidV4(body.device_id);
    const targetDeviceId = normalizeUuidV4(body.target_device_id);
    if (!deviceId || !targetDeviceId) return c.json({ error: "device_id and target_device_id must be UUID v4" }, 400);
    const nonce = body.nonce.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(nonce)) return c.json({ error: "nonce malformed" }, 400);

    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);
    const challengeSecret = resolveChallengeSecret(c);
    if (!challengeSecret.ok) return c.json({ error: "Server configuration error" }, 500);
    const nonceValid = await verifyChallengeNonce(challengeSecret.secret, deviceId, nonce);
    if (!nonceValid) return c.json({ error: "nonce_invalid_or_expired" }, 401);
    const supabaseAdmin = createClient(base.config.supabaseUrl, base.config.serviceRoleKey);
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
    const caller = callerParsed.data;
    const hexBody = caller.device_pubkey.startsWith("\\x")
      ? caller.device_pubkey.slice(2)
      : caller.device_pubkey;
    if (hexBody.length !== 64 || !/^[0-9a-fA-F]+$/.test(hexBody)) return c.json({ error: "Internal server error" }, 500);
    const publicKeyBytes = new Uint8Array(32);
    for (let index = 0; index < 32; index++) {
      publicKeyBytes[index] = parseInt(hexBody.slice(index * 2, index * 2 + 2), 16);
    }
    const signatureValid = await verifyDeviceSig({
      publicKeyB64: encodeBytesToBase64(publicKeyBytes),
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
    if (targetParsed.data.canonical_user_id !== caller.canonical_user_id) return c.json({ error: "forbidden" }, 403);
    if (targetParsed.data.revoked_at) return new Response(null, { status: 204 });
    const { error: updateError } = await supabaseAdmin
      .from("user_devices")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: body.reason?.trim().slice(0, 200) || "user_revoke",
      })
      .eq("device_id", targetDeviceId);
    if (updateError) return c.json({ error: "Failed to revoke device" }, 500);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[anonymous-sync-v2/revoke] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.delete("/anonymous-sync/v2/devices/:deviceId", async (c) => {
  try {
    const accessToken = extractAccessToken(c);
    if (!accessToken) return c.json({ error: "unauthorized" }, 401);
    const hasCookieAuth = !c.req.header("Authorization")?.startsWith("Bearer ");
    if (!assertCsrfSafe(c, hasCookieAuth)) return c.json({ error: "forbidden" }, 403);
    const deviceId = normalizeUuidV4(c.req.param("deviceId"));
    if (!deviceId) return c.json({ error: "device_id must be a UUID v4" }, 400);
    const base = resolveBaseConfig(c);
    if (!base.ok) return c.json({ error: "Server configuration error" }, 500);
    const user = await verifySupabaseAccessToken({
      supabaseUrl: base.config.supabaseUrl,
      anonKey: base.config.anonKey,
      accessToken,
    });
    if (!user) return c.json({ error: "invalid_token" }, 401);
    const supabaseAdmin = createClient(base.config.supabaseUrl, base.config.serviceRoleKey);
    const targetRaw = await supabaseAdmin
      .from("user_devices")
      .select("canonical_user_id, revoked_at")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (targetRaw.error) return c.json({ error: "Database error" }, 500);
    if (!targetRaw.data) return c.json({ error: "not_found" }, 404);
    const targetParsed = UserDeviceRevokeTargetRowSchema.safeParse(targetRaw.data);
    if (!targetParsed.success || targetParsed.data.canonical_user_id !== user.id) {
      return c.json({ error: "not_found" }, 404);
    }
    if (targetParsed.data.revoked_at) return new Response(null, { status: 204 });
    const reason = c.req.query("reason")?.trim().slice(0, 200) || "user_revoke_from_web";
    const { error: updateError } = await supabaseAdmin
      .from("user_devices")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq("device_id", deviceId)
      .eq("canonical_user_id", user.id);
    if (updateError) return c.json({ error: "Failed to revoke device" }, 500);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[anonymous-sync-v2/devices/:id] unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default app;
