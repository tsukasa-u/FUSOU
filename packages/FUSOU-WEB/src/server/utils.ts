import { jwtVerify, createRemoteJWKSet } from "jose";
import { DEFAULT_ALLOWED_EXTENSIONS } from "./constants";
import type { Bindings } from "./types";

// ========================
// 環境変数取得
// ========================

/**
 * 署名付きトークンを生成
 */
export async function generateSignedToken(
  payload: Record<string, any>,
  secret: string,
  expiresInSeconds: number
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(
    JSON.stringify({ ...payload, exp: Date.now() + expiresInSeconds * 1000 })
  );
  const keyData = encoder.encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, data);
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${btoa(JSON.stringify(payload))}.${sigHex}`;
}

/**
 * 署名付きトークンを検証
 */
export async function verifySignedToken(
  token: string,
  secret: string
): Promise<Record<string, any> | null> {
  try {
    const [payloadB64, sigHex] = token.split(".");
    if (!payloadB64 || !sigHex) return null;

    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && Date.now() > payload.exp) return null;

    const encoder = new TextEncoder();
    const data = encoder.encode(
      JSON.stringify({ ...payload, exp: payload.exp })
    );
    const keyData = encoder.encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigBytes = new Uint8Array(
      sigHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );
    const valid = await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, data);

    return valid ? payload : null;
  } catch {
    return null;
  }
}

/**
 * 環境変数を取得（暗号化対応）
 * runtimeEnv -> process.env -> import.meta.env の優先順位
 */
export function getEnvValue(
  key: string,
  runtimeEnv: Record<string, any> = {}
): string | undefined {
  // ランタイム環境変数が暗号化されていない場合はそれを使用
  if (runtimeEnv[key] && !String(runtimeEnv[key]).startsWith("encrypted:")) {
    return runtimeEnv[key];
  }

  // 開発モードでは process.env を優先（dotenvxで復号化済み）
  const isDev = import.meta.env.DEV;
  if (isDev && typeof process !== "undefined" && (process.env as any)[key]) {
    return (process.env as any)[key];
  }

  // import.meta.env が暗号化されている場合は process.env にフォールバック
  const metaEnvVal = (import.meta.env as any)[key];
  if (
    metaEnvVal &&
    typeof metaEnvVal === "string" &&
    metaEnvVal.startsWith("encrypted:")
  ) {
    if (typeof process !== "undefined" && (process.env as any)[key]) {
      return (process.env as any)[key];
    }
  }
  return metaEnvVal;
}

export type SupabaseConfig = {
  url: string | null;
  serviceRoleKey: string | null;
  publishableKey: string | null;
};

export function resolveSupabaseConfig(
  runtimeEnv: Record<string, any> = {}
): SupabaseConfig {
  const url =
    getEnvValue("PUBLIC_SUPABASE_URL", runtimeEnv)?.replace(/\/$/, "") ?? null;
  const serviceRoleKey = getEnvValue("SUPABASE_SECRET_KEY", runtimeEnv) ?? null;
  const publishableKey =
    getEnvValue("PUBLIC_SUPABASE_PUBLISHABLE_KEY", runtimeEnv) ?? null;

  return { url, serviceRoleKey, publishableKey };
}

/**
 * Cloudflare runtime環境変数からBindingsオブジェクトを構築
 */
export function injectEnv(locals: any): Bindings {
  const runtimeEnv = locals?.runtime?.env || {};

  return {
    ASSET_SYNC_BUCKET: runtimeEnv.ASSET_SYNC_BUCKET!,
    ASSET_INDEX_DB: runtimeEnv.ASSET_INDEX_DB!,
    ASSET_PAYLOAD_BUCKET: runtimeEnv.ASSET_PAYLOAD_BUCKET!,
    // Prefer Cloudflare runtime env, fallback to build-time env
    PUBLIC_SUPABASE_URL:
      runtimeEnv.PUBLIC_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL!,
    SUPABASE_SECRET_KEY:
      runtimeEnv.SUPABASE_SECRET_KEY || import.meta.env.SUPABASE_SECRET_KEY!,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      runtimeEnv.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    ASSET_SYNC_ALLOWED_EXTENSIONS:
      runtimeEnv.ASSET_SYNC_ALLOWED_EXTENSIONS ||
      import.meta.env.ASSET_SYNC_ALLOWED_EXTENSIONS!,
    ASSET_UPLOAD_SIGNING_SECRET:
      runtimeEnv.ASSET_UPLOAD_SIGNING_SECRET ||
      import.meta.env.ASSET_UPLOAD_SIGNING_SECRET!,
    FLEET_SNAPSHOT_SIGNING_SECRET:
      runtimeEnv.FLEET_SNAPSHOT_SIGNING_SECRET ||
      import.meta.env.FLEET_SNAPSHOT_SIGNING_SECRET!,
    ADMIN_API_SECRET:
      runtimeEnv.ADMIN_API_SECRET || import.meta.env.ADMIN_API_SECRET!,
  };
}

// ========================
// ヘルパー関数
// ========================

/**
 * Authorization ヘッダーから Bearer トークンを抽出
 */
export function extractBearer(
  header: string | null | undefined
): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!rest.length || scheme.toLowerCase() !== "bearer") return null;
  return rest.join(" ");
}

/**
 * タイミングセーフな文字列比較
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const maxLen = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < maxLen; i += 1) {
    const aByte = aBytes[i] ?? 0;
    const bByte = bBytes[i] ?? 0;
    diff |= aByte ^ bByte;
  }
  return diff === 0;
}

/**
 * ファイル名から拡張子を抽出
 */
export function extractExtension(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const last = normalized.lastIndexOf(".");
  if (last === -1 || last === normalized.length - 1) return null;
  return normalized.substring(last + 1);
}

/**
 * 許可された拡張子リストを解決
 */
export function resolveAllowedExtensions(
  ...sources: (string | undefined)[]
): Set<string> {
  for (const source of sources) {
    const entries = parseList(source);
    if (entries.length > 0) return new Set(entries);
  }
  return new Set(DEFAULT_ALLOWED_EXTENSIONS);
}

/**
 * カンマ区切りリストをパース
 */
export function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^[.]+/, ""))
    .filter((item) => item.length > 0);
}

/**
 * オブジェクトキーをサニタイズ（パストラバーサル対策）
 */
export function sanitizeKey(input: string | null): string | null {
  if (!input) return null;
  const normalized = input.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  return normalized;
}

/**
 * ファイル名をサニタイズ
 */
export function sanitizeFileName(input: string | null): string | null {
  if (!input) return null;
  const normalized = input.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const candidate = parts[parts.length - 1]?.trim();
  if (!candidate) return null;
  return candidate.replace(/[\0-\x1F]/g, "");
}

/**
 * JWT トークンを検証し、ユーザー情報を返す
 */
// ========================
// JWKS-based JWT validation (Supabase)
// ========================

// Cache RemoteJWKSet globally to leverage Cloudflare Workers hot-instance caching.
const { url: SUPABASE_URL } = resolveSupabaseConfig();

// Log SUPABASE_URL for debugging (only in development)
if (import.meta.env.DEV) {
  console.log(`[JWKS Init] SUPABASE_URL: ${SUPABASE_URL || "<not set>"}`);
  console.log(
    `[JWKS Init] JWKS URL: ${
      SUPABASE_URL
        ? `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
        : "<not available>"
    }`
  );
}

// Create RemoteJWKSet for ES256/RS256 tokens (asymmetric signing keys)
// https://supabase.com/docs/guides/auth/jwts
const JWKS = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  : undefined;

export async function validateJWT(token: string): Promise<{
  id?: string;
  email?: string;
  payload?: Record<string, any>;
} | null> {
  try {
    if (!SUPABASE_URL || !JWKS) {
      console.error(
        "validateJWT: PUBLIC_SUPABASE_URL not configured or JWKS not initialized"
      );
      return null;
    }

    const tokenPreview =
      token.length > 20
        ? `${token.substring(0, 10)}...${token.substring(token.length - 10)}`
        : "<short-token>";

    // Decode JWT header to check algorithm (for debugging)
    try {
      const headerB64 = token.split(".")[0];
      const headerJson = JSON.parse(atob(headerB64));
      console.log(`validateJWT: JWT header:`, headerJson);

      // Warn if still using legacy HS256
      if (headerJson.alg === "HS256") {
        console.warn(
          "validateJWT: WARNING - Token is still using legacy HS256 algorithm"
        );
        console.warn(
          "validateJWT: Please rotate JWT signing keys in Supabase dashboard to ES256"
        );
        return null;
      }
    } catch (e) {
      console.error(`validateJWT: failed to decode JWT header:`, e);
    }

    console.log(
      `validateJWT: attempting to verify token (preview: ${tokenPreview})`
    );
    console.log(
      `validateJWT: issuer=${SUPABASE_URL}/auth/v1, audience=authenticated`
    );
    console.log(
      `validateJWT: JWKS endpoint: ${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
    );

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: "authenticated",
    });

    console.log(
      `validateJWT: verification successful, sub=${payload.sub}, email=${payload.email}, exp=${payload.exp}`
    );

    return {
      id: typeof payload.sub === "string" ? payload.sub : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      payload: payload as Record<string, any>,
    };
  } catch (error) {
    console.error("validateJWT: JWT verification failed:", error);
    if (error instanceof Error) {
      console.error("validateJWT: error details:", {
        name: error.name,
        message: error.message,
        code: (error as any).code,
        stack: error.stack?.split("\n").slice(0, 5).join("\n"), // First 5 lines only
      });

      // Check if it's a JWKS endpoint error
      if (
        error.message.includes("JSON Web Key Set") ||
        error.message.includes("200 OK") ||
        error.message.includes("fetch JWKS")
      ) {
        console.error(
          `validateJWT: JWKS endpoint error - check if ${SUPABASE_URL}/auth/v1/.well-known/jwks.json is accessible`
        );
        console.error(
          "validateJWT: this usually means the Supabase URL is incorrect or the service is unreachable"
        );
      }
    }
    return null;
  }
}

/**
 * 許可リストに違反するかチェック
 */
export function violatesAllowList(
  candidates: Array<string | null | undefined>,
  allowList: Set<string>
): boolean {
  if (allowList.size === 0) return true;
  return candidates.some((value) => {
    const ext = extractExtension(value);
    if (!ext) return true;
    return !allowList.has(ext);
  });
}

/**
 * サイズ文字列をパース
 */
export function parseSize(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}
