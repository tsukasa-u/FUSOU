// scripts/rebuild-all-snapshots.ts
import zlib from "node:zlib";
import { execSync } from "node:child_process";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { decodeAvroOcfToJson } from "@fusou/compaction-core";
import { buildOverviewSnapshot, buildDropsSnapshot } from "@fusou/compaction-core";

// src/features/simulator/state.ts
import { atom } from "nanostores";

// src/features/simulator/types.ts
function emptyFleetSlot() {
  return {
    shipId: null,
    shipLevel: null,
    equipIds: [null, null, null, null, null],
    equipImprovement: [0, 0, 0, 0, 0],
    equipProficiency: [0, 0, 0, 0, 0],
    exSlotId: null,
    exSlotImprovement: 0
  };
}
function emptyAirBase() {
  return {
    equipIds: [null, null, null, null],
    equipImprovement: [0, 0, 0, 0],
    equipProficiency: [0, 0, 0, 0]
  };
}

// src/features/simulator/state.ts
var simulatorFleetRevision = atom(0);
var simulatorAirbaseRevision = atom(0);
var simulatorDisplayRevision = atom(0);
var simulatorReadOnly = atom(false);
var simulatorCombinedFleetType = atom(0);
var simulatorFleetState = atom({
  fleet1: [],
  fleet2: [],
  fleet3: [],
  fleet4: []
});
var simulatorAirbaseState = atom([]);
var simulatorSearchQuery = atom("");
function cloneFleetSlot(slot) {
  return {
    ...slot,
    equipIds: [...slot.equipIds],
    equipImprovement: [...slot.equipImprovement],
    equipProficiency: [...slot.equipProficiency],
    ...slot.statOverrides === void 0 ? {} : { statOverrides: { ...slot.statOverrides } },
    ...slot.instanceStats === void 0 ? {} : { instanceStats: { ...slot.instanceStats } }
  };
}
function cloneAirBaseSlot(base) {
  return {
    ...base,
    equipIds: [...base.equipIds],
    equipImprovement: [...base.equipImprovement],
    equipProficiency: [...base.equipProficiency]
  };
}
function snapshotFleetState() {
  return {
    fleet1: state.fleet1.map(cloneFleetSlot),
    fleet2: state.fleet2.map(cloneFleetSlot),
    fleet3: state.fleet3.map(cloneFleetSlot),
    fleet4: state.fleet4.map(cloneFleetSlot)
  };
}
function snapshotAirbaseState() {
  return state.airBases.map(cloneAirBaseSlot);
}
var state = {
  // Master data
  mstShips: {},
  mstSlotItems: {},
  mstSlotItemEquipTypes: {},
  hasMasterData: false,
  // Equipment bonus / synergy data
  slotItemEffects: null,
  slotItemEffectsMeta: null,
  // Observed speed data (turbine/boiler upgrades) from soku_speed_observed
  sokuSpeedData: null,
  // Weapon icon sprite sheet
  weaponIconFrames: {},
  spriteSheetW: 0,
  spriteSheetH: 0,
  spriteSheetUrl: "",
  // Ship type icon sprite sheet (organize_ship)
  shipTypeIconFrames: {},
  shipTypeSpriteSheetW: 0,
  shipTypeSpriteSheetH: 0,
  shipTypeSpriteSheetUrl: "",
  // Asset URL maps
  bannerMap: {},
  cardMap: {},
  shipIconMap: {},
  assetBaseUrl: "",
  equipCardMap: {},
  equipItemOnMap: {},
  equipItemUpMap: {},
  // Combined fleet type: 0=通常, 1=機動部隊, 2=水上打撃部隊, 3=輸送護衛部隊
  combinedFleetType: 0,
  // Per-fleet selected formation ID (0 = none)
  fleetFormations: { 1: 0, 2: 0, 3: 0, 4: 0 },
  // Fleet state
  fleet1: Array.from({ length: 6 }, emptyFleetSlot),
  fleet2: Array.from({ length: 6 }, emptyFleetSlot),
  fleet3: Array.from({ length: 7 }, emptyFleetSlot),
  fleet4: Array.from({ length: 6 }, emptyFleetSlot),
  fleetSectionVisible: {
    1: true,
    2: true,
    3: false,
    4: false
  },
  airbaseSectionVisible: true,
  visibleAirbaseCount: 3,
  fleetSlotLayoutMode: "3x2",
  airBases: Array.from({ length: 3 }, emptyAirBase),
  // Modal callbacks and state
  shipModalCb: null,
  equipModalCb: null,
  shipModalCurrentId: null,
  equipModalCurrentId: null,
  shipModalSource: "master",
  equipModalSource: "master",
  shipModalSideFilter: "ally",
  equipModalSideFilter: "ally",
  // Ship modal target context
  shipModalTargetFleetIndex: null,
  shipModalTargetShipSlotIndex: null,
  // Equipment modal target context
  equipModalTargetKind: null,
  equipModalTargetFleetIndex: null,
  equipModalTargetShipSlotIndex: null,
  equipModalTargetAirBaseIndex: null,
  equipModalTargetSlotIdx: -1,
  // Snapshot data
  snapshotShips: {},
  snapshotSlotItems: {},
  // UI guard: true when active workspace entry is locked and edits must be blocked.
  isWorkspaceReadOnly: false,
  // Equipment filtering master data
  /** stype id → equip_type map (default allowed equip types per ship type) */
  mstStypes: {},
  /** Set of equipment type[2] IDs allowed in exslot */
  equipExslotSet: /* @__PURE__ */ new Set(),
  /** ship_id → per-ship equipment type overrides */
  mstEquipShip: {},
  /** equip_id → exslot ship restrictions */
  mstEquipExslotShip: {},
  /** ship_id → excluded exslot equipment type[2] IDs */
  mstEquipLimitExslot: {}
};
simulatorReadOnly.set(state.isWorkspaceReadOnly);
simulatorCombinedFleetType.set(state.combinedFleetType);
simulatorFleetState.set(snapshotFleetState());
simulatorAirbaseState.set(snapshotAirbaseState());

// src/features/simulator/simulator-selectors.ts
function getAssetBaseUrl() {
  return state.assetBaseUrl;
}
function getBannerMap() {
  return state.bannerMap;
}

// src/features/simulator/equip-calc.ts
function buildImageUrl(base, key, opts) {
  const cleanBase = base.replace(/\/$/, "");
  const sourceUrl = `${cleanBase}/${key}`;
  if (!opts) return sourceUrl;
  try {
    const u = new URL(cleanBase);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname.startsWith("192.168.") || u.hostname.startsWith("10.") || u.hostname.endsWith(".local")) {
      return sourceUrl;
    }
  } catch {
    return sourceUrl;
  }
  const params = [];
  if (opts.f) params.push(`format=${opts.f}`);
  if (params.length === 0) return sourceUrl;
  return `${cleanBase}/cdn-cgi/image/${params.join(",")}/${key}`;
}
function bannerUrl(shipId, options) {
  const assetBaseUrl = getAssetBaseUrl();
  const key = getBannerMap()[String(shipId)];
  if (assetBaseUrl && key) return buildImageUrl(assetBaseUrl, key, options);
  if (!assetBaseUrl) {
    const fallback = `/api/asset-sync/ship-banner/${shipId}`;
    return fallback;
  }
  return "";
}

// src/features/battles/payload-guards.ts
function parseFiniteNumber(value) {
  if (value == null || typeof value === "string" && value.trim() === "") {
    return { value: null, status: "missing" };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { value, status: "valid" } : { value: null, status: "invalid" };
  }
  if (typeof value !== "string") {
    return { value: null, status: "invalid" };
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? { value: parsed, status: "valid" } : { value: null, status: "invalid" };
}

// src/features/battles/helpers.ts
function battleRowIndexForSort(value) {
  if (value == null || typeof value === "string" && value.trim() === "") {
    return Number.MAX_SAFE_INTEGER;
  }
  const index = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(index) && index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}
function normalizeNullableNumber(value) {
  return parseFiniteNumber(value).value;
}
function normalizeHpValue(value) {
  const parsed = parseFiniteNumber(value).value;
  if (parsed === null || parsed < 0) return null;
  return parsed;
}
function countValidHps(snapshot) {
  if (!Array.isArray(snapshot)) return 0;
  return snapshot.reduce((count, v) => normalizeHpValue(v) !== null ? count + 1 : count, 0);
}

// src/features/battles/resolvers/indexes.ts
function normalizeTimestamp(value) {
  const normalizeEpochMs = (raw) => raw < 1e12 ? raw * 1e3 : raw;
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeEpochMs(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? normalizeEpochMs(parsed) : null;
  }
  return null;
}

// src/features/battles/resolvers/detail.ts
function rowsByUuid(rows, uuid) {
  if (!uuid) return [];
  return rows.filter((row) => String(row["uuid"] ?? "") === uuid).sort(
    (left, right) => battleRowIndexForSort(left["index"]) - battleRowIndexForSort(right["index"])
  );
}
function firstByUuid(rows, uuid) {
  return rowsByUuid(rows, typeof uuid === "string" ? uuid : "")[0] ?? null;
}
function scopeRows(rows, envUuid) {
  return rows.filter((row) => String(row["env_uuid"] ?? "") === envUuid);
}
function normalizePositiveMapCoordinate(value) {
  const normalized = normalizeNullableNumber(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}
function firstByIndex(rows, index) {
  return rows.find((row) => Number(row["index"] ?? Number.NaN) === index) ?? null;
}
function resolveLinked(rows, explicitUuid, battleIndex) {
  return firstByUuid(rows, explicitUuid) ?? firstByIndex(rows, battleIndex);
}
function positiveNumbers(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => Number(entry ?? Number.NaN)).filter((entry) => Number.isSafeInteger(entry) && entry >= 0);
}
function groupIds(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string" && entry.length > 0);
  }
  return typeof value === "string" && value.length > 0 ? [value] : [];
}
function relatedCell(cells, battle, battleIndex) {
  const battleCellId = Number(battle["cell_id"] ?? Number.NaN);
  const matching = cells.filter(
    (cell) => positiveNumbers(cell["battle_index"]).includes(battleIndex)
  );
  const exact = matching.find((cell) => {
    const indexes = positiveNumbers(cell["battle_index"]);
    const cellIndexes = positiveNumbers(cell["cell_index"]);
    const position = indexes.indexOf(battleIndex);
    return position >= 0 && Number(cellIndexes[position]) === battleCellId;
  });
  return exact ?? matching[0] ?? cells.find(
    (cell) => positiveNumbers(cell["cell_index"]).includes(battleCellId)
  ) ?? null;
}
function findBattleDetailContext(options) {
  const scopedBattles = scopeRows(options.tables.battle, options.envUuid);
  const candidates = scopedBattles.filter(
    (row) => Number(row["index"] ?? Number.NaN) === options.battleIndex
  );
  if (candidates.length === 0) return null;
  const battle = [...candidates].sort(
    (left, right) => (normalizeTimestamp(left["timestamp"]) ?? Number.MAX_SAFE_INTEGER) - (normalizeTimestamp(right["timestamp"]) ?? Number.MAX_SAFE_INTEGER)
  )[0];
  if (!battle) return null;
  const cell = relatedCell(
    scopeRows(options.tables.cells, options.envUuid),
    battle,
    options.battleIndex
  );
  return {
    battle,
    cell,
    scopedBattles,
    duplicateBattleIndexes: Math.max(0, candidates.length - 1)
  };
}
function battleIndexes(battles, cell) {
  const availableIndexes = new Set(
    battles.map((row) => Number(row["index"] ?? Number.NaN)).filter((index) => Number.isSafeInteger(index) && index >= 0)
  );
  const cellBattleIndexes = positiveNumbers(cell?.["battle_index"]);
  const cellIndexes = positiveNumbers(cell?.["cell_index"]);
  if (cellIndexes.length > 0) {
    const battleByCellId = new Map(
      battles.map((row) => [Number(row["cell_id"] ?? Number.NaN), row])
    );
    const orderedByCell = cellIndexes.map(
      (cellId) => Number(battleByCellId.get(cellId)?.["index"] ?? Number.NaN)
    ).filter((index) => availableIndexes.has(index));
    if (orderedByCell.length > 0) {
      return [...new Set(orderedByCell)];
    }
  }
  if (cellBattleIndexes.length > 0) {
    const matchingIndexes = cellBattleIndexes.filter(
      (index) => availableIndexes.has(index)
    );
    if (matchingIndexes.length === cellBattleIndexes.length) {
      return [...new Set(matchingIndexes)].sort((left, right) => left - right);
    }
  }
  return [...availableIndexes].sort((left, right) => left - right);
}
function airBaseAttackRows(value) {
  if (Array.isArray(value)) {
    return value.filter(
      (entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry)
    );
  }
  if (value && typeof value === "object" && Array.isArray(value["attacks"])) {
    return airBaseAttackRows(value["attacks"]);
  }
  return [];
}
function addPositiveIds(value, target) {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    const id = Number(entry ?? 0);
    if (Number.isSafeInteger(id) && id > 0) target.add(id);
  }
}
function hpScore(rows, snapshot) {
  if (rows.length === 0 || snapshot.length === 0) return Number.MAX_SAFE_INTEGER;
  const sorted = [...rows].sort(
    (left, right) => battleRowIndexForSort(left["index"]) - battleRowIndexForSort(right["index"])
  );
  const validSnapshotCount = countValidHps(snapshot);
  const length = Math.min(sorted.length, snapshot.length);
  let score = Math.abs(sorted.length - validSnapshotCount) * 20;
  for (let index = 0; index < length; index += 1) {
    const row = sorted[index];
    const snapshotValue = snapshot[index];
    if (!row || snapshotValue === void 0) continue;
    const rowHp = normalizeHpValue(row["nowhp"] ?? row["maxhp"]);
    const snapshotHp = normalizeHpValue(snapshotValue);
    if (rowHp === null && snapshotHp === null) continue;
    if (rowHp === null || snapshotHp === null) {
      score += 50;
      continue;
    }
    score += Math.abs(rowHp - snapshotHp);
  }
  return score;
}
function fleetRows(battle, decks, ships, slotItems, side) {
  const hpSnapshot = side === "own" ? battle["f_nowhps"] ?? battle["midnight_f_nowhps"] : battle["e_nowhps"] ?? battle["midnight_e_nowhps"];
  const candidateGroups = /* @__PURE__ */ new Map();
  for (const ship of ships) {
    const group = String(ship["uuid"] ?? "");
    if (!group) continue;
    const rows = candidateGroups.get(group) ?? [];
    rows.push(ship);
    candidateGroups.set(group, rows);
  }
  for (const rows of candidateGroups.values()) {
    rows.sort(
      (left, right) => battleRowIndexForSort(left["index"]) - battleRowIndexForSort(right["index"])
    );
  }
  let selectedGroups = [];
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
  const groupRows = ships.filter((row) => shipGroups.has(String(row["uuid"] ?? ""))).sort(
    (left, right) => battleRowIndexForSort(left["index"]) - battleRowIndexForSort(right["index"])
  );
  const slotsByGroup = /* @__PURE__ */ new Map();
  for (const row of slotItems) {
    const group = String(row["uuid"] ?? "");
    if (!group) continue;
    const current = slotsByGroup.get(group) ?? [];
    current.push(row);
    slotsByGroup.set(group, current);
  }
  return groupRows.map((row) => ({
    ...row,
    slot_items: typeof row["slot"] === "string" ? slotsByGroup.get(row["slot"]) ?? [] : []
  }));
}
function indexedFleet(rows, masterShips, masterSlotItems, side) {
  const ships = new Map(masterShips.map((row) => [Number(row["id"] ?? 0), row]));
  const slotItems = new Map(masterSlotItems.map((row) => [Number(row["id"] ?? 0), row]));
  return rows.map((row) => {
    const shipId = Number(row["ship_id"] ?? row["mst_ship_id"] ?? 0) || null;
    const sourceSlots = (Array.isArray(row["slot_items"]) ? row["slot_items"] : []).filter((slot) => {
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) return false;
      return Number(slot["mst_slotitem_id"] ?? 0) > 0;
    });
    return {
      name: String(ships.get(shipId ?? 0)?.["name"] ?? (shipId ? `${side === "own" ? "\u8266" : "\u6575\u8266"}ID:${shipId}` : side === "own" ? "\u5473\u65B9\u8266" : "\u6575\u8266")),
      shipId,
      bannerUrl: shipId ? bannerUrl(shipId, { f: "auto" }) : "",
      level: normalizeNullableNumber(row["lv"]),
      nowhp: normalizeNullableNumber(row["nowhp"]),
      maxhp: normalizeNullableNumber(row["maxhp"]),
      karyoku: normalizeNullableNumber(row["karyoku"]),
      raisou: normalizeNullableNumber(row["raisou"]),
      taiku: normalizeNullableNumber(row["taiku"]),
      soukou: normalizeNullableNumber(row["soukou"]),
      equipments: sourceSlots.map((slot) => {
        const slotId = Number(slot["mst_slotitem_id"] ?? 0) || null;
        return {
          name: String(slotItems.get(slotId ?? 0)?.["name"] ?? (slotId ? `\u88C5\u5099ID:${slotId}` : "")),
          level: normalizeNullableNumber(slot["level"]),
          iconType: Array.isArray(slotItems.get(slotId ?? 0)?.["type"]) && (slotItems.get(slotId ?? 0)?.["type"]).length >= 4 ? Number((slotItems.get(slotId ?? 0)?.["type"])[3] ?? 0) || null : null,
          slotItemId: slotId
        };
      })
    };
  });
}
function resolveBattleDetail(options) {
  const context = findBattleDetailContext(options);
  if (!context) return null;
  const scopedTables = {
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
    destructionBattle: scopeRows(options.tables.destructionBattle, options.envUuid)
  };
  const scopedBattles = scopedTables.battle;
  const battle = context.battle;
  const cell = context.cell;
  let unresolvedReferences = 0;
  const listAndDetail = (listRows, detailRows, reference, detailField) => {
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
  const linkedValue = (row) => row ? [row] : [];
  const resolve = (rows, reference) => {
    const value = resolveLinked(rows, reference, options.battleIndex);
    if (!value && reference) unresolvedReferences += 1;
    return value;
  };
  const resolveDestructionBattle = (reference) => {
    const referencedRows = typeof reference === "string" ? rowsByUuid(scopedTables.destructionBattle, reference) : [];
    const value = referencedRows.find(
      (row) => Number(row["index"] ?? Number.NaN) === options.battleIndex
    );
    if (value) return value;
    if (referencedRows.length === 0 && !reference) {
      return firstByIndex(scopedTables.destructionBattle, options.battleIndex);
    }
    if (!value && reference && referencedRows.length === 0) unresolvedReferences += 1;
    return null;
  };
  const battleResult = resolve(scopedTables.battleResult, battle["battle_result"]);
  const openingRaigeki = resolve(scopedTables.openingRaigeki, battle["opening_raigeki"]);
  const closingRaigeki = resolve(scopedTables.closingRaigeki, battle["closing_raigeki"]);
  const airbaseAssault = resolve(scopedTables.airbaseAssault, battle["air_base_assault"]);
  const airbaseList = resolve(scopedTables.airbaseAirattackLists, battle["air_base_air_attacks"]);
  const airbaseAttackUuids = groupIds(airbaseList?.["air_base_air_attack"]);
  const airbaseAttacks = airbaseAttackUuids.flatMap(
    (uuid) => rowsByUuid(scopedTables.airbaseAirattacks, uuid)
  );
  const carrierbaseAssault = resolve(scopedTables.carrierbaseAssault, battle["carrier_base_assault"]);
  const supportHourai = resolve(scopedTables.supportHourai, battle["support_hourai"]);
  const supportAirattack = resolve(scopedTables.supportAirattack, battle["support_airattack"]);
  const nightSupportHourai = resolve(scopedTables.nightSupportHourai, battle["night_support_hourai"]);
  const nightSupportAirattack = resolve(scopedTables.nightSupportAirattack, battle["night_support_airattack"]);
  const destructionBattle = resolveDestructionBattle(cell?.["destruction_battles"]);
  const friendlyList = resolve(scopedTables.friendlySupportHouraiLists, battle["friendly_force_attack"]);
  const friendlySupport = resolve(scopedTables.friendlySupportHourai, friendlyList?.["friendly_support_hourai"]);
  const mergedBattle = {
    ...battle,
    timestamp: normalizeTimestamp(battle["timestamp"]) ?? normalizeTimestamp(battle["midnight_timestamp"]),
    maparea_id: normalizePositiveMapCoordinate(cell?.["maparea_id"]) ?? normalizePositiveMapCoordinate(battle["maparea_id"]),
    mapinfo_no: normalizePositiveMapCoordinate(cell?.["mapinfo_no"]) ?? normalizePositiveMapCoordinate(battle["mapinfo_no"]),
    battle_result: battleResult ?? battle["battle_result"] ?? null,
    opening_raigeki: openingRaigeki ?? battle["opening_raigeki"] ?? null,
    closing_raigeki: closingRaigeki ?? battle["closing_raigeki"] ?? null,
    support_hourai: supportHourai,
    support_airattack: supportAirattack,
    support_attack: supportHourai || supportAirattack ? { support_hourai: supportHourai, support_airatack: supportAirattack } : null,
    night_support_hourai: nightSupportHourai,
    night_support_airattack: nightSupportAirattack,
    night_support_attack: nightSupportHourai || nightSupportAirattack ? { hourai: nightSupportHourai, airatack: nightSupportAirattack } : null,
    friendly_force_attack: friendlySupport ? {
      fleet_info: battle["friendly_force_attack"] && typeof battle["friendly_force_attack"] === "object" ? battle["friendly_force_attack"]["fleet_info"] ?? null : null,
      support_hourai: friendlySupport
    } : battle["friendly_force_attack"] ?? null,
    midnight_hougeki: midnight.details.length > 0 ? midnight.details : battle["midnight_hougeki"],
    opening_taisen: openingTaisen.details.length > 0 ? openingTaisen.details : battle["opening_taisen"],
    hougeki: hougeki.details.length > 0 ? hougeki.details : battle["hougeki"],
    opening_air_attack: openingAirattack.details.length > 0 ? openingAirattack.details : battle["opening_air_attack"],
    air_base_assault: airbaseAssault ?? battle["air_base_assault"] ?? null,
    air_base_air_attacks: airbaseList ? { ...airbaseList, attacks: airbaseAttacks } : battle["air_base_air_attacks"] ?? null,
    carrier_base_assault: carrierbaseAssault ?? battle["carrier_base_assault"] ?? null,
    destruction_battle: destructionBattle
  };
  const ownShips = fleetRows(mergedBattle, scopedTables.ownDeck, scopedTables.ownShip, scopedTables.ownSlotItem, "own");
  const enemyShips = fleetRows(mergedBattle, scopedTables.enemyDeck, scopedTables.enemyShip, scopedTables.enemySlotItem, "enemy");
  const relevantShipIds = /* @__PURE__ */ new Set();
  for (const row of [...scopedTables.ownShip, ...scopedTables.enemyShip]) {
    const shipId = Number(row["ship_id"] ?? row["mst_ship_id"] ?? 0);
    if (shipId > 0) relevantShipIds.add(shipId);
  }
  const dropShipId = Number(battleResult?.["drop_ship_id"] ?? 0);
  if (dropShipId > 0) relevantShipIds.add(dropShipId);
  const relevantSlotItemIds = /* @__PURE__ */ new Set();
  for (const row of [...scopedTables.ownSlotItem, ...scopedTables.enemySlotItem]) {
    const slotItemId = Number(row["mst_slotitem_id"] ?? 0);
    if (slotItemId > 0) relevantSlotItemIds.add(slotItemId);
  }
  for (const attack of airBaseAttackRows(mergedBattle["air_base_air_attacks"])) {
    addPositiveIds(attack["squadron_plane"], relevantSlotItemIds);
  }
  if (mergedBattle["air_base_assault"] && typeof mergedBattle["air_base_assault"] === "object") {
    addPositiveIds(
      mergedBattle["air_base_assault"]["squadron_plane"],
      relevantSlotItemIds
    );
  }
  const filteredMasterShips = (options.masterShips ?? []).filter(
    (row) => relevantShipIds.has(Number(row["id"] ?? 0))
  );
  const filteredMasterSlotItems = (options.masterSlotItems ?? []).filter(
    (row) => relevantSlotItemIds.has(Number(row["id"] ?? 0))
  );
  const payload = {
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
      friendly_support_hourai: linkedValue(friendlySupport)
    },
    refs: {
      mst_ship: filteredMasterShips,
      mst_slotitem: filteredMasterSlotItems,
      weapon_icon_frames: options.weaponIconFrames
    },
    derived: {
      friendly_fleet: indexedFleet(ownShips, options.masterShips ?? [], options.masterSlotItems ?? [], "own"),
      enemy_fleet: indexedFleet(enemyShips, options.masterShips ?? [], options.masterSlotItems ?? [], "enemy")
    },
    source_meta: { env_uuid: options.envUuid, battle_index: options.battleIndex }
  };
  return {
    payload,
    duplicateBattleIndexes: context.duplicateBattleIndexes,
    unresolvedReferences
  };
}

// scripts/rebuild-all-snapshots.ts
function getS3Client() {
  const endpoint = process.env["R2_S3_ENDPOINT"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"] || "";
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"] || "";
  return new S3Client({
    region: "auto",
    ...endpoint ? { endpoint } : {},
    credentials: { accessKeyId, secretAccessKey }
  });
}
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function pMap(items, fn, concurrency = 15) {
  const results = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
async function rebuildSnapshotsForPeriod(options) {
  const { periodTag, masterShips, masterSlotItems, s3, bucketName } = options;
  const tableVersion = options.tableVersion || "0.6.0";
  console.log("\n========================================================");
  console.log("[rebuild-snapshots] Processing period: " + periodTag + " (version: " + tableVersion + ")");
  console.log("========================================================");
  const d1Output = execSync(
    `pnpm --filter fusou-web exec wrangler d1 execute dev-kc-battle-index --remote --json --command "SELECT file_path FROM archived_files WHERE file_path LIKE '%/` + periodTag + `/period/%' AND file_path NOT LIKE 'compacted/%'"`,
    { encoding: "utf-8" }
  );
  const d1Parsed = JSON.parse(d1Output);
  const filePaths = (d1Parsed[0]?.results || []).map((r) => r.file_path);
  console.log("[rebuild-snapshots] Found " + filePaths.length + " active period files for " + periodTag + ".");
  if (filePaths.length === 0) {
    console.warn("[rebuild-snapshots] No period files found for " + periodTag + ", skipping.");
    return;
  }
  console.log("[rebuild-snapshots] Downloading and decoding " + filePaths.length + " tables via S3 API...");
  const tableRecords = {};
  await pMap(filePaths, async (fp) => {
    const match = fp.match(/\/([^/]+)-001\.avro$/) || fp.match(/\/([^/]+)\.avro$/);
    if (!match) return;
    const tableName = match[1];
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: fp }));
      const buf = await streamToBuffer(obj.Body);
      tableRecords[tableName] = decodeAvroOcfToJson(new Uint8Array(buf));
    } catch (err) {
      console.warn("[rebuild-snapshots] Warning: could not download/decode " + fp + ": " + err.message);
    }
  }, 10);
  const detailTables = {
    battle: tableRecords["battle"] || [],
    cells: tableRecords["cells"] || [],
    battleResult: tableRecords["battle_result"] || [],
    ownDeck: tableRecords["own_deck"] || [],
    ownShip: tableRecords["own_ship"] || [],
    ownSlotItem: tableRecords["own_slotitem"] || [],
    enemyDeck: tableRecords["enemy_deck"] || [],
    enemyShip: tableRecords["enemy_ship"] || [],
    enemySlotItem: tableRecords["enemy_slotitem"] || [],
    midnightHougekiLists: tableRecords["midnight_hougeki_list"] || [],
    midnightHougekis: tableRecords["midnight_hougeki"] || [],
    openingTaisenLists: tableRecords["opening_taisen_list"] || [],
    openingTaisens: tableRecords["opening_taisen"] || [],
    hougekiLists: tableRecords["hougeki_list"] || [],
    hougekis: tableRecords["hougeki"] || [],
    openingAirattackLists: tableRecords["opening_airattack_list"] || [],
    openingAirattacks: tableRecords["opening_airattack"] || [],
    openingRaigeki: tableRecords["opening_raigeki"] || [],
    closingRaigeki: tableRecords["closing_raigeki"] || [],
    airbaseAssault: tableRecords["airbase_assault"] || [],
    airbaseAirattackLists: tableRecords["airbase_airattack_list"] || [],
    airbaseAirattacks: tableRecords["airbase_airattack"] || [],
    carrierbaseAssault: tableRecords["carrierbase_assault"] || [],
    supportHourai: tableRecords["support_hourai"] || [],
    supportAirattack: tableRecords["support_airattack"] || [],
    nightSupportHourai: tableRecords["night_support_hourai"] || [],
    nightSupportAirattack: tableRecords["night_support_airattack"] || [],
    friendlySupportHouraiLists: tableRecords["friendly_support_hourai_list"] || [],
    friendlySupportHourai: tableRecords["friendly_support_hourai"] || [],
    destructionBattle: tableRecords["destruction_battle"] || []
  };
  const battles = detailTables.battle;
  console.log("[rebuild-snapshots] Period " + periodTag + " has " + battles.length + " battles.");
  if (battles.length === 0) {
    console.log("[rebuild-snapshots] No battles found for " + periodTag + ", skipping snapshot generation.");
    return;
  }
  const uniqueEnvUuids = Array.from(new Set(battles.map((b) => String(b.env_uuid || "")).filter(Boolean)));
  console.log("[rebuild-snapshots] Processing " + uniqueEnvUuids.length + " unique sorties...");
  const uploadTasks = [];
  for (const envUuid of uniqueEnvUuids) {
    const envBattles = battles.filter((b) => b.env_uuid === envUuid).sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
    const envBattlePayloads = {};
    for (const b of envBattles) {
      const battleIndex = Number(b.index ?? 0);
      const resolution = resolveBattleDetail({
        periodTag,
        tableVersion,
        envUuid,
        battleIndex,
        masterShips,
        masterSlotItems,
        tables: detailTables
      });
      if (resolution) {
        envBattlePayloads[String(battleIndex)] = resolution.payload;
        const battleJson = JSON.stringify(resolution.payload);
        const battleBr = zlib.brotliCompressSync(Buffer.from(battleJson, "utf-8"), {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 }
        });
        uploadTasks.push({
          key: "snapshots/detail/" + periodTag + "/" + envUuid + "_" + battleIndex + ".json.br",
          buffer: battleBr,
          contentType: "application/json"
        });
      }
    }
    const bundle = {
      success: true,
      env_uuid: envUuid,
      period_tag: periodTag,
      table_version: tableVersion,
      snapshot_timestamp: Date.now(),
      battles: envBattlePayloads
    };
    const bundleJson = JSON.stringify(bundle);
    const bundleBr = zlib.brotliCompressSync(Buffer.from(bundleJson, "utf-8"), {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 }
    });
    uploadTasks.push({
      key: "snapshots/env_detail/" + periodTag + "/" + envUuid + ".json.br",
      buffer: bundleBr,
      contentType: "application/json"
    });
  }
  console.log("[rebuild-snapshots] Building Overview and Drops snapshots for " + periodTag + "...");
  const sortiesForOverview = uniqueEnvUuids.map((envUuid) => {
    const sBattles = battles.filter((b) => b.env_uuid === envUuid);
    const sCells = detailTables.cells.filter((c) => c.env_uuid === envUuid);
    const sResults = detailTables.battleResult.filter((r) => r.env_uuid === envUuid);
    const sEnemyDecks = detailTables.enemyDeck.filter((d) => d.env_uuid === envUuid);
    const sEnemyShips = detailTables.enemyShip.filter((s) => s.env_uuid === envUuid);
    const firstTs = Number(sBattles[0]?.timestamp || Date.now());
    return {
      env_uuid: envUuid,
      period_tag: periodTag,
      table_version: tableVersion,
      timestamp: firstTs,
      cells: sCells,
      battles: sBattles,
      battleResults: sResults,
      enemyDecks: sEnemyDecks,
      enemyShips: sEnemyShips
    };
  });
  const overviewPayload = buildOverviewSnapshot(sortiesForOverview, { periodTag });
  const overviewJson = JSON.stringify(overviewPayload);
  const overviewBr = zlib.brotliCompressSync(Buffer.from(overviewJson, "utf-8"), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 }
  });
  const dropsPayload = buildDropsSnapshot(sortiesForOverview, { periodTag });
  dropsPayload.mst_ships = masterShips;
  const dropsJson = JSON.stringify(dropsPayload);
  const dropsBr = zlib.brotliCompressSync(Buffer.from(dropsJson, "utf-8"), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 }
  });
  uploadTasks.push(
    { key: "snapshots/overview/" + periodTag + ".json.br", buffer: overviewBr, contentType: "application/json" },
    { key: "snapshots/drops/" + periodTag + ".json.br", buffer: dropsBr, contentType: "application/json" }
  );
  console.log("[rebuild-snapshots] Uploading " + uploadTasks.length + " snapshot objects via S3 API (concurrency: 20)...");
  let uploadedCount = 0;
  await pMap(uploadTasks, async (task) => {
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: task.key,
      Body: task.buffer,
      ContentType: task.contentType,
      ContentEncoding: "br"
    }));
    uploadedCount++;
    if (uploadedCount % 50 === 0 || uploadedCount === uploadTasks.length) {
      console.log("[rebuild-snapshots] " + periodTag + ": uploaded " + uploadedCount + "/" + uploadTasks.length + " objects...");
    }
  }, 20);
  console.log("[rebuild-snapshots] Period " + periodTag + " complete! (" + uploadTasks.length + " objects created, 0 latest aliases)");
}
async function rebuildAllPeriods() {
  const bucketName = process.env["R2_BUCKET"] || "dev-kc-battle-data";
  const s3 = getS3Client();
  console.log("[rebuild-all] Fetching master data...");
  const base = process.env["API_BASE_URL"] || "https://fusou.dev";
  const [shipRes, slotRes] = await Promise.all([
    fetch(base + "/api/master-data/json?table_name=mst_ship"),
    fetch(base + "/api/master-data/json?table_name=mst_slotitem")
  ]);
  const shipJson = await shipRes.json();
  const slotJson = await slotRes.json();
  const masterShips = shipJson.records || [];
  const masterSlotItems = slotJson.records || [];
  console.log("[rebuild-all] Loaded " + masterShips.length + " master ships, " + masterSlotItems.length + " master slot items.");
  console.log("[rebuild-all] Querying D1 for all periods with battle records...");
  const d1Raw = execSync(
    `pnpm --filter fusou-web exec wrangler d1 execute dev-kc-battle-index --remote --json --command "SELECT period_tag, table_version, SUM(record_count) as count FROM block_indexes WHERE table_name = 'battle' GROUP BY period_tag, table_version HAVING SUM(record_count) > 0 ORDER BY period_tag DESC"`,
    { encoding: "utf-8" }
  );
  const parsed = JSON.parse(d1Raw);
  const periods = parsed[0]?.results || [];
  console.log("[rebuild-all] Found " + periods.length + " periods with battle data:", periods.map((p) => p.period_tag + " (" + p.count + " battles)"));
  for (const p of periods) {
    try {
      await rebuildSnapshotsForPeriod({
        periodTag: p.period_tag,
        tableVersion: p.table_version,
        masterShips,
        masterSlotItems,
        s3,
        bucketName
      });
    } catch (err) {
      console.error("[rebuild-all] Error processing period " + p.period_tag + ":", err);
    }
  }
  console.log("\n========================================================");
  console.log("[rebuild-all] All periods processed successfully!");
  console.log("========================================================\n");
}
if (process.argv[1]?.includes("rebuild-all-snapshots")) {
  rebuildAllPeriods().catch((err) => {
    console.error("[rebuild-all] Fatal error:", err);
    process.exit(1);
  });
}
export {
  rebuildAllPeriods,
  rebuildSnapshotsForPeriod
};
