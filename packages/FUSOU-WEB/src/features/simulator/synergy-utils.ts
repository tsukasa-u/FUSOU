/**
 * Synergy calculation logic — pure functions with no DOM dependencies.
 * Shared between ShipDetailPanel and EquipDetailPanel.
 */

import type {
  MstSlotItemData,
  SlotItemEffectsData,
  EquipEffect,
  CrossEffect,
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
};

export const DEFAULT_EXPAND_SETTINGS: ListExpandSettings = {
  expandEquippableEquip: false,
  expandSingleSynergy: false,
  expandPairSynergy: false,
  expandMultiSynergy: false,
  expandSynergyShips: false,
  expandCompatibleShips: false,
  showMultiSynergy: true,
};

// Multi-item synergy display types
export type MultiComboEntry = {
  kind: "combo";
  combo: MstSlotItemData[];
  netStats: Record<string, number>;
  ships?: number[];
};
export type MultiPoolEntry = {
  kind: "pool";
  pool: MstSlotItemData[];
  comboSize: number;
  correction: Record<string, number>;
  ships?: number[];
};
export type MultiCategoryEntry = {
  kind: "category";
  pools: MstSlotItemData[][];
  cancels_single: boolean;
  correction: Record<string, number>;
  ships?: number[];
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
    for (const rule of data.cross_rules) {
      for (const [a, b] of rule.pairs) {
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        const entry: CrossEffect = {
          ships: rule.ships,
          items: [Math.min(a, b), Math.max(a, b)],
          synergy: rule.synergy,
        };
        if (!out[key]) out[key] = [];
        out[key].push(entry);
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
): CrossEffect[] {
  if (effects.cross_rules_equip_index) {
    const indices = effects.cross_rules_equip_index[String(equipId)] ?? [];
    const out: CrossEffect[] = [];
    for (const i of indices) {
      const rule = effects.cross_rules![i];
      for (const [a, b] of rule.pairs) {
        if (a === equipId || b === equipId) {
          out.push({
            ships: rule.ships,
            items: [a, b],
            synergy: rule.synergy,
          });
        }
      }
    }
    if (out.length > 0) {
      return out;
    }
  }
  return Object.values(normalizeCrossEffects(effects))
    .flat()
    .filter(
      (entry) => entry.items[0] === equipId || entry.items[1] === equipId,
    );
}

// ── Multi-item rule helpers ──────────────────────────────────────────

const _comboDisplayCache = new WeakMap<object, number[][]>();

export function decodeCombosForDisplay(
  rule: {
    item_pool?: number[];
    fixed_items?: number[];
    free_pool?: number[];
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
    const neededFree = comboSize - fixed.length;
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
      });
    } else if (rule.item_pool) {
      const pool = rule.item_pool
        .map((id) => getMasterSlotItem(id))
        .filter(
          (it): it is MstSlotItemData =>
            it != null && it.id < ENEMY_ID_THRESHOLD,
        );
      if (pool.length < comboSize) continue;
      if (scoreSynergy(rule.synergy) === 0) continue;
      all.push({ kind: "pool", pool, comboSize, correction: rule.synergy });
    } else if (rule.fixed_items && rule.free_pool) {
      const allPoolIds = [...rule.fixed_items, ...rule.free_pool];
      const pool = allPoolIds
        .map((id) => getMasterSlotItem(id))
        .filter(
          (it): it is MstSlotItemData =>
            it != null && it.id < ENEMY_ID_THRESHOLD,
        );
      if (pool.length < comboSize) continue;
      if (scoreSynergy(rule.synergy) === 0) continue;
      all.push({ kind: "pool", pool, comboSize, correction: rule.synergy });
    } else if (rule.implicants) {
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
        });
      }
    } else {
      const combos = decodeCombosForDisplay(rule, comboSize);
      for (const comboIds of combos) {
        const items = comboIds.map((id) => getMasterSlotItem(id));
        if (items.some((it) => !it || it.id >= ENEMY_ID_THRESHOLD))
          continue;
        const base = comboBaseBonus(shipId, comboIds, _em, _cm);
        for (const [k, v] of Object.entries(rule.synergy)) {
          if (v) base[k] = (base[k] || 0) + v;
        }
        if (scoreSynergy(base) > 0) {
          all.push({
            kind: "combo",
            combo: items as MstSlotItemData[],
            netStats: base,
          });
        }
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
