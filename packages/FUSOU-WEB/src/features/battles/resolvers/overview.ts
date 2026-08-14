import type {
  BattleOverviewPayload,
  MasterDataMeta,
} from "../repository/types";
import {
  buildEnemySummaryResolver,
  normalizeTimestamp,
  type BattleRecord,
} from "./indexes";

export type { BattleRecord } from "./indexes";

export function buildBattleSummaries(args: {
  battles: BattleRecord[];
  cells: BattleRecord[];
  battleResults: BattleRecord[];
  openingAirattackLists?: BattleRecord[];
  openingAirattacks?: BattleRecord[];
  mstShips?: BattleRecord[];
  enemyDecks?: BattleRecord[];
  enemyShips?: BattleRecord[];
  includeEnemySummary?: boolean;
  includeOpeningAirAttack?: boolean;
}): BattleRecord[] {
  const battleResultByUuid = new Map<string, BattleRecord>();
  for (const record of args.battleResults) {
    const uuid = String(record["uuid"] ?? "");
    if (uuid) battleResultByUuid.set(uuid, record);
  }

  const mapByBattleUuid = new Map<string, { maparea_id: number; mapinfo_no: number }>();
  for (const cell of args.cells) {
    const battleUuid = String(cell["battles"] ?? "");
    const maparea = Number(cell["maparea_id"] ?? 0);
    const mapinfo = Number(cell["mapinfo_no"] ?? 0);
    if (battleUuid && maparea > 0 && mapinfo > 0) {
      mapByBattleUuid.set(battleUuid, { maparea_id: maparea, mapinfo_no: mapinfo });
    }
  }

  const mstShipNameById = new Map<number, string>();
  for (const ship of args.mstShips || []) {
    const id = Number(ship["id"] ?? 0);
    if (id > 0) mstShipNameById.set(id, String(ship["name"] ?? ""));
  }

  const openingAirattackListByUuid = new Map<string, BattleRecord>();
  for (const record of args.openingAirattackLists || []) {
    const uuid = String(record["uuid"] ?? "");
    if (uuid) openingAirattackListByUuid.set(uuid, record);
  }
  const openingAirattackByUuid = new Map<string, BattleRecord>();
  for (const record of args.openingAirattacks || []) {
    const uuid = String(record["uuid"] ?? "");
    if (uuid) openingAirattackByUuid.set(uuid, record);
  }

  const enemySummaryOf = args.includeEnemySummary
    ? buildEnemySummaryResolver({
        enemyDecks: args.enemyDecks || [],
        enemyShips: args.enemyShips || [],
        mstShips: args.mstShips || [],
      })
    : () => "-";

  return args.battles
    .filter((battle) => Number.isFinite(Number(battle["cell_id"] ?? Number.NaN)))
    .map((battle) => {
      const battleResultUuid = String(battle["battle_result"] ?? "");
      const rawBattleResult =
        typeof battle["battle_result"] === "object" && battle["battle_result"] !== null
          ? (battle["battle_result"] as BattleRecord)
          : battleResultByUuid.get(battleResultUuid) || null;
      const dropShipId = Number(rawBattleResult?.["drop_ship_id"] ?? 0) || null;
      const normalizedBattleResult = rawBattleResult
        ? {
            ...rawBattleResult,
            drop_ship_name:
              dropShipId != null
                ? mstShipNameById.get(dropShipId) || `艦#${dropShipId}`
                : null,
          }
        : null;

      let normalizedOpeningAirAttack = battle["opening_air_attack"];
      if (args.includeOpeningAirAttack && typeof normalizedOpeningAirAttack === "string") {
        const listObj = openingAirattackListByUuid.get(normalizedOpeningAirAttack);
        const detailUuid = String(listObj?.["opening_air_attack"] ?? normalizedOpeningAirAttack);
        const detailObj = openingAirattackByUuid.get(detailUuid);
        if (detailObj) normalizedOpeningAirAttack = [detailObj];
      }

      const resolvedMap = battle["uuid"]
        ? mapByBattleUuid.get(String(battle["uuid"]))
        : undefined;
      return {
        ...battle,
        ...(resolvedMap || {}),
        timestamp:
          normalizeTimestamp(battle["timestamp"]) ??
          normalizeTimestamp(battle["midnight_timestamp"]),
        battle_result: normalizedBattleResult,
        enemy_summary: args.includeEnemySummary
          ? enemySummaryOf(String(battle["e_deck_id"] ?? "") || null)
          : undefined,
        opening_air_attack: normalizedOpeningAirAttack,
      };
    });
}

export function buildBattleOverviewPayload(args: {
  periodTag: string;
  tableVersion?: string | null;
  masterData?: MasterDataMeta;
  battles: BattleRecord[];
  cells: BattleRecord[];
  battleResults: BattleRecord[];
  mstShips?: BattleRecord[];
  enemyDecks?: BattleRecord[];
  enemyShips?: BattleRecord[];
}): BattleOverviewPayload {
  const battles = buildBattleSummaries({
    battles: args.battles,
    cells: args.cells,
    battleResults: args.battleResults,
    ...(args.mstShips === undefined ? {} : { mstShips: args.mstShips }),
    ...(args.enemyDecks === undefined ? {} : { enemyDecks: args.enemyDecks }),
    ...(args.enemyShips === undefined ? {} : { enemyShips: args.enemyShips }),
    includeEnemySummary: true,
    includeOpeningAirAttack: false,
  });
  return {
    success: true,
    period_tag: args.periodTag,
    table_version: args.tableVersion || null,
    ...(args.masterData === undefined ? {} : { master_data: args.masterData }),
    battles,
    cells: args.cells,
  };
}