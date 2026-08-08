/** @jsxImportSource solid-js */
import {
  createSignal,
  createMemo,
  onMount,
  onCleanup,
  Show,
  For,
  createEffect,
  untrack,
} from "solid-js";
import type { JSX } from "solid-js";
import type { BattleFleets } from "@/features/battles/types";
import { getBattleMapAsset } from "@/data/battleMapAssets";
import { cachedFetch } from "@/utils/fetchCache";
import { buildShareBattleUrl } from "@/utils/share-url";
import { copyToClipboard } from "@/utils/clipboard";
import {
  FORMATION_NAMES,
  AIR_STATE,
  RANK_COLORS,
} from "@/features/battles/constants";
import { formatMapTextByIds } from "@/features/battles/map-labels";
import {
  normalizeEpochMs,
} from "@/features/battles/helpers";
import {
  getMstSlotItemById,
  getWeaponIconFrames,
} from "@/features/battles/data-service";
import { bannerUrl } from "@/features/simulator/equip-calc";
import { ShipBanner, ShipRows } from "./ui";
import BattlePhaseView from "./BattlePhaseView";
import BattleTimelineView from "./BattleTimelineView";
import BattleDisplaySettingsModal from "./BattleDisplaySettingsModal";
import {
  MasterDataLoadStatusAlert,
  type MasterDataLoadStatusItem,
} from "@/components/common/solid/MasterDataLoadStatusAlert";

type DropShipInfo = {
  shipId: number;
  name: string;
  bannerUrl: string;
};

type BattleDetailPayload = {
  table_version?: string | null;
  battle_indexes?: number[];
  battle?: Record<string, unknown> | null;
  linked?: {
    cells?: Array<Record<string, unknown>>;
  };
  refs?: {
    mst_ship?: Array<Record<string, unknown>>;
    mst_slotitem?: Array<Record<string, unknown>>;
  };
  derived?: {
    friendly_fleet?: Array<Record<string, unknown>>;
    enemy_fleet?: Array<Record<string, unknown>>;
  };
};

type GlobalLatestPayload = {
  latest?: {
    table_version?: string | null;
  };
};

type BattleOverviewPayload = {
  battles?: Array<Record<string, unknown>>;
};

// ── Main orchestrator component ───────────────────────────────────────────

export default function BattleDetailPanel(props: {
  battleId: string;
  battleIndex?: number | null;
  onBattleIndexChange?: (index: number) => void;
}): JSX.Element {
  let disposed = false;
  let activeLoadToken = 0;
  let lastLoadKey: string | null = null;
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
  const [resolvedTableVersion, setResolvedTableVersion] =
    createSignal<string | null>(null);
  const [battleIndexes, setBattleIndexes] = createSignal<number[]>([]);
  const [switchingBattleIndex, setSwitchingBattleIndex] = createSignal<
    number | null
  >(null);
  let displaySettingsModalRef!: HTMLDialogElement;

  function parseSemver(version: string): [number, number, number] | null {
    const trimmed = version.trim();
    const normalized = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
    const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }

  function isVersionBefore(version: string, threshold: string): boolean {
    const left = parseSemver(version);
    const right = parseSemver(threshold);
    if (!left || !right) return false;
    if (left[0] !== right[0]) return left[0] < right[0];
    if (left[1] !== right[1]) return left[1] < right[1];
    return left[2] < right[2];
  }

  function buildCurrentShareUrl(): string {
    const tableVersion = requestedTableVersion().trim();
    return buildShareBattleUrl(window.location.origin, {
      battleId: props.battleId,
      battleIndex: props.battleIndex,
      periodTag: requestedPeriodTag(),
      tableVersion: tableVersion || undefined,
      view: viewMode(),
      separators: viewMode() === "timeline" && showPhaseSeparators(),
    });
  }

  const showLegacyAirbaseWarning = createMemo(() => {
    const b = battle();
    if (!b) return false;

    const hasData = (value: unknown): boolean => {
      if (value == null) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "string") return value.trim().length > 0;
      if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
      return true;
    };

    const hasAirbaseContext =
      hasData(b.air_base_assault) ||
      hasData(b.air_base_air_attacks) ||
      hasData(b.destruction_battle);
    if (!hasAirbaseContext) return false;

    const resolved = resolvedTableVersion();
    const requested = requestedTableVersion().trim();
    const version = (resolved && resolved.trim()) || requested;
    if (!version) return false;
    return isVersionBefore(version, "0.6.0");
  });

  async function issueShareUrl(): Promise<boolean> {
    const shareUrl = buildCurrentShareUrl();
    const copied = copyToClipboard(shareUrl);
    if (copied) {
      return true;
    }

    window.prompt(
      "自動コピーに失敗しました。以下を手動でコピーしてください:",
      shareUrl,
    );
    return false;
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
    const b = battle();
    if (!b) return "-";
    const mapAreaId = Number(b.maparea_id ?? NaN);
    const mapInfoNo = Number(b.mapinfo_no ?? NaN);
    if (!Number.isFinite(mapAreaId) || !Number.isFinite(mapInfoNo) || mapAreaId <= 0 || mapInfoNo <= 0) {
      const fallback = mapLabel();
      if (!fallback) return "-";
      const matched = fallback.match(/^(\d+)-(\d+)$/);
      if (!matched) return fallback;
      const fallbackAreaId = Number(matched[1]);
      const fallbackMapInfoNo = Number(matched[2]);
      if (
        !Number.isFinite(fallbackAreaId) ||
        !Number.isFinite(fallbackMapInfoNo) ||
        fallbackAreaId <= 0 ||
        fallbackMapInfoNo <= 0
      ) {
        return fallback;
      }
      return formatMapTextByIds(fallbackAreaId, fallbackMapInfoNo);
    }
    return formatMapTextByIds(mapAreaId, mapInfoNo);
  });

  const selectableBattleIndexes = createMemo(() => {
    const fromPayload = battleIndexes()
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v >= 0);
    const current = Number(props.battleIndex ?? Number.NaN);
    const merged = Number.isFinite(current) && current >= 0
      ? [...fromPayload, current]
      : fromPayload;
    return [...new Set(merged)].sort((a, b) => a - b);
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
    mapAreaIdOverride?: number,
    mapInfoNoOverride?: number,
  ): Promise<string> {
    const rawCellId = Number(battleRecord.cell_id ?? NaN);
    if (!Number.isFinite(rawCellId)) return "-";
    if (rawCellId === 0) return "港";

    const mapAreaId = Number.isFinite(mapAreaIdOverride)
      ? Number(mapAreaIdOverride)
      : Number(battleRecord.maparea_id ?? NaN);
    const mapInfoNo = Number.isFinite(mapInfoNoOverride)
      ? Number(mapInfoNoOverride)
      : Number(battleRecord.mapinfo_no ?? NaN);
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
    if (!b) return null;
    const openingAir = Array.isArray(b.opening_air_attack)
      ? (b.opening_air_attack as any)[0]
      : b.opening_air_attack;
    if (!openingAir || typeof openingAir !== "object") {
      return null;
    }
    const fDamages = Array.isArray(openingAir?.f_damages)
      ? (openingAir.f_damages as unknown[])
      : [];
    const eDamages = Array.isArray(openingAir?.e_damages)
      ? (openingAir.e_damages as unknown[])
      : [];
    const hasAnyAirDamage =
      fDamages.some((d) => (Number(d ?? 0) || 0) > 0) ||
      eDamages.some((d) => (Number(d ?? 0) || 0) > 0);
    const fPlaneFrom = Array.isArray(openingAir?.f_plane_from)
      ? (openingAir.f_plane_from as unknown[])
      : [];
    const ePlaneFrom = Array.isArray(openingAir?.e_plane_from)
      ? (openingAir.e_plane_from as unknown[])
      : [];
    const hasAnyAirSortie = fPlaneFrom.length > 0 || ePlaneFrom.length > 0;
    if (!hasAnyAirDamage && !hasAnyAirSortie) {
      return null;
    }
    const airSup = openingAir?.air_superiority;
    return AIR_STATE[Number(airSup)] ?? null;
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

  async function loadBattle(params: {
    envUuid: string;
    requestedBattleIndex: number;
    requestedPeriod: string;
    tableVersion: string;
    loadToken: number;
  }): Promise<void> {
    const {
      envUuid,
      requestedBattleIndex,
      requestedPeriod,
      tableVersion,
      loadToken,
    } = params;
    if (!battle()) {
      setResolvedTableVersion(null);
    }
    if (!battle()) {
      setMasterDataStatus([
        { name: "mst_ship", status: "pending" },
        { name: "mst_slotitem", status: "pending" },
      ]);
    }
    // Try to load from sessionStorage first (quick preview)
    const battleData = sessionStorage.getItem("battleDetail");
    if (battleData) {
      try {
        const parsed = JSON.parse(battleData);
        // Only use the cached data if it matches the current battleId to avoid
        // showing a stale preview from a previously visited battle.
        const cachedUuid =
          typeof parsed?.uuid === "string" ? parsed.uuid : null;
        const cachedMatchesCurrent = cachedUuid === envUuid;
        if (parsed && cachedMatchesCurrent) {
          const preloaded = {
            ...parsed,
            timestamp:
              normalizeEpochMs(parsed.timestamp) ??
              normalizeEpochMs(parsed.midnight_timestamp) ??
              null,
          };
          if (disposed || loadToken !== activeLoadToken) return;
          setBattle(preloaded);
        }
      } catch (e) {
        console.error("Failed to parse session battle data:", e);
      }
    }

    try {
      let effectiveTableVersion: string | null = tableVersion || null;
      const tableVersionQuery = tableVersion
        ? `&table_version=${encodeURIComponent(tableVersion)}`
        : "";

      const resolveBattleIndexesFallback = async (): Promise<number[]> => {
        try {
          const overviewRes = await cachedFetch(
            `/api/battle-data/global/overview?period_tag=${encodeURIComponent(requestedPeriod)}${tableVersionQuery}&limit_blocks=120&limit_records=20000`,
          );
          if (!overviewRes.ok) return [];
          const overview = (await overviewRes.json()) as BattleOverviewPayload;
          const indexes = (overview.battles || [])
            .filter((row) => String(row.env_uuid ?? "") === envUuid)
            .map((row) => Number(row.index ?? Number.NaN))
            .filter((idx) => Number.isFinite(idx) && idx >= 0);
          return [...new Set(indexes)].sort((a, b) => a - b);
        } catch {
          return [];
        }
      };

      if (!effectiveTableVersion && requestedPeriod === "latest") {
        try {
          const latestRes = await cachedFetch(
            `/api/battle-data/global/latest?table=battle`,
          );
          if (latestRes.ok) {
            const latestPayload =
              (await latestRes.json()) as GlobalLatestPayload;
            const latestVersion = latestPayload.latest?.table_version;
            if (typeof latestVersion === "string" && latestVersion.trim()) {
              effectiveTableVersion = latestVersion.trim();
            }
          }
        } catch {
          // Keep fallback behavior when latest version lookup fails.
        }
      }

      if (!envUuid) {
        setMasterDataStatus([]);
        setError("env_uuid が指定されていません");
        return;
      }

      if (!Number.isFinite(requestedBattleIndex) || requestedBattleIndex < 0) {
        setMasterDataStatus([]);
        setError("battle_index が指定されていないか不正です");
        return;
      }

      const detailRes = await cachedFetch(
        `/api/battle-data/detail?env_uuid=${encodeURIComponent(envUuid)}&battle_index=${requestedBattleIndex}&period_tag=${encodeURIComponent(requestedPeriod)}${tableVersionQuery}`,
      );
      if (detailRes.ok) {
        const payload = (await detailRes.json()) as BattleDetailPayload;
        const indexesFromPayload = Array.isArray(payload.battle_indexes)
          ? payload.battle_indexes
              .map((v) => Number(v))
              .filter((v) => Number.isFinite(v) && v >= 0)
          : [];
        if (indexesFromPayload.length > 0) {
          setBattleIndexes(indexesFromPayload);
        } else {
          setBattleIndexes(await resolveBattleIndexesFallback());
        }
        setResolvedTableVersion(
          typeof payload.table_version === "string" && payload.table_version.trim()
            ? payload.table_version.trim()
            : effectiveTableVersion,
        );
        const detailBattle = payload.battle ?? null;
        if (detailBattle) {
          const resolvedMstShip = new Map(
            (payload.refs?.mst_ship || []).map((row) => [Number(row.id), row]),
          );
          const resolvedMstSlotItem = new Map(
            (payload.refs?.mst_slotitem || []).map((row) => [Number(row.id), row]),
          );
          const fullMstSlotItem = await getMstSlotItemById();
          const effectiveMstSlotItem = new Map(fullMstSlotItem);
          for (const [id, row] of resolvedMstSlotItem.entries()) {
            effectiveMstSlotItem.set(id, row);
          }
          setMasterDataStatus([
            {
              name: "mst_slotitem",
              status: effectiveMstSlotItem.size > 0 ? "success" : "failed",
              detail:
                effectiveMstSlotItem.size > resolvedMstSlotItem.size
                  ? `${resolvedMstSlotItem.size}件 + 補完${effectiveMstSlotItem.size - resolvedMstSlotItem.size}件`
                  : `${resolvedMstSlotItem.size}件`,
            },
            {
              name: "mst_ship",
              status: resolvedMstShip.size > 0 ? "success" : "failed",
              detail: `${resolvedMstShip.size}件`,
            },
          ]);

          await getWeaponIconFrames();

          const dropShipId =
            Number((detailBattle.battle_result as any)?.drop_ship_id ?? 0) || 0;
          const dropShip = dropShipId > 0 ? resolvedMstShip.get(dropShipId) : null;
          const mapAreaId = Number(detailBattle.maparea_id ?? NaN);
          const mapInfoNo = Number(detailBattle.mapinfo_no ?? NaN);
          const linkedCell = Array.isArray(payload.linked?.cells)
            ? payload.linked?.cells.find((row) => {
                const area = Number(row.maparea_id ?? NaN);
                const info = Number(row.mapinfo_no ?? NaN);
                return (
                  Number.isFinite(area) &&
                  Number.isFinite(info) &&
                  area > 0 &&
                  info > 0
                );
              })
            : undefined;
          const fallbackMapAreaId = Number(linkedCell?.maparea_id ?? NaN);
          const fallbackMapInfoNo = Number(linkedCell?.mapinfo_no ?? NaN);
          const resolvedMapAreaId =
            Number.isFinite(mapAreaId) && mapAreaId > 0
              ? mapAreaId
              : fallbackMapAreaId;
          const resolvedMapInfoNo =
            Number.isFinite(mapInfoNo) && mapInfoNo > 0
              ? mapInfoNo
              : fallbackMapInfoNo;

          if (disposed || loadToken !== activeLoadToken) return;
          const resolvedCellLabel = await resolveBattleCellLabel(
            detailBattle,
            resolvedMapAreaId,
            resolvedMapInfoNo,
          );
          setBattle(detailBattle);
          setFleets({
            friendlyShips: (payload.derived?.friendly_fleet || []) as any,
            enemyShips: (payload.derived?.enemy_fleet || []) as any,
          });
          setMstSlotItemById(effectiveMstSlotItem);
          setMstShipById(resolvedMstShip);
          setMapLabel(
            Number.isFinite(resolvedMapAreaId) &&
              Number.isFinite(resolvedMapInfoNo) &&
              resolvedMapAreaId > 0 &&
              resolvedMapInfoNo > 0
              ? `${resolvedMapAreaId}-${resolvedMapInfoNo}`
              : null,
          );
          setCellLabel(resolvedCellLabel);
          setDropShipInfo(
            dropShipId > 0
              ? {
                  shipId: dropShipId,
                  name: String(dropShip?.name ?? `艦#${dropShipId}`),
                  bannerUrl: bannerUrl(dropShipId, { f: "auto" }),
                }
              : null,
          );
          return;
        }
      }

      if (detailRes.status === 400) {
        setMasterDataStatus([]);
        setBattleIndexes([]);
        setError("battle_index または env_uuid が不正です");
        return;
      }

      if (detailRes.status === 404) {
        setMasterDataStatus([]);
        setBattleIndexes([]);
        setError("指定された env_uuid / battle_index の戦闘が見つかりませんでした");
        return;
      }
      throw new Error(`detail request failed: HTTP ${detailRes.status}`);
    } catch (e) {
      console.error("Failed to load battle detail:", e);
      // Battle loading failed — hide the master data alert since it's irrelevant
      // when there is no battle to display names for.
      setMasterDataStatus([]);
      setBattleIndexes([]);
      if (disposed || loadToken !== activeLoadToken) return;
      setError("戦闘データ読込中にエラーが発生しました");
    } finally {
      if (disposed || loadToken !== activeLoadToken) return;
      setLoading(false);
      setSwitchingBattleIndex(null);
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

    const onOpenSettings = () => {
      displaySettingsModalRef?.showModal();
    };
    const onShare = async () => {
      const ok = await issueShareUrl();
      window.dispatchEvent(
        new CustomEvent("battle-detail-share-status", {
          detail: ok ? "success" : "error",
        }),
      );
    };

    window.addEventListener("battle-detail-open-display-settings", onOpenSettings);
    window.addEventListener("battle-detail-share", onShare as EventListener);
    onCleanup(() => {
      window.removeEventListener(
        "battle-detail-open-display-settings",
        onOpenSettings,
      );
      window.removeEventListener("battle-detail-share", onShare as EventListener);
    });
  });

  createEffect(() => {
    if (!urlStateReady()) return;
    const envUuid = props.battleId.trim();
    const idx = Number(props.battleIndex ?? Number.NaN);
    const requestedPeriod = requestedPeriodTag();
    const tableVersion = requestedTableVersion().trim();
    if (!envUuid || !Number.isFinite(idx) || idx < 0) {
      setBattle(null);
      setError("battle_index または env_uuid が不正です");
      return;
    }

    const loadKey = `${envUuid}::${idx}::${requestedPeriod}::${tableVersion}`;
    if (loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;

    const loadToken = ++activeLoadToken;
    if (!untrack(() => battle())) {
      setLoading(true);
    }
    setError(null);
    untrack(() => {
      void loadBattle({
        envUuid,
        requestedBattleIndex: idx,
        requestedPeriod,
        tableVersion,
        loadToken,
      });
    });
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
    <div class="max-w-[1280px] mx-auto px-4 pt-2 pb-8">
      <MasterDataLoadStatusAlert items={masterDataStatus()} class="mb-3" />

      <Show when={selectableBattleIndexes().length > 1}>
        <div class="mb-3 overflow-x-auto">
          <div class="tabs tabs-boxed inline-flex flex-nowrap">
            <For each={selectableBattleIndexes()}>
              {(idx) => (
                <button
                  type="button"
                  class={`tab tab-sm ${idx === Number(props.battleIndex ?? Number.NaN) ? "tab-active" : ""}`}
                  onClick={() => {
                    if (idx === Number(props.battleIndex ?? Number.NaN)) return;
                    setSwitchingBattleIndex(idx);
                    props.onBattleIndexChange?.(idx);
                  }}
                >
                  {idx + 1}戦目
                </button>
              )}
            </For>
          </div>
          <Show when={switchingBattleIndex() !== null}>
            <span class="ml-2 text-xs text-base-content/60 inline-flex items-center gap-1.5 align-middle">
              <span class="loading loading-spinner loading-xs" />
              読込中...
            </span>
          </Show>
        </div>
      </Show>

      <Show when={showLegacyAirbaseWarning()}>
        <div class="alert alert-warning mb-3">
          <span>
            既知の制限: table_version が 0.6.0 未満のデータでは基地情報の解決に不具合があり、
            戦闘詳細の基地航空隊表示が不正確になる場合があります。
          </span>
        </div>
      </Show>

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
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div class="rounded bg-base-200 px-3 py-2">
                    <div class="text-[11px] text-base-content/55">日時</div>
                    <div class="font-semibold">{ts()}</div>
                  </div>
                  <div class="rounded bg-base-200 px-3 py-2 min-w-0">
                    <div class="text-[11px] text-base-content/55">海域</div>
                    <div class="font-semibold break-words">{mapText()}</div>
                  </div>
                  <div class="rounded bg-base-200 px-3 py-2">
                    <div class="text-[11px] text-base-content/55">セル</div>
                    <div class="font-semibold">{cellLabel()}</div>
                  </div>
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
              <Show when={airInfo()}>
                {(air) => (
                  <div class="card bg-base-100 shadow-sm">
                    <div class="card-body p-4">
                      <h3 class="font-bold text-sm text-base-content/60">制空</h3>
                      <p class={`text-lg font-bold ${air().cls}`}>{air().label}</p>
                    </div>
                  </div>
                )}
              </Show>
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
                </div>

                {/* Phase detail view */}
                <Show when={viewMode() === "phase"}>
                  <div>
                    <BattlePhaseView
                      battle={b()}
                      fleets={fleets()}
                      mstSlotItemById={mstSlotItemById()}
                      mstShipById={mstShipById()}
                      showLegacyAirbasePhaseWarning={showLegacyAirbaseWarning()}
                    />
                  </div>
                </Show>

                {/* Timeline view */}
                <Show when={viewMode() === "timeline"}>
                  <div>
                    <BattleTimelineView
                      battle={b()}
                      fleets={fleets()}
                      mstSlotItemById={mstSlotItemById()}
                      mstShipById={mstShipById()}
                      showPhaseSeparators={showPhaseSeparators()}
                      showLegacyAirbasePhaseWarning={showLegacyAirbaseWarning()}
                    />
                  </div>
                </Show>
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
