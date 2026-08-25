import { describe, expect, it } from "vitest";
import { battleResultOf, parseBattleRecords } from "./recordParsers";

describe("battle record parsers", () => {
  it("normalizes valid records and drops records without a cell id", () => {
    const records = parseBattleRecords([
      {
        cell_id: "7",
        battle_result: { win_rank: "S", drop_ship_id: "123" },
        opening_air_attack: [{ air_superiority: 1 }],
      },
      { battle_result: { win_rank: "A" } },
      null,
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]?.cell_id).toBe(7);
    expect(battleResultOf(records[0]!)).toMatchObject({
      win_rank: "S",
      drop_ship_id: 123,
    });
  });

  it("rejects malformed battle results without losing the record", () => {
    const records = parseBattleRecords([
      { cell_id: 1, battle_result: { drop_ship_id: "bad" } },
    ]);

    expect(records).toHaveLength(1);
    expect(battleResultOf(records[0]!)).toBeNull();
  });
});