// ── Air Base Rendering ──

import { state } from "./state";
import { AIRCRAFT_TYPES } from "./constants";
import { createWeaponIconEl } from "./equip-calc";
import { openEquipModal } from "./equip-modal";
import { renderFleetSlots } from "./fleet-renderer";

const isReadOnly = () => state.isWorkspaceReadOnly;

function hasAnyShipInFleet(fleet: typeof state.fleet1): boolean {
  return fleet.some((slot) => slot.shipId != null);
}

function syncFleetSectionUi() {
  const fleetPairs: Array<[number, typeof state.fleet1]> = [
    [1, state.fleet1],
    [2, state.fleet2],
    [3, state.fleet3],
    [4, state.fleet4],
  ];

  for (const [index, fleet] of fleetPairs) {
    const body = document.getElementById(`fleet-${index}-body`) as HTMLElement | null;
    const toggle = document.getElementById(`fleet-${index}-toggle`) as HTMLButtonElement | null;
    if (!body || !toggle) continue;

    // Auto-expand when the fleet gets a ship for easier editing.
    if (hasAnyShipInFleet(fleet)) {
      state.fleetSectionCollapsed[index] = false;
    }

    const collapsed = !!state.fleetSectionCollapsed[index];
    body.style.display = collapsed ? "none" : "block";
    toggle.textContent = collapsed ? "展開" : "折りたたむ";
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
}

let fleetToggleBound = false;
function ensureFleetSectionToggleHandlers() {
  if (fleetToggleBound) return;
  [1, 2, 3, 4].forEach((index) => {
    const toggle = document.getElementById(`fleet-${index}-toggle`) as HTMLButtonElement | null;
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      state.fleetSectionCollapsed[index] = !state.fleetSectionCollapsed[index];
      syncFleetSectionUi();
    });
  });
  fleetToggleBound = true;
}

export function renderAirBases() {
  const container = document.getElementById("air-bases")!;
  container.innerHTML = "";

  state.airBases.forEach((base, bIdx) => {
    const card = document.createElement("div");
    card.className = "border border-base-200 rounded-lg overflow-hidden";

    const title = document.createElement("div");
    title.className = "px-3 py-1.5 bg-base-200/30 text-xs font-bold text-base-content/40 border-b border-base-200/50";
    title.textContent = `第${bIdx + 1}基地`;
    card.appendChild(title);

    const slotsDiv = document.createElement("div");
    slotsDiv.className = "divide-y divide-base-200/50";

    for (let i = 0; i < 4; i++) {
      const equip = base.equipIds[i] != null ? state.mstSlotItems[base.equipIds[i]!] : null;
      const row = document.createElement("div");
      row.className = "flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer hover:bg-base-200/40 transition-colors";

      const idxLabel = document.createElement("span");
      idxLabel.className = "w-3.5 text-center text-base-content/25 font-mono shrink-0";
      idxLabel.textContent = String(i + 1);
      row.appendChild(idxLabel);

      if (equip) {
        const iconNum = equip.type?.[3] ?? 0;
        row.appendChild(createWeaponIconEl(iconNum, 16));
      } else {
        const blank = document.createElement("div");
        blank.style.cssText = "width:16px;height:16px";
        blank.className = "shrink-0";
        row.appendChild(blank);
      }

      const eqName = document.createElement("span");
      eqName.className = `truncate flex-1 ${equip ? "text-base-content/70" : "text-base-content/20 italic"}`;
      eqName.textContent = equip?.name ?? "—";
      row.appendChild(eqName);

      if (equip) {
        const eqType2 = equip.type?.[2] ?? 0;
        const isAircraft = AIRCRAFT_TYPES.has(eqType2);

        if (isAircraft) {
          const profLevel = base.equipProficiency[i] ?? 0;
          const profBadge = document.createElement("span");
          profBadge.className = "shrink-0 cursor-pointer select-none text-[11px] leading-none font-bold mr-0.5";
          profBadge.style.textShadow = "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)";
          profBadge.style.display = "inline-block";
          profBadge.style.width = "2em";
          profBadge.style.textAlign = "center";
          const profSymbols = ["|", "|", "||", "|||", "\\", "\\\\", "\\\\\\", ">>"];
          profBadge.textContent = profSymbols[profLevel] ?? ">>";
          if (profLevel === 0) {
            profBadge.style.color = "#1976d2";
            profBadge.style.opacity = "0";
            profBadge.style.transition = "opacity 0.15s";
            row.addEventListener("mouseenter", () => { profBadge.style.opacity = "0.4"; });
            row.addEventListener("mouseleave", () => { profBadge.style.opacity = "0"; });
          } else if (profLevel <= 3) {
            profBadge.style.color = "#1976d2";
          } else if (profLevel <= 6) {
            profBadge.style.color = "#f57c00";
          } else {
            profBadge.style.color = "#e65100";
          }
          profBadge.title = `熟練度${profLevel} (クリックで変更)`;
          profBadge.addEventListener("click", (e) => {
            e.stopPropagation();
            if (isReadOnly()) return;
            const cur = state.airBases[bIdx].equipProficiency[i] ?? 0;
            state.airBases[bIdx].equipProficiency[i] = cur >= 7 ? 0 : cur + 1;
            renderAirBases();
          });
          row.appendChild(profBadge);
        }

        const impLevel = base.equipImprovement[i] ?? 0;
        const impBadge = document.createElement("span");
        impBadge.className = "shrink-0 cursor-pointer select-none text-[11px] leading-none font-bold";
        impBadge.style.textShadow = "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)";
        impBadge.style.minWidth = "2em";
        impBadge.style.textAlign = "right";
        if (impLevel > 0) {
          impBadge.style.color = "#00897b";
          impBadge.textContent = `★${impLevel}`;
        } else {
          impBadge.textContent = "★";
          impBadge.style.color = "#00897b";
          impBadge.style.opacity = "0";
          impBadge.style.transition = "opacity 0.15s";
          row.addEventListener("mouseenter", () => { impBadge.style.opacity = "0.4"; });
          row.addEventListener("mouseleave", () => { impBadge.style.opacity = "0"; });
        }
        impBadge.title = `改修Lv${impLevel} (クリックで変更)`;
        impBadge.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isReadOnly()) return;
          const cur = state.airBases[bIdx].equipImprovement[i] ?? 0;
          state.airBases[bIdx].equipImprovement[i] = cur >= 10 ? 0 : cur + 1;
          renderAirBases();
        });
        row.appendChild(impBadge);
      }

      if (equip?.distance != null) {
        const dist = document.createElement("span");
        dist.className = "text-[10px] text-base-content/30 shrink-0";
        dist.textContent = `半径${equip.distance}`;
        row.appendChild(dist);
      }

      const slotIdx = i;
      row.addEventListener("click", () => {
        if (isReadOnly()) return;
        state.equipModalTargetShipId = null;
        state.equipModalTargetSlot = null;
        state.equipModalTargetSlotIdx = -1;
        openEquipModal(base.equipIds[slotIdx], (id) => {
          state.airBases[bIdx].equipIds[slotIdx] = id;
          renderAirBases();
        });
      });

      slotsDiv.appendChild(row);
    }
    card.appendChild(slotsDiv);
    container.appendChild(card);
  });
}

export function renderAll() {
  ensureFleetSectionToggleHandlers();
  renderFleetSlots("fleet-1-slots", state.fleet1);
  renderFleetSlots("fleet-2-slots", state.fleet2);
  renderFleetSlots("fleet-3-slots", state.fleet3);
  renderFleetSlots("fleet-4-slots", state.fleet4);
  syncFleetSectionUi();
  renderAirBases();
}
