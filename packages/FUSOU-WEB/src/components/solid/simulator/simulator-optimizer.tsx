/** @jsxImportSource solid-js */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
} from "solid-js";
import { render } from "solid-js/web";
import {
  computeEquipBonuses,
  bannerUrl,
  createWeaponIconEl,
} from "@/features/simulator/equip-calc";
import {
  getMasterEquipTypeName,
  getFleetState,
  getMasterShips,
  getMasterSlotItems,
  getSnapshotSlotItems,
  hasSnapshotShips,
  hasSnapshotSlotItems,
} from "@/features/simulator/simulator-selectors";
import {
  setEquipModalSideFilter,
  setEquipModalTargetForFleet,
  setShipModalSideFilter,
} from "@/features/simulator/simulator-mutations";
import { openShipModal } from "@/features/simulator/ship-modal";
import { openEquipModal } from "@/features/simulator/equip-modal";
import { getLoadedMasterDataMeta } from "@/features/simulator/data-loader";
import {
  ENEMY_ID_THRESHOLD,
  RANGE_NAMES,
  SPEED_NAMES,
  STYPE_NAMES,
} from "@/features/simulator/constants";
import {
  filterForExslot,
  getNormalSlotAllowedIndexes,
} from "@/features/simulator/equip-filter";
import type {
  MstShipData,
  MstSlotItemData,
} from "@/features/simulator/types";

// ── Constants ────────────────────────────────────────────────────────

const SHIP_STAT_FIELDS: Array<{ key: string; label: string }> = [
  { key: "taik", label: "耐久" },
  { key: "souk", label: "装甲" },
  { key: "houg", label: "火力" },
  { key: "raig", label: "雷装" },
  { key: "tyku", label: "対空" },
  { key: "tais", label: "対潜" },
  { key: "saku", label: "索敵" },
  { key: "kaih", label: "回避" },
  { key: "luck", label: "運" },
  { key: "soku", label: "速力" },
  { key: "leng", label: "射程" },
  { key: "maxeq", label: "搭載" },
];

const TARGET_STATS: Array<{ key: string; label: string }> = SHIP_STAT_FIELDS;
const SHIP_PARAM_STATS: Array<{ key: string; label: string }> =
  SHIP_STAT_FIELDS;

const DEFAULT_MAX_CANDIDATES = 30;
const DEFAULT_MAX_EX_CANDIDATES = 15;
const DEFAULT_MAX_RESULTS = 20;
const MAX_COMBO_SIZE = 5;
const ZERO_FLOOR_STAT_KEYS = new Set([
  "taik",
  "souk",
  "houg",
  "raig",
  "tyku",
  "tais",
  "saku",
  "kaih",
  "luck",
  "soku",
  "leng",
  "maxeq",
]);

const NON_EDITABLE_PARAM_KEYS = new Set(["maxeq", "soku", "leng"]);

// ── Helpers ───────────────────────────────────────────────────────────

function rawStat(equip: MstSlotItemData, statKey: string): number {
  return (equip as unknown as Record<string, number>)[statKey] ?? 0;
}

function isCompatibleNormal(
  ship: MstShipData,
  equip: MstSlotItemData,
): boolean {
  return getNormalSlotAllowedIndexes(ship.id, equip).length > 0;
}

function isCompatibleEx(ship: MstShipData, equip: MstSlotItemData): boolean {
  const list = filterForExslot(ship.id, [equip]);
  return list != null && list.length > 0;
}

/** Binomial coefficient C(n, k). */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = Math.round((r * (n - i)) / (i + 1));
  return r;
}

// ── Constraint types ──────────────────────────────────────────────────

/** 最低合計値制約: (艦基礎 + 装備合計) >= threshold */
type MinStatConstraint = {
  kind: "min_stat";
  statKey: string;
  threshold: number;
};
/** 必須装備種制約: type[2] == typeId の装備を count 個以上含む */
type RequireTypeConstraint = {
  kind: "require_type";
  typeId: number;
  count: number;
};
/** 必須装備制約: 指定装備を count 個以上、最低改修/熟練を満たすこと */
type RequireEquipConstraint = {
  kind: "require_equip";
  equipId: number;
  count: number;
  level: number;
  alv: number;
};
type Constraint =
  | MinStatConstraint
  | RequireTypeConstraint
  | RequireEquipConstraint;

const PROFICIENCY_SYMBOLS = [
  "|",
  "|",
  "||",
  "|||",
  "\\",
  "\\\\",
  "\\\\\\",
  ">>",
];

function formatImprovementDisplay(level: number): string {
  if (level >= 10) return "max";
  if (level <= 0) return "0";
  return String(level);
}

function formatProficiencyDisplay(level: number): string {
  if (level <= 0) return "-";
  return PROFICIENCY_SYMBOLS[level] ?? ">>";
}

function ConstraintProfBadge(props: {
  level: number;
  hovered?: boolean;
}): JSX.Element {
  const color = createMemo(() =>
    props.level <= 3 ? "#1976d2" : props.level <= 6 ? "#f57c00" : "#e65100",
  );
  const opacity = createMemo(() => {
    if (props.level === 0) return props.hovered ? "0.25" : "0";
    return "1";
  });

  return (
    <span
      class="shrink-0 cursor-pointer select-none text-[11px] leading-none font-bold mr-0.5 inline-flex h-4 items-center justify-center w-[2em] text-center"
      style={{
        color: color(),
        "text-shadow":
          "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)",
        opacity: opacity(),
        transition: "opacity 0.15s",
      }}
    >
      {formatProficiencyDisplay(props.level)}
    </span>
  );
}

function ConstraintImpBadge(props: {
  level: number;
  hovered?: boolean;
}): JSX.Element {
  const opacity = createMemo(() => {
    if (props.level === 0) return props.hovered ? "0.25" : "0";
    return "1";
  });
  return (
    <span
      class="shrink-0 cursor-pointer select-none text-[11px] leading-none font-bold inline-flex h-4 items-center justify-end w-[3.2em] text-right"
      style={{
        color: "#00897b",
        "text-shadow":
          "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)",
        opacity: opacity(),
        transition: "opacity 0.15s",
      }}
    >
      {props.level > 0 ? (props.level >= 10 ? "★max" : `★${props.level}`) : "★"}
    </span>
  );
}

function getRequireTypeLabel(typeId: number): string {
  return getMasterEquipTypeName(typeId) ?? `種別${typeId}`;
}

/** 艦のレベル1基礎ステータス (配列 index 0) を返す。 */
function shipBaseStat(ship: MstShipData, key: string): number {
  if (key === "soku") return Number(ship.soku ?? 0);
  if (key === "leng") return Number(ship.leng ?? 0);
  if (key === "maxeq") {
    return Array.isArray(ship.maxeq)
      ? ship.maxeq.reduce((sum, slot) => sum + Number(slot || 0), 0)
      : 0;
  }

  const v = (ship as unknown as Record<string, number[] | null>)[key];
  // Use max-level value (index 1) for optimization; fall back to level-1 (index 0)
  return v?.[1] ?? v?.[0] ?? 0;
}

function shipBaseStatOrNull(ship: MstShipData, key: string): number | null {
  if (key === "soku") return Number.isFinite(ship.soku) ? ship.soku : null;
  if (key === "leng") return Number.isFinite(ship.leng) ? ship.leng : null;
  if (key === "maxeq") {
    if (!Array.isArray(ship.maxeq)) return null;
    return ship.maxeq.reduce((sum, slot) => sum + Number(slot || 0), 0);
  }

  const value = (
    ship as unknown as Record<string, number[] | null | undefined>
  )[key];
  if (!Array.isArray(value) || value.length === 0) return null;
  const maxValue = value[1] ?? value[0];
  return typeof maxValue === "number" && Number.isFinite(maxValue)
    ? maxValue
    : null;
}

function needsStatFallback(value: number[] | null | undefined): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.every((entry) => !Number.isFinite(entry) || entry <= 0);
}

function shipMinStatOrNull(ship: MstShipData, key: string): number | null {
  if (key === "soku") return Number.isFinite(ship.soku) ? 0 : null;
  if (key === "leng") return Number.isFinite(ship.leng) ? 0 : null;
  if (key === "maxeq") return 0;

  const value = (
    ship as unknown as Record<string, number[] | null | undefined>
  )[key];
  if (!Array.isArray(value) || value.length === 0) return null;
  const minValue = value[0];
  return typeof minValue === "number" && Number.isFinite(minValue)
    ? minValue
    : null;
}

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
  return {
    master_id: masterId,
    kaihi_max: Math.max(
      0,
      ...bounds.map((row) => Number(row.kaihi_naked || 0)),
    ),
    taisen_max: Math.max(
      0,
      ...bounds.map((row) => Number(row.taisen_naked || 0)),
    ),
    sakuteki_max: Math.max(
      0,
      ...bounds.map((row) => Number(row.sakuteki_naked || 0)),
    ),
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

function getCurrentShipGrowthPeriod(): ShipGrowthPeriod | null {
  const meta = getLoadedMasterDataMeta();
  if (!meta.period_tag || !meta.table_version) return null;
  return {
    period_tag: meta.period_tag,
    table_version: meta.table_version,
  };
}

async function getOptimizerShipGrowthPeriod(): Promise<ShipGrowthPeriod | null> {
  const current = getCurrentShipGrowthPeriod();
  if (current) return current;
  if (_optimizerShipGrowthPeriodPromise)
    return _optimizerShipGrowthPeriodPromise;

  _optimizerShipGrowthPeriodPromise = (async () => {
    const res = await fetch("/api/ship-growth/summary");
    if (!res.ok) return null;
    const json = (await res.json()) as ShipGrowthSummary;
    const latest = json.periods?.[0];
    return latest
      ? { period_tag: latest.period_tag, table_version: latest.table_version }
      : null;
  })().catch(() => null);

  return _optimizerShipGrowthPeriodPromise;
}

async function getOptimizerShipGrowthCaps(
  masterId: number,
): Promise<NormalizedShipGrowthCaps | null> {
  const currentPeriod = getCurrentShipGrowthPeriod();
  if (currentPeriod) {
    _optimizerShipGrowthPeriodPromise = null;
  }
  const period = currentPeriod ?? (await getOptimizerShipGrowthPeriod());
  if (!period) return null;

  const cacheKey = `${period.period_tag}:${period.table_version}:${masterId}`;
  if (_optimizerShipGrowthCapsCache.has(cacheKey)) {
    return _optimizerShipGrowthCapsCache.get(cacheKey) ?? null;
  }

  try {
    const url = new URL("/api/ship-growth/bounds", window.location.origin);
    url.searchParams.set("period_tag", period.period_tag);
    url.searchParams.set("table_version", period.table_version);
    url.searchParams.set("master_id", String(masterId));

    const res = await fetch(url.toString());
    if (!res.ok) {
      _optimizerShipGrowthCapsCache.set(cacheKey, null);
      return null;
    }

    const json = (await res.json()) as ShipGrowthBoundsResponse;
    const fromCaps = normalizeShipGrowthCaps(json.caps?.[0] ?? null);
    const fromBounds = deriveShipGrowthCapsFromBounds(
      masterId,
      json.bounds ?? [],
    );
    const merged = mergeShipGrowthCaps(fromCaps, fromBounds);
    _optimizerShipGrowthCapsCache.set(cacheKey, merged);
    return merged;
  } catch {
    _optimizerShipGrowthCapsCache.set(cacheKey, null);
    return null;
  }
}

function buildDefaultShipParams(
  ship: MstShipData,
  caps: NormalizedShipGrowthCaps | null,
): OptimizerShipParams {
  return Object.fromEntries(
    SHIP_PARAM_STATS.map(({ key }) => {
      const rawValue = shipBaseStatOrNull(ship, key);
      const statArray =
        key === "soku" || key === "leng" || key === "maxeq"
          ? [shipBaseStat(ship, key)]
          : (ship as unknown as Record<string, number[] | null | undefined>)[
              key
            ];
      const capKey = SHIP_GROWTH_CAP_KEYS[key];
      const capValue = capKey ? (caps?.[capKey] ?? null) : null;

      if (!needsStatFallback(statArray) && rawValue != null) {
        return [key, rawValue];
      }
      if (typeof capValue === "number" && capValue > 0) {
        return [key, capValue];
      }
      return [key, rawValue];
    }),
  ) as OptimizerShipParams;
}

function applyShipParamsToShip(
  ship: MstShipData,
  shipParams: OptimizerShipParams,
): MstShipData {
  const nextShip = {
    ...ship,
    maxeq: Array.isArray(ship.maxeq) ? [...ship.maxeq] : ship.maxeq,
  } as MstShipData & Record<string, number[] | null>;
  for (const { key } of SHIP_PARAM_STATS) {
    const value = shipParams[key];
    if (!(typeof value === "number" && Number.isFinite(value))) continue;

    if (key === "soku") {
      nextShip.soku = value;
      continue;
    }
    if (key === "leng") {
      nextShip.leng = value;
      continue;
    }
    if (key === "maxeq") {
      const slotCount = Array.isArray(nextShip.maxeq)
        ? Math.max(1, nextShip.maxeq.length)
        : Math.max(1, nextShip.slot_num);
      const perSlot = Math.floor(value / slotCount);
      const remainder = value - perSlot * slotCount;
      nextShip.maxeq = Array.from(
        { length: slotCount },
        (_, idx) => perSlot + (idx < remainder ? 1 : 0),
      );
      continue;
    }

    nextShip[key] = [value, value];
  }
  return nextShip;
}

function constraintLabel(c: Constraint): string {
  if (c.kind === "min_stat") {
    const name =
      TARGET_STATS.find((s) => s.key === c.statKey)?.label ?? c.statKey;
    return `${name}(合計) ≥ ${c.threshold}`;
  }
  if (c.kind === "require_equip") {
    const equipName =
      getMasterSlotItems()[c.equipId]?.name ?? `装備${c.equipId}`;
    const parts: string[] = [`${equipName} × ${c.count}`];
    if (c.level > 0) parts.push(`改修${formatImprovementDisplay(c.level)}以上`);
    if (c.alv > 0) parts.push(`熟練${formatProficiencyDisplay(c.alv)}以上`);
    return parts.join(" ");
  }
  const name = getMasterEquipTypeName(c.typeId) ?? `種別${c.typeId}`;
  return `${name} × ${c.count}以上`;
}

type SnapshotItemConstraintRecord = {
  instanceId: number;
  slotitem_id: number;
  level: number;
  alv: number;
};

type OptimizerCalcSettings = {
  normalCandidateLimit: number | null;
  exCandidateLimit: number | null;
  resultLimit: number | null;
  masterAssumedLevel: number;
  masterAssumedAlv: number;
};

type OptimizerItemCandidate = {
  key: string;
  equip: MstSlotItemData;
  equipId: number;
  level: number;
  alv: number;
  source: "master" | "snapshot";
};

function formatParamValueLabel(statKey: string, value: number): string | null {
  if (statKey === "soku") return SPEED_NAMES[value] ?? null;
  if (statKey === "leng") return RANGE_NAMES[value] ?? null;
  return null;
}

type ActiveStat = { key: string; label: string; weight: number };

type ComboResult = {
  equipIds: number[];
  equipLevels: number[];
  equipAlvs: number[];
  exSlotId: number | null;
  exSlotImprovement: number;
  exSlotAlv: number;
  statTotals: Record<string, number>; // raw + bonus per stat (active + constrained)
  score: number; // weighted sum used for ranking
};

type OptimizerOutput = { results: ComboResult[]; nullBaseStats: string[] };

// ── Share payload ──────────────────────────────────────────────────────

type OptimizerSharePayload = {
  v: 1;
  kind: "optimizer";
  shipId: number | null;
  weights: Record<string, number>; // only non-zero weights
  constraints: Constraint[];
  exSlot: boolean;
  shipParams?: Record<string, number | null>;
  limits?: Partial<OptimizerCalcSettings>;
};

type OptimizerShipParams = Record<string, number | null>;

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

type ShipGrowthBoundRow = {
  lv: number;
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
};

type ShipGrowthBoundsResponse = {
  caps?: ShipGrowthCaps[];
  bounds?: ShipGrowthBoundRow[];
};

type NormalizedShipGrowthCaps = {
  master_id: number;
  kaihi_max: number;
  taisen_max: number;
  sakuteki_max: number;
};

type ShipGrowthPeriod = {
  period_tag: string;
  table_version: string;
};

const SHIP_GROWTH_CAP_KEYS: Partial<
  Record<string, keyof NormalizedShipGrowthCaps>
> = {
  kaih: "kaihi_max",
  tais: "taisen_max",
  saku: "sakuteki_max",
};

let _optimizerShipGrowthPeriodPromise: Promise<ShipGrowthPeriod | null> | null =
  null;
const _optimizerShipGrowthCapsCache = new Map<
  string,
  NormalizedShipGrowthCaps | null
>();

function sanitizeLimit(value: number | null | undefined): number | null {
  if (value == null) return null;
  const normalized = Math.trunc(Number(value));
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return normalized;
}

function chooseWithRepetition(n: number, k: number): number {
  if (n <= 0 || k < 0) return 0;
  return choose(n + k - 1, k);
}

function capCandidates<T>(
  items: T[],
  limit: number | null,
  isRequired: (item: T) => boolean,
): T[] {
  if (limit == null) return items;
  const required = items.filter(isRequired);
  if (required.length >= limit) return required;
  const optional = items.filter((item) => !isRequired(item));
  return [...required, ...optional.slice(0, limit - required.length)];
}

function encodeOptimizerPayload(payload: OptimizerSharePayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function readOptimizerInitFromUrl(): OptimizerSharePayload | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") !== "optimizer") return null;
    const raw = params.get("odata");
    if (!raw) return null;
    const binary = atob(decodeURIComponent(raw));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const obj = JSON.parse(json);
    return obj?.kind === "optimizer" ? (obj as OptimizerSharePayload) : null;
  } catch {
    return null;
  }
}

async function runOptimizer(
  ship: MstShipData,
  activeStats: ActiveStat[],
  includeExSlot: boolean,
  constraints: Constraint[],
  calcSettings: OptimizerCalcSettings,
  snapshotItems?: SnapshotItemConstraintRecord[],
): Promise<OptimizerOutput> {
  if (activeStats.length === 0) return { results: [], nullBaseStats: [] };

  const poolMap = getMasterSlotItems();
  const allEquip = Object.values(poolMap).filter(
    (eq) => eq.id < ENEMY_ID_THRESHOLD,
  );

  const weightedRaw = (eq: MstSlotItemData): number => {
    return activeStats.reduce(
      (s, { key, weight }) => s + weight * rawStat(eq, key),
      0,
    );
  };

  const requireTypeCs = constraints.filter(
    (c): c is RequireTypeConstraint => c.kind === "require_type",
  );
  const requireEquipCs = constraints.filter(
    (c): c is RequireEquipConstraint => c.kind === "require_equip",
  );

  const baseCandidates: OptimizerItemCandidate[] = [];
  if (snapshotItems && snapshotItems.length > 0) {
    for (const item of snapshotItems) {
      const equip = poolMap[item.slotitem_id];
      if (!equip) continue;
      baseCandidates.push({
        key: `snapshot:${item.instanceId}`,
        equip,
        equipId: equip.id,
        level: Math.max(0, Number(item.level ?? 0)),
        alv: Math.max(0, Number(item.alv ?? 0)),
        source: "snapshot",
      });
    }
  } else {
    for (const equip of allEquip) {
      baseCandidates.push({
        key: `master:${equip.id}`,
        equip,
        equipId: equip.id,
        level: calcSettings.masterAssumedLevel,
        alv: calcSettings.masterAssumedAlv,
        source: "master",
      });
    }
  }

  const usesSnapshotInstances = Boolean(
    snapshotItems && snapshotItems.length > 0,
  );
  const requiredNormalKeys = new Set<string>();
  const requiredExKeys = new Set<string>();

  const markRequired = (
    requiredKeys: Set<string>,
    predicate: (candidate: OptimizerItemCandidate) => boolean,
  ) => {
    for (const candidate of baseCandidates) {
      if (predicate(candidate)) requiredKeys.add(candidate.key);
    }
  };

  const normalCandidates = baseCandidates
    .filter(
      (candidate) =>
        weightedRaw(candidate.equip) > 0 &&
        isCompatibleNormal(ship, candidate.equip),
    )
    .sort((a, b) => weightedRaw(b.equip) - weightedRaw(a.equip));

  for (const rc of requireTypeCs) {
    markRequired(
      requiredNormalKeys,
      (candidate) =>
        candidate.equip.type[2] === rc.typeId &&
        isCompatibleNormal(ship, candidate.equip),
    );
  }
  for (const rc of requireEquipCs) {
    markRequired(
      requiredNormalKeys,
      (candidate) =>
        candidate.equipId === rc.equipId &&
        isCompatibleNormal(ship, candidate.equip),
    );
  }

  const augmentedNormal = [...normalCandidates];
  for (const candidate of baseCandidates) {
    if (!requiredNormalKeys.has(candidate.key)) continue;
    if (augmentedNormal.some((entry) => entry.key === candidate.key)) continue;
    augmentedNormal.push(candidate);
  }

  const limitedNormal = capCandidates(
    augmentedNormal,
    sanitizeLimit(calcSettings.normalCandidateLimit),
    (candidate) => requiredNormalKeys.has(candidate.key),
  );

  const exCandidates = includeExSlot
    ? baseCandidates
        .filter(
          (candidate) =>
            weightedRaw(candidate.equip) > 0 &&
            isCompatibleEx(ship, candidate.equip),
        )
        .sort((a, b) => weightedRaw(b.equip) - weightedRaw(a.equip))
    : [];

  for (const rc of requireEquipCs) {
    markRequired(
      requiredExKeys,
      (candidate) =>
        candidate.equipId === rc.equipId &&
        includeExSlot &&
        isCompatibleEx(ship, candidate.equip),
    );
  }

  const augmentedEx = [...exCandidates];
  for (const candidate of baseCandidates) {
    if (!requiredExKeys.has(candidate.key)) continue;
    if (augmentedEx.some((entry) => entry.key === candidate.key)) continue;
    augmentedEx.push(candidate);
  }

  const limitedEx = capCandidates(
    augmentedEx,
    sanitizeLimit(calcSettings.exCandidateLimit),
    (candidate) => requiredExKeys.has(candidate.key),
  );

  if (snapshotItems && requireEquipCs.length > 0) {
    for (const rc of requireEquipCs) {
      const availableCount = snapshotItems.filter(
        (si) =>
          si.slotitem_id === rc.equipId &&
          Number(si.level ?? 0) >= rc.level &&
          Number(si.alv ?? 0) >= rc.alv,
      ).length;
      if (availableCount < rc.count) {
        return { results: [], nullBaseStats: [] };
      }
    }
  }

  // Stat keys needed for min_stat constraints but not already in activeStats
  const allMinStatCs = constraints.filter(
    (c): c is MinStatConstraint => c.kind === "min_stat",
  );
  // Separate constraints by whether the ship's base stat is available (non-null)
  const shipStatOf = (key: string): number | null =>
    shipBaseStatOrNull(ship, key);
  const nullBaseStats = allMinStatCs
    .filter((c) => shipStatOf(c.statKey) == null)
    .map((c) => c.statKey);
  const minStatCs = allMinStatCs.filter((c) => shipStatOf(c.statKey) != null);
  const extraStatKeys = minStatCs
    .map((c) => c.statKey)
    .filter((k) => !activeStats.some((s) => s.key === k));

  const slotCount = Math.min(ship.slot_num, MAX_COMBO_SIZE);
  // C(n, k) requires n >= k; if fewer candidates than slots, no valid combinations exist.
  if (
    slotCount === 0 ||
    (usesSnapshotInstances
      ? limitedNormal.length < slotCount
      : limitedNormal.length === 0)
  )
    return { results: [], nullBaseStats };

  const results: ComboResult[] = [];
  const masterItems = getMasterSlotItems();

  const evalCombo = (
    comboCandidates: OptimizerItemCandidate[],
    exCandidate: OptimizerItemCandidate | null,
  ) => {
    const ids = comboCandidates.map((candidate) => candidate.equipId);
    const imps = comboCandidates.map((candidate) => candidate.level);
    const alvs = comboCandidates.map((candidate) => candidate.alv);
    const exId = exCandidate?.equipId ?? null;
    const exImp = exCandidate?.level ?? 0;
    const exAlv = exCandidate?.alv ?? 0;
    const bonuses = computeEquipBonuses(ship.id, ids, exId, imps, exImp);
    const exEq = exId != null ? masterItems[exId] : null;

    const statTotals: Record<string, number> = {};
    let score = 0;
    // Compute active stats (used for scoring)
    for (const { key, weight } of activeStats) {
      const base = shipBaseStat(ship, key);
      const raw =
        comboCandidates.reduce((sum, candidate) => {
          return sum + rawStat(candidate.equip, key);
        }, 0) + (exEq ? rawStat(exEq, key) : 0);
      const bonus = bonuses[key] ?? 0;
      statTotals[key] = base + raw + bonus;
      score += weight * (base + raw + bonus);
    }
    // Compute extra stat keys needed for min_stat constraint checks
    for (const key of extraStatKeys) {
      const base = shipBaseStat(ship, key);
      const raw =
        comboCandidates.reduce((sum, candidate) => {
          return sum + rawStat(candidate.equip, key);
        }, 0) + (exEq ? rawStat(exEq, key) : 0);
      statTotals[key] = base + raw + (bonuses[key] ?? 0);
    }

    // Check min_stat constraints (totals already include ship base)
    // (constraints where base is null are already excluded from minStatCs)
    for (const c of minStatCs) {
      if ((statTotals[c.statKey] ?? 0) < c.threshold) return;
    }
    // Check require_type constraints
    for (const rc of requireTypeCs) {
      const cnt =
        ids.filter((id) => masterItems[id]?.type[2] === rc.typeId).length +
        (exEq?.type[2] === rc.typeId ? 1 : 0);
      if (cnt < rc.count) return;
    }
    for (const rc of requireEquipCs) {
      const cnt =
        comboCandidates.filter(
          (candidate) =>
            candidate.equipId === rc.equipId &&
            candidate.level >= rc.level &&
            candidate.alv >= rc.alv,
        ).length +
        (exCandidate &&
        exCandidate.equipId === rc.equipId &&
        exCandidate.level >= rc.level &&
        exCandidate.alv >= rc.alv
          ? 1
          : 0);
      if (cnt < rc.count) return;
    }

    results.push({
      equipIds: ids,
      equipLevels: imps,
      equipAlvs: alvs,
      exSlotId: exId,
      exSlotImprovement: exImp,
      exSlotAlv: exAlv,
      statTotals,
      score,
    });
  };

  let lastYield = performance.now();
  const yieldIfNeeded = async () => {
    const now = performance.now();
    if (now - lastYield < 16) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    lastYield = performance.now();
  };

  const walkSnapshotCombos = async (
    candidates: OptimizerItemCandidate[],
    startIndex: number,
    combo: OptimizerItemCandidate[],
    exCandidate: OptimizerItemCandidate | null,
  ): Promise<void> => {
    if (combo.length === slotCount) {
      evalCombo(combo, exCandidate);
      await yieldIfNeeded();
      return;
    }
    for (let i = startIndex; i < candidates.length; i++) {
      combo.push(candidates[i]);
      await walkSnapshotCombos(candidates, i + 1, combo, exCandidate);
      combo.pop();
    }
  };

  const walkMasterCombos = async (
    startIndex: number,
    combo: OptimizerItemCandidate[],
    exCandidate: OptimizerItemCandidate | null,
  ): Promise<void> => {
    if (combo.length === slotCount) {
      evalCombo(combo, exCandidate);
      await yieldIfNeeded();
      return;
    }
    for (let i = startIndex; i < limitedNormal.length; i++) {
      combo.push(limitedNormal[i]);
      await walkMasterCombos(i, combo, exCandidate);
      combo.pop();
    }
  };

  const generateCombos = async (exCandidate: OptimizerItemCandidate | null) => {
    if (usesSnapshotInstances) {
      const availableNormals = exCandidate
        ? limitedNormal.filter((candidate) => candidate.key !== exCandidate.key)
        : limitedNormal;
      if (availableNormals.length < slotCount) return;
      await walkSnapshotCombos(availableNormals, 0, [], exCandidate);
      return;
    }
    await walkMasterCombos(0, [], exCandidate);
  };

  if (limitedEx.length === 0) {
    await generateCombos(null);
  } else {
    for (const exCandidate of limitedEx) {
      await generateCombos(exCandidate);
    }
    await generateCombos(null);
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aImp =
      a.equipLevels.reduce((sum, value) => sum + value, 0) +
      a.exSlotImprovement;
    const bImp =
      b.equipLevels.reduce((sum, value) => sum + value, 0) +
      b.exSlotImprovement;
    if (bImp !== aImp) return bImp - aImp;
    const aAlv =
      a.equipAlvs.reduce((sum, value) => sum + value, 0) + a.exSlotAlv;
    const bAlv =
      b.equipAlvs.reduce((sum, value) => sum + value, 0) + b.exSlotAlv;
    return bAlv - aAlv;
  });
  const resultLimit = sanitizeLimit(calcSettings.resultLimit);
  return {
    results: resultLimit == null ? results : results.slice(0, resultLimit),
    nullBaseStats,
  };
}

// ── Sub-components ────────────────────────────────────────────────────

function WeaponIcon(props: { iconNum: number; size?: number }): JSX.Element {
  let host!: HTMLSpanElement;
  const size = props.size ?? 16;
  // eslint-disable-next-line solid/reactivity
  const el = createWeaponIconEl(props.iconNum, size);
  return (
    <span
      ref={(el_host) => {
        host = el_host;
        host.appendChild(el);
      }}
      class="inline-flex shrink-0"
    />
  );
}

function EquipChip(props: {
  equip: MstSlotItemData | null;
  badge?: string;
  improvement?: number;
  proficiency?: number;
}): JSX.Element {
  return (
    <Show
      when={props.equip}
      fallback={<span class="text-base-content/30 text-xs italic">空</span>}
    >
      {(eq) => (
        <span class="inline-flex items-center gap-1 text-xs min-w-0">
          <span class="w-4 h-4 shrink-0 inline-flex items-center justify-center rounded bg-base-200/70">
            <WeaponIcon iconNum={eq().type?.[3] ?? 0} />
          </span>
          <Show when={props.badge}>
            <span class="badge badge-xs badge-outline border-warning text-warning shrink-0">
              {props.badge}
            </span>
          </Show>
          <span class="truncate max-w-44" title={eq().name}>
            {eq().name}
          </span>
          <Show when={(props.improvement ?? 0) > 0}>
            <span class="shrink-0 text-accent/70 font-mono">
              ★{props.improvement}
            </span>
          </Show>
          <Show when={(props.proficiency ?? 0) > 0}>
            <span class="shrink-0 text-info font-mono text-[10px]">
              {formatProficiencyDisplay(props.proficiency ?? 0)}
            </span>
          </Show>
        </span>
      )}
    </Show>
  );
}

// ── Main Component ────────────────────────────────────────────────────

function EquipOptimizer(): JSX.Element {
  // Restore from share URL if present (?tab=optimizer&odata=<base64>)
  const urlInit = readOptimizerInitFromUrl();

  const [selectedShipId, setSelectedShipId] = createSignal<number | null>(
    urlInit?.shipId ?? null,
  );
  const [statWeights, setStatWeights] = createSignal<Record<string, number>>(
    urlInit?.weights
      ? Object.fromEntries(
          TARGET_STATS.map((s) => [s.key, urlInit.weights[s.key] ?? 0]),
        )
      : Object.fromEntries(TARGET_STATS.map((s) => [s.key, 0])),
  );
  const [includeExSlot, setIncludeExSlot] = createSignal(
    urlInit?.exSlot ?? false,
  );
  const [results, setResults] = createSignal<ComboResult[]>([]);
  const [running, setRunning] = createSignal(false);
  const [ran, setRan] = createSignal(false);
  const [nullBaseStats, setNullBaseStats] = createSignal<string[]>([]);
  // "master" = all master data, "snapshot" = player's owned data only
  const [dataSource, setDataSource] = createSignal<"master" | "snapshot">(
    "master",
  );
  const [useOwnedItemState, setUseOwnedItemState] = createSignal(true);
  const [shipParams, setShipParams] = createSignal<OptimizerShipParams>(
    urlInit?.shipParams ?? {},
  );
  const [calcSettings, setCalcSettings] = createSignal<OptimizerCalcSettings>({
    normalCandidateLimit: sanitizeLimit(
      urlInit?.limits?.normalCandidateLimit ?? DEFAULT_MAX_CANDIDATES,
    ),
    exCandidateLimit: sanitizeLimit(
      urlInit?.limits?.exCandidateLimit ?? DEFAULT_MAX_EX_CANDIDATES,
    ),
    resultLimit: sanitizeLimit(
      urlInit?.limits?.resultLimit ?? DEFAULT_MAX_RESULTS,
    ),
    masterAssumedLevel: 0,
    masterAssumedAlv: 0,
  });
  const [shipParamDefaults, setShipParamDefaults] =
    createSignal<OptimizerShipParams>({});
  const [shipParamLimitOverride, setShipParamLimitOverride] =
    createSignal(false);
  const [shipGrowthLoading, setShipGrowthLoading] = createSignal(false);
  const [shipGrowthMissingKeys, setShipGrowthMissingKeys] = createSignal<
    string[]
  >([]);
  let skipInitialShipParamHydration = Boolean(
    urlInit?.shipId && urlInit?.shipParams,
  );
  let shipParamLoadSeq = 0;

  // ── Constraint state ──────────────────────────────────────────────
  const [constraints, setConstraints] = createSignal<Constraint[]>(
    urlInit?.constraints ?? [],
  );
  const [showAddForm, setShowAddForm] = createSignal(false);
  const [addKind, setAddKind] = createSignal<
    "min_stat" | "require_type" | "require_equip"
  >("min_stat");
  const [addStatKey, setAddStatKey] = createSignal("tais");
  const [addThreshold, setAddThreshold] = createSignal(100);
  const [addTypeId, setAddTypeId] = createSignal(0);
  const [addTypeCount, setAddTypeCount] = createSignal(1);
  const [addEquipId, setAddEquipId] = createSignal<number | null>(null);
  const [addEquipCount, setAddEquipCount] = createSignal(1);
  const [addEquipLevel, setAddEquipLevel] = createSignal(0);
  const [addEquipAlv, setAddEquipAlv] = createSignal(0);

  const cycleAddEquipLevel = () => {
    setAddEquipLevel((current) => (current >= 10 ? 0 : current + 1));
  };

  const cycleAddEquipAlv = () => {
    setAddEquipAlv((current) => (current >= 7 ? 0 : current + 1));
  };

  const requireTypeIds = createMemo(() => {
    const ids = new Set<number>();
    for (const item of Object.values(getMasterSlotItems())) {
      const typeId = Number(item.type?.[2] ?? 0);
      if (Number.isFinite(typeId) && typeId > 0) ids.add(typeId);
    }
    return Array.from(ids).sort((a, b) => a - b);
  });

  createEffect(() => {
    const ids = requireTypeIds();
    if (ids.length === 0) return;
    if (!ids.includes(addTypeId())) {
      setAddTypeId(ids[0]);
    }
  });

  const resetResults = () => {
    setResults([]);
    setRan(false);
    setNullBaseStats([]);
  };

  const updateCalcLimit = (
    key: keyof OptimizerCalcSettings,
    rawValue: string,
  ) => {
    const next =
      rawValue.trim() === "" ? null : sanitizeLimit(Number(rawValue));
    setCalcSettings((prev) => ({ ...prev, [key]: next }));
    resetResults();
  };

  const toggleWeight = (key: string) => {
    setStatWeights((prev) => ({ ...prev, [key]: ((prev[key] ?? 0) + 1) % 4 }));
    resetResults();
  };

  const removeConstraint = (idx: number) => {
    setConstraints((prev) => prev.filter((_, i) => i !== idx));
    resetResults();
  };

  const confirmAddConstraint = () => {
    if (addKind() === "min_stat") {
      setConstraints((prev) => [
        ...prev,
        { kind: "min_stat", statKey: addStatKey(), threshold: addThreshold() },
      ]);
    } else if (addKind() === "require_type") {
      if (addTypeId() <= 0) return;
      setConstraints((prev) => [
        ...prev,
        { kind: "require_type", typeId: addTypeId(), count: addTypeCount() },
      ]);
    } else {
      if (addEquipId() == null) return;
      setConstraints((prev) => [
        ...prev,
        {
          kind: "require_equip",
          equipId: addEquipId() as number,
          count: Math.max(1, addEquipCount()),
          level: Math.max(0, Math.min(10, addEquipLevel())),
          alv: Math.max(0, Math.min(7, addEquipAlv())),
        },
      ]);
    }
    setShowAddForm(false);
    resetResults();
  };

  const addEquip = createMemo(() => {
    const id = addEquipId();
    if (id == null) return null;
    return getMasterSlotItems()[id] ?? null;
  });

  const openConstraintEquipPicker = () => {
    const ship = selectedShip();
    if (!ship) return;

    const fleets = getFleetState();
    let matched = false;
    const fleetEntries: Array<[1 | 2 | 3 | 4, typeof fleets.fleet1]> = [
      [1, fleets.fleet1],
      [2, fleets.fleet2],
      [3, fleets.fleet3],
      [4, fleets.fleet4],
    ];
    for (const [fleetIndex, slots] of fleetEntries) {
      const slotIdx = slots.findIndex((slot) => slot.shipId === ship.id);
      if (slotIdx >= 0) {
        setEquipModalTargetForFleet(fleetIndex, slotIdx, 0);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Fall back to ally filter when selected ship isn't placed in current fleets.
      setEquipModalSideFilter("ally");
    }

    openEquipModal(addEquipId(), (selection) => {
      if (selection.id == null) {
        setAddEquipId(null);
        setAddEquipLevel(0);
        setAddEquipAlv(0);
        return;
      }
      setAddEquipId(selection.id);
      setAddEquipLevel(Math.max(0, Math.min(10, Number(selection.level ?? 0))));
      setAddEquipAlv(Math.max(0, Math.min(7, Number(selection.alv ?? 0))));
    });
  };

  const selectedShip = createMemo((): MstShipData | null => {
    const id = selectedShipId();
    if (id == null) return null;
    return getMasterShips()[id] ?? null;
  });

  createEffect(() => {
    const ship = selectedShip();
    const currentLoadId = ++shipParamLoadSeq;

    if (!ship) {
      setShipParams({});
      setShipParamDefaults({});
      setShipGrowthMissingKeys([]);
      setShipGrowthLoading(false);
      return;
    }

    if (skipInitialShipParamHydration && urlInit?.shipId === ship.id) {
      skipInitialShipParamHydration = false;
      return;
    }

    setShipGrowthLoading(true);
    void (async () => {
      const caps = await getOptimizerShipGrowthCaps(ship.id);
      if (currentLoadId !== shipParamLoadSeq) return;

      const nextParams = buildDefaultShipParams(ship, caps);
      const missingKeys = SHIP_PARAM_STATS.filter(
        ({ key }) => nextParams[key] == null,
      ).map(({ key }) => key);

      setShipParamDefaults(nextParams);
      setShipParams(nextParams);
      setShipGrowthMissingKeys(missingKeys);
      setShipGrowthLoading(false);
      resetResults();
    })();
  });

  const openShipPicker = () => {
    setShipModalSideFilter("ally");
    openShipModal(selectedShipId(), (sel) => {
      setSelectedShipId(sel.id ?? null);
      resetResults();
    });
  };

  const activeStats = createMemo((): ActiveStat[] =>
    TARGET_STATS.filter((s) => (statWeights()[s.key] ?? 0) > 0).map((s) => ({
      ...s,
      weight: statWeights()[s.key],
    })),
  );

  const effectiveShip = createMemo((): MstShipData | null => {
    const ship = selectedShip();
    if (!ship) return null;
    return applyShipParamsToShip(ship, shipParams());
  });

  const hasWeights = createMemo(() => activeStats().length > 0);
  const isMultiStat = createMemo(
    () => activeStats().length > 1 || activeStats().some((s) => s.weight > 1),
  );

  /** Min-stat constraint stats not covered by activeStats — shown in results */
  const extraConstraintStats = createMemo(() => {
    const ship = effectiveShip();
    if (!ship) return [];
    return constraints()
      .filter((c): c is MinStatConstraint => c.kind === "min_stat")
      .filter((c) => !activeStats().some((s) => s.key === c.statKey))
      .map((c) => ({
        key: c.statKey,
        label:
          TARGET_STATS.find((s) => s.key === c.statKey)?.label ?? c.statKey,
        threshold: c.threshold,
      }));
  });

  const shipParamEntries = createMemo(() => {
    const ship = selectedShip();
    if (!ship) {
      return [] as Array<{
        key: string;
        label: string;
        value: number | null;
        defaultValue: number;
        min: number;
        max: number;
        unresolved: boolean;
      }>;
    }

    return SHIP_PARAM_STATS.map((stat) => {
      const defaultValue = Number(shipParamDefaults()[stat.key] ?? 0);
      const currentValue = shipParams()[stat.key] ?? null;
      const naturalMin = shipMinStatOrNull(ship, stat.key);
      const naturalMax = shipBaseStatOrNull(ship, stat.key);
      const minBase =
        naturalMin != null
          ? naturalMin
          : ZERO_FLOOR_STAT_KEYS.has(stat.key)
            ? 0
            : defaultValue;
      const maxBase =
        naturalMax != null ? Math.max(naturalMax, defaultValue) : defaultValue;
      const maxValue = Math.max(maxBase, minBase);
      const original =
        stat.key === "soku" || stat.key === "leng" || stat.key === "maxeq"
          ? [shipBaseStat(ship, stat.key)]
          : (ship as unknown as Record<string, number[] | null | undefined>)[
              stat.key
            ];
      return {
        key: stat.key,
        label: stat.label,
        value: currentValue,
        defaultValue,
        min: minBase,
        max: maxValue,
        unresolved: currentValue == null && needsStatFallback(original),
      };
    });
  });

  const setShipParamValue = (key: string, value: number) => {
    setShipParams((prev) => ({ ...prev, [key]: value }));
    resetResults();
  };

  const bumpShipParam = (
    entry: {
      key: string;
      value: number | null;
      defaultValue: number;
      min: number;
      max: number;
    },
    sign: 1 | -1,
  ): number => {
    const current = Number(entry.value ?? entry.defaultValue ?? 0);
    const next = shipParamLimitOverride()
      ? current + sign
      : Math.max(entry.min, Math.min(entry.max, current + sign));
    setShipParamValue(entry.key, next);
    return next;
  };

  const resetShipParams = async () => {
    const ship = selectedShip();
    if (!ship) return;
    setShipGrowthLoading(true);
    const caps = await getOptimizerShipGrowthCaps(ship.id);
    const defaults = buildDefaultShipParams(ship, caps);
    setShipParamDefaults(defaults);
    setShipParams(defaults);
    setShipGrowthMissingKeys(
      SHIP_PARAM_STATS.filter(({ key }) => defaults[key] == null).map(
        ({ key }) => key,
      ),
    );
    setShipGrowthLoading(false);
    resetResults();
  };

  const slotLabel = createMemo(() => {
    const ship = selectedShip();
    if (!ship) return "";
    const slots = Math.min(ship.slot_num, MAX_COMBO_SIZE);
    return includeExSlot() ? `${slots}スロット＋補強増設` : `${slots}スロット`;
  });

  const candidateCounts = createMemo((): { normal: number; ex: number } => {
    const ship = effectiveShip();
    if (!ship) return { normal: 0, ex: 0 };
    const stats = activeStats();
    if (stats.length === 0) return { normal: 0, ex: 0 };

    const allEquip = Object.values(getMasterSlotItems()).filter(
      (eq) => eq.id < ENEMY_ID_THRESHOLD,
    );

    const wRaw = (eq: MstSlotItemData): number => {
      return stats.reduce(
        (s, { key, weight }) => s + weight * rawStat(eq, key),
        0,
      );
    };

    const snapshotItemsForConstraints =
      dataSource() === "snapshot" && hasSnapshotSlotItems()
        ? Object.entries(getSnapshotSlotItems()).map(([instanceId, inst]) => ({
            instanceId: Number(instanceId),
            slotitem_id: inst.slotitem_id,
            level: useOwnedItemState() ? Number(inst.level ?? 0) : 0,
            alv: useOwnedItemState() ? Number(inst.alv ?? 0) : 0,
          }))
        : undefined;

    const requireTypeCs = constraints().filter(
      (c): c is RequireTypeConstraint => c.kind === "require_type",
    );
    const requireEquipCs = constraints().filter(
      (c): c is RequireEquipConstraint => c.kind === "require_equip",
    );

    const baseCandidates: OptimizerItemCandidate[] = [];
    if (snapshotItemsForConstraints && snapshotItemsForConstraints.length > 0) {
      for (const item of snapshotItemsForConstraints) {
        const equip = getMasterSlotItems()[item.slotitem_id];
        if (!equip) continue;
        baseCandidates.push({
          key: `snapshot:${item.instanceId}`,
          equip,
          equipId: equip.id,
          level: item.level,
          alv: item.alv,
          source: "snapshot",
        });
      }
    } else {
      for (const equip of allEquip) {
        baseCandidates.push({
          key: `master:${equip.id}`,
          equip,
          equipId: equip.id,
          level: calcSettings().masterAssumedLevel,
          alv: 0,
          source: "master",
        });
      }
    }

    const requiredNormalKeys = new Set<string>();
    const requiredExKeys = new Set<string>();
    for (const candidate of baseCandidates) {
      for (const c of requireTypeCs) {
        if (
          candidate.equip.type[2] === c.typeId &&
          isCompatibleNormal(ship, candidate.equip)
        ) {
          requiredNormalKeys.add(candidate.key);
        }
      }
      for (const c of requireEquipCs) {
        if (
          candidate.equipId === c.equipId &&
          isCompatibleNormal(ship, candidate.equip)
        ) {
          requiredNormalKeys.add(candidate.key);
        }
        if (
          includeExSlot() &&
          candidate.equipId === c.equipId &&
          isCompatibleEx(ship, candidate.equip)
        ) {
          requiredExKeys.add(candidate.key);
        }
      }
    }

    const normalCandidates = capCandidates(
      [
        ...baseCandidates.filter(
          (candidate) =>
            wRaw(candidate.equip) > 0 &&
            isCompatibleNormal(ship, candidate.equip),
        ),
        ...baseCandidates.filter((candidate) =>
          requiredNormalKeys.has(candidate.key),
        ),
      ].filter(
        (candidate, index, array) =>
          array.findIndex((entry) => entry.key === candidate.key) === index,
      ),
      calcSettings().normalCandidateLimit,
      (candidate) => requiredNormalKeys.has(candidate.key),
    );

    const exCandidates = includeExSlot()
      ? capCandidates(
          [
            ...baseCandidates.filter(
              (candidate) =>
                wRaw(candidate.equip) > 0 &&
                isCompatibleEx(ship, candidate.equip),
            ),
            ...baseCandidates.filter((candidate) =>
              requiredExKeys.has(candidate.key),
            ),
          ].filter(
            (candidate, index, array) =>
              array.findIndex((entry) => entry.key === candidate.key) === index,
          ),
          calcSettings().exCandidateLimit,
          (candidate) => requiredExKeys.has(candidate.key),
        )
      : [];

    return { normal: normalCandidates.length, ex: exCandidates.length };
  });

  const usesSnapshotOptimizerInstances = createMemo(
    () => dataSource() === "snapshot" && hasSnapshotSlotItems(),
  );

  const estimatedCombos = createMemo(() => {
    const ship = selectedShip();
    if (!ship || !hasWeights()) return 0;
    const { normal, ex } = candidateCounts();
    const n = normal;
    const k = Math.min(ship.slot_num, MAX_COMBO_SIZE);
    const baseCombo = usesSnapshotOptimizerInstances()
      ? choose(n, k)
      : chooseWithRepetition(n, k);
    if (!includeExSlot()) return baseCombo;
    return baseCombo * (ex + 1);
  });

  const handleShare = async () => {
    const payload: OptimizerSharePayload = {
      v: 1,
      kind: "optimizer",
      shipId: selectedShipId(),
      weights: Object.fromEntries(
        Object.entries(statWeights()).filter(([, v]) => v > 0),
      ),
      constraints: constraints(),
      exSlot: includeExSlot(),
      shipParams: shipParams(),
      limits: calcSettings(),
    };
    const b64 = encodeOptimizerPayload(payload);
    const longUrl = `${window.location.origin}/simulator?tab=optimizer&odata=${encodeURIComponent(b64)}`;

    let finalUrl = longUrl;
    try {
      const res = await fetch("/api/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: longUrl }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; shortUrl?: string };
        if (data.ok && data.shortUrl) finalUrl = data.shortUrl;
      }
    } catch {
      /* fallback to long URL */
    }

    try {
      await navigator.clipboard.writeText(finalUrl);
      alert("共有URLをクリップボードにコピーしました");
    } catch {
      window.prompt("以下を手動でコピーしてください:", finalUrl);
    }
  };

  const handleCalculate = async () => {
    const ship = effectiveShip();
    const stats = activeStats();
    if (!ship || stats.length === 0) return;
    setRunning(true);
    setRan(false);
    try {
      let snapshotItemsForConstraints:
        | SnapshotItemConstraintRecord[]
        | undefined;
      if (dataSource() === "snapshot" && hasSnapshotSlotItems()) {
        snapshotItemsForConstraints = Object.entries(
          getSnapshotSlotItems(),
        ).map(([instanceId, inst]) => ({
          instanceId: Number(instanceId),
          slotitem_id: inst.slotitem_id,
          level: useOwnedItemState() ? Number(inst.level ?? 0) : 0,
          alv: useOwnedItemState() ? Number(inst.alv ?? 0) : 0,
        }));
      }
      const { results: r, nullBaseStats: skipped } = await runOptimizer(
        ship,
        stats,
        includeExSlot(),
        constraints(),
        calcSettings(),
        snapshotItemsForConstraints,
      );
      setResults(r);
      setNullBaseStats(skipped);
      setRan(true);
    } finally {
      setRunning(false);
    }
  };

  const getEquip = (id: number): MstSlotItemData | null =>
    getMasterSlotItems()[id] ?? null;

  const activeStatLabel = createMemo(() => {
    const stats = activeStats();
    if (stats.length === 0) return "—";
    return stats
      .map((s) => (s.weight > 1 ? `${s.label}×${s.weight}` : s.label))
      .join(" + ");
  });

  const ParamStatControl = (props: {
    entry: {
      key: string;
      label: string;
      value: number | null;
      defaultValue: number;
      min: number;
      max: number;
      unresolved: boolean;
    };
  }) => {
    const entry = () => props.entry;
    const isSpeedStat = () => entry().key === "soku";
    const isRangeStat = () => entry().key === "leng";
    const isLabeledStat = () => isSpeedStat() || isRangeStat();
    const isNonEditable = () => NON_EDITABLE_PARAM_KEYS.has(entry().key);
    const isDisabled = () => isNonEditable() && !shipParamLimitOverride();
    const currentLabel = () => formatParamValueLabel(entry().key, current());
    const minVal = () => entry().min;
    const maxVal = () => entry().max;
    const currentFromState = () =>
      Number(entry().value ?? entry().defaultValue);
    const [draftValue, setDraftValue] = createSignal(currentFromState());

    createEffect(() => {
      setDraftValue(currentFromState());
    });

    const current = () => draftValue();
    const clampValue = (raw: number) =>
      shipParamLimitOverride()
        ? raw
        : Math.max(minVal(), Math.min(maxVal(), raw));
    const commitValue = (raw: number) => {
      if (isDisabled()) return;
      if (!Number.isFinite(raw)) return;
      const next = clampValue(raw);
      setDraftValue(next);
      if (next !== currentFromState()) {
        setShipParamValue(entry().key, next);
      }
    };
    const pct = () => {
      const hi = maxVal();
      const lo = minVal();
      const cur = current();
      return hi <= lo
        ? 0
        : Math.max(0, Math.min(100, ((cur - lo) / (hi - lo)) * 100));
    };
    const labelMap = () => (isSpeedStat() ? SPEED_NAMES : RANGE_NAMES);
    const selectOptions = () =>
      Object.entries(labelMap())
        .map(([value, label]) => [Number(value), label] as const)
        .sort((a, b) => a[0] - b[0]);

    return (
      <div class="rounded-md border px-2 py-1.5 text-xs border-base-200/70 bg-base-100">
        <div class="grid grid-cols-[1.35rem_1fr] items-center gap-1.5">
          <span class="font-medium text-base-content/70 whitespace-nowrap">
            {entry().label}
          </span>
          <div class="justify-self-end flex items-center justify-end gap-1">
            <Show when={!isLabeledStat() && currentLabel()}>
              {(label) => (
                <span class="text-[10px] text-base-content/45 whitespace-nowrap">
                  {label()}
                </span>
              )}
            </Show>
            <Show
              when={isLabeledStat()}
              fallback={
                <div class="w-[6.2rem] flex items-center justify-end gap-0.5">
                  <button
                    class="btn btn-ghost btn-xs h-5 min-h-0 px-0.5"
                    disabled={isDisabled()}
                    onClick={() => {
                      const next = bumpShipParam(entry(), -1);
                      setDraftValue(next);
                    }}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={String(minVal())}
                    value={String(current())}
                    class="input input-xs input-bordered w-[2.9rem] px-1 text-center font-mono text-[10px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    disabled={isDisabled()}
                    onInput={(e) => {
                      if (isDisabled()) return;
                      const raw = Number(
                        (e.currentTarget as HTMLInputElement).value,
                      );
                      if (!Number.isFinite(raw)) return;
                      setDraftValue(clampValue(raw));
                    }}
                    onChange={(e) => {
                      const raw = Number(
                        (e.currentTarget as HTMLInputElement).value,
                      );
                      commitValue(raw);
                    }}
                  />
                  <button
                    class="btn btn-ghost btn-xs h-5 min-h-0 px-0.5"
                    disabled={isDisabled()}
                    onClick={() => {
                      const next = bumpShipParam(entry(), 1);
                      setDraftValue(next);
                    }}
                  >
                    +
                  </button>
                </div>
              }
            >
              <div class="w-[6.2rem] flex items-center justify-end">
                <select
                  class="select select-xs select-bordered h-6 py-0 px-2 w-[6.2rem] text-[10px]"
                  value={String(current())}
                  disabled={isDisabled()}
                  onInput={(e) => {
                    const next = Number(
                      (e.currentTarget as HTMLSelectElement).value,
                    );
                    commitValue(next);
                  }}
                >
                  {selectOptions().map(([value, label]) => (
                    <option value={String(value)}>{label}</option>
                  ))}
                  {!selectOptions().some(([value]) => value === current()) && (
                    <option value={String(current())}>
                      {labelMap()[current()] ?? "不明"}
                    </option>
                  )}
                </select>
              </div>
            </Show>
          </div>
        </div>
        <Show when={!isLabeledStat()}>
          <div class="mt-0.5">
            <input
              type="range"
              min={String(minVal())}
              max={String(maxVal())}
              value={String(Math.max(minVal(), Math.min(maxVal(), current())))}
              class="w-full h-1 align-middle cursor-pointer appearance-none rounded-none bg-base-300 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-0 [&::-webkit-slider-thumb]:h-0 [&::-moz-range-thumb]:w-0 [&::-moz-range-thumb]:h-0 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent"
              style={
                {
                  background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${pct()}%, var(--color-base-300) ${pct()}%, var(--color-base-300) 100%)`,
                } as any
              }
              onInput={(e) => {
                if (isDisabled()) return;
                const next = Number(
                  (e.currentTarget as HTMLInputElement).value,
                );
                if (!Number.isFinite(next)) return;
                setDraftValue(next);
              }}
              onChange={(e) => {
                const next = Number(
                  (e.currentTarget as HTMLInputElement).value,
                );
                commitValue(next);
              }}
            />
            <div class="mt-0.5 flex items-center justify-between text-[8px] text-base-content/40 font-mono">
              <span>min {minVal()}</span>
              <span>
                {shipParamLimitOverride() ? "max 制限外" : `max ${maxVal()}`}
              </span>
            </div>
            <Show when={isDisabled()}>
              <div class="mt-0.5 text-right text-[9px] text-base-content/40">
                編集不可
              </div>
            </Show>
            <div class="mt-0.5 flex items-center gap-1.5 min-h-3">
              <Show when={entry().unresolved}>
                <span class="badge badge-xs badge-outline border-warning/50 text-warning shrink-0">
                  未補完
                </span>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    );
  };

  return (
    <div class="space-y-4">
      {/* Controls */}
      <div class="bg-base-100 rounded-xl border border-base-300/40 shadow-sm p-4">
        <h2 class="text-sm font-semibold mb-1">
          装備最適化（複合ステータス対応）
        </h2>
        <p class="text-xs text-base-content/55 mb-4">
          比重を設定したステータスの加重合計が高い順に、条件へ一致した装備コンボを全件表示します。クリックで×1→×2→×3→×0と切り替えます。
          複数のステータスを同時に設定することで複合最適化が可能です。
        </p>

        <div class="flex flex-col gap-3">
          {/* Data source toggle — only shown when snapshot data is available */}
          <Show when={hasSnapshotShips() || hasSnapshotSlotItems()}>
            <div class="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
              <div class="flex items-center gap-2">
                <span class="text-base-content/55 shrink-0">候補:</span>
                <button
                  class={`btn btn-xs ${dataSource() === "master" ? "btn-primary" : "btn-ghost border border-base-300"}`}
                  onClick={() => {
                    setDataSource("master");
                    resetResults();
                    setSelectedShipId(null);
                  }}
                >
                  全データ
                </button>
                <button
                  class={`btn btn-xs ${dataSource() === "snapshot" ? "btn-primary" : "btn-ghost border border-base-300"}`}
                  onClick={() => {
                    setDataSource("snapshot");
                    resetResults();
                    setSelectedShipId(null);
                  }}
                >
                  保有のみ
                </button>
              </div>
              <Show
                when={dataSource() === "snapshot" && hasSnapshotSlotItems()}
              >
                <div class="flex items-center gap-2">
                  <span class="text-base-content/55 shrink-0">個体差:</span>
                  <button
                    class={`btn btn-xs ${useOwnedItemState() ? "btn-primary" : "btn-ghost border border-base-300"}`}
                    onClick={() => {
                      setUseOwnedItemState((v) => !v);
                      resetResults();
                    }}
                  >
                    {useOwnedItemState() ? "改修・熟練反映" : "個体差を無視"}
                  </button>
                </div>
              </Show>
            </div>
          </Show>
          {/* Row 1: Ship + Ex-slot + Calc */}
          <div class="flex flex-col sm:flex-row gap-3">
            {/* Ship selector */}
            <div class="flex-1 min-w-0">
              <label class="text-xs font-medium text-base-content/65 mb-1 block">
                艦を選択
              </label>
              <Show
                when={selectedShip()}
                fallback={
                  <button
                    class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-base-300 bg-base-200/40 text-left cursor-pointer"
                    onClick={openShipPicker}
                  >
                    <span class="w-[72px] h-7 bg-base-200 rounded overflow-hidden shrink-0 flex items-center justify-center text-[9px] text-base-content/35">
                      NO IMAGE
                    </span>
                    <span class="font-normal text-sm text-base-content/50 truncate">
                      艦を選択…
                    </span>
                  </button>
                }
              >
                {(ship) => (
                  <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-base-300 bg-base-200/40">
                    <span class="w-[72px] h-7 bg-base-200 rounded overflow-hidden shrink-0 relative">
                      <span class="absolute inset-0 flex items-center justify-center text-[9px] text-base-content/35">
                        NO IMAGE
                      </span>
                      <Show when={bannerUrl(ship().id)}>
                        <img
                          src={bannerUrl(ship().id)}
                          alt={ship().name}
                          class="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      </Show>
                    </span>
                    <button
                      class="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                      onClick={openShipPicker}
                    >
                      <span class="font-medium text-sm truncate">
                        {ship().name}
                      </span>
                      <span class="text-xs text-base-content/45 shrink-0">
                        {STYPE_NAMES[ship().stype] ?? `艦種${ship().stype}`}
                      </span>
                    </button>
                    <button
                      class="shrink-0 text-base-content/35 hover:text-error text-xs ml-1"
                      onClick={() => {
                        setSelectedShipId(null);
                        resetResults();
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </Show>
            </div>

            {/* Ex-slot + Calculate + Share */}
            <div class="flex items-end gap-2 shrink-0">
              <label class="label cursor-pointer justify-start gap-2 py-0 h-8">
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  checked={includeExSlot()}
                  onChange={(e) => {
                    setIncludeExSlot(e.currentTarget.checked);
                    setResults([]);
                    setRan(false);
                  }}
                />
                <span class="text-xs">補強増設</span>
              </label>
              <button
                class="btn btn-primary btn-sm"
                disabled={!selectedShip() || !hasWeights() || running()}
                onClick={handleCalculate}
              >
                <Show when={running()} fallback="計算">
                  <span class="loading loading-spinner loading-xs" />
                  計算中…
                </Show>
              </button>
              <button
                class="btn btn-ghost btn-sm gap-1 px-2.5"
                title="検索条件の共有URLをコピー"
                disabled={!selectedShip() || !hasWeights()}
                onClick={handleShare}
              >
                <svg
                  class="w-3.5 h-3.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                  />
                </svg>
                共有
              </button>
            </div>
          </div>

          {/* Row 2: Stat weights */}
          <div>
            <label class="text-xs font-medium text-base-content/65 mb-2 block">
              ステータス比重
            </label>
            <div class="flex flex-wrap gap-1.5">
              <For each={TARGET_STATS}>
                {(stat) => {
                  const w = () => statWeights()[stat.key] ?? 0;
                  return (
                    <button
                      class={`text-xs px-2.5 py-0.5 rounded-full border transition-all cursor-pointer select-none ${
                        w() === 0
                          ? "border-base-300/50 text-base-content/35"
                          : w() === 1
                            ? "border-primary/70 text-primary bg-primary/10"
                            : w() === 2
                              ? "border-secondary/70 text-secondary bg-secondary/10"
                              : "border-warning/70 text-warning bg-warning/10"
                      }`}
                      onClick={() => toggleWeight(stat.key)}
                    >
                      {stat.label}
                      <Show when={w() > 0}>
                        {" "}
                        <span class="font-semibold">×{w()}</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          {/* Row 3: Constraints */}
          <div>
            <div class="flex items-center gap-2 mb-2">
              <label class="text-xs font-medium text-base-content/65">
                制約条件
              </label>
            </div>

            {/* Active constraint chips */}
            <Show when={constraints().length > 0}>
              <div class="flex flex-wrap gap-1.5 mb-2">
                <For each={constraints()}>
                  {(c, i) => (
                    <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-info/40 text-info/80 bg-info/5">
                      {constraintLabel(c)}
                      <button
                        class="hover:text-error leading-none ml-0.5"
                        onClick={() => removeConstraint(i())}
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </For>
              </div>
            </Show>

            {/* Add constraint form */}
            <Show
              when={showAddForm()}
              fallback={
                <button
                  class="text-xs text-base-content/40 hover:text-base-content/70 border border-dashed border-base-300/60 rounded px-2 py-1 cursor-pointer"
                  onClick={() => setShowAddForm(true)}
                >
                  ＋ 条件を追加
                </button>
              }
            >
              <div class="border border-base-300/50 rounded-lg p-3 bg-base-200/20 space-y-2">
                {/* Kind toggle */}
                <div class="flex gap-1">
                  <button
                    class={`text-xs px-2.5 py-0.5 rounded border cursor-pointer ${addKind() === "min_stat" ? "border-primary/70 text-primary bg-primary/10" : "border-base-300/50 text-base-content/45"}`}
                    onClick={() => setAddKind("min_stat")}
                  >
                    最低合計値
                  </button>
                  <button
                    class={`text-xs px-2.5 py-0.5 rounded border cursor-pointer ${addKind() === "require_type" ? "border-primary/70 text-primary bg-primary/10" : "border-base-300/50 text-base-content/45"}`}
                    onClick={() => setAddKind("require_type")}
                  >
                    必須装備種
                  </button>
                  <button
                    class={`text-xs px-2.5 py-0.5 rounded border cursor-pointer ${addKind() === "require_equip" ? "border-primary/70 text-primary bg-primary/10" : "border-base-300/50 text-base-content/45"}`}
                    onClick={() => setAddKind("require_equip")}
                  >
                    指定装備
                  </button>
                </div>

                <Show when={addKind() === "min_stat"}>
                  <div class="flex flex-wrap items-center gap-2">
                    <select
                      class="select select-xs select-bordered"
                      value={addStatKey()}
                      onChange={(e) => setAddStatKey(e.currentTarget.value)}
                    >
                      <For each={TARGET_STATS}>
                        {(s) => <option value={s.key}>{s.label}</option>}
                      </For>
                    </select>
                    <span class="text-xs text-base-content/55">
                      (艦基礎＋装備) ≥
                    </span>
                    <input
                      type="number"
                      class="input input-xs input-bordered w-20"
                      value={addThreshold()}
                      onInput={(e) =>
                        setAddThreshold(Number(e.currentTarget.value) || 0)
                      }
                    />
                    <Show when={selectedShip()}>
                      {(_ship) => {
                        const base = () => shipParams()[addStatKey()] ?? 0;
                        const needed = () =>
                          Math.max(0, addThreshold() - base());
                        return (
                          <span class="text-[11px] text-base-content/40">
                            (艦基礎 {base()}、装備で{needed()}以上必要)
                          </span>
                        );
                      }}
                    </Show>
                  </div>
                </Show>

                <Show when={addKind() === "require_type"}>
                  <div class="flex flex-wrap items-center gap-2">
                    <select
                      class="select select-xs select-bordered"
                      value={addTypeId()}
                      onChange={(e) =>
                        setAddTypeId(Number(e.currentTarget.value))
                      }
                    >
                      <For each={requireTypeIds()}>
                        {(typeId) => (
                          <option value={typeId}>
                            {getRequireTypeLabel(typeId)}
                          </option>
                        )}
                      </For>
                    </select>
                    <span class="text-xs text-base-content/55">を</span>
                    <input
                      type="number"
                      class="input input-xs input-bordered w-14"
                      min="1"
                      max="5"
                      value={addTypeCount()}
                      onInput={(e) =>
                        setAddTypeCount(
                          Math.max(1, Number(e.currentTarget.value) || 1),
                        )
                      }
                    />
                    <span class="text-xs text-base-content/55">個以上装備</span>
                  </div>
                </Show>

                <Show when={addKind() === "require_equip"}>
                  <div class="flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap pb-0.5">
                    <button
                      class="btn btn-xs btn-outline"
                      disabled={!selectedShip()}
                      onClick={openConstraintEquipPicker}
                    >
                      {addEquip() ? "装備を選び直す" : "装備を選択"}
                    </button>
                    <span class="text-xs text-base-content/55">
                      {addEquip() ? addEquip()!.name : "未選択"}
                    </span>
                    <span class="text-xs text-base-content/55">を</span>
                    <input
                      type="number"
                      class="input input-xs input-bordered w-14"
                      min="1"
                      max="5"
                      value={addEquipCount()}
                      onInput={(e) =>
                        setAddEquipCount(
                          Math.max(1, Number(e.currentTarget.value) || 1),
                        )
                      }
                    />
                    <span class="text-xs text-base-content/55">個以上</span>
                    <div class="inline-flex items-center gap-1 rounded border border-base-300/60 px-1.5 py-0.5 bg-base-100/60">
                      <span class="text-xs text-base-content/55">改修</span>
                      <span
                        class="mb-1"
                        title={`改修 ${formatImprovementDisplay(addEquipLevel())} (クリックで変更)`}
                        onClick={cycleAddEquipLevel}
                      >
                        <ConstraintImpBadge
                          level={addEquipLevel()}
                          hovered={true}
                        />
                      </span>
                      <span class="text-xs text-base-content/55 whitespace-nowrap">
                        以上
                      </span>
                    </div>
                    <div class="inline-flex items-center gap-1 rounded border border-base-300/60 px-1.5 py-0.5 bg-base-100/60">
                      <span class="text-xs text-base-content/55">熟練</span>
                      <span
                        class="mb-1"
                        title={`熟練 ${formatProficiencyDisplay(addEquipAlv())} (クリックで変更)`}
                        onClick={cycleAddEquipAlv}
                      >
                        <ConstraintProfBadge
                          level={addEquipAlv()}
                          hovered={true}
                        />
                      </span>
                      <span class="text-xs text-base-content/55 whitespace-nowrap">
                        以上
                      </span>
                    </div>
                  </div>
                </Show>

                <div class="flex gap-2">
                  <button
                    class="btn btn-xs btn-primary"
                    onClick={confirmAddConstraint}
                  >
                    追加
                  </button>
                  <button
                    class="btn btn-xs btn-ghost"
                    onClick={() => setShowAddForm(false)}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </Show>
          </div>

          <div>
            <label class="text-xs font-medium text-base-content/65 mb-2 block">
              計算設定
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label class="form-control">
                <span class="text-[11px] text-base-content/55 mb-1">
                  通常候補上限
                </span>
                <input
                  type="number"
                  min="1"
                  class="input input-xs input-bordered"
                  placeholder="無制限"
                  value={calcSettings().normalCandidateLimit ?? ""}
                  onInput={(e) =>
                    updateCalcLimit(
                      "normalCandidateLimit",
                      e.currentTarget.value,
                    )
                  }
                />
              </label>
              <label class="form-control">
                <span class="text-[11px] text-base-content/55 mb-1">
                  補強候補上限
                </span>
                <input
                  type="number"
                  min="1"
                  class="input input-xs input-bordered"
                  placeholder="無制限"
                  value={calcSettings().exCandidateLimit ?? ""}
                  onInput={(e) =>
                    updateCalcLimit("exCandidateLimit", e.currentTarget.value)
                  }
                />
              </label>
              <label class="form-control">
                <span class="text-[11px] text-base-content/55 mb-1">
                  表示結果上限
                </span>
                <input
                  type="number"
                  min="1"
                  class="input input-xs input-bordered"
                  placeholder="無制限"
                  value={calcSettings().resultLimit ?? ""}
                  onInput={(e) =>
                    updateCalcLimit("resultLimit", e.currentTarget.value)
                  }
                />
              </label>
            </div>
            <Show when={dataSource() === "master"}>
              <div class="mt-2">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg">
                  <label class="form-control">
                    <span class="text-[11px] text-base-content/55 mb-1">
                      全データ時の仮定改修値（★0〜★10）
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      class="input input-xs input-bordered"
                      value={calcSettings().masterAssumedLevel}
                      onInput={(e) => {
                        const v = Math.max(
                          0,
                          Math.min(10, Number(e.currentTarget.value) || 0),
                        );
                        setCalcSettings((prev) => ({
                          ...prev,
                          masterAssumedLevel: v,
                        }));
                        resetResults();
                      }}
                    />
                  </label>
                  <label class="form-control">
                    <span class="text-[11px] text-base-content/55 mb-1">
                      全データ時の仮定熟練度（0〜7）
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="7"
                      class="input input-xs input-bordered"
                      value={calcSettings().masterAssumedAlv}
                      onInput={(e) => {
                        const v = Math.max(
                          0,
                          Math.min(7, Number(e.currentTarget.value) || 0),
                        );
                        setCalcSettings((prev) => ({
                          ...prev,
                          masterAssumedAlv: v,
                        }));
                        resetResults();
                      }}
                    />
                  </label>
                </div>
              </div>
            </Show>
            <p class="mt-1 text-[11px] text-base-content/45">
              空欄は無制限です。改修・熟練は検証済みデータのみで計算し、未検証の補間式は使用しません。全データでは同一装備の重複搭載候補も探索します。
            </p>
          </div>

          <div>
            <div class="flex items-center justify-between gap-2 mb-2">
              <label class="text-xs font-medium text-base-content/65 block">
                艦パラメータ
              </label>
              <div class="flex items-center gap-2 text-[11px] text-base-content/45">
                <Show when={shipGrowthLoading()}>
                  <span class="loading loading-spinner loading-xs" />
                </Show>
                <button
                  class={`px-2 py-1 text-xs rounded transition-colors ${shipParamLimitOverride() ? "bg-warning/30 text-warning" : "bg-base-200 text-base-content"}`}
                  onClick={() => setShipParamLimitOverride((v) => !v)}
                  title="有効化すると全パラメータを上限外まで編集可能"
                >
                  {shipParamLimitOverride()
                    ? "制限外編集: ON"
                    : "制限外編集: OFF"}
                </button>
                <button
                  class="btn btn-ghost btn-xs px-2"
                  disabled={!selectedShip()}
                  onClick={() => void resetShipParams()}
                >
                  初期値に戻す
                </button>
              </div>
            </div>

            <Show
              when={selectedShip()}
              fallback={
                <div class="rounded-lg border border-base-300/60 bg-base-200/20 px-3 py-2 text-xs text-base-content/60">
                  艦を選択すると、各パラメータ（火力/雷装/対空/対潜/索敵/回避など）を手動で編集できます。
                </div>
              }
            >
              <div class="rounded-lg border border-base-300/50 bg-base-200/20 px-2 py-1.5 space-y-1">
                <div class="text-[11px] text-base-content/55 leading-tight">
                  対潜/回避/索敵の欠損値は ship-growth
                  データの上限値で補完表示しています。
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5">
                  <For each={shipParamEntries()}>
                    {(entry) => <ParamStatControl entry={entry} />}
                  </For>
                </div>
              </div>
              <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-base-content/45">
                <Show when={shipGrowthMissingKeys().length > 0}>
                  <span class="text-warning">
                    {shipGrowthMissingKeys()
                      .map(
                        (key) =>
                          TARGET_STATS.find((stat) => stat.key === key)
                            ?.label ?? key,
                      )
                      .join("・")}
                    は既定値を取得できませんでした。
                  </span>
                </Show>
              </div>
            </Show>
          </div>
        </div>

        {/* Info row */}
        <Show when={selectedShip() && hasWeights()}>
          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/50">
            <span>対象スロット: {slotLabel()}</span>
            <span>候補装備数: {candidateCounts().normal}件</span>
            <span>
              評価組合せ数: 約{estimatedCombos().toLocaleString()}通り
            </span>
          </div>
        </Show>
      </div>

      {/* Results */}
      <Show when={ran()}>
        <Show when={nullBaseStats().length > 0}>
          <div class="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-xl px-4 py-2.5 text-xs text-base-content/70">
            <svg
              class="shrink-0 w-4 h-4 stroke-current text-warning mt-px"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span>
              艦の基礎
              {nullBaseStats()
                .map((k) => TARGET_STATS.find((s) => s.key === k)?.label ?? k)
                .join("・")}
              データが未収録のため、
              合計値制約は適用されていません。代わりに装備値の高い組み合わせを表示しています。
            </span>
          </div>
        </Show>
        <div class="bg-base-100 rounded-xl border border-base-300/40 shadow-sm overflow-hidden">
          <div class="px-4 py-3 border-b border-base-200 bg-linear-to-r from-primary/5 to-transparent">
            <h3 class="text-sm font-semibold">
              {selectedShip()?.name} — {activeStatLabel()} 結果
              {results().length}件
            </h3>
          </div>
          <Show
            when={results().length > 0}
            fallback={
              <div class="p-6 text-center text-sm text-base-content/50">
                対象の装備が見つかりませんでした。
              </div>
            }
          >
            <div class="divide-y divide-base-200 max-h-[560px] overflow-y-auto">
              <For each={results()}>
                {(row, i) => (
                  <div class="px-4 py-3 hover:bg-base-200/20 transition-colors">
                    {/* Stats row */}
                    <div class="flex items-start gap-1 mb-1.5">
                      <span class="text-base-content/35 font-mono text-[11px] w-5 text-right shrink-0 mt-0.5">
                        {i() + 1}
                      </span>
                      <div class="flex flex-1 flex-wrap gap-x-3 gap-y-0.5 pl-1 text-[11px] font-mono">
                        <For each={activeStats()}>
                          {({ key }) => {
                            const total = row.statTotals[key] ?? 0;
                            const label =
                              TARGET_STATS.find((s) => s.key === key)?.label ??
                              key;
                            return (
                              <span
                                class={
                                  total > 0
                                    ? "text-base-content/75"
                                    : total < 0
                                      ? "text-error"
                                      : "text-base-content/30"
                                }
                              >
                                {label} {total}
                              </span>
                            );
                          }}
                        </For>
                        {/* Constraint stats not in active stats — show total (base+equip) */}
                        <For each={extraConstraintStats()}>
                          {({ key, label, threshold }) => {
                            const total = row.statTotals[key] ?? 0;
                            const base = shipParams()[key] ?? 0;
                            return (
                              <span
                                class={`${total >= threshold ? "text-success/80" : "text-error"}`}
                                title={`艦基礎 ${base} を含む合計値 ${total}`}
                              >
                                {label}合計 {total}
                              </span>
                            );
                          }}
                        </For>
                      </div>
                      <Show when={isMultiStat()}>
                        <span class="text-primary font-semibold text-[11px] font-mono shrink-0">
                          得点 {Math.round(row.score)}
                        </span>
                      </Show>
                    </div>
                    {/* Equipment row */}
                    <div class="flex flex-wrap gap-x-3 gap-y-1 pl-6">
                      <For each={row.equipIds}>
                        {(id, index) => (
                          <EquipChip
                            equip={getEquip(id)}
                            improvement={row.equipLevels[index()]}
                            proficiency={row.equipAlvs[index()]}
                          />
                        )}
                      </For>
                      <Show when={row.exSlotId != null}>
                        <EquipChip
                          equip={getEquip(row.exSlotId!)}
                          badge="補強"
                          improvement={row.exSlotImprovement}
                          proficiency={row.exSlotAlv}
                        />
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <div class="px-4 py-2 border-t border-base-200 text-[11px] text-base-content/40">
              ※
              保有のみでは装備個体ごとの改修値・熟練度・同一装備複数所持を考慮します。全データでは改修0・熟練0前提で、同一装備の重複候補も探索します。
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────

let _optimizerMounted = false;

export function ensureOptimizerMounted(): void {
  if (_optimizerMounted) return;
  const el = document.getElementById("optimizer-mount");
  if (!el) return;
  render(() => <EquipOptimizer />, el);
  _optimizerMounted = true;
}
