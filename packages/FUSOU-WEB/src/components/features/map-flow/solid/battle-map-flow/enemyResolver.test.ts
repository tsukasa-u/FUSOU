import { describe, expect, it } from "vitest";
import { buildEnemyDeckResolver, buildEnemyFleetResolver } from "./enemyResolver";

describe("enemy resolver", () => {
  it("keeps a valid ship index 0 before a missing index", () => {
    const resolve = buildEnemyDeckResolver(
      [{ uuid: "deck-1", ship_ids: ["ships-1"] }],
      [
        { uuid: "ships-1", mst_ship_id: 2 },
        { uuid: "ships-1", index: 0, mst_ship_id: 1 },
      ],
      [
        { id: 1, name: "indexed" },
        { id: 2, name: "missing-index" },
      ],
    );

    expect(resolve("deck-1")).toBe("indexed / missing-index");
  });

  it("keeps valid slot index 0 before a missing slot index", () => {
    const resolve = buildEnemyFleetResolver(
      [{ uuid: "deck-1", ship_ids: ["ships-1"] }],
      [{ uuid: "ships-1", index: 0, mst_ship_id: 1, slot: "slots-1" }],
      [
        { uuid: "slots-1", mst_slotitem_id: 2 },
        { uuid: "slots-1", index: 0, mst_slotitem_id: 1 },
      ],
      [{ id: 1, name: "ship" }],
      [
        { id: 1, name: "indexed-slot", type: [0, 0, 0, 1] },
        { id: 2, name: "missing-slot", type: [0, 0, 0, 2] },
      ],
    );

    expect(resolve("deck-1").ships[0]?.equipments.map((item) => item.name)).toEqual([
      "indexed-slot",
      "missing-slot",
    ]);
  });
});