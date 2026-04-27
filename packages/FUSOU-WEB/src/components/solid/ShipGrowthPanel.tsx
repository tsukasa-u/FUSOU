/** @jsxImportSource solid-js */
import {
  batch,
  createEffect,
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  Chart,
  registerables,
  type ChartData,
  type ChartDataset,
} from "chart.js";
import { cachedFetch } from "@/utility/fetchCache";
import {
  ENEMY_ID_THRESHOLD,
  STYPE_NAMES,
} from "../../pages/simulator/lib/constants";
import { buildShareGrowthUrl, copyTextWithFallback } from "@/utility/share-url";
import { ShipListRow, type ShipListItem } from "./common/ship-list-row";
import { AlertMessage } from "./common/AlertMessage";
import { ShareUrlButton } from "./common/ShareUrlButton";

Chart.register(...registerables);

// ── Types ──────────────────────────────────────────────────────────

type PeriodSource = "live" | "cumulative" | "all";

type PeriodSummary = {
  period_tag: string;
  table_version: string;
  source?: PeriodSource;
};

const CUMULATIVE_PERIOD_TAG = "__cumulative__";
const CUMULATIVE_TABLE_VERSION = "__archive__";

const ALL_PERIODS_PERIOD_TAG = "__all-periods__";
const ALL_PERIODS_TABLE_VERSION = "__all__";

function isCumulativePeriod(p: PeriodSummary | null | undefined): boolean {
  return (
    !!p &&
    p.period_tag === CUMULATIVE_PERIOD_TAG &&
    p.table_version === CUMULATIVE_TABLE_VERSION
  );
}

function isAllPeriodsPeriod(p: PeriodSummary | null | undefined): boolean {
  return (
    !!p &&
    p.period_tag === ALL_PERIODS_PERIOD_TAG &&
    p.table_version === ALL_PERIODS_TABLE_VERSION
  );
}

function periodLabel(p: PeriodSummary): string {
  if (isCumulativePeriod(p)) return "累積（過去アーカイブ統合）";
  if (isAllPeriodsPeriod(p)) return "全期間比較";
  return `${p.period_tag} (v${p.table_version})`;
}

type ExpRow = {
  lv: number;
  exp_current: number;
};

type BoundRow = {
  master_id: number;
  lv: number;
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
  // Optional: source period that contributed the winning (minimum) value.
  // Populated only in cumulative mode from /api/ship-growth/cumulative.
  kaihi_source_period?: string;
  taisen_source_period?: string;
  sakuteki_source_period?: string;
};

type AllPeriodsEntry = {
  period_tag: string;
  table_version: string;
  bounds: BoundRow[];
  caps: CapRow[];
};

type CapRow = {
  master_id: number;
  kaihi_max: number;
  taisen_max: number;
  sakuteki_max: number;
};

type ShipMasterRow = {
  id: number;
  name: string;
  stype: number | null;
};

type AnyRecord = Record<string, unknown>;

// ── Helpers ────────────────────────────────────────────────────────

function buildExpChartData(expRows: ExpRow[]) {
  return {
    datasets: [
      {
        label: "累積経験値",
        data: expRows.map((r) => ({ x: r.lv, y: r.exp_current })),
        borderColor: "rgb(99, 102, 241)",
        backgroundColor: "rgba(99, 102, 241, 0.1)",
        fill: true,
        tension: 0,
        pointRadius: 2,
      },
    ],
  };
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBoundRows(rows: unknown): BoundRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const r = row as AnyRecord;
      return {
        master_id: toFiniteNumber(r.master_id),
        lv: toFiniteNumber(r.lv),
        kaihi_naked: toFiniteNumber(r.kaihi_naked),
        taisen_naked: toFiniteNumber(r.taisen_naked),
        sakuteki_naked: toFiniteNumber(r.sakuteki_naked),
        kaihi_source_period:
          typeof r.kaihi_source_period === "string"
            ? r.kaihi_source_period
            : undefined,
        taisen_source_period:
          typeof r.taisen_source_period === "string"
            ? r.taisen_source_period
            : undefined,
        sakuteki_source_period:
          typeof r.sakuteki_source_period === "string"
            ? r.sakuteki_source_period
            : undefined,
      };
    })
    .filter(
      (row) =>
        Number.isFinite(row.master_id) &&
        row.master_id > 0 &&
        Number.isFinite(row.lv) &&
        row.lv > 0,
    );
}

function normalizeCapRows(rows: unknown): CapRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const r = row as AnyRecord;
      return {
        master_id: toFiniteNumber(r.master_id),
        kaihi_max: toFiniteNumber(r.kaihi_max ?? r.kaihi_cap),
        taisen_max: toFiniteNumber(r.taisen_max ?? r.taisen_cap),
        sakuteki_max: toFiniteNumber(r.sakuteki_max ?? r.sakuteki_cap),
      };
    })
    .filter((row) => Number.isFinite(row.master_id) && row.master_id > 0);
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

// Data point type for bounds chart — includes optional source period used by
// the cumulative mode tooltip to show which period contributed the min value.
type BoundsDataPoint = { x: number; y: number; sourcePeriod?: string };

function buildBoundsChartData(
  boundRows: BoundRow[],
  cap: CapRow | null,
): ChartData<"line", BoundsDataPoint[]> {
  const minLv = boundRows[0]?.lv ?? 1;
  const maxLv = boundRows[boundRows.length - 1]?.lv ?? 180;

  const datasets: ChartDataset<"line", BoundsDataPoint[]>[] = [
    {
      label: "回避(naked)",
      data: boundRows.map((r) => ({
        x: r.lv,
        y: r.kaihi_naked,
        sourcePeriod: r.kaihi_source_period,
      })),
      borderColor: "rgb(34, 197, 94)",
      backgroundColor: "transparent",
      tension: 0,
      pointRadius: 2,
    },
    {
      label: "対潜(naked)",
      data: boundRows.map((r) => ({
        x: r.lv,
        y: r.taisen_naked,
        sourcePeriod: r.taisen_source_period,
      })),
      borderColor: "rgb(249, 115, 22)",
      backgroundColor: "transparent",
      tension: 0,
      pointRadius: 2,
    },
    {
      label: "索敵(naked)",
      data: boundRows.map((r) => ({
        x: r.lv,
        y: r.sakuteki_naked,
        sourcePeriod: r.sakuteki_source_period,
      })),
      borderColor: "rgb(168, 85, 247)",
      backgroundColor: "transparent",
      tension: 0,
      pointRadius: 2,
    },
  ];

  // Cap reference lines are only meaningful when there are bounds rows to
  // compare against. Skip them when boundRows is empty to avoid generating a
  // dataset-only chart on a detached canvas (e.g. ship absent from cumulative).
  if (cap && boundRows.length > 0) {
    if (Number.isFinite(cap.kaihi_max) && cap.kaihi_max > 0) {
      datasets.push({
        label: "回避(cap)",
        data: [
          { x: minLv, y: cap.kaihi_max },
          { x: maxLv, y: cap.kaihi_max },
        ],
        borderColor: "rgba(34, 197, 94, 0.6)",
        borderDash: [8, 6],
        pointRadius: 0,
        tension: 0,
      });
    }
    if (Number.isFinite(cap.taisen_max) && cap.taisen_max > 0) {
      datasets.push({
        label: "対潜(cap)",
        data: [
          { x: minLv, y: cap.taisen_max },
          { x: maxLv, y: cap.taisen_max },
        ],
        borderColor: "rgba(249, 115, 22, 0.6)",
        borderDash: [8, 6],
        pointRadius: 0,
        tension: 0,
      });
    }
    if (Number.isFinite(cap.sakuteki_max) && cap.sakuteki_max > 0) {
      datasets.push({
        label: "索敵(cap)",
        data: [
          { x: minLv, y: cap.sakuteki_max },
          { x: maxLv, y: cap.sakuteki_max },
        ],
        borderColor: "rgba(168, 85, 247, 0.6)",
        borderDash: [8, 6],
        pointRadius: 0,
        tension: 0,
      });
    }
  }

  return { datasets };
}

// Stat colors used across all periods in the all-periods chart.
// Same hue for every period — recency is communicated by opacity + line weight:
//   newest period → full opacity + thicker line (vivid)
//   older periods → progressively more transparent + thinner
// Hover highlights use saturated border + larger point hit radius.
const STAT_COLORS = {
  kaihi: "34,197,94",      // green
  taisen: "249,115,22",    // orange
  sakuteki: "168,85,247",  // purple
} as const;

function buildAllPeriodsBoundsChartData(
  entries: AllPeriodsEntry[],
  masterId: number | null,
): ChartData<"line", BoundsDataPoint[]> {
  const datasets: ChartDataset<"line", BoundsDataPoint[]>[] = [];
  const total = entries.length;
  // Pre-compute the last index that actually has data for the selected ship.
  // This is used to give the "newest" visual treatment (full opacity + thick
  // border) to the most recent period that HAS data, not the most recent
  // period overall (which may have been skipped for this ship).
  let lastDataIdx = -1;
  for (let i = total - 1; i >= 0; i--) {
    const hasRows = masterId != null
      ? entries[i].bounds.some((r) => r.master_id === masterId)
      : entries[i].bounds.length > 0;
    if (hasRows) { lastDataIdx = i; break; }
  }
  for (let i = 0; i < total; i++) {
    const entry = entries[i];
    const rows =
      masterId != null
        ? entry.bounds.filter((r) => r.master_id === masterId)
        : entry.bounds;
    if (rows.length === 0) continue;
    // Older entries (lower index) get lower opacity; newest is fully opaque.
    // Min alpha=0.15 keeps older lines legible while clearly marking them as "old".
    const alpha = total > 1 ? 0.15 + 0.85 * (i / (total - 1)) : 1;
    // The most recent period that has data for this ship gets a thicker line.
    const borderWidth = i === lastDataIdx ? 2.5 : 1.5;
    const shortLabel = `${entry.period_tag}(v${entry.table_version})`;
    const { kaihi, taisen, sakuteki } = STAT_COLORS;
    datasets.push(
      {
        label: `回避(naked) - ${shortLabel}`,
        data: rows.map((r) => ({ x: r.lv, y: r.kaihi_naked })),
        borderColor: `rgba(${kaihi},${alpha})`,
        hoverBorderColor: `rgb(${kaihi})`,
        backgroundColor: "transparent",
        borderWidth,
        hoverBorderWidth: 3,
        tension: 0,
        pointRadius: 1,
        pointHoverRadius: 4,
      },
      {
        label: `対潜(naked) - ${shortLabel}`,
        data: rows.map((r) => ({ x: r.lv, y: r.taisen_naked })),
        borderColor: `rgba(${taisen},${alpha})`,
        hoverBorderColor: `rgb(${taisen})`,
        backgroundColor: "transparent",
        borderWidth,
        hoverBorderWidth: 3,
        tension: 0,
        pointRadius: 1,
        pointHoverRadius: 4,
      },
      {
        label: `索敵(naked) - ${shortLabel}`,
        data: rows.map((r) => ({ x: r.lv, y: r.sakuteki_naked })),
        borderColor: `rgba(${sakuteki},${alpha})`,
        hoverBorderColor: `rgb(${sakuteki})`,
        backgroundColor: "transparent",
        borderWidth,
        hoverBorderWidth: 3,
        tension: 0,
        pointRadius: 1,
        pointHoverRadius: 4,
      },
    );
  }
  return { datasets };
}

const CHART_OPTIONS_EXP = {
  responsive: true,
  animation: false as const,
  plugins: {
    legend: { display: false },
    tooltip: { mode: "index" as const, intersect: false },
  },
  scales: {
    x: {
      type: "linear" as const,
      title: { display: true, text: "レベル" },
      ticks: { maxTicksLimit: 20 },
    },
    y: { title: { display: true, text: "累積経験値" } },
  },
} as const;

const CHART_OPTIONS_BOUNDS = {
  responsive: true,
  animation: false as const,
  plugins: {
    legend: { display: true, position: "top" as const },
    tooltip: { mode: "index" as const, intersect: false },
  },
  scales: {
    x: {
      type: "linear" as const,
      title: { display: true, text: "レベル" },
      ticks: { maxTicksLimit: 20 },
    },
    y: { title: { display: true, text: "ステータス値" } },
  },
} as const;

// All-periods chart options: "nearest" interaction so hovering a single line
// shows only that line's label (= period tag) and value in the tooltip.
// Using "index" would show 3N entries (N periods × 3 stats) simultaneously,
// which is unreadable when many archive periods are present.
const CHART_OPTIONS_BOUNDS_ALL_PERIODS = {
  responsive: true,
  animation: false as const,
  interaction: {
    mode: "nearest" as const,
    axis: "x" as const,
    intersect: false,
  },
  plugins: {
    legend: { display: true, position: "top" as const },
    tooltip: {
      mode: "nearest" as const,
      intersect: false,
    },
  },
  scales: {
    x: {
      type: "linear" as const,
      title: { display: true, text: "レベル" },
      ticks: { maxTicksLimit: 20 },
    },
    y: { title: { display: true, text: "ステータス値" } },
  },
} as const;

// Cumulative-mode bounds chart: adds a per-dataset tooltip afterLabel line
// showing which period contributed the minimum ("winning") value.
const CHART_OPTIONS_BOUNDS_CUMULATIVE = {
  responsive: true,
  animation: false as const,
  plugins: {
    legend: { display: true, position: "top" as const },
    tooltip: {
      mode: "index" as const,
      intersect: false,
      callbacks: {
        afterLabel: (item: {
          raw: unknown;
          dataset: { label?: string };
        }): string | string[] => {
          const raw = item.raw as { sourcePeriod?: string };
          return raw?.sourcePeriod ? `  出典: ${raw.sourcePeriod}` : [];
        },
      },
    },
  },
  scales: {
    x: {
      type: "linear" as const,
      title: { display: true, text: "レベル" },
      ticks: { maxTicksLimit: 20 },
    },
    y: { title: { display: true, text: "ステータス値" } },
  },
};

// ── Component ──────────────────────────────────────────────────────

export default function ShipGrowthPanel() {
  const [periods, setPeriods] = createSignal<PeriodSummary[]>([]);
  const [selectedPeriodIdx, setSelectedPeriodIdx] = createSignal(0);
  const [shipMasterRows, setShipMasterRows] = createSignal<ShipMasterRow[]>([]);
  const [shipSearchKeyword, setShipSearchKeyword] = createSignal("");
  const [selectedShipCategory, setSelectedShipCategory] = createSignal("all");
  const [selectedMasterId, setSelectedMasterId] = createSignal<number | null>(
    null,
  );
  const [expRows, setExpRows] = createSignal<ExpRow[]>([]);
  const [allBoundRows, setAllBoundRows] = createSignal<BoundRow[]>([]);
  const [allCapRows, setAllCapRows] = createSignal<CapRow[]>([]);
  const [boundRows, setBoundRows] = createSignal<BoundRow[]>([]);
  const [selectedCap, setSelectedCap] = createSignal<CapRow | null>(null);
  const [loadingPeriods, setLoadingPeriods] = createSignal(true);
  const [loadingShips, setLoadingShips] = createSignal(true);
  const [loadingData, setLoadingData] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [expCanvas, setExpCanvas] = createSignal<HTMLCanvasElement | null>(
    null,
  );
  const [boundsCanvas, setBoundsCanvas] =
    createSignal<HTMLCanvasElement | null>(null);
  const [initialPeriodTag, setInitialPeriodTag] = createSignal<string | null>(
    null,
  );
  const [initialTableVersion, setInitialTableVersion] = createSignal<
    string | null
  >(null);
  const [initialMasterId, setInitialMasterId] = createSignal<number | null>(
    null,
  );
  const [initialCumulative, setInitialCumulative] = createSignal(false);
  const [initialAllPeriods, setInitialAllPeriods] = createSignal(false);
  // Per-period breakdown fetched from /api/ship-growth/all-periods.
  const [allPeriodsEntries, setAllPeriodsEntries] = createSignal<
    AllPeriodsEntry[]
  >([]);
  // Tracks which period the exp data was actually fetched from. In cumulative
  // mode, exp data is sourced from the most recent live period (archives do
  // not store exp tables), so this differs from selectedPeriod().
  const [expSourcePeriod, setExpSourcePeriod] =
    createSignal<PeriodSummary | null>(null);

  const selectedPeriod = createMemo(
    () => periods()[selectedPeriodIdx()] ?? null,
  );

  const selectedShip = createMemo(() => {
    const id = selectedMasterId();
    if (id == null) return null;
    return shipMasterRows().find((ship) => ship.id === id) ?? null;
  });

  const shipCategories = createMemo(() => {
    const categories = new Set<string>();
    for (const ship of shipMasterRows()) {
      categories.add(
        ship.stype != null
          ? (STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`)
          : "その他",
      );
    }
    return Array.from(categories).sort((a, b) => a.localeCompare(b, "ja"));
  });

  const filteredShips = createMemo(() => {
    const keyword = shipSearchKeyword().trim().toLowerCase();
    const selectedCategory = selectedShipCategory();

    return shipMasterRows().filter((ship) => {
      const category =
        ship.stype != null
          ? (STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`)
          : "その他";
      if (selectedCategory !== "all" && category !== selectedCategory)
        return false;
      if (!keyword) return true;
      return (
        ship.name.toLowerCase().includes(keyword) ||
        `${ship.id}`.includes(keyword)
      );
    });
  });

  const groupedShips = createMemo(() => {
    const map = new Map<string, ShipListItem[]>();
    for (const ship of filteredShips()) {
      const key =
        ship.stype != null
          ? (STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`)
          : "その他";
      const rows = map.get(key);
      if (rows) rows.push(ship);
      else map.set(key, [ship]);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "ja"))
      .map(([key, items]) => ({ key, items }));
  });

  async function fetchSummary() {
    setLoadingPeriods(true);
    setError(null);
    try {
      const res = await cachedFetch("/api/ship-growth/summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        periods: PeriodSummary[];
        cumulative_available?: boolean;
      };
      if (!json.ok || !Array.isArray(json.periods))
        throw new Error("Unexpected response");
      const base: PeriodSummary[] = json.periods.map((p) => ({
        period_tag: p.period_tag,
        table_version: p.table_version,
        source: "live",
      }));
      const merged: PeriodSummary[] = [...base];
      if (json.cumulative_available) {
        merged.push({
          period_tag: CUMULATIVE_PERIOD_TAG,
          table_version: CUMULATIVE_TABLE_VERSION,
          source: "cumulative",
        });
        merged.push({
          period_tag: ALL_PERIODS_PERIOD_TAG,
          table_version: ALL_PERIODS_TABLE_VERSION,
          source: "all",
        });
      }
      setPeriods(merged);
    } catch (e) {
      setError(
        `期間データの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setLoadingPeriods(false);
    }
  }

  async function fetchShipMasters() {
    setLoadingShips(true);
    setError(null);
    try {
      const res = await cachedFetch(
        "/api/master-data/json?table_name=mst_ship",
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        records?: Array<{ id?: number; name?: string; stype?: number }>;
      };
      const rows = (json.records ?? [])
        .map((r) => ({
          id: Number(r.id),
          name: String(r.name ?? "").trim(),
          stype: Number.isFinite(Number(r.stype)) ? Number(r.stype) : null,
        }))
        .filter(
          (r) =>
            Number.isFinite(r.id) &&
            r.id > 0 &&
            r.id < ENEMY_ID_THRESHOLD &&
            r.name.length > 0,
        )
        .sort((a, b) => a.id - b.id);

      setShipMasterRows(rows);
    } catch (e) {
      setError(
        `艦マスタの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setLoadingShips(false);
    }
  }

  function selectShip(masterId: number) {
    if (!shipMasterRows().some((ship) => ship.id === masterId)) return;
    setSelectedMasterId(masterId);
  }

  function applySelectedShipBounds(masterId: number | null) {
    if (masterId == null) {
      setBoundRows([]);
      setSelectedCap(null);
      return;
    }
    setBoundRows(allBoundRows().filter((row) => row.master_id === masterId));
    setSelectedCap(
      allCapRows().find((row) => row.master_id === masterId) ?? null,
    );
  }

  let fetchGrowthDataVersion = 0;

  async function fetchGrowthData() {
    const period = selectedPeriod();
    if (!period) return;

    // Increment version so any in-flight call that was started for a previous
    // period can detect it is stale and discard its results.
    const currentVersion = ++fetchGrowthDataVersion;
    const isCurrentFetch = () => fetchGrowthDataVersion === currentVersion;

    setLoadingData(true);
    setError(null);
    try {
      const cumulative = isCumulativePeriod(period);
      const allPeriods = isAllPeriodsPeriod(period);

      // Exp curve: not stored in archives. For cumulative/all-periods
      // selection fall back to whatever live period exists (best-effort) so
      // the chart still shows a reference exp curve. If no live period exists,
      // skip.
      let expPeriod: PeriodSummary | null = period;
      if (cumulative || allPeriods) {
        expPeriod = periods().find((p) => p.source === "live") ?? null;
      }
      if (expPeriod) {
        const expUrl = `/api/ship-growth/exp?period_tag=${encodeURIComponent(expPeriod.period_tag)}&table_version=${encodeURIComponent(expPeriod.table_version)}`;
        const expRes = await cachedFetch(expUrl);
        if (!expRes.ok) throw new Error(`exp HTTP ${expRes.status}`);
        const expJson = (await expRes.json()) as {
          ok: boolean;
          exp: ExpRow[];
        };
        // Guard: discard if period changed while awaiting exp data.
        if (!isCurrentFetch()) return;
        setExpRows(expJson.exp ?? []);
        setExpSourcePeriod(expPeriod);
      } else {
        setExpRows([]);
        setExpSourcePeriod(null);
      }

      if (allPeriods) {
        // All-periods mode: fetch per-period breakdown from archives, then
        // also fetch the current live period's bounds to append (newest).
        // Exp, all-periods, and live bounds are all fetched in parallel.
        const livePeriodForBounds = periods().find((p) => p.source === "live");
        const [apRes, liveRes] = await Promise.all([
          cachedFetch("/api/ship-growth/all-periods"),
          livePeriodForBounds
            ? cachedFetch(
                `/api/ship-growth/bounds?period_tag=${encodeURIComponent(livePeriodForBounds.period_tag)}&table_version=${encodeURIComponent(livePeriodForBounds.table_version)}`,
              )
            : Promise.resolve(null),
        ]);
        if (!apRes.ok) throw new Error(`all-periods HTTP ${apRes.status}`);
        const apJson = (await apRes.json()) as {
          ok: boolean;
          entries: Array<{
            period_tag: string;
            table_version: string;
            bounds: unknown;
            caps: unknown;
          }>;
        };
        const archivedEntries: AllPeriodsEntry[] = (apJson.entries ?? []).map(
          (e) => ({
            period_tag: e.period_tag,
            table_version: e.table_version,
            bounds: normalizeBoundRows(e.bounds),
            caps: normalizeCapRows(e.caps),
          }),
        );

        const combined: AllPeriodsEntry[] = [...archivedEntries];
        if (liveRes && liveRes.ok) {
          const liveJson = (await liveRes.json()) as {
            ok: boolean;
            bounds?: unknown;
            caps?: unknown;
          };
          // Use the pre-computed livePeriodForBounds (same reference, no
          // re-read of periods() after the await point).
          if (liveJson.ok && livePeriodForBounds) {
            combined.push({
              period_tag: livePeriodForBounds.period_tag,
              table_version: livePeriodForBounds.table_version,
              bounds: normalizeBoundRows(liveJson.bounds),
              caps: normalizeCapRows(liveJson.caps),
            });
          }
        }
        // Guard: discard if period changed while awaiting archive data.
        if (!isCurrentFetch()) return;
        batch(() => {
          setAllPeriodsEntries(combined);
          // Clear single-period signals so stale data doesn't show.
          setAllBoundRows([]);
          setAllCapRows([]);
          setBoundRows([]);
          setSelectedCap(null);
        });
        return;
      }

      // Bounds/caps: route to /cumulative for cumulative selection,
      // /bounds for live periods.
      const boundsUrl = cumulative
        ? "/api/ship-growth/cumulative"
        : `/api/ship-growth/bounds?period_tag=${encodeURIComponent(period.period_tag)}&table_version=${encodeURIComponent(period.table_version)}`;
      const boundsRes = await cachedFetch(boundsUrl);
      if (!boundsRes.ok) throw new Error(`bounds HTTP ${boundsRes.status}`);
      const boundsJson = (await boundsRes.json()) as {
        ok: boolean;
        bounds: BoundRow[];
        caps?: CapRow[];
      };
      // Guard: discard if period changed while awaiting bounds data.
      if (!isCurrentFetch()) return;
      batch(() => {
        setAllBoundRows(normalizeBoundRows(boundsJson.bounds));
        setAllCapRows(normalizeCapRows(boundsJson.caps));
        setAllPeriodsEntries([]);
      });
      applySelectedShipBounds(selectedMasterId());
    } catch (e) {
      // Only surface error if this fetch is still the current one.
      if (isCurrentFetch()) {
        setError(
          `成長データの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } finally {
      // Only clear loading indicator if a newer fetch hasn't already taken over.
      if (isCurrentFetch()) {
        setLoadingData(false);
      }
    }
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    setInitialPeriodTag(params.get("period_tag"));
    setInitialTableVersion(params.get("table_version"));
    setInitialMasterId(parsePositiveInt(params.get("master_id")));
    setInitialCumulative(params.get("cumulative") === "1");
    setInitialAllPeriods(params.get("all_periods") === "1");

    fetchSummary();
    fetchShipMasters();
  });

  createEffect(() => {
    const rows = periods();
    if (rows.length === 0) return;

    if (initialCumulative()) {
      const cIdx = rows.findIndex(isCumulativePeriod);
      if (cIdx >= 0) setSelectedPeriodIdx(cIdx);
      setInitialCumulative(false);
      setInitialPeriodTag(null);
      setInitialTableVersion(null);
      return;
    }

    if (initialAllPeriods()) {
      const aIdx = rows.findIndex(isAllPeriodsPeriod);
      if (aIdx >= 0) setSelectedPeriodIdx(aIdx);
      setInitialAllPeriods(false);
      setInitialPeriodTag(null);
      setInitialTableVersion(null);
      return;
    }

    const periodTag = initialPeriodTag();
    const tableVersion = initialTableVersion();
    if (!periodTag) return;

    const exact = rows.findIndex(
      (p) =>
        p.period_tag === periodTag &&
        (!tableVersion || p.table_version === tableVersion),
    );
    if (exact >= 0) {
      setSelectedPeriodIdx(exact);
    }

    setInitialPeriodTag(null);
    setInitialTableVersion(null);
  });

  createEffect(() => {
    const rows = shipMasterRows();
    if (rows.length === 0) return;
    const initialId = initialMasterId();
    if (initialId != null) {
      if (rows.some((ship) => ship.id === initialId)) {
        setSelectedMasterId(initialId);
      } else if (selectedMasterId() == null) {
        setSelectedMasterId(rows[0].id);
      }
      setInitialMasterId(null);
      return;
    }

    if (selectedMasterId() == null) {
      setSelectedMasterId(rows[0].id);
    }
  });

  createEffect(() => {
    const period = selectedPeriod();
    if (!period) return;
    if (loadingPeriods() || loadingShips()) return;
    fetchGrowthData();
  });

  createEffect(() => {
    applySelectedShipBounds(selectedMasterId());
  });

  createEffect(() => {
    const period = selectedPeriod();
    if (!period) return;

    const url = new URL(window.location.href);
    if (isCumulativePeriod(period)) {
      url.searchParams.set("cumulative", "1");
      url.searchParams.delete("all_periods");
      url.searchParams.delete("period_tag");
      url.searchParams.delete("table_version");
    } else if (isAllPeriodsPeriod(period)) {
      url.searchParams.set("all_periods", "1");
      url.searchParams.delete("cumulative");
      url.searchParams.delete("period_tag");
      url.searchParams.delete("table_version");
    } else {
      url.searchParams.delete("cumulative");
      url.searchParams.delete("all_periods");
      url.searchParams.set("period_tag", period.period_tag);
      url.searchParams.set("table_version", period.table_version);
    }

    const masterId = selectedMasterId();
    if (masterId != null) {
      url.searchParams.set("master_id", String(masterId));
    } else {
      url.searchParams.delete("master_id");
    }

    window.history.replaceState({}, "", url.toString());
  });

  function buildCurrentShareUrl(): string | null {
    const period = selectedPeriod();
    const masterId = selectedMasterId();
    if (!period || masterId == null) return null;
    // Cumulative and all-periods are synthetic local-only selections; share
    // URLs must point to a real period.
    if (isCumulativePeriod(period)) return null;
    if (isAllPeriodsPeriod(period)) return null;

    return buildShareGrowthUrl(window.location.origin, {
      periodTag: period.period_tag,
      tableVersion: period.table_version,
      masterId,
    });
  }

  async function issueShareUrl(): Promise<void> {
    const shareUrl = buildCurrentShareUrl();
    if (!shareUrl) {
      alert("共有URLを生成できませんでした。期間と艦を選択してください。");
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

  const expChartData = createMemo(() => buildExpChartData(expRows()));

  // Bounds chart data: single-period or all-periods view.
  const boundsChartData = createMemo(() => {
    const period = selectedPeriod();
    if (isAllPeriodsPeriod(period)) {
      return buildAllPeriodsBoundsChartData(
        allPeriodsEntries(),
        selectedMasterId(),
      );
    }
    return buildBoundsChartData(boundRows(), selectedCap());
  });

  // Chart options differ by mode:
  //   cumulative   → afterLabel shows source period for each point
  //   all-periods  → nearest-mode tooltip so the period label is readable
  //   live         → standard index-mode tooltip
  const boundsChartOptions = createMemo(() => {
    const period = selectedPeriod();
    if (isCumulativePeriod(period)) return CHART_OPTIONS_BOUNDS_CUMULATIVE;
    if (isAllPeriodsPeriod(period)) return CHART_OPTIONS_BOUNDS_ALL_PERIODS;
    return CHART_OPTIONS_BOUNDS;
  });

  let expChart: Chart<"line"> | null = null;
  let boundsChart: Chart<"line"> | null = null;

  createEffect(() => {
    const canvas = expCanvas();
    const rows = expRows();
    if (!canvas || rows.length === 0) {
      expChart?.destroy();
      expChart = null;
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    expChart?.destroy();
    expChart = new Chart(ctx, {
      type: "line",
      data: expChartData(),
      options: CHART_OPTIONS_EXP,
    });
  });

  createEffect(() => {
    const canvas = boundsCanvas();
    const chartData = boundsChartData();
    const hasData = chartData.datasets.length > 0 &&
      chartData.datasets.some((ds) => ds.data.length > 0);
    if (!canvas || !hasData) {
      boundsChart?.destroy();
      boundsChart = null;
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    boundsChart?.destroy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    boundsChart = new Chart<"line">(ctx, {
      type: "line",
      data: chartData as any,
      options: boundsChartOptions() as any,
    });
  });

  onCleanup(() => {
    expChart?.destroy();
    boundsChart?.destroy();
  });

  return (
    <div class="space-y-6">
      {/* Controls */}
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <h2 class="card-title text-lg">データ選択</h2>
          <div class="flex flex-wrap gap-4 items-end">
            {/* Period selector */}
            <div class="form-control">
              <label class="label">
                <span class="label-text">期間</span>
              </label>
              <Show when={loadingPeriods()}>
                <span class="loading loading-spinner loading-sm" />
              </Show>
              <Show when={!loadingPeriods()}>
                <select
                  class="select select-bordered select-sm"
                  value={selectedPeriodIdx()}
                  onChange={(e) =>
                    setSelectedPeriodIdx(parseInt(e.currentTarget.value, 10))
                  }
                >
                  <For each={periods()}>
                    {(p, i) => <option value={i()}>{periodLabel(p)}</option>}
                  </For>
                </select>
              </Show>
            </div>

            <button
              class="btn btn-primary btn-sm"
              disabled={
                loadingData() ||
                loadingPeriods() ||
                loadingShips() ||
                periods().length === 0 ||
                selectedMasterId() == null
              }
              onClick={() => fetchGrowthData()}
            >
              <Show when={loadingData()}>
                <span class="loading loading-spinner loading-xs" />
              </Show>
              再読み込み
            </button>

            <ShareUrlButton
              id="ship-growth-share-btn"
              disabled={
                loadingPeriods() ||
                loadingShips() ||
                !selectedPeriod() ||
                isCumulativePeriod(selectedPeriod()) ||
                isAllPeriodsPeriod(selectedPeriod())
              }
              onClick={() => {
                void issueShareUrl();
              }}
            />
          </div>

          <Show when={error()}>
            <AlertMessage type="error" class="mt-2">
              {error()}
            </AlertMessage>
          </Show>
        </div>
      </div>

      {/* Ship list + charts */}
      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4 items-start">
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
              class="input input-bordered input-sm w-full"
              placeholder="艦名 / ID で検索"
              value={shipSearchKeyword()}
              onInput={(event) =>
                setShipSearchKeyword(event.currentTarget.value)
              }
            />
          </div>
          <div class="card-body p-2">
            <div class="flex items-center justify-between px-2 pb-2">
              <h3 class="text-sm font-semibold">艦一覧</h3>
              <span class="text-xs text-base-content/50">
                {filteredShips().length} 件
              </span>
            </div>
            <Show when={loadingShips()}>
              <div class="py-8 text-center text-base-content/60">
                <span class="loading loading-spinner loading-sm" />
              </div>
            </Show>
            <Show when={!loadingShips()}>
              <div class="max-h-[74vh] overflow-y-auto pr-1">
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
                              active={selectedMasterId() === ship.id}
                              onSelect={() => selectShip(ship.id)}
                            />
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </aside>

        <div class="space-y-4">
          {/* Exp chart */}
          <Show when={expRows().length > 0}>
            <div class="card bg-base-100 shadow-sm">
              <div class="card-body">
                <h2 class="card-title text-lg">経験値テーブル (累積)</h2>
                <p class="text-sm text-base-content/60">
                  期間: {(expSourcePeriod() ?? selectedPeriod())?.period_tag} /
                  v{(expSourcePeriod() ?? selectedPeriod())?.table_version} / Lv{" "}
                  {expRows()[0]?.lv}〜{expRows()[expRows().length - 1]?.lv} (
                  {expRows().length} 行)
                </p>
                <div class="w-full overflow-x-auto">
                  <div style="min-width: 400px; min-height: 320px;">
                    <canvas ref={setExpCanvas} width={800} height={320} />
                  </div>
                </div>
              </div>
            </div>
          </Show>

          {/* Bounds chart — shown when single-period has rows, OR all-periods
               mode has at least one period with data for the selected ship. */}
          <Show when={boundRows().length > 0 || (isAllPeriodsPeriod(selectedPeriod()) && boundsChartData().datasets.length > 0)}>
            <div class="card bg-base-100 shadow-sm">
              <div class="card-body">
                <h2 class="card-title text-lg">レベル別パラメータ推移</h2>
                <Show when={isAllPeriodsPeriod(selectedPeriod())}>
                  <p class="text-sm text-base-content/60">
                    艦: {selectedShip()?.name ?? "-"} /{" "}
                    {Math.round(boundsChartData().datasets.length / 3)} 期間分の履歴 (全 {allPeriodsEntries().length} 期間中)
                  </p>
                </Show>
                <Show when={!isAllPeriodsPeriod(selectedPeriod())}>
                  <p class="text-sm text-base-content/60">
                    艦: {selectedShip()?.name ?? "-"} (ID:{" "}
                    {boundRows()[0]?.master_id}) / Lv {boundRows()[0]?.lv}〜
                    {boundRows()[boundRows().length - 1]?.lv} (
                    {boundRows().length} 行)
                  </p>
                </Show>
                <div class="w-full overflow-x-auto">
                  <div style="min-width: 400px; min-height: 320px;">
                    <canvas ref={setBoundsCanvas} width={800} height={320} />
                  </div>
                </div>
              </div>
            </div>
          </Show>

          {/* Cumulative mode: archive data exists but selected ship absent */}
          <Show
            when={
              isCumulativePeriod(selectedPeriod()) &&
              allBoundRows().length > 0 &&
              boundRows().length === 0 &&
              !loadingData()
            }
          >
            <div class="card bg-base-100 shadow-sm">
              <div class="card-body items-center text-center py-16">
                <p class="text-base-content/50">
                  選択した艦のデータは累積アーカイブに存在しません。
                </p>
                <p class="text-base-content/40 text-sm mt-1">
                  現在の期間 (ライブ) では存在する可能性があります。期間を切り替えてご確認ください。
                </p>
              </div>
            </div>
          </Show>

          {/* All-periods mode: archive data exists but selected ship absent */}
          <Show
            when={
              isAllPeriodsPeriod(selectedPeriod()) &&
              allPeriodsEntries().length > 0 &&
              boundsChartData().datasets.length === 0 &&
              !loadingData()
            }
          >
            <div class="card bg-base-100 shadow-sm">
              <div class="card-body items-center text-center py-16">
                <p class="text-base-content/50">
                  選択した艦のデータは全期間のアーカイブに存在しません。
                </p>
                <p class="text-base-content/40 text-sm mt-1">
                  現在の期間 (ライブ) では存在する可能性があります。期間を切り替えてご確認ください。
                </p>
              </div>
            </div>
          </Show>

          {/* Empty state — only when truly no data loaded at all (not the
               same as "data loaded but selected ship absent", which is handled
               by the Bug M / all-periods no-data cards above). */}
          <Show
            when={
              expRows().length === 0 &&
              boundRows().length === 0 &&
              allBoundRows().length === 0 &&
              allPeriodsEntries().length === 0 &&
              !loadingData() &&
              !loadingPeriods() &&
              !loadingShips()
            }
          >
            <div class="card bg-base-100 shadow-sm">
              <div class="card-body items-center text-center py-16">
                <p class="text-base-content/50">
                  期間と艦を選択するとグラフを表示します。
                </p>
                <p class="text-base-content/40 text-sm mt-1">
                  経験値はmaster_idに依存せず、レベル別パラメータは選択中の艦で表示します。
                </p>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
