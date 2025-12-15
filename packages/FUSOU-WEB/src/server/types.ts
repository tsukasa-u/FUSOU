import type { Context } from "hono";

// ========================
// 型定義
// ========================

// Cloudflare bindings and app environment
export type Bindings = {
  ASSET_SYNC_BUCKET: R2BucketBinding;
  ASSET_INDEX_DB: D1Database;
  FLEET_SNAPSHOT_BUCKET: R2BucketBinding;
  BATTLE_DATA_BUCKET: R2BucketBinding;
  // Supabase config (JWKS verification requires URL)
  PUBLIC_SUPABASE_URL: string; // required for JWKS
  SUPABASE_SECRET_KEY: string;
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
  ASSET_UPLOAD_SIGNING_SECRET: string;
  FLEET_SNAPSHOT_SIGNING_SECRET: string;
  BATTLE_DATA_SIGNING_SECRET: string;
  BATTLE_DATA_SIGNED_URL_SECRET?: string; // For battle data signed URL generation
  // Durable Object namespace
  COMPACTOR: DurableObjectNamespace;
};

export type R2BucketBinding = {
  head(key: string): Promise<R2ObjectLike | null>;
  list(options?: R2ListOptions): Promise<R2ListResponse>;
  get(
    key: string,
    options?: { range?: { offset: number; length?: number } }
  ): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value:
      | ReadableStream
      | ArrayBuffer
      | ArrayBufferView
      | string
      | Blob
      | null,
    options?: BucketPutOptions
  ): Promise<R2ObjectLike | null>;
  delete?(key: string): Promise<void>;
};

export type R2ListOptions = {
  limit?: number;
  cursor?: string;
  prefix?: string;
};

export type R2ListResponse = {
  objects: R2ObjectLite[];
  truncated?: boolean;
  cursor?: string;
};

export type R2ObjectLite = {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

export type R2ObjectLike = {
  size: number;
  etag?: string;
};

export type R2ObjectBody = {
  size: number;
  etag?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type BucketPutOptions = {
  httpMetadata?: { contentType?: string; cacheControl?: string };
  customMetadata?: Record<string, string | undefined>;
};

export type D1Database = {
  prepare(sql: string): D1Statement;
};

export type D1Statement = {
  bind(...args: unknown[]): D1Statement;
  run(): Promise<D1ExecResult>;
  all?(): Promise<D1AllResult>;
  first?(): Promise<D1Result | undefined>;
};

export type D1ExecResult = {
  success: boolean;
  error?: string;
  meta?: { duration?: number; rows_read?: number; rows_written?: number };
};

export type D1AllResult = { results?: D1Row[] };
export type D1Result = Record<string, unknown>;
export type D1Row = Record<string, unknown>;

// Hono Context型
export type AppContext = Context<{ Bindings: Bindings }>;
