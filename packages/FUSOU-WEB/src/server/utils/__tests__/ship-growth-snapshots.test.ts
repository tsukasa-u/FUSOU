import { describe, it, expect, vi } from "vitest";
import {
  compressJsonToBrotli,
  decompressBrotliToJson,
  getShipGrowthBoundsSnapshotKey,
  getShipGrowthExpSnapshotKey,
  serveShipGrowthSnapshot,
    rebuildAllShipGrowthSnapshots,
  SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY,
  SHIP_GROWTH_CUMULATIVE_SNAPSHOT_KEY,
  SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY,
} from "../ship-growth-snapshots";

describe("ship-growth-snapshots utility", () => {
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

  it("generates correct snapshot key names", () => {
    expect(getShipGrowthBoundsSnapshotKey("2026-10-14", "0.6.0")).toBe(
      "snapshots/ship_growth/bounds/2026-10-14_0.6.0.json.br"
    );
    expect(getShipGrowthExpSnapshotKey("2026-10-14", "0.6.0")).toBe(
      "snapshots/ship_growth/exp/2026-10-14_0.6.0.json.br"
    );
  });

  it("streams snapshot with br Content-Encoding when client supports br", async () => {
    const data = { ok: true, test: 123 };
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
    expect(res.headers.get("Content-Encoding")).toBe("br");
    expect(res.headers.get("X-FUSOU-Cache")).toBe("SNAPSHOT-HIT");
    expect(res.headers.get("X-FUSOU-Data-Source")).toBe("R2-SNAPSHOT");
    expect(res.headers.get("ETag")).toBe('"mock-etag"');
  });

  it("decompresses snapshot to plain JSON when client does not support br", async () => {
    const data = { ok: true, message: "decompressed" };
    const compressed = await compressJsonToBrotli(data);

    const mockR2Obj = {
      body: new ReadableStream(),
      httpEtag: '"mock-etag-2"',
      arrayBuffer: async () => compressed.buffer,
    } as any;

    const mockContext = {
      req: {
        header: (name: string) => (name === "accept-encoding" ? "gzip, deflate" : ""),
      },
    } as any;

    const res = await serveShipGrowthSnapshot(mockContext, mockR2Obj);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Content-Encoding")).toBeNull();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(data);
  });

  it("rebuilds all snapshots from mock R2 archives and D1", async () => {
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
            period_tag: "2026-08-05",
            table_version: "0.5.1",
          },
        ],
        caps: [
          {
            row_id: 1,
            master_id: 1,
            kaihi_max: 79,
            taisen_max: 59,
            sakuteki_max: 39,
            period_tag: "2026-08-05",
            table_version: "0.5.1",
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
        storage.set(key, data);
      }),
    };

    const mockEnv = {
      SHIP_GROWTH_ARCHIVE_BUCKET: mockArchiveBucket,
    } as any;

    const res = await rebuildAllShipGrowthSnapshots(mockEnv);
    expect(res.archive_object_count).toBe(1);
    expect(res.periods.length).toBeGreaterThan(0);
    expect(res.periods[0]?.period_tag).toBe("2026-08-05");
    expect(res.periods[0]?.table_version).toBe("0.5.1");

    // Check generated snapshots
    expect(storage.has(SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY)).toBe(true);
    expect(storage.has(SHIP_GROWTH_CUMULATIVE_SNAPSHOT_KEY)).toBe(true);
    expect(storage.has(SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY)).toBe(true);
    expect(storage.has("snapshots/ship_growth/bounds/2026-08-05_0.5.1.json.br")).toBe(true);
  });
});
