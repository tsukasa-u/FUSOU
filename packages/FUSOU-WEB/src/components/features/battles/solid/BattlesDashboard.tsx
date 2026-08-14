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
import { cachedFetch, clearFetchCache } from "@/utils/fetchCache";
import type { PeriodSummary, MasterDataStatusItem } from "./types";
import { AlertMessage } from "@/components/common/solid/AlertMessage";
import { MasterDataLoadStatusAlert } from "@/components/common/solid/MasterDataLoadStatusAlert";

// We'll lazy load or dynamically import the sub-panels to keep bundle size manageable if needed,
// but for SPA we can just import them directly.
import BattlesListPanel from "../../stats/solid/BattlesListPanel";
import BattleMapFlowPanel from "../../map-flow/solid/BattleMapFlowPanel";
import BattleStatsPanel from "../../stats/solid/BattleStatsPanel";
import BattleDetailPanel, {
  type BattleDetailLoadStatus,
} from "../../battle-detail/solid/BattleDetailPanel";
import BattleDropsPanel from "../../drops/solid/BattleDropsPanel"; // New component
import BattleTabs from "./BattleTabs"; // We'll create this Solid component
import BattleDataSettingsModal from "./BattleDataSettingsModal";
import BattleFilterSettingsModal from "./BattleFilterSettingsModal";
import { FilterIcon } from "@/components/common/solid/icons/FilterIcon";
import { SettingsIcon } from "@/components/common/solid/icons/SettingsIcon";
import { ShareUrlButton } from "@/components/common/solid/ShareUrlButton";


import { mapKeyOf } from "../../map-flow/solid/battle-map-flow/dataUtils";
import type {
  BattleDataProgress,
  BattleDataRepository,
} from "@/features/battles/repository/types";
import type { LocalAvroLoadLimits } from "@/features/battles/local-directory/limits";

function formatLocalProgress(
  progress: BattleDataProgress | null,
  includePhase = true,
  includeTable = false,
): string {
  if (!progress) return "ローカルデータを準備しています...";
  const phase = includePhase
    ? progress.phase === "decode"
      ? "AVROを展開中"
      : progress.phase === "index"
        ? "索引を作成中"
        : progress.phase === "resolve"
          ? "表示データを整理中"
          : "ローカルデータを確認中"
    : "";
  const subject = includeTable && progress.label ? ` ${progress.label}` : "";
  const files = progress.total > 0
    ? `ファイル ${progress.completed}/${progress.total}`
    : `ファイル ${progress.completed}`;
  const bytes = progress.totalBytes
    ? ` / ${formatBytes(progress.completedBytes ?? 0)} / ${formatBytes(progress.totalBytes)}`
    : "";
  const records = progress.records === undefined ? "" : ` / 保持レコード ${progress.records.toLocaleString()}件`;
  return `${phase}${subject} ${files}${bytes}${records}`.trim();
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatLoadError(
  error: unknown,
  period: PeriodSummary,
  progress: BattleDataProgress | null,
  source: "R2" | "ローカル AVRO",
): string {
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    details?: Record<string, unknown>;
    status?: unknown;
    url?: unknown;
  } | null;
  const details = candidate?.details ?? {};
  const table =
    typeof details["table"] === "string" ? details["table"] : progress?.label;
  const periodTag =
    typeof details["periodTag"] === "string"
      ? details["periodTag"]
      : period.period_tag;
  const relativePath =
    typeof details["relativePath"] === "string"
      ? details["relativePath"]
      : null;
  const phase = typeof details["phase"] === "string"
    ? details["phase"] === "file-discovery"
      ? "ファイル確認"
      : details["phase"] === "decode"
        ? "AVRO展開"
        : details["phase"]
    : progress?.phase === "decode"
      ? "AVRO展開"
      : progress?.phase;
  const cause = typeof candidate?.message === "string" ? candidate.message : "原因不明のエラー";
  return [
    `データソース: ${source}`,
    table ? `対象: ${table}` : null,
    periodTag ? `期間: ${periodTag}` : null,
    relativePath ? `ファイル: ${relativePath}` : null,
    phase ? `処理: ${phase}` : null,
    typeof candidate?.code === "string" ? `コード: ${candidate.code}` : null,
    typeof candidate?.status === "number" ? `HTTP: ${candidate.status}` : null,
    typeof candidate?.url === "string" ? `URL: ${candidate.url}` : null,
    `原因: ${cause}`,
  ].filter((part): part is string => part !== null).join(" / ");
}

export default function BattlesDashboard(props: {
  repository: BattleDataRepository;
  source: "r2" | "local-avro";
  localStatus: "idle" | "scanning" | "ready" | "error";
  localDirectoryName: () => string | null;
  rememberSource: boolean;
  onSourceChange: (source: "r2" | "local-avro") => void;
  onOpenLocalDirectorySettings: () => void;
  onRefreshDataSource: () => void | Promise<void>;
  onRememberSourceChange: (enabled: boolean) => void;
  localLimits: LocalAvroLoadLimits;
  onLocalLimitsChange: (limits: LocalAvroLoadLimits) => void | Promise<void>;
}) {
  const DEFAULT_LIMIT_BLOCKS = 200;
  const DEFAULT_LIMIT_RECORDS = props.source === "local-avro"
    ? Math.min(20000, props.localLimits.maxQueryRecords)
    : 20000;
  const MAX_LIMIT_BLOCKS = 400;
  const MAX_LIMIT_RECORDS = props.source === "local-avro"
    ? props.localLimits.maxQueryRecords
    : 20000;

  const [activeTab, setActiveTab] = createSignal<"list" | "detail" | "map-flow" | "stats" | "drops">("list");
  const [selectedDetailId, setSelectedDetailId] = createSignal("");
  const [selectedBattleIndex, setSelectedBattleIndex] = createSignal<number | null>(null);
  
  const [periods, setPeriods] = createSignal<PeriodSummary[]>([]);
  const [selectedPeriodIdx, setSelectedPeriodIdx] = createSignal(0);
  const [loadingPeriods, setLoadingPeriods] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [localProgress, setLocalProgress] = createSignal<BattleDataProgress | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [errorDetail, setErrorDetail] = createSignal<string | null>(null);
  const [queryErrorStatus, setQueryErrorStatus] = createSignal<MasterDataStatusItem | null>(null);
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
  const [detailLoadStatus, setDetailLoadStatus] =
    createSignal<BattleDetailLoadStatus | null>(null);

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
  let dataSettingsModalRef!: HTMLDialogElement;
  let filterSettingsModalRef!: HTMLDialogElement;
  const repository = props.repository;

  createEffect(() => {
    if (props.source !== "local-avro" || props.localStatus === "ready") return;
    loadDataAbortController?.abort();
    setLoading(false);
  });

  const dataLoadItems = () => {
    const items = [...masterDataStatus()];
    if (repository.kind === "local-avro") {
      const diagnostic = errorDetail();
      items.push({
        name: "ローカル AVRO",
        status: loading() ? "pending" : error() ? "failed" : "success",
        detail: diagnostic ?? formatLocalProgress(localProgress(), false),
        ...(diagnostic === null ? {} : { diagnostic }),
      });
    } else if (queryErrorStatus()) {
      items.push(queryErrorStatus()!);
    }
    return items;
  };

  const currentDataLoadItems = () => activeTab() === "detail"
    ? detailLoadStatus()?.items ?? [
        { name: "mst_ship", status: "pending" as const },
        { name: "mst_slotitem", status: "pending" as const },
      ]
    : dataLoadItems();

  const currentLoadProgress = () => activeTab() === "detail"
    ? detailLoadStatus()?.progress ?? null
    : localProgress();

  const currentLoading = () => activeTab() === "detail"
    ? detailLoadStatus()?.loading ?? false
    : loading();

  const selectedPeriod = () => periods()[selectedPeriodIdx()] ?? null;
  const hasReachedLimitCeiling = () =>
    limitBlocks() >= MAX_LIMIT_BLOCKS && limitRecords() >= MAX_LIMIT_RECORDS;


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
      const periodsFromRepository = await repository.listPeriods("battle");
      const rowsFromSummary = periodsFromRepository.map((row) => ({
        period_tag: row.periodTag,
        table_version: row.tableVersion || null,
      }));
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

  async function loadData(periodOverride?: PeriodSummary | null, { forceRefresh = false }: { forceRefresh?: boolean } = {}) {
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
    setLoading(true);
    setLocalProgress(null);
    setError(null);
    setErrorDetail(null);
    setQueryErrorStatus(null);
    setPartialLoadWarnings([]);
    setTruncationWarnings([]);
    setMasterDataStatus([
      { name: "mst_ship", status: "pending" },
      { name: "mst_slotitem", status: "pending" },
    ]);

    let masterDataLoaded = false;
    try {
      if (datasetKind === "overview") {
        const [masterShipResponse, masterSlotItemResponse] = await Promise.all([
          cachedFetch("/api/master-data/json?table_name=mst_ship", { signal }),
          cachedFetch("/api/master-data/json?table_name=mst_slotitem", { signal }),
        ]);
        if (!masterShipResponse.ok || !masterSlotItemResponse.ok) {
          throw new Error(`HTTP ${masterShipResponse.ok ? masterSlotItemResponse.status : masterShipResponse.status}`);
        }
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
        masterDataLoaded = true;
        const payload = await repository.getOverview({
          periodTag: requestedPeriodTag,
          ...(requestedPeriod.table_version
            ? { tableVersion: requestedPeriod.table_version }
            : {}),
          masterShips: masterShipPayload.records || [],
          limitBlocks: limitBlocks(),
          limitRecords: limitRecords(),
          signal,
          forceRefresh,
        }, repository.kind === "local-avro" ? { onProgress: setLocalProgress } : {});
        if (signal.aborted || loadDataAbortController !== abortController) return;
        setBattleRecords(payload.battles || []);
        setCellRecords(payload.cells || []);
        setEnemyDecks(payload.enemy_decks || []);
        setEnemyShips(payload.enemy_ships || []);
        setEnemySlotItems([]);
        setMstShips(masterShipPayload.records || []);
        setMstSlotItems(masterSlotItemPayload.records || []);
        setWeaponIconFrames({});
        setWeaponIconMeta({ width: 0, height: 0 });
        setMasterDataMeta(masterShipPayload || payload.master_data || null);
        setLoadedDatasetKind("overview");
      } else {
        const [masterShipResponse, masterSlotItemResponse] = await Promise.all([
          cachedFetch("/api/master-data/json?table_name=mst_ship", { signal }),
          cachedFetch("/api/master-data/json?table_name=mst_slotitem", { signal }),
        ]);
        if (!masterShipResponse.ok || !masterSlotItemResponse.ok) {
          throw new Error(`HTTP ${masterShipResponse.ok ? masterSlotItemResponse.status : masterShipResponse.status}`);
        }
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
        masterDataLoaded = true;
        const payload = await repository.getDrops({
          periodTag: requestedPeriodTag,
          ...(requestedPeriod.table_version
            ? { tableVersion: requestedPeriod.table_version }
            : {}),
          masterShips: masterShipPayload.records || [],
          limitBlocks: limitBlocks(),
          limitRecords: limitRecords(),
          signal,
          forceRefresh,
        }, repository.kind === "local-avro" ? { onProgress: setLocalProgress } : {});
        if (signal.aborted || loadDataAbortController !== abortController) return;
        setBattleRecords(payload.battles || []);
        setCellRecords([]);
        setEnemyDecks([]);
        setEnemyShips([]);
        setEnemySlotItems([]);
        setMstShips(masterShipPayload.records || []);
        setMstSlotItems(masterSlotItemPayload.records || []);
        setWeaponIconFrames({});
        setWeaponIconMeta({ width: 0, height: 0 });
        setMasterDataMeta(masterShipPayload || payload.master_data || null);
        setLoadedDatasetKind("drops");
      }

    } catch (e: any) {
      if (
        e.name === "AbortError" ||
        e.code === "CANCELLED" ||
        signal.aborted ||
        loadDataAbortController !== abortController
      ) return;
      const diagnostic = masterDataLoaded
        ? formatLoadError(
            e,
            requestedPeriod,
            localProgress(),
            repository.kind === "local-avro" ? "ローカル AVRO" : "R2",
          )
        : `データソース: R2 / 対象: マスターデータ（mst_ship, mst_slotitem） / 原因: ${
            e.message ?? "原因不明のエラー"
          }`;
      setError(
        masterDataLoaded
          ? repository.kind === "local-avro"
            ? "ローカル AVRO の戦闘データ読込に失敗しました。"
            : "R2 の戦闘データ読込に失敗しました。"
          : "マスターデータ（取得元: R2）の読込に失敗しました。",
      );
      setErrorDetail(diagnostic);
      if (masterDataLoaded && repository.kind === "r2") {
        setQueryErrorStatus({
          name: "R2 戦闘データ",
          status: "failed",
          detail: diagnostic,
          diagnostic,
        });
      }
      setBattleRecords([]);
      setCellRecords([]);
      setEnemyDecks([]);
      setEnemyShips([]);
      setEnemySlotItems([]);
      if (!masterDataLoaded) {
        setMstShips([]);
        setMstSlotItems([]);
        setMasterDataMeta(null);
        setMasterDataStatus([
          { name: "mst_ship", status: "failed", detail: "R2 / 読込失敗", diagnostic },
          { name: "mst_slotitem", status: "failed", detail: "R2 / 読込失敗", diagnostic },
        ]);
      }
      setLoadedDatasetKind(null);
    } finally {
      if (loadDataAbortController === abortController) {
        setLoading(false);
      }
    }
  }

  function changePeriod(index: number) {
    setSelectedPeriodIdx(index);
    void loadData(periods()[index]);
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const initialPeriodTag = params.get("period_tag");
    const initialTableVersion = params.get("table_version");
    const initialMapFilter = params.get("map_filter")?.trim() ?? "";
    const initialResultFilter = params.get("result_filter")?.trim() ?? "";
    const initialTab = params.get("tab") as "list" | "detail" | "map-flow" | "stats" | "drops";
    if (initialMapFilter) {
      setMapFilter(initialMapFilter);
    }
    if (initialResultFilter) {
      setResultFilter(initialResultFilter);
    }
    if (initialTab) {
      setActiveTab(initialTab);
    }
    const initialDetailId = params.get("detail_id");
    if (initialDetailId) {
      setSelectedDetailId(initialDetailId);
      if (!initialTab) setActiveTab("detail");
    }
    const initialBattleIndex = params.get("battle_index");
    if (initialBattleIndex !== null) {
      setSelectedBattleIndex(Number(initialBattleIndex));
    }

    void (async () => {
      try {
        const rows = await fetchPeriodSummary();
        if (rows.length > 0) {
          const idx = resolveInitialPeriodIndex(rows, initialPeriodTag, initialTableVersion);
          setSelectedPeriodIdx(idx);
          if (initialTab !== "detail" || !initialDetailId) {
            await loadData(rows[idx]);
          }
        }
      } catch (cause) {
        const sourceLabel = repository.kind === "local-avro" ? "ローカル AVRO" : "R2";
        const fallbackPeriod: PeriodSummary = {
          period_tag: initialPeriodTag || "latest",
          table_version: null,
        };
        setError(`${sourceLabel} の期間一覧の読込に失敗しました。`);
        setErrorDetail(formatLoadError(cause, fallbackPeriod, localProgress(), sourceLabel));
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
      period &&
      (props.source !== "local-avro" || props.localStatus === "ready")
    ) {
      void loadData(period);
    }
  });

  onCleanup(() => {
    loadDataAbortController?.abort();
    void repository.dispose();
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

    if (currentTab === "detail" && selectedBattleIndex() !== null) {
      url.searchParams.set("battle_index", String(selectedBattleIndex()));
    } else {
      url.searchParams.delete("battle_index");
    }

    const p = selectedPeriod();
    if (p) {
      url.searchParams.set("period_tag", p.period_tag);
      if (p.table_version) {
        url.searchParams.set("table_version", p.table_version);
      } else {
        url.searchParams.delete("table_version");
      }
    }

    const map = mapFilter().trim();
    if (map) {
      url.searchParams.set("map_filter", map);
    } else {
      url.searchParams.delete("map_filter");
    }

    const result = resultFilter().trim();
    if (result) {
      url.searchParams.set("result_filter", result);
    } else {
      url.searchParams.delete("result_filter");
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
    selectedBattleIndex,
    setSelectedBattleIndex,
  };

  return (
    <div class="fusou-page pb-12">
      <div class="fusou-page-container max-w-360 py-8">
        <div class="fusou-page-header flex flex-col md:flex-row md:items-end gap-4">
          <div class="flex-1">
            <h1 class="fusou-page-title">戦闘データ</h1>
            <p class="fusou-page-subtitle">記録された戦闘ログの分析・集計機能</p>
          </div>
          <div class="fusou-page-actions flex-wrap">
            <Show when={activeTab() === "map-flow"}>
              <button
                class="fusou-btn-secondary gap-1.5"
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("map-flow-open-display-settings"))}
              >
                <SettingsIcon class="h-4 w-4" />
                <span class="hidden md:inline">表示設定</span>
              </button>
            </Show>

            <Show when={activeTab() === "detail"}>
              <button
                id="battle-detail-display-settings-btn"
                class="fusou-btn-secondary gap-1.5"
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("battle-detail-open-display-settings"),
                  )
                }
              >
                <SettingsIcon class="h-4 w-4" />
                <span class="hidden md:inline">表示設定</span>
              </button>
            </Show>

            <Show when={activeTab() === "detail"}>
              <ShareUrlButton
                id="battle-detail-share-url-btn"
                onShare={() => {
                  return new Promise((resolve) => {
                    const onStatus = (e: CustomEvent) => {
                      window.removeEventListener(
                        "battle-detail-share-status",
                        onStatus as EventListener,
                      );
                      resolve(e.detail === "success");
                    };
                    window.addEventListener(
                      "battle-detail-share-status",
                      onStatus as EventListener,
                    );
                    window.dispatchEvent(new CustomEvent("battle-detail-share"));
                  });
                }}
              />
            </Show>

            <button
              id="battle-filter-settings-btn"
              class="fusou-btn-secondary gap-1.5"
              type="button"
              onClick={() => filterSettingsModalRef?.showModal()}
            >
              <FilterIcon class="h-4 w-4" />
              <span>フィルター</span>
            </button>

            <button
              id="battle-data-settings-btn"
              class="fusou-btn-secondary gap-1.5"
              type="button"
              onClick={() => dataSettingsModalRef?.showModal()}
            >
              <SettingsIcon class="h-4 w-4" />
              <span class="hidden md:inline">データ設定</span>
            </button>

            <button
              type="button"
              class="fusou-btn-secondary gap-1.5"
              onClick={() => {
                clearFetchCache();
                if (repository.kind === "local-avro") {
                  void props.onRefreshDataSource();
                  return;
                }
                void loadData(selectedPeriod(), { forceRefresh: true });
              }}
              disabled={loadingPeriods() || loading()}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span class="hidden md:inline">
                <Show when={loading()} fallback="更新">
                  読込中
                </Show>
              </span>
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

        <MasterDataLoadStatusAlert
          items={currentDataLoadItems()}
          errorsOnly={true}
          class="mb-6"
        />

        <BattleTabs
          activeTab={activeTab()}
          onTabChange={(tab) => {
            if (tab === "detail") setDetailLoadStatus(null);
            setActiveTab(tab);
          }}
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
              <BattleDetailPanel
                battleId={selectedDetailId()}
                battleIndex={selectedBattleIndex()}
                repository={repository}
                onBattleIndexChange={(index) => setSelectedBattleIndex(index)}
                onLoadStatusChange={setDetailLoadStatus}
              />
            </Match>
            <Match when={activeTab() === "drops"}>
              <BattleDropsPanel dashboardState={dashboardState} />
            </Match>
          </Switch>
        </div>
      </div>
      <BattleDataSettingsModal
        ref={(element) => {
          dataSettingsModalRef = element;
        }}
        source={props.source}
        localStatus={props.localStatus}
        localDirectoryName={props.localDirectoryName}
        rememberSource={props.rememberSource}
        onSourceChange={(source) => {
          dataSettingsModalRef.close();
          props.onSourceChange(source);
        }}
        onOpenLocalDirectorySettings={() => {
          dataSettingsModalRef.close();
          props.onOpenLocalDirectorySettings();
        }}
        onRememberSourceChange={props.onRememberSourceChange}
        periodLabel={selectedPeriod()?.period_tag === "latest"
          ? "最新 (latest)"
          : selectedPeriod()?.period_tag === "all"
            ? "全期間 (all)"
            : selectedPeriod()?.period_tag ?? "-"}
        masterDataMeta={masterDataMeta}
        items={currentDataLoadItems}
        progress={currentLoadProgress}
        loading={currentLoading}
        localLimits={props.localLimits}
        onLocalLimitsChange={props.onLocalLimitsChange}
      />
      <BattleFilterSettingsModal
        ref={(element) => {
          filterSettingsModalRef = element;
        }}
        periods={periods}
        selectedPeriodIndex={selectedPeriodIdx}
        loadingPeriods={loadingPeriods}
        loading={loading}
        onPeriodChange={changePeriod}
        mapOptions={mapOptions}
        mapFilter={mapFilter}
        onMapFilterChange={setMapFilter}
        resultFilter={resultFilter}
        onResultFilterChange={setResultFilter}
        showMapFilter={activeTab() !== "detail"}
        showResultFilter={activeTab() === "list"}
      />
    </div>
  );
}
