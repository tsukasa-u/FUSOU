// ── Air Base Rendering / Fleet Section UI ──

import {
  setAirbaseSectionVisible,
  setCombinedFleetType,
  setFleetSectionVisible,
  setVisibleAirbaseCount,
  setFleetSlotLayoutMode,
} from "./simulator-mutations";
import {
  getCombinedFleetType,
  getVisibleAirbaseCount,
  isAirbaseSectionVisible,
  isFleetSectionVisible,
  getFleetSlotLayoutMode,
} from "./simulator-selectors";
import { rerenderSolidSimulator } from "@/components/features/simulator/solid/simulator-renderer";
import { z } from "zod";
import { combinedFleetTypeOrDefault } from "./payload-codec";

const DISPLAY_SETTINGS_KEY = "__fusouDisplaySettingsV1";
let displaySettingsLoaded = false;

const DisplaySettingsSchema = z
  .object({
    fleets: z.record(z.boolean()).optional(),
    showAirbase: z.boolean().optional(),
    airbaseCount: z.number().finite().optional(),
    fleetSlotLayout: z.enum(["2x3", "3x2"]).optional(),
    combinedFleetType: z.number().finite().optional(),
    singleFleetGrid3x2: z.boolean().optional(),
  })
  .passthrough();

type DisplaySettings = {
  fleets: Record<number, boolean>;
  showAirbase: boolean;
  airbaseCount: number;
  fleetSlotLayout: "2x3" | "3x2";
  combinedFleetType: 0 | 1 | 2 | 3;
};

const SLOT_LAYOUT_3X2_MIN_WIDTH_PX = 1200;
export function getEffectiveFleetSlotLayout(): "2x3" | "3x2" {
  if (
    getFleetSlotLayoutMode() === "3x2" &&
    typeof window !== "undefined" &&
    window.innerWidth < SLOT_LAYOUT_3X2_MIN_WIDTH_PX
  ) {
    return "2x3";
  }
  return getFleetSlotLayoutMode();
}

function readDisplaySettings(): DisplaySettings | null {
  try {
    const raw = localStorage.getItem(DISPLAY_SETTINGS_KEY);
    if (!raw) return null;
    const result = DisplaySettingsSchema.safeParse(JSON.parse(raw));
    if (!result.success) return null;
    const parsed = result.data;
    const combinedFleetType = combinedFleetTypeOrDefault(parsed.combinedFleetType);
    return {
      fleets: {
        1: parsed.fleets?.[1] !== false,
        2: parsed.fleets?.[2] !== false,
        // Default to first two fleets only when value is not explicitly saved.
        3: parsed.fleets?.[3] === true,
        4: parsed.fleets?.[4] === true,
      },
      showAirbase: parsed.showAirbase !== false,
      airbaseCount: Math.max(0, Math.min(3, Math.trunc(parsed.airbaseCount ?? 3))),
      // Backward compatibility: old setting used singleFleetGrid3x2 boolean.
      fleetSlotLayout:
        parsed.fleetSlotLayout === "2x3" && parsed.singleFleetGrid3x2 !== true
          ? "2x3"
          : "3x2",
      combinedFleetType
    };
  } catch {
    return null;
  }
}

export function writeDisplaySettings(): void {
  const current: DisplaySettings = {
    fleets: {
      1: isFleetSectionVisible(1),
      2: isFleetSectionVisible(2),
      3: isFleetSectionVisible(3),
      4: isFleetSectionVisible(4),
    },
    showAirbase: isAirbaseSectionVisible(),
    airbaseCount: getVisibleAirbaseCount(),
    fleetSlotLayout: getFleetSlotLayoutMode(),
    combinedFleetType: getCombinedFleetType(),
  };
  try {
    localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // ignore persistence failures
  }
}

function loadDisplaySettingsOnce(): void {
  if (displaySettingsLoaded) return;
  displaySettingsLoaded = true;
  const settings = readDisplaySettings();
  if (!settings) {
    // Default view: vertical slot layout with first two fleets visible.
    setFleetSectionVisible(1, true);
    setFleetSectionVisible(2, true);
    setFleetSectionVisible(3, false);
    setFleetSectionVisible(4, false);
    setAirbaseSectionVisible(true);
    setVisibleAirbaseCount(3);
    setFleetSlotLayoutMode("3x2");
    setCombinedFleetType(0);
    return;
  }
  setFleetSectionVisible(1, settings.fleets[1] ?? false);
  setFleetSectionVisible(2, settings.fleets[2] ?? false);
  setFleetSectionVisible(3, settings.fleets[3] ?? false);
  setFleetSectionVisible(4, settings.fleets[4] ?? false);
  setAirbaseSectionVisible(settings.showAirbase);
  setVisibleAirbaseCount(settings.airbaseCount);
  setFleetSlotLayoutMode(settings.fleetSlotLayout);
  setCombinedFleetType(settings.combinedFleetType);
}


export function initDisplaySettingsEvents(): void {
  loadDisplaySettingsOnce();
}

export function renderAirBases(): void {
  loadDisplaySettingsOnce();
  rerenderSolidSimulator("airbase");
}

export function renderAll(): void {
  loadDisplaySettingsOnce();
  rerenderSolidSimulator("all");
}
