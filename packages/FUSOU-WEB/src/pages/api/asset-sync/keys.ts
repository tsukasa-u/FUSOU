import type { APIRoute } from "astro";
import type { AssetKeyCache, D1Database, D1AllResult } from "./types";
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

interface CloudflareEnv {
  ASSET_SYNC_BUCKET?: R2BucketBinding;
  ASSET_INDEX_DB?: D1Database;
}

type R2BucketBinding = {
  list(options?: R2ListOptions): Promise<R2ListResponse>;
};

type R2ListOptions = {
  limit?: number;
  cursor?: string;
};

type R2ListResponse = {
  objects: { key: string }[];
  truncated?: boolean;
  cursor?: string;
};

type KeyPayload = {
  keys: string[];
  refreshedAt: string;
  cacheExpiresAt: string;
  cached: boolean;
  total: number;
};

export const prerender = false;

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const GET: APIRoute = async ({ locals, request }) => {
  const env = extractEnv(locals.runtime?.env);

  // D1-only listing (development mode: no backward compatibility with R2 cache/markers)
  const db = env?.ASSET_INDEX_DB;
  if (!db) {
    return errorResponse(
      "ASSET_INDEX_DB is not configured. Bind D1 database as ASSET_INDEX_DB.",
      503
    );
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(1000, Number(url.searchParams.get("limit") || 1000));
    const offset = Number(url.searchParams.get("offset") || 0);
    const now = Date.now();

    const stmt = db.prepare(
      "SELECT key FROM files ORDER BY uploaded_at DESC LIMIT ? OFFSET ?"
    );
    const res: D1AllResult | undefined = await stmt.bind(limit, offset).all?.();
    const keys = (res?.results || [])
      .map((r) => (typeof r.key === "string" ? r.key : undefined))
      .filter(Boolean) as string[];

    const refreshedAt = now;
    const expiresAt = now + CACHE_TTL_SECONDS * 1000;
    const etag = buildEtag(refreshedAt);
    const cache = { keys, refreshedAt, expiresAt, etag };
    return jsonResponse(buildPayload(cache, false), etag);
  } catch (e) {
    console.error("D1 listing failed", e);
    return errorResponse("Failed to list assets from D1", 502);
  }
};

function buildPayload(cache: AssetKeyCache, cached: boolean): KeyPayload {
  return {
    keys: cache.keys,
    total: cache.keys.length,
    refreshedAt: new Date(cache.refreshedAt).toISOString(),
    cacheExpiresAt: new Date(cache.expiresAt).toISOString(),
    cached,
  };
}

function extractEnv(value: unknown): CloudflareEnv | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as CloudflareEnv;
}

function jsonResponse(
  payload: KeyPayload,
  etag: string,
  status = 200
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      ETag: etag,
      ...CORS_HEADERS,
    },
  });
}

function notModifiedResponse(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: {
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      ETag: etag,
      ...CORS_HEADERS,
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function buildEtag(refreshedAt: number): string {
  return `W/"${refreshedAt}"`;
}
