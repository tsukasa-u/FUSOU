import { bannerUrl } from "@/features/simulator/equip-calc";
import type { BattleDetailPayload, JsonRecord } from "../repository/types";
import { normalizeTimestamp } from "./indexes";

export type BattleDetailTables = {
  battle: JsonRecord[];
  cells: JsonRecord[];
  battleResult: JsonRecord[];
  ownDeck: JsonRecord[];
  ownShip: JsonRecord[];
  ownSlotItem: JsonRecord[];
  enemyDeck: JsonRecord[];
  enemyShip: JsonRecord[];
  enemySlotItem: JsonRecord[];
  midnightHougekiLists: JsonRecord[];
  midnightHougekis: JsonRecord[];
  openingTaisenLists: JsonRecord[];
  openingTaisens: JsonRecord[];
  hougekiLists: JsonRecord[];
  hougekis: JsonRecord[];
  openingAirattackLists: JsonRecord[];
  openingAirattacks: JsonRecord[];
  openingRaigeki: JsonRecord[];
  closingRaigeki: JsonRecord[];
  airbaseAssault: JsonRecord[];
  airbaseAirattackLists: JsonRecord[];
  airbaseAirattacks: JsonRecord[];
  carrierbaseAssault: JsonRecord[];
  supportHourai: JsonRecord[];
  supportAirattack: JsonRecord[];
  nightSupportHourai: JsonRecord[];
  nightSupportAirattack: JsonRecord[];
  friendlySupportHouraiLists: JsonRecord[];
  friendlySupportHourai: JsonRecord[];
  destructionBattle: JsonRecord[];
};

export type BattleDetailResolveOptions = {
  periodTag: string;
  tableVersion?: string | null;
  envUuid: string;
  battleIndex: number;
  masterShips?: JsonRecord[];
  masterSlotItems?: JsonRecord[];
  weaponIconFrames?: unknown;
  tables: BattleDetailTables;
};

export type BattleDetailResolution = {
  payload: BattleDetailPayload;
  duplicateBattleIndexes: number;
  unresolvedReferences: number;
};

export type BattleDetailContext = {
  battle: JsonRecord;
  cell: JsonRecord | null;
  scopedBattles: JsonRecord[];
  duplicateBattleIndexes: number;
};

function rowsByUuid(rows: JsonRecord[], uuid: string): JsonRecord[] {
  if (!uuid) return [];
  return rows
    .filter((row) => String(row["uuid"] ?? "") === uuid)
    .sort((left, right) => Number(left["index"] ?? 0) - Number(right["index"] ?? 0));
}

function firstByUuid(rows: JsonRecord[], uuid: unknown): JsonRecord | null {
  return rowsByUuid(rows, typeof uuid === "string" ? uuid : "")[0] ?? null;
}

function scopeRows(rows: JsonRecord[], envUuid: string): JsonRecord[] {
  return rows.filter((row) => String(row["env_uuid"] ?? "") === envUuid);
}

function firstByIndex(rows: JsonRecord[], index: number): JsonRecord | null {
  return rows.find((row) => Number(row["index"] ?? Number.NaN) === index) ?? null;
}

function resolveLinked(
  rows: JsonRecord[],
  explicitUuid: unknown,
  battleIndex: number,
): JsonRecord | null {
  return firstByUuid(rows, explicitUuid) ?? firstByIndex(rows, battleIndex);
}

function positiveNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Number(entry ?? Number.NaN))
    .filter((entry) => Number.isSafeInteger(entry) && entry >= 0);
}

function groupIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  }
  return typeof value === "string" && value.length > 0 ? [value] : [];
}

function relatedCell(
  cells: JsonRecord[],
  battle: JsonRecord,
  battleIndex: number,
): JsonRecord | null {
  const battleCellId = Number(battle["cell_id"] ?? Number.NaN);
  const matching = cells.filter((cell) =>
    positiveNumbers(cell["battle_index"]).includes(battleIndex),
  );
  const exact = matching.find((cell) => {
    const indexes = positiveNumbers(cell["battle_index"]);
    const cellIndexes = positiveNumbers(cell["cell_index"]);
    const position = indexes.indexOf(battleIndex);
    return position >= 0 && Number(cellIndexes[position]) === battleCellId;
  });
  return exact ?? matching[0] ?? cells.find((cell) =>
    positiveNumbers(cell["cell_index"]).includes(battleCellId),
  ) ?? null;
}

export function findBattleDetailContext(options: {
  tables: Pick<BattleDetailTables, "battle" | "cells">;
  envUuid: string;
  battleIndex: number;
}): BattleDetailContext | null {
  const scopedBattles = scopeRows(options.tables.battle, options.envUuid);
  const candidates = scopedBattles.filter(
    (row) => Number(row["index"] ?? Number.NaN) === options.battleIndex,
  );
  if (candidates.length === 0) return null;
  const battle = [...candidates].sort(
    (left, right) =>
      (normalizeTimestamp(left["timestamp"]) ?? Number.MAX_SAFE_INTEGER) -
      (normalizeTimestamp(right["timestamp"]) ?? Number.MAX_SAFE_INTEGER),
  )[0];
  const cell = relatedCell(
    scopeRows(options.tables.cells, options.envUuid),
    battle,
    options.battleIndex,
  );
  return {
    battle,
    cell,
    scopedBattles,
    duplicateBattleIndexes: Math.max(0, candidates.length - 1),
  };
}

function battleIndexes(
  battles: JsonRecord[],
  cell: JsonRecord | null,
): number[] {
  const availableIndexes = new Set(
    battles
      .map((row) => Number(row["index"] ?? Number.NaN))
      .filter((index) => Number.isSafeInteger(index) && index >= 0),
  );
  const cellBattleIndexes = positiveNumbers(cell?.["battle_index"]);
  const cellIndexes = positiveNumbers(cell?.["cell_index"]);
  if (cellIndexes.length > 0) {
    const battleByCellId = new Map(
      battles.map((row) => [Number(row["cell_id"] ?? Number.NaN), row]),
    );
    const orderedByCell = cellIndexes.map((cellId) =>
      Number(battleByCellId.get(cellId)?.["index"] ?? Number.NaN),
    );
    if (
      orderedByCell.length === cellIndexes.length &&
      orderedByCell.every((index) => availableIndexes.has(index))
    ) {
      return [...new Set(orderedByCell)];
    }
  }

  if (cellBattleIndexes.length > 0) {
    const matchingIndexes = cellBattleIndexes.filter((index) =>
      availableIndexes.has(index),
    );
    if (matchingIndexes.length === cellBattleIndexes.length) {
      return [...new Set(matchingIndexes)].sort((left, right) => left - right);
    }
  }

  return [...availableIndexes].sort((left, right) => left - right);
}

function airBaseAttackRows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is JsonRecord =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry),
    );
  }
  if (value && typeof value === "object" && Array.isArray((value as JsonRecord)["attacks"])) {
    return airBaseAttackRows((value as JsonRecord)["attacks"]);
  }
  return [];
}

function addPositiveIds(value: unknown, target: Set<number>): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    const id = Number(entry ?? 0);
    if (Number.isSafeInteger(id) && id > 0) target.add(id);
  }
}

function hpScore(rows: JsonRecord[], snapshot: unknown[]): number {
  if (rows.length === 0 || snapshot.length === 0) return Number.MAX_SAFE_INTEGER;
  const sorted = [...rows].sort(
    (left, right) => Number(left["index"] ?? 0) - Number(right["index"] ?? 0),
  );
  const length = Math.min(sorted.length, snapshot.length);
  let score = Math.abs(sorted.length - snapshot.length) * 20;
  for (let index = 0; index < length; index += 1) {
    score += Math.abs(
      Number(sorted[index]["nowhp"] ?? sorted[index]["maxhp"] ?? 0) -
        Number(snapshot[index] ?? 0),
    );
  }
  return score;
}

function fleetRows(
  battle: JsonRecord,
  decks: JsonRecord[],
  ships: JsonRecord[],
  slotItems: JsonRecord[],
  side: "own" | "enemy",
): JsonRecord[] {
  const hpSnapshot = (
    side === "own"
      ? battle["f_nowhps"] ?? battle["midnight_f_nowhps"]
      : battle["e_nowhps"] ?? battle["midnight_e_nowhps"]
  );
  const candidateGroups = new Map<string, JsonRecord[]>();
  for (const ship of ships) {
    const group = String(ship["uuid"] ?? "");
    if (!group) continue;
    const rows = candidateGroups.get(group) ?? [];
    rows.push(ship);
    candidateGroups.set(group, rows);
  }
  for (const rows of candidateGroups.values()) {
    rows.sort((left, right) => Number(left["index"] ?? 0) - Number(right["index"] ?? 0));
  }

  let selectedGroups: string[] = [];
  if (side === "own") {
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (const deck of decks) {
      for (const group of groupIds(deck["ship_ids"])) {
        const score = hpScore(candidateGroups.get(group) ?? [], Array.isArray(hpSnapshot) ? hpSnapshot : []);
        if (score < bestScore) {
          bestScore = score;
          selectedGroups = [group];
        }
      }
    }
  } else {
    const deckId = String(battle["e_deck_id"] ?? "");
    selectedGroups = groupIds(decks.find((row) => String(row["uuid"] ?? "") === deckId)?.["ship_ids"]);
  }
  const shipGroups = new Set(selectedGroups);
  const groupRows = ships
    .filter((row) => shipGroups.has(String(row["uuid"] ?? "")))
    .sort((left, right) => Number(left["index"] ?? 0) - Number(right["index"] ?? 0));
  const slotsByGroup = new Map<string, JsonRecord[]>();
  for (const row of slotItems) {
    const group = String(row["uuid"] ?? "");
    if (!group) continue;
    const current = slotsByGroup.get(group) ?? [];
    current.push(row);
    slotsByGroup.set(group, current);
  }
  return groupRows.map((row) => ({
    ...row,
    slot_items: typeof row["slot"] === "string" ? slotsByGroup.get(row["slot"]) ?? [] : [],
  }));
}

function indexedFleet(
  rows: JsonRecord[],
  masterShips: JsonRecord[],
  masterSlotItems: JsonRecord[],
  side: "own" | "enemy",
): JsonRecord[] {
  const ships = new Map(masterShips.map((row) => [Number(row["id"] ?? 0), row]));
  const slotItems = new Map(masterSlotItems.map((row) => [Number(row["id"] ?? 0), row]));
  return rows.map((row) => {
    const shipId = Number(row["ship_id"] ?? row["mst_ship_id"] ?? 0) || null;
    const sourceSlots = (Array.isArray(row["slot_items"]) ? row["slot_items"] : [])
      .filter((slot): slot is JsonRecord => {
        if (!slot || typeof slot !== "object" || Array.isArray(slot)) return false;
        return Number((slot as JsonRecord)["mst_slotitem_id"] ?? 0) > 0;
      });
    return {
      name: String(ships.get(shipId ?? 0)?.["name"] ?? (shipId ? `${side === "own" ? "艦" : "敵艦"}ID:${shipId}` : side === "own" ? "味方艦" : "敵艦")),
      shipId,
      bannerUrl: shipId ? bannerUrl(shipId, { f: "auto" }) : "",
      level: Number(row["lv"] ?? 0) || null,
      nowhp: Number(row["nowhp"] ?? 0) || 0,
      maxhp: Number(row["maxhp"] ?? row["nowhp"] ?? 0) || 0,
      karyoku: row["karyoku"] ?? null,
      raisou: row["raisou"] ?? null,
      taiku: row["taiku"] ?? null,
      soukou: row["soukou"] ?? null,
      equipments: sourceSlots.map((slot) => {
        const slotId = Number((slot as JsonRecord)["mst_slotitem_id"] ?? 0) || null;
        return {
          name: String(slotItems.get(slotId ?? 0)?.["name"] ?? (slotId ? `装備ID:${slotId}` : "")),
          level: Number((slot as JsonRecord)["level"] ?? 0) || null,
          iconType:
            Array.isArray(slotItems.get(slotId ?? 0)?.["type"]) &&
            (slotItems.get(slotId ?? 0)?.["type"] as unknown[]).length >= 4
              ? Number((slotItems.get(slotId ?? 0)?.["type"] as unknown[])[3] ?? 0) || null
              : null,
          slotItemId: slotId,
        };
      }),
    };
  });
}

export function resolveBattleDetail(
  options: BattleDetailResolveOptions,
): BattleDetailResolution | null {
  const context = findBattleDetailContext(options);
  if (!context) return null;
  const scopedTables: BattleDetailTables = {
    battle: scopeRows(options.tables.battle, options.envUuid),
    cells: scopeRows(options.tables.cells, options.envUuid),
    battleResult: scopeRows(options.tables.battleResult, options.envUuid),
    ownDeck: scopeRows(options.tables.ownDeck, options.envUuid),
    ownShip: scopeRows(options.tables.ownShip, options.envUuid),
    ownSlotItem: scopeRows(options.tables.ownSlotItem, options.envUuid),
    enemyDeck: scopeRows(options.tables.enemyDeck, options.envUuid),
    enemyShip: scopeRows(options.tables.enemyShip, options.envUuid),
    enemySlotItem: scopeRows(options.tables.enemySlotItem, options.envUuid),
    midnightHougekiLists: scopeRows(options.tables.midnightHougekiLists, options.envUuid),
    midnightHougekis: scopeRows(options.tables.midnightHougekis, options.envUuid),
    openingTaisenLists: scopeRows(options.tables.openingTaisenLists, options.envUuid),
    openingTaisens: scopeRows(options.tables.openingTaisens, options.envUuid),
    hougekiLists: scopeRows(options.tables.hougekiLists, options.envUuid),
    hougekis: scopeRows(options.tables.hougekis, options.envUuid),
    openingAirattackLists: scopeRows(options.tables.openingAirattackLists, options.envUuid),
    openingAirattacks: scopeRows(options.tables.openingAirattacks, options.envUuid),
    openingRaigeki: scopeRows(options.tables.openingRaigeki, options.envUuid),
    closingRaigeki: scopeRows(options.tables.closingRaigeki, options.envUuid),
    airbaseAssault: scopeRows(options.tables.airbaseAssault, options.envUuid),
    airbaseAirattackLists: scopeRows(options.tables.airbaseAirattackLists, options.envUuid),
    airbaseAirattacks: scopeRows(options.tables.airbaseAirattacks, options.envUuid),
    carrierbaseAssault: scopeRows(options.tables.carrierbaseAssault, options.envUuid),
    supportHourai: scopeRows(options.tables.supportHourai, options.envUuid),
    supportAirattack: scopeRows(options.tables.supportAirattack, options.envUuid),
    nightSupportHourai: scopeRows(options.tables.nightSupportHourai, options.envUuid),
    nightSupportAirattack: scopeRows(options.tables.nightSupportAirattack, options.envUuid),
    friendlySupportHouraiLists: scopeRows(options.tables.friendlySupportHouraiLists, options.envUuid),
    friendlySupportHourai: scopeRows(options.tables.friendlySupportHourai, options.envUuid),
    destructionBattle: scopeRows(options.tables.destructionBattle, options.envUuid),
  };
  const scopedBattles = scopedTables.battle;
  const battle = context.battle;
  const cell = context.cell;
  let unresolvedReferences = 0;

  const listAndDetail = (
    listRows: JsonRecord[],
    detailRows: JsonRecord[],
    reference: unknown,
    detailField: string,
  ) => {
    const list = resolveLinked(listRows, reference, options.battleIndex);
    const detailUuid = String(list?.[detailField] ?? "");
    const details = rowsByUuid(detailRows, detailUuid);
    if (!list && reference) unresolvedReferences += 1;
    return { list, details };
  };

  const midnight = listAndDetail(scopedTables.midnightHougekiLists, scopedTables.midnightHougekis, battle["midnight_hougeki"], "midnight_hougeki");
  const openingTaisen = listAndDetail(scopedTables.openingTaisenLists, scopedTables.openingTaisens, battle["opening_taisen"], "opening_taisen");
  const hougeki = listAndDetail(scopedTables.hougekiLists, scopedTables.hougekis, battle["hougeki"], "hougeki");
  const openingAirattack = listAndDetail(scopedTables.openingAirattackLists, scopedTables.openingAirattacks, battle["opening_air_attack"], "opening_air_attack");
  const linkedValue = (row: JsonRecord | null): JsonRecord[] => row ? [row] : [];
  const resolve = (rows: JsonRecord[], reference: unknown) => {
    const value = resolveLinked(rows, reference, options.battleIndex);
    if (!value && reference) unresolvedReferences += 1;
    return value;
  };
  const battleResult = resolve(scopedTables.battleResult, battle["battle_result"]);
  const openingRaigeki = resolve(scopedTables.openingRaigeki, battle["opening_raigeki"]);
  const closingRaigeki = resolve(scopedTables.closingRaigeki, battle["closing_raigeki"]);
  const airbaseAssault = resolve(scopedTables.airbaseAssault, battle["air_base_assault"]);
  const airbaseList = resolve(scopedTables.airbaseAirattackLists, battle["air_base_air_attacks"]);
  const airbaseAttackUuids = groupIds(airbaseList?.["air_base_air_attack"]);
  const airbaseAttacks = airbaseAttackUuids.flatMap((uuid) =>
    rowsByUuid(scopedTables.airbaseAirattacks, uuid),
  );
  const carrierbaseAssault = resolve(scopedTables.carrierbaseAssault, battle["carrier_base_assault"]);
  const supportHourai = resolve(scopedTables.supportHourai, battle["support_hourai"]);
  const supportAirattack = resolve(scopedTables.supportAirattack, battle["support_airattack"]);
  const nightSupportHourai = resolve(scopedTables.nightSupportHourai, battle["night_support_hourai"]);
  const nightSupportAirattack = resolve(scopedTables.nightSupportAirattack, battle["night_support_airattack"]);
  const destructionBattle = resolve(scopedTables.destructionBattle, cell?.["destruction_battles"]);
  const friendlyList = resolve(scopedTables.friendlySupportHouraiLists, battle["friendly_force_attack"]);
  const friendlySupport = resolve(scopedTables.friendlySupportHourai, friendlyList?.["friendly_support_hourai"]);

  const mergedBattle: JsonRecord = {
    ...battle,
    timestamp: normalizeTimestamp(battle["timestamp"]) ?? normalizeTimestamp(battle["midnight_timestamp"]),
    maparea_id: Number(cell?.["maparea_id"] ?? battle["maparea_id"] ?? 0) || null,
    mapinfo_no: Number(cell?.["mapinfo_no"] ?? battle["mapinfo_no"] ?? 0) || null,
    battle_result: battleResult ?? battle["battle_result"] ?? null,
    opening_raigeki: openingRaigeki ?? battle["opening_raigeki"] ?? null,
    closing_raigeki: closingRaigeki ?? battle["closing_raigeki"] ?? null,
    support_hourai: supportHourai,
    support_airattack: supportAirattack,
    support_attack: supportHourai || supportAirattack ? { support_hourai: supportHourai, support_airatack: supportAirattack } : null,
    night_support_hourai: nightSupportHourai,
    night_support_airattack: nightSupportAirattack,
    night_support_attack: nightSupportHourai || nightSupportAirattack ? { hourai: nightSupportHourai, airatack: nightSupportAirattack } : null,
    friendly_force_attack: friendlySupport
      ? {
          fleet_info:
            battle["friendly_force_attack"] && typeof battle["friendly_force_attack"] === "object"
              ? (battle["friendly_force_attack"] as JsonRecord)["fleet_info"] ?? null
              : null,
          support_hourai: friendlySupport,
        }
      : battle["friendly_force_attack"] ?? null,
    midnight_hougeki: midnight.details.length > 0 ? midnight.details : battle["midnight_hougeki"],
    opening_taisen: openingTaisen.details.length > 0 ? openingTaisen.details : battle["opening_taisen"],
    hougeki: hougeki.details.length > 0 ? hougeki.details : battle["hougeki"],
    opening_air_attack: openingAirattack.details.length > 0 ? openingAirattack.details : battle["opening_air_attack"],
    air_base_assault: airbaseAssault ?? battle["air_base_assault"] ?? null,
    air_base_air_attacks: airbaseList
      ? { ...airbaseList, attacks: airbaseAttacks }
      : battle["air_base_air_attacks"] ?? null,
    carrier_base_assault: carrierbaseAssault ?? battle["carrier_base_assault"] ?? null,
    destruction_battle: destructionBattle,
  };
  const ownShips = fleetRows(mergedBattle, scopedTables.ownDeck, scopedTables.ownShip, scopedTables.ownSlotItem, "own");
  const enemyShips = fleetRows(mergedBattle, scopedTables.enemyDeck, scopedTables.enemyShip, scopedTables.enemySlotItem, "enemy");
  const relevantShipIds = new Set<number>();
  for (const row of [...scopedTables.ownShip, ...scopedTables.enemyShip]) {
    const shipId = Number(row.ship_id ?? row.mst_ship_id ?? 0);
    if (shipId > 0) relevantShipIds.add(shipId);
  }
  const dropShipId = Number((battleResult as JsonRecord | null)?.drop_ship_id ?? 0);
  if (dropShipId > 0) relevantShipIds.add(dropShipId);
  const relevantSlotItemIds = new Set<number>();
  for (const row of [...scopedTables.ownSlotItem, ...scopedTables.enemySlotItem]) {
    const slotItemId = Number(row.mst_slotitem_id ?? 0);
    if (slotItemId > 0) relevantSlotItemIds.add(slotItemId);
  }
  for (const attack of airBaseAttackRows(mergedBattle.air_base_air_attacks)) {
    addPositiveIds(attack.squadron_plane, relevantSlotItemIds);
  }
  if (mergedBattle.air_base_assault && typeof mergedBattle.air_base_assault === "object") {
    addPositiveIds(
      (mergedBattle.air_base_assault as JsonRecord).squadron_plane,
      relevantSlotItemIds,
    );
  }
  const filteredMasterShips = (options.masterShips ?? []).filter((row) =>
    relevantShipIds.has(Number(row.id ?? 0)),
  );
  const filteredMasterSlotItems = (options.masterSlotItems ?? []).filter((row) =>
    relevantSlotItemIds.has(Number(row.id ?? 0)),
  );
  const payload: BattleDetailPayload = {
    success: true,
    period_tag: options.periodTag,
    table_version: options.tableVersion ?? null,
    battle_indexes: battleIndexes(scopedBattles, cell),
    battle: mergedBattle,
    linked: {
      cells: cell ? [cell] : [],
      battle_result: linkedValue(battleResult),
      own_deck: scopedTables.ownDeck,
      own_ship: scopedTables.ownShip,
      own_slotitem: scopedTables.ownSlotItem,
      enemy_deck: scopedTables.enemyDeck,
      enemy_ship: scopedTables.enemyShip,
      enemy_slotitem: scopedTables.enemySlotItem,
      midnight_hougeki_list: linkedValue(midnight.list),
      midnight_hougeki: midnight.details,
      opening_taisen_list: linkedValue(openingTaisen.list),
      opening_taisen: openingTaisen.details,
      hougeki_list: linkedValue(hougeki.list),
      hougeki: hougeki.details,
      opening_airattack_list: linkedValue(openingAirattack.list),
      opening_airattack: openingAirattack.details,
      opening_raigeki: linkedValue(openingRaigeki),
      closing_raigeki: linkedValue(closingRaigeki),
      destruction_battle: linkedValue(destructionBattle),
      airbase_assult: linkedValue(airbaseAssault),
      airbase_airattack_list: linkedValue(airbaseList),
      airbase_airattack: airbaseAttacks,
      carrierbase_assault: linkedValue(carrierbaseAssault),
      support_hourai: linkedValue(supportHourai),
      support_airattack: linkedValue(supportAirattack),
      night_support_hourai: linkedValue(nightSupportHourai),
      night_support_airattack: linkedValue(nightSupportAirattack),
      friendly_support_hourai_list: linkedValue(friendlyList),
      friendly_support_hourai: linkedValue(friendlySupport),
    },
    refs: {
      mst_ship: filteredMasterShips,
      mst_slotitem: filteredMasterSlotItems,
      weapon_icon_frames: options.weaponIconFrames,
    },
    derived: {
      friendly_fleet: indexedFleet(ownShips, options.masterShips ?? [], options.masterSlotItems ?? [], "own"),
      enemy_fleet: indexedFleet(enemyShips, options.masterShips ?? [], options.masterSlotItems ?? [], "enemy"),
    },
    source_meta: { env_uuid: options.envUuid, battle_index: options.battleIndex },
  };
  return {
    payload,
    duplicateBattleIndexes: context.duplicateBattleIndexes,
    unresolvedReferences,
  };
}