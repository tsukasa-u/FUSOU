import { afterEach, describe, it, expect, vi } from "vitest";
import {
  compressJsonToBrotli,
  decompressBrotliToJson,
  normalizeTableVersion,
  getShipGrowthBoundsSnapshotKey,
  getShipGrowthExpSnapshotKey,
  serveShipGrowthSnapshot,
  rebuildAllShipGrowthSnapshots,
  SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY,
  SHIP_GROWTH_CUMULATIVE_SNAPSHOT_KEY,
  SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY,
  SHIP_GROWTH_MANIFEST_KEY,
  MAX_SHIP_GROWTH_JSON_BYTES,
  getShipGrowthSnapshot,
  refreshShipGrowthPeriodSnapshots,
} from "../ship-growth-snapshots";
import type { R2Bucket, R2ObjectBody, D1PreparedStatement } from "@cloudflare/workers-types";
import type { Bindings, D1Database } from "../../types";
import shipGrowthApp from "../../routes/ship_growth";

vi.mock("@fusou/avro-wasm", () => ({
  initWasm: vi.fn(),
  get_schema_json: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

function memoryBucket() {
  const storage = new Map<string, Uint8Array>();
  const versions = new Map<string, string>();
  let version = 0;
  const put = vi.fn(async (key: string, value: string | Uint8Array, options?: {
    onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
  }) => {
    if (options?.onlyIf?.etagMatches && versions.get(key) !== options.onlyIf.etagMatches) return null;
    if (options?.onlyIf?.etagDoesNotMatch === "*" && storage.has(key)) return null;
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
    storage.set(key, bytes);
    const etag = String(++version);
    versions.set(key, etag);
    return {
      key, version: etag, size: bytes.byteLength, etag, httpEtag: `"${etag}"`,
      storageClass: "Standard",
      uploaded: new Date(), checksums: { toJSON: () => ({}) },
      writeHttpMetadata: () => undefined,
    };
  });
  const bucket = {
    head: async () => null,
    createMultipartUpload: () => { throw new Error("Not implemented in test"); },
    resumeMultipartUpload: () => { throw new Error("Not implemented in test"); },
    get: vi.fn(async (key: string) => {
      const data = storage.get(key);
      if (!data) return null;
      return {
        key, size: data.byteLength, etag: versions.get(key) ?? "initial",
        arrayBuffer: async () => Uint8Array.from(data).buffer,
        text: async () => new TextDecoder().decode(data),
        json: async () => JSON.parse(new TextDecoder().decode(data)),
      } as R2ObjectBody;
    }),
    list: vi.fn(async () => ({
      objects: [...storage.keys()].filter((key) => key.startsWith("ship-growth/archive/"))
        .map((key) => ({
          key, version: "initial", size: storage.get(key)!.byteLength,
          etag: "initial", httpEtag: '"initial"', uploaded: new Date(),
          storageClass: "Standard", checksums: { toJSON: () => ({}) },
          writeHttpMetadata: () => undefined,
        })),
      truncated: false as const, delimitedPrefixes: [],
    })),
    put,
    delete: vi.fn(async (key: string) => { storage.delete(key); }),
  };
  return { bucket: bucket as R2Bucket, storage, put, versions };
}

function database(bounds: Array<Record<string, unknown>> = [], exp: Array<Record<string, unknown>> = []) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const meta = {
    duration: 0, size_after: 0, rows_read: 0, rows_written: 0,
    last_row_id: 0, changed_db: false, changes: 0,
  };
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => { args = values; return statement; },
      first: async <T>() => ({ c: bounds.length } as T),
      run: () => { throw new Error("Not implemented in test"); },
      raw: () => { throw new Error("Not implemented in test"); },
      all: async <T>() => {
        calls.push({ sql, args });
        if (sql.includes("UNION")) {
          return { success: true as const, meta, results: [...bounds, ...exp].map((row) => ({
            period_tag: row["period_tag"], table_version: row["table_version"],
          })) as T[] };
        }
        const rows = sql.includes("ship_growth_caps") ? []
          : sql.includes("ship_level_exp_pairs") ? exp : bounds;
        return { success: true as const, meta, results: rows.filter((row) =>
          row["period_tag"] === args[0] && (row["table_version"] === args[1] || row["table_version"] === args[2])) as T[] };
      },
    };
    return statement;
  };
  const db: D1Database = {
    exec: () => { throw new Error("Not implemented in test"); },
    dump: () => { throw new Error("Not implemented in test"); },
    withSession: () => { throw new Error("Not implemented in test"); },
    prepare,
    batch: async <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map((s) => s.all<T>())),
  };
  return { db, calls };
}

function bound(value: number, version = "0.5") {
  return {
    row_id: 1, master_id: 1, lv: 1,
    kaihi_naked: value, taisen_naked: value, sakuteki_naked: value, lucky_naked: value,
    period_tag: "2026-07-08", table_version: version, updated_at: 1,
  };
}

async function archive(bucket: R2Bucket, key: string, values: number[]) {
  await bucket.put(`ship-growth/archive/${key}`, JSON.stringify({
    archived_at: 1, rows: { bounds: values.map((value) => bound(value)), caps: [] },
  }));
}

describe("ship-growth-snapshots utility", () => {
  it("normalizes table versions to 0.5.0", () => {
    expect(normalizeTableVersion("0.5")).toBe("0.5.0");
    expect(normalizeTableVersion(" 0.5 ")).toBe("0.5.0");
    expect(normalizeTableVersion("0.5.0")).toBe("0.5.0");
    expect(normalizeTableVersion("0.6.0")).toBe("0.6.0");
  });

  it("compresses JSON to Brotli and decompresses back accurately", async () => {
    const original = {
      ok: true,
      period_tag: "2026-10-14",
      table_version: "0.6.0",
      bounds: [
        { master_id: 1, lv: 1, kaihi_naked: 30, taisen_naked: 20, sakuteki_naked: 10, lucky_naked: 12 },
        { master_id: 1, lv: 2, kaihi_naked: 31, taisen_naked: 21, sakuteki_naked: 10, lucky_naked: 12 },
      ],
      caps: [
        { master_id: 1, kaihi_max: 79, taisen_max: 59, sakuteki_max: 39 },
      ],
    };

    const compressed = await compressJsonToBrotli(original);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.length).toBeGreaterThan(0);

    const recovered = await decompressBrotliToJson<typeof original>(compressed);
    expect(recovered).toEqual(original);
  });

  it("generates correct snapshot key names with version normalization", () => {
    expect(getShipGrowthBoundsSnapshotKey("2026-10-14", "0.6.0")).toBe(
      "snapshots/ship_growth/bounds/2026-10-14_0.6.0.json.br"
    );
    expect(getShipGrowthExpSnapshotKey("2026-10-14", "0.6.0")).toBe(
      "snapshots/ship_growth/exp/2026-10-14_0.6.0.json.br"
    );
    // 0.5 normalized to 0.5.0
    expect(getShipGrowthBoundsSnapshotKey("2026-07-08", "0.5")).toBe(
      "snapshots/ship_growth/bounds/2026-07-08_0.5.0.json.br"
    );
    expect(getShipGrowthExpSnapshotKey("2026-07-08", "0.5")).toBe(
      "snapshots/ship_growth/exp/2026-07-08_0.5.0.json.br"
    );
  });

  it("serves decompressed plain JSON so browser fetch does not crash on .json()", async () => {
    const data = { ok: true, periods: [{ period_tag: "2026-10-14", table_version: "0.6.0" }] };
    const compressed = await compressJsonToBrotli(data);

    const mockR2Obj = {
      body: new ReadableStream(),
      httpEtag: '"mock-etag"',
      arrayBuffer: async () => compressed.buffer,
    } as any;

    const mockContext = {
      req: {
        header: (name: string) => (name === "accept-encoding" ? "gzip, deflate, br" : ""),
      },
    } as any;

    const res = await serveShipGrowthSnapshot(mockContext, mockR2Obj);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    // Crucial: No Content-Encoding: br so browser res.json() receives valid JSON, not raw Brotli binary!
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(res.headers.get("X-FUSOU-Cache")).toBe("SNAPSHOT-HIT");
    expect(res.headers.get("X-FUSOU-Data-Source")).toBe("R2-SNAPSHOT");
    expect(res.headers.get("ETag")).toBe('"mock-etag"');

    const json = await res.json();
    expect(json).toEqual(data);
  });

  it("rebuilds all snapshots and unifies 0.5 to 0.5.0", async () => {
    const storage = new Map<string, Uint8Array>();

    const mockArchivePayload = {
      archived_at: 1720000000,
      period_tag_new: "2026-10-14",
      table_version_new: "0.6.0",
      rows: {
        bounds: [
          {
            row_id: 1,
            master_id: 1,
            lv: 1,
            kaihi_naked: 30,
            taisen_naked: 20,
            sakuteki_naked: 10,
            lucky_naked: 12,
            period_tag: "2026-07-08",
            table_version: "0.5", // Legacy unnormalized version
          },
        ],
        caps: [
          {
            row_id: 1,
            master_id: 1,
            kaihi_max: 79,
            taisen_max: 59,
            sakuteki_max: 39,
            period_tag: "2026-07-08",
            table_version: "0.5", // Legacy unnormalized version
          },
        ],
      },
    };

    const mockArchiveBucket = {
      list: vi.fn().mockResolvedValue({
        objects: [{ key: "ship-growth/archive/2026-10-14/0.6.0/archive-1.json" }],
        truncated: false,
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        if (key === "ship-growth/archive/2026-10-14/0.6.0/archive-1.json") {
          return {
            text: async () => JSON.stringify(mockArchivePayload),
          };
        }
        const data = storage.get(key);
        if (!data) return null;
        return {
          arrayBuffer: async () => data.buffer,
          text: async () => (await decompressBrotliToJson<any>(data)),
        };
      }),
      put: vi.fn().mockImplementation(async (key: string, data: Uint8Array) => {
        storage.set(key, typeof data === "string" ? new TextEncoder().encode(data) : data);
        return { etag: "stored" };
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const mockEnv = {
      SHIP_GROWTH_ARCHIVE_BUCKET: mockArchiveBucket,
    } as any;

    const res = await rebuildAllShipGrowthSnapshots(mockEnv);
    expect(res.archive_object_count).toBe(1);
    expect(res.periods.length).toBeGreaterThan(0);
    // Verified: table_version is normalized from 0.5 to 0.5.0!
    expect(res.periods[0]?.period_tag).toBe("2026-07-08");
    expect(res.periods[0]?.table_version).toBe("0.5.0");

    // Check generated snapshots
    expect(storage.has(SHIP_GROWTH_MANIFEST_KEY)).toBe(true);
    const manifest = JSON.parse(new TextDecoder().decode(storage.get(SHIP_GROWTH_MANIFEST_KEY)));
    expect(storage.has(manifest.objects[SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY])).toBe(true);
    expect(storage.has(manifest.objects[SHIP_GROWTH_CUMULATIVE_SNAPSHOT_KEY])).toBe(true);
    expect(storage.has(manifest.objects[SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY])).toBe(true);

    // Verify all-periods snapshot contains both 'entries' and 'periods' for client compatibility
    const allPeriodsData = await decompressBrotliToJson<any>(storage.get(manifest.objects[SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY])!);
    expect(allPeriodsData.ok).toBe(true);
    expect(Array.isArray(allPeriodsData.entries)).toBe(true);
    expect(Array.isArray(allPeriodsData.periods)).toBe(true);
    expect(allPeriodsData.entries.length).toBeGreaterThan(0);
    // Key has 0.5.0, not 0.5
    expect(storage.has(manifest.objects[getShipGrowthBoundsSnapshotKey("2026-07-08", "0.5")])).toBe(true);
    expect(storage.has("snapshots/ship_growth/bounds/2026-07-08_0.5.json.br")).toBe(false);
  });

  it.each([[30, 0, 30], [0, 30, 30], [30, 20, 20], [0, 0, 0]])(
    "merges archive observations %i and %i into %i without treating zero as a minimum",
    async (first, second, expected) => {
      const { bucket } = memoryBucket();
      await archive(bucket, "one.json", [first!, second!]);
      await rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket });
      const object = await getShipGrowthSnapshot(bucket, SHIP_GROWTH_CUMULATIVE_SNAPSHOT_KEY);
      const payload = await decompressBrotliToJson<{ bounds: ReturnType<typeof bound>[] }>(await object!.arrayBuffer());
      expect(payload.bounds[0]).toMatchObject({
        kaihi_naked: expected, taisen_naked: expected, sakuteki_naked: expected, lucky_naked: expected,
      });
    },
  );

  it("queries both D1 aliases and merges overlap once before publishing period snapshots", async () => {
    const { bucket } = memoryBucket();
    await archive(bucket, "one.json", [30]);
    const { db, calls } = database([bound(20), { ...bound(0, "0.5.0"), lv: 2 }], [
      { period_tag: "2026-07-08", table_version: "0.5", lv: 1, exp_current: 0, updated_at: 1 },
    ]);
    await rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket }, db);
    const object = await getShipGrowthSnapshot(bucket, SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY);
    const payload = await decompressBrotliToJson<{ entries: Array<{ bounds: ReturnType<typeof bound>[] }> }>(await object!.arrayBuffer());
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]!.bounds).toHaveLength(2);
    expect(payload.entries[0]!.bounds[0]!.kaihi_naked).toBe(20);
    expect(calls.some((call) => call.args[1] === "0.5.0" && call.args[2] === "0.5")).toBe(true);
    const expObject = await getShipGrowthSnapshot(bucket, getShipGrowthExpSnapshotKey("2026-07-08", "0.5"));
    expect(await decompressBrotliToJson(await expObject!.arrayBuffer())).toMatchObject({ exp: [{ lv: 1, exp_current: 0 }] });
  });

  it("discovers historical EXP independently of bounds", async () => {
    const { bucket } = memoryBucket();
    const { db } = database([], [
      { period_tag: "2026-07-08", table_version: "0.5", lv: 1, exp_current: 0, updated_at: 1 },
    ]);
    await rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket }, db);
    const object = await getShipGrowthSnapshot(bucket, getShipGrowthExpSnapshotKey("2026-07-08", "0.5"));
    expect(await decompressBrotliToJson(await object!.arrayBuffer())).toMatchObject({ rows: [{ lv: 1, exp_current: 0 }] });
  });

  it("keeps the last published generation and legacy keys on invalid inputs or write failure", async () => {
    const { bucket, storage, put } = memoryBucket();
    await archive(bucket, "one.json", [30]);
    await rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket });
    const originalManifest = storage.get(SHIP_GROWTH_MANIFEST_KEY);
    await bucket.put("snapshots/ship_growth/bounds/other_0.5.json.br", "legacy");
    await bucket.put("ship-growth/archive/broken.json", "broken");
    await expect(rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket })).rejects.toThrow();
    expect(storage.get(SHIP_GROWTH_MANIFEST_KEY)).toBe(originalManifest);
    storage.delete("ship-growth/archive/broken.json");
    put.mockRejectedValueOnce(new Error("R2 unavailable"));
    await expect(rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket })).rejects.toThrow("R2 unavailable");
    expect(storage.get(SHIP_GROWTH_MANIFEST_KEY)).toBe(originalManifest);
    expect(storage.has("snapshots/ship_growth/bounds/other_0.5.json.br")).toBe(true);
  });

  it("does not publish a configured D1 failure as an archive-only success", async () => {
    const { bucket, storage } = memoryBucket();
    const { db } = database();
    vi.spyOn(db, "prepare").mockImplementation(() => { throw new Error("D1 unavailable"); });
    await expect(rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket }, db)).rejects.toThrow("D1 unavailable");
    expect(storage.has(SHIP_GROWTH_MANIFEST_KEY)).toBe(false);
  });

  it("refreshes committed observations and summary atomically without rescanning archives", async () => {
    const { bucket, storage } = memoryBucket();
    const rows = [bound(30)];
    const { db } = database(rows);
    await rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket }, db);
    const originalManifest = storage.get(SHIP_GROWTH_MANIFEST_KEY);
    rows[0] = bound(20, "0.5.0");
    vi.mocked(bucket.list).mockClear();
    await refreshShipGrowthPeriodSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket }, db, "2026-07-08", "0.5");
    expect(storage.get(SHIP_GROWTH_MANIFEST_KEY)).not.toBe(originalManifest);
    expect(bucket.list).not.toHaveBeenCalled();
    const object = await getShipGrowthSnapshot(bucket, getShipGrowthBoundsSnapshotKey("2026-07-08", "0.5"));
    expect(await decompressBrotliToJson(await object!.arrayBuffer())).toMatchObject({ bounds: [{ kaihi_naked: 20 }] });
  });

  it("fails closed on a published object disappearing", async () => {
    const { bucket, storage } = memoryBucket();
    await rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket });
    const manifest = JSON.parse(new TextDecoder().decode(storage.get(SHIP_GROWTH_MANIFEST_KEY)));
    storage.delete(manifest.objects[SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY]);
    await expect(getShipGrowthSnapshot(bucket, SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY)).rejects.toThrow("missing");
  });

  it("finishes archive listings beyond fifty pages and refuses a stuck cursor", async () => {
    const { bucket, storage } = memoryBucket();
    let page = 0;
    vi.mocked(bucket.list).mockImplementation(async () => ++page < 52
      ? { objects: [], truncated: true, cursor: String(page), delimitedPrefixes: [] }
      : { objects: [], truncated: false, delimitedPrefixes: [] });
    await rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket });
    expect(page).toBe(52);
    const previous = storage.get(SHIP_GROWTH_MANIFEST_KEY);
    vi.mocked(bucket.list).mockResolvedValue({
      objects: [], truncated: true, cursor: "stuck", delimitedPrefixes: [],
    });
    await expect(rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket }))
      .rejects.toThrow("Incomplete");
    expect(storage.get(SHIP_GROWTH_MANIFEST_KEY)).toBe(previous);
  });

  it("allows only one concurrent initial manifest publication", async () => {
    const { bucket } = memoryBucket();
    const results = await Promise.allSettled([
      rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket }),
      rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await getShipGrowthSnapshot(bucket, SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY)).not.toBeNull();
  });

  it("does not lose concurrently refreshed periods during manifest publication", async () => {
    const { bucket } = memoryBucket();
    await rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket });
    const first = database([bound(20)]);
    const second = database([{ ...bound(25), period_tag: "2026-08-05" }]);
    await Promise.all([
      refreshShipGrowthPeriodSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket }, first.db, "2026-07-08", "0.5"),
      refreshShipGrowthPeriodSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket }, second.db, "2026-08-05", "0.5"),
    ]);
    const summary = await getShipGrowthSnapshot(bucket, SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY);
    const payload = await decompressBrotliToJson<{ periods: unknown[] }>(await summary!.arrayBuffer());
    expect(payload.periods).toHaveLength(2);
    expect(await getShipGrowthSnapshot(bucket, getShipGrowthBoundsSnapshotKey("2026-07-08", "0.5"))).not.toBeNull();
    expect(await getShipGrowthSnapshot(bucket, getShipGrowthBoundsSnapshotKey("2026-08-05", "0.5"))).not.toBeNull();
  });

  it("handles plain JSON identically and rejects corrupt and oversized decompressed input", async () => {
    expect(await decompressBrotliToJson(new TextEncoder().encode('{"ok":true}'))).toEqual({ ok: true });
    await expect(decompressBrotliToJson(new Uint8Array())).rejects.toThrow();
    await expect(compressJsonToBrotli(" ".repeat(MAX_SHIP_GROWTH_JSON_BYTES + 1))).rejects.toThrow("16 MiB");
    const { brotliCompressSync } = await import("node:zlib");
    const compressed = brotliCompressSync(Buffer.from(`"${"x".repeat(MAX_SHIP_GROWTH_JSON_BYTES)}"`));
    await expect(decompressBrotliToJson(compressed)).rejects.toThrow();
  });

  describe("ship-growth snapshot read routes", () => {
    it("serves all five read endpoints without a D1 binding and ahead of stale HTTP cache", async () => {
      const { bucket } = memoryBucket();
      await archive(bucket, "one.json", [30]);
      await rebuildAllShipGrowthSnapshots({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket });
      const match = vi.fn().mockResolvedValue(Response.json({ old_generation: true }));
      vi.stubGlobal("caches", { default: { match } });
      const env = { SHIP_GROWTH_ARCHIVE_BUCKET: bucket } as Bindings;
      for (const path of [
        "/summary", "/cumulative", "/all-periods",
        "/bounds?period_tag=2026-07-08&table_version=0.5",
        "/bounds?period_tag=2026-07-08&table_version=0.5.0&master_id=1",
        "/exp?period_tag=2026-07-08&table_version=0.5",
      ]) {
        const response = await shipGrowthApp.request(path, {}, env);
        expect(response.status, path).toBe(200);
        expect(await response.json()).toMatchObject({ ok: true });
        expect(response.headers.has("content-encoding")).toBe(false);
      }
      expect(match).not.toHaveBeenCalled();
    });

    it("accepts plain JSON for filtered bounds and rejects fractional or trailing master ids", async () => {
      const { bucket } = memoryBucket();
      await bucket.put(getShipGrowthBoundsSnapshotKey("2026-07-08", "0.5"), JSON.stringify({
        ok: true, bounds: [bound(30)], caps: [],
      }));
      const env = { SHIP_GROWTH_ARCHIVE_BUCKET: bucket } as Bindings;
      const response = await shipGrowthApp.request("/bounds?period_tag=2026-07-08&table_version=0.5&master_id=1", {}, env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ bounds: [{ kaihi_naked: 30 }] });
      for (const invalid of ["1abc", "1.5", "-1", "0", "9007199254740992"]) {
        const result = await shipGrowthApp.request(`/bounds?period_tag=2026-07-08&table_version=0.5&master_id=${invalid}`, {}, env);
        expect(result.status).toBe(400);
      }
    });

    it("returns 503 instead of caching an invalid R2 body or silently falling back to D1", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { bucket } = memoryBucket();
      await bucket.put(SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY, "broken");
      const { db } = database();
      const prepare = vi.spyOn(db, "prepare");
      const response = await shipGrowthApp.request("/summary", {}, {
        SHIP_GROWTH_ARCHIVE_BUCKET: bucket, SHIP_GROWTH_DB: db,
      } as Bindings);
      expect(response.status).toBe(503);
      expect(prepare).not.toHaveBeenCalled();
    });

    it("accepts either configured rebuild token and rejects unauthenticated calls before I/O", async () => {
      const { bucket } = memoryBucket();
      const env = Object.assign({ SHIP_GROWTH_ARCHIVE_BUCKET: bucket } as Bindings, {
        ADMIN_TOKEN: "admin-test",
        INTERNAL_COMPACTION_TOKEN: "internal-test",
      });
      const unauthorized = await shipGrowthApp.request("/internal/rebuild-snapshots", { method: "POST" }, env);
      expect(unauthorized.status).toBe(401);
      expect(bucket.get).not.toHaveBeenCalled();
      expect(bucket.list).not.toHaveBeenCalled();
      for (const token of ["internal-test", "admin-test"]) {
        const response = await shipGrowthApp.request("/internal/rebuild-snapshots", {
          method: "POST", headers: { authorization: `Bearer ${token}` },
        }, env);
        expect(response.status).toBe(200);
      }
    });
  });
});
