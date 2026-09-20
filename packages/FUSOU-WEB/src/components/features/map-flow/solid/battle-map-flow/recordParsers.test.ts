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

  it("normalizes mvp_ship_indexes from post-0.6.0 schema array", () => {
    const records = parseBattleRecords([
      {
        cell_id: 1,
        battle_result: {
          win_rank: "S",
          mvp_ship_indexes: [0, 2],
        },
      },
    ]);

    const result = battleResultOf(records[0]!);
    expect(result).toMatchObject({
      win_rank: "S",
      mvp_ship_indexes: [0, 2],
    });
  });

  it("falls back to api_mvp / mvp (1-indexed) to 0-indexed mvp_ship_indexes for pre-0.6.0 schema", () => {
    const records = parseBattleRecords([
      {
        cell_id: 1,
        battle_result: {
          win_rank: "S",
          api_mvp: 2,
        },
      },
      {
        cell_id: 2,
        battle_result: {
          win_rank: "A",
          mvp: 1,
        },
      },
    ]);

    const res1 = battleResultOf(records[0]!);
    expect(res1?.mvp_ship_indexes).toEqual([1]);

    const res2 = battleResultOf(records[1]!);
    expect(res2?.mvp_ship_indexes).toEqual([0]);
  });
});
