// ── Air Base Rendering / Fleet Section UI ──

import {
  setAirbaseSectionVisible,
  setCombinedFleetType,
  setFleetSectionVisible,
  setVisibleAirbaseCount,
} from "./simulator-mutations";
import {
  getCombinedFleetType,
  getFleetState,
  getVisibleAirbaseCount,
  isAirbaseSectionVisible,
  isFleetSectionVisible,
} from "./simulator-selectors";
import { validateCombinedFleet } from "./combined-fleet";
import { rerenderSolidSimulator } from "@/components/features/simulator/solid/simulator-renderer";
import { debounce } from "./equip-calc";
import { onSimulatorStateDirty } from "./state";

const DISPLAY_SETTINGS_KEY = "__fusouDisplaySettingsV1";
let displaySettingsLoaded = false;
let settingsEventsBound = false;


type DisplaySettings = {
  fleets: Record<number, boolean>;
  showAirbase: boolean;
  airbaseCount: number;
  fleetSlotLayout: "2x3" | "3x2";
  combinedFleetType: 0 | 1 | 2 | 3;
};

const FLEET_SECTION_IDS = [1, 2, 3, 4] as const;
const FLEET_SECTION_MAX_WIDTH_2X3 = "52rem";
const FLEET_SECTION_MAX_WIDTH_3X2 = "76rem";
const SLOT_LAYOUT_3X2_MIN_WIDTH_PX = 1200;
const MOBILE_FLEET_SECTION_MAX_WIDTH = "26rem";
const AIRBASE_THREE_COLUMN_BREAKPOINT_PX = 1200;
const AIRBASE_TWO_COLUMN_BREAKPOINT_PX = 768;
const MOBILE_SINGLE_COLUMN_BREAKPOINT_PX = AIRBASE_TWO_COLUMN_BREAKPOINT_PX;
const TWO_COLUMN_BREAKPOINT_PX = AIRBASE_TWO_COLUMN_BREAKPOINT_PX;
export let fleetSlotLayoutMode: "2x3" | "3x2" = "2x3";

export function setFleetSlotLayoutMode(mode: "2x3" | "3x2"): void {
  fleetSlotLayoutMode = mode;
}

export function getEffectiveFleetSlotLayout(): "2x3" | "3x2" {
  if (
    fleetSlotLayoutMode === "3x2" &&
    typeof window !== "undefined" &&
    window.innerWidth < SLOT_LAYOUT_3X2_MIN_WIDTH_PX
  ) {
    return "2x3";
  }
  return fleetSlotLayoutMode;
}

function readDisplaySettings(): DisplaySettings | null {
  try {
    const raw = localStorage.getItem(DISPLAY_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DisplaySettings> & {
      singleFleetGrid3x2?: boolean;
    };
    const rawCombined = parsed.combinedFleetType;
    const combinedFleetType: 0 | 1 | 2 | 3 =
      typeof rawCombined === "number" && [0, 1, 2, 3].includes(rawCombined)
        ? (rawCombined as 0 | 1 | 2 | 3)
        : 0;
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
        parsed.fleetSlotLayout === "3x2" || parsed.singleFleetGrid3x2 === true
          ? "3x2"
          : "2x3",
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
    fleetSlotLayout: fleetSlotLayoutMode,
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
    fleetSlotLayoutMode = "2x3";
    setCombinedFleetType(0);
    return;
  }
  setFleetSectionVisible(1, settings.fleets[1]);
  setFleetSectionVisible(2, settings.fleets[2]);
  setFleetSectionVisible(3, settings.fleets[3]);
  setFleetSectionVisible(4, settings.fleets[4]);
  setAirbaseSectionVisible(settings.showAirbase);
  setVisibleAirbaseCount(settings.airbaseCount);
  fleetSlotLayoutMode = settings.fleetSlotLayout;
  setCombinedFleetType(settings.combinedFleetType);
}

function applyDisplaySettingsUi(): void {
  // Now handled reactively in SimulatorFleetTab.tsx
}

const applyDisplaySettingsUiOnResize = debounce(() => {
  applyDisplaySettingsUi();
}, 80);

function syncCombinedFleetUI(): void {
  // Now handled reactively in SimulatorFleetTab.tsx
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
