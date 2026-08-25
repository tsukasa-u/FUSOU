import { describe, expect, it } from "vitest";
import { buildBattleOverviewPayload } from "../overview";

describe("battle overview resolver", () => {
  it("matches battle result and map cell references without changing source rows", () => {
    const battles = [
      { uuid: "battle-1", cell_id: 1, battle_result: "result-1", timestamp: 1_700_000_000 },
      { uuid: "ignored", cell_id: null },
    ];
    const payload = buildBattleOverviewPayload({
      periodTag: "2026-07-08",
      battles,
      cells: [{ battles: "battle-1", maparea_id: 5, mapinfo_no: 4 }],
      battleResults: [{ uuid: "result-1", drop_ship_id: 123 }],
      mstShips: [{ id: 123, name: "Test Ship" }],
    });

    expect(payload.battles).toEqual([
      expect.objectContaining({
        uuid: "battle-1",
        maparea_id: 5,
        mapinfo_no: 4,
        timestamp: 1_700_000_000_000,
        battle_result: expect.objectContaining({ drop_ship_name: "Test Ship" }),
      }),
    ]);
    expect(battles[0]).not.toHaveProperty("timestamp", 1_700_000_000_000);
  });

  it("keeps indexed ships before ships with a missing index", () => {
    const payload = buildBattleOverviewPayload({
      periodTag: "2026-07-08",
      battles: [{ uuid: "battle-1", cell_id: 1, e_deck_id: "deck-1" }],
      cells: [],
      battleResults: [],
      enemyDecks: [{ uuid: "deck-1", ship_ids: ["ships-1"] }],
      enemyShips: [
        { uuid: "ships-1", mst_ship_id: 2 },
        { uuid: "ships-1", index: 0, mst_ship_id: 1 },
      ],
      mstShips: [
        { id: 1, name: "indexed" },
        { id: 2, name: "missing-index" },
      ],
    });

    expect(payload.battles?.[0]?.["enemy_summary"]).toBe(
      "indexed / missing-index",
    );
  });

  it("does not copy non-positive map coordinates from cells", () => {
    const payload = buildBattleOverviewPayload({
      periodTag: "2026-07-08",
      battles: [{ uuid: "battle-1", cell_id: 1 }],
      cells: [{ battles: "battle-1", maparea_id: 0, mapinfo_no: 0 }],
      battleResults: [],
    });

    expect(payload.battles?.[0]).not.toHaveProperty("maparea_id");
    expect(payload.battles?.[0]).not.toHaveProperty("mapinfo_no");
  });
});