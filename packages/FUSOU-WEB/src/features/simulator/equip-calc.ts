// ── Equipment stat calculation & asset URL helpers ──

import {
  getAssetBaseUrl,
  getBannerMap,
  getCardMap,
  getEquipItemOnMap,
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

function hasEnoughItems(
  itemCounts: Map<number, number>,
  requiredItems: number[],
): boolean {
  const req = new Map<number, number>();
  for (const id of requiredItems) req.set(id, (req.get(id) || 0) + 1);
  for (const [id, c] of req.entries()) {
    if ((itemCounts.get(id) || 0) < c) return false;
  }
  return true;
}

function countBoundedMultisets(available: number[], pick: number): number {
  if (pick < 0) return 0;
  if (pick === 0) return 1;
  const dp = new Array(pick + 1).fill(0);
  dp[0] = 1;
  for (const cap of available) {
    const next = new Array(pick + 1).fill(0);
    for (let used = 0; used <= pick; used++) {
      if (dp[used] === 0) continue;
      const maxTake = Math.min(cap, pick - used);
      for (let take = 0; take <= maxTake; take++) {
        next[used + take] += dp[used];
      }
    }
    for (let i = 0; i <= pick; i++) dp[i] = next[i];
  }
  return dp[pick];
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
    if (rule.pairs) {
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
          for (const k of Object.keys(entry.b)) {
            const extra = (entry.b[k] || 0) * (count - 3);
            if (extra) src[k] = (src[k] || 0) + extra;
          }
        }
      } else if (count >= 2 && entry.c2) {
        src = { ...entry.c2 };
        if (count > 2) {
          for (const k of Object.keys(entry.b)) {
            const extra = (entry.b[k] || 0) * (count - 2);
            if (extra) src[k] = (src[k] || 0) + extra;
          }
        }
      } else {
        src = {};
        for (const k of Object.keys(entry.b)) {
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
  const itemCountMap = new Map<number, number>();
  for (const [idStr, levels] of Object.entries(itemGroups)) {
    itemCountMap.set(Number(idStr), levels.length);
  }

  // Helper: apply a multi-item rule (triple/quad/penta/hexa).
  // Supports item_pool (pool), fixed_items+free_pool, combos_b64, and explicit combos.
  const applyMultiRule = (
    rule: {
      ships: number[];
      synergy: Record<string, number>;
      item_pool?: number[];
      fixed_items?: number[];
      free_pool?: number[];
      free_pool_with_replacement?: boolean;
      free_pick_count?: number;
      items?: number[];
      combos_b64?: string;
      combos_u16_b64?: string;
      combos_u32_b64?: string;
      combos?: number[][];
      category_pools?: number[][];
      implicants?: number[][][];
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
    } else if (rule.implicants) {
      let totalTimes = 0;
      for (const implicant of rule.implicants) {
        const poolMap = new Map<string, { pool: number[]; count: number }>();
        for (const pool of implicant) {
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
        if (times > totalTimes) {
          totalTimes = times;
        }
      }
      if (totalTimes > 0) {
        for (const [k, v] of Object.entries(rule.synergy)) {
          if (v) bonuses[k] = (bonuses[k] || 0) + v * totalTimes;
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
      if (!hasEnoughItems(itemCountMap, rule.fixed_items)) return;
      const neededFree =
        typeof rule.free_pick_count === "number"
          ? rule.free_pick_count
          : comboSize - rule.fixed_items.length;
      if (rule.free_pool_with_replacement) {
        const fixedReq = new Map<number, number>();
        for (const id of rule.fixed_items)
          fixedReq.set(id, (fixedReq.get(id) || 0) + 1);
        const available = rule.free_pool.map((id) => {
          const total = itemCountMap.get(id) || 0;
          const consumedByFixed = fixedReq.get(id) || 0;
          return Math.max(0, total - consumedByFixed);
        });
        const times = countBoundedMultisets(available, neededFree);
        if (times > 0) {
          for (const [k, v] of Object.entries(rule.synergy)) {
            if (v) bonuses[k] = (bonuses[k] || 0) + v * times;
          }
        }
      } else {
        const freeOverlap = rule.free_pool.filter((id) =>
          equippedSet.has(id),
        ).length;
        if (freeOverlap >= neededFree) {
          const times = choose(freeOverlap, neededFree);
          for (const [k, v] of Object.entries(rule.synergy)) {
            if (v) bonuses[k] = (bonuses[k] || 0) + v * times;
          }
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
        const comboIds: number[] = [];
        for (let j = 0; j < comboSize; j++) comboIds.push(rule.items[buf[base + j]]);
        if (!hasEnoughItems(itemCountMap, comboIds)) continue outer;
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
        const comboIds: number[] = [];
        for (let j = 0; j < comboSize; j++) comboIds.push(rule.items[buf[base + j]]);
        if (!hasEnoughItems(itemCountMap, comboIds)) continue outer;
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
        const comboIds: number[] = [];
        for (let j = 0; j < comboSize; j++) comboIds.push(rule.items[buf[base + j]]);
        if (!hasEnoughItems(itemCountMap, comboIds)) continue outer;
        for (const [k, v] of Object.entries(rule.synergy)) {
          if (v) bonuses[k] = (bonuses[k] || 0) + v;
        }
      }
    } else if (rule.combos) {
      for (const combo of rule.combos) {
        if (hasEnoughItems(itemCountMap, combo)) {
          for (const [k, v] of Object.entries(rule.synergy)) {
            if (v) bonuses[k] = (bonuses[k] || 0) + v;
          }
        }
      }
    }
  };

  if (slotItemEffects.cross_rules) {
    for (const rule of slotItemEffects.cross_rules) {
      if (!rule.pairs) applyMultiRule(rule, 2);
    }
  }
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
  /** format=auto lets Cloudflare serve the best format for the browser */
  f?: "auto" | "webp" | "avif" | "png" | "jpeg";
}

/**
 * Build a Cloudflare Image Resizing URL.
 *
 * Cloudflare URL format (per docs):
 *   https://<ZONE>/cdn-cgi/image/<OPTIONS>/<SOURCE-IMAGE>
 *
 * - <ZONE> is the Cloudflare zone domain (our site origin, e.g. fusou.dev)
 * - <OPTIONS> is comma-separated parameters (format=auto)
 * - <SOURCE-IMAGE> is the absolute URL of the original image
 *
 * For local development (localhost etc.), bypass cdn-cgi and serve directly.
 */
function buildImageUrl(base: string, key: string, opts?: ImageOptions): string {
  // Always strip any trailing slash from base to ensure consistent joining
  const cleanBase = base.replace(/\/$/, "");
  const sourceUrl = `${cleanBase}/${key}`;

  if (!opts) return sourceUrl;

  try {
    const u = new URL(cleanBase);
    // Localhost / local IP bypass
    if (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname.startsWith("192.168.") ||
      u.hostname.startsWith("10.") ||
      u.hostname.endsWith(".local")
    ) {
      return sourceUrl;
    }
  } catch {
    return sourceUrl;
  }

  const params: string[] = [];
  if (opts.f) params.push(`format=${opts.f}`);
  if (params.length === 0) return sourceUrl;

  // Build: https://assets.fusou.dev/cdn-cgi/image/<OPTIONS>/<KEY>
  // This uses a relative path from the asset domain which is much safer and avoids cross-origin resizing blocks.
  return `${cleanBase}/cdn-cgi/image/${params.join(",")}/${key}`;
}

export function bannerUrl(shipId: number, options?: ImageOptions): string {
  const assetBaseUrl = getAssetBaseUrl();
  const key = getBannerMap()[String(shipId)];
  if (assetBaseUrl && key) return buildImageUrl(assetBaseUrl, key, options);
  if (!assetBaseUrl) {
    const fallback = `/api/asset-sync/ship-banner/${shipId}`;
    return fallback;
  }
  return "";
}

export function cardUrl(shipId: number): string {
  const assetBaseUrl = getAssetBaseUrl();
  const key = getCardMap()[String(shipId)];
  if (assetBaseUrl && key) return `${assetBaseUrl}/${key}`;
  return "";
}

export function shipIconUrl(shipId: number, options?: ImageOptions): string {
  const assetBaseUrl = getAssetBaseUrl();
  const key = getShipIconMap()[String(shipId)];
  if (assetBaseUrl && key) return buildImageUrl(assetBaseUrl, key, options);
  return "";
}



/**
 * Get equipment image URL. Prioritizes item_on path, falls back to item_up.
 * Uses item_on (the "equipped" display image) by default per user requirement.
 * Only falls back to item_up if item_on is not available.
 */
export function equipImageUrl(equipId: number, options?: ImageOptions): string {
  const id = String(equipId);
  const assetBaseUrl = getAssetBaseUrl();
  // Prioritize item_on, fallback to item_up
  const key = getEquipItemOnMap()[id] || getEquipItemUpMap()[id];
  if (assetBaseUrl && key) return buildImageUrl(assetBaseUrl, key, options);
  return "";
}

