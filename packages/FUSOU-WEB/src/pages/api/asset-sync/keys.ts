import type { APIRoute } from "astro";
import {
  getAssetKeyCache,
  setAssetKeyCache,
  type AssetKeyCache,
} from "./cache-store";

const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

interface CloudflareEnv {
  ASSET_SYNC_BUCKET?: R2BucketBinding;
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
  const bucket = env?.ASSET_SYNC_BUCKET;
  if (!bucket) {
    return errorResponse(
      "Asset sync bucket is not configured. Bind ASSET_SYNC_BUCKET in Cloudflare.",
      503
    );
  }

  const now = Date.now();
  const cached = await getAssetKeyCache(bucket as any);
  const ifNoneMatch = request.headers.get("if-none-match");
  if (cached && cached.expiresAt > now) {
    if (ifNoneMatch && cached.etag === ifNoneMatch) {
      return notModifiedResponse(cached.etag);
    }
    return jsonResponse(buildPayload(cached, true), cached.etag);
  }

  const keys = await fetchAllKeys(bucket);
  const refreshedAt = now;
  const expiresAt = now + CACHE_TTL_MS;
  const etag = buildEtag(refreshedAt);
  const cache: AssetKeyCache = { keys, refreshedAt, expiresAt, etag };
  await setAssetKeyCache(bucket as any, cache);

  return jsonResponse(buildPayload(cache, false), etag);
};

async function fetchAllKeys(bucket: R2BucketBinding): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const response = await bucket.list({ cursor, limit: 1000 });
    if (response.objects?.length) {
      for (const obj of response.objects) {
        if (!obj.key.startsWith("_system/")) {
          keys.push(obj.key);
        }
      }
    }
    cursor = response.truncated ? response.cursor : undefined;
  } while (cursor);

  return keys;
}

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
