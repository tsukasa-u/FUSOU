// ── Equipment stat calculation & asset URL helpers ──

import { STAT_KEYS } from "./constants";
import {
  getAssetBaseUrl,
  getBannerMap,
  getCardMap,
  getEquipCardMap,
  getEquipItemUpMap,
  getShipTypeIconFrame,
  getShipTypeSpriteSheetMeta,
  getShipIconMap,
  getMasterSlotItem,
  getSlotItemEffects,
  getSpriteSheetMeta,
  getWeaponIconFrame,
  getMasterShip,
  getSokuSpeedData,
} from "./simulator-selectors";
import type { EffectRule, CrossRule, SlotItemEffectsData } from "./types";

/** Binomial coefficient C(n, k). */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = Math.round((r * (n - i)) / (i + 1));
  return r;
}

// ── Lazy-built lookup indices for effect_rules and cross_rules ─────
// Rebuilt whenever the underlying slotItemEffects data reference changes.
let _indexedDataRef: SlotItemEffectsData | null = null;
let _effectIndex: Map<number, EffectRule[]> = new Map();
let _crossIndex: Map<string, CrossRule[]> = new Map();

// Cache for decoded combo Uint8Arrays (keyed by rule object; GC'd with old data).
const _combosB64Cache = new WeakMap<object, Uint8Array>();
const _combosU16B64Cache = new WeakMap<object, Uint16Array>();
const _combosU32B64Cache = new WeakMap<object, Uint32Array>();

function ensureIndex(data: SlotItemEffectsData): void {
  if (_indexedDataRef === data) return;
  _indexedDataRef = data;
  _effectIndex = new Map();
  _crossIndex = new Map();
  for (const rule of data.effect_rules ?? []) {
    for (const itemId of rule.items) {
      let list = _effectIndex.get(itemId);
      if (!list) {
        list = [];
        _effectIndex.set(itemId, list);
      }
      list.push(rule);
    }
  }
  for (const rule of data.cross_rules ?? []) {
    for (const [a, b] of rule.pairs) {
      const key = `${a}:${b}`;
      let list = _crossIndex.get(key);
      if (!list) {
        list = [];
        _crossIndex.set(key, list);
      }
      list.push(rule);
    }
  }
  // Back-compat: index legacy effects dict if present and effect_rules absent
  if (!data.effect_rules && data.effects) {
    for (const [idStr, entries] of Object.entries(data.effects)) {
      _effectIndex.set(parseInt(idStr, 10), entries as EffectRule[]);
    }
  }
  // Back-compat: index legacy cross_effects dict if present and cross_rules absent
  if (!data.cross_rules && data.cross_effects) {
    for (const [key, entries] of Object.entries(data.cross_effects)) {
      _crossIndex.set(
        key,
        entries.map((e) => ({
          ships: e.ships,
          synergy: e.synergy,
          pairs: [e.items],
        })),
      );
    }
  }
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
) {
  let timer: number;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

/**
 * Returns true if `subset` (sorted) is a multiset subset of `superset` (sorted).
 * Both arrays must be pre-sorted ascending. Used for speed observation matching:
 * an observation's item_ids must all appear (with at least the same count) in
 * the current loadout for the observation to be applicable.
 */
function isSortedMultisetSubset(subset: number[], superset: number[]): boolean {
  let si = 0;
  let pi = 0;
  while (si < subset.length && pi < superset.length) {
    if (subset[si] === superset[pi]) {
      si++;
      pi++;
    } else if (superset[pi] < subset[si]) {
      pi++;
    } else return false; // subset[si] < superset[pi]: element not in superset
  }
  return si === subset.length;
}

/**
 * Returns the sorted multiset intersection of two pre-sorted ascending arrays.
 * Used to find items common to all speed-upgrade observations for a given tier.
 */
export function intersectSorted(a: number[], b: number[]): number[] {
  const result: number[] = [];
  let ai = 0;
  let bi = 0;
  while (ai < a.length && bi < b.length) {
    if (a[ai] === b[bi]) {
      result.push(a[ai]);
      ai++;
      bi++;
    } else if (a[ai] < b[bi]) {
      ai++;
    } else {
      bi++;
    }
  }
  return result;
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
  const slotItemEffects = getSlotItemEffects();
  if (!slotItemEffects) return bonuses;

  ensureIndex(slotItemEffects);

  const allItems: { id: number; improvement: number }[] = [];
  for (let i = 0; i < equipIds.length; i++) {
    const id = equipIds[i];
    if (id == null) continue;
    allItems.push({ id, improvement: equipImprovements[i] || 0 });
  }
  if (exSlotId != null)
    allItems.push({ id: exSlotId, improvement: exSlotImprovement || 0 });
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
    const entries = _effectIndex.get(id);
    if (!entries) continue;

    for (const entry of entries) {
      if (!entry.ships.includes(shipId)) continue;

      let src: Record<string, number>;
      if (count === 1) {
        const lv = levels[0] ?? 0;
        src = entry.b;
        // Detector now emits discrete improvement transitions; use exact step values.
        if (entry.i && entry.i.length > 0) {
          for (const [threshold, stats] of entry.i) {
            if (lv < threshold) break;
            src = stats;
          }
        } else if (entry.l && lv >= 10) {
          // Backward compatibility for legacy max-only profile.
          src = entry.l;
        }
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
      const entries = _crossIndex.get(`${a}:${b}`);
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

  // Build a Set for O(1) equipped-item lookup (used by multi-item rules below).
  const equippedSet = new Set(uniqueIds);

  // Helper: apply a multi-item rule (triple/quad/penta/hexa).
  // Supports item_pool (pool), fixed_items+free_pool, combos_b64, and explicit combos.
  const applyMultiRule = (
    rule: {
      ships: number[];
      synergy: Record<string, number>;
      item_pool?: number[];
      fixed_items?: number[];
      free_pool?: number[];
      items?: number[];
      combos_b64?: string;
      combos_u16_b64?: string;
      combos_u32_b64?: string;
      combos?: number[][];
      category_pools?: number[][];
      cancels_single?: boolean;
    },
    comboSize: number,
  ) => {
    if (!rule.ships.includes(shipId)) return;
    if (rule.category_pools) {
      // Group identical pools to calculate exact combinations
      const poolMap = new Map<string, { pool: number[]; count: number }>();
      for (const pool of rule.category_pools) {
        const key = pool.join(",");
        if (!poolMap.has(key)) poolMap.set(key, { pool, count: 0 });
        poolMap.get(key)!.count++;
      }

      let times = 1;
      for (const { pool, count } of poolMap.values()) {
        let overlap = 0;
        for (let i = 0; i < pool.length; i++) {
          if (equippedSet.has(pool[i])) overlap++;
        }
        if (overlap < count) {
          times = 0;
          break;
        }
        times *= choose(overlap, count);
      }
      if (times > 0) {
        for (const [k, v] of Object.entries(rule.synergy)) {
          if (v) bonuses[k] = (bonuses[k] || 0) + v * times;
        }
      }
    } else if (rule.item_pool) {
      const overlap = rule.item_pool.filter((id) => equippedSet.has(id)).length;
      if (overlap >= comboSize) {
        const times = choose(overlap, comboSize);
        for (const [k, v] of Object.entries(rule.synergy)) {
          if (v) bonuses[k] = (bonuses[k] || 0) + v * times;
        }
      }
    } else if (rule.fixed_items && rule.free_pool) {
      if (!rule.fixed_items.every((id) => equippedSet.has(id))) return;
      const neededFree = comboSize - rule.fixed_items.length;
      const freeOverlap = rule.free_pool.filter((id) =>
        equippedSet.has(id),
      ).length;
      if (freeOverlap >= neededFree) {
        const times = choose(freeOverlap, neededFree);
        for (const [k, v] of Object.entries(rule.synergy)) {
          if (v) bonuses[k] = (bonuses[k] || 0) + v * times;
        }
      }
    } else if (rule.combos_b64 && rule.items) {
      let buf = _combosB64Cache.get(rule);
      if (!buf) {
        buf = Uint8Array.from(atob(rule.combos_b64), (c) => c.charCodeAt(0));
        _combosB64Cache.set(rule, buf);
      }
      const count = buf.length / comboSize;
      outer: for (let ci = 0; ci < count; ci++) {
        const base = ci * comboSize;
        for (let j = 0; j < comboSize; j++) {
          if (!equippedSet.has(rule.items[buf[base + j]])) continue outer;
        }
        for (const [k, v] of Object.entries(rule.synergy)) {
          if (v) bonuses[k] = (bonuses[k] || 0) + v;
        }
      }
    } else if (rule.combos_u16_b64 && rule.items) {
      let buf = _combosU16B64Cache.get(rule);
      if (!buf) {
        const raw = Uint8Array.from(atob(rule.combos_u16_b64), (c) =>
          c.charCodeAt(0),
        );
        buf = new Uint16Array(
          raw.buffer,
          raw.byteOffset,
          Math.floor(raw.byteLength / 2),
        );
        _combosU16B64Cache.set(rule, buf);
      }
      const count = buf.length / comboSize;
      outer: for (let ci = 0; ci < count; ci++) {
        const base = ci * comboSize;
        for (let j = 0; j < comboSize; j++) {
          if (!equippedSet.has(rule.items[buf[base + j]])) continue outer;
        }
        for (const [k, v] of Object.entries(rule.synergy)) {
          if (v) bonuses[k] = (bonuses[k] || 0) + v;
        }
      }
    } else if (rule.combos_u32_b64 && rule.items) {
      let buf = _combosU32B64Cache.get(rule);
      if (!buf) {
        const raw = Uint8Array.from(atob(rule.combos_u32_b64), (c) =>
          c.charCodeAt(0),
        );
        buf = new Uint32Array(
          raw.buffer,
          raw.byteOffset,
          Math.floor(raw.byteLength / 4),
        );
        _combosU32B64Cache.set(rule, buf);
      }
      const count = buf.length / comboSize;
      outer: for (let ci = 0; ci < count; ci++) {
        const base = ci * comboSize;
        for (let j = 0; j < comboSize; j++) {
          if (!equippedSet.has(rule.items[buf[base + j]])) continue outer;
        }
        for (const [k, v] of Object.entries(rule.synergy)) {
          if (v) bonuses[k] = (bonuses[k] || 0) + v;
        }
      }
    } else if (rule.combos) {
      for (const combo of rule.combos) {
        if (combo.every((id) => equippedSet.has(id))) {
          for (const [k, v] of Object.entries(rule.synergy)) {
            if (v) bonuses[k] = (bonuses[k] || 0) + v;
          }
        }
      }
    }
  };

  if (slotItemEffects.triple_rules) {
    for (const rule of slotItemEffects.triple_rules) applyMultiRule(rule, 3);
  }
  if (slotItemEffects.quad_rules) {
    for (const rule of slotItemEffects.quad_rules) applyMultiRule(rule, 4);
  }
  if (slotItemEffects.penta_rules) {
    for (const rule of slotItemEffects.penta_rules) applyMultiRule(rule, 5);
  }
  if (slotItemEffects.hexa_rules) {
    for (const rule of slotItemEffects.hexa_rules) applyMultiRule(rule, 6);
  }

  // Speed upgrade bonus from real gameplay observations.
  // No assumptions are made about which item IDs affect speed.
  //
  // Each observation records ALL items equipped at the time, not just the
  // speed-affecting ones. Matching on the full set would be too strict:
  // the same turbine+boiler upgrade would fail to match if the gun differs
  // from what was observed.
  //
  // Instead, group observations by speed tier and take the intersection of
  // their item_ids. Items common to EVERY observation of a tier are the
  // ones reliably present for that upgrade, independent of incidental gear.
  // Then require only those intersected items to be in the current loadout.
  {
    const baseShip = getMasterShip(shipId);
    const baseSoku = baseShip?.soku ?? 0;
    if (baseSoku > 0) {
      const speedData = getSokuSpeedData();
      const masterObs = speedData?.[shipId];
      if (masterObs && masterObs.length > 0) {
        // Build sorted multiset of currently equipped non-zero item IDs.
        const currentIds = allItems
          .map((i) => i.id)
          .filter((id) => id > 0)
          .sort((a, b) => a - b);

        // Group speed-upgrade observations by their observed speed tier.
        const tierMap = new Map<number, number[][]>();
        for (const obs of masterObs) {
          if (obs.soku_observed <= baseSoku) continue;
          const list = tierMap.get(obs.soku_observed);
          if (list) list.push(obs.item_ids);
          else tierMap.set(obs.soku_observed, [obs.item_ids]);
        }

        let bestSoku = baseSoku;
        for (const [sokuTier, idArrays] of tierMap) {
          // Intersect all item_id arrays for this tier to derive the minimal
          // required item set (items present in every observation of this tier).
          let required = [...idArrays[0]];
          for (let k = 1; k < idArrays.length; k++) {
            required = intersectSorted(required, idArrays[k]);
          }

          if (required.length > 0) {
            // Apply the upgrade if the current loadout contains all required items.
            if (isSortedMultisetSubset(required, currentIds)) {
              bestSoku = Math.max(bestSoku, sokuTier);
            }
          } else {
            // No items in common across observations (single obs or completely
            // different item sets). Fall back to per-observation subset matching
            // to avoid a vacuous match (empty required always passes).
            for (const ids of idArrays) {
              if (isSortedMultisetSubset(ids, currentIds)) {
                bestSoku = Math.max(bestSoku, sokuTier);
                break;
              }
            }
          }
        }

        if (bestSoku > baseSoku) {
          bonuses.soku = (bonuses.soku || 0) + (bestSoku - baseSoku);
        }
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
    const eq = getMasterSlotItem(id);
    if (!eq) continue;
    for (const k of [
      "houg",
      "raig",
      "tyku",
      "tais",
      "baku",
      "saku",
      "houm",
      "souk",
      "luck",
      "soku",
    ] as const) {
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

export interface ImageOptions {
  w?: number;
  h?: number;
  q?: number;
  f?: "auto" | "webp" | "avif" | "png" | "jpeg";
}

function buildImageUrl(base: string, key: string, opts?: ImageOptions): string {
  // Always strip any trailing slash from base to ensure consistent joining
  const cleanBase = base.replace(/\/$/, "");
  
  if (!opts) return `${cleanBase}/${key}`;
  
  try {
    const u = new URL(cleanBase);
    // Cloudflare Image Resizing is strictly an Edge feature.
    // If the base URL is local (e.g. local wrangler proxy), bypass resizing
    // and serve the original image directly.
    if (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname.startsWith("192.168.") ||
      u.hostname.startsWith("10.") ||
      u.hostname.endsWith(".local")
    ) {
      return `${cleanBase}/${key}`;
    }
  } catch {
    // If base is not a valid URL, fallback to direct concatenation
  }

  const params: string[] = [];
  if (opts.w) params.push(`width=${opts.w}`);
  if (opts.h) params.push(`height=${opts.h}`);
  if (opts.q) params.push(`quality=${opts.q}`);
  if (opts.f) params.push(`format=${opts.f}`);
  if (params.length === 0) return `${cleanBase}/${key}`;
  return `${cleanBase}/cdn-cgi/image/${params.join(",")}/${key}`;
}

export function bannerUrl(shipId: number, options?: ImageOptions): string {
  const assetBaseUrl = getAssetBaseUrl();
  const key = getBannerMap()[String(shipId)];
  if (assetBaseUrl && key) return buildImageUrl(assetBaseUrl, key, options);
  if (!assetBaseUrl) {
    const fallback = `/api/asset-sync/ship-banner/${shipId}`;
    if (!options) return fallback;
    // For local fallback via image-proxy, resizing isn't supported, so just return the original
    return fallback;
  }
  return "";
}

export function cardUrl(shipId: number, options?: ImageOptions): string {
  const assetBaseUrl = getAssetBaseUrl();
  const key = getCardMap()[String(shipId)];
  if (assetBaseUrl && key) return buildImageUrl(assetBaseUrl, key, options);
  return "";
}

export function shipIconUrl(shipId: number, options?: ImageOptions): string {
  const assetBaseUrl = getAssetBaseUrl();
  const key = getShipIconMap()[String(shipId)];
  if (assetBaseUrl && key) return buildImageUrl(assetBaseUrl, key, options);
  return "";
}

export function createWeaponIconEl(iconNum: number, size = 20): HTMLElement {
  const frame = getWeaponIconFrame(iconNum);
  const spriteSheet = getSpriteSheetMeta();
  if (frame && spriteSheet.url) {
    const [fx, fy, fw, fh] = frame;
    const scaleX = size / fw;
    const scaleY = size / fh;
    const wrapper = document.createElement("div");
    wrapper.className = "shrink-0 overflow-hidden";
    wrapper.style.width = `${size}px`;
    wrapper.style.height = `${size}px`;
    const img = document.createElement("img");
    img.src = spriteSheet.url;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.style.width = `${spriteSheet.width * scaleX}px`;
    img.style.height = `${spriteSheet.height * scaleY}px`;
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

export function createShipTypeIconEl(
  stype: number,
  width = 66,
  height = 18,
): HTMLElement {
  const frame = getShipTypeIconFrame(stype);
  const spriteSheet = getShipTypeSpriteSheetMeta();
  if (frame && spriteSheet.url) {
    const [fx, fy, fw, fh] = frame;
    const scaleX = width / fw;
    const scaleY = height / fh;
    const wrapper = document.createElement("div");
    wrapper.className = "shrink-0 overflow-hidden";
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    const img = document.createElement("img");
    img.src = spriteSheet.url;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.style.width = `${spriteSheet.width * scaleX}px`;
    img.style.height = `${spriteSheet.height * scaleY}px`;
    img.style.marginLeft = `-${fx * scaleX}px`;
    img.style.marginTop = `-${fy * scaleY}px`;
    img.style.maxWidth = "none";
    img.style.display = "block";
    wrapper.appendChild(img);
    return wrapper;
  }
  const el = document.createElement("div");
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.className = "shrink-0";
  return el;
}

export function equipImageUrl(equipId: number, options?: ImageOptions): string {
  const id = String(equipId);
  const assetBaseUrl = getAssetBaseUrl();
  const key = getEquipItemUpMap()[id] || getEquipCardMap()[id];
  if (assetBaseUrl && key) return buildImageUrl(assetBaseUrl, key, options);
  return "";
}
