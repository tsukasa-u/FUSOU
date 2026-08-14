import { describe, expect, it } from "vitest";
import { parseBattleChunkRows } from "../battle-data";

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
});