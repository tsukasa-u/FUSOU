import { describe, expect, it } from "vitest";
import { resolveBattleDetail, type BattleDetailTables } from "../detail";

function tables(overrides: Partial<BattleDetailTables> = {}): BattleDetailTables {
  return {
    battle: [
      { env_uuid: "other-env", index: 0, cell_id: 901 },
      {
        env_uuid: "target-env",
        index: 0,
        cell_id: 101,
        battle_result: "result-target",
        hougeki: "list-target",
      },
    ],
    cells: [{ env_uuid: "target-env", battle_index: [0], cell_index: [101], maparea_id: 5, mapinfo_no: 4 }],
    battleResult: [{ env_uuid: "target-env", uuid: "result-target", index: 0, drop_ship_id: 7 }],
    ownDeck: [],
    ownShip: [],
    ownSlotItem: [],
    enemyDeck: [],
    enemyShip: [],
    enemySlotItem: [],
    midnightHougekiLists: [],
    midnightHougekis: [],
    openingTaisenLists: [],
    openingTaisens: [],
    hougekiLists: [{ env_uuid: "target-env", uuid: "list-target", index: 0, hougeki: "detail-target" }],
    hougekis: [{ env_uuid: "target-env", uuid: "detail-target", index: 0, attack: true }],
    openingAirattackLists: [],
    openingAirattacks: [],
    openingRaigeki: [],
    closingRaigeki: [],
    airbaseAssault: [],
    airbaseAirattackLists: [],
    airbaseAirattacks: [],
    carrierbaseAssault: [],
    supportHourai: [],
    supportAirattack: [],
    nightSupportHourai: [],
    nightSupportAirattack: [],
    friendlySupportHouraiLists: [],
    friendlySupportHourai: [],
    destructionBattle: [],
    ...overrides,
  };
}

describe("resolveBattleDetail", () => {
  it("keeps the requested env boundary and follows UUID list/detail links", () => {
    const result = resolveBattleDetail({
      periodTag: "2026-08-11",
      envUuid: "target-env",
      battleIndex: 0,
      tables: tables(),
    });

    expect(result?.payload.battle).toMatchObject({ env_uuid: "target-env", cell_id: 101 });
    expect(result?.payload.linked?.battle_result).toEqual([
      { env_uuid: "target-env", uuid: "result-target", index: 0, drop_ship_id: 7 },
    ]);
    expect(result?.payload.linked?.hougeki).toEqual([
      { env_uuid: "target-env", uuid: "detail-target", index: 0, attack: true },
    ]);
    expect(result?.payload.battle_indexes).toEqual([0]);
  });

  it("prefers an explicit UUID over an index fallback", () => {
    const result = resolveBattleDetail({
      periodTag: "2026-08-11",
      envUuid: "target-env",
      battleIndex: 0,
      tables: tables({
        battleResult: [
          { env_uuid: "target-env", uuid: "result-fallback", index: 0 },
          { env_uuid: "target-env", uuid: "result-target", index: 8 },
        ],
      }),
    });

    expect(result?.payload.linked?.battle_result?.[0]).toMatchObject({
      uuid: "result-target",
      index: 8,
    });
  });

  it("does not complete a detail request from another env", () => {
    const result = resolveBattleDetail({
      periodTag: "2026-08-11",
      envUuid: "missing-env",
      battleIndex: 0,
      tables: tables(),
    });

    expect(result).toBeNull();
  });

  it("preserves the cell traversal order when resolving battle indexes", () => {
    const result = resolveBattleDetail({
      periodTag: "2026-08-11",
      envUuid: "target-env",
      battleIndex: 2,
      tables: tables({
        battle: [
          { env_uuid: "target-env", index: 0, cell_id: 101 },
          { env_uuid: "target-env", index: 2, cell_id: 102 },
          { env_uuid: "target-env", index: 1, cell_id: 103 },
        ],
        cells: [
          {
            env_uuid: "target-env",
            battle_index: [2, 0, 1],
            cell_index: [102, 101, 103],
          },
        ],
      }),
    });

    expect(result?.payload.battle_indexes).toEqual([2, 0, 1]);
  });

  it("falls back to cell ids when stored battle indexes are source ids", () => {
    const result = resolveBattleDetail({
      periodTag: "2026-08-11",
      envUuid: "target-env",
      battleIndex: 1,
      tables: tables({
        battle: [
          { env_uuid: "target-env", index: 0, cell_id: 101 },
          { env_uuid: "target-env", index: 1, cell_id: 103 },
          { env_uuid: "target-env", index: 2, cell_id: 102 },
        ],
        cells: [
          {
            env_uuid: "target-env",
            battle_index: [18, 10, 17, 2, 6],
            cell_index: [102, 103, 101],
          },
        ],
      }),
    });

    expect(result?.payload.battle_indexes).toEqual([2, 1, 0]);
  });

  it("puts the final cell last for the local AVRO battle layout", () => {
    const result = resolveBattleDetail({
      periodTag: "2026-08-05",
      envUuid: "target-env",
      battleIndex: 0,
      tables: tables({
        battle: [
          { env_uuid: "target-env", index: 0, cell_id: 18 },
          { env_uuid: "target-env", index: 1, cell_id: 10 },
          { env_uuid: "target-env", index: 2, cell_id: 17 },
          { env_uuid: "target-env", index: 3, cell_id: 2 },
          { env_uuid: "target-env", index: 4, cell_id: 6 },
        ],
        cells: [
          {
            env_uuid: "target-env",
            battle_index: [18, 10, 17, 2, 6],
            cell_index: [2, 6, 17, 10, 18],
          },
        ],
      }),
    });

    expect(result?.payload.battle_indexes).toEqual([3, 4, 2, 1, 0]);
  });

  it("does not expose unequipped slot items in the derived fleet", () => {
    const result = resolveBattleDetail({
      periodTag: "2026-08-11",
      envUuid: "target-env",
      battleIndex: 0,
      masterShips: [{ id: 1, name: "敵艦" }],
      masterSlotItems: [{ id: 42, name: "有効な装備", type: [0, 0, 0, 1] }],
      tables: tables({
        battle: [
          {
            env_uuid: "target-env",
            index: 0,
            cell_id: 101,
            e_deck_id: "enemy-deck",
          },
        ],
        cells: [
          {
            env_uuid: "target-env",
            battle_index: [0],
            cell_index: [101],
          },
        ],
        enemyDeck: [
          { env_uuid: "target-env", uuid: "enemy-deck", ship_ids: ["enemy-ships"] },
        ],
        enemyShip: [
          {
            env_uuid: "target-env",
            uuid: "enemy-ships",
            index: 0,
            mst_ship_id: 1,
            slot: "enemy-slots",
          },
        ],
        enemySlotItem: [
          { env_uuid: "target-env", uuid: "enemy-slots", index: 0, mst_slotitem_id: -1 },
          { env_uuid: "target-env", uuid: "enemy-slots", index: 1, mst_slotitem_id: 42 },
        ],
      }),
    });

    expect(result?.payload.derived?.enemy_fleet?.[0]?.equipments).toEqual([
      expect.objectContaining({ name: "有効な装備", slotItemId: 42 }),
    ]);
  });
});