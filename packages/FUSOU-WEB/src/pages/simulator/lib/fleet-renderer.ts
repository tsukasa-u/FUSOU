// ── Fleet Rendering ──

import { state } from "./state";
import type { FleetSlot, StatOverrides } from "./types";
import { STYPE_SHORT, SPEED_NAMES, AIRCRAFT_TYPES, RANGE_NAMES } from "./constants";
import { bannerUrl, cardUrl, createWeaponIconEl, computeEquipBonuses, computeEquipSum } from "./equip-calc";
import { openShipModal } from "./ship-modal";
import { openEquipModal } from "./equip-modal";
import { prefetchExternalUrlForExport } from "./image-capture";

export function renderFleetSlots(containerId: string, fleet: FleetSlot[]) {
  const container = document.getElementById(containerId)!;
  container.innerHTML = "";

  fleet.forEach((slot, idx) => {
    const ship = slot.shipId != null ? state.mstShips[slot.shipId] : null;
    const slotCount = ship?.slot_num ?? 4;

    const card = document.createElement("div");

    if (!ship) {
      // ---- Empty slot ----
      card.className =
        "group border-2 border-dashed border-base-300/50 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all min-h-[88px]";
      const num = document.createElement("span");
      num.className = "text-[10px] font-bold text-base-content/20";
      num.textContent = String(idx + 1);
      card.appendChild(num);
      const plus = document.createElement("div");
      plus.className = "text-2xl leading-none text-base-content/15 group-hover:text-primary/50 transition-colors";
      plus.textContent = "+";
      card.appendChild(plus);
      const hint = document.createElement("span");
      hint.className = "text-[10px] text-base-content/20 group-hover:text-primary/40 transition-colors";
      hint.textContent = "艦娘を配置";
      card.appendChild(hint);

      card.addEventListener("click", () => {
        openShipModal(null, (id) => {
          fleet[idx].shipId = id;
          fleet[idx].equipIds = [null, null, null, null, null];
          fleet[idx].equipImprovement = [0, 0, 0, 0, 0];
          fleet[idx].equipProficiency = [0, 0, 0, 0, 0];
          fleet[idx].exSlotId = null;
          fleet[idx].exSlotImprovement = 0;
          delete fleet[idx].instanceStats;
          renderFleetSlots(containerId, fleet);
        });
      });
    } else {
      // ---- Filled slot (game-style card) ----
      card.className = "rounded-lg overflow-hidden border border-base-300/60 bg-base-100 group/card relative";

      const cardImg = document.createElement("img");
      cardImg.src = cardUrl(slot.shipId!);
      cardImg.alt = ship.name;
        // Warm the data-URL export cache in the background so the first save
        // does not require a round-trip to R2 via the image-proxy endpoint.
        prefetchExternalUrlForExport(cardImg.src);
      cardImg.className = "absolute inset-0 w-full h-full object-contain object-right pointer-events-none select-none";
      cardImg.loading = "lazy";
      cardImg.onerror = function () {
        (this as HTMLImageElement).style.display = "none";
      };
      card.appendChild(cardImg);

      const leftCol = document.createElement("div");
      leftCol.className = "relative z-10 flex flex-col w-2/3";
      leftCol.style.background = "linear-gradient(to right, var(--color-base-100) 75%, transparent 100%)";

      // Header row
      const header = document.createElement("div");
      header.className = "flex items-center gap-1.5 px-2 py-1 border-b border-base-200/60 cursor-pointer";

      const numBadge = document.createElement("span");
      numBadge.className = "text-[10px] font-bold bg-primary/15 text-primary rounded w-4 h-4 flex items-center justify-center shrink-0";
      numBadge.textContent = String(idx + 1);
      header.appendChild(numBadge);

      const nameLabel = document.createElement("span");
      nameLabel.className = "text-xs font-bold truncate flex-1 leading-tight";
      nameLabel.textContent = ship.name;
      header.appendChild(nameLabel);

      const lvLabel = document.createElement("span");
      lvLabel.className = "text-[9px] px-1 py-0.5 rounded text-base-content/50 font-bold shrink-0";
      const lv = fleet[idx].shipLevel;
      lvLabel.textContent = lv != null ? `Lv.${lv}` : "Lv.—";
      header.appendChild(lvLabel);

      const stypeBadge = document.createElement("span");
      stypeBadge.className = "text-[9px] px-1 py-0.5 rounded bg-base-200/60 text-base-content/50 font-bold shrink-0";
      stypeBadge.textContent = STYPE_SHORT[ship.stype] ?? "";
      header.appendChild(stypeBadge);

      const clearBtn = document.createElement("button");
      clearBtn.className =
        "w-4 h-4 flex items-center justify-center rounded text-base-content/20 hover:text-error hover:bg-error/10 opacity-0 group-hover/card:opacity-100 transition-all shrink-0 text-[10px]";
      clearBtn.textContent = "✕";
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        fleet[idx].shipId = null;
        fleet[idx].equipIds = [null, null, null, null, null];
        fleet[idx].equipImprovement = [0, 0, 0, 0, 0];
        fleet[idx].equipProficiency = [0, 0, 0, 0, 0];
        fleet[idx].exSlotId = null;
        fleet[idx].exSlotImprovement = 0;
        delete fleet[idx].instanceStats;
        renderFleetSlots(containerId, fleet);
      });
      header.appendChild(clearBtn);

      header.addEventListener("click", () => {
        openShipModal(slot.shipId, (id) => {
          if (id !== slot.shipId) {
            fleet[idx].shipId = id;
            fleet[idx].equipIds = [null, null, null, null, null];
            fleet[idx].equipImprovement = [0, 0, 0, 0, 0];
            fleet[idx].equipProficiency = [0, 0, 0, 0, 0];
            fleet[idx].exSlotId = null;
            fleet[idx].exSlotImprovement = 0;
            delete fleet[idx].instanceStats;
          }
          renderFleetSlots(containerId, fleet);
        });
      });
      leftCol.appendChild(header);

      // Equipment list
      const equipList = document.createElement("div");
      equipList.className = "divide-y divide-base-200/40";

      for (let i = 0; i < 5; i++) {
        const isActive = i < slotCount;
        const equip = isActive && slot.equipIds[i] != null ? state.mstSlotItems[slot.equipIds[i]!] : null;
        const eqRow = document.createElement("div");
        eqRow.className =
          "flex items-center gap-1 px-1.5 py-[2px] text-[11px] cursor-pointer hover:bg-base-200/30 transition-colors";

        const slotSize = document.createElement("span");
        slotSize.className = "w-3 text-center text-[9px] text-base-content/25 font-mono shrink-0";
        slotSize.textContent = isActive && ship.maxeq?.[i] != null ? String(ship.maxeq[i]) : "";
        eqRow.appendChild(slotSize);

        if (equip) {
          const iconNum = equip.type?.[3] ?? 0;
          eqRow.appendChild(createWeaponIconEl(iconNum, 16));
        } else {
          const blank = document.createElement("div");
          blank.style.cssText = "width:16px;height:16px";
          blank.className = "shrink-0";
          eqRow.appendChild(blank);
        }

        const eqName = document.createElement("span");
        eqName.className = `truncate flex-1 leading-tight ${equip ? "text-base-content/80" : "text-base-content/15"}`;
        eqName.textContent = isActive ? (equip?.name ?? "—") : "";
        eqRow.appendChild(eqName);

        // Aircraft proficiency + Improvement badges
        if (equip) {
          const eqType2 = equip.type?.[2] ?? 0;
          const isAircraft = AIRCRAFT_TYPES.has(eqType2);

          if (isAircraft) {
            const profLevel = slot.equipProficiency[i] ?? 0;
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
              eqRow.addEventListener("mouseenter", () => { profBadge.style.opacity = "0.4"; });
              eqRow.addEventListener("mouseleave", () => { profBadge.style.opacity = "0"; });
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
              const cur = fleet[idx].equipProficiency[i] ?? 0;
              fleet[idx].equipProficiency[i] = cur >= 7 ? 0 : cur + 1;
              renderFleetSlots(containerId, fleet);
            });
            eqRow.appendChild(profBadge);
          }

          const impLevel = slot.equipImprovement[i] ?? 0;
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
            eqRow.addEventListener("mouseenter", () => { impBadge.style.opacity = "0.4"; });
            eqRow.addEventListener("mouseleave", () => { impBadge.style.opacity = "0"; });
          }
          impBadge.title = `改修Lv${impLevel} (クリックで変更)`;
          impBadge.addEventListener("click", (e) => {
            e.stopPropagation();
            const cur = fleet[idx].equipImprovement[i] ?? 0;
            fleet[idx].equipImprovement[i] = cur >= 10 ? 0 : cur + 1;
            renderFleetSlots(containerId, fleet);
          });
          eqRow.appendChild(impBadge);
        }

        if (isActive) {
          const eqIdx = i;
          eqRow.addEventListener("click", () => {
            state.equipModalTargetShipId = slot.shipId;
            state.equipModalTargetSlot = slot;
            state.equipModalTargetSlotIdx = eqIdx;
            openEquipModal(slot.equipIds[eqIdx], (id) => {
              fleet[idx].equipIds[eqIdx] = id;
              renderFleetSlots(containerId, fleet);
            });
          });
        } else {
          eqRow.className = "flex items-center gap-1 px-1.5 py-[2px] text-[11px]";
        }
        equipList.appendChild(eqRow);
      }
      leftCol.appendChild(equipList);

      // Reinforcement expansion slot
      const exRow = document.createElement("div");
      exRow.className =
        "flex items-center gap-1 px-1.5 py-[2px] text-[11px] cursor-pointer hover:bg-base-200/30 transition-colors border-t border-dashed border-base-200/50";
      const exLabel = document.createElement("span");
      exLabel.className = "text-[9px] text-warning/60 font-bold shrink-0 w-3 text-center";
      exLabel.textContent = "補";
      exRow.appendChild(exLabel);
      const exEquip = slot.exSlotId != null ? state.mstSlotItems[slot.exSlotId] : null;
      if (exEquip) {
        const exIconNum = exEquip.type?.[3] ?? 0;
        exRow.appendChild(createWeaponIconEl(exIconNum, 16));
      } else {
        const exBlank = document.createElement("div");
        exBlank.style.cssText = "width:16px;height:16px";
        exBlank.className = "shrink-0";
        exRow.appendChild(exBlank);
      }
      const exName = document.createElement("span");
      exName.className = `truncate flex-1 leading-tight ${exEquip ? "text-base-content/80" : "text-base-content/15"}`;
      exName.textContent = exEquip?.name ?? "補強増設";
      exRow.appendChild(exName);

      if (exEquip) {
        const exImpLevel = slot.exSlotImprovement ?? 0;
        const exImpBadge = document.createElement("span");
        exImpBadge.className = "shrink-0 cursor-pointer select-none text-[11px] leading-none font-bold";
        exImpBadge.style.textShadow = "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)";
        exImpBadge.style.minWidth = "2em";
        exImpBadge.style.textAlign = "right";
        if (exImpLevel > 0) {
          exImpBadge.style.color = "#00897b";
          exImpBadge.textContent = `★${exImpLevel}`;
        } else {
          exImpBadge.textContent = "★";
          exImpBadge.style.color = "#00897b";
          exImpBadge.style.opacity = "0";
          exImpBadge.style.transition = "opacity 0.15s";
          exRow.addEventListener("mouseenter", () => { exImpBadge.style.opacity = "0.4"; });
          exRow.addEventListener("mouseleave", () => { exImpBadge.style.opacity = "0"; });
        }
        exImpBadge.title = `改修Lv${exImpLevel} (クリックで変更)`;
        exImpBadge.addEventListener("click", (e) => {
          e.stopPropagation();
          const cur = fleet[idx].exSlotImprovement ?? 0;
          fleet[idx].exSlotImprovement = cur >= 10 ? 0 : cur + 1;
          renderFleetSlots(containerId, fleet);
        });
        exRow.appendChild(exImpBadge);
      }

      exRow.addEventListener("click", () => {
        state.equipModalTargetShipId = slot.shipId;
        state.equipModalTargetSlot = slot;
        state.equipModalTargetSlotIdx = -1;
        openEquipModal(slot.exSlotId, (id) => {
          fleet[idx].exSlotId = id;
          renderFleetSlots(containerId, fleet);
        });
      });
      leftCol.appendChild(exRow);

      // Stats grid
      if (!slot.statOverrides) slot.statOverrides = {};
      const overrides = slot.statOverrides!;

      const equipBonuses = slot.shipId != null
        ? computeEquipBonuses(
          slot.shipId,
          slot.equipIds,
          slot.exSlotId,
          slot.equipImprovement,
          slot.exSlotImprovement,
        )
        : {};
      const equipSums = computeEquipSum(slot.equipIds, slot.exSlotId);

      type StatDef = [string, string, number | null, number | null, boolean];
      const ist = slot.instanceStats;
      const leftStats: StatDef[] = [
        ["耐久", "taik", ship.taik?.[0] ?? null, ship.taik?.[1] ?? null, true],
        ["装甲", "souk", ist?.souk ?? ship.souk?.[0] ?? null, ship.souk?.[1] ?? null, true],
        ["回避", "kaih", ist?.kaih ?? null, null, true],
        ["搭載", "maxeq", ship.maxeq ? ship.maxeq.slice(0, slotCount).reduce((a: number, b: number) => a + b, 0) : null, null, true],
        ["速力", "soku", ship.soku, 20, false],
        ["射程", "leng", ship.leng, 5, false],
      ];
      const rightStats: StatDef[] = [
        ["火力", "houg", ist?.houg ?? ship.houg?.[0] ?? null, ship.houg?.[1] ?? null, true],
        ["雷装", "raig", ist?.raig ?? ship.raig?.[0] ?? null, ship.raig?.[1] ?? null, true],
        ["対空", "tyku", ist?.tyku ?? ship.tyku?.[0] ?? null, ship.tyku?.[1] ?? null, true],
        ["対潜", "tais", ist?.tais ?? ship.tais?.[0] ?? null, ship.tais?.[1] ?? null, true],
        ["索敵", "saku", ist?.saku ?? null, null, true],
        ["運", "luck", ist?.luck ?? ship.luck?.[0] ?? null, ship.luck?.[1] ?? null, true],
      ];

      const statsGrid = document.createElement("div");
      statsGrid.className =
        "grid grid-cols-[5.9rem_0.25rem_5.9rem] gap-x-0 gap-y-0 px-1.5 py-0 text-[10px] border-t border-base-200/50 leading-none w-fit";

      function formatStatVal(key: string, base: number | null, _max: number | null, isNumeric: boolean): string {
        const ov = overrides[key];
        const baseVal = ov ?? base;
        if (baseVal == null) return "—";

        const bonusContrib = equipBonuses[key] || 0;
        const total = key === "leng"
          ? Math.max(baseVal, equipSums.leng || 0) + bonusContrib
          : baseVal + (equipSums[key] || 0) + bonusContrib;

        if (!isNumeric && key === "soku") return SPEED_NAMES[total] ?? String(total);
        if (!isNumeric && key === "leng") return RANGE_NAMES[total] ?? String(total);
        return String(total);
      }

      function currentNumericVal(key: string, base: number | null): number {
        return overrides[key] ?? base ?? 0;
      }

      function createStatCell(label: string, key: string, base: number | null, max: number | null, isNumeric: boolean): HTMLElement {
        const cell = document.createElement("div");
        cell.className = "grid grid-cols-[1.25rem_1fr_1.5rem] items-center gap-0 group/stat h-[14px] w-[5.9rem]";

        const lb = document.createElement("span");
        lb.className = "text-base-content/40 font-medium text-[10px]";
        lb.textContent = label;
        cell.appendChild(lb);

        const valWrap = document.createElement("div");
        valWrap.className = "flex items-center gap-0 justify-end min-w-0";

        const minusBtn = document.createElement("button");
        minusBtn.className = "w-3.5 h-3.5 flex items-center justify-center rounded text-base-content/20 hover:text-primary hover:bg-primary/10 opacity-0 group-hover/stat:opacity-100 transition-all text-[9px] font-bold shrink-0";
        minusBtn.textContent = "−";
        minusBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (base == null && overrides[key] == null) return;
          const cur = currentNumericVal(key, base);
          const minVal = base ?? 0;
          if (cur > minVal) {
            overrides[key] = cur - (key === "soku" ? 5 : 1);
            if (overrides[key]! < minVal) overrides[key] = minVal;
          }
          renderFleetSlots(containerId, fleet);
        });
        valWrap.appendChild(minusBtn);

        const vl = document.createElement("span");
        vl.className = "font-mono text-base-content/70 text-right tabular-nums w-[1.55rem] cursor-pointer hover:text-primary transition-colors text-[10px]" + (overrides[key] != null ? " text-primary/80 font-bold" : "");
        vl.textContent = formatStatVal(key, base, max, isNumeric);
        vl.addEventListener("click", (e) => {
          e.stopPropagation();
          if (base == null && overrides[key] == null) return;
          const input = document.createElement("input");
          input.type = "number";
          input.className = "w-[1.55rem] h-[14px] text-[10px] font-mono text-right border border-primary/40 rounded px-0.5 bg-base-100 outline-none focus:border-primary";
          input.value = String(currentNumericVal(key, base));
          input.min = String(base ?? 0);
          if (max != null) input.max = String(max);
          const commit = () => {
            const v = parseInt(input.value, 10);
            if (!isNaN(v)) {
              const lo = base ?? 0;
              const hi = max ?? 9999;
              const clamped = Math.max(lo, Math.min(hi, v));
              if (clamped === base) { delete overrides[key]; }
              else { overrides[key] = clamped; }
            }
            renderFleetSlots(containerId, fleet);
          };
          input.addEventListener("blur", commit);
          input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") input.blur(); if (ev.key === "Escape") { delete overrides[key]; renderFleetSlots(containerId, fleet); } });
          vl.replaceWith(input);
          input.focus();
          input.select();
        });
        valWrap.appendChild(vl);

        const plusBtn = document.createElement("button");
        plusBtn.className = "w-3.5 h-3.5 flex items-center justify-center rounded text-base-content/20 hover:text-primary hover:bg-primary/10 opacity-0 group-hover/stat:opacity-100 transition-all text-[9px] font-bold shrink-0";
        plusBtn.textContent = "+";
        plusBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (base == null && overrides[key] == null) return;
          const cur = currentNumericVal(key, base);
          const maxVal = max ?? 9999;
          if (cur < maxVal) {
            overrides[key] = cur + (key === "soku" ? 5 : 1);
            if (overrides[key]! > maxVal) overrides[key] = maxVal;
          }
          renderFleetSlots(containerId, fleet);
        });
        valWrap.appendChild(plusBtn);

        cell.appendChild(valWrap);

        const eqStatVal = equipSums[key] || 0;
        const bonusVal = equipBonuses[key] || 0;
        const baseForDisplay = currentNumericVal(key, base);
        const effectiveEqDelta = key === "leng"
          ? Math.max(baseForDisplay, eqStatVal) - baseForDisplay
          : eqStatVal;
        const totalBonus = effectiveEqDelta + bonusVal;
        const bonusEl = document.createElement("span");
        bonusEl.className = "text-[10px] font-mono font-semibold tabular-nums leading-none w-[1.5rem] text-left pl-[1px]";
        if (totalBonus !== 0) {
          vl.title = `素: ${baseForDisplay}` +
            (effectiveEqDelta ? `, 装備: ${effectiveEqDelta > 0 ? "+" : ""}${effectiveEqDelta}` : "") +
            (bonusVal ? `, ボーナス: ${bonusVal > 0 ? "+" : ""}${bonusVal}` : "");
          const sign = totalBonus > 0 ? "+" : "";
          bonusEl.textContent = `${sign}${totalBonus}`;
          bonusEl.style.color = totalBonus > 0 ? "#b45309" : "#c2410c";
          bonusEl.style.textShadow = "none";
          if (bonusVal !== 0) {
            bonusEl.title = `装備: ${effectiveEqDelta > 0 ? "+" : ""}${effectiveEqDelta}, ボーナス: ${bonusVal > 0 ? "+" : ""}${bonusVal}`;
          }
        } else {
          bonusEl.textContent = "";
        }
        cell.appendChild(bonusEl);

        return cell;
      }

      for (let r = 0; r < 6; r++) {
        const [lLabel, lKey, lBase, lMax, lNum] = leftStats[r];
        const [rLabel, rKey, rBase, rMax, rNum] = rightStats[r];
        statsGrid.appendChild(createStatCell(lLabel, lKey, lBase, lMax, lNum));
        const spacer = document.createElement("span");
        statsGrid.appendChild(spacer);
        statsGrid.appendChild(createStatCell(rLabel, rKey, rBase, rMax, rNum));
      }
      leftCol.appendChild(statsGrid);
      card.appendChild(leftCol);

      card.addEventListener("click", (e) => {
        if (e.target === cardImg) {
          openShipModal(slot.shipId, (id) => {
            if (id !== slot.shipId) {
              fleet[idx].shipId = id;
              fleet[idx].equipIds = [null, null, null, null, null];
              fleet[idx].equipImprovement = [0, 0, 0, 0, 0];
              fleet[idx].equipProficiency = [0, 0, 0, 0, 0];
              fleet[idx].exSlotId = null;
              fleet[idx].exSlotImprovement = 0;
              delete fleet[idx].instanceStats;
            }
            renderFleetSlots(containerId, fleet);
          });
        }
      });
    }

    container.appendChild(card);
  });
}
