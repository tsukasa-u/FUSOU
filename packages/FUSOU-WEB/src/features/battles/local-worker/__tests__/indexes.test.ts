import { describe, expect, it } from "vitest";
import { buildTableIndex, rowsForIndexes, sortRowsByIndex } from "../indexes";

describe("local worker table indexes", () => {
  it("indexes required lookup fields and deduplicates uuid/index rows", () => {
    const index = buildTableIndex("battle", [
      { uuid: "battle-1", env_uuid: "env-1", index: 1, battles: "cell-1" },
      { uuid: "battle-1", env_uuid: "env-1", index: 1, battles: "duplicate" },
      { uuid: "battle-2", env_uuid: "env-2", index: 0, battle_id: "legacy-2" },
    ]);

    expect(index.rows).toHaveLength(2);
    expect(rowsForIndexes(index, index.byEnvUuid.get("env-1") || [])).toEqual([
      { uuid: "battle-1", env_uuid: "env-1", index: 1, battles: "cell-1" },
    ]);
    expect(index.byBattleId.get("cell-1")).toEqual([0]);
    expect(index.byBattleId.get("legacy-2")).toEqual([1]);
  });

  it("skips missing rows when resolving indexed positions", () => {
    const index = buildTableIndex("battle", [{ uuid: "battle-1", index: 1 }]);
    index.rows.length = 2;

    expect(rowsForIndexes(index, [1, -1, 99, 0])).toEqual([
      { uuid: "battle-1", index: 1 },
    ]);
  });

  it("sorts a selected row set without mutating the index", () => {
    const rows = [{ index: 3 }, { index: 1 }, { index: 2 }];
    expect(sortRowsByIndex(rows)).toEqual([{ index: 1 }, { index: 2 }, { index: 3 }]);
    expect(rows).toEqual([{ index: 3 }, { index: 1 }, { index: 2 }]);
  });
});