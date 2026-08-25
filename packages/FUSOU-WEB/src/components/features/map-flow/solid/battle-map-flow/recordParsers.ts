import type {
  AirAttackData,
  BattleRecord,
  BattleResultData,
  CellRecord,
  EnemyDeckRecord,
  EnemyShipRecord,
  EnemySlotItemRecord,
  MstShipRecord,
  MstSlotItemRecord,
} from "./types";

export type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordsOf(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isJsonRecord) : [];
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseAirAttack(value: unknown): AirAttackData | null {
  return isJsonRecord(value) ? value : null;
}

function parseAirAttackValue(
  value: unknown,
): AirAttackData | AirAttackData[] | null {
  if (Array.isArray(value)) {
    return value.map(parseAirAttack).filter((item): item is AirAttackData => item !== null);
  }
  if (value === null || value === undefined) return null;
  return parseAirAttack(value);
}

function parseBattleResult(value: unknown): BattleResultData | string | null {
  if (typeof value === "string") return value;
  if (!isJsonRecord(value)) return null;
  const winRank = stringOrUndefined(value["win_rank"]);
  if (!winRank) return null;
  return {
    ...value,
    win_rank: winRank,
    drop_ship_id: numberOrNull(value["drop_ship_id"]),
    ...(Array.isArray(value["mvp_ship_indexes"])
      ? { mvp_ship_indexes: value["mvp_ship_indexes"] }
      : {}),
  };
}

function parseNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map(numberOrNull)
    .filter((item): item is number => item !== null);
}

export function parseBattleRecords(value: unknown): BattleRecord[] {
  return recordsOf(value).flatMap((record) => {
    const uuid = stringOrUndefined(record["uuid"]);
    const envUuid = stringOrUndefined(record["env_uuid"]);
    const eDeckId = stringOrUndefined(record["e_deck_id"]);
    const sortieId = stringOrUndefined(record["__sortie_id"]);
    const cellId = numberOrNull(record["cell_id"]);
    if (cellId === null) return [];
    return {
      ...record,
      timestamp: numberOrNull(record["timestamp"]),
      midnight_timestamp: numberOrNull(record["midnight_timestamp"]),
      maparea_id: numberOrNull(record["maparea_id"]),
      mapinfo_no: numberOrNull(record["mapinfo_no"]),
      cell_id: cellId,
      index: numberOrNull(record["index"]),
      f_formation: numberOrNull(record["f_formation"]),
      e_formation: numberOrNull(record["e_formation"]),
      formation: parseNumberArray(record["formation"]),
      opening_air_attack: parseAirAttackValue(record["opening_air_attack"]),
      air_base_air_attacks: parseAirAttackValue(record["air_base_air_attacks"]),
      air_base_assault: parseAirAttack(record["air_base_assault"]),
      carrier_base_assault: parseAirAttack(record["carrier_base_assault"]),
      battle_result: parseBattleResult(record["battle_result"]),
      ...(uuid ? { uuid } : {}),
      ...(envUuid ? { env_uuid: envUuid } : {}),
      ...(eDeckId ? { e_deck_id: eDeckId } : {}),
      ...(sortieId ? { __sortie_id: sortieId } : {}),
    } satisfies BattleRecord;
  });
}

export function parseCellRecords(value: unknown): CellRecord[] {
  return recordsOf(value).flatMap((record) => {
    const uuid = stringOrUndefined(record["uuid"]);
    if (!uuid) return [];
    const envUuid = stringOrUndefined(record["env_uuid"]);
    return [{
    ...record,
    uuid,
    ...(envUuid ? { env_uuid: envUuid } : {}),
    battles:
      typeof record["battles"] === "string"
        ? record["battles"]
        : null,
    maparea_id: numberOrNull(record["maparea_id"]),
    mapinfo_no: numberOrNull(record["mapinfo_no"]),
    cell_index: parseNumberArray(record["cell_index"]),
    battle_index: parseNumberArray(record["battle_index"]),
    } satisfies CellRecord];
  });
}

export function battleResultOf(record: BattleRecord): BattleResultData | null {
  const result = record.battle_result;
  return result && typeof result === "object" ? result : null;
}

export function parseEnemyDeckRecords(value: unknown): EnemyDeckRecord[] {
  return recordsOf(value).flatMap((record) => {
    const uuid = stringOrUndefined(record["uuid"]);
    if (!uuid) return [];
    return [{
    ...record,
    uuid,
    ship_ids:
      typeof record["ship_ids"] === "string"
        ? record["ship_ids"]
        : Array.isArray(record["ship_ids"])
          ? record["ship_ids"].map((item) =>
              typeof item === "string" ? item : null,
            )
          : null,
    } satisfies EnemyDeckRecord];
  });
}

export function parseEnemyShipRecords(value: unknown): EnemyShipRecord[] {
  return recordsOf(value).flatMap((record) => {
    const uuid = stringOrUndefined(record["uuid"]);
    if (!uuid) return [];
    return [{
    ...record,
    uuid,
    index: numberOrNull(record["index"]),
    mst_ship_id: numberOrNull(record["mst_ship_id"]),
    karyoku: numberOrNull(record["karyoku"]),
    raisou: numberOrNull(record["raisou"]),
    taiku: numberOrNull(record["taiku"]),
    soukou: numberOrNull(record["soukou"]),
    } satisfies EnemyShipRecord];
  });
}

export function parseEnemySlotItemRecords(value: unknown): EnemySlotItemRecord[] {
  return recordsOf(value).flatMap((record) => {
    const uuid = stringOrUndefined(record["uuid"]);
    if (!uuid) return [];
    return [{
    ...record,
    uuid,
    index: numberOrNull(record["index"]),
    mst_slotitem_id: numberOrNull(record["mst_slotitem_id"]),
    } satisfies EnemySlotItemRecord];
  });
}

export function parseMasterShipRecords(value: unknown): MstShipRecord[] {
  return recordsOf(value)
    .flatMap((record) => {
      const id = numberOrNull(record["id"]);
      const name = stringOrUndefined(record["name"]);
      if (id === null || !name) return [];
      return [{
        ...record,
        id,
        name,
        stype: numberOrNull(record["stype"]),
        backs: numberOrNull(record["backs"]),
      } satisfies MstShipRecord];
    })
}

export function parseMasterSlotItemRecords(value: unknown): MstSlotItemRecord[] {
  return recordsOf(value)
    .flatMap((record) => {
      const id = numberOrNull(record["id"]);
      const name = stringOrUndefined(record["name"]);
      if (id === null || !name) return [];
      return [{
        ...record,
        id,
        name,
        type: parseNumberArray(record["type"]),
      } satisfies MstSlotItemRecord];
    })
}
