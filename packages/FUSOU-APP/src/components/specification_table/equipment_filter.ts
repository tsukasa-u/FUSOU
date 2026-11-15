import type { MstSlotItem } from "@ipc-bindings/get_data";
import type { SlotItem } from "@ipc-bindings/require_info";

export type EquipRangeFilterRule = {
  min: number;
  max: number;
  eq: number;
  range: boolean;
  reset: boolean;
};

export type EquipRangeFilterMap = Record<string, EquipRangeFilterRule>;

/** Returns true if `value` satisfies the configured range or equality filter for `param`. */
export function checkEquipRangeValue(
  rangeProps: EquipRangeFilterMap,
  param: string,
  value: number,
): boolean {
  const rule = rangeProps[param];
  if (!rule || rule.reset) return true;
  if (rule.range) {
    if (Number.isInteger(rule.min) && rule.min != 0 && value < rule.min) {
      return false;
    }
    if (Number.isInteger(rule.max) && rule.max != 0 && value > rule.max) {
      return false;
    }
    return true;
  }
  if (!Number.isInteger(rule.eq)) return false;
  return value == rule.eq;
}

/** Extracts `[property, value]` pairs for every stat filter supported by EquipmentListComponent. */
export function getEquipFilterStatValues(
  slotItem: Pick<SlotItem, "level" | "alv">,
  mstSlotItem: Pick<
    MstSlotItem,
    | "houg"
    | "raig"
    | "tyku"
    | "souk"
    | "houm"
    | "tais"
    | "saku"
    | "baku"
    | "taibaku"
    | "geigeki"
    | "distance"
  >,
): Array<[string, number]> {
  return [
    ["Level", slotItem.level],
    ["Firepower", mstSlotItem.houg],
    ["Torpedo", mstSlotItem.raig],
    ["Anti-Air", mstSlotItem.tyku],
    ["Armor", mstSlotItem.souk],
    ["Evasion", mstSlotItem.houm],
    ["Anti-Submarine", mstSlotItem.tais],
    ["Reconnaissance", mstSlotItem.saku],
    ["Proficiency", slotItem.alv ?? 0],
    ["Bomb", mstSlotItem.baku],
    // KanColle master data stores LBAS interceptor anti-bomber/interception in taibaku/geigeki,
    // not houm/houk (those represent evasion/hit on aircraft vs general gear).
    ["Anti-Bomber", mstSlotItem.taibaku],
    ["Interception", mstSlotItem.geigeki],
    ["Distance", mstSlotItem.distance ?? 0],
  ];
}

/** Returns true if an equipment item satisfies all active stat range/equality filters. */
export function matchesEquipRangeFilters(
  slotItem: Pick<SlotItem, "level" | "alv">,
  mstSlotItem: Pick<
    MstSlotItem,
    | "houg"
    | "raig"
    | "tyku"
    | "souk"
    | "houm"
    | "tais"
    | "saku"
    | "baku"
    | "taibaku"
    | "geigeki"
    | "distance"
  >,
  rangeProps: EquipRangeFilterMap,
): boolean {
  return getEquipFilterStatValues(slotItem, mstSlotItem).every(([param, value]) =>
    checkEquipRangeValue(rangeProps, param, value),
  );
}
