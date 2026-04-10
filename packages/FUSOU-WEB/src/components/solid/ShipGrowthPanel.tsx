/** @jsxImportSource solid-js */
import {
  For,
  Show,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";
import { Chart, registerables } from "chart.js";
import { Line } from "solid-chartjs";
import { cachedFetch } from "@/utility/fetchCache";

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

// ── Helpers ────────────────────────────────────────────────────────

function buildExpChartData(expRows: ExpRow[]) {
  return {
    labels: expRows.map((r) => `Lv ${r.lv}`),
    datasets: [
      {
        label: "累積経験値",
        data: expRows.map((r) => r.exp_current),
        borderColor: "rgb(99, 102, 241)",
        backgroundColor: "rgba(99, 102, 241, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      },
    ],
  };
}

function buildBoundsChartData(boundRows: BoundRow[]) {
  return {
    labels: boundRows.map((r) => `Lv ${r.lv}`),
    datasets: [
      {
        label: "回避(naked)",
        data: boundRows.map((r) => r.kaihi_naked),
        borderColor: "rgb(34, 197, 94)",
        backgroundColor: "transparent",
        tension: 0.2,
        pointRadius: 2,
      },
      {
        label: "対潜(naked)",
        data: boundRows.map((r) => r.taisen_naked),
        borderColor: "rgb(249, 115, 22)",
        backgroundColor: "transparent",
        tension: 0.2,
        pointRadius: 2,
      },
      {
        label: "索敵(naked)",
        data: boundRows.map((r) => r.sakuteki_naked),
        borderColor: "rgb(168, 85, 247)",
        backgroundColor: "transparent",
        tension: 0.2,
        pointRadius: 2,
      },
    ],
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
    x: { ticks: { maxTicksLimit: 20 } },
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
    x: { ticks: { maxTicksLimit: 20 } },
    y: { title: { display: true, text: "ステータス値" } },
  },
} as const;

// ── Component ──────────────────────────────────────────────────────

export default function ShipGrowthPanel() {
  const [periods, setPeriods] = createSignal<PeriodSummary[]>([]);
  const [selectedPeriodIdx, setSelectedPeriodIdx] = createSignal(0);
  const [masterIdInput, setMasterIdInput] = createSignal("");
  const [expRows, setExpRows] = createSignal<ExpRow[]>([]);
  const [boundRows, setBoundRows] = createSignal<BoundRow[]>([]);
  const [capRow, setCapRow] = createSignal<CapRow | null>(null);
  const [loadingPeriods, setLoadingPeriods] = createSignal(true);
  const [loadingData, setLoadingData] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const selectedPeriod = createMemo(() => periods()[selectedPeriodIdx()] ?? null);

  async function fetchSummary() {
    setLoadingPeriods(true);
    setError(null);
    try {
      const res = await cachedFetch("/api/ship-growth/summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { ok: boolean; periods: PeriodSummary[] };
      if (!json.ok || !Array.isArray(json.periods)) throw new Error("Unexpected response");
      setPeriods(json.periods);
    } catch (e) {
      setError(`期間データの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingPeriods(false);
    }
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
      const expJson = await expRes.json() as { ok: boolean; exp: ExpRow[] };
      setExpRows(expJson.exp ?? []);

      // Fetch bounds for a specific ship if master_id is given
      const masterId = parseInt(masterIdInput().trim(), 10);
      if (Number.isFinite(masterId) && masterId > 0) {
        const boundsUrl = `/api/ship-growth/bounds?period_tag=${encodeURIComponent(period.period_tag)}&table_version=${encodeURIComponent(period.table_version)}&master_id=${masterId}`;
        const boundsRes = await cachedFetch(boundsUrl);
        if (!boundsRes.ok) throw new Error(`bounds HTTP ${boundsRes.status}`);
        const boundsJson = await boundsRes.json() as {
          ok: boolean;
          bounds: BoundRow[];
          caps: CapRow[];
        };
        setBoundRows(boundsJson.bounds ?? []);
        setCapRow((boundsJson.caps ?? [])[0] ?? null);
      } else {
        setBoundRows([]);
        setCapRow(null);
      }
    } catch (e) {
      setError(`成長データの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingData(false);
    }
  }

  onMount(() => {
    fetchSummary();
  });

  const expChartData = createMemo(() => buildExpChartData(expRows()));
  const boundsChartData = createMemo(() => buildBoundsChartData(boundRows()));

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
                  onChange={(e) => setSelectedPeriodIdx(parseInt(e.currentTarget.value, 10))}
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

            {/* Master ID input */}
            <div class="form-control">
              <label class="label">
                <span class="label-text">艦娘ID (master_id)</span>
              </label>
              <input
                type="number"
                class="input input-bordered input-sm w-36"
                placeholder="例: 573"
                value={masterIdInput()}
                onInput={(e) => setMasterIdInput(e.currentTarget.value)}
                min="1"
              />
            </div>

            <button
              class="btn btn-primary btn-sm"
              disabled={loadingData() || loadingPeriods() || periods().length === 0}
              onClick={fetchGrowthData}
            >
              <Show when={loadingData()}>
                <span class="loading loading-spinner loading-xs" />
              </Show>
              表示
            </button>
          </div>

          <Show when={error()}>
            <div class="alert alert-error mt-2">
              <span>{error()}</span>
            </div>
          </Show>
        </div>
      </div>

      {/* Exp chart */}
      <Show when={expRows().length > 0}>
        <div class="card bg-base-100 shadow-sm">
          <div class="card-body">
            <h2 class="card-title text-lg">経験値テーブル (累積)</h2>
            <p class="text-sm text-base-content/60">
              期間: {selectedPeriod()?.period_tag} / v{selectedPeriod()?.table_version} /
              Lv {expRows()[0]?.lv}〜{expRows()[expRows().length - 1]?.lv} ({expRows().length} 行)
            </p>
            <div class="w-full overflow-x-auto">
              <div style="min-width: 400px">
                <Line data={expChartData()} options={CHART_OPTIONS_EXP} width={800} height={320} />
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Bounds chart */}
      <Show when={boundRows().length > 0}>
        <div class="card bg-base-100 shadow-sm">
          <div class="card-body">
            <h2 class="card-title text-lg">
              naked パラメータ成長 (master_id: {boundRows()[0]?.master_id})
            </h2>
            <Show when={capRow()}>
              {(cap) => (
                <div class="flex flex-wrap gap-4 text-sm mb-2">
                  <span class="badge badge-outline">回避上限: {cap().kaihi_max}</span>
                  <span class="badge badge-outline">対潜上限: {cap().taisen_max}</span>
                  <span class="badge badge-outline">索敵上限: {cap().sakuteki_max}</span>
                </div>
              )}
            </Show>
            <div class="w-full overflow-x-auto">
              <div style="min-width: 400px">
                <Line data={boundsChartData()} options={CHART_OPTIONS_BOUNDS} width={800} height={320} />
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={expRows().length === 0 && !loadingData() && !loadingPeriods()}>
        <div class="card bg-base-100 shadow-sm">
          <div class="card-body items-center text-center py-16">
            <p class="text-base-content/50">期間を選択して「表示」を押してください。</p>
            <p class="text-base-content/40 text-sm mt-1">
              艦娘ID を入力すると naked パラメータ成長グラフも表示されます。
            </p>
          </div>
        </div>
      </Show>
    </div>
  );
}
