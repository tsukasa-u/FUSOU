import { jwtVerify, createRemoteJWKSet } from "jose";
import { DEFAULT_ALLOWED_EXTENSIONS } from "./constants";
import type { Bindings } from "./types";

// ========================
// 環境変数取得
// ========================

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

/**
 * Cloudflare runtime環境変数からBindingsオブジェクトを構築
 */
export function injectEnv(locals: any): Bindings {
  const runtimeEnv = locals?.runtime?.env || {};

  return {
    ASSET_SYNC_BUCKET: runtimeEnv.ASSET_SYNC_BUCKET!,
    ASSET_INDEX_DB: runtimeEnv.ASSET_INDEX_DB!,
    ASSET_PAYLOAD_BUCKET: runtimeEnv.ASSET_PAYLOAD_BUCKET!,
    PUBLIC_SUPABASE_URL: import.meta.env.PUBLIC_SUPABASE_URL!,
    SUPABASE_SECRET_KEY: import.meta.env.SUPABASE_SECRET_KEY!,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: import.meta.env
      .PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    ASSET_SYNC_ALLOWED_EXTENSIONS: import.meta.env
      .ASSET_SYNC_ALLOWED_EXTENSIONS!,
    ASSET_UPLOAD_SIGNING_SECRET: import.meta.env.ASSET_UPLOAD_SIGNING_SECRET!,
    FLEET_SNAPSHOT_SIGNING_SECRET: import.meta.env
      .FLEET_SNAPSHOT_SIGNING_SECRET!,
    ADMIN_API_SECRET: import.meta.env.ADMIN_API_SECRET!,
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
const SUPABASE_URL = (import.meta.env.PUBLIC_SUPABASE_URL || "").replace(
  /\/$/,
  ""
);
const JWKS = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/jwks`))
  : undefined;

export async function validateJWT(token: string): Promise<{
  id?: string;
  email?: string;
  payload?: Record<string, any>;
} | null> {
  try {
    if (!SUPABASE_URL || !JWKS) {
      console.error("PUBLIC_SUPABASE_URL not configured");
      return null;
    }

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: undefined,
    });

    return {
      id: typeof payload.sub === "string" ? payload.sub : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      payload: payload as Record<string, any>,
    };
  } catch (error) {
    console.error("JWT verification failed:", error);
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
