import type { APIRoute } from "astro";
import { getAssetKeyCache, setAssetKeyCache } from "./cache-store";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
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

export const GET: APIRoute = async ({ locals }) => {
  const env = extractEnv(locals.runtime?.env);
  const bucket = env?.ASSET_SYNC_BUCKET;
  if (!bucket) {
    return errorResponse(
      "Asset sync bucket is not configured. Bind ASSET_SYNC_BUCKET in Cloudflare.",
      503,
    );
  }

  const now = Date.now();
  const cached = getAssetKeyCache();
  if (cached && cached.expiresAt > now) {
    return jsonResponse(buildPayload(cached, true));
  }

  const keys = await fetchAllKeys(bucket);
  const refreshedAt = now;
  const expiresAt = now + CACHE_TTL_MS;
  setAssetKeyCache({ keys, refreshedAt, expiresAt });

  return jsonResponse(
    buildPayload({ keys, refreshedAt, expiresAt }, false),
  );
};

async function fetchAllKeys(bucket: R2BucketBinding): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const response = await bucket.list({ cursor, limit: 1000 });
    if (response.objects?.length) {
      for (const obj of response.objects) {
        keys.push(obj.key);
      }
    }
    cursor = response.truncated ? response.cursor : undefined;
  } while (cursor);

  return keys;
}

function buildPayload(
  cache: { keys: string[]; refreshedAt: number; expiresAt: number },
  cached: boolean,
): KeyPayload {
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

function jsonResponse(payload: KeyPayload, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${CACHE_TTL_MS / 1000}`,
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
