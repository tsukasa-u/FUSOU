// ── Equipment filtering: determine equippable items per ship ──
//
// Uses the following master data tables:
//   mst_stype           — default allowed equipment types per ship type
//   mst_equip_ship      — per-ship overrides for allowed equipment types
//   mst_equip_exslot    — base list of equipment IDs allowed in exslot
//   mst_equip_exslot_ship  — per-equipment exslot ship/stype/ctype restrictions
//   mst_equip_limit_exslot — per-ship exslot equipment limits

import { state } from "./state";
import type { MstSlotItemData } from "./types";

type NormalSlotRule = {
  allowedTypes: Set<number>;
  itemAllowListByType: Map<number, Set<number>>;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseShipOverrideRule(shipId: number): NormalSlotRule | null {
  const shipOverride = state.mstEquipShip[shipId];
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
  const ship = state.mstShips[shipId];
  if (!ship) return null;

  // Per-ship override from mst_equip_ship
  const shipRule = parseShipOverrideRule(shipId);
  if (shipRule) return shipRule;

  // Default from mst_stype
  const stypeData = state.mstStypes[ship.stype];
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

/**
 * Check whether a specific equipment can be placed in a ship's exslot.
 *
 * Logic:
 *  1. Equipment must be in the base exslot list (mst_equip_exslot)
 *  2. If mst_equip_exslot_ship has a record for this equipment,
 *     the ship must match by ship_id, stype, or ctype, and meet req_level
 *  3. If mst_equip_limit_exslot has a record for this ship,
 *     the equipment must be in the allowed list
 */
function canEquipInExslot(
  shipId: number,
  shipLevel: number | null,
  equipId: number,
): boolean {
  // Must be in base exslot list
  if (!state.equipExslotSet.has(equipId)) return false;

  const ship = state.mstShips[shipId];
  if (!ship) return false;

  // Check per-equipment ship restrictions
  const exslotShipData = state.mstEquipExslotShip[equipId];
  if (exslotShipData) {
    // Level check
    if (
      exslotShipData.req_level > 0 &&
      (shipLevel ?? 0) < exslotShipData.req_level
    ) {
      return false;
    }

    // Ship must match at least one condition: ship_id, stype, or ctype
    const matchShipId =
      exslotShipData.ship_ids != null &&
      String(shipId) in exslotShipData.ship_ids;
    const matchStype =
      exslotShipData.stypes != null &&
      String(ship.stype) in exslotShipData.stypes;
    const matchCtype =
      exslotShipData.ctypes != null &&
      String(ship.ctype) in exslotShipData.ctypes;

    if (!matchShipId && !matchStype && !matchCtype) {
      return false;
    }
  }

  // Check per-ship exslot limits
  const limitData = state.mstEquipLimitExslot[shipId];
  if (limitData) {
    // If limit data exists for this ship, only equipments in the list are allowed
    if (!limitData.equip.includes(equipId)) return false;
  }

  return true;
}

/**
 * Filter equipment list to only items equippable in a ship's normal slots.
 * Returns null if no filter data is available (show all equipment).
 */
export function filterForNormalSlot(
  shipId: number | null,
  items: MstSlotItemData[],
): MstSlotItemData[] | null {
  if (shipId == null) return null;

  const hasStypeData = Object.keys(state.mstStypes).length > 0;
  const hasEquipShipData = Object.keys(state.mstEquipShip).length > 0;
  if (!hasStypeData && !hasEquipShipData) return null;

  const rule = getNormalSlotRule(shipId);
  if (!rule) return null;

  return items.filter((e) => {
    const equipType = e.type?.[2];
    if (equipType == null || !rule.allowedTypes.has(equipType)) return false;

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
  shipLevel: number | null,
  items: MstSlotItemData[],
): MstSlotItemData[] | null {
  if (shipId == null) return null;
  if (state.equipExslotSet.size === 0) return null;

  return items.filter((e) => canEquipInExslot(shipId, shipLevel, e.id));
}

/**
 * Returns true if equip filter data is loaded and available.
 */
export function hasEquipFilterData(): boolean {
  return (
    Object.keys(state.mstStypes).length > 0 || state.equipExslotSet.size > 0
  );
}
