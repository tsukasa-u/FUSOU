/** @jsxImportSource solid-js */
import { createSignal, createMemo, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { BattleFleets } from "@/pages/battles/lib/types";
import {
  FORMATION_NAMES,
  AIR_STATE,
  RANK_COLORS,
} from "@/pages/battles/lib/constants";
import { normalizeEpochMs, resolveBattleResult } from "@/pages/battles/lib/helpers";
import {
  fetchBattleResultByUuid,
  fetchBattleRecordsByUuid,
  fetchRecordsByField,
  getWeaponIconFrames,
  getMstSlotItemById,
  resolveMidnightHougeki,
  resolveOpeningTaisen,
  resolveHougeki,
  resolveOpeningAirAttack,
  resolveFriendlyFleet,
  resolveEnemyFleet,
} from "@/pages/battles/lib/data-service";
import { ShipRows, HPBar } from "./ui";
import BattlePhaseView from "./BattlePhaseView";
import BattleTimelineView from "./BattleTimelineView";

// ── Main orchestrator component ───────────────────────────────────────────

export default function BattleDetailPanel(props: {
  battleId: string;
}): JSX.Element {
  const [battle, setBattle] = createSignal<Record<string, unknown> | null>(null);
  const [fleets, setFleets] = createSignal<BattleFleets | null>(null);
  const [mstSlotItemById, setMstSlotItemById] = createSignal<Map<number, Record<string, unknown>> | null>(null);
  const [mapLabel, setMapLabel] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<"phase" | "timeline">("phase");

  // Derived values
  const ts = createMemo(() => {
    const b = battle();
    if (!b) return "-";
    const tsValue = normalizeEpochMs(b.timestamp) ?? normalizeEpochMs(b.midnight_timestamp);
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
    const b = battle();
    if (!b) return null;
    const dropId = (b.battle_result as any)?.drop_ship_id;
    return dropId ? `ドロップ: 艦#${dropId}` : null;
  });

  // ── Fallback HP bars (when fleet data not available) ──────────────

  const FallbackFleetHp = (fbProps: { side: "friend" | "enemy" }) => {
    const b = battle();
    if (!b) return <div class="text-sm text-base-content/40">データなし</div>;
    if (fbProps.side === "friend") {
      const fHPs = (b.f_nowhps ?? b.midnight_f_nowhps ?? []) as number[];
      return fHPs.length > 0
        ? <>{fHPs.map((hp, i) => <HPBar current={hp} max={hp} label={`${i + 1}番`} />)}</>
        : <div class="text-sm text-base-content/40">データなし</div>;
    }
    const eHPs = (b.e_nowhps ?? b.midnight_e_nowhps ?? []) as number[];
    const eMaxHPs = (b.e_hp_max ?? b.midnight_e_nowhps ?? []) as number[];
    return eHPs.length > 0
      ? <>{eHPs.map((hp, i) => <HPBar current={hp} max={eMaxHPs[i] ?? hp} label={`${i + 1}番`} />)}</>
      : <div class="text-sm text-base-content/40">データなし</div>;
  };

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
    const records = await fetchRecordsByField("cells", "battles", uuid, 50);
    const first = records.find(
      (cell) =>
        Number(cell?.maparea_id ?? 0) > 0 &&
        Number(cell?.mapinfo_no ?? 0) > 0,
    );
    if (!first) return null;
    return `${first.maparea_id}-${first.mapinfo_no}`;
  }

  async function loadBattle(): Promise<void> {
    let preloadedBattle: Record<string, unknown> | null = null;

    // Try to load from sessionStorage first (quick preview)
    const battleData = sessionStorage.getItem("battleDetail");
    if (battleData) {
      try {
        const parsed = JSON.parse(battleData);
        if (parsed) {
          preloadedBattle = parsed;
          const preloaded = {
            ...parsed,
            timestamp:
              normalizeEpochMs(parsed.timestamp) ??
              normalizeEpochMs(parsed.midnight_timestamp) ??
              null,
          };
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

      let matched: Record<string, unknown> | null = null;

      if (isLikelyUuid) {
        const latestCandidates = await fetchBattleRecordsByUuid(idText, "latest");
        const allCandidates =
          latestCandidates.length > 0
            ? latestCandidates
            : await fetchBattleRecordsByUuid(idText, "all");
        matched = chooseBattleCandidate(allCandidates, preloadedBattle);
      }

      if (!matched && Number.isFinite(fallbackIdx) && fallbackIdx >= 0) {
        const battleRes = await fetch(
          `/api/battle-data/global/records?table=battle&period_tag=all&limit_blocks=120&limit_records=20000`,
        );
        if (battleRes.ok) {
          const payload = (await battleRes.json()) as {
            records?: Array<Record<string, unknown>>;
          };
          const records = payload.records ?? [];
          matched = records[fallbackIdx] ?? null;
        }
      }

      if (matched) {
        let resolvedBattleResult: { win_rank: string; drop_ship_id: unknown } | null = null;
        if (typeof matched.battle_result === "string") {
          resolvedBattleResult = await fetchBattleResultByUuid(matched.battle_result);
        } else {
          resolvedBattleResult = resolveBattleResult(matched.battle_result, new Map());
        }

        const resolvedMidnightHougeki = await resolveMidnightHougeki(matched.midnight_hougeki);
        const resolvedOpeningTaisen = await resolveOpeningTaisen(matched.opening_taisen);
        const resolvedHougeki = await resolveHougeki(matched.hougeki);
        const resolvedOpeningAirAttack = await resolveOpeningAirAttack(matched.opening_air_attack);

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
        };

        const label = matched.uuid
          ? await fetchCellMapLabel(String(matched.uuid))
          : null;

        await getWeaponIconFrames();
        const [friendlyShips, enemyShips] = await Promise.all([
          resolveFriendlyFleet(merged),
          resolveEnemyFleet(merged),
        ]);
        const resolvedFleets: BattleFleets = { friendlyShips, enemyShips };
        const resolvedMst = await getMstSlotItemById();

        setBattle(merged);
        setFleets(resolvedFleets);
        setMstSlotItemById(resolvedMst);
        setMapLabel(label);
      } else if (!preloadedBattle) {
        setError("指定された戦闘データが見つかりませんでした");
      }
    } catch (e) {
      console.error("Failed to load battle detail:", e);
      setError("戦闘データ読込中にエラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    void loadBattle();
  });

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div class="max-w-[1440px] mx-auto px-4 py-8">
      {/* Back link */}
      <div class="mb-4">
        <a href="/battles" class="btn btn-ghost btn-sm gap-1">
          ← 戦闘一覧に戻る
        </a>
      </div>

      {/* Error banner */}
      <Show when={error()}>
        <div class="card bg-base-100 shadow-sm mb-6">
          <div class="card-body">
            <h2 class="card-title">戦闘詳細</h2>
            <span class={error()!.includes("エラー") ? "text-error" : "text-warning"}>
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
                  <span>日時: <strong>{ts()}</strong></span>
                  <span>海域: <strong>{mapText()}</strong></span>
                  <span>セル: <strong>{String(b().cell_id ?? "-")}</strong></span>
                  <span>デッキ: <strong>{String(b().deck_id ?? "-")}</strong></span>
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
                  <h3 class="font-bold text-sm text-base-content/60">制空状態</h3>
                  <p class={`text-lg font-bold ${airInfo().cls}`}>{airInfo().label}</p>
                </div>
              </div>
              <div class="card bg-base-100 shadow-sm">
                <div class="card-body p-4">
                  <h3 class="font-bold text-sm text-base-content/60">戦闘結果</h3>
                  <p class={`text-2xl font-bold ${rankCls()}`}>{rank()}</p>
                  <Show when={dropInfo()}>
                    <p class="text-sm">{dropInfo()}</p>
                  </Show>
                </div>
              </div>
            </div>

            {/* HP Gauges */}
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div class="card bg-base-100 shadow-sm">
                <div class="card-body p-4">
                  <h3 class="font-bold text-sm text-base-content/60 mb-2">味方艦隊</h3>
                  <div class="space-y-2">
                    <Show
                      when={fleets()?.friendlyShips?.length}
                      fallback={<FallbackFleetHp side="friend" />}
                    >
                      <ShipRows ships={fleets()!.friendlyShips} sideLabel="味方" />
                    </Show>
                  </div>
                </div>
              </div>
              <div class="card bg-base-100 shadow-sm">
                <div class="card-body p-4">
                  <h3 class="font-bold text-sm text-base-content/60 mb-2">敵艦隊</h3>
                  <div class="space-y-2">
                    <Show
                      when={fleets()?.enemyShips?.length}
                      fallback={<FallbackFleetHp side="enemy" />}
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
                <div class="flex items-center justify-between gap-4 mb-4">
                  <h3 class="card-title text-lg">戦闘フェーズ</h3>
                  <div class="join">
                    <button
                      class={`join-item btn btn-sm ${viewMode() === "phase" ? "btn-active" : ""}`}
                      onClick={() => setViewMode("phase")}
                    >
                      フェーズ
                    </button>
                    <button
                      class={`join-item btn btn-sm ${viewMode() === "timeline" ? "btn-active" : ""}`}
                      onClick={() => setViewMode("timeline")}
                    >
                      タイムライン
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
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </Show>

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
