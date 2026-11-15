import { describe, expect, it } from "vitest";
import {
  type EquipRangeFilterMap,
  matchesEquipRangeFilters,
} from "./equipment_filter";

const STAT_KEYS = [
  "Level",
  "Firepower",
  "Torpedo",
  "Anti-Air",
  "Armor",
  "Evasion",
  "Anti-Submarine",
  "Reconnaissance",
  "Proficiency",
  "Bomb",
  "Anti-Bomber",
  "Interception",
  "Distance",
] as const;

function createDefaultRangeProps(): EquipRangeFilterMap {
  const props: EquipRangeFilterMap = {};
  for (const key of STAT_KEYS) {
    props[key] = {
      min: 0,
      max: 0,
      eq: 0,
      range: true,
      reset: true,
    };
  }
  return props;
}

describe("matchesEquipRangeFilters", () => {
  it("filters Anti-Bomber by taibaku and Interception by geigeki rather than houm/houk", () => {
    // Land-based interceptor (type[2] = 48): anti-bomber (taibaku) = 4, interception (geigeki) = 2,
    // while houm (evasion) = 0 and houk (hit) = 1.
    const interceptorSlotItem = { level: 0, alv: 7 };
    const interceptorMaster = {
      houg: 0,
      raig: 0,
      tyku: 12,
      souk: 0,
      houm: 0,
      houk: 1,
      tais: 0,
      saku: 0,
      baku: 0,
      taibaku: 4,
      geigeki: 2,
      distance: 4,
    };

    const antiBomberFilter = createDefaultRangeProps();
    antiBomberFilter["Anti-Bomber"] = {
      min: 3,
      max: 5,
      eq: 0,
      range: true,
      reset: false,
    };
    expect(
      matchesEquipRangeFilters(
        interceptorSlotItem,
        interceptorMaster,
        antiBomberFilter,
      ),
    ).toBe(true);

    const interceptionFilter = createDefaultRangeProps();
    interceptionFilter["Interception"] = {
      min: 2,
      max: 2,
      eq: 0,
      range: true,
      reset: false,
    };
    expect(
      matchesEquipRangeFilters(
        interceptorSlotItem,
        interceptorMaster,
        interceptionFilter,
      ),
    ).toBe(true);

    // A regular gear piece with high houm/houk (e.g., radar: houm = 5, houk = 4)
    // but zero taibaku/geigeki must NOT match Anti-Bomber or Interception filters.
    const radarMaster = {
      ...interceptorMaster,
      houm: 5,
      houk: 4,
      taibaku: 0,
      geigeki: 0,
    };
    expect(
      matchesEquipRangeFilters(interceptorSlotItem, radarMaster, antiBomberFilter),
    ).toBe(false);
    expect(
      matchesEquipRangeFilters(
        interceptorSlotItem,
        radarMaster,
        interceptionFilter,
      ),
    ).toBe(false);

    // Evasion filter consistently continues to check houm.
    const evasionFilter = createDefaultRangeProps();
    evasionFilter["Evasion"] = {
      min: 0,
      max: 0,
      eq: 5,
      range: false,
      reset: false,
    };
    expect(
      matchesEquipRangeFilters(interceptorSlotItem, radarMaster, evasionFilter),
    ).toBe(true);
    expect(
      matchesEquipRangeFilters(
        interceptorSlotItem,
        interceptorMaster,
        evasionFilter,
      ),
    ).toBe(false);
  });
});
