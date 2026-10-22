import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cachedFetch, clearFetchCache } from "../fetchCache";
import * as idb from "../indexedDbCache";

describe("fetchCache with IndexedDB and ETag revalidation", () => {
  const originalFetch = globalThis.fetch;
  let idbStore = new Map<string, idb.IdbCacheRecord>();

  beforeEach(() => {
    idbStore.clear();
    clearFetchCache();

    vi.spyOn(idb, "getIdbCache").mockImplementation(async (key) => idbStore.get(key) || null);
    vi.spyOn(idb, "setIdbCache").mockImplementation(async (record) => {
      idbStore.set(record.key, record);
    });
    vi.spyOn(idb, "clearIdbCache").mockImplementation(async () => {
      idbStore.clear();
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("serves from in-memory cache without hitting network on repeated calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ table_name: "mst_ship", count: 1 }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
          "ETag": 'W/"mst_ship-1"',
        },
      }),
    );
    globalThis.fetch = fetchMock;

    const res1 = await cachedFetch("/api/master-data/json?table_name=mst_ship");
    expect(res1.ok).toBe(true);
    expect(await res1.json()).toEqual({ table_name: "mst_ship", count: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call: in-memory cache hit
    const res2 = await cachedFetch("/api/master-data/json?table_name=mst_ship");
    expect(res2.ok).toBe(true);
    expect(await res2.json()).toEqual({ table_name: "mst_ship", count: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("revalidates stale IndexedDB cache with If-None-Match and serves cached body on 304", async () => {
    // Seed IndexedDB with stale master data (> 10 minutes old)
    const oldEntry: idb.IdbCacheRecord = {
      key: "GET:/api/master-data/json?table_name=mst_ship",
      body: JSON.stringify({ table_name: "mst_ship", records: [{ id: 1, name: "睦月" }] }),
      status: 200,
      headers: [
        ["content-type", "application/json"],
        ["etag", 'W/"mst_ship-old-tag"'],
      ],
      storedAt: Date.now() - 15 * 60_000, // 15 minutes ago
      sizeBytes: 100,
    };
    idbStore.set(oldEntry.key, oldEntry);

    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("If-None-Match")).toBe('W/"mst_ship-old-tag"');
      // Server responds 304 Not Modified
      return Promise.resolve(new Response(null, { status: 304, headers: { ETag: 'W/"mst_ship-old-tag"' } }));
    });
    globalThis.fetch = fetchMock;

    const res = await cachedFetch("/api/master-data/json?table_name=mst_ship");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200); // Transparent 200 to client
    const json = await res.json();
    expect(json).toEqual({ table_name: "mst_ship", records: [{ id: 1, name: "睦月" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Stored timestamp should be updated to fresh
    const updated = idbStore.get(oldEntry.key);
    expect(updated?.storedAt).toBeGreaterThan(Date.now() - 1000);
  });

  it("updates IndexedDB and serves new data when server returns 200 after maintenance", async () => {
    // Seed IndexedDB with old data
    const oldEntry: idb.IdbCacheRecord = {
      key: "GET:/api/master-data/json?table_name=mst_ship",
      body: JSON.stringify({ table_name: "mst_ship", period_tag: "2026-08-05", records: [] }),
      status: 200,
      headers: [
        ["content-type", "application/json"],
        ["etag", 'W/"mst_ship-2026-08-05"'],
      ],
      storedAt: Date.now() - 15 * 60_000,
      sizeBytes: 80,
    };
    idbStore.set(oldEntry.key, oldEntry);

    // Server returns 200 with new maintenance data
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ table_name: "mst_ship", period_tag: "2026-10-22", records: [{ id: 999 }] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
          "ETag": 'W/"mst_ship-2026-10-22"',
        },
      }),
    );
    globalThis.fetch = fetchMock;

    const res = await cachedFetch("/api/master-data/json?table_name=mst_ship");
    expect(res.ok).toBe(true);
    const json = (await res.json()) as { period_tag?: string; records?: unknown[] };
    expect(json.period_tag).toBe("2026-10-22");
    expect(json.records).toEqual([{ id: 999 }]);

    // IndexedDB should now contain the new payload
    const updated = idbStore.get(oldEntry.key);
    expect(updated?.body).toContain("2026-10-22");
  });

  it("bypasses cache when cache: 'reload' is passed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ count: 10 }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
        },
      }),
    );
    globalThis.fetch = fetchMock;

    await cachedFetch("/api/master-data/json?table_name=mst_ship");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Force reload
    await cachedFetch("/api/master-data/json?table_name=mst_ship", { cache: "reload" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
