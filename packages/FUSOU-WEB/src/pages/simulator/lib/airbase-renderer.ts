// ── Air Base Rendering / Fleet Section UI ──

import type { FleetSlot } from "./types";
import { setFleetSectionCollapsed, toggleFleetSectionCollapsed } from "./simulator-mutations";
import { getFleetState, isFleetSectionCollapsed } from "./simulator-selectors";
import { rerenderSolidSimulator } from "../../../components/solid/simulator-renderer";

function hasAnyShipInFleet(fleet: FleetSlot[]): boolean {
  return fleet.some((slot) => slot.shipId != null);
}

function syncFleetSectionUi(): void {
  const { fleet1, fleet2, fleet3, fleet4 } = getFleetState();
  const fleetPairs: Array<[number, FleetSlot[]]> = [
    [1, fleet1],
    [2, fleet2],
    [3, fleet3],
    [4, fleet4],
  ];

  for (const [index, fleet] of fleetPairs) {
    const body = document.getElementById(`fleet-${index}-body`) as HTMLElement | null;
    const toggle = document.getElementById(`fleet-${index}-toggle`) as HTMLButtonElement | null;
    if (!body || !toggle) continue;

    if (hasAnyShipInFleet(fleet)) {
      setFleetSectionCollapsed(index, false);
    }

    const collapsed = isFleetSectionCollapsed(index);
    body.style.display = collapsed ? "none" : "block";
    toggle.textContent = collapsed ? "展開" : "折りたたむ";
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
}

let fleetToggleBound = false;

function ensureFleetSectionToggleHandlers(): void {
  if (fleetToggleBound) return;

  [1, 2, 3, 4].forEach((index) => {
    const toggle = document.getElementById(`fleet-${index}-toggle`) as HTMLButtonElement | null;
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      toggleFleetSectionCollapsed(index);
      syncFleetSectionUi();
    });
  });

  fleetToggleBound = true;
}

export function renderAirBases(): void {
  rerenderSolidSimulator("airbase");
}

export function renderAll(): void {
  ensureFleetSectionToggleHandlers();
  syncFleetSectionUi();
  rerenderSolidSimulator("all");
}
