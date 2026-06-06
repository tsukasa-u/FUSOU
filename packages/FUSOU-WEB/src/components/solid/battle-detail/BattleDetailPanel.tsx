/** @jsxImportSource solid-js */
import {
  createSignal,
  createMemo,
  onMount,
  onCleanup,
  Show,
  createEffect,
} from "solid-js";
import type { JSX } from "solid-js";
import type { BattleFleets } from "@/features/battles/types";
import { getBattleMapAsset } from "@/data/battleMapAssets";
import { cachedFetch } from "@/utils/fetchCache";
import { buildShareBattleUrl, copyTextWithFallback } from "@/utils/share-url";
import {
  FORMATION_NAMES,
  AIR_STATE,
  RANK_COLORS,
} from "@/features/battles/constants";
import {
  normalizeEpochMs,
  resolveBattleResult,
} from "@/features/battles/helpers";
import {
  fetchBattleResultByUuid,
  fetchBattleRecordsByUuid,
  fetchRecordsByField,
  getMstShipById,
  getWeaponIconFrames,
  getMstSlotItemById,
  resolveMidnightHougeki,
  resolveOpeningTaisen,
  resolveHougeki,
  resolveOpeningAirAttack,
  resolveOpeningRaigeki,
  resolveClosingRaigeki,
  resolveFriendlyFleet,
  resolveEnemyFleet,
} from "@/features/battles/data-service";
import { ShipBanner, ShipRows } from "./ui";
import BattlePhaseView from "./BattlePhaseView";
import BattleTimelineView from "./BattleTimelineView";
import BattleDisplaySettingsModal from "./BattleDisplaySettingsModal";
import { ShareUrlButton } from "../common/ShareUrlButton";
import {
  MasterDataLoadStatusAlert,
  type MasterDataLoadStatusItem,
} from "../common/MasterDataLoadStatusAlert";

type DropShipInfo = {
  shipId: number;
  name: string;
  bannerUrl: string;
};

// ── Main orchestrator component ───────────────────────────────────────────

export default function BattleDetailPanel(props: {
  battleId: string;
}): JSX.Element {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const [battle, setBattle] = createSignal<Record<string, unknown> | null>(
    null,
  );
  const [fleets, setFleets] = createSignal<BattleFleets | null>(null);
  const [mstSlotItemById, setMstSlotItemById] = createSignal<Map<
    number,
    Record<string, unknown>
  > | null>(null);
  const [mstShipById, setMstShipById] = createSignal<Map<
    number,
    Record<string, unknown>
  > | null>(null);
  const [mapLabel, setMapLabel] = createSignal<string | null>(null);
  const [cellLabel, setCellLabel] = createSignal<string>("-");
  const [dropShipInfo, setDropShipInfo] = createSignal<DropShipInfo | null>(
    null,
  );
  function parseViewMode(raw: string | null): "phase" | "timeline" | null {
    if (raw === "phase" || raw === "timeline") return raw;
    return null;
  }

  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [masterDataStatus, setMasterDataStatus] = createSignal<
    MasterDataLoadStatusItem[]
  >([
    { name: "mst_ship", status: "pending" },
    { name: "mst_slotitem", status: "pending" },
  ]);
  const [viewMode, setViewMode] = createSignal<"phase" | "timeline">("phase");
  const [showPhaseSeparators, setShowPhaseSeparators] = createSignal(false);
  const [urlStateReady, setUrlStateReady] = createSignal(false);
  const [requestedPeriodTag, setRequestedPeriodTag] =
    createSignal<string>("latest");
  const [requestedTableVersion, setRequestedTableVersion] =
    createSignal<string>("");
  let displaySettingsModalRef!: HTMLDialogElement;

  function buildCurrentShareUrl(): string {
    const tableVersion = requestedTableVersion().trim();
    return buildShareBattleUrl(window.location.origin, {
      battleId: props.battleId,
      periodTag: requestedPeriodTag(),
      tableVersion: tableVersion || undefined,
      view: viewMode(),
      separators: viewMode() === "timeline" && showPhaseSeparators(),
    });
  }

  const backToListHref = createMemo(() => {
    const params = new URLSearchParams();
    if (requestedPeriodTag()) {
      params.set("period_tag", requestedPeriodTag());
    }
    const tableVersion = requestedTableVersion().trim();
    if (tableVersion) {
      params.set("table_version", tableVersion);
    }
    const query = params.toString();
    return query ? `/battles?${query}` : "/battles";
  });

  async function issueShareUrl(): Promise<void> {
    const shareUrl = buildCurrentShareUrl();
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

  // Derived values
  const ts = createMemo(() => {
    const b = battle();
    if (!b) return "-";
    const tsValue =
      normalizeEpochMs(b.timestamp) ?? normalizeEpochMs(b.midnight_timestamp);
    return tsValue
      ? new Date(tsValue).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      : "-";
  });

  const mapText = createMemo(() => {
    const label = mapLabel();
    if (label) return label;
    const b = battle();
    if (!b) return "-";
    return b.maparea_id && b.mapinfo_no
      ? `${b.maparea_id}-${b.mapinfo_no}`
      : "-";
  });

  const alphaCellLabel = (cellId: number): string => {
    if (!Number.isFinite(cellId) || cellId <= 0) return "-";
    let n = Math.floor(cellId);
    let label = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      label = String.fromCharCode(65 + rem) + label;
      n = Math.floor((n - 1) / 26);
    }
    return label;
  };

  async function resolveBattleCellLabel(
    battleRecord: Record<string, unknown>,
  ): Promise<string> {
    const rawCellId = Number(battleRecord.cell_id ?? NaN);
    if (!Number.isFinite(rawCellId)) return "-";
    if (rawCellId === 0) return "港";

    const mapAreaId = Number(battleRecord.maparea_id ?? NaN);
    const mapInfoNo = Number(battleRecord.mapinfo_no ?? NaN);
    if (
      !Number.isFinite(mapAreaId) ||
      !Number.isFinite(mapInfoNo) ||
      mapAreaId <= 0 ||
      mapInfoNo <= 0
    ) {
      return alphaCellLabel(rawCellId);
    }

    const mapKey = `${mapAreaId}-${mapInfoNo}`;
    const asset = getBattleMapAsset(mapKey);
    if (!asset?.labelsUrl) return alphaCellLabel(rawCellId);

    try {
      const response = await fetch(asset.labelsUrl);
      if (!response.ok) return alphaCellLabel(rawCellId);
      const payload = (await response.json()) as Record<string, string>;
      const label = payload?.[String(rawCellId)];
      return typeof label === "string" && label
        ? label
        : alphaCellLabel(rawCellId);
    } catch {
      return alphaCellLabel(rawCellId);
    }
  }

  const formations = createMemo(() => {
    const b = battle();
    if (!b) return { f: "-", e: "-" };
    const fForm = b.f_formation ?? (b.formation as any)?.[0] ?? 0;
    const eForm = b.e_formation ?? (b.formation as any)?.[1] ?? 0;
    return {
      f: FORMATION_NAMES[Number(fForm)] ?? "-",
      e: FORMATION_NAMES[Number(eForm)] ?? "-",
    };
  });

  const airInfo = createMemo(() => {
    const b = battle();
    if (!b) return { label: "-", cls: "" };
    const openingAir = Array.isArray(b.opening_air_attack)
      ? (b.opening_air_attack as any)[0]
      : b.opening_air_attack;
    const airSup = openingAir?.air_superiority;
    return AIR_STATE[Number(airSup)] ?? { label: "-", cls: "" };
  });

  const rank = createMemo(() => {
    const b = battle();
    if (!b) return "-";
    return String((b.battle_result as any)?.win_rank ?? "-");
  });

  const rankCls = createMemo(() => RANK_COLORS[rank()] ?? "");

  const dropInfo = createMemo(() => {
    const drop = dropShipInfo();
    if (!drop) return null;
    return drop;
  });

  const FleetFallback = (props: { emptyLabel: string }) => (
    <div class="flex items-center justify-center py-6 text-base-content/40">
      <Show
        when={loading()}
        fallback={<span class="text-sm">{props.emptyLabel}</span>}
      >
        <>
          <span class="loading loading-spinner loading-sm mr-2" />
          <span class="text-sm">艦隊データ読込中…</span>
        </>
      </Show>
    </div>
  );

  // ── Data loading ──────────────────────────────────────────────────

  function chooseBattleCandidate(
    candidates: Array<Record<string, unknown>>,
    preloaded: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    if (preloaded) {
      if (Number.isFinite(Number(preloaded.index))) {
        const byIndex = candidates.find(
          (r) => Number(r.index ?? -1) === Number(preloaded.index),
        );
        if (byIndex) return byIndex;
      }
      if (Number.isFinite(Number(preloaded.cell_id))) {
        const byCell = candidates.find(
          (r) => Number(r.cell_id ?? -1) === Number(preloaded.cell_id),
        );
        if (byCell) return byCell;
      }
    }
    return [...candidates].sort(
      (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0),
    )[0];
  }

  async function fetchCellMapLabel(uuid: string): Promise<string | null> {
    const tableVersion = requestedTableVersion().trim();
    const queryOptions = tableVersion ? { tableVersion } : undefined;
    const records = await fetchRecordsByField(
      "cells",
      "battles",
      uuid,
      50,
      queryOptions,
    );
    const first = records.find(
      (cell) =>
        Number(cell?.maparea_id ?? 0) > 0 && Number(cell?.mapinfo_no ?? 0) > 0,
    );
    if (!first) return null;
    return `${first.maparea_id}-${first.mapinfo_no}`;
  }

  async function loadBattle(): Promise<void> {
    setMasterDataStatus([
      { name: "mst_ship", status: "pending" },
      { name: "mst_slotitem", status: "pending" },
    ]);
    let preloadedBattle: Record<string, unknown> | null = null;

    // Try to load from sessionStorage first (quick preview)
    const battleData = sessionStorage.getItem("battleDetail");
    if (battleData) {
      try {
        const parsed = JSON.parse(battleData);
        // Only use the cached data if it matches the current battleId to avoid
        // showing a stale preview from a previously visited battle.
        const cachedUuid =
          typeof parsed?.uuid === "string" ? parsed.uuid : null;
        const cachedMatchesCurrent = cachedUuid === props.battleId;
        if (parsed && cachedMatchesCurrent) {
          preloadedBattle = parsed;
          const preloaded = {
            ...parsed,
            timestamp:
              normalizeEpochMs(parsed.timestamp) ??
              normalizeEpochMs(parsed.midnight_timestamp) ??
              null,
          };
          if (disposed) return;
          setBattle(preloaded);
        }
      } catch (e) {
        console.error("Failed to parse session battle data:", e);
      }
    }

    try {
      const idText = props.battleId;
      const fallbackIdx = Number.parseInt(idText, 10);
      const isLikelyUuid = idText.includes("-");
      const requestedPeriod = requestedPeriodTag();
      const tableVersion = requestedTableVersion().trim();
      const queryOptions = tableVersion ? { tableVersion } : undefined;
      const tableVersionQuery = tableVersion
        ? `&table_version=${encodeURIComponent(tableVersion)}`
        : "";

      let matched: Record<string, unknown> | null = null;

      if (isLikelyUuid) {
        const primaryCandidates = await fetchBattleRecordsByUuid(
          idText,
          requestedPeriod,
          queryOptions,
        );
        const fallbackCandidates =
          primaryCandidates.length > 0 || requestedPeriod === "all"
            ? primaryCandidates
            : await fetchBattleRecordsByUuid(idText, "all", queryOptions);
        matched = chooseBattleCandidate(fallbackCandidates, preloadedBattle);
      }

      if (!matched && Number.isFinite(fallbackIdx) && fallbackIdx >= 0) {
        const battleRes = await cachedFetch(
          `/api/battle-data/global/records?table=battle&period_tag=${encodeURIComponent(requestedPeriod)}${tableVersionQuery}&limit_blocks=120&limit_records=20000`,
        );
        if (battleRes.ok) {
          const payload = (await battleRes.json()) as {
            records?: Array<Record<string, unknown>>;
          };
          const records = payload.records ?? [];
          matched = records[fallbackIdx] ?? null;
        } else if (requestedPeriod !== "all") {
          const fallbackRes = await cachedFetch(
            `/api/battle-data/global/records?table=battle&period_tag=all${tableVersionQuery}&limit_blocks=120&limit_records=20000`,
          );
          if (fallbackRes.ok) {
            const fallbackPayload = (await fallbackRes.json()) as {
              records?: Array<Record<string, unknown>>;
            };
            matched = fallbackPayload.records?.[fallbackIdx] ?? null;
          }
        } else {
          // Local dev fallback for numeric detail IDs.
          const localByIndex = await fetchRecordsByField(
            "battle",
            "index",
            fallbackIdx,
            1,
            queryOptions,
          );
          if (localByIndex.length > 0) {
            matched = localByIndex[0];
          }
        }
      }

      if (!matched && preloadedBattle) {
        matched = preloadedBattle;
      }

      if (matched) {
        const resolvedBattleResultPromise =
          typeof matched.battle_result === "string"
            ? fetchBattleResultByUuid(matched.battle_result, queryOptions)
            : Promise.resolve(
                resolveBattleResult(matched.battle_result, new Map()),
              );

        const [
          resolvedBattleResult,
          resolvedMidnightHougeki,
          resolvedOpeningTaisen,
          resolvedHougeki,
          resolvedOpeningAirAttack,
          resolvedOpeningRaigeki,
          resolvedClosingRaigeki,
        ] = await Promise.all([
          resolvedBattleResultPromise,
          resolveMidnightHougeki(matched.midnight_hougeki, queryOptions),
          resolveOpeningTaisen(matched.opening_taisen, queryOptions),
          resolveHougeki(matched.hougeki, queryOptions),
          resolveOpeningAirAttack(matched.opening_air_attack, queryOptions),
          resolveOpeningRaigeki(matched.opening_raigeki, queryOptions),
          resolveClosingRaigeki(matched.closing_raigeki, queryOptions),
        ]);

        const merged = {
          ...matched,
          timestamp:
            normalizeEpochMs(matched.timestamp) ??
            normalizeEpochMs(matched.midnight_timestamp) ??
            null,
          battle_result: resolvedBattleResult,
          midnight_hougeki: resolvedMidnightHougeki,
          opening_taisen: resolvedOpeningTaisen,
          hougeki: resolvedHougeki,
          opening_air_attack: resolvedOpeningAirAttack,
          opening_raigeki: resolvedOpeningRaigeki,
          closing_raigeki: resolvedClosingRaigeki,
        };

        const label = matched.uuid
          ? await fetchCellMapLabel(String(matched.uuid))
          : null;

        await getWeaponIconFrames();
        const [friendlyShips, enemyShips] = await Promise.all([
          resolveFriendlyFleet(merged, queryOptions),
          resolveEnemyFleet(merged, queryOptions),
        ]);
        const resolvedFleets: BattleFleets = { friendlyShips, enemyShips };
        const resolvedMst = await getMstSlotItemById();
        const resolvedMstShip = await getMstShipById();
        setMasterDataStatus([
          {
            name: "mst_slotitem",
            status: resolvedMst.size > 0 ? "success" : "failed",
            detail: `${resolvedMst.size}件`,
          },
          {
            name: "mst_ship",
            status: resolvedMstShip.size > 0 ? "success" : "failed",
            detail: `${resolvedMstShip.size}件`,
          },
        ]);
        const resolvedCellLabel = await resolveBattleCellLabel(merged);

        const dropShipId = Number(resolvedBattleResult?.drop_ship_id ?? 0) || 0;
        const dropShip =
          dropShipId > 0 ? resolvedMstShip.get(dropShipId) : null;

        if (disposed) return;
        setBattle(merged);
        setFleets(resolvedFleets);
        setMstSlotItemById(resolvedMst);
        setMstShipById(resolvedMstShip);
        setMapLabel(label);
        setCellLabel(resolvedCellLabel);
        setDropShipInfo(
          dropShipId > 0
            ? {
                shipId: dropShipId,
                name: String(dropShip?.name ?? `艦#${dropShipId}`),
                bannerUrl: `/api/asset-sync/ship-banner/${dropShipId}`,
              }
            : null,
        );
      } else if (!preloadedBattle) {
        // Battle not found — hide master data status (it was never loaded, irrelevant here)
        setMasterDataStatus([]);
        if (disposed) return;
        setError("指定された戦闘データが見つかりませんでした");
      }
    } catch (e) {
      console.error("Failed to load battle detail:", e);
      // Battle loading failed — hide the master data alert since it's irrelevant
      // when there is no battle to display names for.
      setMasterDataStatus([]);
      if (disposed) return;
      setError("戦闘データ読込中にエラーが発生しました");
    } finally {
      if (disposed) return;
      setLoading(false);
    }
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const periodTag = params.get("period_tag")?.trim();
    if (periodTag) {
      setRequestedPeriodTag(periodTag);
    }
    const tableVersion = params.get("table_version")?.trim();
    if (tableVersion) {
      setRequestedTableVersion(tableVersion);
    }
    const initialView = parseViewMode(params.get("view"));
    if (initialView) {
      setViewMode(initialView);
    }
    setShowPhaseSeparators(params.get("separators") === "1");
    setUrlStateReady(true);
    void loadBattle();
  });

  createEffect(() => {
    if (!urlStateReady()) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", viewMode());
    if (viewMode() === "timeline" && showPhaseSeparators()) {
      url.searchParams.set("separators", "1");
    } else {
      url.searchParams.delete("separators");
    }
    window.history.replaceState({}, "", url.toString());
  });

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div class="max-w-[1440px] mx-auto px-4 py-8">
      <MasterDataLoadStatusAlert items={masterDataStatus()} class="mb-4" />

      {/* Back link */}
      <div class="mb-4">
        <a href={backToListHref()} class="btn btn-ghost btn-sm gap-1">
          ← 戦闘一覧に戻る
        </a>
      </div>

      {/* Error banner */}
      <Show when={error()}>
        <div class="card bg-base-100 shadow-sm mb-6">
          <div class="card-body">
            <h2 class="card-title">戦闘詳細</h2>
            <span
              class={
                error()!.includes("エラー") ? "text-error" : "text-warning"
              }
            >
              {error()}
            </span>
          </div>
        </div>
      </Show>

      <Show when={battle()}>
        {(b) => (
          <>
            {/* Battle Header */}
            <div class="card bg-base-100 shadow-sm mb-6">
              <div class="card-body">
                <h2 class="card-title">戦闘詳細</h2>
                <div class="flex flex-wrap gap-6 text-sm">
                  <span>
                    日時: <strong>{ts()}</strong>
                  </span>
                  <span>
                    海域: <strong>{mapText()}</strong>
                  </span>
                  <span>
                    セル: <strong>{cellLabel()}</strong>
                  </span>
                  <span>
                    デッキ: <strong>{String(b().deck_id ?? "-")}</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Formation & Air State & Result */}
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div class="card bg-base-100 shadow-sm">
                <div class="card-body p-4">
                  <h3 class="font-bold text-sm text-base-content/60">陣形</h3>
                  <div class="flex gap-4">
                    <div>
                      <span class="text-xs text-base-content/40">味方</span>
                      <p class="text-lg font-bold">{formations().f}</p>
                    </div>
                    <div>
                      <span class="text-xs text-base-content/40">敵</span>
                      <p class="text-lg font-bold">{formations().e}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div class="card bg-base-100 shadow-sm">
                <div class="card-body p-4">
                  <h3 class="font-bold text-sm text-base-content/60">
                    制空状態
                  </h3>
                  <p class={`text-lg font-bold ${airInfo().cls}`}>
                    {airInfo().label}
                  </p>
                </div>
              </div>
              <div class="card bg-base-100 shadow-sm">
                <div class="card-body p-4">
                  <h3 class="font-bold text-sm text-base-content/60">
                    戦闘結果
                  </h3>
                  <p class={`text-2xl font-bold ${rankCls()}`}>{rank()}</p>
                  <Show when={dropInfo()}>
                    {(drop) => (
                      <div class="mt-2 flex items-center gap-2">
                        <ShipBanner
                          src={drop().bannerUrl}
                          alt={drop().name}
                          class="h-8 w-28"
                        />
                        <div class="min-w-0">
                          <p class="text-[10px] text-base-content/55">
                            ドロップ艦
                          </p>
                          <p class="truncate text-sm font-medium">
                            {drop().name}
                          </p>
                        </div>
                      </div>
                    )}
                  </Show>
                </div>
              </div>
            </div>

            {/* HP Gauges */}
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div class="card bg-base-100 shadow-sm">
                <div class="card-body p-4">
                  <h3 class="font-bold text-sm text-base-content/60 mb-2">
                    味方艦隊
                  </h3>
                  <div class="space-y-2">
                    <Show
                      when={fleets()?.friendlyShips?.length}
                      fallback={
                        <FleetFallback emptyLabel="味方艦隊データなし" />
                      }
                    >
                      <ShipRows
                        ships={fleets()!.friendlyShips}
                        sideLabel="味方"
                      />
                    </Show>
                  </div>
                </div>
              </div>
              <div class="card bg-base-100 shadow-sm">
                <div class="card-body p-4">
                  <h3 class="font-bold text-sm text-base-content/60 mb-2">
                    敵艦隊
                  </h3>
                  <div class="space-y-2">
                    <Show
                      when={fleets()?.enemyShips?.length}
                      fallback={<FleetFallback emptyLabel="敵艦隊データなし" />}
                    >
                      <ShipRows ships={fleets()!.enemyShips} sideLabel="敵" />
                    </Show>
                  </div>
                </div>
              </div>
            </div>

            {/* Battle Phases / Timeline */}
            <div class="card bg-base-100 shadow-sm">
              <div class="card-body">
                <div class="flex items-center justify-between gap-4 mb-4 flex-wrap">
                  <h3 class="card-title text-lg">戦闘フェーズ</h3>
                  <div class="flex items-center gap-2">
                    <div class="join">
                      <button
                        id="battle-view-mode-phase"
                        class={`join-item btn btn-sm ${viewMode() === "phase" ? "btn-active" : ""}`}
                        onClick={() => setViewMode("phase")}
                      >
                        フェーズ
                      </button>
                      <button
                        id="battle-view-mode-timeline"
                        class={`join-item btn btn-sm ${viewMode() === "timeline" ? "btn-active" : ""}`}
                        onClick={() => setViewMode("timeline")}
                      >
                        タイムライン
                      </button>
                    </div>
                    <ShareUrlButton
                      id="battle-detail-share-url-btn"
                      onClick={() => {
                        void issueShareUrl();
                      }}
                    />
                    <button
                      id="battle-detail-display-settings-btn"
                      class="btn btn-sm btn-ghost gap-1.5"
                      type="button"
                      onClick={() => displaySettingsModalRef.showModal()}
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
                  </div>
                </div>

                {/* Phase detail view */}
                <div class={viewMode() === "phase" ? "" : "hidden"}>
                  <BattlePhaseView
                    battle={b()}
                    fleets={fleets()}
                    mstSlotItemById={mstSlotItemById()}
                  />
                </div>

                {/* Timeline view */}
                <div class={viewMode() === "timeline" ? "" : "hidden"}>
                  <BattleTimelineView
                    battle={b()}
                    fleets={fleets()}
                    mstSlotItemById={mstSlotItemById()}
                    mstShipById={mstShipById()}
                    showPhaseSeparators={showPhaseSeparators()}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </Show>

      {/* Display settings modal */}
      <BattleDisplaySettingsModal
        ref={(el) => {
          displaySettingsModalRef = el;
        }}
        showPhaseSeparators={showPhaseSeparators}
        setShowPhaseSeparators={setShowPhaseSeparators}
      />

      {/* Loading state (only when no preloaded data yet) */}
      <Show when={loading() && !battle()}>
        <div class="card bg-base-100 shadow-sm mb-6">
          <div class="card-body">
            <h2 class="card-title">戦闘詳細</h2>
            <span class="text-base-content/60">データ読込中...</span>
          </div>
        </div>
      </Show>
    </div>
  );
}
