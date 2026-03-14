// ── Equipment stat calculation & asset URL helpers ──

import { state } from "./state";
import { STAT_KEYS } from "./constants";

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number) {
  let timer: number;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

/**
 * Compute total equipment bonus for a ship given its loadout.
 * Returns per-stat bonus values (single-item + pairwise synergy).
 */
export function computeEquipBonuses(
  shipId: number,
  equipIds: (number | null)[],
  exSlotId: number | null,
  equipImprovements: number[],
  exSlotImprovement: number,
): Record<string, number> {
  const bonuses: Record<string, number> = {};
  if (!state.slotItemEffects) return bonuses;

  const allItems: { id: number; improvement: number }[] = [];
  for (let i = 0; i < equipIds.length; i++) {
    const id = equipIds[i];
    if (id == null) continue;
    allItems.push({ id, improvement: equipImprovements[i] || 0 });
  }
  if (exSlotId != null) allItems.push({ id: exSlotId, improvement: exSlotImprovement || 0 });
  if (allItems.length === 0) return bonuses;

  const itemGroups: Record<number, number[]> = {};
  for (const item of allItems) {
    if (!itemGroups[item.id]) itemGroups[item.id] = [];
    itemGroups[item.id].push(item.improvement);
  }

  // Single-item bonuses
  for (const idStr of Object.keys(itemGroups)) {
    const id = parseInt(idStr, 10);
    const levels = itemGroups[id];
    const count = levels.length;
    const entries = state.slotItemEffects.effects[id];
    if (!entries) continue;

    for (const entry of entries) {
      if (!entry.ships.includes(shipId)) continue;

      let src: Record<string, number>;
      if (count === 1) {
        const hasStar10 = levels.some((lv) => lv >= 10);
        src = hasStar10 && entry.l ? entry.l : entry.b;
      } else if (count >= 3 && entry.c3) {
        src = { ...entry.c3 };
        if (count > 3) {
          for (const k of STAT_KEYS) {
            const extra = (entry.b[k] || 0) * (count - 3);
            if (extra) src[k] = (src[k] || 0) + extra;
          }
        }
      } else if (count >= 2 && entry.c2) {
        src = { ...entry.c2 };
        if (count > 2) {
          for (const k of STAT_KEYS) {
            const extra = (entry.b[k] || 0) * (count - 2);
            if (extra) src[k] = (src[k] || 0) + extra;
          }
        }
      } else {
        src = {};
        for (const k of STAT_KEYS) {
          const v = (entry.b[k] || 0) * count;
          if (v) src[k] = v;
        }
      }
      for (const [k, v] of Object.entries(src)) {
        if (v) bonuses[k] = (bonuses[k] || 0) + v;
      }
      break;
    }
  }

  // Cross-item synergy bonuses (pairwise)
  const uniqueIds = Object.keys(itemGroups).map(Number);
  for (let i = 0; i < uniqueIds.length; i++) {
    for (let j = i + 1; j < uniqueIds.length; j++) {
      const a = Math.min(uniqueIds[i], uniqueIds[j]);
      const b = Math.max(uniqueIds[i], uniqueIds[j]);
      const entries = state.slotItemEffects.cross_effects[`${a}:${b}`];
      if (!entries) continue;
      for (const entry of entries) {
        if (!entry.ships.includes(shipId)) continue;
        for (const [k, v] of Object.entries(entry.synergy)) {
          if (v) bonuses[k] = (bonuses[k] || 0) + v;
        }
        break;
      }
    }
  }

  return bonuses;
}

/**
 * Compute equipment sum for a ship slot (raw equip stats, no bonuses).
 */
export function computeEquipSum(
  equipIds: (number | null)[],
  exSlotId: number | null,
): Record<string, number> {
  const sums: Record<string, number> = {};
  const ids = [...equipIds];
  if (exSlotId != null) ids.push(exSlotId);
  for (const id of ids) {
    if (id == null) continue;
    const eq = state.mstSlotItems[id];
    if (!eq) continue;
    for (const k of ["houg", "raig", "tyku", "tais", "baku", "saku", "houm", "souk", "luck", "soku"] as const) {
      const v = eq[k] || 0;
      if (v) sums[k] = (sums[k] || 0) + v;
    }
    const eqKaih = eq.kaih ?? eq.houk ?? 0;
    if (eqKaih) sums.kaih = (sums.kaih || 0) + eqKaih;
    const eqLeng = eq.leng || 0;
    if (eqLeng) {
      sums.leng = Math.max(sums.leng || 0, eqLeng);
    }
  }
  return sums;
}

export function bannerUrl(shipId: number): string {
  const key = state.bannerMap[String(shipId)];
  if (state.assetBaseUrl && key) return `${state.assetBaseUrl}/${key}`;
  if (!state.assetBaseUrl) return `/api/asset-sync/ship-banner/${shipId}`;
  return "";
}

export function cardUrl(shipId: number): string {
  const key = state.cardMap[String(shipId)];
  if (state.assetBaseUrl && key) return `${state.assetBaseUrl}/${key}`;
  return bannerUrl(shipId);
}

export function createWeaponIconEl(iconNum: number, size = 20): HTMLElement {
  const frame = state.weaponIconFrames[iconNum];
  if (frame && state.spriteSheetUrl) {
    const [fx, fy, fw, fh] = frame;
    const scaleX = size / fw;
    const scaleY = size / fh;
    const wrapper = document.createElement("div");
    wrapper.className = "shrink-0 overflow-hidden";
    wrapper.style.width = `${size}px`;
    wrapper.style.height = `${size}px`;
    const img = document.createElement("img");
    img.src = state.spriteSheetUrl;
    img.alt = "";
    img.style.width = `${state.spriteSheetW * scaleX}px`;
    img.style.height = `${state.spriteSheetH * scaleY}px`;
    img.style.marginLeft = `-${fx * scaleX}px`;
    img.style.marginTop = `-${fy * scaleY}px`;
    img.style.maxWidth = "none";
    img.style.display = "block";
    wrapper.appendChild(img);
    return wrapper;
  }
  const el = document.createElement("div");
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.className = "shrink-0";
  return el;
}

export function equipImageUrl(equipId: number): string {
  const id = String(equipId);
  const key = state.equipCardMap[id] || state.equipItemUpMap[id];
  if (state.assetBaseUrl && key) return `${state.assetBaseUrl}/${key}`;
  return "";
}
