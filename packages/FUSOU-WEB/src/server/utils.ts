import { createRemoteJWKSet, SignJWT, jwtVerify } from "jose";
import type { Context } from "hono";
import { DEFAULT_ALLOWED_EXTENSIONS } from "./constants";
import type { Bindings } from "./types";

// ========================
// 環境変数コンテキスト
// ========================

/**
 * 統一された環境変数コンテキスト
 * Cloudflare runtime -> process.env -> import.meta.env の優先順位でフォールバック
 */
export interface EnvContext {
  /** ランタイム環境変数（Cloudflare Workers/Pages） */
  readonly runtime: Record<string, any>;
  /** ビルド時環境変数 */
  readonly buildtime: Record<string, any>;
  /** 開発環境かどうか */
  readonly isDev: boolean;
}

/**
 * Honoコンテキストから統一環境変数コンテキストを生成
 */
export function createEnvContext(c: Pick<Context, "env"> | { env?: any }): EnvContext {
  const runtimeEnv = ((c as any)?.env as any)?.env || (c as any)?.env || {};
  const isDev = import.meta.env.DEV;

  return {
    runtime: runtimeEnv,
    buildtime: import.meta.env as Record<string, any>,
    isDev,
  };
}

/**
 * 環境変数コンテキストから値を取得
 * 優先順位: runtime（暗号化されていない） -> process.env (dev) -> buildtime
 */
export function getEnv(ctx: EnvContext, key: string): string | undefined {
  const runtimeValue = ctx.runtime[key];
  if (runtimeValue && !String(runtimeValue).startsWith("encrypted:")) {
    return runtimeValue;
  }

  if (ctx.isDev && typeof process !== "undefined") {
    const processValue = (process.env as any)[key];
    if (processValue) return processValue;
  }

  const buildtimeValue = ctx.buildtime[key];
  if (
    buildtimeValue &&
    typeof buildtimeValue === "string" &&
    buildtimeValue.startsWith("encrypted:")
  ) {
    if (typeof process !== "undefined") {
      const processValue = (process.env as any)[key];
      if (processValue) return processValue;
    }
  }

  return buildtimeValue;
}

/** 環境変数が設定されているか確認 */
export function hasEnv(ctx: EnvContext, key: string): boolean {
  return getEnv(ctx, key) !== undefined;
}

// ========================
// 署名付きトークン（JWT）
// ========================

/** 署名付きトークンを生成 */
export async function generateSignedToken(
  payload: Record<string, any>,
  secret: string,
  expiresInSeconds: number
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(secretKey);
  return token;
}

/** 署名付きトークンを検証 */
export async function verifySignedToken(
  token: string,
  secret: string
): Promise<Record<string, any> | null> {
  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey);
    return payload as Record<string, any>;
  } catch {
    return null;
  }
}

/**
 * 環境変数を取得（暗号化対応）
 * @deprecated Use createEnvContext() + getEnv() instead
 * runtimeEnv -> process.env -> import.meta.env の優先順位
 */
export function getEnvValue(
  key: string,
  runtimeEnv: Record<string, any> = {}
): string | undefined {
  const ctx: EnvContext = {
    runtime: runtimeEnv,
    buildtime: import.meta.env as Record<string, any>,
    isDev: import.meta.env.DEV,
  };
  return getEnv(ctx, key);
}

export type SupabaseConfig = {
  url: string | null;
  serviceRoleKey: string | null;
  publishableKey: string | null;
};

/** Supabase設定を環境変数から解決 */
export function resolveSupabaseConfig(ctx: EnvContext): SupabaseConfig {
  const url = getEnv(ctx, "PUBLIC_SUPABASE_URL")?.replace(/\/$/, "") ?? null;
  const serviceRoleKey = getEnv(ctx, "SUPABASE_SECRET_KEY") ?? null;
  const publishableKey = getEnv(ctx, "PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? null;

  return { url, serviceRoleKey, publishableKey };
}

/**
 * @deprecated Use createEnvContext() + resolveSupabaseConfig() instead
 */
export function resolveSupabaseConfigLegacy(
  runtimeEnv: Record<string, any> = {}
): SupabaseConfig {
  const ctx: EnvContext = {
    runtime: runtimeEnv,
    buildtime: import.meta.env as Record<string, any>,
    isDev: import.meta.env.DEV,
  };
  return resolveSupabaseConfig(ctx);
}

/**
 * Astro adapter経由でも Workers 直実行でも同じ形で env を取得するヘルパー
 * @deprecated Use createEnvContext() instead for unified environment access
 */
export function getRuntimeEnv(
  c: Pick<Context, "env"> | { env?: any }
): Record<string, any> {
  return ((c as any)?.env as any)?.env || (c as any)?.env || {};
}

/** Cloudflare runtime環境変数からBindingsオブジェクトを構築 */
export function injectEnv(locals: any): Bindings {
  const ctx: EnvContext = {
    runtime: locals?.runtime?.env || {},
    buildtime: import.meta.env as Record<string, any>,
    isDev: import.meta.env.DEV,
  };

  return {
    ASSETS_BUCKET: ctx.runtime.ASSETS_BUCKET!,
    ASSET_SYNC_BUCKET: ctx.runtime.ASSET_SYNC_BUCKET!,
    ASSET_INDEX_DB: ctx.runtime.ASSET_INDEX_DB!,
    BATTLE_INDEX_DB: ctx.runtime.BATTLE_INDEX_DB!,
    FLEET_SNAPSHOT_BUCKET: ctx.runtime.FLEET_SNAPSHOT_BUCKET!,
    BATTLE_DATA_BUCKET: ctx.runtime.BATTLE_DATA_BUCKET!,
    MASTER_DATA_BUCKET: ctx.runtime.MASTER_DATA_BUCKET!,
    MASTER_DATA_INDEX_DB: ctx.runtime.MASTER_DATA_INDEX_DB!,
    PUBLIC_SUPABASE_URL: getEnv(ctx, "PUBLIC_SUPABASE_URL")!,
    SUPABASE_SECRET_KEY: getEnv(ctx, "SUPABASE_SECRET_KEY")!,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: getEnv(ctx, "PUBLIC_SUPABASE_PUBLISHABLE_KEY")!,
    ASSET_UPLOAD_SIGNING_SECRET: getEnv(ctx, "ASSET_UPLOAD_SIGNING_SECRET")!,
    FLEET_SNAPSHOT_SIGNING_SECRET: getEnv(ctx, "FLEET_SNAPSHOT_SIGNING_SECRET")!,
    BATTLE_DATA_SIGNING_SECRET: getEnv(ctx, "BATTLE_DATA_SIGNING_SECRET")!,
    MASTER_DATA_SIGNING_SECRET: getEnv(ctx, "MASTER_DATA_SIGNING_SECRET")!,
    BATTLE_DATA_SIGNED_URL_SECRET: getEnv(ctx, "BATTLE_DATA_SIGNED_URL_SECRET"),
    DATASET_TOKEN_SECRET: getEnv(ctx, "DATASET_TOKEN_SECRET"),
    RESEND_API_KEY: getEnv(ctx, "RESEND_API_KEY"),
    COMPACTION_QUEUE: ctx.runtime.COMPACTION_QUEUE!,
    COMPACTION_DLQ: ctx.runtime.COMPACTION_DLQ!,
    COMPACTION_WORKFLOW: ctx.runtime.COMPACTION_WORKFLOW!,
  };
}

// ========================
// ヘルパー関数
// ========================

/** Authorization ヘッダーから Bearer トークンを抽出 */
export function extractBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!rest.length || scheme.toLowerCase() !== "bearer") return null;
  return rest.join(" ");
}

/** タイミングセーフな文字列比較 */
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

/** ファイル名から拡張子を抽出 */
export function extractExtension(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const last = normalized.lastIndexOf(".");
  if (last === -1 || last === normalized.length - 1) return null;
  return normalized.substring(last + 1);
}

/** 許可された拡張子リストを解決 */
export function resolveAllowedExtensions(...sources: (string | undefined)[]): Set<string> {
  for (const source of sources) {
    const entries = parseList(source);
    if (entries.length > 0) return new Set(entries);
  }
  return new Set(DEFAULT_ALLOWED_EXTENSIONS);
}

/** カンマ区切りリストをパース */
export function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^[.]+/, ""))
    .filter((item) => item.length > 0);
}

/** オブジェクトキーをサニタイズ（パストラバーサル対策） */
export function sanitizeKey(input: string | null): string | null {
  if (!input) return null;
  const normalized = input.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  return normalized;
}

/** ファイル名をサニタイズ */
export function sanitizeFileName(input: string | null): string | null {
  if (!input) return null;
  const normalized = input.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const candidate = parts[parts.length - 1]?.trim();
  if (!candidate) return null;
  return candidate.replace(/[\0-\x1F]/g, "");
}

// ========================
// JWKS-based JWT validation (Supabase)
// ========================

// Cache RemoteJWKSet globally to leverage Cloudflare Workers hot-instance caching.
// Use build-time env for initial JWKS setup (runtime env not available at module load)
const initCtx: EnvContext = {
  runtime: {},
  buildtime: import.meta.env as Record<string, any>,
  isDev: import.meta.env.DEV,
};
const { url: SUPABASE_URL } = resolveSupabaseConfig(initCtx);

if (import.meta.env.DEV) {
  console.log(`[JWKS Init] SUPABASE_URL: ${SUPABASE_URL || "<not set>"}`);
}

let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJWKS() {
  if (JWKS) return JWKS;
  if (!SUPABASE_URL) return undefined;
  
  try {
    const jwksUrl = new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    JWKS = createRemoteJWKSet(jwksUrl);
    return JWKS;
  } catch (e) {
    console.warn("Invalid Supabase URL for JWKS:", e);
    return undefined;
  }
}

export async function validateJWT(token: string): Promise<{
  id?: string;
  email?: string;
  payload?: Record<string, any>;
} | null> {
  try {
    const jwks = getJWKS();
    if (!SUPABASE_URL || !jwks) {
      console.error("validateJWT: PUBLIC_SUPABASE_URL not configured or JWKS not initialized");
      return null;
    }

    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: "authenticated",
    });

    return {
      id: typeof payload.sub === "string" ? payload.sub : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      payload: payload as Record<string, any>,
    };
  } catch (error) {
    console.error("validateJWT: JWT verification failed:", error);
    return null;
  }
}

/**
 * dataset_token を検証（匿名認証で発行された署名付きトークン）
 * 
 * @param token dataset_token文字列
 * @param secret DATASET_TOKEN_SECRET
 * @returns 検証成功時は { dataset_id } を返す。失敗時はnull
 */
export async function validateDatasetToken(
  token: string,
  secret: string
): Promise<{
  dataset_id: string;
} | null> {
  try {
    if (!secret) {
      console.error("validateDatasetToken: DATASET_TOKEN_SECRET not configured");
      return null;
    }

    const payload = await verifySignedToken(token, secret);
    if (!payload) return null;

    // 必須フィールド検証
    if (payload.typ !== 'dataset') return null;
    if (typeof payload.sub !== 'string') return null;
    if (typeof payload.dataset_id !== 'string') return null;
    if (payload.aud !== 'fusou-upload') return null;

    // 有効期限確認（jose の verifySignedToken で exp は自動チェック済み）
    return {
      dataset_id: payload.dataset_id,
    };
  } catch (error) {
    console.error("validateDatasetToken: Token verification failed:", error);
    return null;
  }
}

/** 許可リストに違反するかチェック */
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

// ========================
// R2 署名URL生成（S3 互換）
// ========================

/**
 * R2 署名URL を生成（S3 署名 v4）
 * Cloudflare R2 は S3 互換なので、S3署名でアクセス可能
 */
export async function generateR2SignedUrl(
  _bucket: any, // R2BucketBinding
  key: string,
  _expiresInSeconds: number = 3600 // デフォルト1時間
): Promise<string> {
  // Cloudflare R2 の GetObject に対する署名URL を生成
  // Workers 環境では bucket.createSignedUrl() を使用（利用可能な場合）
  
  // フォールバック: 公開読み取り前提（署名URL生成APIがない場合）
  // 本来は AWS SDK の getSignedUrl を使用することが推奨されます
  
  try {
    // Cloudflare Workers Bindings には署名URL生成機能がないため、
    // 以下のいずれかの方法が必要：
    // 1. Cloudflare REST API を呼び出す
    // 2. AWS SDK を使用して署名を手動計算
    // 3. Workers KV に一時トークンを保存
    
    // 現状の実装では、バケットの特定キーに対して
    // 時限付きアクセスを提供するため、別方法を採用：
    
    // 現状の実装では、バケットの特定キーに対して
    // 時限付きアクセスを提供するため、別方法を採用：
    
    // バケットバインディングオブジェクトからenvを取得するのは難しいため、
    // 呼び出し元で generateR2SignedUrl を呼ぶ前に必要なコンテキストを解決するか、
    // この関数自体を非推奨にして generateTimeBasedSignedUrl を直接使うべきですが、
    // とりあえずここでは後方互換性のために generateTimeBasedSignedUrl のシグネチャ変更に合わせて修正します。
    // ただし、ここからは secret と baseUrl が取れないので、この関数は実質的に使えなくなります。
    // 呼び出し元を修正する必要があります。
    
    throw new Error("generateR2SignedUrl is deprecated. Use generateTimeBasedSignedUrl with explicit secrets instead.");
  } catch (error) {
    console.error(`Failed to generate R2 signed URL for key: ${key}`, error);
    throw error;
  }
}

/**
 * 時間ベースの署名URL生成（Workers 環境用）
 * JWT形式でアクセストークンを生成し、URLパラメータに含める
 */
export async function generateTimeBasedSignedUrl(
  key: string,
  secret: string,
  baseUrl: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  if (!secret) {
    throw new Error('Secret is required for signed URL generation');
  }

  if (!baseUrl) {
    throw new Error('Base URL is required for signed URL generation');
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + expiresInSeconds;
  
  // 署名トークン生成（R2 Presigned URL の代替）
  const token = await generateSignedToken(
    {
      key,
      action: 'read',
      exp: expiresAt,
    },
    secret,
    expiresInSeconds
  );
  
  // URL に token をパラメータとして含める
  // WASM または外部クライアントが token を使用してアクセス
  return `${baseUrl}/${key}?token=${encodeURIComponent(token)}&expires=${expiresAt}`;
}

/**
 * R2 署名URL トークンを検証
 * WASM からの読み取りリクエストで使用
 */
export async function verifyR2SignedUrl(
  token: string,
  key: string,
  secret: string
): Promise<boolean> {
  try {
    if (!secret) {
      console.error('verifyR2SignedUrl: Secret not provided');
      return false;
    }

    const payload = await verifySignedToken(token, secret);
    
    if (!payload) return false;
    
    // キーの一致確認
    if (payload.key !== key) return false;
    
    // アクション確認
    if (payload.action !== 'read') return false;
    
    // 有効期限確認
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return false;
    
    return true;
  } catch (error) {
    console.error('R2 signed URL verification failed:', error);
    return false;
  }
}

/**
 * R2 バケットからバイナリデータを読み込む（署名URL不要）
 * Worker環境内でのアクセス（env.R2バインディング経由）
 * 
 * @param bucket R2BucketBinding
 * @param key オブジェクトキー
 * @returns バイナリデータ（ArrayBuffer）
 */
export async function readR2Binary(
  bucket: any,
  key: string
): Promise<ArrayBuffer> {
  const obj = await bucket.get(key);
  if (!obj) {
    throw new Error(`R2 object not found: ${key}`);
  }
  return obj.arrayBuffer();
}

/**
 * R2 バケットにバイナリデータを書き込む
 * 
 * @param bucket R2BucketBinding
 * @param key オブジェクトキー
 * @param data バイナリデータ
 * @param metadata オプションのメタデータ
 */
export async function writeR2Binary(
  bucket: any,
  key: string,
  data: ArrayBuffer | Uint8Array,
  metadata?: Record<string, string>
): Promise<void> {
  await bucket.put(key, data, {
    customMetadata: metadata,
  });
}

/**
 * R2 オブジェクトのメタデータを取得（ファイルサイズ確認用）
 * 
 * @param bucket R2BucketBinding
 * @param key オブジェクトキー
 * @returns メタデータ（size, contentType, lastModified）
 */
export async function getR2ObjectMetadata(
  bucket: any,
  key: string
): Promise<{ size: number; contentType: string; lastModified: Date } | null> {
  try {
    const obj = await bucket.head(key);
    if (!obj) return null;
    return {
      size: obj.size || 0,
      contentType: obj.contentType || 'application/octet-stream',
      lastModified: obj.uploaded || new Date(),
    };
  } catch (error) {
    console.error(`Failed to get R2 metadata for ${key}:`, error);
    return null;
  }
}
/**
 * [Issue #19] トークンペイロードの型安全性を確保
 * Payload から required fields を検証して必須フィールドがすべて存在することを確認
 * 
 * @param payload トークンペイロード
 * @param requiredFields 必須フィールド名のリスト
 * @returns { valid: boolean, error?: string, data?: any }
 */
export function validateTokenPayload(
  payload: any,
  requiredFields: string[] = []
): { valid: boolean; error?: string; data?: any } {
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      error: 'Token payload must be a non-null object',
    };
  }

  // Check for required fields
  const missingFields = requiredFields.filter(field => !(field in payload));
  if (missingFields.length > 0) {
    return {
      valid: false,
      error: `Missing required fields in token payload: ${missingFields.join(', ')}`,
    };
  }

  // Validate user_id is present and is string
  if (!payload.user_id || typeof payload.user_id !== 'string') {
    return {
      valid: false,
      error: 'Token payload must have user_id as string',
    };
  }

  // Validate expectedFileSize if present (should be number)
  if ('expectedFileSize' in payload && payload.expectedFileSize !== null) {
    if (typeof payload.expectedFileSize !== 'number' || payload.expectedFileSize <= 0) {
      return {
        valid: false,
        error: 'expectedFileSize must be a positive number if provided',
      };
    }
  }

  return {
    valid: true,
    data: payload,
  };
}