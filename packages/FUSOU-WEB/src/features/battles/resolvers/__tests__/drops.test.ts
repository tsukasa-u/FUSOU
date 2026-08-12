import { describe, expect, it } from "vitest";
import { buildBattleDropsPayload } from "../drops";

describe("battle drops resolver", () => {
  it("returns only master ships referenced by battle drops", () => {
    const payload = buildBattleDropsPayload({
      periodTag: "2026-07-08",
      battles: [{ uuid: "battle-1", cell_id: 1, battle_result: "result-1" }],
      cells: [{ battles: "battle-1", maparea_id: 5, mapinfo_no: 4 }],
      battleResults: [{ uuid: "result-1", drop_ship_id: 123 }],
      mstShips: [{ id: 123, name: "Drop" }, { id: 999, name: "Other" }],
    });

    expect(payload.mst_ships).toEqual([{ id: 123, name: "Drop" }]);
  });
});