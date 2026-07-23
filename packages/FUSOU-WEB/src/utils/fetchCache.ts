/**
 * Client-side fetch cache with request deduplication.
 *
 * - Identical in-flight requests are coalesced (same URL → same promise).
 * - Successful JSON responses are cached for `ttlMs` (default 600 s).
 * - Callers get a *cloned* response so each can independently call `.json()`.
 */

interface CacheEntry {
  /** Serialised response body */
  body: string;
  status: number;
  headers: [string, string][];
  /** Epoch-ms when this entry was stored */
  storedAt: number;
  /** Approximate byte size of cached body */
  sizeBytes: number;
}

const responseCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<Response>>();
let _totalCacheBytes = 0;

const DEFAULT_TTL_MS = 600_000; // 10 minutes
const MAX_CACHE_ENTRIES = 60;
const MAX_CACHE_ENTRY_BYTES = 2_000_000;
const MAX_TOTAL_CACHE_BYTES = 8_000_000;

const CACHEABLE_PATHS = new Set([
  "/api/battle-data/global/records",
  "/api/master-data/json",
  "/api/asset-sync/weapon-icon-frames",
  // ship-growth read endpoints (1 h CF Cache on server, 10 min client cache)
  "/api/ship-growth/summary",
  "/api/ship-growth/exp",
  "/api/ship-growth/bounds",
  "/api/ship-growth/cumulative",
  "/api/ship-growth/all-periods",
  // quest-tree read endpoints
  "/api/quest-tree/graph",
  "/api/quest-tree/rules",
  // remodel summary
  "/api/remodel-data/summary",
  "/api/remodel-data/effective-summary",
]);

function buildCacheKey(url: string, init?: RequestInit): string {
  const method = (init?.method || "GET").toUpperCase();
  return `${method}:${url}`;
}

function isCacheableRequest(url: string, init?: RequestInit): boolean {
  const method = (init?.method || "GET").toUpperCase();
  if (method !== "GET") return false;

  try {
    const parsed =
      typeof window !== "undefined"
        ? new URL(url, window.location.origin)
        : new URL(url, "http://localhost");
    // filter_json 付きも通常パスと同じくキャッシュ許可。
    // データは1時間ごとの更新のため、同一 URL のキャッシュは問題ない。
    // サーバー側 KV キャッシュも同様に 3600s TTL を使用している。
    return CACHEABLE_PATHS.has(parsed.pathname);
  } catch {
    return false;
  }
}

function isCacheableResponse(response: Response): boolean {
  const cacheControl =
    response.headers.get("cache-control")?.toLowerCase() || "";
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  const vary = response.headers.get("vary")?.toLowerCase() || "";

  if (cacheControl.includes("no-store") || cacheControl.includes("private")) {
    return false;
  }
  if (response.headers.has("set-cookie")) {
    return false;
  }
  if (vary.includes("cookie") || vary.includes("authorization")) {
    return false;
  }
  if (
    !contentType.includes("application/json") &&
    !contentType.includes("+json")
  ) {
    return false;
  }
  return true;
}

function shouldCacheResponseBody(url: string, bodyText: string): boolean {
  try {
    const parsed =
      typeof window !== "undefined"
        ? new URL(url, window.location.origin)
        : new URL(url, "http://localhost");
    if (parsed.pathname !== "/api/battle-data/global/records") {
      return true;
    }

    const payload = JSON.parse(bodyText) as {
      count?: unknown;
      records?: unknown;
    };
    const count = Number(payload?.count ?? Number.NaN);
    if (Number.isFinite(count)) {
      return count > 0;
    }
    if (Array.isArray(payload?.records)) {
      return payload.records.length > 0;
    }
  } catch {
    return true;
  }

  return true;
}

function estimateSizeBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function deleteCacheEntry(key: string): boolean {
  const entry = responseCache.get(key);
  if (!entry) return false;
  responseCache.delete(key);
  _totalCacheBytes -= entry.sizeBytes;
  return true;
}

function evictStaleEntries(): void {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (now - entry.storedAt > DEFAULT_TTL_MS) {
      deleteCacheEntry(key);
    }
  }

  while (
    responseCache.size > MAX_CACHE_ENTRIES ||
    _totalCacheBytes > MAX_TOTAL_CACHE_BYTES
  ) {
    const sorted = [...responseCache.entries()].sort(
      (a, b) => a[1].storedAt - b[1].storedAt,
    );
    const oldest = sorted[0];
    if (!oldest) break;
    deleteCacheEntry(oldest[0]);
  }
}

function buildResponse(entry: CacheEntry): Response {
  return new Response(entry.body, {
    status: entry.status,
    headers: entry.headers,
  });
}

/**
 * Fetch with deduplication and short-lived cache.
 *
 * @param url    Request URL (string)
 * @param init   Optional RequestInit (only `signal` is forwarded for abort support)
 * @param ttlMs  Cache TTL in milliseconds (default 600 000)
 */
export function cachedFetch(
  url: string,
  init?: RequestInit,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<Response> {
  if (!isCacheableRequest(url, init)) {
    return fetch(url, init);
  }

  const cacheKey = buildCacheKey(url, init);

  // Check local cache first
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.storedAt < ttlMs) {
    return Promise.resolve(buildResponse(cached));
  }

  // Return existing in-flight request if available
  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    // Clone so each consumer can independently read the body
    return inflight.then(
      (res) => {
        // Re-check cache (the in-flight may have populated it)
        const freshCached = responseCache.get(cacheKey);
        if (freshCached && Date.now() - freshCached.storedAt < ttlMs) {
          return buildResponse(freshCached);
        }
        return res.clone();
      },
      (err) => {
        throw err;
      },
    );
  }

  // Make the actual request
  const fetchInit: RequestInit = {
    ...init,
    cache: init?.cache ?? "no-store",
  };

  const promise = fetch(url, fetchInit)
    .then(async (response) => {
      inflightRequests.delete(cacheKey);

      // Only cache successful responses from explicitly public endpoints.
      if (response.ok && isCacheableResponse(response)) {
        try {
          const bodyText = await response.clone().text();
          if (!shouldCacheResponseBody(url, bodyText)) {
            return response;
          }
          const sizeBytes = estimateSizeBytes(bodyText);
          if (sizeBytes > MAX_CACHE_ENTRY_BYTES) {
            return response;
          }
          const headerPairs: [string, string][] = [];
          response.headers.forEach((value, key) => {
            headerPairs.push([key, value]);
          });
          // Remove old entry's bytes before overwriting
          const prev = responseCache.get(cacheKey);
          if (prev) _totalCacheBytes -= prev.sizeBytes;
          responseCache.set(cacheKey, {
            body: bodyText,
            status: response.status,
            headers: headerPairs,
            storedAt: Date.now(),
            sizeBytes,
          });
          _totalCacheBytes += sizeBytes;
          evictStaleEntries();
        } catch {
          // If we can't cache, that's fine — just return the original
        }
      }

      return response;
    })
    .catch((err) => {
      inflightRequests.delete(cacheKey);
      throw err;
    });

  inflightRequests.set(cacheKey, promise);

  // Support abort signal — clean up on abort
  if (init?.signal) {
    init.signal.addEventListener(
      "abort",
      () => {
        inflightRequests.delete(cacheKey);
      },
      { once: true },
    );
  }

  return promise.then((res) => res.clone());
}

/** Clear the entire fetch cache (e.g. on logout or manual refresh). */
export function clearFetchCache(): void {
  responseCache.clear();
  inflightRequests.clear();
}
