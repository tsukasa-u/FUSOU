import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  formatPeriodTagAsTokyoRfc3339,
  getLatestAllowedPeriodTagWithSource,
  validateCachedPeriodTag,
} from "../src/server/utils/period-tags.ts";

class FakeKv {
  private readonly store = new Map<string, string>();

  async get(key: string, type?: "text" | "json"): Promise<any> {
    const value = this.store.get(key);
    if (value == null) return null;
    if (type === "json") return JSON.parse(value);
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("period-tags regressions", () => {
  it("formats latest kc tag as legacy RFC3339 for client compatibility", () => {
    const rfc3339 = formatPeriodTagAsTokyoRfc3339("2026-05-09");
    assert.equal(rfc3339, "2026-05-09T00:00:00+09:00");
    assert.ok(Number.isFinite(new Date(rfc3339).getTime()));
  });

  it("reports cache hit for latest tag when period list exists in KV", async () => {
    const kv = new FakeKv();
    await kv.put(
      "data_loader:period_tags:list",
      JSON.stringify({ tags: ["2026-05-09", "2026-05-08"] }),
    );

    const result = await getLatestAllowedPeriodTagWithSource(
      { env: {} as any },
      { cacheKV: kv as unknown as KVNamespace },
    );

    assert.deepEqual(result, { tag: "2026-05-09", cached: true });
  });

  it("accepts historical period tag when direct authoritative lookup succeeds", async () => {
    const kv = new FakeKv();
    await kv.put(
      "data_loader:period_tags:list",
      JSON.stringify({ tags: ["2026-05-09", "2026-05-08"] }),
    );

    globalThis.fetch = (async (_input: RequestInfo | URL) => {
      return new Response(
        JSON.stringify([{ tag: "2025-01-01T03:30:00+09:00" }]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const result = await validateCachedPeriodTag(
      {
        env: {} as any,
      },
      "2025-01-01",
      {
        cacheKV: kv as unknown as KVNamespace,
        supabaseConfig: {
          url: "https://example.supabase.co",
          key: "sb_secret_test",
        },
      },
    );

    assert.deepEqual(result, { ok: true });
  });
});
