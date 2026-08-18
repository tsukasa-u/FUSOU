import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../types";
import app from "../soku_speed_observed";

function createCache(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

function createDb() {
  const statement = {
    first: vi.fn(async () => ({
      period_tag: "2026-07-08",
      table_version: "1.0",
    })),
    bind: vi.fn(() => ({
      all: vi.fn(async () => ({ results: [] })),
    })),
  };
  return {
    prepare: vi.fn(() => statement),
  };
}

function bindings(
  db: ReturnType<typeof createDb>,
  cache: ReturnType<typeof createCache>,
): Bindings {
  return {
    SOKU_SPEED_OBSERVED_DB: db,
    DATA_LOADER_CACHE_KV: cache,
  } as unknown as Bindings;
}

describe("soku speed cache response boundary", () => {
  it("returns a valid latest cache hit", async () => {
    const cache = createCache({
      "soku-speed-upgrade:v1:latest": JSON.stringify({
        ok: true,
        period_tag: "2026-07-08",
        table_version: "1.0",
        data: { "1": [{ soku_observed: 5, item_ids: [10] }] },
      }),
    });

    const response = await app.fetch(
      new Request("https://example.test/speed-upgrade"),
      bindings(createDb(), cache),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-FUSOU-Cache")).toBe("HIT");
    expect(await response.json()).toMatchObject({
      ok: true,
      period_tag: "2026-07-08",
    });
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it("deletes an invalid latest cache and falls back to D1", async () => {
    const cache = createCache({
      "soku-speed-upgrade:v1:latest": JSON.stringify({
        ok: true,
        period_tag: "2026-07-08",
        table_version: null,
        data: {},
      }),
    });

    const response = await app.fetch(
      new Request("https://example.test/speed-upgrade"),
      bindings(createDb(), cache),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-FUSOU-Cache")).toBe("MISS");
    expect(await response.json()).toMatchObject({
      ok: true,
      period_tag: "2026-07-08",
      table_version: "1.0",
      data: {},
    });
    expect(cache.delete).toHaveBeenCalledWith("soku-speed-upgrade:v1:latest");
  });

  it("deletes an invalid period cache and falls back to D1", async () => {
    const cacheKey = "soku-speed-upgrade:v1:2026-07-08:1.0";
    const cache = createCache({
      [cacheKey]: "not-json",
    });

    const response = await app.fetch(
      new Request(
        "https://example.test/speed-upgrade?period_tag=2026-07-08&table_version=1.0",
      ),
      bindings(createDb(), cache),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-FUSOU-Cache")).toBe("MISS");
    expect(cache.delete).toHaveBeenCalledWith(cacheKey);
  });
});
