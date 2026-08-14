import type { BattleDropsPayload, MasterDataMeta } from "../repository/types";
import { buildBattleSummaries, type BattleRecord } from "./overview";

export function buildBattleDropsPayload(args: {
  periodTag: string;
  tableVersion?: string | null;
  masterData?: MasterDataMeta;
  battles: BattleRecord[];
  cells: BattleRecord[];
  battleResults: BattleRecord[];
  mstShips: BattleRecord[];
}): BattleDropsPayload {
  const summaries = buildBattleSummaries({
    battles: args.battles,
    cells: args.cells,
    battleResults: args.battleResults,
    mstShips: args.mstShips,
    includeEnemySummary: false,
    includeOpeningAirAttack: false,
  });
  const dropShipIds = new Set<number>();
  for (const battle of summaries) {
    const dropShipId = Number(
      (battle["battle_result"] as BattleRecord | null)?.["drop_ship_id"] ?? 0,
    );
    if (dropShipId > 0) dropShipIds.add(dropShipId);
  }

  return {
    success: true,
    period_tag: args.periodTag,
    table_version: args.tableVersion || null,
    master_data: args.masterData,
    battles: summaries,
    mst_ships: args.mstShips.filter((ship) =>
      dropShipIds.has(Number(ship["id"] ?? 0)),
    ),
  };
}