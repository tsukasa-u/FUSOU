/** @jsxImportSource solid-js */

import {
  For,
  Show,
  createMemo,
  createSignal,
  type JSX,
} from "solid-js";
import { render } from "solid-js/web";
import {
  computeEquipBonuses,
  createWeaponIconEl,
} from "../../../pages/simulator/lib/equip-calc";
import {
  getMasterEquipTypeName,
  getMasterShips,
  getMasterSlotItems,
  getSnapshotSlotItems,
  hasSnapshotShips,
  hasSnapshotSlotItems,
} from "../../../pages/simulator/lib/simulator-selectors";
import { setShipModalSideFilter } from "../../../pages/simulator/lib/simulator-mutations";
import { openShipModal } from "../../../pages/simulator/lib/ship-modal";
import {
  ENEMY_ID_THRESHOLD,
  STYPE_NAMES,
} from "../../../pages/simulator/lib/constants";
import {
  filterForExslot,
  getNormalSlotAllowedIndexes,
} from "../../../pages/simulator/lib/equip-filter";
import type { MstShipData, MstSlotItemData } from "../../../pages/simulator/lib/types";

// ── Constants ────────────────────────────────────────────────────────

const TARGET_STATS: Array<{ key: string; label: string }> = [
  { key: "houg", label: "火力" },
  { key: "raig", label: "雷装" },
  { key: "tyku", label: "対空" },
  { key: "tais", label: "対潜" },
  { key: "baku", label: "爆装" },
  { key: "saku", label: "索敵" },
  { key: "houm", label: "命中" },
  { key: "souk", label: "装甲" },
  { key: "kaih", label: "回避" },
];

const MAX_CANDIDATES = 30;
const MAX_RESULTS = 20;
const MAX_COMBO_SIZE = 5;

// ── Helpers ───────────────────────────────────────────────────────────

function rawStat(equip: MstSlotItemData, statKey: string): number {
  return (equip as unknown as Record<string, number>)[statKey] ?? 0;
}

function isCompatibleNormal(ship: MstShipData, equip: MstSlotItemData): boolean {
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
type MinStatConstraint = { kind: "min_stat"; statKey: string; threshold: number };
/** 必須装備種制約: type[2] == typeId の装備を count 個以上含む */
type RequireTypeConstraint = { kind: "require_type"; typeId: number; count: number };
type Constraint = MinStatConstraint | RequireTypeConstraint;

// 最適化制約として有用な装備種IDのキュレーションリスト（全装備種のサブセット）。
// ラベルは実行時に getMasterEquipTypeName() でマスタデータから取得する。
const REQUIRE_TYPE_IDS: readonly number[] = [
  14, 15, 40, 25, 26,  // 対潜: ソナー/爆雷/大型ソナー/オートジャイロ/対潜哨戒機
  5, 32,               // 魚雷/潜水艦魚雷
  12, 13,              // 電探
  1, 2, 3,             // 主砲
];

function getRequireTypeLabel(typeId: number): string {
  return getMasterEquipTypeName(typeId) ?? `種別${typeId}`;
}

/** 艦のレベル1基礎ステータス (配列 index 0) を返す。 */
function shipBaseStat(ship: MstShipData, key: string): number {
  const v = (ship as unknown as Record<string, number[] | null>)[key];
  // Use max-level value (index 1) for optimization; fall back to level-1 (index 0)
  return v?.[1] ?? v?.[0] ?? 0;
}

function constraintLabel(c: Constraint): string {
  if (c.kind === "min_stat") {
    const name = TARGET_STATS.find((s) => s.key === c.statKey)?.label ?? c.statKey;
    return `${name}(合計) ≥ ${c.threshold}`;
  }
  const name = getMasterEquipTypeName(c.typeId) ?? `種別${c.typeId}`;
  return `${name} × ${c.count}以上`;
}

type ActiveStat = { key: string; label: string; weight: number };

type ComboResult = {
  equipIds: number[];
  exSlotId: number | null;
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
};

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
  equipPool?: Record<number, MstSlotItemData>,
  improvementMap?: Record<number, number>,
): Promise<OptimizerOutput> {
  if (activeStats.length === 0) return { results: [], nullBaseStats: [] };

  const poolMap = equipPool ?? getMasterSlotItems();
  const allEquip = Object.values(poolMap).filter(
    (eq) => eq.id < ENEMY_ID_THRESHOLD,
  );

  const weightedRaw = (eq: MstSlotItemData): number => {
    return activeStats.reduce(
      (s, { key, weight }) => s + weight * rawStat(eq, key),
      0,
    );
  };

  // Normal-slot candidates: compatible + weighted raw > 0, sorted desc
  const normalCandidates: MstSlotItemData[] = allEquip
    .filter((eq) => weightedRaw(eq) > 0 && isCompatibleNormal(ship, eq))
    .sort((a, b) => weightedRaw(b) - weightedRaw(a))
    .slice(0, MAX_CANDIDATES);

  // Augment candidates for require_type constraints
  // (required items may have 0 weighted raw but must be available in combos)
  const requireTypeCs = constraints.filter(
    (c): c is RequireTypeConstraint => c.kind === "require_type",
  );
  for (const rc of requireTypeCs) {
    const typeItems = allEquip
      .filter((eq) => eq.type[2] === rc.typeId && isCompatibleNormal(ship, eq))
      .sort((a, b) => weightedRaw(b) - weightedRaw(a))
      .slice(0, Math.max(rc.count + 5, 8));
    for (const item of typeItems) {
      if (!normalCandidates.some((x) => x.id === item.id)) {
        normalCandidates.push(item);
      }
    }
  }

  // Ex-slot candidates
  const exCandidates = includeExSlot
    ? allEquip
        .filter((eq) => weightedRaw(eq) > 0 && isCompatibleEx(ship, eq))
        .sort((a, b) => weightedRaw(b) - weightedRaw(a))
        .slice(0, 15)
    : [];

  // Stat keys needed for min_stat constraints but not already in activeStats
  const allMinStatCs = constraints.filter(
    (c): c is MinStatConstraint => c.kind === "min_stat",
  );
  // Separate constraints by whether the ship's base stat is available (non-null)
  const shipStatOf = (key: string): number[] | null =>
    (ship as unknown as Record<string, number[] | null>)[key] ?? null;
  const nullBaseStats = allMinStatCs
    .filter((c) => shipStatOf(c.statKey) === null)
    .map((c) => c.statKey);
  const minStatCs = allMinStatCs.filter((c) => shipStatOf(c.statKey) !== null);
  const extraStatKeys = minStatCs
    .map((c) => c.statKey)
    .filter((k) => !activeStats.some((s) => s.key === k));

  const slotCount = Math.min(ship.slot_num, MAX_COMBO_SIZE);
  // C(n, k) requires n >= k; if fewer candidates than slots, no valid combinations exist.
  if (slotCount === 0 || normalCandidates.length < slotCount) return { results: [], nullBaseStats };

  const results: ComboResult[] = [];
  const n = normalCandidates.length;
  const indices = Array.from({ length: slotCount }, (_, i) => i);
  const zeros = new Array(slotCount).fill(0);
  const masterItems = getMasterSlotItems();

  const evalCombo = (comboIndices: number[], exId: number | null) => {
    const ids = comboIndices.map((i) => normalCandidates[i].id);
    const imps = improvementMap ? ids.map((id) => improvementMap[id] ?? 0) : zeros;
    const exImp = improvementMap && exId != null ? (improvementMap[exId] ?? 0) : 0;
    const bonuses = computeEquipBonuses(ship.id, ids, exId, imps, exImp);
    const exEq = exId != null ? masterItems[exId] : null;

    const statTotals: Record<string, number> = {};
    let score = 0;
    // Compute active stats (used for scoring)
    for (const { key, weight } of activeStats) {
      const raw =
        comboIndices.reduce((s, ci) => {
          const eq = normalCandidates[ci];
          return s + rawStat(eq, key);
        }, 0) +
        (exEq ? rawStat(exEq, key) : 0);
      const bonus = bonuses[key] ?? 0;
      statTotals[key] = raw + bonus;
      score += weight * (raw + bonus);
    }
    // Compute extra stat keys needed for min_stat constraint checks
    for (const key of extraStatKeys) {
      const raw =
        comboIndices.reduce((s, ci) => {
          const eq = normalCandidates[ci];
          return s + rawStat(eq, key);
        }, 0) +
        (exEq ? rawStat(exEq, key) : 0);
      statTotals[key] = raw + (bonuses[key] ?? 0);
    }

    // Check min_stat constraints (ship base + equip total)
    // (constraints where base is null are already excluded from minStatCs)
    for (const c of minStatCs) {
      if (shipBaseStat(ship, c.statKey) + (statTotals[c.statKey] ?? 0) < c.threshold) return;
    }
    // Check require_type constraints
    for (const rc of requireTypeCs) {
      const cnt =
        ids.filter((id) => masterItems[id]?.type[2] === rc.typeId).length +
        (exEq?.type[2] === rc.typeId ? 1 : 0);
      if (cnt < rc.count) return;
    }

    results.push({ equipIds: ids, exSlotId: exId, statTotals, score });
  };

  const generateCombos = async (exId: number | null) => {
    for (let i = 0; i < slotCount; i++) indices[i] = i;
    let lastYield = performance.now();
    while (true) {
      evalCombo(indices, exId);
      // Yield to the browser every ~16 ms so CSS spinner animation keeps running
      const now = performance.now();
      if (now - lastYield >= 16) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
      let i = slotCount - 1;
      while (i >= 0 && indices[i] === n - slotCount + i) i--;
      if (i < 0) break;
      indices[i]++;
      for (let j = i + 1; j < slotCount; j++) indices[j] = indices[j - 1] + 1;
    }
  };

  if (exCandidates.length === 0) {
    await generateCombos(null);
  } else {
    for (const exEq of exCandidates) {
      await generateCombos(exEq.id);
    }
    await generateCombos(null);
  }

  results.sort((a, b) => b.score - a.score);
  return { results: results.slice(0, MAX_RESULTS), nullBaseStats };
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

function EquipChip(props: { equip: MstSlotItemData | null; badge?: string; improvement?: number }): JSX.Element {
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
            <span class="shrink-0 text-accent/70 font-mono">★{props.improvement}</span>
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

  const [selectedShipId, setSelectedShipId] = createSignal<number | null>(urlInit?.shipId ?? null);
  const [statWeights, setStatWeights] = createSignal<Record<string, number>>(
    urlInit?.weights
      ? Object.fromEntries(TARGET_STATS.map((s) => [s.key, urlInit.weights[s.key] ?? 0]))
      : Object.fromEntries(TARGET_STATS.map((s) => [s.key, 0])),
  );
  const [includeExSlot, setIncludeExSlot] = createSignal(urlInit?.exSlot ?? false);
  const [results, setResults] = createSignal<ComboResult[]>([]);
  const [running, setRunning] = createSignal(false);
  const [ran, setRan] = createSignal(false);
  const [nullBaseStats, setNullBaseStats] = createSignal<string[]>([]);
  // "master" = all master data, "snapshot" = player's owned data only
  const [dataSource, setDataSource] = createSignal<"master" | "snapshot">("master");
  const [useImprovements, setUseImprovements] = createSignal(false);
  const [lastImprovementMap, setLastImprovementMap] = createSignal<Record<number, number>>({});

  // ── Constraint state ──────────────────────────────────────────────
  const [constraints, setConstraints] = createSignal<Constraint[]>(urlInit?.constraints ?? []);
  const [showAddForm, setShowAddForm] = createSignal(false);
  const [addKind, setAddKind] = createSignal<"min_stat" | "require_type">("min_stat");
  const [addStatKey, setAddStatKey] = createSignal("tais");
  const [addThreshold, setAddThreshold] = createSignal(100);
  const [addTypeId, setAddTypeId] = createSignal(14);
  const [addTypeCount, setAddTypeCount] = createSignal(1);

  const resetResults = () => { setResults([]); setRan(false); setNullBaseStats([]); };

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
    } else {
      setConstraints((prev) => [
        ...prev,
        { kind: "require_type", typeId: addTypeId(), count: addTypeCount() },
      ]);
    }
    setShowAddForm(false);
    resetResults();
  };

  const selectedShip = createMemo((): MstShipData | null => {
    const id = selectedShipId();
    if (id == null) return null;
    return getMasterShips()[id] ?? null;
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

  const hasWeights = createMemo(() => activeStats().length > 0);
  const isMultiStat = createMemo(
    () => activeStats().length > 1 || activeStats().some((s) => s.weight > 1),
  );

  /** Min-stat constraint stats not covered by activeStats — shown in results */
  const extraConstraintStats = createMemo(() => {
    const ship = selectedShip();
    if (!ship) return [];
    return constraints()
      .filter((c): c is MinStatConstraint => c.kind === "min_stat")
      .filter((c) => !activeStats().some((s) => s.key === c.statKey))
      .map((c) => ({
        key: c.statKey,
        label: TARGET_STATS.find((s) => s.key === c.statKey)?.label ?? c.statKey,
        base: shipBaseStat(ship, c.statKey),
        threshold: c.threshold,
      }));
  });

  const slotLabel = createMemo(() => {
    const ship = selectedShip();
    if (!ship) return "";
    const slots = Math.min(ship.slot_num, MAX_COMBO_SIZE);
    return includeExSlot() ? `${slots}スロット＋補強増設` : `${slots}スロット`;
  });

  const candidateCounts = createMemo((): { normal: number; ex: number } => {
    const ship = selectedShip();
    if (!ship) return { normal: 0, ex: 0 };
    const stats = activeStats();
    if (stats.length === 0) return { normal: 0, ex: 0 };

    // Build the same equipment pool as handleCalculate
    let poolMap: Record<number, MstSlotItemData>;
    if (dataSource() === "snapshot" && hasSnapshotSlotItems()) {
      const ss = getSnapshotSlotItems();
      const masterItems = getMasterSlotItems();
      const uniqueIds = [...new Set(Object.values(ss).map((s) => s.slotitem_id))];
      poolMap = Object.fromEntries(
        uniqueIds.map((id) => [id, masterItems[id]]).filter(([, v]) => v != null),
      ) as Record<number, MstSlotItemData>;
    } else {
      poolMap = getMasterSlotItems();
    }
    const allEquip = Object.values(poolMap).filter((eq) => eq.id < ENEMY_ID_THRESHOLD);

    const wRaw = (eq: MstSlotItemData): number => {
      return stats.reduce(
        (s, { key, weight }) => s + weight * rawStat(eq, key),
        0,
      );
    };

    // Normal candidates: positive weighted raw, compatible + require_type augmentation
    const normalSet = new Set<number>(
      allEquip.filter((eq) => wRaw(eq) > 0 && isCompatibleNormal(ship, eq)).map((eq) => eq.id),
    );
    for (const c of constraints().filter((c): c is RequireTypeConstraint => c.kind === "require_type")) {
      allEquip
        .filter((eq) => eq.type[2] === c.typeId && isCompatibleNormal(ship, eq))
        .forEach((eq) => normalSet.add(eq.id));
    }

    const exCount = includeExSlot()
      ? allEquip.filter((eq) => wRaw(eq) > 0 && isCompatibleEx(ship, eq)).length
      : 0;

    return { normal: normalSet.size, ex: exCount };
  });

  const estimatedCombos = createMemo(() => {
    const ship = selectedShip();
    if (!ship || !hasWeights()) return 0;
    const { normal, ex } = candidateCounts();
    const n = Math.min(normal, MAX_CANDIDATES);
    const k = Math.min(ship.slot_num, MAX_COMBO_SIZE);
    const baseCombo = choose(n, k);
    if (!includeExSlot()) return baseCombo;
    return baseCombo * (Math.min(ex, 15) + 1);
  });

  const handleShare = async () => {
    const payload: OptimizerSharePayload = {
      v: 1,
      kind: "optimizer",
      shipId: selectedShipId(),
      weights: Object.fromEntries(Object.entries(statWeights()).filter(([, v]) => v > 0)),
      constraints: constraints(),
      exSlot: includeExSlot(),
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
    const ship = selectedShip();
    const stats = activeStats();
    if (!ship || stats.length === 0) return;
    setRunning(true);
    setRan(false);
    try {
      let equipPool: Record<number, MstSlotItemData> | undefined;
      if (dataSource() === "snapshot" && hasSnapshotSlotItems()) {
        const ss = getSnapshotSlotItems();
        const masterItems = getMasterSlotItems();
        const uniqueIds = [...new Set(Object.values(ss).map((s) => s.slotitem_id))];
        equipPool = Object.fromEntries(
          uniqueIds.map((id) => [id, masterItems[id]]).filter(([, v]) => v != null),
        ) as Record<number, MstSlotItemData>;
      }
      let improvMap: Record<number, number> | undefined;
      if (useImprovements() && dataSource() === "snapshot" && hasSnapshotSlotItems()) {
        const ss = getSnapshotSlotItems();
        improvMap = {};
        for (const inst of Object.values(ss)) {
          const cur = improvMap[inst.slotitem_id] ?? 0;
          if (inst.level > cur) improvMap[inst.slotitem_id] = inst.level;
        }
      }
      setLastImprovementMap(improvMap ?? {});
      const { results: r, nullBaseStats: skipped } = await runOptimizer(ship, stats, includeExSlot(), constraints(), equipPool, improvMap);
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

  return (
    <div class="space-y-4">
      {/* Controls */}
      <div class="bg-base-100 rounded-xl border border-base-300/40 shadow-sm p-4">
        <h2 class="text-sm font-semibold mb-1">装備最適化（複合ステータス対応）</h2>
        <p class="text-xs text-base-content/55 mb-4">
          比重を設定したステータスの加重合計が最高になる装備コンボ上位{MAX_RESULTS}
          件を表示します。クリックで×1→×2→×3→×0と切り替えます。
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
                  onClick={() => { setDataSource("master"); resetResults(); setSelectedShipId(null); }}
                >全データ</button>
                <button
                  class={`btn btn-xs ${dataSource() === "snapshot" ? "btn-primary" : "btn-ghost border border-base-300"}`}
                  onClick={() => { setDataSource("snapshot"); resetResults(); setSelectedShipId(null); }}
                >保有のみ</button>
              </div>
              <Show when={dataSource() === "snapshot" && hasSnapshotSlotItems()}>
                <div class="flex items-center gap-2">
                  <span class="text-base-content/55 shrink-0">改修値:</span>
                  <button
                    class={`btn btn-xs ${useImprovements() ? "btn-primary" : "btn-ghost border border-base-300"}`}
                    onClick={() => { setUseImprovements((v) => !v); resetResults(); }}
                  >{useImprovements() ? "反映中" : "反映しない"}</button>
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
                    class="btn btn-sm btn-outline btn-block justify-start text-base-content/50 font-normal"
                    onClick={openShipPicker}
                  >
                    艦を選択…
                  </button>
                }
              >
                {(ship) => (
                  <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-base-300 bg-base-200/40">
                    <button
                      class="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                      onClick={openShipPicker}
                    >
                      <span class="font-medium text-sm truncate">{ship().name}</span>
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
                <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
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
              <label class="text-xs font-medium text-base-content/65">制約条件</label>
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
                    <span class="text-xs text-base-content/55">(艦基礎＋装備) ≥</span>
                    <input
                      type="number"
                      class="input input-xs input-bordered w-20"
                      value={addThreshold()}
                      onInput={(e) =>
                        setAddThreshold(Number(e.currentTarget.value) || 0)
                      }
                    />
                    <Show when={selectedShip()}>
                      {(ship) => {
                        const base = () => shipBaseStat(ship(), addStatKey());
                        const needed = () => Math.max(0, addThreshold() - base());
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
                      onChange={(e) => setAddTypeId(Number(e.currentTarget.value))}
                    >
                      <For each={REQUIRE_TYPE_IDS}>
                        {(typeId) => <option value={typeId}>{getRequireTypeLabel(typeId)}</option>}
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
                        setAddTypeCount(Math.max(1, Number(e.currentTarget.value) || 1))
                      }
                    />
                    <span class="text-xs text-base-content/55">個以上装備</span>
                  </div>
                </Show>

                <div class="flex gap-2">
                  <button class="btn btn-xs btn-primary" onClick={confirmAddConstraint}>
                    追加
                  </button>
                  <button class="btn btn-xs btn-ghost" onClick={() => setShowAddForm(false)}>
                    キャンセル
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>

        {/* Info row */}
        <Show when={selectedShip() && hasWeights()}>
          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/50">
            <span>対象スロット: {slotLabel()}</span>
            <span>
              候補装備数: {candidateCounts().normal}件 (上位
              {Math.min(candidateCounts().normal, MAX_CANDIDATES)}件を使用)
            </span>
            <span>評価組合せ数: 約{estimatedCombos().toLocaleString()}通り</span>
          </div>
        </Show>
      </div>

      {/* Results */}
      <Show when={ran()}>
        <Show when={nullBaseStats().length > 0}>
          <div class="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-xl px-4 py-2.5 text-xs text-base-content/70">
            <svg class="shrink-0 w-4 h-4 stroke-current text-warning mt-px" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>
              艦の基礎{nullBaseStats().map((k) => TARGET_STATS.find((s) => s.key === k)?.label ?? k).join("・")}データが未収録のため、
              合計値制約は適用されていません。代わりに装備値の高い組み合わせを表示しています。
            </span>
          </div>
        </Show>
        <div class="bg-base-100 rounded-xl border border-base-300/40 shadow-sm overflow-hidden">
          <div class="px-4 py-3 border-b border-base-200 bg-linear-to-r from-primary/5 to-transparent">
            <h3 class="text-sm font-semibold">
              {selectedShip()?.name} — {activeStatLabel()} 上位{results().length}件
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
                                {label} {total >= 0 ? "+" : ""}
                                {total}
                              </span>
                            );
                          }}
                        </For>
                        {/* Constraint stats not in active stats — show total (base+equip) */}
                        <For each={extraConstraintStats()}>
                          {({ key, label, base, threshold }) => {
                            const total = base + (row.statTotals[key] ?? 0);
                            return (
                              <span
                                class={`${total >= threshold ? "text-success/80" : "text-error"}`}
                                title={`艦基礎 ${base} ＋ 装備 ${row.statTotals[key] ?? 0} = ${total}`}
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
                        {(id) => <EquipChip equip={getEquip(id)} improvement={lastImprovementMap()[id]} />}
                      </For>
                      <Show when={row.exSlotId != null}>
                        <EquipChip
                          equip={getEquip(row.exSlotId!)}
                          badge="補強"
                          improvement={lastImprovementMap()[row.exSlotId!]}
                        />
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <div class="px-4 py-2 border-t border-base-200 text-[11px] text-base-content/40">
              ※ 同一装備の重複搭載は考慮していません。熟練度は0で計算しています。
              {useImprovements() && Object.keys(lastImprovementMap()).length > 0
                ? "改修値は保有データを使用しています（改修値を参照する装備ボーナス判定に反映）。"
                : "改修値は0で計算しています。"}
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
