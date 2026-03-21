// ── Air Base Rendering / Fleet Section UI ──

import {
  setAirbaseSectionVisible,
  setFleetSectionVisible,
  setVisibleAirbaseCount,
} from "./simulator-mutations";
import {
  getVisibleAirbaseCount,
  isAirbaseSectionVisible,
  isFleetSectionVisible,
} from "./simulator-selectors";
import { rerenderSolidSimulator } from "../../../components/solid/simulator-renderer";
import { debounce } from "./equip-calc";

const DISPLAY_SETTINGS_KEY = "__fusouDisplaySettingsV1";
let displaySettingsLoaded = false;
let settingsEventsBound = false;


type DisplaySettings = {
  fleets: Record<number, boolean>;
  showAirbase: boolean;
  airbaseCount: number;
  fleetSlotLayout: "2x3" | "3x2";
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
    return;
  }
  setFleetSectionVisible(1, settings.fleets[1]);
  setFleetSectionVisible(2, settings.fleets[2]);
  setFleetSectionVisible(3, settings.fleets[3]);
  setFleetSectionVisible(4, settings.fleets[4]);
  setAirbaseSectionVisible(settings.showAirbase);
  setVisibleAirbaseCount(settings.airbaseCount);
  fleetSlotLayoutMode = settings.fleetSlotLayout;
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
}

function applyDisplaySettingsUi(): void {
  const effectiveSlotLayout = getEffectiveFleetSlotLayout();
  const isMobileSingleColumn = window.innerWidth < MOBILE_SINGLE_COLUMN_BREAKPOINT_PX;
  const fleetSectionMaxWidth =
    isMobileSingleColumn
      ? MOBILE_FLEET_SECTION_MAX_WIDTH
      : effectiveSlotLayout === "3x2"
        ? FLEET_SECTION_MAX_WIDTH_3X2
        : FLEET_SECTION_MAX_WIDTH_2X3;

  const visibleFleetIndexes: number[] = [];

  for (const i of FLEET_SECTION_IDS) {
    const section = document.getElementById(`fleet-${i}-section`) as HTMLElement | null;
    if (!section) continue;

    const visible = isFleetSectionVisible(i);
    if (visible) visibleFleetIndexes.push(i);

    // Keep hidden fleets fully out of layout flow.
    section.hidden = !visible;
    section.style.display = visible ? "block" : "none";
    section.style.maxWidth = fleetSectionMaxWidth;
    section.style.width = "100%";
    section.style.justifySelf = "center";
  }

  for (const i of FLEET_SECTION_IDS) {
    const slots = document.getElementById(`fleet-${i}-slots`) as HTMLElement | null;
    if (!slots) continue;
    if (isMobileSingleColumn) {
      slots.style.gridTemplateColumns = "minmax(0, 1fr)";
      // Keep cards full-width in single-column mode to avoid collapsed tiles.
      slots.style.justifyItems = "stretch";
      slots.style.justifyContent = "";
      continue;
    }
    slots.style.justifyItems = "stretch";
    slots.style.justifyContent = "";
    slots.style.gridTemplateColumns =
      effectiveSlotLayout === "3x2"
        ? "repeat(3, minmax(0, 1fr))"
        : "repeat(2, minmax(0, 1fr))";
  }

  const fleetSections = document.getElementById("fleet-sections") as HTMLElement | null;
  if (fleetSections) {
    const twoCol =
      effectiveSlotLayout === "2x3" &&
      visibleFleetIndexes.length >= 2 && window.innerWidth >= TWO_COLUMN_BREAKPOINT_PX;
    fleetSections.style.display = "grid";
    fleetSections.style.justifyContent = "center";
    fleetSections.style.gridTemplateColumns = twoCol
      ? `repeat(2, minmax(0, ${fleetSectionMaxWidth}))`
      : `minmax(0, ${fleetSectionMaxWidth})`;
  }

  const airbaseSection = document.getElementById("airbase-section") as HTMLElement | null;
  const showAirbase = isAirbaseSectionVisible();
  if (airbaseSection) {
    airbaseSection.style.display = showAirbase ? "block" : "none";
    airbaseSection.style.maxWidth = fleetSectionMaxWidth;
    airbaseSection.style.width = "100%";
    airbaseSection.style.marginLeft = "auto";
    airbaseSection.style.marginRight = "auto";
  }

  const visibleBaseCount = getVisibleAirbaseCount();
  const airBasesGrid = document.getElementById("air-bases") as HTMLElement | null;
  if (airBasesGrid) {
    const maxColsByWidth =
      window.innerWidth >= AIRBASE_THREE_COLUMN_BREAKPOINT_PX
        ? 3
        : window.innerWidth >= AIRBASE_TWO_COLUMN_BREAKPOINT_PX
          ? 2
          : 1;
    const airbaseCols = Math.max(1, Math.min(visibleBaseCount, maxColsByWidth));
    airBasesGrid.style.gridTemplateColumns = `repeat(${airbaseCols}, minmax(0, 1fr))`;
  }

  const baseCards = document.querySelectorAll<HTMLElement>("#air-bases > *");
  baseCards.forEach((card, index) => {
    card.style.display = showAirbase && index < visibleBaseCount ? "block" : "none";
  });
}

const applyDisplaySettingsUiOnResize = debounce(() => {
  applyDisplaySettingsUi();
}, 80);

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

  document.getElementById("btn-display-settings-apply")?.addEventListener("click", () => {
    const modalEl = document.getElementById("display-settings-modal") as HTMLDialogElement | null;
    modalEl?.close();
  });

  window.addEventListener("resize", applyDisplaySettingsUiOnResize);
}

export function initDisplaySettingsEvents(): void {
  loadDisplaySettingsOnce();
  bindDisplaySettingsEvents();
  syncDisplaySettingsControls();
  applyDisplaySettingsUi();
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
}
