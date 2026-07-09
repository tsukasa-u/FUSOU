/**
 * Synergy calculation logic — pure functions with no DOM dependencies.
 * Shared between ShipDetailPanel and EquipDetailPanel.
 */

import type {
  MstSlotItemData,
  SlotItemEffectsData,
  EquipEffect,
  CrossEffect,
  SlotUsageSummary,
  TripleRule,
  QuadRule,
  PentaRule,
} from "@/features/simulator/types";
import { getMasterSlotItem } from "@/features/simulator/simulator-selectors";
import { ENEMY_ID_THRESHOLD } from "@/features/simulator/constants";
import { equipDisplayTypeName } from "@/features/simulator/display-utils";
import {
  filterForExslot,
  getExslotSelectionRequirement,
  getNormalSlotAllowedIndexes,
  type EquipSelectionRequirement,
} from "@/features/simulator/equip-filter";
import type { MstShipData } from "@/features/simulator/types";

// ── Constants ────────────────────────────────────────────────────────

export const SYNERGY_STAT_LABELS: Record<string, string> = {
  houg: "火力",
  raig: "雷装",
  tyku: "対空",
  souk: "装甲",
  soku: "速力",
  kaih: "回避",
  tais: "対潜",
  saku: "索敵",
  baku: "爆装",
  houm: "命中",
  luck: "運",
  leng: "射程",
};

export const SYNERGY_STAT_ORDER = [
  "houg",
  "raig",
  "tyku",
  "tais",
  "baku",
  "houm",
  "saku",
  "souk",
  "soku",
  "kaih",
  "luck",
  "leng",
] as const;

export const MOBILITY_SYNERGY_KEYS = new Set(["soku", "leng"]);

// ── Types ────────────────────────────────────────────────────────────

export type SynergyStatRows = Array<{ key: string; label: string; value: number }>;
export type ImprovementSynergyRow = {
  label: string;
  stats: Record<string, number>;
};

export type MobilitySynergyRow = {
  key: string;
  equip: MstSlotItemData;
  partner: MstSlotItemData | null;
  sourceType: "single" | "pair" | "combo";
  before: number;
  after: number;
};

export type ListExpandSettings = {
  expandEquippableEquip: boolean;
  expandSingleSynergy: boolean;
  expandPairSynergy: boolean;
  expandMultiSynergy: boolean;
  expandSynergyShips: boolean;
  expandCompatibleShips: boolean;
  showMultiSynergy: boolean;
  showMultiSynergyEquip: boolean;
};

export const DEFAULT_EXPAND_SETTINGS: ListExpandSettings = {
  expandEquippableEquip: false,
  expandSingleSynergy: false,
  expandPairSynergy: false,
  expandMultiSynergy: false,
  expandSynergyShips: false,
  expandCompatibleShips: false,
  showMultiSynergy: true,
  showMultiSynergyEquip: true,
};

// Multi-item synergy display types
export type MultiComboEntry = {
  kind: "combo";
  combo: MstSlotItemData[];
  netStats: Record<string, number>;
  ships?: number[];
  placements?: SlotUsageSummary[];
};
export type MultiPoolEntry = {
  kind: "pool";
  pool: MstSlotItemData[];
  comboSize: number;
  correction: Record<string, number>;
  fixed?: MstSlotItemData[];
  freePool?: MstSlotItemData[];
  freePoolWithReplacement?: boolean;
  freePickCount?: number;
  ships?: number[];
  placements?: SlotUsageSummary[];
};
export type MultiCategoryEntry = {
  kind: "category";
  pools: MstSlotItemData[][];
  cancels_single: boolean;
  correction: Record<string, number>;
  ships?: number[];
  is_implicant?: boolean;
  placements?: SlotUsageSummary[];
};
export type MultiGroupedComboEntry = {
  kind: "grouped_combo";
  groupedPools: MstSlotItemData[][];
  netStats: Record<string, number>;
  ships?: number[];
};
export type MultiEntry =
  | MultiComboEntry
  | MultiPoolEntry
  | MultiCategoryEntry
  | MultiGroupedComboEntry;
export type MultiGroup = { statKey: string; label: string; entries: MultiEntry[] };

export type SynergyGroup<T> = { statKey: string; label: string; entries: T[] };

function compactComboGroupToPool(group: MultiComboEntry[]): MultiEntry[] {
  if (group.length < 2) return group;

  const comboSize = group[0].combo.length;
  if (comboSize <= 1) return group;
  if (group.some((entry) => entry.combo.length !== comboSize)) return group;

  const itemLookup = new Map<number, MstSlotItemData>();
  for (const entry of group) {
    for (const item of entry.combo) itemLookup.set(item.id, item);
  }

  const toCountMap = (entry: MultiComboEntry): Map<number, number> => {
    const out = new Map<number, number>();
    for (const item of entry.combo) {
      out.set(item.id, (out.get(item.id) ?? 0) + 1);
    }
    return out;
  };
  const countMaps = group.map(toCountMap);

  const toSig = (counts: Map<number, number>): string =>
    [...counts.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => a[0] - b[0])
      .map(([id, count]) => `${id}^${count}`)
      .join("|");

  const nCk = (n: number, k: number): number => {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    const kk = Math.min(k, n - k);
    let res = 1;
    for (let i = 1; i <= kk; i++) {
      res = (res * (n - kk + i)) / i;
    }
    return Math.round(res);
  };

  const residualAfterFixed = (
    source: Map<number, number>,
    fixed: Map<number, number>,
  ): Map<number, number> | null => {
    const out = new Map<number, number>(source);
    for (const [id, c] of fixed) {
      const next = (out.get(id) ?? 0) - c;
      if (next < 0) return null;
      if (next === 0) out.delete(id);
      else out.set(id, next);
    }
    return out;
  };

  const residualKeyWithoutReplacement = (
    residual: Map<number, number>,
    k: number,
  ): string | null => {
    let total = 0;
    const parts: number[] = [];
    for (const [id, c] of residual) {
      total += c;
      if (c > 1) return null;
      if (c === 1) parts.push(id);
    }
    if (total !== k) return null;
    parts.sort((a, b) => a - b);
    return parts.join(",");
  };

  const residualKeyWithReplacement = (
    residual: Map<number, number>,
    k: number,
  ): string | null => {
    let total = 0;
    const parts: number[] = [];
    for (const [id, c] of residual) {
      total += c;
      for (let i = 0; i < c; i++) parts.push(id);
    }
    if (total !== k) return null;
    parts.sort((a, b) => a - b);
    return parts.join(",");
  };

  const nHk = (n: number, k: number): number => nCk(n + k - 1, k);

  const tryBuildBipartiteCategory = (
    memberIndexes: number[],
    fixedCounts: Map<number, number>,
  ): MultiCategoryEntry | null => {
    const edges: Array<[number, number]> = [];
    const adjacency = new Map<number, Set<number>>();

    for (const i of memberIndexes) {
      const residual = residualAfterFixed(countMaps[i], fixedCounts);
      if (!residual) return null;
      const key = residualKeyWithoutReplacement(residual, 2);
      if (!key) return null;
      const parts = key.split(",").map(Number);
      if (parts.length !== 2) return null;
      const [a, b] = parts;
      if (a === b) return null;
      edges.push([a, b]);
      if (!adjacency.has(a)) adjacency.set(a, new Set<number>());
      if (!adjacency.has(b)) adjacency.set(b, new Set<number>());
      adjacency.get(a)!.add(b);
      adjacency.get(b)!.add(a);
    }

    if (edges.length < 4 || adjacency.size < 4) return null;

    const color = new Map<number, 0 | 1>();
    const queue: number[] = [];
    for (const node of adjacency.keys()) {
      if (color.has(node)) continue;
      color.set(node, 0);
      queue.push(node);
      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentColor = color.get(current)!;
        for (const next of adjacency.get(current) ?? []) {
          const nextColor = color.get(next);
          if (nextColor == null) {
            color.set(next, currentColor === 0 ? 1 : 0);
            queue.push(next);
            continue;
          }
          if (nextColor === currentColor) return null;
        }
      }
    }

    const left = [...color.entries()]
      .filter(([, c]) => c === 0)
      .map(([id]) => id)
      .sort((a, b) => a - b);
    const right = [...color.entries()]
      .filter(([, c]) => c === 1)
      .map(([id]) => id)
      .sort((a, b) => a - b);
    if (left.length === 0 || right.length === 0) return null;

    const edgeSet = new Set(edges.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`));
    if (edgeSet.size !== left.length * right.length) return null;
    for (const a of left) {
      for (const b of right) {
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (!edgeSet.has(key)) return null;
      }
    }

    const fixedPools: MstSlotItemData[][] = [];
    for (const [itemId, count] of [...fixedCounts.entries()].sort((a, b) => a[0] - b[0])) {
      const item = itemLookup.get(itemId);
      if (!item) return null;
      for (let i = 0; i < count; i++) fixedPools.push([item]);
    }

    const leftPool = left
      .map((id) => itemLookup.get(id))
      .filter((it): it is MstSlotItemData => it != null)
      .sort((a, b) => a.sortno - b.sortno || a.id - b.id);
    const rightPool = right
      .map((id) => itemLookup.get(id))
      .filter((it): it is MstSlotItemData => it != null)
      .sort((a, b) => a.sortno - b.sortno || a.id - b.id);
    if (leftPool.length !== left.length || rightPool.length !== right.length) return null;

    const mergedShips = new Set<number>();
    for (const i of memberIndexes) {
      for (const shipId of group[i].ships ?? []) mergedShips.add(shipId);
    }

    return {
      kind: "category",
      pools: [...fixedPools, leftPool, rightPool],
      cancels_single: false,
      correction: group[0].netStats,
      ships: group[0].ships != null ? [...mergedShips].sort((a, b) => a - b) : group[0].ships,
    };
  };

  const enumerateFixedSigs = (
    counts: Map<number, number>,
    keepCount: number,
  ): string[] => {
    const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
    const chosen = new Map<number, number>();
    const out = new Set<string>();

    const rec = (idx: number, remain: number) => {
      if (idx === entries.length) {
        if (remain === 0) out.add(toSig(chosen));
        return;
      }
      const [id, maxC] = entries[idx];
      for (let take = 0; take <= Math.min(maxC, remain); take++) {
        if (take > 0) chosen.set(id, take);
        else chosen.delete(id);
        rec(idx + 1, remain - take);
      }
    };

    rec(0, keepCount);
    return [...out];
  };

  const usedComboIndexes = new Set<number>();
  const out: MultiEntry[] = [];

  for (let freePickCount = Math.min(2, comboSize - 1); freePickCount >= 1; freePickCount--) {
    const keepCount = comboSize - freePickCount;
    const families = new Map<string, Set<number>>();

    for (let idx = 0; idx < countMaps.length; idx++) {
      if (usedComboIndexes.has(idx)) continue;
      const fixedSigs = enumerateFixedSigs(countMaps[idx], keepCount);
      for (const sig of fixedSigs) {
        if (!families.has(sig)) families.set(sig, new Set<number>());
        families.get(sig)!.add(idx);
      }
    }

    const orderedFamilies = [...families.entries()]
      .map(([sig, members]) => ({ sig, members: [...members] }))
      .filter((x) => x.members.length >= 2)
      .sort((a, b) => b.members.length - a.members.length);

    for (const fam of orderedFamilies) {
      const fixedCounts = new Map<number, number>();
      if (fam.sig.length > 0) {
        for (const part of fam.sig.split("|")) {
          const [idRaw, cRaw] = part.split("^");
          const id = Number(idRaw);
          const c = Number(cRaw);
          if (Number.isFinite(id) && Number.isFinite(c) && c > 0) {
            fixedCounts.set(id, c);
          }
        }
      }

      let fixedTotal = 0;
      for (const c of fixedCounts.values()) fixedTotal += c;
      if (fixedTotal !== keepCount) continue;

      const memberIndexes = fam.members.filter((i) => !usedComboIndexes.has(i));
      if (memberIndexes.length < 2) continue;

      const freeSet = new Set<number>();
      const residualKeys = new Set<string>();
      const validMembers: number[] = [];
      const residualMaps = new Map<number, Map<number, number>>();

      for (const i of memberIndexes) {
        const residual = residualAfterFixed(countMaps[i], fixedCounts);
        if (!residual) continue;
        residualMaps.set(i, residual);
        const key = residualKeyWithoutReplacement(residual, freePickCount);
        if (!key) continue;
        residualKeys.add(key);
        validMembers.push(i);
        for (const [id, c] of residual) {
          if (c > 0) freeSet.add(id);
        }
      }

      if (validMembers.length < 2) continue;
      const n = freeSet.size;
      if (n < freePickCount + 1) continue;
      const expected = nCk(n, freePickCount);
      let matchedMode: "without-replacement" | "with-replacement" | null = null;
      let matchedMembers = validMembers;
      let matchedFreeIds = [...freeSet];

      if (residualKeys.size === expected && validMembers.length === expected) {
        matchedMode = "without-replacement";
      } else {
        const withReplacementKeys = new Set<string>();
        const withReplacementMembers: number[] = [];
        const withReplacementFreeSet = new Set<number>();
        for (const i of memberIndexes) {
          const residual = residualMaps.get(i) ?? residualAfterFixed(countMaps[i], fixedCounts);
          if (!residual) continue;
          const key = residualKeyWithReplacement(residual, freePickCount);
          if (!key) continue;
          withReplacementKeys.add(key);
          withReplacementMembers.push(i);
          for (const [id, c] of residual) {
            if (c > 0) withReplacementFreeSet.add(id);
          }
        }

        const withReplacementExpected = nHk(withReplacementFreeSet.size, freePickCount);
        if (
          withReplacementFreeSet.size >= 2 &&
          withReplacementKeys.size === withReplacementExpected &&
          withReplacementMembers.length === withReplacementExpected
        ) {
          matchedMode = "with-replacement";
          matchedMembers = withReplacementMembers;
          matchedFreeIds = [...withReplacementFreeSet];
        } else if (freePickCount === 2) {
          // Try extracting the largest loop-complete clique subset.
          const loops = new Set<number>();
          const adjacency = new Map<number, Set<number>>();
          for (const i of memberIndexes) {
            const residual = residualMaps.get(i) ?? residualAfterFixed(countMaps[i], fixedCounts);
            if (!residual) continue;
            const key = residualKeyWithReplacement(residual, freePickCount);
            if (!key) continue;
            const parts = key.split(",").map(Number);
            if (parts.length !== 2) continue;
            const [a, b] = parts;
            if (!adjacency.has(a)) adjacency.set(a, new Set<number>());
            if (!adjacency.has(b)) adjacency.set(b, new Set<number>());
            adjacency.get(a)!.add(b);
            adjacency.get(b)!.add(a);
            if (a === b) loops.add(a);
          }

          let clique = [...loops].sort((a, b) => a - b);
          let changed = true;
          while (changed) {
            changed = false;
            const next: number[] = [];
            for (const node of clique) {
              const neighbors = adjacency.get(node) ?? new Set<number>();
              let ok = true;
              for (const other of clique) {
                if (other === node) continue;
                if (!neighbors.has(other)) {
                  ok = false;
                  break;
                }
              }
              if (ok) next.push(node);
              else changed = true;
            }
            clique = next;
          }

          if (clique.length >= 2) {
            const cliqueSet = new Set(clique);
            const cliqueMembers: number[] = [];
            const cliqueKeys = new Set<string>();
            for (const i of memberIndexes) {
              const residual = residualMaps.get(i) ?? residualAfterFixed(countMaps[i], fixedCounts);
              if (!residual) continue;
              const key = residualKeyWithReplacement(residual, freePickCount);
              if (!key) continue;
              const parts = key.split(",").map(Number);
              if (parts.every((id) => cliqueSet.has(id))) {
                cliqueMembers.push(i);
                cliqueKeys.add(key);
              }
            }
            const cliqueExpected = nHk(clique.length, freePickCount);
            if (
              cliqueMembers.length === cliqueExpected &&
              cliqueKeys.size === cliqueExpected
            ) {
              matchedMode = "with-replacement";
              matchedMembers = cliqueMembers;
              matchedFreeIds = clique;
            }
          }
        }
      }

      if (!matchedMode) continue;

      const fixedItems: MstSlotItemData[] = [];
      for (const [itemId, count] of [...fixedCounts.entries()].sort((a, b) => a[0] - b[0])) {
        const item = itemLookup.get(itemId);
        if (!item) continue;
        for (let n2 = 0; n2 < count; n2++) fixedItems.push(item);
      }
      if (fixedItems.length !== keepCount) continue;

      const freePool = [...matchedFreeIds]
        .map((id) => itemLookup.get(id))
        .filter((it): it is MstSlotItemData => it != null)
        .sort((a, b) => a.sortno - b.sortno || a.id - b.id);
      if (freePool.length !== matchedFreeIds.length) continue;

      const mergedShips = new Set<number>();
      for (const i of matchedMembers) {
        for (const shipId of group[i].ships ?? []) mergedShips.add(shipId);
      }

      out.push({
        kind: "pool",
        pool: [...fixedItems, ...freePool],
        comboSize,
        correction: group[0].netStats,
        fixed: fixedItems,
        freePool,
        freePoolWithReplacement: matchedMode === "with-replacement",
        freePickCount,
        ships: group[0].ships != null ? [...mergedShips].sort((a, b) => a - b) : group[0].ships,
      });

      for (const i of matchedMembers) usedComboIndexes.add(i);
    }

    if (freePickCount === 2) {
      const remainingFamilies = new Map<string, Set<number>>();
      for (let idx = 0; idx < countMaps.length; idx++) {
        if (usedComboIndexes.has(idx)) continue;
        const fixedSigs = enumerateFixedSigs(countMaps[idx], keepCount);
        for (const sig of fixedSigs) {
          if (!remainingFamilies.has(sig)) remainingFamilies.set(sig, new Set<number>());
          remainingFamilies.get(sig)!.add(idx);
        }
      }

      for (const [sig, memberSet] of remainingFamilies.entries()) {
        const memberIndexes = [...memberSet].filter((i) => !usedComboIndexes.has(i));
        if (memberIndexes.length < 4) continue;
        const fixedCounts = new Map<number, number>();
        if (sig.length > 0) {
          for (const part of sig.split("|")) {
            const [idRaw, cRaw] = part.split("^");
            const id = Number(idRaw);
            const c = Number(cRaw);
            if (Number.isFinite(id) && Number.isFinite(c) && c > 0) fixedCounts.set(id, c);
          }
        }
        let fixedTotal = 0;
        for (const c of fixedCounts.values()) fixedTotal += c;
        if (fixedTotal !== keepCount) continue;

        const categoryEntry = tryBuildBipartiteCategory(memberIndexes, fixedCounts);
        if (!categoryEntry) continue;
        out.push(categoryEntry);
        for (const i of memberIndexes) usedComboIndexes.add(i);
      }
    }
  }

  for (let i = 0; i < group.length; i++) {
    if (!usedComboIndexes.has(i)) out.push(group[i]);
  }

  // Fallback: if many explicit combos still remain, group them into a single
  // summary entry to reduce card count/DOM size on detail panels.
  const remainingCombos = out.filter((e): e is MultiComboEntry => e.kind === "combo");
  if (remainingCombos.length >= 8) {
    const groupedPools: MstSlotItemData[][] = [];
    const mergedShips = new Set<number>();
    for (const comboEntry of remainingCombos) {
      for (const shipId of comboEntry.ships ?? []) mergedShips.add(shipId);
      for (const item of comboEntry.combo) groupedPools.push([item]);
    }

    const nonComboEntries = out.filter((e) => e.kind !== "combo");
    nonComboEntries.push({
      kind: "grouped_combo",
      groupedPools,
      netStats: group[0].netStats,
      ships:
        group[0].ships != null
          ? [...mergedShips].sort((a, b) => a - b)
          : group[0].ships,
    });
    return nonComboEntries;
  }

  return out;
}

export function mergeMultiEntries(entries: MultiEntry[]): MultiEntry[] {
  const merged: MultiEntry[] = [];
  const categoryGroups = new Map<string, MultiCategoryEntry[]>();
  const poolGroups = new Map<string, MultiPoolEntry[]>();
  const comboGroups = new Map<string, MultiComboEntry[]>();
  
  for (const entry of entries) {
    if (entry.kind === "category") {
      if (entry.is_implicant) {
        merged.push(entry);
        continue;
      }
      const sig = synergySignature(entry.correction) + (entry.cancels_single ? "|C" : "") + `|len:${entry.pools.length}`;
      if (!categoryGroups.has(sig)) categoryGroups.set(sig, []);
      categoryGroups.get(sig)!.push(entry);
    } else if (entry.kind === "pool") {
      const fixedKey = (entry.fixed ?? [])
        .map((x) => x.id)
        .sort((a, b) => a - b)
        .join(",");
      const sig =
        synergySignature(entry.correction) +
        `|k:${entry.comboSize}|f:${fixedKey}|r:${entry.freePoolWithReplacement ? 1 : 0}|p:${entry.freePickCount ?? -1}`;
      if (!poolGroups.has(sig)) poolGroups.set(sig, []);
      poolGroups.get(sig)!.push(entry);
    } else if (entry.kind === "combo") {
      const sig = `${synergySignature(entry.netStats)}|k:${entry.combo.length}`;
      if (!comboGroups.has(sig)) comboGroups.set(sig, []);
      comboGroups.get(sig)!.push(entry);
    } else {
      merged.push(entry);
    }
  }

  for (const group of comboGroups.values()) {
    merged.push(...compactComboGroupToPool(group));
  }

  for (const group of poolGroups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    const mergedPoolById = new Map<number, MstSlotItemData>();
    const mergedFreePoolById = new Map<number, MstSlotItemData>();
    const mergedShips = new Set<number>();

    for (const entry of group) {
      for (const item of entry.pool) mergedPoolById.set(item.id, item);
      if (entry.freePool) {
        for (const item of entry.freePool) mergedFreePoolById.set(item.id, item);
      }
      for (const shipId of entry.ships ?? []) mergedShips.add(shipId);
    }

    const sample = group[0];
    merged.push({
      ...sample,
      pool: [...mergedPoolById.values()].sort((a, b) => a.sortno - b.sortno || a.id - b.id),
      freePool:
        sample.freePool != null
          ? [...mergedFreePoolById.values()].sort((a, b) => a.sortno - b.sortno || a.id - b.id)
          : sample.freePool,
      ships: sample.ships != null ? [...mergedShips].sort((a, b) => a - b) : sample.ships,
    });
  }

  for (const group of categoryGroups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    
    const poolCount = group[0].pools.length;
    const unionedPools: MstSlotItemData[][] = Array.from({ length: poolCount }, () => []);
    
    for (const entry of group) {
      const sortedPools = [...entry.pools].sort((a, b) => {
        if (a.length !== b.length) return a.length - b.length;
        const minA = Math.min(...a.map((x) => x.id));
        const minB = Math.min(...b.map((x) => x.id));
        return minA - minB;
      });
      
      for (let i = 0; i < poolCount; i++) {
        for (const item of sortedPools[i]) {
          if (!unionedPools[i].find((x) => x.id === item.id)) {
            unionedPools[i].push(item);
          }
        }
      }
    }
    
    for (const p of unionedPools) {
      p.sort((a, b) => a.sortno - b.sortno || a.id - b.id);
    }
    
    merged.push({
      kind: "category",
      pools: unionedPools,
      cancels_single: group[0].cancels_single,
      correction: group[0].correction,
      ships: group[0].ships
    });
  }
  
  return merged;
}

// ── normalizeEffects / normalizeCrossEffects ─────────────────────────

const _normalizeEffectsCache = new WeakMap<
  SlotItemEffectsData,
  Record<string, EquipEffect[]>
>();

export function normalizeEffects(
  data: SlotItemEffectsData,
): Record<string, EquipEffect[]> {
  const cached = _normalizeEffectsCache.get(data);
  if (cached) return cached;

  let out: Record<string, EquipEffect[]>;
  if (data.effect_rules && data.effect_rules.length > 0) {
    out = {};
    for (const rule of data.effect_rules) {
      const entry: EquipEffect = {
        ships: rule.ships,
        b: rule.b,
        l: rule.l,
        i: rule.i,
        c2: rule.c2,
        c3: rule.c3,
      };
      for (const itemId of rule.items) {
        const key = String(itemId);
        if (!out[key]) out[key] = [];
        out[key].push(entry);
      }
    }
  } else {
    out = data.effects ?? {};
  }

  _normalizeEffectsCache.set(data, out);
  return out;
}

const _normalizeCrossEffectsCache = new WeakMap<
  SlotItemEffectsData,
  Record<string, CrossEffect[]>
>();

export function normalizeCrossEffects(
  data: SlotItemEffectsData,
): Record<string, CrossEffect[]> {
  const cached = _normalizeCrossEffectsCache.get(data);
  if (cached) return cached;

  let out: Record<string, CrossEffect[]>;
  if (data.cross_rules && data.cross_rules.length > 0) {
    out = {};

    // Helper: register a pair (a, b) into the cross-effects map
    const addPair = (a: number, b: number, rule: (typeof data.cross_rules)[0]) => {
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const entry: CrossEffect = {
        ships: rule.ships,
        items: [Math.min(a, b), Math.max(a, b)],
        synergy: rule.synergy,
        exclusive_group: (rule as { exclusive_group?: number }).exclusive_group,
        cancels_single: !!(rule as { cancels_single?: boolean }).cancels_single,
        placements: (rule as { placements?: SlotUsageSummary[] }).placements,
      };
      if (!out[key]) out[key] = [];
      out[key].push(entry);
    };

    for (const rule of data.cross_rules) {
      const r = rule as {
        pairs?: [number, number][];
        implicants?: number[][][];
        category_pools?: number[][];
        item_pool?: number[];
        ships: number[];
        synergy: Record<string, number>;
        exclusive_group?: number;
      };

      if (r.pairs) {
        // Legacy format
        for (const [a, b] of r.pairs) {
          addPair(a, b, rule);
        }
      } else if (r.implicants) {
        // AST format: each implicant is an array of pools [[poolA], [poolB], ...]
        // Pairs come from picking one item from each pool in the implicant
        for (const implicant of r.implicants) {
          if (implicant.length < 2) continue;
          // Register all cross-pool pairs (pool[0] x pool[1], pool[0] x pool[2], etc.)
          for (let pi = 0; pi < implicant.length; pi++) {
            for (let pj = pi + 1; pj < implicant.length; pj++) {
              for (const a of implicant[pi]) {
                for (const b of implicant[pj]) {
                  addPair(a, b, rule);
                }
              }
            }
          }
        }
      } else if (r.category_pools) {
        // AST format: pools[0] x pools[1] x ... cross pairs
        const pools = r.category_pools;
        for (let pi = 0; pi < pools.length; pi++) {
          for (let pj = pi + 1; pj < pools.length; pj++) {
            for (const a of pools[pi]) {
              for (const b of pools[pj]) {
                addPair(a, b, rule);
              }
            }
          }
        }
      } else if (r.item_pool) {
        // All pairs within the pool
        for (let i = 0; i < r.item_pool.length; i++) {
          for (let j = i + 1; j < r.item_pool.length; j++) {
            addPair(r.item_pool[i], r.item_pool[j], rule);
          }
        }
      }
    }
  } else {
    out = data.cross_effects ?? {};
  }

  _normalizeCrossEffectsCache.set(data, out);
  return out;
}


// ── Entry helpers ────────────────────────────────────────────────────

export function getSingleEntriesForEquip(
  effects: SlotItemEffectsData,
  equipId: number,
): EquipEffect[] {
  if (effects.effect_rules_equip_index) {
    const indices = effects.effect_rules_equip_index[String(equipId)] ?? [];
    const indexedEntries = indices.map((i) => {
      const rule = effects.effect_rules![i];
      return {
        ships: rule.ships,
        b: rule.b,
        l: rule.l,
        i: rule.i,
        c2: rule.c2,
        c3: rule.c3,
      };
    });
    if (indexedEntries.length > 0) {
      return indexedEntries;
    }
  }
  return normalizeEffects(effects)[String(equipId)] ?? [];
}

export function getCrossEntriesForEquip(
  effects: SlotItemEffectsData,
  equipId: number,
  shipId?: number,
): CrossEffect[] {
  // Always use normalizeCrossEffects which handles all formats (pairs, implicants, category_pools, item_pool)
  return Object.values(normalizeCrossEffects(effects))
    .flat()
    .filter(
      (entry) =>
        (entry.items[0] === equipId || entry.items[1] === equipId) &&
        (shipId === undefined ||
          entry.ships.length === 0 ||
          entry.ships.includes(shipId)),
    );
}



// ── Multi-item rule helpers ──────────────────────────────────────────

const _comboDisplayCache = new WeakMap<object, number[][]>();

export function decodeCombosForDisplay(
  rule: {
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
  },
  comboSize: number,
): number[][] {
  const cached = _comboDisplayCache.get(rule);
  if (cached) return cached;

  let result: number[][] = [];

  if (rule.item_pool) {
    const pool = rule.item_pool;
    const pick = (start: number, cur: number[]) => {
      if (cur.length === comboSize) {
        result.push([...cur]);
        return;
      }
      for (let i = start; i < pool.length; i++) {
        cur.push(pool[i]);
        pick(i + 1, cur);
        cur.pop();
      }
    };
    pick(0, []);
  } else if (rule.fixed_items && rule.free_pool) {
    const fixed = rule.fixed_items;
    const free = rule.free_pool;
    const neededFree =
      typeof rule.free_pick_count === "number"
        ? rule.free_pick_count
        : comboSize - fixed.length;
    if (rule.free_pool_with_replacement) {
      const pick = (start: number, cur: number[]) => {
        if (cur.length === neededFree) {
          result.push([...fixed, ...cur]);
          return;
        }
        for (let i = start; i < free.length; i++) {
          cur.push(free[i]);
          pick(i, cur);
          cur.pop();
        }
      };
      pick(0, []);
    } else {
      const pick = (start: number, cur: number[]) => {
        if (cur.length === neededFree) {
          result.push([...fixed, ...cur]);
          return;
        }
        for (let i = start; i < free.length; i++) {
          cur.push(free[i]);
          pick(i + 1, cur);
          cur.pop();
        }
      };
      pick(0, []);
    }
  } else if (rule.combos_b64 && rule.items) {
    const buf = Uint8Array.from(atob(rule.combos_b64), (c) => c.charCodeAt(0));
    const totalCount = buf.length / comboSize;
    for (let ci = 0; ci < totalCount; ci++) {
      const combo: number[] = [];
      for (let j = 0; j < comboSize; j++)
        combo.push(rule.items[buf[ci * comboSize + j]]);
      result.push(combo);
    }
  } else if (rule.combos_u16_b64 && rule.items) {
    const raw = Uint8Array.from(atob(rule.combos_u16_b64), (c) => c.charCodeAt(0));
    const buf = new Uint16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
    const totalCount = buf.length / comboSize;
    for (let ci = 0; ci < totalCount; ci++) {
      const combo: number[] = [];
      for (let j = 0; j < comboSize; j++)
        combo.push(rule.items[buf[ci * comboSize + j]]);
      result.push(combo);
    }
  } else if (rule.combos_u32_b64 && rule.items) {
    const raw = Uint8Array.from(atob(rule.combos_u32_b64), (c) => c.charCodeAt(0));
    const buf = new Uint32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
    const totalCount = buf.length / comboSize;
    for (let ci = 0; ci < totalCount; ci++) {
      const combo: number[] = [];
      for (let j = 0; j < comboSize; j++)
        combo.push(rule.items[buf[ci * comboSize + j]]);
      result.push(combo);
    }
  } else if (rule.combos) {
    result = rule.combos;
  }

  _comboDisplayCache.set(rule, result);
  return result;
}

export function comboBaseBonus(
  shipId: number,
  comboIds: number[],
  effectsMap: Record<string, EquipEffect[]>,
  crossMap: Record<string, CrossEffect[]>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const appliesToShip = (ships: number[]): boolean =>
    !ships.length || ships.includes(shipId);

  for (const id of comboIds) {
    const entry = (effectsMap[String(id)] ?? []).find((e) =>
      appliesToShip(e.ships),
    );
    if (!entry) continue;
    for (const [k, v] of Object.entries(entry.b ?? {})) {
      if (v) out[k] = (out[k] || 0) + v;
    }
  }

  for (let i = 0; i < comboIds.length; i++) {
    for (let j = i + 1; j < comboIds.length; j++) {
      const a = Math.min(comboIds[i], comboIds[j]);
      const b = Math.max(comboIds[i], comboIds[j]);
      const crossEntry = (crossMap[`${a}:${b}`] ?? []).find((e) =>
        appliesToShip(e.ships),
      );
      if (!crossEntry) continue;
      for (const [k, v] of Object.entries(crossEntry.synergy ?? {})) {
        if (v) out[k] = (out[k] || 0) + v;
      }
    }
  }
  return out;
}

// ── Stat formatting ──────────────────────────────────────────────────

export function toSynergyStatRows(
  stats: Record<string, number> | undefined,
): SynergyStatRows {
  if (!stats) return [];
  const rows: SynergyStatRows = [];
  for (const key of SYNERGY_STAT_ORDER) {
    const value = stats[key];
    if (!value) continue;
    rows.push({ key, label: SYNERGY_STAT_LABELS[key] ?? key, value });
  }
  for (const [key, value] of Object.entries(stats)) {
    if (
      !value ||
      SYNERGY_STAT_ORDER.includes(key as (typeof SYNERGY_STAT_ORDER)[number])
    )
      continue;
    rows.push({ key, label: SYNERGY_STAT_LABELS[key] ?? key, value });
  }
  return rows;
}

export function splitSynergyStatRows(rows: SynergyStatRows): {
  core: SynergyStatRows;
  mobility: SynergyStatRows;
} {
  const core: SynergyStatRows = [];
  const mobility: SynergyStatRows = [];
  for (const row of rows) {
    if (MOBILITY_SYNERGY_KEYS.has(row.key)) {
      mobility.push(row);
      continue;
    }
    core.push(row);
  }
  return { core, mobility };
}

export function scoreSynergy(stats: Record<string, number> | undefined): number {
  if (!stats) return 0;
  return Object.values(stats).reduce(
    (sum, value) => sum + Math.abs(value || 0),
    0,
  );
}

export function synergySignature(stats: Record<string, number> | undefined): string {
  const rows = toSynergyStatRows(stats);
  return rows.map((row) => `${row.key}:${row.value}`).join("|");
}

export function stackingSynergyRows(
  c2: Record<string, number> | null | undefined,
  c3: Record<string, number> | null | undefined,
): Array<{ label: string; stats: Record<string, number> }> {
  const hasC2 = scoreSynergy(c2 ?? undefined) > 0;
  const hasC3 = scoreSynergy(c3 ?? undefined) > 0;
  if (!hasC2 && !hasC3) return [];
  if (
    hasC2 &&
    hasC3 &&
    synergySignature(c2 ?? undefined) === synergySignature(c3 ?? undefined)
  ) {
    return [{ label: "2積み以上", stats: c2! }];
  }
  return [
    ...(hasC2 ? [{ label: "2積み", stats: c2! }] : []),
    ...(hasC3 ? [{ label: "3積み以上", stats: c3! }] : []),
  ];
}

export function improvementSynergyRows(
  star10: Record<string, number> | null | undefined,
  transitions:
    | Array<[number, Record<string, number>]>
    | null
    | undefined,
): ImprovementSynergyRow[] {
  const points: Array<{ star: number; stats: Record<string, number> }> = [];

  if (Array.isArray(transitions)) {
    const normalized = transitions
      .filter(
        (entry): entry is [number, Record<string, number>] =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          Number.isFinite(entry[0]) &&
          entry[0] >= 0 &&
          entry[0] <= 10 &&
          scoreSynergy(entry[1]) > 0,
      )
      .sort((a, b) => a[0] - b[0]);

    // Keep last transition when multiple entries have same star.
    for (const [star, stats] of normalized) {
      if (points.length > 0 && points[points.length - 1].star === star) {
        points[points.length - 1] = { star, stats };
        continue;
      }
      points.push({ star, stats });
    }
  }

  if (star10 != null && scoreSynergy(star10) > 0) {
    const last = points[points.length - 1];
    if (!last || last.star < 10) {
      if (!last || synergySignature(last.stats) !== synergySignature(star10)) {
        points.push({ star: 10, stats: star10 });
      }
    }
  }

  if (points.length === 0) return [];

  const rows: ImprovementSynergyRow[] = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[i + 1];
    const start = current.star;
    const end = Math.min(10, next ? next.star - 1 : 10);
    if (end < start) continue;
    rows.push({
      label: start === end ? `改修★${start}` : `改修★${start}~${end}`,
      stats: current.stats,
    });
  }
  return rows;
}

// ── Grouping helpers ─────────────────────────────────────────────────

export function primaryStatKey(stats: Record<string, number>): string {
  for (const k of SYNERGY_STAT_ORDER) {
    if ((stats[k] ?? 0) > 0) return k;
  }
  for (const [k, v] of Object.entries(stats)) {
    if (v > 0) return k;
  }
  return "other";
}

export function groupByMultiStat(entries: MultiEntry[]): MultiGroup[] {
  const map = new Map<string, MultiEntry[]>();
  for (const entry of entries) {
    const stats =
      entry.kind === "combo" || entry.kind === "grouped_combo"
        ? entry.netStats
        : entry.correction;
    const key = primaryStatKey(stats);
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  const result: MultiGroup[] = [];
  const ordered = [...(SYNERGY_STAT_ORDER as unknown as string[]), "other"];
  for (const k of ordered) {
    const list = map.get(k);
    if (!list) continue;
    list.sort((a, b) => {
      const sa = scoreSynergy(
        a.kind === "combo" || a.kind === "grouped_combo"
          ? a.netStats
          : a.correction,
      );
      const sb = scoreSynergy(
        b.kind === "combo" || b.kind === "grouped_combo"
          ? b.netStats
          : b.correction,
      );
      return sb - sa;
    });
    result.push({
      statKey: k,
      label: SYNERGY_STAT_LABELS[k] ?? k,
      entries: list,
    });
    map.delete(k);
  }
  for (const [k, list] of map) {
    result.push({
      statKey: k,
      label: SYNERGY_STAT_LABELS[k] ?? k,
      entries: list,
    });
  }
  return result;
}

export function groupByGenericStat<T>(
  entries: T[],
  getStats: (entry: T) => Record<string, number>,
  getScore: (entry: T) => number,
): SynergyGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const entry of entries) {
    const key = primaryStatKey(getStats(entry));
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  const result: SynergyGroup<T>[] = [];
  const ordered = [...(SYNERGY_STAT_ORDER as unknown as string[]), "other"];
  for (const k of ordered) {
    const list = map.get(k);
    if (!list) continue;
    list.sort((a, b) => getScore(b) - getScore(a));
    result.push({
      statKey: k,
      label: SYNERGY_STAT_LABELS[k] ?? k,
      entries: list,
    });
    map.delete(k);
  }
  for (const [k, list] of map) {
    list.sort((a, b) => getScore(b) - getScore(a));
    result.push({
      statKey: k,
      label: SYNERGY_STAT_LABELS[k] ?? k,
      entries: list,
    });
  }
  return result;
}

export function groupByEquipType<T>(
  entries: T[],
  getEquip: (entry: T) => MstSlotItemData,
  getScore: (entry: T) => number,
): SynergyGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const entry of entries) {
    const equip = getEquip(entry);
    const key = equipDisplayTypeName(equip);
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  const result: SynergyGroup<T>[] = [];
  const ordered = Array.from(map.keys()).sort();
  for (const k of ordered) {
    const list = map.get(k)!;
    list.sort((a, b) => getScore(b) - getScore(a));
    result.push({
      statKey: k,
      label: k,
      entries: list,
    });
  }
  return result;
}

// ── Compatibility helpers ────────────────────────────────────────────

export type CompatibilityMeta = {
  normalSlots: number[];
  exslot: EquipSelectionRequirement | null;
};

export function getCompatibilityMeta(
  ship: MstShipData,
  equip: MstSlotItemData,
): CompatibilityMeta {
  const normalSlots =
    ship.slot_num > 0 ? getNormalSlotAllowedIndexes(ship.id, equip) : [];
  const exslotList = filterForExslot(ship.id, [equip]);
  const exslotReq =
    exslotList && exslotList.length > 0
      ? getExslotSelectionRequirement(ship.id, equip)
      : null;

  return {
    normalSlots,
    exslot: exslotReq,
  };
}

// ── Multi-entry builder helpers ──────────────────────────────────────

export function buildMultiEntries(
  rules: Array<TripleRule | QuadRule | PentaRule> | undefined,
  comboSize: number,
  shipId: number,
  appliesToShip: (ships: number[] | null | undefined) => boolean,
  effectsData: SlotItemEffectsData,
): MultiEntry[] {
  if (!rules) return [];
  const all: MultiEntry[] = [];
  const _em = normalizeEffects(effectsData);
  const _cm = normalizeCrossEffects(effectsData);
  for (const rule of rules) {
    if (!appliesToShip(rule.ships)) continue;
    if (rule.category_pools) {
      if (rule.cancels_single) continue;
      const pools = rule.category_pools.map((p) =>
        p
          .map((id) => getMasterSlotItem(id))
          .filter(
            (it): it is MstSlotItemData =>
              it != null && it.id < ENEMY_ID_THRESHOLD,
          ),
      );
      if (pools.some((p) => p.length === 0)) continue;
      if (scoreSynergy(rule.synergy) === 0) continue;
      all.push({
        kind: "category",
        pools,
        cancels_single: !!rule.cancels_single,
        correction: rule.synergy,
        placements: rule.placements,
      });
    } else if (rule.item_pool) {
      if (rule.cancels_single) continue;
      const pool = rule.item_pool
        .map((id) => getMasterSlotItem(id))
        .filter(
          (it): it is MstSlotItemData =>
            it != null && it.id < ENEMY_ID_THRESHOLD,
        );
      if (pool.length < comboSize) continue;
      if (scoreSynergy(rule.synergy) === 0) continue;
      all.push({ kind: "pool", pool, comboSize, correction: rule.synergy, placements: rule.placements });
    } else if (rule.fixed_items && rule.free_pool) {
      if (rule.cancels_single) continue;
      const allPoolIds = [...rule.fixed_items, ...rule.free_pool];
      const pool = allPoolIds
        .map((id) => getMasterSlotItem(id))
        .filter(
          (it): it is MstSlotItemData =>
            it != null && it.id < ENEMY_ID_THRESHOLD,
        );
      if (pool.length < comboSize) continue;
      if (scoreSynergy(rule.synergy) === 0) continue;
      all.push({ kind: "pool", pool, comboSize, correction: rule.synergy, placements: rule.placements });
    } else if (rule.implicants) {
      if (rule.cancels_single) continue;
      for (const implicant of rule.implicants) {
        const pools = implicant.map((p) =>
          p
            .map((id) => getMasterSlotItem(id))
            .filter(
              (it): it is MstSlotItemData =>
                it != null && it.id < ENEMY_ID_THRESHOLD,
            ),
        );
        if (pools.some((p) => p.length === 0)) continue;
        if (scoreSynergy(rule.synergy) === 0) continue;
        all.push({
          kind: "category",
          pools,
          cancels_single: !!rule.cancels_single,
          correction: rule.synergy,
          is_implicant: true,
          placements: rule.placements,
        });
      }
    } else {
      if (rule.cancels_single) continue;
      const combos = decodeCombosForDisplay(rule, comboSize);
      for (const comboIds of combos) {
        const items = comboIds.map((id) => getMasterSlotItem(id));
        if (items.some((it) => !it || it.id >= ENEMY_ID_THRESHOLD))
          continue;
        
        if (scoreSynergy(rule.synergy) === 0) continue;
        
        all.push({
          kind: "combo",
          combo: items as MstSlotItemData[],
          netStats: rule.synergy,
          placements: rule.placements,
        });
      }
    }
  }
  return all;
}

export function groupItemsByIcon(items: MstSlotItemData[]) {
  const groups = new Map<number, MstSlotItemData[]>();
  for (const item of items) {
    const icon = item.type?.[3] ?? 0;
    if (!groups.has(icon)) groups.set(icon, []);
    groups.get(icon)!.push(item);
  }
  return Array.from(groups.values());
}
