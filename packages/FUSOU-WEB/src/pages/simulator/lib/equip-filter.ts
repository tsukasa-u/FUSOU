// ── Equipment filtering: determine equippable items per ship ──
//
// Uses the following master data tables:
//   mst_stype           — default allowed equipment types per ship type
//   mst_equip_ship      — per-ship overrides for allowed equipment types
//   mst_equip_exslot    — base list of equipment type[2] IDs allowed in exslot
//   mst_equip_exslot_ship  — per-equipment exslot ship/stype/ctype restrictions
//   mst_equip_limit_exslot — per-ship excluded exslot equipment type[2] IDs

import type { MstSlotItemData } from "./types";
import {
  getBaseExslotEquipCount,
  getMasterEquipExslotShip,
  getMasterEquipLimitExslot,
  getMasterEquipShipMap,
  getMasterShip,
  getMasterStypes,
  hasBaseExslotEquipType,
} from "./simulator-selectors";

type NormalSlotRule = {
  allowedTypes: Set<number>;
  itemAllowListByType: Map<number, Set<number>>;
};

const NORMAL_SLOT_EXCLUDED_TYPES_BY_SHIP: Array<{
  shipIds: number[];
  slotIndex: number | { min: number };
  mode: "exclude" | "allow-only";
  typeIds: number[];
}> = [
  {
    shipIds: [553, 554],
    slotIndex: { min: 2 },
    mode: "exclude",
    typeIds: [2, 3],
  },
  {
    shipIds: [622, 623, 624],
    slotIndex: 3,
    mode: "exclude",
    typeIds: [1, 2, 5, 22],
  },
  {
    shipIds: [622, 623, 624],
    slotIndex: 4,
    mode: "allow-only",
    typeIds: [12, 21, 43],
  },
  {
    shipIds: [662, 663, 668],
    slotIndex: 3,
    mode: "exclude",
    typeIds: [5],
  },
  {
    shipIds: [963, 968],
    slotIndex: 3,
    mode: "exclude",
    typeIds: [1, 5, 13],
  },
  {
    shipIds: [978],
    slotIndex: 2,
    mode: "exclude",
    typeIds: [2],
  },
];

export type EquipSelectionRequirement = {
  level: number;
  alv: number;
};

type NormalSlotTypeRestriction = {
  mode: "exclude" | "allow-only";
  typeIds: Set<number>;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseShipOverrideRule(shipId: number): NormalSlotRule | null {
  const shipOverride = getMasterEquipShipMap()[shipId];
  if (!shipOverride) return null;

  const allowedTypes = new Set<number>();
  const itemAllowListByType = new Map<number, Set<number>>();

  // Current format: map of type_id -> null or allowed equipment IDs.
  for (const [typeIdStr, value] of Object.entries(shipOverride.equip_type)) {
    const typeId = Number(typeIdStr);
    if (!Number.isFinite(typeId)) continue;

    allowedTypes.add(typeId);

    if (Array.isArray(value)) {
      const allowItemSet = new Set<number>();
      for (const itemId of value) {
        if (!isFiniteNumber(itemId)) continue;
        allowItemSet.add(itemId);
      }
      itemAllowListByType.set(typeId, allowItemSet);
    }
  }

  return allowedTypes.size > 0 ? { allowedTypes, itemAllowListByType } : null;
}

/**
 * Get the set of allowed equipment type IDs (type[2]) for a ship in normal slots.
 *
 * Priority:
 *  1. mst_equip_ship per-ship override (if entry exists for this ship)
 *  2. mst_stype default for the ship's stype
 */
function getNormalSlotRule(shipId: number): NormalSlotRule | null {
  const ship = getMasterShip(shipId);
  if (!ship) return null;

  // Per-ship override from mst_equip_ship
  const shipRule = parseShipOverrideRule(shipId);
  if (shipRule) return shipRule;

  // Default from mst_stype
  const stypeData = getMasterStypes()[ship.stype];
  if (!stypeData) return null;

  const allowedTypes = new Set<number>();
  for (const [typeIdStr, flag] of Object.entries(stypeData.equip_type)) {
    if (flag === 1) {
      const typeId = Number(typeIdStr);
      if (!Number.isFinite(typeId)) continue;
      allowedTypes.add(typeId);
    }
  }

  if (allowedTypes.size === 0) return null;
  return {
    allowedTypes,
    itemAllowListByType: new Map<number, Set<number>>(),
  };
}

function getNormalSlotTypeRestriction(
  shipId: number,
  slotIdx: number | null | undefined,
): NormalSlotTypeRestriction | null {
  if (slotIdx == null || slotIdx < 0) return null;

  for (const rule of NORMAL_SLOT_EXCLUDED_TYPES_BY_SHIP) {
    if (!rule.shipIds.includes(shipId)) continue;

    const matchesSlot =
      typeof rule.slotIndex === "number"
        ? slotIdx === rule.slotIndex
        : slotIdx >= rule.slotIndex.min;
    if (!matchesSlot) continue;

    return {
      mode: rule.mode,
      typeIds: new Set(rule.typeIds),
    };
  }

  return null;
}

function passesNormalSlotTypeRestriction(
  shipId: number,
  slotIdx: number | null | undefined,
  equipType: number,
): boolean {
  const restriction = getNormalSlotTypeRestriction(shipId, slotIdx);
  if (!restriction) return true;

  if (restriction.mode === "exclude") {
    return !restriction.typeIds.has(equipType);
  }

  return restriction.typeIds.has(equipType);
}

export function getNormalSlotAllowedIndexes(
  shipId: number | null,
  equip: MstSlotItemData,
): number[] {
  if (shipId == null) return [];

  const ship = getMasterShip(shipId);
  if (!ship || ship.slot_num <= 0) return [];

  const baseFiltered = filterForNormalSlot(shipId, [equip]);
  if (baseFiltered && baseFiltered.length === 0) return [];

  const indexes: number[] = [];
  for (let slotIdx = 0; slotIdx < ship.slot_num; slotIdx += 1) {
    const filtered = filterForNormalSlot(shipId, [equip], slotIdx);
    if (filtered == null || filtered.length > 0) {
      indexes.push(slotIdx);
    }
  }

  return indexes;
}

/**
 * Check whether a specific equipment can be placed in a ship's exslot.
 *
 * Logic:
 *  1. Enforce normal-slot compatibility from mst_equip_ship/mst_stype.
 *  2. For exslot base rule, use equipment type[2]:
 *     - type must be in mst_equip_exslot
 *     - type must NOT be listed in mst_equip_limit_exslot for the ship
 *  3. Independently, mst_equip_exslot_ship can allow specific equipment IDs
 *     for matching ship/stype/ctype (optionally with snapshot improvement level).
 *  4. Item is allowed when either base-type rule or per-equipment exslot-ship rule passes.
 */
function canEquipInExslot(
  shipId: number,
  equip: MstSlotItemData,
): boolean {
  return getExslotSelectionRequirement(shipId, equip) != null;
}

/**
 * Return the minimum required improvement/proficiency values to equip in exslot.
 * Returns null when the item is not equippable in exslot for the target ship.
 */
export function getExslotSelectionRequirement(
  shipId: number | null,
  equip: MstSlotItemData,
): EquipSelectionRequirement | null {
  if (shipId == null) return null;

  const ship = getMasterShip(shipId);
  if (!ship) return null;

  // Ship-side compatibility from mst_equip_ship / mst_stype.
  const equipId = equip.id;
  const equipType = equip.type?.[2] ?? null;
  if (equipType == null) return null;

  const normalRule = getNormalSlotRule(shipId);
  let inShipCompat = false;
  if (normalRule) {
    if (normalRule.allowedTypes.has(equipType)) {
      const allowItems = normalRule.itemAllowListByType.get(equipType);
      inShipCompat = !allowItems || allowItems.has(equipId);
    }
  }

  // Respect ship-side compatibility when filter master data exists.
  if (normalRule && !inShipCompat) return null;

  // Base exslot type rule with per-ship excluded type list.
  const inBaseTypeList = hasBaseExslotEquipType(equipType);
  const limitData = getMasterEquipLimitExslot(shipId);
  const blockedTypeSet = new Set((limitData?.equip ?? []).map(Number));
  const allowByBaseType = inBaseTypeList && !blockedTypeSet.has(equipType);

  // Per-equipment exslot-ship explicit rule.
  let allowByExslotShip = false;
  let requiredLevelByExslotShip = 0;
  let requiredAlvByExslotShip = 0;
  const exslotShipData = getMasterEquipExslotShip(equipId);
  if (exslotShipData) {
    // Ship must match at least one condition: ship_id, stype, or ctype.
    const matchShipId =
      exslotShipData.ship_ids != null &&
      String(shipId) in exslotShipData.ship_ids;
    const matchStype =
      exslotShipData.stypes != null &&
      String(ship.stype) in exslotShipData.stypes;
    const matchCtype =
      exslotShipData.ctypes != null &&
      String(ship.ctype) in exslotShipData.ctypes;

    if (matchShipId || matchStype || matchCtype) {
      // In raw game UI this uses inventory item improvement level.
      // For master-only rows, improvement is unknown, so we do not reject.
      const snapshotLevel =
        (equip as MstSlotItemData & { _snapshotLevel?: number })._snapshotLevel;
      const snapshotAlv =
        (equip as MstSlotItemData & { _snapshotAlv?: number })._snapshotAlv;
      const reqLevel = Math.max(0, Number(exslotShipData.req_level ?? 0));
      const reqAlv = Math.max(
        0,
        Number(exslotShipData.req_alv ?? 0),
      );
      if (
        (snapshotLevel == null || snapshotLevel >= reqLevel) &&
        (snapshotAlv == null || snapshotAlv >= reqAlv)
      ) {
        allowByExslotShip = true;
        requiredLevelByExslotShip = reqLevel;
        requiredAlvByExslotShip = reqAlv;
      }
    }
  }

  if (!allowByBaseType && !allowByExslotShip) return null;

  // Base exslot type route has no additional level/alv requirement.
  if (allowByBaseType) {
    return { level: 0, alv: 0 };
  }

  return {
    level: requiredLevelByExslotShip,
    alv: requiredAlvByExslotShip,
  };
}

/**
 * Filter equipment list to only items equippable in a ship's normal slots.
 * Returns null if no filter data is available (show all equipment).
 */
export function filterForNormalSlot(
  shipId: number | null,
  items: MstSlotItemData[],
  slotIdx?: number | null,
): MstSlotItemData[] | null {
  if (shipId == null) return null;

  const hasStypeData = Object.keys(getMasterStypes()).length > 0;
  const hasEquipShipData = Object.keys(getMasterEquipShipMap()).length > 0;
  if (!hasStypeData && !hasEquipShipData) return null;

  const rule = getNormalSlotRule(shipId);
  if (!rule) return null;

  return items.filter((e) => {
    const equipType = e.type?.[2];
    if (equipType == null || !rule.allowedTypes.has(equipType)) return false;
    if (!passesNormalSlotTypeRestriction(shipId, slotIdx, equipType)) return false;

    const allowItems = rule.itemAllowListByType.get(equipType);
    if (!allowItems) return true;

    return allowItems.has(e.id);
  });
}

/**
 * Filter equipment list to only items equippable in a ship's exslot.
 * Returns null if no filter data is available (show all equipment).
 */
export function filterForExslot(
  shipId: number | null,
  items: MstSlotItemData[],
): MstSlotItemData[] | null {
  if (shipId == null) return null;
  if (getBaseExslotEquipCount() === 0) return null;

  return items.filter((e) => canEquipInExslot(shipId, e));
}

/**
 * Returns true if equip filter data is loaded and available.
 */
export function hasEquipFilterData(): boolean {
  return (
    Object.keys(getMasterStypes()).length > 0 || getBaseExslotEquipCount() > 0
  );
}
