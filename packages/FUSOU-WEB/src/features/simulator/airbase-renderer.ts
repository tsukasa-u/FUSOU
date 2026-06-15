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
let fleetSlotLayoutMode: "2x3" | "3x2" = "2x3";

function getEffectiveFleetSlotLayout(): "2x3" | "3x2" {
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

function writeDisplaySettings(): void {
  try {
    const payload: DisplaySettings = {
      fleets: {
        1: isFleetSectionVisible(1),
        2: isFleetSectionVisible(2),
        3: isFleetSectionVisible(3),
        4: isFleetSectionVisible(4),
      },
      showAirbase: isAirbaseSectionVisible(),
      airbaseCount: getVisibleAirbaseCount(),
      fleetSlotLayout: fleetSlotLayoutMode,
      combinedFleetType: getCombinedFleetType()
    };
    localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(payload));
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

function syncDisplaySettingsControls(): void {
  const modal = document.getElementById("display-settings-modal");
  if (!(modal instanceof HTMLDialogElement)) return;

  for (const i of [1, 2, 3, 4] as const) {
    const el = document.getElementById(`display-fleet-${i}`) as HTMLInputElement | null;
    if (el) el.checked = isFleetSectionVisible(i);
  }

  const airbaseVisible = document.getElementById("display-airbase") as HTMLInputElement | null;
  if (airbaseVisible) airbaseVisible.checked = isAirbaseSectionVisible();

  const airbaseCount = document.getElementById("display-airbase-count") as HTMLSelectElement | null;
  if (airbaseCount) {
    airbaseCount.value = String(getVisibleAirbaseCount());
    airbaseCount.disabled = !isAirbaseSectionVisible();
  }

  const slotLayout = document.getElementById("display-fleet-slot-layout") as HTMLSelectElement | null;
  if (slotLayout) {
    slotLayout.value = fleetSlotLayoutMode;
  }

  const combinedFleet = document.getElementById("display-combined-fleet") as HTMLSelectElement | null;
  if (combinedFleet) {
    combinedFleet.value = String(getCombinedFleetType());
  }
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

function bindDisplaySettingsEvents(): void {
  if (settingsEventsBound) return;
  settingsEventsBound = true;

  const openBtn = document.getElementById("btn-display-settings");
  const modal = document.getElementById("display-settings-modal") as HTMLDialogElement | null;
  if (openBtn instanceof HTMLButtonElement && modal) {
    openBtn.addEventListener("click", () => {
      syncDisplaySettingsControls();
      modal.showModal();
    });
  }

  for (const i of [1, 2, 3, 4] as const) {
    const el = document.getElementById(`display-fleet-${i}`) as HTMLInputElement | null;
    if (!el) continue;
    el.addEventListener("change", () => {
      setFleetSectionVisible(i, el.checked);
      applyDisplaySettingsUi();
      writeDisplaySettings();
    });
  }

  const airbaseVisible = document.getElementById("display-airbase") as HTMLInputElement | null;
  if (airbaseVisible) {
    airbaseVisible.addEventListener("change", () => {
      setAirbaseSectionVisible(airbaseVisible.checked);
      const airbaseCount = document.getElementById("display-airbase-count") as HTMLSelectElement | null;
      if (airbaseCount) airbaseCount.disabled = !airbaseVisible.checked;
      applyDisplaySettingsUi();
      writeDisplaySettings();
    });
  }

  const airbaseCount = document.getElementById("display-airbase-count") as HTMLSelectElement | null;
  if (airbaseCount) {
    airbaseCount.addEventListener("change", () => {
      setVisibleAirbaseCount(Number.parseInt(airbaseCount.value, 10));
      applyDisplaySettingsUi();
      writeDisplaySettings();
    });
  }

  const slotLayout = document.getElementById("display-fleet-slot-layout") as HTMLSelectElement | null;
  if (slotLayout) {
    slotLayout.addEventListener("change", () => {
      fleetSlotLayoutMode = slotLayout.value === "3x2" ? "3x2" : "2x3";
      applyDisplaySettingsUi();
      writeDisplaySettings();
    });
  }

  // Combined fleet type selector
  const combinedFleet = document.getElementById("display-combined-fleet") as HTMLSelectElement | null;
  if (combinedFleet) {
    combinedFleet.addEventListener("change", () => {
      const newType = Math.max(0, Math.min(3, Number.parseInt(combinedFleet.value, 10) || 0)) as 0 | 1 | 2 | 3;
      const isCombined = newType > 0;
      setCombinedFleetType(newType);

      // Auto-show fleet 2 when entering combined mode
      if (isCombined && !isFleetSectionVisible(2)) {
        setFleetSectionVisible(2, true);
        const cb = document.getElementById("display-fleet-2") as HTMLInputElement | null;
        if (cb) cb.checked = true;
      }

      syncCombinedFleetUI();
      applyDisplaySettingsUi();
      writeDisplaySettings();
    });
  }

  document.getElementById("btn-display-settings-apply")?.addEventListener("click", () => {
    const modalEl = document.getElementById("display-settings-modal") as HTMLDialogElement | null;
    modalEl?.close();
  });

  window.addEventListener("resize", applyDisplaySettingsUiOnResize);
}

let combinedFleetUiSubscribed = false;

export function initDisplaySettingsEvents(): void {
  loadDisplaySettingsOnce();
  bindDisplaySettingsEvents();
  syncDisplaySettingsControls();
  applyDisplaySettingsUi();
  syncCombinedFleetUI();
  if (!combinedFleetUiSubscribed) {
    combinedFleetUiSubscribed = true;
    onSimulatorStateDirty("fleet", () => {
      syncCombinedFleetUI();
    });
  }
}

export function renderAirBases(): void {
  loadDisplaySettingsOnce();
  rerenderSolidSimulator("airbase");
  applyDisplaySettingsUi();
}

export function renderAll(): void {
  loadDisplaySettingsOnce();
  rerenderSolidSimulator("all");
  applyDisplaySettingsUi();
  syncCombinedFleetUI();
}
