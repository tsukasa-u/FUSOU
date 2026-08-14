import { describe, expect, it } from "vitest";
import {
  BattleMasterDataRowSchema,
  parseBattleBlockRows,
  parseBattleChunkRows,
} from "../battle-data";

describe("battle data schemas", () => {
  it("parses master-data rows used for R2 reads", () => {
    expect(
      BattleMasterDataRowSchema.safeParse({
        period_tag: "2026-07-08",
        table_version: "0.5",
        period_revision: 1,
        r2_key: "master-data/mst_ship.avro",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed master-data rows", () => {
    expect(
      BattleMasterDataRowSchema.safeParse({
        period_tag: "2026-07-08",
        table_version: "0.5",
        period_revision: "1",
        r2_key: "master-data/mst_ship.avro",
      }).success,
    ).toBe(false);
    expect(BattleMasterDataRowSchema.safeParse(null).success).toBe(false);
  });

  it("parses chunk rows returned by D1", () => {
    expect(
      parseBattleChunkRows([
        {
          id: 1,
          table_name: "battle",
          size: 128,
          table_version: "v1",
          file_path: "battle/2026-06-26.avro",
          start_timestamp: 1_750_000_000_000,
          record_count: 4,
        },
      ]),
    ).toHaveLength(1);
  });

  it("rejects malformed chunk rows", () => {
    expect(
      parseBattleChunkRows([
        {
          id: 1,
          table_name: "battle",
          size: "128",
          table_version: "v1",
          file_path: "battle/2026-06-26.avro",
          start_timestamp: 1_750_000_000_000,
          record_count: 4,
        },
      ]),
    ).toBeNull();
  });

  it("parses block rows used by global records", () => {
    expect(
      parseBattleBlockRows([
        {
          id: 1,
          dataset_id: "dataset",
          start_byte: 128,
          length: 256,
          start_timestamp: 1_750_000_000_000,
          end_timestamp: 1_750_000_001_000,
          period_tag: "2026-06-26",
          window_start_ms: null,
          window_end_ms: null,
          compaction_tier: "daily",
          file_path: "battle/2026-06-26.avro",
        },
      ]),
    ).toHaveLength(1);
  });

  it("rejects malformed block rows", () => {
    expect(
      parseBattleBlockRows([
        {
          id: 1,
          dataset_id: "dataset",
          start_byte: 128,
          length: "256",
          start_timestamp: 1_750_000_000_000,
          end_timestamp: null,
          period_tag: "2026-06-26",
          window_start_ms: null,
          window_end_ms: null,
          compaction_tier: "daily",
          file_path: "battle/2026-06-26.avro",
        },
      ]),
    ).toBeNull();
  });
});