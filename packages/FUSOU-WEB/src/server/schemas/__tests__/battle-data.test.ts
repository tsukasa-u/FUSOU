import { describe, expect, it } from "vitest";
import {
  parseBattleBlockRows,
  parseBattleChunkRows,
} from "../battle-data";

describe("battle data schemas", () => {
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