/** @jsxImportSource solid-js */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  onCleanup,
  type JSX,
} from "solid-js";
import { render, Portal } from "solid-js/web";
import {
  bannerUrl,
  cardUrl,
  createWeaponIconEl,
  equipImageUrl,
  intersectSorted,
} from "@/features/simulator/equip-calc";
import { cachedFetch } from "@/utils/fetchCache";
import { buildShareDetailUrl, copyTextWithFallback } from "@/utils/share-url";
import { ShipListRow } from "@/components/common/solid/ship-list-row";
import {
  filterForExslot,
  getExslotSelectionRequirement,
  getNormalSlotAllowedIndexes,
  type EquipSelectionRequirement,
} from "@/features/simulator/equip-filter";
import {
  getMasterShip,
  getMasterShips,
  getMasterSlotItem,
  getMasterSlotItems,
  getSlotItemEffects,
  getSokuSpeedData,
  hasMasterData,
} from "@/features/simulator/simulator-selectors";
import {
  ENEMY_ID_THRESHOLD,
  EQUIP_TYPE_NAMES,
  RANGE_NAMES,
  SPEED_NAMES,
  STYPE_NAMES,
} from "@/features/simulator/constants";

import type {
  MstShipData,
  MstSlotItemData,
  SlotItemEffectsData,
  EquipEffect,
  CrossEffect,
  TripleRule,
  QuadRule,
  PentaRule,
} from "@/features/simulator/types";

type DetailsTab = "ship" | "equip";

type ShipGrowthSummary = {
  ok: boolean;
  periods?: Array<{ period_tag: string; table_version: string }>;
};

type ShipGrowthCaps = {
  master_id: number;
  kaihi_max?: number;
  taisen_max?: number;
  sakuteki_max?: number;
  kaih_max?: number;
  tais_max?: number;
  saku_max?: number;
};

type NormalizedShipGrowthCaps = {
  master_id: number;
  kaihi_max: number;
  taisen_max: number;
  sakuteki_max: number;
};

type ShipGrowthBoundRow = {
  master_id: number;
  lv: number;
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
};

type ShipGrowthBoundsResponse = {
  caps?: ShipGrowthCaps[];
  bounds?: ShipGrowthBoundRow[];
  updated_at?: number;
  updated_at_iso?: string | null;
};

function normalizeShipGrowthCaps(
  raw: ShipGrowthCaps | null,
): NormalizedShipGrowthCaps | null {
  if (!raw) return null;
  return {
    master_id: raw.master_id,
    kaihi_max: Number(raw.kaihi_max ?? raw.kaih_max ?? 0),
    taisen_max: Number(raw.taisen_max ?? raw.tais_max ?? 0),
    sakuteki_max: Number(raw.sakuteki_max ?? raw.saku_max ?? 0),
  };
}

function deriveShipGrowthCapsFromBounds(
  masterId: number,
  bounds: ShipGrowthBoundRow[],
): NormalizedShipGrowthCaps | null {
  if (!Array.isArray(bounds) || bounds.length === 0) return null;

  const kaihiMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.kaihi_naked || 0)),
  );
  const taisenMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.taisen_naked || 0)),
  );
  const sakutekiMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.sakuteki_naked || 0)),
  );

  return {
    master_id: masterId,
    kaihi_max: kaihiMax,
    taisen_max: taisenMax,
    sakuteki_max: sakutekiMax,
  };
}

function mergeShipGrowthCaps(
  primary: NormalizedShipGrowthCaps | null,
  fallback: NormalizedShipGrowthCaps | null,
): NormalizedShipGrowthCaps | null {
  if (!primary && !fallback) return null;
  if (!primary) return fallback;
  if (!fallback) return primary;

  return {
    master_id: primary.master_id,
    kaihi_max: primary.kaihi_max > 0 ? primary.kaihi_max : fallback.kaihi_max,
    taisen_max:
      primary.taisen_max > 0 ? primary.taisen_max : fallback.taisen_max,
    sakuteki_max:
      primary.sakuteki_max > 0 ? primary.sakuteki_max : fallback.sakuteki_max,
  };
}

function statRangeLabel(value: number[] | null | undefined): string {
  if (!value || value.length === 0) return "/";
  if (value.length === 1) return String(value[0]);
  return `${value[0]} / ${value[value.length - 1]}`;
}

function hasStatRange(value: number[] | null | undefined): boolean {
  return Array.isArray(value) && value.length > 0;
}

function needsStatFallback(value: number[] | null | undefined): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.every((v) => !Number.isFinite(v) || v <= 0);
}

function statRangeLabelWithFallback(
  value: number[] | null | undefined,
  fallbackMax: number | null | undefined,
): string {
  if (hasStatRange(value) && !needsStatFallback(value))
    return statRangeLabel(value);
  if (typeof fallbackMax === "number" && fallbackMax > 0) {
    return `- / ${fallbackMax}`;
  }
  return "-/-";
}

function equipTypeName(typeId: number | null): string {
  if (typeId == null) return "不明";
  return EQUIP_TYPE_NAMES[typeId] ?? `種別${typeId}`;
}

function equipDisplayTypeName(equip: MstSlotItemData): string {
  return equipTypeName(equip.type?.[2] ?? null);
}

function rangeDisplay(value: number | null | undefined): string {
  if (value == null || value === 0) return "-";
  return RANGE_NAMES[value] ?? String(value);
}

function speedDisplay(value: number | null | undefined): string {
  if (value == null) return "-";
  return SPEED_NAMES[value] ?? String(value);
}

function statValueOrDash(value: number | null | undefined): string | number {
  return value == null || value === 0 ? "-" : value;
}

const _normalizeEffectsCache = new WeakMap<SlotItemEffectsData, Record<string, EquipEffect[]>>();

/**
 * Normalize SlotItemEffectsData to a legacy-style effects dict keyed by itemId string.
 * Supports both old `effects` and new `effect_rules` formats.
 */
function normalizeEffects(
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

const _normalizeCrossEffectsCache = new WeakMap<SlotItemEffectsData, Record<string, CrossEffect[]>>();

/**
 * Normalize SlotItemEffectsData to a legacy-style cross_effects dict keyed by "a:b".
 * Supports both old `cross_effects` and new `cross_rules` formats.
 */
function normalizeCrossEffects(
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

// ── Multi-item rule helpers ──────────────────────────────────────────

/** WeakMap cache: rule object → decoded combo arrays (all combos, ID arrays). */
const _comboDisplayCache = new WeakMap<object, number[][]>();

/**
 * Decode a multi-item rule into an array of combos (each combo = array of item IDs).
 * Returns at most `maxCombos` entries. Results are cached per rule object.
 */
function decodeCombosForDisplay(
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
  maxCombos = 500,
): number[][] {
  const cached = _comboDisplayCache.get(rule);
  if (cached)
    return cached.length <= maxCombos ? cached : cached.slice(0, maxCombos);

  let result: number[][];

  if (rule.item_pool) {
    const pool = rule.item_pool;
    result = [];
    const pick = (start: number, cur: number[]) => {
      if (cur.length === comboSize) {
        result.push([...cur]);
        return;
      }
      if (result.length >= maxCombos) return;
      for (let i = start; i < pool.length; i++) {
        cur.push(pool[i]);
        pick(i + 1, cur);
        cur.pop();
        if (result.length >= maxCombos) return;
      }
    };
    pick(0, []);
  } else if (rule.fixed_items && rule.free_pool) {
    // Enumerate all C(free_pool, comboSize - fixed_items.length), prepend fixed items.
    const fixed = rule.fixed_items;
    const free = rule.free_pool;
    const neededFree = comboSize - fixed.length;
    result = [];
    const pick = (start: number, cur: number[]) => {
      if (cur.length === neededFree) {
        result.push([...fixed, ...cur]);
        return;
      }
      if (result.length >= maxCombos) return;
      for (let i = start; i < free.length; i++) {
        cur.push(free[i]);
        pick(i + 1, cur);
        cur.pop();
        if (result.length >= maxCombos) return;
      }
    };
    pick(0, []);
  } else if (rule.combos_b64 && rule.items) {
    const buf = Uint8Array.from(atob(rule.combos_b64), (c) => c.charCodeAt(0));
    const totalCount = buf.length / comboSize;
    const count = Math.min(totalCount, maxCombos);
    result = [];
    for (let ci = 0; ci < count; ci++) {
      const combo: number[] = [];
      for (let j = 0; j < comboSize; j++)
        combo.push(rule.items[buf[ci * comboSize + j]]);
      result.push(combo);
    }
  } else if (rule.combos_u16_b64 && rule.items) {
    const raw = Uint8Array.from(atob(rule.combos_u16_b64), (c) =>
      c.charCodeAt(0),
    );
    const buf = new Uint16Array(
      raw.buffer,
      raw.byteOffset,
      Math.floor(raw.byteLength / 2),
    );
    const totalCount = buf.length / comboSize;
    const count = Math.min(totalCount, maxCombos);
    result = [];
    for (let ci = 0; ci < count; ci++) {
      const combo: number[] = [];
      for (let j = 0; j < comboSize; j++)
        combo.push(rule.items[buf[ci * comboSize + j]]);
      result.push(combo);
    }
  } else if (rule.combos_u32_b64 && rule.items) {
    const raw = Uint8Array.from(atob(rule.combos_u32_b64), (c) =>
      c.charCodeAt(0),
    );
    const buf = new Uint32Array(
      raw.buffer,
      raw.byteOffset,
      Math.floor(raw.byteLength / 4),
    );
    const totalCount = buf.length / comboSize;
    const count = Math.min(totalCount, maxCombos);
    result = [];
    for (let ci = 0; ci < count; ci++) {
      const combo: number[] = [];
      for (let j = 0; j < comboSize; j++)
        combo.push(rule.items[buf[ci * comboSize + j]]);
      result.push(combo);
    }
  } else {
    result = (rule.combos ?? []).slice(0, maxCombos) as number[][];
  }

  _comboDisplayCache.set(rule, result);
  return result;
}

/**
 * Compute the net aggregate stats for a specific combo of equipment IDs on a ship,
 * summing single-item base bonuses + pairwise cross bonuses for every pair in the combo.
 * The result is the "from-scratch" gain – the rule's own synergy is NOT included here;
 * callers add `rule.synergy` on top to get the true total.
 */
function comboBaseBonus(
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

type ListExpandSettings = {
  expandEquippableEquip: boolean;
  expandSingleSynergy: boolean;
  expandPairSynergy: boolean;
  expandSynergyShips: boolean;
  expandCompatibleShips: boolean;
  /** Whether to show the 3+ equipment multi-synergy section at all. */
  showMultiSynergy: boolean;
};

const DEFAULT_EXPAND_SETTINGS: ListExpandSettings = {
  expandEquippableEquip: false,
  expandSingleSynergy: false,
  expandPairSynergy: false,
  expandSynergyShips: false,
  expandCompatibleShips: false,
  showMultiSynergy: true,
};

const SYNERGY_STAT_LABELS: Record<string, string> = {
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

const SYNERGY_STAT_ORDER = [
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

type SynergyStatRows = Array<{ key: string; label: string; value: number }>;

type MobilitySynergyRow = {
  key: string;
  equip: MstSlotItemData;
  partner: MstSlotItemData | null;
  sourceType: "single" | "pair" | "combo";
  before: number;
  after: number;
};

// ── Multi-item synergy display types ────────────────────────────────
type MultiComboEntry = {
  kind: "combo";
  combo: MstSlotItemData[];
  netStats: Record<string, number>;
};
type MultiPoolEntry = {
  kind: "pool";
  pool: MstSlotItemData[];
  comboSize: number;
  correction: Record<string, number>;
};
type MultiEntry = MultiComboEntry | MultiPoolEntry;
type MultiGroup = { statKey: string; label: string; entries: MultiEntry[] };

const MOBILITY_SYNERGY_KEYS = new Set(["soku", "leng"]);

function toSynergyStatRows(
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

function splitSynergyStatRows(rows: SynergyStatRows): {
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

function scoreSynergy(stats: Record<string, number> | undefined): number {
  if (!stats) return 0;
  return Object.values(stats).reduce(
    (sum, value) => sum + Math.abs(value || 0),
    0,
  );
}

function synergySignature(stats: Record<string, number> | undefined): string {
  const rows = toSynergyStatRows(stats);
  return rows.map((row) => `${row.key}:${row.value}`).join("|");
}

function stackingSynergyRows(
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

function SynergyStatInline(props: {
  stats: Record<string, number>;
}): JSX.Element {
  const rows = createMemo(() => toSynergyStatRows(props.stats));
  const groupedRows = createMemo(() => splitSynergyStatRows(rows()));

  const renderBadgeRows = (badgeRows: SynergyStatRows): JSX.Element => (
    <div class="flex flex-wrap items-center gap-1">
      <For each={badgeRows}>
        {(row) => (
          <span
            class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
              row.value > 0
                ? "border-info/55 text-info"
                : "border-error/45 text-error"
            }`}
          >
            {row.label}
            {row.value > 0 ? `+${row.value}` : row.value}
          </span>
        )}
      </For>
    </div>
  );

  return (
    <Show
      when={rows().length > 0}
      fallback={<span class="text-xs text-base-content/50">効果なし</span>}
    >
      {renderBadgeRows(groupedRows().core)}
    </Show>
  );
}

function groupBy<T>(
  items: T[],
  keyOf: (item: T) => string,
): Array<{ key: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const rows = map.get(key);
    if (rows) rows.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ja"))
    .map(([key, rows]) => ({ key, items: rows }));
}

/** Returns the primary (highest-priority positive-value) stat key for a synergy stats object. */
function primaryStatKey(stats: Record<string, number>): string {
  for (const k of SYNERGY_STAT_ORDER) {
    if ((stats[k] ?? 0) > 0) return k;
  }
  for (const [k, v] of Object.entries(stats)) {
    if (v > 0) return k;
  }
  return "other";
}

/** Group MultiEntry[] by primary stat key, sorted by SYNERGY_STAT_ORDER. */
function groupByMultiStat(entries: MultiEntry[]): MultiGroup[] {
  const map = new Map<string, MultiEntry[]>();
  for (const entry of entries) {
    const stats = entry.kind === "combo" ? entry.netStats : entry.correction;
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
      const sa = scoreSynergy(a.kind === "combo" ? a.netStats : a.correction);
      const sb = scoreSynergy(b.kind === "combo" ? b.netStats : b.correction);
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

function WeaponIcon(props: { iconNum: number }): JSX.Element {
  let host!: HTMLSpanElement;

  createEffect(() => {
    props.iconNum;
    if (!host) return;
    host.replaceChildren(createWeaponIconEl(props.iconNum, 18));
  });

  return <span ref={host} class="inline-flex shrink-0" />;
}

function ImageFallbackBox(props: {
  src: string;
  alt: string;
  class: string;
  fallbackText?: string;
  objectClass?: string;
}): JSX.Element {
  const [errored, setErrored] = createSignal(!props.src);

  createEffect(() => {
    setErrored(!props.src);
  });

  return (
    <div class={`${props.class} overflow-hidden bg-base-200`}>
      <Show
        when={!errored()}
        fallback={
          <div class="w-full h-full flex items-center justify-center text-base-content/20 text-xs">
            {props.fallbackText ?? "No Image"}
          </div>
        }
      >
        <img
          src={props.src}
          alt={props.alt}
          class={props.objectClass ?? "w-full h-full object-cover"}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
        />
      </Show>
    </div>
  );
}

function SpecTable(props: {
  rows: Array<[label: string, value: string | number]>;
}): JSX.Element {
  const pairedRows = createMemo(() => {
    const chunks: Array<Array<[label: string, value: string | number]>> = [];
    for (let index = 0; index < props.rows.length; index += 2) {
      chunks.push(props.rows.slice(index, index + 2));
    }
    return chunks;
  });

  return (
    <div class="overflow-x-auto rounded-xl border border-base-300/70">
      <table class="table table-fixed table-zebra table-sm w-full sm:hidden">
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr>
                <th class="w-28 md:w-36 text-base-content/65 font-medium whitespace-nowrap">
                  {row[0]}
                </th>
                <td class="font-mono text-right md:text-left">{row[1]}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <table class="hidden sm:table table-fixed table-zebra table-sm w-full">
        <tbody>
          <For each={pairedRows()}>
            {(pair) => (
              <tr>
                <th class="w-28 md:w-36 text-base-content/65 font-medium whitespace-nowrap">
                  {pair[0]?.[0]}
                </th>
                <td class="font-mono text-right md:text-left">
                  {pair[0]?.[1]}
                </td>
                <Show
                  when={pair[1]}
                  fallback={
                    <>
                      <th></th>
                      <td></td>
                    </>
                  }
                >
                  <th class="w-28 md:w-36 text-base-content/65 font-medium whitespace-nowrap">
                    {pair[1]?.[0]}
                  </th>
                  <td class="font-mono text-right md:text-left">
                    {pair[1]?.[1]}
                  </td>
                </Show>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

type CompatibilityMeta = {
  normalSlots: number[];
  exslot: EquipSelectionRequirement | null;
};

function formatSlotIndexes(indexes: number[]): string {
  if (indexes.length === 0) return "";

  const ranges: string[] = [];
  let start = indexes[0];
  let end = indexes[0];

  for (let i = 1; i < indexes.length; i += 1) {
    const value = indexes[i];
    if (value === end + 1) {
      end = value;
      continue;
    }
    ranges.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
    start = value;
    end = value;
  }

  ranges.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
  return `${ranges.join(",")}番`;
}

function getCompatibilityMeta(
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

function CompatibilityBadges(props: {
  normalSlots: number[];
  slotCount: number;
  exslot: EquipSelectionRequirement | null;
}): JSX.Element {
  const exslotOnly = createMemo(
    () => props.normalSlots.length === 0 && props.exslot != null,
  );
  const partialNormalSlots = createMemo(() =>
    props.normalSlots.length > 0 && props.normalSlots.length < props.slotCount
      ? formatSlotIndexes(props.normalSlots)
      : null,
  );

  return (
    <span class="ml-auto inline-flex flex-wrap items-center justify-end gap-1 shrink-0">
      <Show when={partialNormalSlots()}>
        <span class="badge badge-outline badge-xs">{partialNormalSlots()}</span>
      </Show>
      <Show when={exslotOnly()}>
        <span class="badge badge-warning badge-xs">補強のみ</span>
      </Show>
      <Show
        when={
          props.exslot != null &&
          (props.exslot.level > 0 || props.exslot.alv > 0)
        }
      >
        <span class="badge badge-outline badge-xs border-warning text-warning">
          {[
            props.exslot!.level > 0 ? `補強★${props.exslot!.level}` : null,
            props.exslot!.alv > 0 ? `熟${props.exslot!.alv}` : null,
          ]
            .filter(Boolean)
            .join(" /")}
        </span>
      </Show>
    </span>
  );
}

function EquipListRow(props: {
  equip: MstSlotItemData;
  active: boolean;
  onSelect: () => void;
}): JSX.Element {
  const iconNum = props.equip.type?.[3] ?? 0;

  return (
    <button
      class={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition border ${
        props.active
          ? "bg-accent/12 border-accent/35"
          : "hover:bg-primary/8 active:bg-primary/15 border-transparent"
      }`}
      onClick={props.onSelect}
    >
      <span class="w-5 h-5 inline-flex items-center justify-center rounded bg-base-200/70 shrink-0">
        <WeaponIcon iconNum={iconNum} />
      </span>
      <div class="min-w-0 text-left">
        <p
          class="text-sm leading-tight truncate font-medium"
          title={props.equip.name}
        >
          {props.equip.name}
        </p>
        <p class="text-[11px] text-base-content/45 leading-tight mt-0.5">
          ID {props.equip.id} / {equipDisplayTypeName(props.equip)}
        </p>
      </div>
    </button>
  );
}

function ShipDetailPanel(props: {
  ship: MstShipData;
  onOpenEquip: (equipId: number) => void;
  expandEquippableEquip: boolean;
  expandSingleSynergy: boolean;
  expandPairSynergy: boolean;
  showMultiSynergy: boolean;
}): JSX.Element {
  const [shipGrowthCap, setShipGrowthCap] =
    createSignal<NormalizedShipGrowthCaps | null>(null);
  const [shipGrowthCapUpdatedAtIso, setShipGrowthCapUpdatedAtIso] =
    createSignal<string | null>(null);

  createEffect(() => {
    const shipId = props.ship.id;
    setShipGrowthCap(null);
    setShipGrowthCapUpdatedAtIso(null);

    let alive = true;
    (async () => {
      try {
        const summaryRes = await cachedFetch("/api/ship-growth/summary");
        if (!summaryRes.ok) return;

        const summaryJson = (await summaryRes.json()) as ShipGrowthSummary;
        const latest = summaryJson.periods?.[0];
        if (!latest) return;

        const boundsRes = await cachedFetch(
          `/api/ship-growth/bounds?period_tag=${encodeURIComponent(latest.period_tag)}&table_version=${encodeURIComponent(latest.table_version)}`,
        );
        if (!boundsRes.ok) return;

        const boundsJson = (await boundsRes.json()) as ShipGrowthBoundsResponse;
        const capFromCaps = normalizeShipGrowthCaps(
          (boundsJson.caps ?? []).find((row) => row.master_id === shipId) ??
            null,
        );
        const capFromBounds = deriveShipGrowthCapsFromBounds(
          shipId,
          boundsJson.bounds ?? [],
        );
        const cap = mergeShipGrowthCaps(capFromCaps, capFromBounds);

        if (alive) {
          setShipGrowthCap(cap);
          setShipGrowthCapUpdatedAtIso(
            typeof boundsJson.updated_at_iso === "string"
              ? boundsJson.updated_at_iso
              : null,
          );
        }
      } catch {
        // Non-critical: keep master-data original display when ship-growth lookup fails.
      }
    })();

    return () => {
      alive = false;
    };
  });

  const usesShipGrowthFallback = createMemo(() => {
    const cap = shipGrowthCap();
    if (!cap) return false;
    return (
      (needsStatFallback(props.ship.tais) && cap.taisen_max > 0) ||
      (needsStatFallback(props.ship.kaih) && cap.kaihi_max > 0) ||
        (needsStatFallback(props.ship.saku) && cap.sakuteki_max > 0)
    );
  });

  const shipSynergy = createMemo(() => {
    const effects = getSlotItemEffects();
    if (!effects)
      return {
        single: [],
        pair: [],
        speedSynergies: [],
        rangeSynergies: [],
        triple: [] as MultiGroup[],
        quad: [] as MultiGroup[],
        penta: [] as MultiGroup[],
      };

    const appliesToShip = (ships: number[] | null | undefined): boolean => {
      if (!Array.isArray(ships) || ships.length === 0) return true;
      return ships.includes(props.ship.id);
    };

    const single: Array<{
      equip: MstSlotItemData;
      base: Record<string, number>;
      star10: Record<string, number> | null;
      c2: Record<string, number> | null;
      c3: Record<string, number> | null;
    }> = [];
    const _effectsMap = normalizeEffects(effects);
    const _crossMap = normalizeCrossEffects(effects);
    for (const [equipIdRaw, entries] of Object.entries(_effectsMap)) {
      const equipId = Number(equipIdRaw);
      const equip = getMasterSlotItem(equipId);
      if (!equip || equip.id >= ENEMY_ID_THRESHOLD) continue;
      const matched = entries.find((entry) => appliesToShip(entry.ships));
      if (!matched) continue;
      if (
        scoreSynergy(matched.b) === 0 &&
        scoreSynergy(matched.l) === 0 &&
        scoreSynergy(matched.c2) === 0 &&
        scoreSynergy(matched.c3) === 0
      )
        continue;
      single.push({
        equip,
        base: matched.b,
        star10: matched.l ?? null,
        c2: matched.c2 ?? null,
        c3: matched.c3 ?? null,
      });
    }

    const pair: Array<{
      a: MstSlotItemData;
      b: MstSlotItemData;
      stats: Record<string, number>;
    }> = [];
    for (const entries of Object.values(_crossMap)) {
      for (const entry of entries) {
        if (!appliesToShip(entry.ships)) continue;
        const a = getMasterSlotItem(entry.items[0]);
        const b = getMasterSlotItem(entry.items[1]);
        if (
          !a ||
          !b ||
          a.id >= ENEMY_ID_THRESHOLD ||
          b.id >= ENEMY_ID_THRESHOLD
        )
          continue;
        if (scoreSynergy(entry.synergy) === 0) continue;
        pair.push({ a, b, stats: entry.synergy });
      }
    }

    single.sort((x, y) => scoreSynergy(y.base) - scoreSynergy(x.base));
    pair.sort((x, y) => scoreSynergy(y.stats) - scoreSynergy(x.stats));

    const speedSynergies: MobilitySynergyRow[] = [];
    const rangeSynergies: MobilitySynergyRow[] = [];

    const pickStat = (
      stats: Record<string, number> | null | undefined,
      key: "soku" | "leng",
    ): number => {
      const raw = stats?.[key];
      return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    };

    const maxStatBonus = (
      key: "soku" | "leng",
      ...sources: Array<Record<string, number> | null | undefined>
    ): number => {
      let best = 0;
      for (const src of sources) {
        const v = pickStat(src, key);
        if (v > best) best = v;
      }
      return best;
    };

    const pushUnique = (
      target: MobilitySynergyRow[],
      seen: Set<string>,
      payload: Omit<MobilitySynergyRow, "key">,
    ) => {
      if (payload.before === payload.after) return;
      const dedupeKey = [
        payload.sourceType,
        payload.equip.id,
        payload.partner?.id ?? 0,
        payload.before,
        payload.after,
      ].join(":");
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      target.push({ ...payload, key: dedupeKey });
    };

    const speedSeen = new Set<string>();
    const rangeSeen = new Set<string>();

    const hasSameSingleRangeEffect = (
      equipId: number,
      before: number,
      after: number,
    ): boolean =>
      rangeSynergies.some(
        (row) =>
          row.sourceType === "single" &&
          row.equip.id === equipId &&
          row.before === before &&
          row.after === after,
      );

    // Single equipment: aggregate the best possible (★10 / 2積み / 3積み を含む)
    // soku/leng change into a single row per equipment. Range additionally takes
    // the equipment's own `leng` into account because effective range becomes
    // max(ship.leng, equip.leng) once equipped.
    for (const row of single) {
      const sokuBonus = maxStatBonus(
        "soku",
        row.base,
        row.star10,
        row.c2,
        row.c3,
      );
      if (sokuBonus !== 0) {
        pushUnique(speedSynergies, speedSeen, {
          equip: row.equip,
          partner: null,
          sourceType: "single",
          before: props.ship.soku,
          after: props.ship.soku + sokuBonus,
        });
      }

      const lengBonus = maxStatBonus(
        "leng",
        row.base,
        row.star10,
        row.c2,
        row.c3,
      );
      const equipBaseLeng = Number(row.equip.leng ?? 0);
      const effectiveBase = Math.max(props.ship.leng, equipBaseLeng);
      const after = effectiveBase + lengBonus;
      if (after !== props.ship.leng) {
        pushUnique(rangeSynergies, rangeSeen, {
          equip: row.equip,
          partner: null,
          sourceType: "single",
          before: props.ship.leng,
          after,
        });
      }
    }

    // Pair (cross_effects): aggregate to one row per (a,b) showing pair-only
    // contribution to soku/leng. Equipment-side base bonuses are already shown
    // by the single rows above; here we surface only the cross synergy delta.
    for (const row of pair) {
      const sokuBonus = pickStat(row.stats, "soku");
      if (sokuBonus !== 0) {
        pushUnique(speedSynergies, speedSeen, {
          equip: row.a,
          partner: row.b,
          sourceType: "pair",
          before: props.ship.soku,
          after: props.ship.soku + sokuBonus,
        });
      }
      const lengBonus = pickStat(row.stats, "leng");
      if (lengBonus !== 0) {
        const before = props.ship.leng;
        const effectiveBase = Math.max(
          props.ship.leng,
          Number(row.a.leng ?? 0),
          Number(row.b.leng ?? 0),
        );
        const after = effectiveBase + lengBonus;
        if (hasSameSingleRangeEffect(row.a.id, before, after)) {
          continue;
        }
        pushUnique(rangeSynergies, rangeSeen, {
          equip: row.a,
          partner: row.b,
          sourceType: "pair",
          before,
          after,
        });
      }
    }

    // Leng-stacking pairs: detect pairs of distinct equips that each have an
    // individual leng bonus for this ship, where combining both yields higher
    // effective range than either alone. Cross-effect leng synergy (if any) is
    // included in the combined calculation.
    const singleWithLeng = single.filter(
      (row) => maxStatBonus("leng", row.base, row.star10, row.c2, row.c3) > 0,
    );
    for (let ai = 0; ai < singleWithLeng.length; ai++) {
      for (let bi = ai + 1; bi < singleWithLeng.length; bi++) {
        const rowA = singleWithLeng[ai];
        const rowB = singleWithLeng[bi];
        const maxLengA = maxStatBonus(
          "leng",
          rowA.base,
          rowA.star10,
          rowA.c2,
          rowA.c3,
        );
        const maxLengB = maxStatBonus(
          "leng",
          rowB.base,
          rowB.star10,
          rowB.c2,
          rowB.c3,
        );
        const pairKey = `${Math.min(rowA.equip.id, rowB.equip.id)}:${Math.max(rowA.equip.id, rowB.equip.id)}`;
        const crossEntry = normalizeCrossEffects(effects)[pairKey]?.find((e) =>
          appliesToShip(e.ships),
        );
        const crossLeng = pickStat(crossEntry?.synergy, "leng");
        const combinedLengBonus = maxLengA + maxLengB + crossLeng;
        const effectiveBase = Math.max(
          props.ship.leng,
          Number(rowA.equip.leng ?? 0),
          Number(rowB.equip.leng ?? 0),
        );
        const combinedAfter = effectiveBase + combinedLengBonus;
        const singleAfterA =
          Math.max(props.ship.leng, Number(rowA.equip.leng ?? 0)) + maxLengA;
        const singleAfterB =
          Math.max(props.ship.leng, Number(rowB.equip.leng ?? 0)) + maxLengB;
        if (combinedAfter <= Math.max(singleAfterA, singleAfterB)) continue;
        pushUnique(rangeSynergies, rangeSeen, {
          equip: rowA.equip,
          partner: rowB.equip,
          sourceType: "pair",
          before: props.ship.leng,
          after: combinedAfter,
        });
      }
    }

    const equippableRangePartners = Object.values(getMasterSlotItems())
      .filter((equip) => {
        if (equip.id >= ENEMY_ID_THRESHOLD) return false;
        const compat = getCompatibilityMeta(props.ship, equip);
        return compat.normalSlots.length > 0 || compat.exslot != null;
      })
      .filter((equip) => Number(equip.leng ?? 0) > 0)
      .sort(
        (a, b) =>
          Number(b.leng ?? 0) - Number(a.leng ?? 0) || a.sortno - b.sortno,
      );

    // Add standalone range changes from equipment's own leng attribute.
    // This covers equipment that changes effective range even without a synergy
    // bonus entry (e.g. a 超長 gun that raises ship's range from 長 to 超長).
    // Skip equips that already have a synergy-based range row to avoid
    // duplicates where the synergy entry already accounts for equip.leng via
    // effectiveBase (e.g. showing both 短→長 and 短→中 for the same radar).
    const equipsWithSynergyRange = new Set(
      rangeSynergies
        .filter((r) => r.sourceType === "single")
        .map((r) => r.equip.id),
    );
    for (const equip of equippableRangePartners) {
      const equipLeng = Number(equip.leng ?? 0);
      if (
        equipLeng > props.ship.leng &&
        !equipsWithSynergyRange.has(equip.id)
      ) {
        pushUnique(rangeSynergies, rangeSeen, {
          equip,
          partner: null,
          sourceType: "single",
          before: props.ship.leng,
          after: equipLeng,
        });
      }
    }

    for (const row of rangeSynergies.slice()) {
      if (row.sourceType !== "single") continue;
      const partner = equippableRangePartners.find((candidate) => {
        if (candidate.id === row.equip.id) return false;
        const comboAfter = Math.max(row.after, Number(candidate.leng ?? 0));
        return comboAfter > row.after;
      });
      if (!partner) continue;
      const comboAfter = Math.max(row.after, Number(partner.leng ?? 0));
      pushUnique(rangeSynergies, rangeSeen, {
        equip: row.equip,
        partner,
        sourceType: "combo",
        before: row.before,
        after: comboAfter,
      });
    }

    speedSynergies.sort(
      (x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before),
    );
    rangeSynergies.sort(
      (x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before),
    );

    // ── Multi-item (triple / quad / penta) synergies ────────────────
    // For each applicable rule:
    //   item_pool rules → pool display (any K of N items; shows rule.synergy as correction)
    //   combos_b64 / explicit → decode each combo, show net = single+pair+synergy (no limit)
    // Grouped by primary stat key for subcategory display.

    const buildMultiEntries = (
      rules: Array<TripleRule | QuadRule | PentaRule> | undefined,
      comboSize: number,
    ): MultiEntry[] => {
      if (!rules) return [];
      const all: MultiEntry[] = [];
      const _em = normalizeEffects(effects);
      const _cm = normalizeCrossEffects(effects);
      for (const rule of rules) {
        if (!appliesToShip(rule.ships)) continue;
        if (rule.item_pool) {
          // Pool rule: "any comboSize of these pool items" → show pool + correction
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
          // Fixed+free rule: fixed items always present, any (comboSize-k) of free_pool
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
        } else {
          // Explicit combos: decode all (no limit)
          const combos = decodeCombosForDisplay(rule, comboSize, 999999);
          for (const comboIds of combos) {
            const items = comboIds.map((id) => getMasterSlotItem(id));
            if (items.some((it) => !it || it.id >= ENEMY_ID_THRESHOLD))
              continue;
            const base = comboBaseBonus(props.ship.id, comboIds, _em, _cm);
            for (const [k, v] of Object.entries(rule.synergy)) {
              if (v) base[k] = (base[k] || 0) + v;
            }
            if (scoreSynergy(base) === 0) continue;
            all.push({
              kind: "combo",
              combo: items as MstSlotItemData[],
              netStats: base,
            });
          }
        }
      }
      return all;
    };

    const triple = groupByMultiStat(buildMultiEntries(effects.triple_rules, 3));
    const quad = groupByMultiStat(buildMultiEntries(effects.quad_rules, 4));
    const penta = groupByMultiStat(buildMultiEntries(effects.penta_rules, 5));

    return {
      single,
      pair,
      speedSynergies,
      rangeSynergies,
      triple,
      quad,
      penta,
    };
  });

  const equippableGroups = createMemo(() => {
    const allies = Object.values(getMasterSlotItems())
      .filter((equip) => equip.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => a.sortno - b.sortno)
      .map((equip) => ({
        equip,
        compat: getCompatibilityMeta(props.ship, equip),
      }))
      .filter(
        (row) => row.compat.normalSlots.length > 0 || row.compat.exslot != null,
      );
    return groupBy(allies, (row) => equipDisplayTypeName(row.equip));
  });

  const specRows = createMemo<Array<[label: string, value: string | number]>>(
    () => [
      ["ID", props.ship.id],
      ["艦種", STYPE_NAMES[props.ship.stype] ?? `艦種${props.ship.stype}`],
      ["速力", SPEED_NAMES[props.ship.soku] ?? props.ship.soku],
      ["射程", rangeDisplay(props.ship.leng)],
      ["搭載スロット数", props.ship.slot_num],
      ["耐久", statRangeLabel(props.ship.taik)],
      ["装甲", statRangeLabel(props.ship.souk)],
      ["火力", statRangeLabel(props.ship.houg)],
      ["雷装", statRangeLabel(props.ship.raig)],
      ["対空", statRangeLabel(props.ship.tyku)],
      [
        "対潜",
        statRangeLabelWithFallback(
          props.ship.tais,
          shipGrowthCap()?.taisen_max,
        ),
      ],
      [
        "回避",
        statRangeLabelWithFallback(props.ship.kaih, shipGrowthCap()?.kaihi_max),
      ],
      [
        "索敵",
        statRangeLabelWithFallback(
          props.ship.saku,
          shipGrowthCap()?.sakuteki_max,
        ),
      ],
      ["運", statRangeLabel(props.ship.luck)],
      [
        "搭載内訳",
        props.ship.maxeq
          ? props.ship.maxeq.slice(0, props.ship.slot_num).join(" / ")
          : "-",
      ],
    ],
  );

  return (
    <article class="rounded-xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
      <div class="px-4 py-3 border-b border-base-200 bg-linear-to-r from-primary/10 to-transparent">
        <h2 class="font-semibold">艦詳細</h2>
      </div>

      <div class="p-4 space-y-4">
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] gap-4 items-stretch">
          <div class="rounded-xl border border-base-300/70 bg-linear-to-b from-base-200 to-base-100 p-3 min-h-80 h-full flex flex-col items-center justify-center overflow-hidden xl:max-w-sm">
            <ImageFallbackBox
              src={cardUrl(props.ship.id)}
              alt={props.ship.name}
              class="w-full h-72 rounded-md"
              objectClass="w-full h-full object-contain object-center"
              fallbackText="No Image"
            />
          </div>
          <div class="min-w-0 h-full flex flex-col gap-2">
            <h3 class="text-2xl font-bold leading-tight">{props.ship.name}</h3>
            <p class="text-xs text-base-content/60">
              対潜/回避/索敵の欠損値は ship-growth
              データの上限値で補完表示しています。
            </p>
            <div>
              <SpecTable rows={specRows()} />
            </div>
          </div>
        </div>

        <section>
          <h4 class="font-medium mb-2">装備可能な装備</h4>
          <div
            class={`space-y-3 pr-1 ${props.expandEquippableEquip ? "" : "max-h-[40vh] overflow-y-auto"}`}
          >
            <For each={equippableGroups()}>
              {(group) => (
                <div class="rounded-lg border border-base-300/70 p-2">
                  <h5 class="text-sm font-medium mb-2">{group.key}</h5>
                  <div class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-1.5">
                    <For each={group.items.slice(0, 60)}>
                      {(row) => (
                        <button
                          class="w-full text-left flex items-center gap-2 rounded border border-base-300/70 hover:border-accent/45 px-2 py-1.5 transition"
                          onClick={() => props.onOpenEquip(row.equip.id)}
                          title={row.equip.name}
                        >
                          <span class="w-5 h-5 inline-flex items-center justify-center rounded bg-base-200/70 shrink-0">
                            <WeaponIcon iconNum={row.equip.type?.[3] ?? 0} />
                          </span>
                          <span class="text-xs truncate flex-1">
                            {row.equip.name}
                          </span>
                          <CompatibilityBadges
                            normalSlots={row.compat.normalSlots}
                            slotCount={props.ship.slot_num}
                            exslot={row.compat.exslot}
                          />
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </section>

        <section>
          <h4 class="font-medium mb-2">装備シナジー</h4>
          <div class="space-y-3">
            <Show
              when={shipSynergy().single.length > 0}
              fallback={
                <div class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-content/50">
                  この艦に設定された単体装備シナジーはありません
                </div>
              }
            >
              <div class="rounded-lg border border-base-300/70 p-2">
                <h5 class="text-sm font-medium mb-2">単体装備シナジー</h5>
                <div
                  class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2 pr-1 ${props.expandSingleSynergy ? "" : "max-h-[36vh] overflow-y-auto"}`}
                >
                  <For each={shipSynergy().single.slice(0, 80)}>
                    {(row) => (
                      <div class="rounded border border-base-300/70 p-2 space-y-1">
                        <button
                          class="flex items-center gap-2 min-w-0 w-full text-left hover:underline"
                          onClick={() => props.onOpenEquip(row.equip.id)}
                          title={row.equip.name}
                        >
                          <span class="w-5 h-5 inline-flex items-center justify-center rounded bg-base-200/70 shrink-0">
                            <WeaponIcon iconNum={row.equip.type?.[3] ?? 0} />
                          </span>
                          <span class="text-sm font-medium truncate">
                            {row.equip.name}
                          </span>
                        </button>
                        <div class="text-xs text-base-content/70 inline-flex items-center h-5">
                          基本
                        </div>
                        <SynergyStatInline stats={row.base} />
                        <Show
                          when={
                            row.star10 != null &&
                            scoreSynergy(row.star10 ?? undefined) > 0
                          }
                        >
                          <div class="text-xs text-base-content/70 mt-1 inline-flex items-center h-5">
                            改修★10
                          </div>
                          <SynergyStatInline stats={row.star10!} />
                        </Show>
                        <For each={stackingSynergyRows(row.c2, row.c3)}>
                          {(stackRow) => (
                            <>
                              <div class="text-xs text-base-content/70 mt-1 inline-flex items-center h-5">
                                {stackRow.label}
                              </div>
                              <SynergyStatInline stats={stackRow.stats} />
                            </>
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show
              when={shipSynergy().pair.length > 0}
              fallback={
                <div class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-content/50">
                  この艦に設定された装備組み合わせシナジーはありません
                </div>
              }
            >
              <div class="rounded-lg border border-base-300/70 p-2">
                <h5 class="text-sm font-medium mb-2">装備組み合わせシナジー</h5>
                <div
                  class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2 pr-1 ${props.expandPairSynergy ? "" : "max-h-[30vh] overflow-y-auto"}`}
                >
                  <For each={shipSynergy().pair.slice(0, 80)}>
                    {(row) => (
                      <div class="rounded border border-base-300/70 p-2 space-y-1">
                        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                          <button
                            class="inline-flex items-center gap-1 min-w-0 hover:underline"
                            onClick={() => props.onOpenEquip(row.a.id)}
                            title={row.a.name}
                          >
                            <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                              <WeaponIcon iconNum={row.a.type?.[3] ?? 0} />
                            </span>
                            <span class="truncate max-w-40">{row.a.name}</span>
                          </button>
                          <span>+</span>
                          <button
                            class="inline-flex items-center gap-1 min-w-0 hover:underline"
                            onClick={() => props.onOpenEquip(row.b.id)}
                            title={row.b.name}
                          >
                            <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                              <WeaponIcon iconNum={row.b.type?.[3] ?? 0} />
                            </span>
                            <span class="truncate max-w-40">{row.b.name}</span>
                          </button>
                        </div>
                        <SynergyStatInline stats={row.stats} />
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show
              when={shipSynergy().speedSynergies.length > 0}
              fallback={
                <div class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-content/50">
                  この艦に設定された速力シナジーはありません
                </div>
              }
            >
              <div class="rounded-lg border border-base-300/70 p-2">
                <h5 class="text-sm font-medium mb-2">速力シナジー</h5>
                <div
                  class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2 pr-1 ${props.expandSingleSynergy ? "" : "max-h-[24vh] overflow-y-auto"}`}
                >
                  <For each={shipSynergy().speedSynergies.slice(0, 60)}>
                    {(row) => (
                      <div class="rounded border border-base-300/70 p-2 space-y-1">
                        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                          <button
                            class="inline-flex items-center gap-1 min-w-0 hover:underline"
                            onClick={() => props.onOpenEquip(row.equip.id)}
                            title={row.equip.name}
                          >
                            <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                              <WeaponIcon iconNum={row.equip.type?.[3] ?? 0} />
                            </span>
                            <span class="truncate max-w-40">
                              {row.equip.name}
                            </span>
                          </button>
                          <Show when={row.partner}>
                            <>
                              <span>+</span>
                              <button
                                class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                onClick={() =>
                                  props.onOpenEquip(row.partner!.id)
                                }
                                title={row.partner?.name}
                              >
                                <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                  <WeaponIcon
                                    iconNum={row.partner?.type?.[3] ?? 0}
                                  />
                                </span>
                                <span class="truncate max-w-40">
                                  {row.partner?.name}
                                </span>
                              </button>
                            </>
                          </Show>
                        </div>
                        <div class="flex flex-wrap items-center gap-1">
                          <span
                            class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                              row.after - row.before > 0
                                ? "border-info/55 text-info"
                                : "border-error/45 text-error"
                            }`}
                          >
                            速力 {speedDisplay(row.before)} →{" "}
                            {speedDisplay(row.after)}
                          </span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show
              when={shipSynergy().rangeSynergies.length > 0}
              fallback={
                <div class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-content/50">
                  この艦に設定された射程シナジーはありません
                </div>
              }
            >
              <div class="rounded-lg border border-base-300/70 p-2">
                <h5 class="text-sm font-medium mb-2">射程シナジー</h5>
                <div
                  class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2 pr-1 ${props.expandSingleSynergy ? "" : "max-h-[24vh] overflow-y-auto"}`}
                >
                  <For each={shipSynergy().rangeSynergies.slice(0, 60)}>
                    {(row) => (
                      <div class="rounded border border-base-300/70 p-2 space-y-1">
                        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                          <button
                            class="inline-flex items-center gap-1 min-w-0 hover:underline"
                            onClick={() => props.onOpenEquip(row.equip.id)}
                            title={row.equip.name}
                          >
                            <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                              <WeaponIcon iconNum={row.equip.type?.[3] ?? 0} />
                            </span>
                            <span class="truncate max-w-40">
                              {row.equip.name}
                            </span>
                          </button>
                          <Show when={row.partner}>
                            <>
                              <span>+</span>
                              <button
                                class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                onClick={() =>
                                  props.onOpenEquip(row.partner!.id)
                                }
                                title={row.partner?.name}
                              >
                                <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                  <WeaponIcon
                                    iconNum={row.partner?.type?.[3] ?? 0}
                                  />
                                </span>
                                <span class="truncate max-w-40">
                                  {row.partner?.name}
                                </span>
                              </button>
                            </>
                          </Show>
                        </div>
                        <div class="flex flex-wrap items-center gap-1">
                          <span
                            class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                              row.after - row.before > 0
                                ? "border-info/55 text-info"
                                : "border-error/45 text-error"
                            }`}
                          >
                            射程 {rangeDisplay(row.before)} →{" "}
                            {rangeDisplay(row.after)}
                          </span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </section>

        <Show
          when={
            props.showMultiSynergy &&
            (shipSynergy().triple.length > 0 ||
              shipSynergy().quad.length > 0 ||
              shipSynergy().penta.length > 0)
          }
        >
          <section>
            <h4 class="font-medium mb-1">多装備シナジー</h4>
            <p class="text-xs text-base-content/50 mb-2">
              3〜5装備の組み合わせ。「コンボ」は合計補正値（単体＋ペア＋多装備補正の合計）。「プール」はその中の任意K個を同時装備した際の補正値を示します。
            </p>
            <div class="space-y-4">
              <Show when={shipSynergy().triple.length > 0}>
                <div class="rounded-lg border border-base-300/70 p-2">
                  <h5 class="text-sm font-medium mb-2">3装備シナジー</h5>
                  <div class="space-y-3">
                    <For each={shipSynergy().triple}>
                      {(group) => (
                        <div>
                          <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                            {group.label}系{" "}
                            <span class="font-normal text-base-content/40">
                              （{group.entries.length}件）
                            </span>
                          </h6>
                          <div
                            class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2 ${props.expandPairSynergy ? "" : "max-h-[36vh] overflow-y-auto"}`}
                          >
                            <For each={group.entries}>
                              {(entry) =>
                                entry.kind === "pool" ? (
                                  <div class="rounded border border-accent/30 bg-accent/5 p-2 space-y-1">
                                    <p class="text-[10px] text-accent/70 leading-tight">
                                      この中から
                                      {(entry as MultiPoolEntry).comboSize}
                                      個を同時装備（補正値）
                                    </p>
                                    <div class="flex flex-wrap items-center gap-1 text-xs text-base-content/70">
                                      <For
                                        each={(entry as MultiPoolEntry).pool}
                                      >
                                        {(equip, idx) => (
                                          <>
                                            <Show when={idx() > 0}>
                                              <span class="text-base-content/30">
                                                ·
                                              </span>
                                            </Show>
                                            <button
                                              class="inline-flex items-center gap-0.5 min-w-0 hover:underline"
                                              onClick={() =>
                                                props.onOpenEquip(equip.id)
                                              }
                                              title={equip.name}
                                            >
                                              <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={equip.type?.[3] ?? 0}
                                                />
                                              </span>
                                              <span class="truncate max-w-28">
                                                {equip.name}
                                              </span>
                                            </button>
                                          </>
                                        )}
                                      </For>
                                    </div>
                                    <SynergyStatInline
                                      stats={
                                        (entry as MultiPoolEntry).correction
                                      }
                                    />
                                  </div>
                                ) : (
                                  <div class="rounded border border-base-300/70 p-2 space-y-1">
                                    <div class="flex flex-wrap items-center gap-1 text-xs text-base-content/70">
                                      <For
                                        each={(entry as MultiComboEntry).combo}
                                      >
                                        {(equip, idx) => (
                                          <>
                                            <Show when={idx() > 0}>
                                              <span class="text-base-content/30">
                                                +
                                              </span>
                                            </Show>
                                            <button
                                              class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                              onClick={() =>
                                                props.onOpenEquip(equip.id)
                                              }
                                              title={equip.name}
                                            >
                                              <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={equip.type?.[3] ?? 0}
                                                />
                                              </span>
                                              <span class="truncate max-w-32">
                                                {equip.name}
                                              </span>
                                            </button>
                                          </>
                                        )}
                                      </For>
                                    </div>
                                    <SynergyStatInline
                                      stats={
                                        (entry as MultiComboEntry).netStats
                                      }
                                    />
                                  </div>
                                )
                              }
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <Show when={shipSynergy().quad.length > 0}>
                <div class="rounded-lg border border-base-300/70 p-2">
                  <h5 class="text-sm font-medium mb-2">4装備シナジー</h5>
                  <div class="space-y-3">
                    <For each={shipSynergy().quad}>
                      {(group) => (
                        <div>
                          <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                            {group.label}系{" "}
                            <span class="font-normal text-base-content/40">
                              （{group.entries.length}件）
                            </span>
                          </h6>
                          <div
                            class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2 ${props.expandPairSynergy ? "" : "max-h-[30vh] overflow-y-auto"}`}
                          >
                            <For each={group.entries}>
                              {(entry) =>
                                entry.kind === "pool" ? (
                                  <div class="rounded border border-accent/30 bg-accent/5 p-2 space-y-1">
                                    <p class="text-[10px] text-accent/70 leading-tight">
                                      この中から
                                      {(entry as MultiPoolEntry).comboSize}
                                      個を同時装備（補正値）
                                    </p>
                                    <div class="flex flex-wrap items-center gap-1 text-xs text-base-content/70">
                                      <For
                                        each={(entry as MultiPoolEntry).pool}
                                      >
                                        {(equip, idx) => (
                                          <>
                                            <Show when={idx() > 0}>
                                              <span class="text-base-content/30">
                                                ·
                                              </span>
                                            </Show>
                                            <button
                                              class="inline-flex items-center gap-0.5 min-w-0 hover:underline"
                                              onClick={() =>
                                                props.onOpenEquip(equip.id)
                                              }
                                              title={equip.name}
                                            >
                                              <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={equip.type?.[3] ?? 0}
                                                />
                                              </span>
                                              <span class="truncate max-w-28">
                                                {equip.name}
                                              </span>
                                            </button>
                                          </>
                                        )}
                                      </For>
                                    </div>
                                    <SynergyStatInline
                                      stats={
                                        (entry as MultiPoolEntry).correction
                                      }
                                    />
                                  </div>
                                ) : (
                                  <div class="rounded border border-base-300/70 p-2 space-y-1">
                                    <div class="flex flex-wrap items-center gap-1 text-xs text-base-content/70">
                                      <For
                                        each={(entry as MultiComboEntry).combo}
                                      >
                                        {(equip, idx) => (
                                          <>
                                            <Show when={idx() > 0}>
                                              <span class="text-base-content/30">
                                                +
                                              </span>
                                            </Show>
                                            <button
                                              class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                              onClick={() =>
                                                props.onOpenEquip(equip.id)
                                              }
                                              title={equip.name}
                                            >
                                              <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={equip.type?.[3] ?? 0}
                                                />
                                              </span>
                                              <span class="truncate max-w-32">
                                                {equip.name}
                                              </span>
                                            </button>
                                          </>
                                        )}
                                      </For>
                                    </div>
                                    <SynergyStatInline
                                      stats={
                                        (entry as MultiComboEntry).netStats
                                      }
                                    />
                                  </div>
                                )
                              }
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <Show when={shipSynergy().penta.length > 0}>
                <div class="rounded-lg border border-base-300/70 p-2">
                  <h5 class="text-sm font-medium mb-2">5装備シナジー</h5>
                  <div class="space-y-3">
                    <For each={shipSynergy().penta}>
                      {(group) => (
                        <div>
                          <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                            {group.label}系{" "}
                            <span class="font-normal text-base-content/40">
                              （{group.entries.length}件）
                            </span>
                          </h6>
                          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <For each={group.entries}>
                              {(entry) =>
                                entry.kind === "pool" ? (
                                  <div class="rounded border border-accent/30 bg-accent/5 p-2 space-y-1">
                                    <p class="text-[10px] text-accent/70 leading-tight">
                                      この中から
                                      {(entry as MultiPoolEntry).comboSize}
                                      個を同時装備（補正値）
                                    </p>
                                    <div class="flex flex-wrap items-center gap-1 text-xs text-base-content/70">
                                      <For
                                        each={(entry as MultiPoolEntry).pool}
                                      >
                                        {(equip, idx) => (
                                          <>
                                            <Show when={idx() > 0}>
                                              <span class="text-base-content/30">
                                                ·
                                              </span>
                                            </Show>
                                            <button
                                              class="inline-flex items-center gap-0.5 min-w-0 hover:underline"
                                              onClick={() =>
                                                props.onOpenEquip(equip.id)
                                              }
                                              title={equip.name}
                                            >
                                              <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={equip.type?.[3] ?? 0}
                                                />
                                              </span>
                                              <span class="truncate max-w-28">
                                                {equip.name}
                                              </span>
                                            </button>
                                          </>
                                        )}
                                      </For>
                                    </div>
                                    <SynergyStatInline
                                      stats={
                                        (entry as MultiPoolEntry).correction
                                      }
                                    />
                                  </div>
                                ) : (
                                  <div class="rounded border border-base-300/70 p-2 space-y-1">
                                    <div class="flex flex-wrap items-center gap-1 text-xs text-base-content/70">
                                      <For
                                        each={(entry as MultiComboEntry).combo}
                                      >
                                        {(equip, idx) => (
                                          <>
                                            <Show when={idx() > 0}>
                                              <span class="text-base-content/30">
                                                +
                                              </span>
                                            </Show>
                                            <button
                                              class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                              onClick={() =>
                                                props.onOpenEquip(equip.id)
                                              }
                                              title={equip.name}
                                            >
                                              <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={equip.type?.[3] ?? 0}
                                                />
                                              </span>
                                              <span class="truncate max-w-32">
                                                {equip.name}
                                              </span>
                                            </button>
                                          </>
                                        )}
                                      </For>
                                    </div>
                                    <SynergyStatInline
                                      stats={
                                        (entry as MultiComboEntry).netStats
                                      }
                                    />
                                  </div>
                                )
                              }
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </section>
        </Show>
      </div>
    </article>
  );
}

function EquipDetailPanel(props: {
  equip: MstSlotItemData;
  onOpenShip: (shipId: number) => void;
  onOpenEquip: (equipId: number) => void;
  expandSynergyShips: boolean;
  expandCompatibleShips: boolean;
}): JSX.Element {
  const equipSynergyShips = createMemo(() => {
    const effects = getSlotItemEffects();
    if (!effects)
      return [] as Array<{
        ship: MstShipData;
        base: Record<string, number> | null;
        star10: Record<string, number> | null;
        c2: Record<string, number> | null;
        c3: Record<string, number> | null;
        partners: Array<{
          equip: MstSlotItemData;
          stats: Record<string, number>;
        }>;
      }>;

    const singleEntries =
      normalizeEffects(effects)[String(props.equip.id)] ?? [];
    const crossEntries = Object.values(normalizeCrossEffects(effects))
      .flat()
      .filter(
        (entry) =>
          entry.items[0] === props.equip.id ||
          entry.items[1] === props.equip.id,
      );

    const rows: Array<{
      ship: MstShipData;
      base: Record<string, number> | null;
      star10: Record<string, number> | null;
      c2: Record<string, number> | null;
      c3: Record<string, number> | null;
      partners: Array<{
        equip: MstSlotItemData;
        stats: Record<string, number>;
      }>;
    }> = [];

    for (const ship of Object.values(getMasterShips())) {
      if (ship.id >= ENEMY_ID_THRESHOLD) continue;

      const single = singleEntries.find((entry) =>
        entry.ships.includes(ship.id),
      );
      const partners = crossEntries
        .filter((entry) => entry.ships.includes(ship.id))
        .map((entry) => {
          const partnerId =
            entry.items[0] === props.equip.id ? entry.items[1] : entry.items[0];
          const partnerEquip = getMasterSlotItem(partnerId);
          if (
            !partnerEquip ||
            partnerEquip.id >= ENEMY_ID_THRESHOLD ||
            scoreSynergy(entry.synergy) === 0
          )
            return null;
          return { equip: partnerEquip, stats: entry.synergy };
        })
        .filter(
          (x): x is { equip: MstSlotItemData; stats: Record<string, number> } =>
            x != null,
        )
        .sort((a, b) => scoreSynergy(b.stats) - scoreSynergy(a.stats));

      const hasSingle =
        single &&
        (scoreSynergy(single.b) > 0 ||
          scoreSynergy(single.l) > 0 ||
          scoreSynergy(single.c2) > 0 ||
          scoreSynergy(single.c3) > 0);
      if (!hasSingle && partners.length === 0) continue;

      rows.push({
        ship,
        base: single?.b ?? null,
        star10: single?.l ?? null,
        c2: single?.c2 ?? null,
        c3: single?.c3 ?? null,
        partners,
      });
    }

    rows.sort(
      (a, b) => (a.ship.sort_id ?? a.ship.id) - (b.ship.sort_id ?? b.ship.id),
    );
    return rows;
  });

  /** Triple / quad rules that include this equipment, grouped by combo. */
  const equipMultiSynergies = createMemo(() => {
    const effects = getSlotItemEffects();
    const equipId = props.equip.id;
    if (!effects)
      return { triple: [] as MultiGroup[], quad: [] as MultiGroup[] };

    const _em = normalizeEffects(effects);
    const _cm = normalizeCrossEffects(effects);

    const buildEquipEntries = (
      rules: Array<TripleRule | QuadRule | PentaRule> | undefined,
      comboSize: number,
    ): MultiEntry[] => {
      if (!rules) return [];
      const seenCombos = new Set<string>();
      const all: MultiEntry[] = [];
      for (const rule of rules) {
        // Filter: at least one allied ship must benefit (or all-ships rule)
        if (rule.ships.length > 0) {
          const anyShip = rule.ships.some((sid) => {
            const s = getMasterShip(sid);
            return s != null && s.id < ENEMY_ID_THRESHOLD;
          });
          if (!anyShip) continue;
        }

        if (rule.item_pool) {
          // Pool rule: check if equipId is in the pool
          if (!rule.item_pool.includes(equipId)) continue;
          if (scoreSynergy(rule.synergy) === 0) continue;
          const pool = rule.item_pool
            .map((id) => getMasterSlotItem(id))
            .filter(
              (it): it is MstSlotItemData =>
                it != null && it.id < ENEMY_ID_THRESHOLD,
            );
          if (pool.length < comboSize) continue;
          all.push({ kind: "pool", pool, comboSize, correction: rule.synergy });
        } else if (rule.fixed_items && rule.free_pool) {
          // Fixed+free rule: check if equipId appears in fixed_items or free_pool
          const allPoolIds = [...rule.fixed_items, ...rule.free_pool];
          if (!allPoolIds.includes(equipId)) continue;
          if (scoreSynergy(rule.synergy) === 0) continue;
          const pool = allPoolIds
            .map((id) => getMasterSlotItem(id))
            .filter(
              (it): it is MstSlotItemData =>
                it != null && it.id < ENEMY_ID_THRESHOLD,
            );
          if (pool.length < comboSize) continue;
          all.push({ kind: "pool", pool, comboSize, correction: rule.synergy });
        } else {
          if (rule.items && !rule.items.includes(equipId)) continue;
          // Explicit combos: decode all, filter those containing this equip
          const combos = decodeCombosForDisplay(rule, comboSize, 999999);
          const shipIdForCalc = rule.ships.length > 0 ? rule.ships[0] : 0;
          for (const comboIds of combos) {
            if (!comboIds.includes(equipId)) continue;
            const key = comboIds
              .slice()
              .sort((a, b) => a - b)
              .join(":");
            if (seenCombos.has(key)) continue;
            seenCombos.add(key);
            const items = comboIds.map((id) => getMasterSlotItem(id));
            if (items.some((it) => !it || it.id >= ENEMY_ID_THRESHOLD))
              continue;
            const base = comboBaseBonus(shipIdForCalc, comboIds, _em, _cm);
            for (const [k, v] of Object.entries(rule.synergy)) {
              if (v) base[k] = (base[k] || 0) + v;
            }
            if (scoreSynergy(base) === 0) continue;
            all.push({
              kind: "combo",
              combo: items as MstSlotItemData[],
              netStats: base,
            });
          }
        }
      }
      return all;
    };

    return {
      triple: groupByMultiStat(buildEquipEntries(effects.triple_rules, 3)),
      quad: groupByMultiStat(buildEquipEntries(effects.quad_rules, 4)),
    };
  });

  const compatibleShips = createMemo(() => {
    const ships = Object.values(getMasterShips())
      .filter((ship) => ship.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id));

    const rows = ships
      .map((ship) => ({
        ship,
        compat: getCompatibilityMeta(ship, props.equip),
      }))
      .filter(
        (row) => row.compat.normalSlots.length > 0 || row.compat.exslot != null,
      );

    return groupBy(
      rows,
      (row) => STYPE_NAMES[row.ship.stype] ?? `艦種${row.ship.stype}`,
    );
  });

  type EquipMobShipEntry = {
    ship: MstShipData;
    single: { before: number; after: number } | null;
    partners: Array<{ equip: MstSlotItemData; before: number; after: number }>;
  };

  const equipMobilitySynergies = createMemo(() => {
    const effects = getSlotItemEffects();
    const equipId = props.equip.id;
    const equipLeng = Number(props.equip.leng ?? 0);

    const speedMap = new Map<number, EquipMobShipEntry>();
    const rangeMap = new Map<number, EquipMobShipEntry>();

    const getOrCreate = (
      map: Map<number, EquipMobShipEntry>,
      ship: MstShipData,
    ): EquipMobShipEntry => {
      let e = map.get(ship.id);
      if (!e) {
        e = { ship, single: null, partners: [] };
        map.set(ship.id, e);
      }
      return e;
    };

    if (!effects) return { speedEntries: [], rangeEntries: [] };

    const singleEntries = normalizeEffects(effects)[String(equipId)] ?? [];

    // Cross entries involving this equip
    const _crossMapLocal = normalizeCrossEffects(effects);
    const crossEntriesByPartner: Array<{
      partnerId: number;
      entry: CrossEffect;
    }> = [];
    for (const [pairKey, entries] of Object.entries(_crossMapLocal)) {
      const [a, b] = pairKey.split(":").map(Number);
      if (a !== equipId && b !== equipId) continue;
      const partnerId = a === equipId ? b : a;
      for (const entry of entries) {
        crossEntriesByPartner.push({ partnerId, entry });
      }
    }

    // ── Speed synergy — derived from actual gameplay observations ──
    // No assumptions are made about which item IDs affect speed.
    // For this item, we look for any ship+tier where this item appears in the
    // intersection of item_ids across ALL observations of that tier.
    // Items only present in SOME observations (incidental gear like guns)
    // are filtered out by the intersection.
    {
      const speedData = getSokuSpeedData();
      if (speedData) {
        for (const ship of Object.values(getMasterShips())) {
          if (ship.id >= ENEMY_ID_THRESHOLD) continue;
          const masterObs = speedData[ship.id];
          if (!masterObs) continue;

          // Group speed-upgrade observations by speed tier.
          const tierMap = new Map<number, number[][]>();
          for (const obs of masterObs) {
            if (obs.soku_observed <= ship.soku) continue;
            const list = tierMap.get(obs.soku_observed);
            if (list) list.push(obs.item_ids);
            else tierMap.set(obs.soku_observed, [obs.item_ids]);
          }

          for (const [sokuTier, idArrays] of tierMap) {
            // Intersect all item_id arrays for this tier.
            // Items in the intersection are present in every observation and
            // are therefore reliably required — not incidental.
            let required = [...idArrays[0]];
            for (let k = 1; k < idArrays.length; k++) {
              required = intersectSorted(required, idArrays[k]);
            }

            // Determine whether equipId is a reliable contributor to this tier.
            // If intersection is non-empty, equipId must appear there.
            // If intersection is empty (disjoint observations), fall back to
            // checking any single observation — same conservative behaviour
            // as equip-calc.ts.
            const isReliable =
              required.length > 0
                ? required.includes(equipId)
                : idArrays.some((ids) => ids.includes(equipId));

            if (!isReliable) continue;

            // Partners = other items in the reliable required set.
            // Remove exactly one occurrence of equipId to compute partners.
            const requiredForPartners =
              required.length > 0
                ? required
                : (idArrays.find((ids) => ids.includes(equipId)) ?? []);
            const withoutSelf = [...requiredForPartners];
            const selfIdx = withoutSelf.indexOf(equipId);
            if (selfIdx !== -1) withoutSelf.splice(selfIdx, 1);

            const e = getOrCreate(speedMap, ship);
            if (withoutSelf.length === 0) {
              if (!e.single || sokuTier > e.single.after) {
                e.single = { before: ship.soku, after: sokuTier };
              }
            } else {
              for (const pid of withoutSelf) {
                const partnerItem = getMasterSlotItem(pid);
                if (!partnerItem) continue;
                if (
                  !e.partners.some(
                    (p) =>
                      p.equip.id === partnerItem.id && p.after === sokuTier,
                  )
                ) {
                  e.partners.push({
                    equip: partnerItem,
                    before: ship.soku,
                    after: sokuTier,
                  });
                }
              }
            }
          }
        }
      }
    }

    // ── Range synergy ──
    // Single leng bonus — map shipId → maxBonus
    const singleLengByShip = new Map<number, number>();
    for (const entry of singleEntries) {
      const maxLeng = Math.max(
        entry.b?.leng ?? 0,
        entry.l?.leng ?? 0,
        entry.c2?.leng ?? 0,
        entry.c3?.leng ?? 0,
      );
      if (maxLeng === 0) continue;
      for (const shipId of entry.ships) {
        const cur = singleLengByShip.get(shipId) ?? 0;
        if (maxLeng > cur) singleLengByShip.set(shipId, maxLeng);
      }
    }
    for (const [shipId, bonus] of singleLengByShip) {
      const ship = getMasterShip(shipId);
      if (!ship || ship.id >= ENEMY_ID_THRESHOLD) continue;
      const after = Math.max(ship.leng, equipLeng) + bonus;
      if (after === ship.leng) continue;
      const e = getOrCreate(rangeMap, ship);
      if (!e.single) e.single = { before: ship.leng, after };
    }
    // Cross leng synergy
    for (const { partnerId, entry } of crossEntriesByPartner) {
      const leng = entry.synergy.leng ?? 0;
      if (leng === 0) continue;
      const partner = getMasterSlotItem(partnerId);
      if (!partner || partner.id >= ENEMY_ID_THRESHOLD) continue;
      for (const shipId of entry.ships) {
        const ship = getMasterShip(shipId);
        if (!ship || ship.id >= ENEMY_ID_THRESHOLD) continue;
        const after =
          Math.max(ship.leng, equipLeng, Number(partner.leng ?? 0)) + leng;
        if (after === ship.leng) continue;
        const e = getOrCreate(rangeMap, ship);
        if (!e.partners.some((p) => p.equip.id === partner.id)) {
          e.partners.push({ equip: partner, before: ship.leng, after });
        }
      }
    }
    // Leng-stacking pairs: this equip + another equip both give leng bonus
    // for the same ship, and combined range exceeds either alone.
    for (const [shipId, thisBonus] of singleLengByShip) {
      const ship = getMasterShip(shipId);
      if (!ship || ship.id >= ENEMY_ID_THRESHOLD) continue;
      const thisAfter = Math.max(ship.leng, equipLeng) + thisBonus;

      for (const [otherEquipIdStr, otherEntries] of Object.entries(
        normalizeEffects(effects),
      )) {
        const otherEquipId = Number(otherEquipIdStr);
        if (otherEquipId === equipId) continue;
        const otherEquip = getMasterSlotItem(otherEquipId);
        if (!otherEquip || otherEquip.id >= ENEMY_ID_THRESHOLD) continue;
        const otherEntry = otherEntries.find((e) => e.ships.includes(shipId));
        if (!otherEntry) continue;
        const otherMaxLeng = Math.max(
          otherEntry.b?.leng ?? 0,
          otherEntry.l?.leng ?? 0,
          otherEntry.c2?.leng ?? 0,
          otherEntry.c3?.leng ?? 0,
        );
        if (otherMaxLeng === 0) continue;

        const pairKey = `${Math.min(equipId, otherEquipId)}:${Math.max(equipId, otherEquipId)}`;
        const crossEntry = _crossMapLocal[pairKey]?.find((e) =>
          e.ships.includes(shipId),
        );
        const crossLeng = crossEntry?.synergy.leng ?? 0;
        const effectiveBase = Math.max(
          ship.leng,
          equipLeng,
          Number(otherEquip.leng ?? 0),
        );
        const combinedAfter =
          effectiveBase + thisBonus + otherMaxLeng + crossLeng;
        const otherAfter =
          Math.max(ship.leng, Number(otherEquip.leng ?? 0)) + otherMaxLeng;
        if (combinedAfter <= Math.max(thisAfter, otherAfter)) continue;

        const e = getOrCreate(rangeMap, ship);
        if (!e.partners.some((p) => p.equip.id === otherEquip.id)) {
          e.partners.push({
            equip: otherEquip,
            before: ship.leng,
            after: combinedAfter,
          });
        }
      }
    }

    const sortFn = (a: EquipMobShipEntry, b: EquipMobShipEntry) =>
      (a.ship.sort_id ?? a.ship.id) - (b.ship.sort_id ?? b.ship.id);
    const speedEntries = [...speedMap.values()].sort(sortFn);
    const rangeEntries = [...rangeMap.values()].sort(sortFn);
    return { speedEntries, rangeEntries };
  });

  const specRows = createMemo<Array<[label: string, value: string | number]>>(
    () => {
      const rows: Array<[label: string, value: string | number]> = [
        ["ID", props.equip.id],
        ["種別", equipDisplayTypeName(props.equip)],
        ["射程", rangeDisplay(props.equip.leng)],
        ["半径", statValueOrDash(props.equip.distance)],
        ["火力", statValueOrDash(props.equip.houg)],
        ["雷装", statValueOrDash(props.equip.raig)],
        ["対空", statValueOrDash(props.equip.tyku)],
        ["対潜", statValueOrDash(props.equip.tais)],
        ["爆装", statValueOrDash(props.equip.baku)],
        ["索敵", statValueOrDash(props.equip.saku)],
        ["命中", statValueOrDash(props.equip.houm)],
        ["装甲", statValueOrDash(props.equip.souk)],
        ["回避", statValueOrDash(props.equip.kaih)],
      ];
      return rows;
    },
  );

  return (
    <article class="rounded-xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
      <div class="px-4 py-3 border-b border-base-200 bg-linear-to-r from-accent/10 to-transparent">
        <h2 class="font-semibold">装備詳細</h2>
      </div>

      <div class="p-4 space-y-4">
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] gap-4 items-stretch">
          <div class="relative rounded-xl border border-base-300/70 bg-linear-to-b from-base-200 to-base-100 p-3 min-h-64 h-full xl:max-w-sm flex items-end justify-center overflow-hidden">
            <ImageFallbackBox
              src={equipImageUrl(props.equip.id)}
              alt={props.equip.name}
              class="w-full h-56"
              objectClass="w-full h-full object-contain object-center"
              fallbackText="No Image"
            />
            <span class="absolute top-3 left-3 inline-flex h-7 items-center justify-center rounded bg-base-100/92 border border-base-300/70 px-1.5 shadow-sm">
              <WeaponIcon iconNum={props.equip.type?.[3] ?? 0} />
            </span>
          </div>
          <div class="min-w-0 h-full flex flex-col gap-3">
            <h3 class="text-2xl font-bold leading-tight">{props.equip.name}</h3>
            <div class="mt-auto">
              <SpecTable rows={specRows()} />
            </div>
          </div>
        </div>

        <section>
          <h4 class="font-medium mb-2">この装備のシナジー対象艦</h4>
          <Show
            when={equipSynergyShips().length > 0}
            fallback={
              <div class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-sm text-base-content/50 text-center">
                この装備に設定されたシナジー対象艦はありません
              </div>
            }
          >
            <div
              class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2 pr-1 mb-4 ${props.expandSynergyShips ? "" : "max-h-[36vh] overflow-y-auto"}`}
            >
              <For each={equipSynergyShips()}>
                {(row) => (
                  <div class="w-full flex flex-col rounded-lg border border-base-300/70 p-2 hover:border-primary/45 transition">
                    <button
                      class="flex items-center gap-2 min-w-0 w-full text-left hover:underline"
                      onClick={() => props.onOpenShip(row.ship.id)}
                      title={row.ship.name}
                    >
                      <ImageFallbackBox
                        src={bannerUrl(row.ship.id)}
                        alt={row.ship.name}
                        class="w-20 h-6 rounded shrink-0"
                        fallbackText="No Image"
                      />
                      <span class="text-sm font-medium truncate">
                        {row.ship.name}
                      </span>
                    </button>

                    <Show
                      when={
                        row.base != null &&
                        scoreSynergy(row.base ?? undefined) > 0
                      }
                    >
                      <div class="mt-2 text-xs text-base-content/70 inline-flex items-center h-5">
                        単体シナジー
                      </div>
                      <SynergyStatInline stats={row.base!} />
                    </Show>
                    <Show
                      when={
                        row.star10 != null &&
                        scoreSynergy(row.star10 ?? undefined) > 0
                      }
                    >
                      <div class="mt-1 text-xs text-base-content/70 inline-flex items-center h-5">
                        改修★10
                      </div>
                      <SynergyStatInline stats={row.star10!} />
                    </Show>
                    <For each={stackingSynergyRows(row.c2, row.c3)}>
                      {(stackRow) => (
                        <>
                          <div class="mt-1 text-xs text-base-content/70 inline-flex items-center h-5">
                            {stackRow.label}
                          </div>
                          <SynergyStatInline stats={stackRow.stats} />
                        </>
                      )}
                    </For>

                    <Show when={row.partners.length > 0}>
                      <div class="mt-2 text-xs font-medium text-base-content/60 inline-flex items-center h-5">
                        他装備組み合わせ
                      </div>
                      <div class="space-y-1 mt-1">
                        <For each={row.partners.slice(0, 8)}>
                          {(partner) => (
                            <div class="rounded border border-base-300/70 p-1.5">
                              <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                                <button
                                  class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                  onClick={() =>
                                    props.onOpenEquip(props.equip.id)
                                  }
                                  title={props.equip.name}
                                >
                                  <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                    <WeaponIcon
                                      iconNum={props.equip.type?.[3] ?? 0}
                                    />
                                  </span>
                                  <span class="truncate max-w-40">
                                    {props.equip.name}
                                  </span>
                                </button>
                                <span>+</span>
                                <button
                                  class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                  onClick={() =>
                                    props.onOpenEquip(partner.equip.id)
                                  }
                                  title={partner.equip.name}
                                >
                                  <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                    <WeaponIcon
                                      iconNum={partner.equip.type?.[3] ?? 0}
                                    />
                                  </span>
                                  <span class="truncate max-w-40">
                                    {partner.equip.name}
                                  </span>
                                </button>
                              </div>
                              <SynergyStatInline stats={partner.stats} />
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section>
          <h4 class="font-medium mb-2">この装備の速力シナジー対象艦</h4>
          <Show
            when={equipMobilitySynergies().speedEntries.length > 0}
            fallback={
              <div class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-sm text-base-content/50 text-center">
                この装備に設定された速力シナジー対象艦はありません
              </div>
            }
          >
            <div
              class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2 pr-1 mb-4 ${props.expandSynergyShips ? "" : "max-h-[36vh] overflow-y-auto"}`}
            >
              <For each={equipMobilitySynergies().speedEntries.slice(0, 60)}>
                {(entry) => (
                  <div class="w-full flex flex-col rounded-lg border border-base-300/70 p-2 hover:border-primary/45 transition">
                    <button
                      class="flex items-center gap-2 min-w-0 w-full text-left hover:underline"
                      onClick={() => props.onOpenShip(entry.ship.id)}
                      title={entry.ship.name}
                    >
                      <ImageFallbackBox
                        src={bannerUrl(entry.ship.id)}
                        alt={entry.ship.name}
                        class="w-20 h-6 rounded shrink-0"
                        fallbackText="No Image"
                      />
                      <span class="text-sm font-medium truncate">
                        {entry.ship.name}
                      </span>
                    </button>
                    <Show when={entry.single != null}>
                      <div class="mt-2 text-xs text-base-content/70 inline-flex items-center h-5">
                        単体
                      </div>
                      <div class="flex flex-wrap items-center gap-1">
                        <span
                          class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                            entry.single!.after - entry.single!.before > 0
                              ? "border-info/55 text-info"
                              : "border-error/45 text-error"
                          }`}
                        >
                          速力 {speedDisplay(entry.single!.before)} →{" "}
                          {speedDisplay(entry.single!.after)}
                        </span>
                      </div>
                    </Show>
                    <Show when={entry.partners.length > 0}>
                      <div class="mt-2 text-xs font-medium text-base-content/60 inline-flex items-center h-5">
                        他装備組み合わせ
                      </div>
                      <div class="space-y-1 mt-1">
                        <For each={entry.partners.slice(0, 8)}>
                          {(partner) => (
                            <div class="rounded border border-base-300/70 p-1.5">
                              <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                                <button
                                  class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                  onClick={() =>
                                    props.onOpenEquip(props.equip.id)
                                  }
                                  title={props.equip.name}
                                >
                                  <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                    <WeaponIcon
                                      iconNum={props.equip.type?.[3] ?? 0}
                                    />
                                  </span>
                                  <span class="truncate max-w-40">
                                    {props.equip.name}
                                  </span>
                                </button>
                                <span>+</span>
                                <button
                                  class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                  onClick={() =>
                                    props.onOpenEquip(partner.equip.id)
                                  }
                                  title={partner.equip.name}
                                >
                                  <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                    <WeaponIcon
                                      iconNum={partner.equip.type?.[3] ?? 0}
                                    />
                                  </span>
                                  <span class="truncate max-w-40">
                                    {partner.equip.name}
                                  </span>
                                </button>
                              </div>
                              <div class="flex flex-wrap items-center gap-1 mt-1">
                                <span
                                  class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                                    partner.after - partner.before > 0
                                      ? "border-info/55 text-info"
                                      : "border-error/45 text-error"
                                  }`}
                                >
                                  速力 {speedDisplay(partner.before)} →{" "}
                                  {speedDisplay(partner.after)}
                                </span>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section>
          <h4 class="font-medium mb-2">この装備の射程シナジー対象艦</h4>
          <Show
            when={equipMobilitySynergies().rangeEntries.length > 0}
            fallback={
              <div class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-sm text-base-content/50 text-center">
                この装備に設定された射程シナジー対象艦はありません
              </div>
            }
          >
            <div
              class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2 pr-1 mb-4 ${props.expandSynergyShips ? "" : "max-h-[36vh] overflow-y-auto"}`}
            >
              <For each={equipMobilitySynergies().rangeEntries.slice(0, 60)}>
                {(entry) => (
                  <div class="w-full flex flex-col rounded-lg border border-base-300/70 p-2 hover:border-primary/45 transition">
                    <button
                      class="flex items-center gap-2 min-w-0 w-full text-left hover:underline"
                      onClick={() => props.onOpenShip(entry.ship.id)}
                      title={entry.ship.name}
                    >
                      <ImageFallbackBox
                        src={bannerUrl(entry.ship.id)}
                        alt={entry.ship.name}
                        class="w-20 h-6 rounded shrink-0"
                        fallbackText="No Image"
                      />
                      <span class="text-sm font-medium truncate">
                        {entry.ship.name}
                      </span>
                    </button>
                    <Show when={entry.single != null}>
                      <div class="mt-2 text-xs text-base-content/70 inline-flex items-center h-5">
                        単体
                      </div>
                      <div class="flex flex-wrap items-center gap-1">
                        <span
                          class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                            entry.single!.after - entry.single!.before > 0
                              ? "border-info/55 text-info"
                              : "border-error/45 text-error"
                          }`}
                        >
                          射程 {rangeDisplay(entry.single!.before)} →{" "}
                          {rangeDisplay(entry.single!.after)}
                        </span>
                      </div>
                    </Show>
                    <Show when={entry.partners.length > 0}>
                      <div class="mt-2 text-xs font-medium text-base-content/60 inline-flex items-center h-5">
                        他装備組み合わせ
                      </div>
                      <div class="space-y-1 mt-1">
                        <For each={entry.partners.slice(0, 8)}>
                          {(partner) => (
                            <div class="rounded border border-base-300/70 p-1.5">
                              <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                                <button
                                  class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                  onClick={() =>
                                    props.onOpenEquip(props.equip.id)
                                  }
                                  title={props.equip.name}
                                >
                                  <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                    <WeaponIcon
                                      iconNum={props.equip.type?.[3] ?? 0}
                                    />
                                  </span>
                                  <span class="truncate max-w-40">
                                    {props.equip.name}
                                  </span>
                                </button>
                                <span>+</span>
                                <button
                                  class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                  onClick={() =>
                                    props.onOpenEquip(partner.equip.id)
                                  }
                                  title={partner.equip.name}
                                >
                                  <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                    <WeaponIcon
                                      iconNum={partner.equip.type?.[3] ?? 0}
                                    />
                                  </span>
                                  <span class="truncate max-w-40">
                                    {partner.equip.name}
                                  </span>
                                </button>
                              </div>
                              <div class="flex flex-wrap items-center gap-1 mt-1">
                                <span
                                  class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                                    partner.after - partner.before > 0
                                      ? "border-info/55 text-info"
                                      : "border-error/45 text-error"
                                  }`}
                                >
                                  射程 {rangeDisplay(partner.before)} →{" "}
                                  {rangeDisplay(partner.after)}
                                </span>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <Show
          when={
            equipMultiSynergies().triple.length > 0 ||
            equipMultiSynergies().quad.length > 0
          }
        >
          <section>
            <h4 class="font-medium mb-1">この装備を含む多装備シナジー</h4>
            <p class="text-xs text-base-content/50 mb-2">
              この装備が含まれる3・4装備の組み合わせ。ステータス種別ごとにグループ表示。
            </p>
            <div class="space-y-4">
              <Show when={equipMultiSynergies().triple.length > 0}>
                <div class="rounded-lg border border-base-300/70 p-2">
                  <h5 class="text-sm font-medium mb-2">3装備シナジー</h5>
                  <div class="space-y-3">
                    <For each={equipMultiSynergies().triple}>
                      {(group) => (
                        <div>
                          <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                            {group.label}系{" "}
                            <span class="font-normal text-base-content/40">
                              （{group.entries.length}件）
                            </span>
                          </h6>
                          <div
                            class={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${props.expandSynergyShips ? "" : "max-h-[36vh] overflow-y-auto"}`}
                          >
                            <For each={group.entries}>
                              {(entry) =>
                                entry.kind === "pool" ? (
                                  <div class="rounded border border-accent/30 bg-accent/5 p-2 space-y-1">
                                    <p class="text-[10px] text-accent/70 leading-tight">
                                      この中から
                                      {(entry as MultiPoolEntry).comboSize}
                                      個を同時装備（補正値）
                                    </p>
                                    <div class="flex flex-wrap items-center gap-1 text-xs text-base-content/70">
                                      <For
                                        each={(entry as MultiPoolEntry).pool}
                                      >
                                        {(equip, idx) => (
                                          <>
                                            <Show when={idx() > 0}>
                                              <span class="text-base-content/30">
                                                ·
                                              </span>
                                            </Show>
                                            <button
                                              class={`inline-flex items-center gap-0.5 min-w-0 hover:underline ${equip.id === props.equip.id ? "font-semibold text-accent" : ""}`}
                                              onClick={() =>
                                                props.onOpenEquip(equip.id)
                                              }
                                              title={equip.name}
                                            >
                                              <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={equip.type?.[3] ?? 0}
                                                />
                                              </span>
                                              <span class="truncate max-w-28">
                                                {equip.name}
                                              </span>
                                            </button>
                                          </>
                                        )}
                                      </For>
                                    </div>
                                    <SynergyStatInline
                                      stats={
                                        (entry as MultiPoolEntry).correction
                                      }
                                    />
                                  </div>
                                ) : (
                                  <div class="rounded border border-base-300/70 p-2 space-y-1">
                                    <div class="flex flex-wrap items-center gap-1 text-xs text-base-content/70">
                                      <For
                                        each={(entry as MultiComboEntry).combo}
                                      >
                                        {(equip, idx) => (
                                          <>
                                            <Show when={idx() > 0}>
                                              <span class="text-base-content/30">
                                                +
                                              </span>
                                            </Show>
                                            <button
                                              class={`inline-flex items-center gap-1 min-w-0 hover:underline ${equip.id === props.equip.id ? "font-semibold text-accent" : ""}`}
                                              onClick={() =>
                                                props.onOpenEquip(equip.id)
                                              }
                                              title={equip.name}
                                            >
                                              <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={equip.type?.[3] ?? 0}
                                                />
                                              </span>
                                              <span class="truncate max-w-32">
                                                {equip.name}
                                              </span>
                                            </button>
                                          </>
                                        )}
                                      </For>
                                    </div>
                                    <SynergyStatInline
                                      stats={
                                        (entry as MultiComboEntry).netStats
                                      }
                                    />
                                  </div>
                                )
                              }
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <Show when={equipMultiSynergies().quad.length > 0}>
                <div class="rounded-lg border border-base-300/70 p-2">
                  <h5 class="text-sm font-medium mb-2">4装備シナジー</h5>
                  <div class="space-y-3">
                    <For each={equipMultiSynergies().quad}>
                      {(group) => (
                        <div>
                          <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                            {group.label}系{" "}
                            <span class="font-normal text-base-content/40">
                              （{group.entries.length}件）
                            </span>
                          </h6>
                          <div
                            class={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${props.expandSynergyShips ? "" : "max-h-[30vh] overflow-y-auto"}`}
                          >
                            <For each={group.entries}>
                              {(entry) =>
                                entry.kind === "pool" ? (
                                  <div class="rounded border border-accent/30 bg-accent/5 p-2 space-y-1">
                                    <p class="text-[10px] text-accent/70 leading-tight">
                                      この中から
                                      {(entry as MultiPoolEntry).comboSize}
                                      個を同時装備（補正値）
                                    </p>
                                    <div class="flex flex-wrap items-center gap-1 text-xs text-base-content/70">
                                      <For
                                        each={(entry as MultiPoolEntry).pool}
                                      >
                                        {(equip, idx) => (
                                          <>
                                            <Show when={idx() > 0}>
                                              <span class="text-base-content/30">
                                                ·
                                              </span>
                                            </Show>
                                            <button
                                              class={`inline-flex items-center gap-0.5 min-w-0 hover:underline ${equip.id === props.equip.id ? "font-semibold text-accent" : ""}`}
                                              onClick={() =>
                                                props.onOpenEquip(equip.id)
                                              }
                                              title={equip.name}
                                            >
                                              <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={equip.type?.[3] ?? 0}
                                                />
                                              </span>
                                              <span class="truncate max-w-28">
                                                {equip.name}
                                              </span>
                                            </button>
                                          </>
                                        )}
                                      </For>
                                    </div>
                                    <SynergyStatInline
                                      stats={
                                        (entry as MultiPoolEntry).correction
                                      }
                                    />
                                  </div>
                                ) : (
                                  <div class="rounded border border-base-300/70 p-2 space-y-1">
                                    <div class="flex flex-wrap items-center gap-1 text-xs text-base-content/70">
                                      <For
                                        each={(entry as MultiComboEntry).combo}
                                      >
                                        {(equip, idx) => (
                                          <>
                                            <Show when={idx() > 0}>
                                              <span class="text-base-content/30">
                                                +
                                              </span>
                                            </Show>
                                            <button
                                              class={`inline-flex items-center gap-1 min-w-0 hover:underline ${equip.id === props.equip.id ? "font-semibold text-accent" : ""}`}
                                              onClick={() =>
                                                props.onOpenEquip(equip.id)
                                              }
                                              title={equip.name}
                                            >
                                              <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={equip.type?.[3] ?? 0}
                                                />
                                              </span>
                                              <span class="truncate max-w-32">
                                                {equip.name}
                                              </span>
                                            </button>
                                          </>
                                        )}
                                      </For>
                                    </div>
                                    <SynergyStatInline
                                      stats={
                                        (entry as MultiComboEntry).netStats
                                      }
                                    />
                                  </div>
                                )
                              }
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </section>
        </Show>

        <section>
          <h4 class="font-medium mb-2">装備可能な艦</h4>
          <p class="text-xs text-base-content/55 mb-2">
            補強増設の装備条件は表示しています。改修値が必要な条件は「補強枠条件」に併記します。
          </p>
          <div
            class={`space-y-3 pr-1 ${props.expandCompatibleShips ? "" : "max-h-[40vh] overflow-y-auto"}`}
          >
            <For each={compatibleShips()}>
              {(group) => (
                <div class="rounded-lg border border-base-300/70 p-2">
                  <h5 class="text-sm font-medium mb-2">{group.key}</h5>
                  <div class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-1.5">
                    <For each={group.items}>
                      {(row) => {
                        return (
                          <button
                            class="w-full text-left rounded border border-base-300/70 hover:border-primary/45 px-2 py-1.5 transition"
                            onClick={() => props.onOpenShip(row.ship.id)}
                            title={row.ship.name}
                          >
                            <div class="flex items-center gap-2 min-w-0">
                              <ImageFallbackBox
                                src={bannerUrl(row.ship.id)}
                                alt={row.ship.name}
                                class="w-20 h-6 rounded shrink-0"
                                fallbackText="No Image"
                              />
                              <span class="text-xs truncate flex-1">
                                {row.ship.name}
                              </span>
                              <CompatibilityBadges
                                normalSlots={row.compat.normalSlots}
                                slotCount={row.ship.slot_num}
                                exslot={row.compat.exslot}
                              />
                            </div>
                            <Show
                              when={
                                row.compat.exslot != null &&
                                (row.compat.exslot.level > 0 ||
                                  row.compat.exslot.alv > 0)
                              }
                            >
                              <p class="text-[10px] text-warning mt-1">
                                {`補強枠条件: ${[
                                  row.compat.exslot!.level > 0
                                    ? `改修★${row.compat.exslot!.level}`
                                    : null,
                                  row.compat.exslot!.alv > 0
                                    ? `熟練${row.compat.exslot!.alv}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" / ")}`}
                              </p>
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>
              )}
            </For>
            <Show when={compatibleShips().length === 0}>
              <div class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-sm text-base-content/50 text-center">
                装備可能な艦はありません
              </div>
            </Show>
          </div>
        </section>
      </div>
    </article>
  );
}

function SimulatorDetailsCatalog(): JSX.Element {
  const [tab, setTab] = createSignal<DetailsTab>("ship");
  const [shipQuery, setShipQuery] = createSignal("");
  const [equipQuery, setEquipQuery] = createSignal("");
  const [selectedShipCategory, setSelectedShipCategory] = createSignal("all");
  const [selectedEquipCategory, setSelectedEquipCategory] = createSignal("all");
  const [selectedShipId, setSelectedShipId] = createSignal<number | null>(null);
  const [selectedEquipId, setSelectedEquipId] = createSignal<number | null>(
    null,
  );
  const [initialShipIdFromUrl, setInitialShipIdFromUrl] = createSignal<
    number | null
  >(null);
  const [initialEquipIdFromUrl, setInitialEquipIdFromUrl] = createSignal<
    number | null
  >(null);
  const [urlStateReady, setUrlStateReady] = createSignal(false);
  const [expandSettings, setExpandSettings] = createSignal<ListExpandSettings>(
    DEFAULT_EXPAND_SETTINGS,
  );
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  let settingsDialogRef!: HTMLDialogElement;
  const [helpOpen, setHelpOpen] = createSignal(false);
  let helpDialogRef!: HTMLDialogElement;

  const allExpanded = createMemo(() => {
    const s = expandSettings();
    return (
      s.expandEquippableEquip &&
      s.expandSingleSynergy &&
      s.expandPairSynergy &&
      s.expandSynergyShips &&
      s.expandCompatibleShips
    );
  });

  createEffect(() => {
    if (settingsOpen()) settingsDialogRef.showModal();
    else settingsDialogRef.close();
  });

  createEffect(() => {
    if (helpOpen()) helpDialogRef.showModal();
    else helpDialogRef.close();
  });

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get("tab");
    if (initialTab === "ship" || initialTab === "equip") {
      setTab(initialTab);
    }
    setInitialShipIdFromUrl(parsePositiveInt(params.get("ship")));
    setInitialEquipIdFromUrl(parsePositiveInt(params.get("equip")));
    setUrlStateReady(true);

    window.addEventListener("simulator-tab-changed", (e: any) => {
      const newTab = e.detail;
      if (newTab === "ship" || newTab === "equip") {
        setTab(newTab);
      }
    });

    window.addEventListener("simulator-master-data-loaded", () => {
      setDataLoaded(true);
    });
  });

  createEffect(() => {
    // Notify external tab system when tab changes internally
    window.dispatchEvent(new CustomEvent("simulator-tab-changed-sync", { detail: tab() }));
  });

  const [dataLoaded, setDataLoaded] = createSignal(hasMasterData());

  const allShips = createMemo(() => {
    if (!dataLoaded()) return [];
    return Object.values(getMasterShips())
      .filter((ship) => ship.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id));
  });

  const allEquips = createMemo(() => {
    if (!dataLoaded()) return [];
    return Object.values(getMasterSlotItems())
      .filter((equip) => equip.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => a.sortno - b.sortno);
  });

  const shipCategories = createMemo(() =>
    [
      ...new Set(
        allShips().map(
          (ship) => STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`,
        ),
      ),
    ].sort((a, b) => a.localeCompare(b, "ja")),
  );

  const equipCategories = createMemo(() =>
    [...new Set(allEquips().map((equip) => equipDisplayTypeName(equip)))].sort(
      (a, b) => a.localeCompare(b, "ja"),
    ),
  );

  const filteredShips = createMemo(() => {
    const selectedCategory = selectedShipCategory();
    const q = shipQuery().trim().toLowerCase();
    return allShips().filter((ship) => {
      const category = STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`;
      if (selectedCategory !== "all" && category !== selectedCategory)
        return false;
      if (!q) return true;
      return ship.name.toLowerCase().includes(q) || String(ship.id).includes(q);
    });
  });

  const filteredEquips = createMemo(() => {
    const selectedCategory = selectedEquipCategory();
    const q = equipQuery().trim().toLowerCase();
    return allEquips().filter((equip) => {
      const category = equipDisplayTypeName(equip);
      if (selectedCategory !== "all" && category !== selectedCategory)
        return false;
      if (!q) return true;
      return (
        equip.name.toLowerCase().includes(q) || String(equip.id).includes(q)
      );
    });
  });

  const selectedShip = createMemo(() => {
    const id = selectedShipId();
    return id == null ? null : getMasterShip(id);
  });

  const selectedEquip = createMemo(() => {
    const id = selectedEquipId();
    return id == null ? null : getMasterSlotItem(id);
  });

  const groupedShips = createMemo(() =>
    groupBy(
      filteredShips(),
      (ship) => STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`,
    ),
  );

  const groupedEquips = createMemo(() =>
    groupBy(filteredEquips(), (equip) => equipDisplayTypeName(equip)),
  );

  function parsePositiveInt(raw: string | null): number | null {
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) return null;
    return value;
  }

  function buildCurrentShareUrl(): string | null {
    const currentTab = tab();
    const currentShipId = selectedShipId();
    const currentEquipId = selectedEquipId();
    const key =
      currentTab === "ship"
        ? currentShipId != null
          ? `ship:${currentShipId}`
          : null
        : currentEquipId != null
          ? `equip:${currentEquipId}`
          : null;
    if (!key) return null;

    return buildShareDetailUrl(window.location.origin, {
      kind: currentTab,
      id: currentTab === "ship" ? currentShipId! : currentEquipId!,
    });
  }

  async function issueShareUrl(): Promise<void> {
    const shareUrl = buildCurrentShareUrl();
    if (!shareUrl) {
      alert("共有URLを生成できませんでした。艦または装備を選択してください。");
      return;
    }

    const copied = await copyTextWithFallback(shareUrl);
    if (copied) {
      alert("共有URLをクリップボードにコピーしました");
      return;
    }

    window.prompt(
      "自動コピーに失敗しました。以下を手動でコピーしてください:",
      shareUrl,
    );
  }

  createEffect(() => {
    if (selectedShipId() == null && allShips().length > 0) {
      setSelectedShipId(allShips()[0].id);
    }
    if (selectedEquipId() == null && allEquips().length > 0) {
      setSelectedEquipId(allEquips()[0].id);
    }
  });

  // Apply URL-specified ship/equip IDs once master data loads.
  createEffect(() => {
    if (!urlStateReady() || !dataLoaded()) return;
    const shipFromQuery = initialShipIdFromUrl();
    if (shipFromQuery != null && getMasterShip(shipFromQuery)) {
      setSelectedShipId(shipFromQuery);
    }

    const equipFromQuery = initialEquipIdFromUrl();
    if (equipFromQuery != null && getMasterSlotItem(equipFromQuery)) {
      setSelectedEquipId(equipFromQuery);
    }
  });

  createEffect(() => {
    if (!urlStateReady()) return;
    const currentTab = tab();
    const currentShipId = selectedShipId();
    const currentEquipId = selectedEquipId();
    const url = new URL(window.location.href);
    url.searchParams.set("tab", currentTab);

    if (currentTab === "ship" && currentShipId != null) {
      url.searchParams.set("ship", String(currentShipId));
    } else {
      url.searchParams.delete("ship");
    }

    if (currentTab === "equip" && currentEquipId != null) {
      url.searchParams.set("equip", String(currentEquipId));
    } else {
      url.searchParams.delete("equip");
    }

    window.history.replaceState(window.history.state, "", url.toString());
  });

  onMount(() => {
    const btnSettings = document.getElementById("sim-details-settings-btn");
    const btnHelp = document.getElementById("sim-details-help-btn");
    const btnShare = document.getElementById("sim-details-share-btn");

    const onSettingsClick = () => setSettingsOpen(true);
    const onHelpClick = () => setHelpOpen(true);
    const onShareClick = () => void issueShareUrl();

    btnSettings?.addEventListener("click", onSettingsClick);
    btnHelp?.addEventListener("click", onHelpClick);
    btnShare?.addEventListener("click", onShareClick);

    onCleanup(() => {
      btnSettings?.removeEventListener("click", onSettingsClick);
      btnHelp?.removeEventListener("click", onHelpClick);
      btnShare?.removeEventListener("click", onShareClick);
    });
  });

  return (
    <div class="space-y-4">


      <dialog
        ref={settingsDialogRef}
        class="modal"
        onClose={() => setSettingsOpen(false)}
      >
        <div class="modal-box rounded-xl">
          <h3 class="font-bold text-lg mb-1">表示設定</h3>
          <p class="text-xs text-base-content/60 mb-4">
            各リストをスクロールなしで全件表示するかどうかを設定します。
          </p>
          <div class="space-y-3 text-sm">
            <label class="label w-full cursor-pointer justify-start gap-3 py-1">
              <input
                type="checkbox"
                class="checkbox checkbox-sm shrink-0"
                checked={allExpanded()}
                onChange={(e) =>
                  setExpandSettings((prev) => ({
                    ...prev,
                    expandEquippableEquip: e.currentTarget.checked,
                    expandSingleSynergy: e.currentTarget.checked,
                    expandPairSynergy: e.currentTarget.checked,
                    expandSynergyShips: e.currentTarget.checked,
                    expandCompatibleShips: e.currentTarget.checked,
                  }))
                }
              />
              <span class="label-text font-medium">すべてのリストを展開</span>
            </label>
            <p class="text-xs text-base-content/50 font-medium pt-1">艦詳細</p>
            <label class="label w-full cursor-pointer justify-start gap-3 py-1 pl-1">
              <input
                type="checkbox"
                class="checkbox checkbox-sm shrink-0"
                checked={expandSettings().expandEquippableEquip}
                onChange={(e) =>
                  setExpandSettings((prev) => ({
                    ...prev,
                    expandEquippableEquip: e.currentTarget.checked,
                  }))
                }
              />
              <span class="label-text">装備可能な装備</span>
            </label>
            <label class="label w-full cursor-pointer justify-start gap-3 py-1 pl-1">
              <input
                type="checkbox"
                class="checkbox checkbox-sm shrink-0"
                checked={expandSettings().expandSingleSynergy}
                onChange={(e) =>
                  setExpandSettings((prev) => ({
                    ...prev,
                    expandSingleSynergy: e.currentTarget.checked,
                  }))
                }
              />
              <span class="label-text">単体装備シナジー</span>
            </label>
            <label class="label w-full cursor-pointer justify-start gap-3 py-1 pl-1">
              <input
                type="checkbox"
                class="checkbox checkbox-sm shrink-0"
                checked={expandSettings().expandPairSynergy}
                onChange={(e) =>
                  setExpandSettings((prev) => ({
                    ...prev,
                    expandPairSynergy: e.currentTarget.checked,
                  }))
                }
              />
              <span class="label-text">装備組み合わせシナジー</span>
            </label>
            <label class="label w-full cursor-pointer justify-start gap-3 py-1 pl-1">
              <input
                type="checkbox"
                class="checkbox checkbox-sm shrink-0"
                checked={expandSettings().showMultiSynergy}
                onChange={(e) =>
                  setExpandSettings((prev) => ({
                    ...prev,
                    showMultiSynergy: e.currentTarget.checked,
                  }))
                }
              />
              <span class="label-text">3装備以上のシナジーを表示</span>
            </label>
            <p class="text-xs text-base-content/50 font-medium pt-1">
              装備詳細
            </p>
            <label class="label w-full cursor-pointer justify-start gap-3 py-1 pl-1">
              <input
                type="checkbox"
                class="checkbox checkbox-sm shrink-0"
                checked={expandSettings().expandSynergyShips}
                onChange={(e) =>
                  setExpandSettings((prev) => ({
                    ...prev,
                    expandSynergyShips: e.currentTarget.checked,
                  }))
                }
              />
              <span class="label-text">シナジー対象艦</span>
            </label>
            <label class="label w-full cursor-pointer justify-start gap-3 py-1 pl-1">
              <input
                type="checkbox"
                class="checkbox checkbox-sm shrink-0"
                checked={expandSettings().expandCompatibleShips}
                onChange={(e) =>
                  setExpandSettings((prev) => ({
                    ...prev,
                    expandCompatibleShips: e.currentTarget.checked,
                  }))
                }
              />
              <span class="label-text">装備可能な艦</span>
            </label>
          </div>
          <div class="modal-action">
            <button
              class="btn btn-primary btn-sm"
              onClick={() => setSettingsOpen(false)}
            >
              閉じる
            </button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      <dialog
        ref={helpDialogRef}
        class="modal"
        onClose={() => setHelpOpen(false)}
      >
        <div class="modal-box rounded-xl max-w-2xl max-h-[82vh] overflow-y-auto">
          <h3 class="font-bold text-lg mb-4">使い方 / 表示の見かた</h3>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-2 text-base-content/80">
              ページ概要
            </h4>
            <p class="text-sm text-base-content/70 leading-relaxed">
              艦・装備のマスターデータを検索・閲覧できます。
              <strong>艦詳細</strong>
              タブでは艦のステータス・搭載可能装備・装備シナジーを、
              <strong>装備詳細</strong>
              タブでは装備のステータス・シナジー対象艦・装備可能艦を確認できます。
            </p>
          </section>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-2 text-base-content/80">
              表示ラベルの規則
            </h4>
            <div class="overflow-x-auto rounded-lg border border-base-300/70">
              <table class="table table-sm w-full text-sm">
                <thead>
                  <tr class="text-base-content/60">
                    <th class="w-32">ラベル</th>
                    <th>意味</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="font-medium">基本</td>
                    <td class="text-base-content/70">
                      ★0 で1枠装備したときの追加ステータス
                    </td>
                  </tr>
                  <tr>
                    <td class="font-medium">改修★10</td>
                    <td class="text-base-content/70">
                      ★10
                      で1枠装備したときのボーナス（基本と値が異なる場合のみ表示）
                    </td>
                  </tr>
                  <tr>
                    <td class="font-medium">2積み</td>
                    <td class="text-base-content/70">
                      同じ装備を2枠装備したときの<strong>合計</strong>
                      ボーナス（単純に 基本×2 と異なる場合のみ表示）
                    </td>
                  </tr>
                  <tr>
                    <td class="font-medium">3積み以上</td>
                    <td class="text-base-content/70">
                      同じ装備を3枠以上装備したときの合計ボーナス（2積みと値が異なる場合のみ表示）
                    </td>
                  </tr>
                  <tr>
                    <td class="font-medium">2積み以上</td>
                    <td class="text-base-content/70">
                      2積みと3積みで合計ボーナスが同じとき、まとめて表示
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                        対空+2
                      </span>
                    </td>
                    <td class="text-base-content/70">
                      青バッジ — バフ（プラス効果）
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-outline badge-sm font-mono border-error/45 text-error">
                        対空-2
                      </span>
                    </td>
                    <td class="text-base-content/70">
                      赤バッジ — デバフ（マイナス効果）
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-warning badge-xs">補強のみ</span>
                    </td>
                    <td class="text-base-content/70">
                      補強増設スロットにのみ装備可能
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-outline badge-xs border-warning text-warning">
                        補強★5
                      </span>
                    </td>
                    <td class="text-base-content/70">
                      補強増設スロットへの装備に改修値またはそうていが必要
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-3 text-base-content/80">
              装備シナジーの計算方法
            </h4>
            <div class="space-y-3 text-sm text-base-content/70 leading-relaxed">
              <p>
                装備によるステータス増減は <strong>単体装備シナジー</strong> と{" "}
                <strong>装備組み合わせシナジー</strong>{" "}
                の2種類があり、それらの合計が実際の効果です。
              </p>
              <div class="rounded-lg bg-base-200 border border-base-300/70 px-4 py-3 font-mono text-xs text-center">
                合計効果 ＝ Σ（単体シナジー） ＋ Σ（組み合わせシナジー）
              </div>
              <ul class="space-y-1 list-disc list-inside text-base-content/65">
                <li>
                  <strong>単体装備シナジー</strong>
                  ：その装備を1枠でも持つだけで発動するボーナス
                </li>
                <li>
                  <strong>装備組み合わせシナジー</strong>
                  ：特定の2種類を同時装備したときに加算される追加効果（単体シナジーとは独立して加減算される）
                </li>
              </ul>
            </div>
          </section>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-3 text-base-content/80">
              計算例
            </h4>
            <div class="space-y-4 text-sm">
              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">例1 — 単体バフ ＋ 組み合わせバフ</p>
                <div class="space-y-1 text-base-content/70">
                  <p>
                    装備A（単体シナジー:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+3
                    </span>
                    ）と 装備B（単体シナジー: なし）を同時装備
                  </p>
                  <p>
                    組み合わせシナジー A＋B:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+2
                    </span>
                  </p>
                  <p class="mt-2 font-medium text-base-content">
                    → 対空ボーナス合計 ＝ +3（単体A）＋ 0（単体B）＋
                    +2（組み合わせ）＝ <span class="text-info">+5</span>
                  </p>
                </div>
              </div>

              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">
                  例2 — 組み合わせシナジーがデバフ（赤）の場合
                </p>
                <div class="space-y-1 text-base-content/70">
                  <p>
                    装備X（単体シナジー:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+4
                    </span>
                    ）と 装備Z（単体シナジー:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+1
                    </span>
                    ）を同時装備
                  </p>
                  <p>
                    組み合わせシナジー X＋Z:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-error/45 text-error">
                      対空-2
                    </span>
                  </p>
                  <p class="mt-2 font-medium text-base-content">
                    → 対空ボーナス合計 ＝ +4（単体X）＋ +1（単体Z）＋
                    (−2)（組み合わせ）＝ <span class="text-info">+3</span>
                  </p>
                  <p class="text-xs text-base-content/55 mt-1">
                    組み合わせが赤（デバフ）でも単体シナジーは別途有効。単体の+効果が完全に消えるわけではない。
                  </p>
                </div>
              </div>

              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">
                  例3 — 2積みシナジーの読み方（表示値 ＝ <em>合計</em>）
                </p>
                <div class="space-y-1 text-base-content/70">
                  <p>装備Wの単体シナジー</p>
                  <p class="pl-3">
                    基本:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+3
                    </span>
                  </p>
                  <p class="pl-3">
                    2積み:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+4
                    </span>
                    　← これは2枠装備時の<strong>合計</strong>ボーナス
                  </p>
                  <div class="mt-2 space-y-0.5 font-medium text-base-content">
                    <p>
                      1枠装備時の対空ボーナス ＝{" "}
                      <span class="text-info">+3</span>
                    </p>
                    <p>
                      2枠装備時の対空ボーナス ＝{" "}
                      <span class="text-info">+4</span>（単純な 2×3＝+6
                      にはならない）
                    </p>
                    <p>
                      2枠目の追加分 ＝ +4 − +3 ＝{" "}
                      <span class="text-base-content/70">+1 のみ</span>
                    </p>
                  </div>
                </div>
              </div>

              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">
                  例4 — 2積みと3積みでシナジーが異なる場合
                </p>
                <div class="space-y-1 text-base-content/70">
                  <p>
                    基本:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      火力+1
                    </span>
                    　2積み:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      火力+3
                    </span>
                    　3積み以上:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      火力+4
                    </span>
                  </p>
                  <div class="mt-2 space-y-0.5 font-medium text-base-content">
                    <p>
                      1枠: <span class="text-info">+1</span>　／　2枠:{" "}
                      <span class="text-info">+3</span>（2枠目の追加
                      +2）　／　3枠以上: <span class="text-info">+4</span>
                      （3枠目の追加 +1）
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div class="modal-action">
            <button
              class="btn btn-primary btn-sm"
              onClick={() => setHelpOpen(false)}
            >
              閉じる
            </button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      <Show when={tab() === "ship"}>
        <section class="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4 items-start">
          <aside class="rounded-xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
            <div class="p-3 border-b border-base-200 bg-base-50/50 space-y-2">
              <select
                class="select select-bordered select-sm w-full"
                value={selectedShipCategory()}
                onChange={(event) =>
                  setSelectedShipCategory(event.currentTarget.value)
                }
              >
                <option value="all">すべての艦種</option>
                <For each={shipCategories()}>
                  {(category) => <option value={category}>{category}</option>}
                </For>
              </select>
              <input
                id="sim-details-search-input"
                class="input input-bordered input-sm w-full"
                placeholder="艦名 / ID で検索"
                value={shipQuery()}
                onInput={(event) => setShipQuery(event.currentTarget.value)}
              />
            </div>
            <div class="p-2 max-h-[74vh] overflow-y-auto">
              <For each={groupedShips()}>
                {(group) => (
                  <section class="mb-2 last:mb-0">
                    <h4 class="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-base-content/45 uppercase sticky top-0 bg-base-100/95 backdrop-blur-sm z-10">
                      {group.key}
                    </h4>
                    <div>
                      <For each={group.items}>
                        {(ship) => (
                          <ShipListRow
                            ship={ship}
                            active={selectedShipId() === ship.id}
                            onSelect={() => setSelectedShipId(ship.id)}
                          />
                        )}
                      </For>
                    </div>
                  </section>
                )}
              </For>
            </div>
          </aside>

          <Show
            when={selectedShip()}
            fallback={
              <div class="rounded-xl border border-base-300/70 bg-base-100 p-4 text-base-content/50">
                艦を選択してください。
              </div>
            }
          >
            {(ship) => (
              <ShipDetailPanel
                ship={ship()}
                onOpenEquip={(equipId) => {
                  setSelectedEquipId(equipId);
                  setTab("equip");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                expandEquippableEquip={expandSettings().expandEquippableEquip}
                expandSingleSynergy={expandSettings().expandSingleSynergy}
                expandPairSynergy={expandSettings().expandPairSynergy}
                showMultiSynergy={expandSettings().showMultiSynergy}
              />
            )}
          </Show>
        </section>
      </Show>

      <Show when={tab() === "equip"}>
        <section class="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4 items-start">
          <aside class="rounded-xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
            <div class="p-3 border-b border-base-200 bg-base-50/50 space-y-2">
              <select
                class="select select-bordered select-sm w-full"
                value={selectedEquipCategory()}
                onChange={(event) =>
                  setSelectedEquipCategory(event.currentTarget.value)
                }
              >
                <option value="all">すべての装備種別</option>
                <For each={equipCategories()}>
                  {(category) => <option value={category}>{category}</option>}
                </For>
              </select>
              <input
                class="input input-bordered input-sm w-full"
                placeholder="装備名 / ID で検索"
                value={equipQuery()}
                onInput={(event) => setEquipQuery(event.currentTarget.value)}
              />
            </div>
            <div class="p-2 max-h-[74vh] overflow-y-auto">
              <For each={groupedEquips()}>
                {(group) => (
                  <section class="mb-2 last:mb-0">
                    <h4 class="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-base-content/45 uppercase sticky top-0 bg-base-100/95 backdrop-blur-sm z-10">
                      {group.key}
                    </h4>
                    <div>
                      <For each={group.items}>
                        {(equip) => (
                          <EquipListRow
                            equip={equip}
                            active={selectedEquipId() === equip.id}
                            onSelect={() => setSelectedEquipId(equip.id)}
                          />
                        )}
                      </For>
                    </div>
                  </section>
                )}
              </For>
            </div>
          </aside>

          <Show
            when={selectedEquip()}
            fallback={
              <div class="rounded-xl border border-base-300/70 bg-base-100 p-4 text-base-content/50">
                装備を選択してください。
              </div>
            }
          >
            {(equip) => (
              <EquipDetailPanel
                equip={equip()}
                onOpenShip={(shipId) => {
                  setSelectedShipId(shipId);
                  setTab("ship");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                onOpenEquip={(equipId) => {
                  setSelectedEquipId(equipId);
                  setTab("equip");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                expandSynergyShips={expandSettings().expandSynergyShips}
                expandCompatibleShips={expandSettings().expandCompatibleShips}
              />
            )}
          </Show>
        </section>
      </Show>
    </div>
  );
}

export function mountSimulatorDetailsCatalog(root: HTMLElement): void {
  if (root.hasChildNodes()) return;
  render(() => <SimulatorDetailsCatalog />, root);
}
