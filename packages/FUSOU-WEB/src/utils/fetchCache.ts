/**
 * Client-side fetch cache with request deduplication and persistent IndexedDB backing.
 *
 * - Identical in-flight requests are coalesced (same URL → same promise).
 * - Successful JSON responses are cached in-memory for `ttlMs` (default 600 s).
 * - Long-lived master data endpoints are persisted in IndexedDB across browser reloads.
 * - Callers get a *cloned* response so each can independently call `.json()`.
 */

import {
  getIdbCache,
  setIdbCache,
  clearIdbCache,
  type IdbCacheRecord,
} from "./indexedDbCache";

export interface CacheEntry {
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
const IDB_PERSISTENT_TTL_MS = 7 * 24 * 3600_000; // 7 days for immutable master data
const MAX_CACHE_ENTRIES = 100;
const MAX_CACHE_ENTRY_BYTES = 5_000_000; // 5 MB (sufficient for largest master data JSON)
const MAX_TOTAL_CACHE_BYTES = 20_000_000; // 20 MB total in-memory ceiling

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

const IDB_PERSISTENT_PATHS = new Set([
  "/api/master-data/json",
  "/api/asset-sync/weapon-icon-frames",
  "/api/quest-tree/graph",
  "/api/quest-tree/rules",
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
    return CACHEABLE_PATHS.has(parsed.pathname);
  } catch {
    return false;
  }
}

function isIdbPersistentRequest(url: string): boolean {
  try {
    const parsed =
      typeof window !== "undefined"
        ? new URL(url, window.location.origin)
        : new URL(url, "http://localhost");
    return IDB_PERSISTENT_PATHS.has(parsed.pathname);
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

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

    const payload: unknown = JSON.parse(bodyText);
    if (!isJsonRecord(payload)) return true;
    const countValue = payload["count"];
    const count =
      typeof countValue === "number" ? countValue : Number.NaN;
    if (Number.isFinite(count)) {
      return count > 0;
    }
    const records = payload["records"];
    if (Array.isArray(records)) {
      return records.length > 0;
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

function buildResponse(entry: CacheEntry | IdbCacheRecord): Response {
  return new Response(entry.body, {
    status: entry.status,
    headers: entry.headers,
  });
}

/**
 * Fetch with deduplication and short-lived cache (plus IndexedDB backing for master data).
 *
 * @param url    Request URL (string)
 * @param init   Optional RequestInit (only `signal` is forwarded for abort support)
 * @param ttlMs  Cache TTL in milliseconds (default 600 000 ms, or 7 days for IDB persistent data)
 */
export async function cachedFetch(
  url: string,
  init?: RequestInit,
  ttlMs?: number,
): Promise<Response> {
  if (!isCacheableRequest(url, init)) {
    const directInit: RequestInit = { ...init, cache: "no-store" };
    return fetch(url, directInit);
  }

  const cacheKey = buildCacheKey(url, init);
  const isPersistent = isIdbPersistentRequest(url);
  const effectiveTtl =
    ttlMs ?? (isPersistent ? IDB_PERSISTENT_TTL_MS : DEFAULT_TTL_MS);

  // 1. Check in-memory cache first
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.storedAt < effectiveTtl) {
    return buildResponse(cached);
  }

  // 2. Return existing in-flight request if available
  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    try {
      await inflight;
    } catch {
      // ignore; handled below
    }
    const freshCached = responseCache.get(cacheKey);
    if (freshCached && Date.now() - freshCached.storedAt < effectiveTtl) {
      return buildResponse(freshCached);
    }
    return (await inflight).clone();
  }

  // 3. For persistent endpoints, check IndexedDB before hitting network
  if (isPersistent && typeof window !== "undefined") {
    try {
      const idbEntry = await getIdbCache(cacheKey);
      if (idbEntry && Date.now() - idbEntry.storedAt < effectiveTtl) {
        // Hydrate in-memory cache from IndexedDB
        responseCache.set(cacheKey, idbEntry);
        _totalCacheBytes += idbEntry.sizeBytes;
        return buildResponse(idbEntry);
      }
    } catch {
      // Fall through to network on IDB error
    }
  }

  // 4. Make the actual network request
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
          const prev = responseCache.get(cacheKey);
          if (prev) _totalCacheBytes -= prev.sizeBytes;
          const entry: CacheEntry = {
            body: bodyText,
            status: response.status,
            headers: headerPairs,
            storedAt: Date.now(),
            sizeBytes,
          };
          responseCache.set(cacheKey, entry);
          _totalCacheBytes += sizeBytes;
          evictStaleEntries();

          // Persist to IndexedDB in background
          if (isPersistent) {
            void setIdbCache({
              key: cacheKey,
              ...entry,
            }).catch(() => undefined);
          }
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

  if (init?.signal) {
    init.signal.addEventListener(
      "abort",
      () => {
        inflightRequests.delete(cacheKey);
      },
      { once: true },
    );
  }

  return (await promise).clone();
}

/** Clear the entire fetch cache (both in-memory and IndexedDB). */
export function clearFetchCache(): void {
  responseCache.clear();
  inflightRequests.clear();
  if (typeof window !== "undefined") {
    void clearIdbCache().catch(() => undefined);
  }
}