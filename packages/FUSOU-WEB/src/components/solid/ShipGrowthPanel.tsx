/** @jsxImportSource solid-js */
import {
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

type PeriodSummary = {
  period_tag: string;
  table_version: string;
};

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

function buildBoundsChartData(
  boundRows: BoundRow[],
  cap: CapRow | null,
): ChartData<"line", { x: number; y: number }[]> {
  const minLv = boundRows[0]?.lv ?? 1;
  const maxLv = boundRows[boundRows.length - 1]?.lv ?? 180;

  const datasets: ChartDataset<"line", { x: number; y: number }[]>[] = [
    {
      label: "回避(naked)",
      data: boundRows.map((r) => ({ x: r.lv, y: r.kaihi_naked })),
      borderColor: "rgb(34, 197, 94)",
      backgroundColor: "transparent",
      tension: 0,
      pointRadius: 2,
    },
    {
      label: "対潜(naked)",
      data: boundRows.map((r) => ({ x: r.lv, y: r.taisen_naked })),
      borderColor: "rgb(249, 115, 22)",
      backgroundColor: "transparent",
      tension: 0,
      pointRadius: 2,
    },
    {
      label: "索敵(naked)",
      data: boundRows.map((r) => ({ x: r.lv, y: r.sakuteki_naked })),
      borderColor: "rgb(168, 85, 247)",
      backgroundColor: "transparent",
      tension: 0,
      pointRadius: 2,
    },
  ];

  if (cap) {
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

  return {
    datasets,
  };
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
      };
      if (!json.ok || !Array.isArray(json.periods))
        throw new Error("Unexpected response");
      setPeriods(json.periods);
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

  async function fetchGrowthData() {
    const period = selectedPeriod();
    if (!period) return;

    setLoadingData(true);
    setError(null);
    try {
      // Always fetch exp curve (no master_id required)
      const expUrl = `/api/ship-growth/exp?period_tag=${encodeURIComponent(period.period_tag)}&table_version=${encodeURIComponent(period.table_version)}`;
      const expRes = await cachedFetch(expUrl);
      if (!expRes.ok) throw new Error(`exp HTTP ${expRes.status}`);
      const expJson = (await expRes.json()) as { ok: boolean; exp: ExpRow[] };
      setExpRows(expJson.exp ?? []);

      // Always fetch full bounds once per period and reuse locally for ship switches.
      const boundsUrl = `/api/ship-growth/bounds?period_tag=${encodeURIComponent(period.period_tag)}&table_version=${encodeURIComponent(period.table_version)}`;
      const boundsRes = await cachedFetch(boundsUrl);
      if (!boundsRes.ok) throw new Error(`bounds HTTP ${boundsRes.status}`);
      const boundsJson = (await boundsRes.json()) as {
        ok: boolean;
        bounds: BoundRow[];
        caps?: CapRow[];
      };
      setAllBoundRows(normalizeBoundRows(boundsJson.bounds));
      setAllCapRows(normalizeCapRows(boundsJson.caps));
      applySelectedShipBounds(selectedMasterId());
    } catch (e) {
      setError(
        `成長データの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setLoadingData(false);
    }
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    setInitialPeriodTag(params.get("period_tag"));
    setInitialTableVersion(params.get("table_version"));
    setInitialMasterId(parsePositiveInt(params.get("master_id")));

    fetchSummary();
    fetchShipMasters();
  });

  createEffect(() => {
    const rows = periods();
    if (rows.length === 0) return;

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
    url.searchParams.set("period_tag", period.period_tag);
    url.searchParams.set("table_version", period.table_version);

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
  const boundsChartData = createMemo(() =>
    buildBoundsChartData(boundRows(), selectedCap()),
  );

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
    const rows = boundRows();
    if (!canvas || rows.length === 0) {
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
      data: boundsChartData() as any,
      options: CHART_OPTIONS_BOUNDS,
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
                    {(p, i) => (
                      <option value={i()}>
                        {p.period_tag} (v{p.table_version})
                      </option>
                    )}
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
              disabled={loadingPeriods() || loadingShips() || !selectedPeriod()}
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
                  期間: {selectedPeriod()?.period_tag} / v
                  {selectedPeriod()?.table_version} / Lv {expRows()[0]?.lv}〜
                  {expRows()[expRows().length - 1]?.lv} ({expRows().length} 行)
                </p>
                <div class="w-full overflow-x-auto">
                  <div style="min-width: 400px; min-height: 320px;">
                    <canvas ref={setExpCanvas} width={800} height={320} />
                  </div>
                </div>
              </div>
            </div>
          </Show>

          {/* Bounds chart */}
          <Show when={boundRows().length > 0}>
            <div class="card bg-base-100 shadow-sm">
              <div class="card-body">
                <h2 class="card-title text-lg">レベル別パラメータ推移</h2>
                <p class="text-sm text-base-content/60">
                  艦: {selectedShip()?.name ?? "-"} (ID:{" "}
                  {boundRows()[0]?.master_id}) / Lv {boundRows()[0]?.lv}〜
                  {boundRows()[boundRows().length - 1]?.lv} (
                  {boundRows().length} 行)
                </p>
                <div class="w-full overflow-x-auto">
                  <div style="min-width: 400px; min-height: 320px;">
                    <canvas ref={setBoundsCanvas} width={800} height={320} />
                  </div>
                </div>
              </div>
            </div>
          </Show>

          {/* Empty state */}
          <Show
            when={expRows().length === 0 && !loadingData() && !loadingPeriods()}
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
