/** @jsxImportSource solid-js */
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  Match,
  Switch,
  For,
} from "solid-js";
import { cachedFetch } from "@/utils/fetchCache";
import type { PeriodSummary, MasterDataStatusItem } from "./types";
import { AlertMessage } from "@/components/common/solid/AlertMessage";
import { MasterDataLoadStatusAlert } from "@/components/common/solid/MasterDataLoadStatusAlert";

// We'll lazy load or dynamically import the sub-panels to keep bundle size manageable if needed,
// but for SPA we can just import them directly.
import BattlesListPanel from "../../stats/solid/BattlesListPanel";
import BattleMapFlowPanel from "../../map-flow/solid/BattleMapFlowPanel";
import BattleStatsPanel from "../../stats/solid/BattleStatsPanel";
import BattleDetailPanel from "../../battle-detail/solid/BattleDetailPanel";
import BattleDropsPanel from "../../drops/solid/BattleDropsPanel"; // New component
import BattleTabs from "./BattleTabs"; // We'll create this Solid component

import { normalizeEpochMs, resolveBattleResult } from "../../map-flow/solid/battle-map-flow/dataUtils";
import { mapKeyOf } from "../../map-flow/solid/battle-map-flow/dataUtils";

export default function BattlesDashboard() {
  const DEFAULT_LIMIT_BLOCKS = 200;
  const DEFAULT_LIMIT_RECORDS = 20000;
  const MAX_LIMIT_BLOCKS = 400;
  const MAX_LIMIT_RECORDS = 20000;

  const [activeTab, setActiveTab] = createSignal<"list" | "detail" | "map-flow" | "stats" | "drops">("list");
  const [selectedDetailId, setSelectedDetailId] = createSignal("");
  
  const [periods, setPeriods] = createSignal<PeriodSummary[]>([]);
  const [selectedPeriodIdx, setSelectedPeriodIdx] = createSignal(0);
  const [loadingPeriods, setLoadingPeriods] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [partialLoadWarnings, setPartialLoadWarnings] = createSignal<string[]>([]);
  const [truncationWarnings, setTruncationWarnings] = createSignal<string[]>([]);
  const [limitBlocks, setLimitBlocks] = createSignal(DEFAULT_LIMIT_BLOCKS);
  const [limitRecords, setLimitRecords] = createSignal(DEFAULT_LIMIT_RECORDS);
  const [masterDataStatus, setMasterDataStatus] = createSignal<MasterDataStatusItem[]>([
    { name: "mst_ship", status: "pending" },
    { name: "mst_slotitem", status: "pending" },
  ]);
  const [masterDataMeta, setMasterDataMeta] = createSignal<{
    period_tag?: string;
    period_revision?: number;
    table_version?: string;
  } | null>(null);

  const [mapFilter, setMapFilter] = createSignal("");
  const [resultFilter, setResultFilter] = createSignal("");

  const [battleRecords, setBattleRecords] = createSignal<any[]>([]);
  const [cellRecords, setCellRecords] = createSignal<any[]>([]);
  const [enemyDecks, setEnemyDecks] = createSignal<any[]>([]);
  const [enemyShips, setEnemyShips] = createSignal<any[]>([]);
  const [enemySlotItems, setEnemySlotItems] = createSignal<any[]>([]);
  const [mstShips, setMstShips] = createSignal<any[]>([]);
  const [mstSlotItems, setMstSlotItems] = createSignal<any[]>([]);
  const [weaponIconFrames, setWeaponIconFrames] = createSignal<Record<number, any>>({});
  const [weaponIconMeta, setWeaponIconMeta] = createSignal<{ width: number; height: number }>({ width: 0, height: 0 });
  const [loadedDatasetKind, setLoadedDatasetKind] = createSignal<"overview" | "drops" | null>(null);

  let loadDataAbortController: AbortController | null = null;

  const selectedPeriod = () => periods()[selectedPeriodIdx()] ?? null;
  const hasReachedLimitCeiling = () =>
    limitBlocks() >= MAX_LIMIT_BLOCKS && limitRecords() >= MAX_LIMIT_RECORDS;

  type GlobalRecordsResponse = {
    records?: any[];
    source_blocks_truncated?: boolean;
    records_limit_reached?: boolean;
    applied_limit_blocks?: number;
    applied_limit_records?: number;
  };

  type OverviewPayload = {
    battles?: any[];
    cells?: any[];
    master_data?: {
      period_tag?: string;
      period_revision?: number;
      table_version?: string;
    };
  };

  type DropsPayload = {
    battles?: any[];
    mst_ships?: any[];
    mst_slotitems?: any[];
    master_data?: {
      period_tag?: string;
      period_revision?: number;
      table_version?: string;
    };
  };

  const datasetKindForTab = (
    tab: "list" | "detail" | "map-flow" | "stats" | "drops",
  ): "overview" | "drops" | null => {
    if (tab === "detail") return null;
    if (tab === "drops") return "drops";
    return "overview";
  };

  const mapOptions = () => {
    const values = new Set<string>();
    for (const b of battleRecords()) {
      const label = mapKeyOf(b);
      if (label !== "-") values.add(label);
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ja"));
  };

  async function fetchPeriodSummary(): Promise<PeriodSummary[]> {
    setLoadingPeriods(true);
    try {
      const response = await cachedFetch("/api/battle-data/global/summary?table=battle");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as any;
      const rowsFromSummary = (payload.periods || [])
        .map((row: any) => ({
          period_tag: String(row.period_tag ?? "").trim(),
          table_version: String(row.table_version ?? "").trim() || null,
        }))
        .filter((row: any) => row.period_tag.length > 0 && !!row.table_version);
      const rows: PeriodSummary[] = [
        { period_tag: "latest", table_version: null },
        { period_tag: "all", table_version: null },
        ...rowsFromSummary,
      ];
      setPeriods(rows);
      return rows;
    } finally {
      setLoadingPeriods(false);
    }
  }

  function resolveInitialPeriodIndex(
    rows: PeriodSummary[],
    rawPeriodTag: string | null,
    rawTableVersion: string | null,
  ): number {
    if (rows.length === 0) return 0;
    const periodTag = rawPeriodTag?.trim() || null;
    const tableVersion = rawTableVersion?.trim() || null;
    if (!periodTag) {
      return rows.findIndex((row) => row.period_tag === "latest") >= 0
        ? rows.findIndex((row) => row.period_tag === "latest")
        : 0;
    }
    const exactIdx = rows.findIndex(
      (row) => row.period_tag === periodTag && (!tableVersion || row.table_version === tableVersion),
    );
    if (exactIdx >= 0) return exactIdx;
    const periodOnlyIdx = rows.findIndex((row) => row.period_tag === periodTag);
    return periodOnlyIdx >= 0 ? periodOnlyIdx : 0;
  }

  async function loadData(periodOverride?: PeriodSummary | null) {
    const requestedPeriod = periodOverride ?? selectedPeriod();
    if (!requestedPeriod) {
      setError("利用可能な期間データがありません。");
      setBattleRecords([]);
      setCellRecords([]);
      return;
    }

    loadDataAbortController?.abort();
    const abortController = new AbortController();
    loadDataAbortController = abortController;
    const signal = abortController.signal;
    const requestedPeriodTag = requestedPeriod.period_tag;
    const datasetKind = datasetKindForTab(activeTab());
    if (!datasetKind) return;
    const tableVersionQuery = requestedPeriod.table_version
      ? `&table_version=${encodeURIComponent(requestedPeriod.table_version)}`
      : "";
    const overviewUrl = `/api/battle-data/global/overview?period_tag=${encodeURIComponent(requestedPeriodTag)}${tableVersionQuery}&limit_blocks=${limitBlocks()}&limit_records=${limitRecords()}`;
    const dropsUrl = `/api/battle-data/global/drops?period_tag=${encodeURIComponent(requestedPeriodTag)}${tableVersionQuery}&limit_blocks=${limitBlocks()}&limit_records=${limitRecords()}`;

    setLoading(true);
    setError(null);
    setPartialLoadWarnings([]);
    setTruncationWarnings([]);
    setMasterDataStatus([
      { name: "mst_ship", status: "pending" },
      { name: "mst_slotitem", status: "pending" },
    ]);

    try {
      if (datasetKind === "overview") {
        const [overviewResponse, masterShipResponse, masterSlotItemResponse] = await Promise.all([
          cachedFetch(overviewUrl, { signal }),
          cachedFetch("/api/master-data/json?table_name=mst_ship", { signal }),
          cachedFetch("/api/master-data/json?table_name=mst_slotitem", { signal }),
        ]);
        if (!overviewResponse.ok) {
          throw new Error(`HTTP ${overviewResponse.status}`);
        }
        if (!masterShipResponse.ok || !masterSlotItemResponse.ok) {
          throw new Error(`HTTP ${masterShipResponse.ok ? masterSlotItemResponse.status : masterShipResponse.status}`);
        }
        const payload = (await overviewResponse.json()) as OverviewPayload;
        const masterShipPayload = (await masterShipResponse.json()) as {
          period_tag?: string;
          period_revision?: number;
          table_version?: string;
          records?: any[];
        };
        const masterSlotItemPayload = (await masterSlotItemResponse.json()) as {
          period_tag?: string;
          period_revision?: number;
          table_version?: string;
          records?: any[];
        };
        if (signal.aborted || loadDataAbortController !== abortController) return;
        setBattleRecords(payload.battles || []);
        setCellRecords(payload.cells || []);
        setEnemyDecks([]);
        setEnemyShips([]);
        setEnemySlotItems([]);
        setMstShips([]);
        setMstSlotItems([]);
        setWeaponIconFrames({});
        setWeaponIconMeta({ width: 0, height: 0 });
        setMasterDataMeta(masterShipPayload || payload.master_data || null);
        setMasterDataStatus([
          {
            name: "mst_ship",
            status: "success",
            detail: `${masterShipPayload.records?.length ?? 0}件` +
              (masterShipPayload.period_tag
                ? ` / ${masterShipPayload.period_tag} rev${masterShipPayload.period_revision ?? "?"}`
                : ""),
          },
          {
            name: "mst_slotitem",
            status: "success",
            detail: `${masterSlotItemPayload.records?.length ?? 0}件` +
              (masterSlotItemPayload.period_tag
                ? ` / ${masterSlotItemPayload.period_tag} rev${masterSlotItemPayload.period_revision ?? "?"}`
                : ""),
          },
        ]);
        setLoadedDatasetKind("overview");
      } else {
        const [dropsResponse, masterShipResponse, masterSlotItemResponse] = await Promise.all([
          cachedFetch(dropsUrl, { signal }),
          cachedFetch("/api/master-data/json?table_name=mst_ship", { signal }),
          cachedFetch("/api/master-data/json?table_name=mst_slotitem", { signal }),
        ]);
        if (!dropsResponse.ok) {
          throw new Error(`HTTP ${dropsResponse.status}`);
        }
        if (!masterShipResponse.ok || !masterSlotItemResponse.ok) {
          throw new Error(`HTTP ${masterShipResponse.ok ? masterSlotItemResponse.status : masterShipResponse.status}`);
        }
        const payload = (await dropsResponse.json()) as DropsPayload;
        const masterShipPayload = (await masterShipResponse.json()) as {
          period_tag?: string;
          period_revision?: number;
          table_version?: string;
          records?: any[];
        };
        const masterSlotItemPayload = (await masterSlotItemResponse.json()) as {
          period_tag?: string;
          period_revision?: number;
          table_version?: string;
          records?: any[];
        };
        if (signal.aborted || loadDataAbortController !== abortController) return;
        setBattleRecords(payload.battles || []);
        setCellRecords([]);
        setEnemyDecks([]);
        setEnemyShips([]);
        setEnemySlotItems([]);
        setMstShips(payload.mst_ships || []);
        setMstSlotItems(masterSlotItemPayload.records || []);
        setWeaponIconFrames({});
        setWeaponIconMeta({ width: 0, height: 0 });
        setMasterDataMeta(masterShipPayload || payload.master_data || null);
        setMasterDataStatus([
          {
            name: "mst_ship",
            status: "success",
            detail: `${masterShipPayload.records?.length ?? payload.mst_ships?.length ?? 0}件` +
              (masterShipPayload.period_tag
                ? ` / ${masterShipPayload.period_tag} rev${masterShipPayload.period_revision ?? "?"}`
                : ""),
          },
          {
            name: "mst_slotitem",
            status: "success",
            detail: `${masterSlotItemPayload.records?.length ?? 0}件` +
              (masterSlotItemPayload.period_tag
                ? ` / ${masterSlotItemPayload.period_tag} rev${masterSlotItemPayload.period_revision ?? "?"}`
                : ""),
          },
        ]);
        setLoadedDatasetKind("drops");
      }

    } catch (e: any) {
      if (e.name === "AbortError") return;
      setError("読込に失敗しました。しばらくしてから再試行してください。");
      setBattleRecords([]);
      setCellRecords([]);
      setEnemyDecks([]);
      setEnemyShips([]);
      setEnemySlotItems([]);
      setMstShips([]);
      setMstSlotItems([]);
      setMasterDataMeta(null);
      setMasterDataStatus([
        { name: "mst_ship", status: "failed", detail: "読込失敗" },
        { name: "mst_slotitem", status: "failed", detail: "読込失敗" },
      ]);
      setLoadedDatasetKind(null);
    } finally {
      if (loadDataAbortController === abortController) {
        setLoading(false);
      }
    }
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const initialPeriodTag = params.get("period_tag");
    const initialTableVersion = params.get("table_version");
    const initialTab = params.get("tab") as "list" | "detail" | "map-flow" | "stats" | "drops";
    if (initialTab) {
      setActiveTab(initialTab);
    }
    const initialDetailId = params.get("detail_id");
    if (initialDetailId) {
      setSelectedDetailId(initialDetailId);
      if (!initialTab) setActiveTab("detail");
    }

    void (async () => {
      const rows = await fetchPeriodSummary();
      if (rows.length > 0) {
        const idx = resolveInitialPeriodIndex(rows, initialPeriodTag, initialTableVersion);
        setSelectedPeriodIdx(idx);
        if (initialTab !== "detail" || !initialDetailId) {
          await loadData(rows[idx]);
        }
      }
    })();
  });

  createEffect(() => {
    const tab = activeTab();
    const period = selectedPeriod();
    const wantedDatasetKind = datasetKindForTab(tab);
    if (
      wantedDatasetKind &&
      !loading() &&
      loadedDatasetKind() !== wantedDatasetKind &&
      period
    ) {
      void loadData(period);
    }
  });

  onCleanup(() => {
    loadDataAbortController?.abort();
  });

  // URL Sync
  createEffect(() => {
    const currentTab = activeTab();
    const url = new URL(window.location.href);
    if (currentTab !== "list") {
      url.searchParams.set("tab", currentTab);
    } else {
      url.searchParams.delete("tab");
    }
    
    if (currentTab === "detail" && selectedDetailId()) {
      url.searchParams.set("detail_id", selectedDetailId());
    } else {
      url.searchParams.delete("detail_id");
    }

    const p = selectedPeriod();
    if (p) {
      url.searchParams.set("period_tag", p.period_tag);
      if (p.table_version) url.searchParams.set("table_version", p.table_version);
    }
    window.history.replaceState({}, "", url.toString());
  });

  const dashboardState = {
    activeTab,
    setActiveTab,
    selectedPeriod,
    periods,
    loadingPeriods,
    loading,
    error,
    masterDataStatus,
    partialLoadWarnings,
    battleRecords,
    cellRecords,
    enemyDecks,
    enemyShips,
    enemySlotItems,
    mstShips,
    mstSlotItems,
    weaponIconFrames,
    weaponIconMeta,
    mapFilter,
    setMapFilter,
    resultFilter,
    setResultFilter,
    selectedDetailId,
    setSelectedDetailId,
  };

  return (
    <div class="fusou-page pb-12">
      <div class="fusou-page-container max-w-[1440px] py-8">
        <div class="fusou-page-header flex flex-col md:flex-row md:items-end gap-4">
          <div class="flex-1">
            <h1 class="fusou-page-title">戦闘データ</h1>
            <p class="fusou-page-subtitle">記録された戦闘ログの分析・集計機能</p>
          </div>
          <div class="fusou-page-actions flex-wrap">
            <div class="form-control">
              <select
                class="select select-bordered select-sm w-full"
                value={selectedPeriodIdx().toString()}
                onChange={(e) => {
                  const idx = Number(e.currentTarget.value);
                  setSelectedPeriodIdx(idx);
                  void loadData(periods()[idx]);
                }}
                disabled={loadingPeriods() || loading()}
              >
                <Show when={loadingPeriods()}>
                  <option value={selectedPeriodIdx().toString()}>読込中...</option>
                </Show>
                <For each={periods()}>
                  {(period, index) => (
                    <option value={index().toString()}>
                      {period.period_tag === "latest" ? "最新期間" : 
                       period.period_tag === "all" ? "全期間" : 
                       period.table_version ? `${period.period_tag} (v${period.table_version})` : period.period_tag}
                    </option>
                  )}
                </For>
              </select>
            </div>
            
            <Show when={activeTab() !== "detail"}>
              <div class="form-control">
                <select
                  class="select select-bordered select-sm"
                  value={mapFilter()}
                  onInput={(e) => setMapFilter(e.currentTarget.value)}
                >
                  <option value="">全海域</option>
                  <For each={mapOptions()}>
                    {(map) => <option value={map}>{map}</option>}
                  </For>
                </select>
              </div>
            </Show>

            <Show when={activeTab() === "list"}>
              <div class="form-control">
                <select
                  class="select select-bordered select-sm"
                  value={resultFilter()}
                  onInput={(e) => setResultFilter(e.currentTarget.value)}
                >
                  <option value="">全結果</option>
                  <option value="S">S勝利</option>
                  <option value="A">A勝利</option>
                  <option value="B">B勝利</option>
                  <option value="C">C敗北</option>
                  <option value="D">D敗北</option>
                </select>
              </div>
            </Show>

            <Show when={activeTab() === "map-flow"}>
              <button
                class="btn btn-neutral btn-outline btn-sm gap-1"
                type="button"
                onClick={() => {
                  const btn = document.getElementById("map-flow-display-settings-btn");
                  if (btn) btn.click();
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10.325 4.317a1 1 0 011.35-.936l.964.429a1 1 0 00.88 0l.964-.429a1 1 0 011.35.936l.093 1.053a1 1 0 00.516.79l.9.52a1 1 0 01.364 1.365l-.53.918a1 1 0 000 .998l.53.918a1 1 0 01-.364 1.365l-.9.52a1 1 0 00-.516.79l-.093 1.053a1 1 0 01-1.35.936l-.964-.429a1 1 0 00-.88 0l-.964.429a1 1 0 01-1.35-.936l-.093-1.053a1 1 0 00-.516-.79l-.9-.52a1 1 0 01-.364-1.365l.53-.918a1 1 0 000-.998l-.53-.918a1 1 0 01.364-1.365l.9-.52a1 1 0 00.516-.79l.093-1.053z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 9a3 3 0 100 6 3 3 0 000-6z"
                  />
                </svg>
                表示設定
              </button>
            </Show>

            <button
              type="button"
              class="btn btn-outline btn-sm"
              onClick={() => loadData(selectedPeriod())}
              disabled={loadingPeriods() || loading()}
            >
              <Show when={loading()}>
                <span class="loading loading-spinner loading-xs" />
              </Show>
              更新
            </button>
          </div>
        </div>

        <Show when={error()}>
          <div class="mb-6">
            <AlertMessage type="error">{error()!}</AlertMessage>
          </div>
        </Show>

        <Show when={partialLoadWarnings().length > 0}>
          <div class="mb-6 space-y-1">
            <For each={partialLoadWarnings()}>
              {(warning) => <AlertMessage type="warning">{warning}</AlertMessage>}
            </For>
          </div>
        </Show>

        <Show when={truncationWarnings().length > 0}>
          <div class="mb-6 space-y-2">
            <For each={truncationWarnings()}>
              {(warning) => <AlertMessage type="warning">{warning}</AlertMessage>}
            </For>
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span class="text-base-content/70">
                現在の上限: blocks={limitBlocks()} / records={limitRecords()}
              </span>
              <button
                type="button"
                class="btn btn-warning btn-outline btn-sm"
                disabled={loading() || hasReachedLimitCeiling()}
                onClick={() => {
                  const nextBlocks = Math.min(limitBlocks() + 100, MAX_LIMIT_BLOCKS);
                  const nextRecords = Math.min(limitRecords() + 5000, MAX_LIMIT_RECORDS);
                  setLimitBlocks(nextBlocks);
                  setLimitRecords(nextRecords);
                  void loadData(selectedPeriod());
                }}
              >
                上限を拡張して再取得
              </button>
              <Show when={hasReachedLimitCeiling()}>
                <span class="text-base-content/70">
                  API上限に達しているためこれ以上の拡張はできません。
                </span>
              </Show>
            </div>
          </div>
        </Show>

        <div class="mb-6">
          <MasterDataLoadStatusAlert 
            items={masterDataStatus()} 
            alwaysShow={true}
            subtitle={
              <div class="flex flex-col gap-0.5 mt-0.5">
                <Show when={selectedPeriod()}>
                  <span>{`参照データ期間: ${selectedPeriod()!.period_tag === 'latest' ? '最新 (latest)' : selectedPeriod()!.period_tag === 'all' ? '全期間 (all)' : selectedPeriod()!.period_tag}${selectedPeriod()!.table_version ? ` / ${selectedPeriod()!.table_version}` : ''}`}</span>
                </Show>
                <Show when={masterDataMeta()}>
                  <span>{`マスターデータ: ${masterDataMeta()?.period_tag || ''} rev${masterDataMeta()?.period_revision || ''}${masterDataMeta()?.table_version ? ` / ${masterDataMeta()?.table_version}` : ''}`}</span>
                </Show>
              </div>
            }
          />
        </div>

        <BattleTabs
          activeTab={activeTab()}
          onTabChange={setActiveTab}
          disabled={loading()}
        />

        <div class="mt-4">
          <Switch>
            <Match when={activeTab() === "list"}>
              <BattlesListPanel dashboardState={dashboardState} />
            </Match>
            <Match when={activeTab() === "map-flow"}>
              <BattleMapFlowPanel dashboardState={dashboardState} />
            </Match>
            <Match when={activeTab() === "stats"}>
              <BattleStatsPanel dashboardState={dashboardState} />
            </Match>
            <Match when={activeTab() === "detail"}>
              <BattleDetailPanel battleId={selectedDetailId()} />
            </Match>
            <Match when={activeTab() === "drops"}>
              <BattleDropsPanel dashboardState={dashboardState} />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}
