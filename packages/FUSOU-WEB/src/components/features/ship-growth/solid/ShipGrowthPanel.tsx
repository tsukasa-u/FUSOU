/** @jsxImportSource solid-js */
import { FusouPageHeader } from "@/components/common/solid/FusouPageHeader";
import { EmptyState } from "@/components/common/solid/EmptyState";
import { LoadingState } from "@/components/common/solid/LoadingState";
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
  type ChartOptions,
} from "chart.js";
import { cachedFetch } from "@/utils/fetchCache";
import { compareTableVersions } from "@/features/battles/helpers";
import {
  ENEMY_ID_THRESHOLD,
} from "@/features/simulator/constants";
import {
  ShipGrowthAllPeriodsResponseSchema,
  ShipGrowthBoundsResponseSchema,
  ShipGrowthExpResponseSchema,
  ShipGrowthSummaryResponseSchema,
  normalizeShipGrowthCaps,
  selectLatestShipGrowthPeriod,
  type ShipGrowthCaps,
  type BoundRow,
  type CapRow,
  type AllPeriodsEntry,
  type BoundsDataPoint,
  normalizeBoundRows,
  mergeBoundsByMax,
  mergeCapsByMax,
  buildBoundsChartData,
  buildAllPeriodsBoundsChartData,
  STAT_COLORS,
  normalizeCapRows,
  parsePositiveInt,
} from "@/features/simulator/ship-growth-utils";
import {
  MasterShipListResponseSchema,
} from "@/features/simulator/api-response-schemas";
import { buildShareGrowthUrl } from "@/utils/share-url";
import { copyToClipboard } from "@/utils/clipboard";
import { AlertMessage } from "@/components/common/solid/AlertMessage";
import { ShareUrlButton } from "@/components/common/solid/ShareUrlButton";
import {
  MasterDataLoadStatusAlert,
  type MasterDataLoadStatusItem,
} from "@/components/common/solid/MasterDataLoadStatusAlert";
import { ShipCatalogPicker } from "@/components/common/solid/ShipCatalogPicker";
import ShipGrowthSearchFilterBar from "./ShipGrowthSearchFilterBar";
import ShipGrowthFilterModal, { SHIP_TYPE_GROUPS } from "./ShipGrowthFilterModal";
import { ActiveFilterChips, type FilterChipItem } from "@/components/common/solid/ActiveFilterChips";

Chart.register(...registerables);


type PeriodSource = "live" | "latest" | "cumulative" | "all";

export type PeriodSummary = {
  period_tag: string;
  table_version: string;
  source?: PeriodSource;
};

const LATEST_PERIOD_TAG = "latest";
const LATEST_TABLE_VERSION = "__latest__";

const CUMULATIVE_PERIOD_TAG = "all";
const CUMULATIVE_TABLE_VERSION = "__archive__";

const ALL_PERIODS_PERIOD_TAG = "__all-periods__";
const ALL_PERIODS_TABLE_VERSION = "__all__";

function isLatestPeriod(p: PeriodSummary | null | undefined): boolean {
  return (
    !!p &&
    p.period_tag === LATEST_PERIOD_TAG &&
    p.table_version === LATEST_TABLE_VERSION
  );
}

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

export function periodLabel(p: PeriodSummary): string {
  if (isLatestPeriod(p)) return "最新期間";
  if (isCumulativePeriod(p)) return "全期間";
  if (isAllPeriodsPeriod(p)) return "全期間比較";
  return `${p.period_tag} (v${p.table_version})`;
}

type ExpRow = {
  lv: number;
  exp_current: number;
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



// Stat colors used across all periods in the all-periods chart.
// Same hue for every period — recency is communicated by opacity + line weight:
//   newest period → full opacity + thicker line (vivid)
//   older periods → progressively more transparent + thinner
// Hover highlights use saturated border + larger point hit radius.
const CHART_OPTIONS_EXP = {
  responsive: true,
  maintainAspectRatio: false,
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

const CHART_OPTIONS_BOUNDS: ChartOptions<"line"> = {
  responsive: true,
  maintainAspectRatio: false,
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
const CHART_OPTIONS_BOUNDS_ALL_PERIODS: ChartOptions<"line"> = {
  responsive: true,
  maintainAspectRatio: false,
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
const CHART_OPTIONS_BOUNDS_CUMULATIVE: ChartOptions<"line"> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: {
    legend: { display: true, position: "top" as const },
    tooltip: {
      mode: "index" as const,
      intersect: false,
      callbacks: {
        afterLabel: (item): string | string[] => {
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
  const [headerSearchQuery, setHeaderSearchQuery] = createSignal("");
  const [selectedStypes, setSelectedStypes] = createSignal<number[]>([]);
  let growthFilterModalRef!: HTMLDialogElement;
  const [periods, setPeriods] = createSignal<PeriodSummary[]>([]);
  const [selectedPeriodIdx, setSelectedPeriodIdx] = createSignal(0);
  const [shipMasterRows, setShipMasterRows] = createSignal<ShipMasterRow[]>([]);

  const selectedPeriod = createMemo(
    () => periods()[selectedPeriodIdx()] ?? null,
  );

  const defaultPeriodIndex = () => {
    const p = periods();
    const latestIdx = p.findIndex((row) => isLatestPeriod(row));
    return latestIdx >= 0 ? latestIdx : 0;
  };

  const activeFilterItems = createMemo<FilterChipItem[]>(() => {
    const items: FilterChipItem[] = [];
    const q = headerSearchQuery().trim();
    if (q) {
      items.push({
        key: "search",
        label: "検索",
        value: q,
        onRemove: () => setHeaderSearchQuery(""),
      });
    }

    const p = selectedPeriod();
    if (p && (selectedPeriodIdx() !== defaultPeriodIndex() || !isLatestPeriod(p))) {
      items.push({
        key: "period",
        label: "期間",
        value: periodLabel(p),
        onRemove: () => {
          setSelectedPeriodIdx(defaultPeriodIndex());
        },
      });
    }

    const stypes = selectedStypes();
    if (stypes.length > 0) {
      const groupNames = SHIP_TYPE_GROUPS
        .filter((g) => g.stypes.some((st) => stypes.includes(st)))
        .map((g) => g.name);
      items.push({
        key: "stype",
        label: "艦種",
        value: groupNames.join(", "),
        onRemove: () => setSelectedStypes([]),
      });
    }

    return items;
  });

  const filteredShipMasterRows = createMemo(() => {
    const q = headerSearchQuery().trim().toLowerCase();
    const stypes = selectedStypes();
    return shipMasterRows().filter((ship) => {
      if (q) {
        const matchesName = ship.name.toLowerCase().includes(q);
        const matchesId = String(ship.id).includes(q);
        if (!matchesName && !matchesId) return false;
      }
      if (stypes.length > 0) {
        if (ship.stype == null || !stypes.includes(ship.stype)) {
          return false;
        }
      }
      return true;
    });
  });
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
  const [masterDataStatus, setMasterDataStatus] = createSignal<
    MasterDataLoadStatusItem[]
  >([
    { name: "mst_ship", status: "pending" },
  ]);
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

  const selectedShip = createMemo(() => {
    const id = selectedMasterId();
    if (id == null) return null;
    return shipMasterRows().find((ship) => ship.id === id) ?? null;
  });

  const hasBoundsData = createMemo(() => {
    if (isAllPeriodsPeriod(selectedPeriod())) {
      return boundsChartData().datasets.length > 0;
    }
    return boundRows().length > 0;
  });



  async function fetchSummary() {
    setLoadingPeriods(true);
    setError(null);
    try {
      const res = await cachedFetch("/api/ship-growth/summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = ShipGrowthSummaryResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("Unexpected response");
      const json = parsed.data;
      if (!json.ok || !Array.isArray(json.periods))
        throw new Error("Unexpected response");
      const base: PeriodSummary[] = json.periods.map((p) => ({
        period_tag: p.period_tag,
        table_version: p.table_version,
        source: "live",
      }));
      const merged: PeriodSummary[] = [];

      if (base.length > 0) {
        merged.push({
          period_tag: LATEST_PERIOD_TAG,
          table_version: LATEST_TABLE_VERSION,
          source: "latest",
        });
      }

      merged.push({
        period_tag: CUMULATIVE_PERIOD_TAG,
        table_version: CUMULATIVE_TABLE_VERSION,
        source: "cumulative",
      });

      merged.push(...base);

      if (json.cumulative_available || base.length > 1) {
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
    setMasterDataStatus([
      { name: "mst_ship", status: "pending" },
    ]);
    try {
      const res = await cachedFetch(
        "/api/master-data/json?table_name=mst_ship",
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = MasterShipListResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("Unexpected response");
      const json = parsed.data;
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
      setMasterDataStatus([
        {
          name: "mst_ship",
          status: "success",
          detail: `${rows.length}件${json.period_tag ? ` / ${json.period_tag} rev${json.period_revision ?? "?"}` : ""}`,
        },
      ]);
    } catch (e) {
      setMasterDataStatus([
        {
          name: "mst_ship",
          status: "failed",
          detail: e instanceof Error ? e.message : String(e),
        },
      ]);
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

  async function fetchGrowthData(forceReload = false) {
    const period = selectedPeriod();
    if (!period) return;

    // Increment version so any in-flight call that was started for a previous
    // period can detect it is stale and discard its results.
    const currentVersion = ++fetchGrowthDataVersion;
    const isCurrentFetch = () => fetchGrowthDataVersion === currentVersion;
    const fetchData = (url: string) =>
      cachedFetch(url, forceReload ? { cache: "reload" } : undefined);

    setLoadingData(true);
    setError(null);
    try {
      const latest = isLatestPeriod(period);
      const cumulative = isCumulativePeriod(period);
      const allPeriods = isAllPeriodsPeriod(period);
      const firstLivePeriod = selectLatestShipGrowthPeriod(
        periods().filter((p) => p.source === "live"),
      );
      const resolvedLivePeriod = latest ? firstLivePeriod : period;

      if (latest && !resolvedLivePeriod) {
        throw new Error("最新期間の実データが見つかりません。");
      }

      // Exp curve: not stored in archives. For cumulative/all-periods
      // selection fall back to whatever live period exists (best-effort) so
      // the chart still shows a reference exp curve. If no live period exists,
      // skip.
      let expPeriod: PeriodSummary | null = resolvedLivePeriod;
      if (cumulative || allPeriods) {
        expPeriod = firstLivePeriod;
      }
      if (expPeriod) {
        const expUrl = `/api/ship-growth/exp?period_tag=${encodeURIComponent(expPeriod.period_tag)}&table_version=${encodeURIComponent(expPeriod.table_version)}`;
        const expRes = await fetchData(expUrl);
        if (!expRes.ok) throw new Error(`exp HTTP ${expRes.status}`);
        const parsedExp = ShipGrowthExpResponseSchema.safeParse(
          await expRes.json(),
        );
        if (!parsedExp.success || !parsedExp.data.ok)
          throw new Error("Unexpected exp response");
        const expJson = parsedExp.data;
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
        const livePeriodForBounds = firstLivePeriod;
        const [apRes, liveRes] = await Promise.all([
          fetchData("/api/ship-growth/all-periods"),
          livePeriodForBounds
            ? fetchData(
                `/api/ship-growth/bounds?period_tag=${encodeURIComponent(livePeriodForBounds.period_tag)}&table_version=${encodeURIComponent(livePeriodForBounds.table_version)}`,
              )
            : Promise.resolve(null),
        ]);
        if (!apRes.ok) throw new Error(`all-periods HTTP ${apRes.status}`);
        const parsedAllPeriods = ShipGrowthAllPeriodsResponseSchema.safeParse(
          await apRes.json(),
        );
        if (!parsedAllPeriods.success || !parsedAllPeriods.data.ok)
          throw new Error("Unexpected all-periods response");
        const apJson = parsedAllPeriods.data;
        const archivedEntries: AllPeriodsEntry[] = (apJson.entries ?? []).map(
          (e) => ({
            period_tag: e.period_tag,
            table_version: e.table_version,
            bounds: normalizeBoundRows(e.bounds),
            caps: normalizeCapRows(e.caps),
          }),
        );

        const combined = new Map(archivedEntries.map((entry) => [
          `${entry.period_tag}/${entry.table_version}`, entry,
        ]));
        if (liveRes && !liveRes.ok) throw new Error(`bounds HTTP ${liveRes.status}`);
        if (liveRes) {
          const parsedLive = ShipGrowthBoundsResponseSchema.safeParse(
            await liveRes.json(),
          );
          if (!parsedLive.success || !parsedLive.data.ok)
            throw new Error("Unexpected bounds response");
          const liveJson = parsedLive.data;
          // Use the pre-computed livePeriodForBounds (same reference, no
          // re-read of periods() after the await point).
          if (liveJson.ok && livePeriodForBounds) {
            combined.set(`${livePeriodForBounds.period_tag}/${livePeriodForBounds.table_version}`, {
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
          setAllPeriodsEntries([...combined.values()].sort((a, b) =>
            a.period_tag.localeCompare(b.period_tag) || compareTableVersions(a.table_version, b.table_version)));
          // Clear single-period signals so stale data doesn't show.
          setAllBoundRows([]);
          setAllCapRows([]);
          setBoundRows([]);
          setSelectedCap(null);
        });
        return;
      }

      if (cumulative) {
        const [cumulativeRes, liveRes] = await Promise.all([
          fetchData("/api/ship-growth/cumulative"),
          firstLivePeriod
            ? fetchData(
                `/api/ship-growth/bounds?period_tag=${encodeURIComponent(firstLivePeriod.period_tag)}&table_version=${encodeURIComponent(firstLivePeriod.table_version)}`,
              )
            : Promise.resolve(null),
        ]);
        if (!cumulativeRes.ok) {
          throw new Error(`cumulative HTTP ${cumulativeRes.status}`);
        }

        const parsedCumulative = ShipGrowthBoundsResponseSchema.safeParse(
          await cumulativeRes.json(),
        );
        if (!parsedCumulative.success || !parsedCumulative.data.ok)
          throw new Error("Unexpected cumulative response");
        const cumulativeJson = parsedCumulative.data;
        let mergedBounds = normalizeBoundRows(cumulativeJson.bounds);
        let mergedCaps = normalizeCapRows(cumulativeJson.caps);

        if (liveRes && !liveRes.ok) throw new Error(`bounds HTTP ${liveRes.status}`);
        if (liveRes && firstLivePeriod) {
          const parsedLive = ShipGrowthBoundsResponseSchema.safeParse(
            await liveRes.json(),
          );
          if (!parsedLive.success || !parsedLive.data.ok)
            throw new Error("Unexpected bounds response");
          const liveJson = parsedLive.data;
          const liveBounds = normalizeBoundRows(liveJson.bounds);
          const liveCaps = normalizeCapRows(liveJson.caps);
          const liveSourcePeriod = `${firstLivePeriod.period_tag}/${firstLivePeriod.table_version}`;
          mergedBounds = mergeBoundsByMax(
            mergedBounds,
            liveBounds,
            liveSourcePeriod,
          );
          mergedCaps = mergeCapsByMax(mergedCaps, liveCaps);
        }

        if (!isCurrentFetch()) return;
        batch(() => {
          setAllBoundRows(mergedBounds);
          setAllCapRows(mergedCaps);
          setAllPeriodsEntries([]);
        });
        applySelectedShipBounds(selectedMasterId());
        return;
      }

      // Bounds/caps: route to /cumulative for cumulative selection,
      // /bounds for live periods.
      if (!resolvedLivePeriod) {
        throw new Error("期間データの解決に失敗しました。");
      }
      const boundsUrl = `/api/ship-growth/bounds?period_tag=${encodeURIComponent(resolvedLivePeriod.period_tag)}&table_version=${encodeURIComponent(resolvedLivePeriod.table_version)}`;
      const boundsRes = await fetchData(boundsUrl);
      if (!boundsRes.ok) throw new Error(`bounds HTTP ${boundsRes.status}`);
      const parsedBounds = ShipGrowthBoundsResponseSchema.safeParse(
        await boundsRes.json(),
      );
      if (!parsedBounds.success || !parsedBounds.data.ok)
        throw new Error("Unexpected bounds response");
      const boundsJson = parsedBounds.data;
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
        batch(() => {
          setExpRows([]);
          setExpSourcePeriod(null);
          setAllBoundRows([]);
          setAllCapRows([]);
          setAllPeriodsEntries([]);
          setBoundRows([]);
          setSelectedCap(null);
        });
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
        (periodTag === LATEST_PERIOD_TAG ||
          periodTag === CUMULATIVE_PERIOD_TAG ||
          !tableVersion ||
          p.table_version === tableVersion),
    );
    if (exact >= 0) {
      setSelectedPeriodIdx(exact);
    } else {
      const periodOnly = rows.findIndex((p) => p.period_tag === periodTag);
      if (periodOnly >= 0) setSelectedPeriodIdx(periodOnly);
    }

    setInitialPeriodTag(null);
    setInitialTableVersion(null);
  });

  createEffect(() => {
    const rows = shipMasterRows();
    if (rows.length === 0) return;
    const firstRow = rows[0];
    if (!firstRow) return;
    const initialId = initialMasterId();
    if (initialId != null) {
      if (rows.some((ship) => ship.id === initialId)) {
        setSelectedMasterId(initialId);
      } else if (selectedMasterId() == null) {
        setSelectedMasterId(firstRow.id);
      }
      setInitialMasterId(null);
      return;
    }

    if (selectedMasterId() == null) {
      setSelectedMasterId(firstRow.id);
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
    if (isAllPeriodsPeriod(period)) {
      url.searchParams.set("all_periods", "1");
      url.searchParams.delete("cumulative");
      url.searchParams.delete("period_tag");
      url.searchParams.delete("table_version");
    } else if (isCumulativePeriod(period)) {
      url.searchParams.delete("cumulative");
      url.searchParams.delete("all_periods");
      url.searchParams.set("period_tag", CUMULATIVE_PERIOD_TAG);
      url.searchParams.delete("table_version");
    } else if (isLatestPeriod(period)) {
      url.searchParams.delete("cumulative");
      url.searchParams.delete("all_periods");
      url.searchParams.set("period_tag", LATEST_PERIOD_TAG);
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
    const sharePeriod = isLatestPeriod(period)
      ? selectLatestShipGrowthPeriod(periods().filter((p) => p.source === "live"))
      : period;
    if (!sharePeriod) return null;
    // Cumulative and all-periods are synthetic local-only selections; share
    // URLs must point to a real period.
    if (isCumulativePeriod(sharePeriod)) return null;
    if (isAllPeriodsPeriod(sharePeriod)) return null;
    if (isLatestPeriod(sharePeriod)) return null;

    return buildShareGrowthUrl(window.location.origin, {
      periodTag: sharePeriod.period_tag,
      tableVersion: sharePeriod.table_version,
      masterId,
    });
  }

  async function issueShareUrl(): Promise<boolean> {
    const shareUrl = buildCurrentShareUrl();
    if (!shareUrl) {
      return false;
    }

    const copied = await copyToClipboard(shareUrl);
    if (copied) {
      return true;
    }

    window.prompt(
      "自動コピーに失敗しました。以下を手動でコピーしてください:",
      shareUrl,
    );
    return false;
  }

  const expChartData = createMemo(() => buildExpChartData(expRows()));

  // Bounds chart data: single-period or all-periods view.
  const allPeriodsMatchedCount = createMemo(() => {
    const mid = selectedMasterId();
    if (mid == null) return 0;
    return allPeriodsEntries().filter((e) =>
      e.bounds.some(
        (r) =>
          r.master_id === mid &&
          (r.kaihi_naked > 0 ||
            r.taisen_naked > 0 ||
            r.sakuteki_naked > 0 ||
            r.lucky_naked > 0),
      ),
    ).length;
  });

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
    const hasData =
      chartData.datasets.length > 0 &&
      chartData.datasets.some((ds) => ds.data.length > 0);
    if (!canvas || !hasData) {
      boundsChart?.destroy();
      boundsChart = null;
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    boundsChart?.destroy();
    boundsChart = new Chart<"line", BoundsDataPoint[]>(ctx, {
      type: "line",
      data: chartData,
      options: boundsChartOptions(),
    });
  });

  onCleanup(() => {
    ++fetchGrowthDataVersion;
    expChart?.destroy();
    boundsChart?.destroy();
  });

  return (
    <div class="space-y-6">
      <FusouPageHeader
        class="pb-0 mb-2 border-none"
        title="パラメータ推移"
        subtitle="収集された経験値テーブルと naked パラメータ成長の可視化"
        actions={<>
          <div class="form-control">
            <select
              class="select select-bordered select-sm min-w-40"
              value={selectedPeriodIdx().toString()}
              onChange={(e) =>
                setSelectedPeriodIdx(parseInt(e.currentTarget.value, 10))
              }
              disabled={loadingPeriods() || loadingData()}
            >
              <Show when={loadingPeriods()}>
                <option value={selectedPeriodIdx().toString()}>読込中...</option>
              </Show>
              <For each={periods()}>
                {(p, i) => <option value={i().toString()}>{periodLabel(p)}</option>}
              </For>
            </select>
          </div>

          <button
            class="fusou-btn-secondary gap-1.5"
            disabled={
              loadingData() ||
              loadingPeriods() ||
              loadingShips() ||
              periods().length === 0 ||
              selectedMasterId() == null
            }
            onClick={() => fetchGrowthData(true)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span class="hidden md:inline">
              <Show when={loadingData()} fallback="更新">
                読込中
              </Show>
            </span>
          </button>

          <ShareUrlButton
            id="ship-growth-share-btn"
            class="fusou-btn-secondary"
            disabled={
              loadingPeriods() ||
              loadingShips() ||
              !selectedPeriod() ||
              isCumulativePeriod(selectedPeriod()) ||
              isAllPeriodsPeriod(selectedPeriod())
            }
            onShare={() => issueShareUrl()}
          />
        </>}
      />

      <Show when={error()}>
        <AlertMessage type="error" class="mb-4">
          {error()!}
        </AlertMessage>
      </Show>

      <MasterDataLoadStatusAlert items={masterDataStatus()} errorsOnly={true} class="mb-6" />

      <div class="fusou-tab-toolbar">
        <div class="flex items-center gap-2 py-1">
          <span class="text-sm font-semibold text-base-content/80">艦別パラメータ分析</span>
          <Show when={selectedShip()}>
            {(ship) => (
              <span class="badge badge-sm badge-outline text-xs">
                {ship().name}
              </span>
            )}
          </Show>
        </div>

        <ShipGrowthSearchFilterBar
          searchQuery={headerSearchQuery}
          onSearchChange={setHeaderSearchQuery}
          activeFilterCount={activeFilterItems().length}
          onOpenFilterModal={() => growthFilterModalRef?.showModal()}
          ships={shipMasterRows}
          onSelectShip={(id) => selectShip(id)}
        />
      </div>

      <Show when={activeFilterItems().length > 0}>
        <div class="-mt-3 mb-4 px-0.5">
          <ActiveFilterChips
            items={activeFilterItems()}
            onClearAll={() => {
              setHeaderSearchQuery("");
              setSelectedStypes([]);
              if (selectedPeriodIdx() !== defaultPeriodIndex()) {
                setSelectedPeriodIdx(defaultPeriodIndex());
              }
            }}
          />
        </div>
      </Show>

      {/* Ship picker + charts */}
      <ShipCatalogPicker
        idPrefix="ship-growth"
        ships={filteredShipMasterRows()}
        selectedShipId={selectedMasterId()}
        onSelectShip={(id) => selectShip(id)}
        loading={loadingShips()}
      >
        <div class="space-y-4">
          {/* Loading state for main content */}
          <Show when={loadingData() || ((loadingPeriods() || loadingShips()) && expRows().length === 0)}>
            <div class="fusou-card">
              <div class="fusou-card-body">
                <LoadingState message="パラメータ推移データを集計中..." size="lg" minHeight="min-h-[360px]" />
              </div>
            </div>
          </Show>

          <Show when={!loadingData()}>
            {/* Exp chart */}
            <Show when={expRows().length > 0}>
              <div class="fusou-card">
                <div class="fusou-card-body">
                  <h2 class="card-title text-lg">経験値テーブル (累積)</h2>
                  <p class="text-sm text-base-content/60">
                    期間: {(expSourcePeriod() ?? selectedPeriod())?.period_tag} /
                    v{(expSourcePeriod() ?? selectedPeriod())?.table_version} / Lv{" "}
                    {expRows()[0]?.lv}〜{expRows()[expRows().length - 1]?.lv} (
                    {expRows().length} 行)
                  </p>
                  <div class="relative w-full h-[320px] sm:h-[380px] lg:h-[420px]">
                    <canvas ref={setExpCanvas} class="w-full h-full block" />
                  </div>
                </div>
              </div>
            </Show>

            {/* Bounds chart & Empty/Error state */}
            <Show when={selectedMasterId() != null}>
              <div class="fusou-card">
                <div class="fusou-card-body">
                  <div class="flex items-center justify-between pb-2 border-b border-base-200/60">
                    <h2 class="card-title text-lg">レベル別パラメータ推移</h2>
                    <Show when={selectedShip()}>
                      {(ship) => (
                        <span class="text-sm font-medium text-base-content/70">
                          {ship().name} (ID: {ship().id})
                        </span>
                      )}
                    </Show>
                  </div>

                  <Show
                    when={hasBoundsData()}
                    fallback={
                      <div class="py-12 flex flex-col items-center justify-center">
                        <EmptyState
                          message={
                            error()
                              ? "データの読み込みに失敗しました"
                              : "選択した艦のパラメータデータがありません。"
                          }
                          hint={
                            error()
                              ? error()!
                              : isCumulativePeriod(selectedPeriod())
                                ? "現在の期間 (ライブ) では存在する可能性があります。期間を切り替えてご確認ください。"
                                : isAllPeriodsPeriod(selectedPeriod())
                                  ? "全期間のアーカイブにこの艦の記録が存在しません。別の艦または期間をお試しください。"
                                  : "この期間には該当する艦のパラメータ成長データが記録されていません。別の期間や全期間比較をお試しください。"
                          }
                          size="large"
                        />
                      </div>
                    }
                  >
                    <Show when={isAllPeriodsPeriod(selectedPeriod())}>
                      <p class="text-sm text-base-content/60">
                        {allPeriodsMatchedCount()}{" "}
                        期間分の履歴 (全 {allPeriodsEntries().length} 期間中)
                      </p>
                    </Show>
                    <Show when={!isAllPeriodsPeriod(selectedPeriod())}>
                      <p class="text-sm text-base-content/60">
                        Lv {boundRows()[0]?.lv}〜
                        {boundRows()[boundRows().length - 1]?.lv} (
                        {boundRows().length} 行)
                      </p>
                    </Show>
                    <div class="relative w-full h-[360px] sm:h-[420px] lg:h-[480px]">
                      <canvas ref={setBoundsCanvas} class="w-full h-full block" />
                    </div>
                    <Show when={!isAllPeriodsPeriod(selectedPeriod()) && boundRows().length > 0}>
                      <div class="mt-4">
                        <div class="flex items-center justify-between mb-2">
                          <h4 class="text-sm font-semibold text-base-content/80">
                            レベル別パラメータ一覧 (naked)
                          </h4>
                          <span class="text-xs text-base-content/50">
                            全 {boundRows().length} レベル
                          </span>
                        </div>
                        <div class="overflow-x-auto max-h-72 overflow-y-auto border border-base-300 rounded-lg">
                          <table class="table table-xs sm:table-sm table-pin-rows table-zebra w-full text-center">
                            <thead>
                              <tr class="bg-base-200 text-base-content">
                                <th>Lv</th>
                                <th class="text-green-600 dark:text-green-400">回避</th>
                                <th class="text-orange-600 dark:text-orange-400">対潜</th>
                                <th class="text-purple-600 dark:text-purple-400">索敵</th>
                                <th class="text-amber-600 dark:text-amber-400">運</th>
                              </tr>
                            </thead>
                            <tbody>
                              <For each={boundRows()}>
                                {(row) => (
                                  <tr>
                                    <td class="font-mono font-medium">{row.lv}</td>
                                    <td class="font-mono">{row.kaihi_naked > 0 ? row.kaihi_naked : "-"}</td>
                                    <td class="font-mono">{row.taisen_naked > 0 ? row.taisen_naked : "-"}</td>
                                    <td class="font-mono">{row.sakuteki_naked > 0 ? row.sakuteki_naked : "-"}</td>
                                    <td class="font-mono">{row.lucky_naked > 0 ? row.lucky_naked : "-"}</td>
                                  </tr>
                                )}
                              </For>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </Show>
                  </Show>
                </div>
              </div>
            </Show>

            {/* Empty state — only when truly no ship selected */}
            <Show
              when={
                selectedMasterId() == null &&
                !loadingPeriods() &&
                !loadingShips()
              }
            >
              <div class="fusou-card min-h-[400px] xl:min-h-[calc(100vh-14rem)] flex items-center justify-center">
                <div class="fusou-card-body w-full flex items-center justify-center">
                  <EmptyState
                    message="期間と艦を選択するとグラフを表示します。"
                    hint="経験値はmaster_idに依存せず、レベル別パラメータは選択中の艦で表示します。"
                    size="large"
                  />
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </ShipCatalogPicker>
      <ShipGrowthFilterModal
        ref={(el) => {
          growthFilterModalRef = el;
        }}
        periods={periods}
        selectedPeriodIndex={selectedPeriodIdx}
        loadingPeriods={loadingPeriods}
        onPeriodChange={(idx) => setSelectedPeriodIdx(idx)}
        selectedStypes={selectedStypes}
        onStypesChange={setSelectedStypes}
        onReset={() => {
          setSelectedStypes([]);
          if (selectedPeriodIdx() !== defaultPeriodIndex()) {
            setSelectedPeriodIdx(defaultPeriodIndex());
          }
        }}
      />
    </div>
  );
}
