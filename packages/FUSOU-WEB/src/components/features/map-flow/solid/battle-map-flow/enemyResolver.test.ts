import { describe, expect, it } from "vitest";
import {
  buildEnemyDeckResolver,
  buildEnemyFleetResolver,
  parseDeckShipIds,
} from "./enemyResolver";

describe("enemy resolver", () => {
  it("parses deck ship_ids safely from arrays, json strings, and single strings", () => {
    expect(parseDeckShipIds(["uuid-1", "uuid-2"])).toEqual(["uuid-1", "uuid-2"]);
    expect(parseDeckShipIds(JSON.stringify(["uuid-1", "uuid-2"]))).toEqual(["uuid-1", "uuid-2"]);
    expect(parseDeckShipIds("single-uuid")).toEqual(["single-uuid"]);
    expect(parseDeckShipIds("")).toEqual([]);
    expect(parseDeckShipIds(null)).toEqual([]);
    expect(parseDeckShipIds(undefined)).toEqual([]);
    expect(parseDeckShipIds("[invalid-json")).toEqual(["[invalid-json"]);
  });

  it("resolves deck with json string ship_ids", () => {
    const resolve = buildEnemyDeckResolver(
      [{ uuid: "deck-1", ship_ids: JSON.stringify(["ships-1"]) as unknown as string[] }],
      [
        { uuid: "ships-1", index: 0, mst_ship_id: 1 },
      ],
      [
        { id: 1, name: "json-ship" },
      ],
    );

    expect(resolve("deck-1")).toBe("json-ship");
  });

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
