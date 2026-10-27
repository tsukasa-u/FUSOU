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
    vi.useRealTimers();
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

  it("does not share cancellation between signal-owning callers", async () => {
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        if (fetchMock.mock.calls.length === 2) {
          resolve(Response.json({ ok: true }));
        }
      }),
    );
    globalThis.fetch = fetchMock;
    const first = new AbortController();
    const second = new AbortController();
    const url = "/api/battle-data/detail-env?env_uuid=sortie";
    const firstResult = cachedFetch(url, { signal: first.signal });
    const firstRejected = expect(firstResult).rejects.toMatchObject({ name: "AbortError" });
    const secondResult = cachedFetch(url, { signal: second.signal });
    first.abort();
    await firstRejected;
    expect(await (await secondResult).json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates persistent requests while IndexedDB lookup is pending", async () => {
    let finishRead!: (value: idb.IdbCacheRecord | null) => void;
    vi.mocked(idb.getIdbCache).mockReturnValue(new Promise((resolve) => {
      finishRead = resolve;
    }));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    globalThis.fetch = fetchMock;
    const first = cachedFetch("/api/master-data/json");
    const second = cachedFetch("/api/master-data/json");
    finishRead(null);
    const responses = await Promise.all([first, second]);
    expect(await responses[0]!.json()).toEqual({ ok: true });
    expect(await responses[1]!.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not let an older response replace a forced refresh", async () => {
    let finishOld!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(Response.json({ revision: 2 }));
    globalThis.fetch = fetchMock;
    const url = "/api/ship-growth/summary";
    const old = cachedFetch(url);
    await cachedFetch(url, { cache: "reload" });
    finishOld(Response.json({ revision: 1 }));
    await old;
    expect(await (await cachedFetch(url)).json()).toEqual({ revision: 2 });
  });

  it("keeps a request coalesced until its cache body has finished reading", async () => {
    let finishBody!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        finishBody = () => {
          controller.enqueue(new TextEncoder().encode('{"ok":true}'));
          controller.close();
        };
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      headers: { "content-type": "application/json" },
    }));
    globalThis.fetch = fetchMock;
    const first = cachedFetch("/api/ship-growth/summary");
    await Promise.resolve();
    const second = cachedFetch("/api/ship-growth/summary");
    finishBody();
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache malformed JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("broken", { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    globalThis.fetch = fetchMock;
    const url = "/api/ship-growth/summary";
    await cachedFetch(url);
    expect(await (await cachedFetch(url)).json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not revalidate or serve corrupt JSON already persisted in IndexedDB", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const key = "GET:/api/master-data/json";
    idbStore.set(key, {
      key, body: "broken", status: 200, headers: [["etag", '"old"']],
      storedAt: Date.now(), sizeBytes: 6,
    });
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    globalThis.fetch = fetchMock;
    expect(await (await cachedFetch("/api/master-data/json")).json()).toEqual({ ok: true });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).has("If-None-Match")).toBe(false);
  });

  it("respects max-age and Age instead of extending server freshness to ten minutes", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ revision: 1 }, {
        headers: { "cache-control": "public, max-age=60", age: "55" },
      }))
      .mockResolvedValueOnce(Response.json({ revision: 2 }));
    globalThis.fetch = fetchMock;
    const url = "/api/ship-growth/summary";
    await cachedFetch(url);
    vi.advanceTimersByTime(6000);
    expect(await (await cachedFetch(url)).json()).toEqual({ revision: 2 });
  });

  it("revalidates in-memory persistent data after ten minutes, not seven days", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ revision: 1 }, { headers: { etag: '"one"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    globalThis.fetch = fetchMock;
    const url = "/api/master-data/json";
    await cachedFetch(url);
    vi.advanceTimersByTime(11 * 60_000);
    expect(await (await cachedFetch(url)).json()).toEqual({ revision: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get("If-None-Match")).toBe('"one"');
  });

  it("never revives IndexedDB entries older than the seven-day ceiling", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const key = "GET:/api/master-data/json";
    idbStore.set(key, {
      key, body: '{"stale":true}', status: 200, headers: [["etag", '"old"']],
      storedAt: Date.now() - 8 * 24 * 3600_000, sizeBytes: 14,
    });
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    globalThis.fetch = fetchMock;
    await expect(cachedFetch("/api/master-data/json")).rejects.toThrow("offline");
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).has("If-None-Match")).toBe(false);
  });

  it("does not turn cancellation into a successful offline response", async () => {
    const key = "GET:/api/master-data/json";
    idbStore.set(key, {
      key, body: '{"stale":true}', status: 200, headers: [],
      storedAt: Date.now() - 15 * 60_000, sizeBytes: 14,
    });
    const controller = new AbortController();
    globalThis.fetch = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(controller.signal.reason);
    });
    await expect(cachedFetch("/api/master-data/json", { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not repopulate cleared caches from pending requests", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(Response.json({ revision: 2 }));
    globalThis.fetch = fetchMock;
    const old = cachedFetch("/api/ship-growth/summary");
    clearFetchCache();
    finish(Response.json({ revision: 1 }));
    await old;
    expect(await (await cachedFetch("/api/ship-growth/summary")).json()).toEqual({ revision: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("removes encoding and length headers when reconstructing decoded bodies", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }, {
      headers: { "content-encoding": "br", "content-length": "999" },
    }));
    const url = "/api/ship-growth/summary";
    await cachedFetch(url);
    const cached = await cachedFetch(url);
    expect(cached.headers.has("content-encoding")).toBe(false);
    expect(cached.headers.has("content-length")).toBe(false);
    expect(await cached.json()).toEqual({ ok: true });
  });
});
