import type { Context } from "hono";
import type {
  D1Database as CloudflareD1Database,
  D1ExecResult as CloudflareD1ExecResult,
  D1PreparedStatement,
  D1Result as CloudflareD1Result,
  KVNamespace as CloudflareKVNamespace,
  R2Bucket,
  R2ListOptions as CloudflareR2ListOptions,
  R2Object as CloudflareR2Object,
  R2ObjectBody as CloudflareR2ObjectBody,
  R2Objects as CloudflareR2Objects,
  R2PutOptions as CloudflareR2PutOptions,
} from "@cloudflare/workers-types";

// ========================
// 型定義
// ========================

// Cloudflare bindings and app environment
export type Bindings = {
  // R2 Buckets
  ASSETS_BUCKET: R2BucketBinding;
  ASSET_SYNC_BUCKET: R2BucketBinding;
  ASSET_INDEX_DB: D1Database;
  BATTLE_INDEX_DB: D1Database;
  QUEST_INDEX_DB: D1Database;
  FLEET_SNAPSHOT_BUCKET: R2BucketBinding;
  BATTLE_DATA_BUCKET: R2BucketBinding;
  MASTER_DATA_BUCKET: R2BucketBinding;
  SHIP_GROWTH_ARCHIVE_BUCKET: R2BucketBinding;
  MASTER_DATA_INDEX_DB: D1Database;
  SHIP_GROWTH_DB: D1Database;
  SOKU_SPEED_OBSERVED_DB: D1Database;
  REMODEL_INDEX_DB: D1Database;

  // Supabase config (JWKS verification requires URL)
  PUBLIC_SUPABASE_URL: string; // required for JWKS
  SUPABASE_SECRET_KEY: string;
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
  ASSET_UPLOAD_SIGNING_SECRET: string;
  FLEET_SNAPSHOT_SIGNING_SECRET: string;
  BATTLE_DATA_SIGNING_SECRET: string;
  MASTER_DATA_SIGNING_SECRET: string;
  QUEST_TREE_SIGNING_SECRET?: string;
  SHIP_GROWTH_SIGNING_SECRET?: string;
  SOKU_SPEED_SIGNING_SECRET?: string;
  REMODEL_DATA_SIGNING_SECRET?: string;
  BATTLE_DATA_SIGNED_URL_SECRET?: string; // For battle data signed URL generation
  DATASET_TOKEN_SECRET: string; // For dataset token signing (anonymous sync)
  // Stateless challenge HMAC key used by anonymous-sync register/refresh.
  CHALLENGE_HMAC_SECRET: string;
  RESEND_API_KEY?: string; // For sending verification emails
  ADMIN_TOKEN?: string; // For securing admin endpoints
  PUBLIC_SITE_URL?: string; // Canonical public origin for the web app
  PUBLIC_SITE_ALLOWED_HOSTS?: string; // Comma-separated host allowlist for simulator share URLs
  ASSET_BASE_URL?: string; // R2 custom domain base URL (e.g. https://assets.fusou.dev)

  // Queues
  COMPACTION_QUEUE: Queue;
  COMPACTION_DLQ: Queue;

  // Service binding to Workflow Worker
  COMPACTION_WORKFLOW: Fetcher;
  // /internal/* endpoints are protected by Cloudflare service binding network
  // isolation (only reachable via https://shortener.internal, not the public internet).
  SHORTENER_SERVICE: Fetcher;

  // KV for caching (optional)
  ASSET_SYNC_INDEX_KV?: CloudflareKVNamespace;
  DATA_LOADER_CACHE_KV?: CloudflareKVNamespace;
};

export type R2BucketBinding = R2Bucket;
export type R2ListOptions = CloudflareR2ListOptions;
export type R2ListResponse = CloudflareR2Objects;
export type R2ObjectLite = CloudflareR2Object;
export type R2ObjectLike = CloudflareR2Object;
export type R2ObjectBody = CloudflareR2ObjectBody;
export type BucketPutOptions = CloudflareR2PutOptions;

export type D1Database = CloudflareD1Database;
export type D1Statement = D1PreparedStatement;
export type D1ExecResult = CloudflareD1ExecResult;
export type D1AllResult = CloudflareD1Result<D1Row>;
export type D1Result = Record<string, unknown>;
export type D1Row = Record<string, unknown>;

// Hono Context型
export type AppContext = Context<{ Bindings: Bindings }>;
