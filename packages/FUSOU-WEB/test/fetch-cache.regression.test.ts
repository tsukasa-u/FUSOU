import { afterEach, describe, expect, it, vi } from "vitest";

import { cachedFetch, clearFetchCache } from "../src/utils/fetchCache.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearFetchCache();
  vi.restoreAllMocks();
});

describe("fetch cache regressions", () => {
  it("does not cache empty battle-data global record responses", async () => {
    let callCount = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      expect(init?.cache).toBe("no-store");

      const payload =
        callCount === 1
          ? { success: true, count: 0, records: [] }
          : {
              success: true,
              count: 1,
              records: [{ uuid: "battle-1", env_uuid: "env-1" }],
            };

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=600",
        },
      });
    }) as typeof fetch;

    const url =
      "/api/battle-data/global/records?table=enemy_ship&period_tag=all&filter_json=%7B%22env_uuid%22%3A%22env-1%22%7D";

    const first = await cachedFetch(url);
    const firstJson = (await first.json()) as { count: number; records: unknown[] };
    expect(firstJson.count).toBe(0);
    expect(firstJson.records).toEqual([]);

    const second = await cachedFetch(url);
    const secondJson = (await second.json()) as {
      count: number;
      records: Array<{ uuid: string; env_uuid: string }>;
    };
    expect(secondJson.count).toBe(1);
    expect(secondJson.records).toEqual([{ uuid: "battle-1", env_uuid: "env-1" }]);
    expect(callCount).toBe(2);
  });

  it("continues caching non-empty battle-data global record responses", async () => {
    let callCount = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      expect(init?.cache).toBe("no-store");

      return new Response(
        JSON.stringify({
          success: true,
          count: 1,
          records: [{ uuid: "enemy-deck-1" }],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=600",
          },
        },
      );
    }) as typeof fetch;

    const url =
      "/api/battle-data/global/records?table=enemy_deck&period_tag=all&filter_json=%7B%22uuid%22%3A%22enemy-deck-1%22%7D";

    const first = await cachedFetch(url);
    const firstJson = (await first.json()) as { count: number };
    expect(firstJson.count).toBe(1);

    const second = await cachedFetch(url);
    const secondJson = (await second.json()) as { count: number };
    expect(secondJson.count).toBe(1);
    expect(callCount).toBe(1);
  });
});