import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkspace } from "../viewer-workspace";
import { resolveShareInput } from "../share-resolver";
import { MasterDataJsonResponseSchema } from "../api-response-schemas";

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe("Zod v4 client simulator schema boundaries", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("parses stored viewer workspace defaults, record payloads, and legacy snapshotTag migration", () => {
    localStorage.setItem(
      "__fusouViewerWorkspace",
      JSON.stringify({
        entries: [
          {
            id: "entry-1",
            name: "Fleet 1",
            sourceType: "snapshotTag",
            sourceValue: "latest",
            payloadKind: "fleetSnapshot",
            payload: { s3s: [{ id: 101 }], extraKey: "kept" },
            updatedAt: 1700000000000,
            pinned: true,
          },
        ],
      }),
    );

    const ws = loadWorkspace();
    expect(ws.activeId).toBeNull();
    expect(ws.entries).toHaveLength(1);
    expect(ws.entries[0]?.sourceType).toBe("ownDeck");
    expect(ws.entries[0]?.memo).toBe("");
    expect(ws.entries[0]?.locked).toBe(false);
    expect(ws.entries[0]?.payload).toEqual({ s3s: [{ id: 101 }], extraKey: "kept" });
  });

  it("falls back safely when stored workspace contains non-finite numbers or malformed entries", () => {
    localStorage.setItem(
      "__fusouViewerWorkspace",
      JSON.stringify({
        activeId: "entry-1",
        entries: [{ id: 123, payloadKind: "invalid" }],
      }),
    );

    expect(loadWorkspace()).toEqual({ activeId: null, entries: [] });
  });

  it("merges snapshotShips and snapshotSlotItems records in resolveShareInput and rejects non-record payloads", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          key: "0123456789abcdef",
          dataPayload: { fleets: { "1": [{ shipId: 100 }] } },
          snapshotPayload: {
            snapshotShips: { "100": { id: 100, lv: 99 } },
            snapshotSlotItems: { "500": { id: 500, rf: 10 } },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const resolved = await resolveShareInput("0123456789abcdef");
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.payload).toMatchObject({
        snapshotShips: { "100": { id: 100, lv: 99 } },
        snapshotSlotItems: { "500": { id: 500, rf: 10 } },
      });
    }

    // Non-record snapshotPayload must be rejected by Zod v4 z.record(z.string(), z.unknown())
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          key: "0123456789abcdef",
          dataPayload: { fleets: { "1": [] } },
          snapshotPayload: ["not", "an", "object"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const invalid = await resolveShareInput("0123456789abcdef");
    expect(invalid).toEqual({ ok: false, error: "APIレスポンスの形式が不正です" });
  });

  it("validates MasterDataJsonResponseSchema string-keyed record arrays and preserves passthrough fields", () => {
    const parsed = MasterDataJsonResponseSchema.safeParse({
      records: [{ id: 1, name: "睦月" }],
      period_tag: "2026-10-14",
      period_revision: 2,
      extra_meta: "preserved",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        records: [{ id: 1, name: "睦月" }],
        extra_meta: "preserved",
      });
    }

    const bad = MasterDataJsonResponseSchema.safeParse({
      records: ["not-a-record"],
    });
    expect(bad.success).toBe(false);
  });
});

