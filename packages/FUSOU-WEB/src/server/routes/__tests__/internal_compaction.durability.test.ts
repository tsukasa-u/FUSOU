import { describe, expect, it, vi } from "vitest";
import internalCompactionApp from "../internal_compaction";

const authHeaders = {
  "Content-Type": "application/json",
  "X-INTERNAL-TOKEN": "test-token",
};

function makeRegisterPayload() {
  return {
    file_path: "1.0.0/2026-08/daily/run/battle-001.avro",
    lock_token: "lock-token",
    table_version: "1.0.0",
    compaction_tier: "daily",
    source_tier: "hourly",
    window_start_ms: 1,
    window_end_ms: 2,
    file_size: 10,
    blocks: [
      {
        dataset_id: "11111111-1111-4111-8111-111111111111",
        table_name: "battle",
        period_tag: "2026-08",
        start_byte: 0,
        length: 10,
        record_count: 1,
        start_timestamp: 1,
        end_timestamp: 2,
        source_file_count: 1,
      },
    ],
  };
}

describe("internal compaction D1/R2 durability", () => {
  it("does not mutate D1 when the output object is missing from R2", async () => {
    const batch = vi.fn();
    const prepare = vi.fn(() => {
      throw new Error("D1 must not be queried before R2 visibility is proven");
    });
    const db = { prepare, batch };
    const bucket = { head: vi.fn(async () => null) };

    const response = await internalCompactionApp.fetch(
      new Request("https://example.com/register-output", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(makeRegisterPayload()),
      }),
      {
        INTERNAL_COMPACTION_TOKEN: "test-token",
        BATTLE_INDEX_DB: db,
        BATTLE_DATA_BUCKET: bucket,
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "output object is not visible in R2",
    });
    expect(bucket.head).toHaveBeenCalledWith(makeRegisterPayload().file_path);
    expect(prepare).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it("keeps D1 sources when an archived source object is missing from R2", async () => {
    const batch = vi.fn();
    const statements = [
      {
        bind: vi.fn(function (this: unknown) {
          return this;
        }),
        first: vi.fn(async () => ({
          id: 7,
          lifecycle_state: "registered",
          output_verified_at_ms: 100,
        })),
        all: vi.fn(async () => ({
          results: [
            {
              source_file_id: 12,
              source_file_path: "1.0.0/2026-08/123/battle-001.avro",
              archived_source_path: "compacted/1.0.0/2026-08/123/battle-001.avro",
            },
          ],
        })),
      },
    ];
    let prepareIndex = 0;
    const prepare = vi.fn(() => statements[Math.min(prepareIndex++, statements.length - 1)]);
    const db = { prepare, batch };
    const bucket = {
      head: vi.fn(async (key: string) =>
        key === "1.0.0/2026-08/daily/run/battle-001.avro"
          ? { size: 10 }
          : null,
      ),
    };

    const response = await internalCompactionApp.fetch(
      new Request("https://example.com/cleanup-consumed-sources", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          output_file_path: "1.0.0/2026-08/daily/run/battle-001.avro",
          source_tier: "hourly",
          table_name: "battle",
          period_tag: "2026-08",
          table_version: "1.0.0",
          window_start_ms: 1,
          window_end_ms: 2,
          source_file_ids: [12],
        }),
      }),
      {
        INTERNAL_COMPACTION_TOKEN: "test-token",
        BATTLE_INDEX_DB: db,
        BATTLE_DATA_BUCKET: bucket,
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "consumed source objects are not archived in R2; source cleanup is deferred",
    });
    expect(bucket.head).toHaveBeenNthCalledWith(
      1,
      "1.0.0/2026-08/daily/run/battle-001.avro",
    );
    expect(bucket.head).toHaveBeenNthCalledWith(
      2,
      "compacted/1.0.0/2026-08/123/battle-001.avro",
    );
    expect(batch).not.toHaveBeenCalled();
  });
});
