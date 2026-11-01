/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal, createEffect } from "solid-js";
import type { SharedDashboardState } from "../../battles/solid/types";
import { mapKeyOf, formatTimestamp, isWithinDateRange, compareNullableTimestamps } from "../../map-flow/solid/battle-map-flow/dataUtils";
import { ensureMapLabels, resolveMapCellLabel } from "../../map-flow/solid/battle-map-flow/mapLabelCache";
import type { BattleRecord } from "../../map-flow/solid/battle-map-flow/types";
import {
  battleResultOf as battleResultOfRecord,
} from "../../map-flow/solid/battle-map-flow/recordParsers";
import { firstJsonRecordOf } from "@/features/battles/payload-guards";
import { bannerUrl } from "@/features/simulator/equip-calc";
import { ShipBanner } from "@/components/common/solid/ShipBanner";
import { VictoryRankBadge } from "@/components/common/solid/VictoryRankBadge";
import { EmptyState } from "@/components/common/solid/EmptyState";
import { LoadingState } from "@/components/common/solid/LoadingState";

const FORMATION_NAMES: Record<number, string> = {
  1: "単縦陣",
  2: "複縦陣",
  3: "輪形陣",
  4: "梯形陣",
  5: "単横陣",
  6: "警戒陣",
  11: "第一警戒航行序列",
  12: "第二警戒航行序列",
  13: "第三警戒航行序列",
  14: "第四警戒航行序列",
};

const AIR_SUPERIORITY_NAMES: Record<number, string> = {
  0: "制空拮抗",
  1: "制空権確保",
  2: "航空優勢",
  3: "航空劣勢",
  4: "制空権喪失",
};

function airSuperiorityLabelOf(battle: BattleRecord): string {
  const openingAir = firstJsonRecordOf(battle.opening_air_attack);
  if (!openingAir) return "";

  const fDamages = Array.isArray(openingAir["f_damages"])
    ? openingAir["f_damages"]
    : [];
  const eDamages = Array.isArray(openingAir["e_damages"])
    ? openingAir["e_damages"]
    : [];
  const hasAnyAirDamage =
    fDamages.some((v) => Number(v) > 0) || eDamages.some((v) => Number(v) > 0);
  const hasAnyAirSortie =
    (Array.isArray(openingAir["f_plane_from"]) && openingAir["f_plane_from"].length > 0) ||
    (Array.isArray(openingAir["e_plane_from"]) && openingAir["e_plane_from"].length > 0);
  if (!hasAnyAirDamage && !hasAnyAirSortie) {
    return "";
  }

  const airSup = Number(openingAir["air_superiority"]);
  if (!Number.isFinite(airSup)) {
    return "";
  }

  return AIR_SUPERIORITY_NAMES[airSup] ?? "";
}



const PAGE_SIZE = 50;

function battleResultOf(b: BattleRecord) {
  return battleResultOfRecord(b);
}

export default function BattlesListPanel(props: { dashboardState: SharedDashboardState }) {
  const d = props.dashboardState;
  const [currentPage, setCurrentPage] = createSignal(0);
  const [sortOrder, setSortOrder] = createSignal<"desc" | "asc">("desc");

  const mstShipNameMap = createMemo(() => {
    const map = new Map<number, string>();
    for (const ship of d.mstShips()) {
      map.set(ship.id, ship.name);
    }
    return map;
  });



  const mapKeyLookup = createMemo(() => {
    const b2m = new Map<string, string>();
    const e2m = new Map<string, string>();
    for (const c of d.cellRecords()) {
      const mk = mapKeyOf(c);
      if (mk === "unknown" || mk === "-") continue;
      if (c.env_uuid) {
        e2m.set(c.env_uuid, mk);
      }
      if (c.battles) {
        if (Array.isArray(c.battles)) {
          c.battles.forEach((u: string) => b2m.set(u, mk));
        } else if (typeof c.battles === "string") {
          b2m.set(c.battles, mk);
        }
      }
    }
    return { battleToMap: b2m, envToMap: e2m };
  });

  const resolveBattleMapKey = (b: BattleRecord): string => {
    const direct = mapKeyOf(b);
    if (direct && direct !== "unknown" && direct !== "-") return direct;
    const { battleToMap, envToMap } = mapKeyLookup();
    const byBattle = b.uuid ? battleToMap.get(b.uuid) : undefined;
    if (byBattle) return byBattle;
    const byEnv = b.env_uuid ? envToMap.get(b.env_uuid) : undefined;
    if (byEnv) return byEnv;
    return "unknown";
  };

  const cellDisplayLabelOf = (b: BattleRecord): string => {
    const cellId = Number(b.cell_id ?? NaN);
    if (!Number.isFinite(cellId)) return "-";
    const mapKey = resolveBattleMapKey(b);
    return resolveMapCellLabel(mapKey, cellId);
  };

  const resultFilteredBattles = createMemo(() => {
    let list = d.battleRecords();
    if (d.resultFilter()) {
      list = list.filter((b) => battleResultOf(b)?.win_rank === d.resultFilter());
    }
    return list;
  });

  const filteredBattles = createMemo(() => {
    let list = resultFilteredBattles();
    const selectedMap = d.mapFilter();
    if (selectedMap) {
      list = list.filter((b) => resolveBattleMapKey(b) === selectedMap);
    }
    const start = d.startDate().trim();
    const end = d.endDate().trim();
    if (start || end) {
      list = list.filter((b) => isWithinDateRange(b.timestamp, start, end));
    }
    const query = d.searchQuery().trim().toLowerCase();
    if (query) {
      const mstMap = mstShipNameMap();
      list = list.filter((b) => {
        const result = battleResultOf(b);
        let shipName = (result?.drop_ship_name ?? "").toLowerCase();
        if (!shipName && result?.drop_ship_id && mstMap.has(result.drop_ship_id)) {
          shipName = (mstMap.get(result.drop_ship_id) ?? "").toLowerCase();
        }
        const mapKey = resolveBattleMapKey(b).toLowerCase();
        const cellLabel = cellDisplayLabelOf(b).toLowerCase();
        return (
          shipName.includes(query) ||
          mapKey.includes(query) ||
          cellLabel.includes(query)
        );
      });
    }
    return list;
  });

  const sortedBattles = createMemo(() => {
    const list = [...filteredBattles()];
    const order = sortOrder();
    list.sort((a, b) => compareNullableTimestamps(a.timestamp, b.timestamp, order));
    return list;
  });

  const totalPages = createMemo(() => Math.ceil(sortedBattles().length / PAGE_SIZE));

  createEffect(() => {
    // 検索・フィルター条件が変化したときは先頭ページに戻す
    d.searchQuery();
    d.mapFilter();
    d.resultFilter();
    d.startDate();
    d.endDate();
    setCurrentPage(0);
  });

  createEffect(() => {
    const pages = totalPages();
    if (pages > 0 && currentPage() >= pages) {
      setCurrentPage(pages - 1);
    }
  });

  const pagedBattles = createMemo(() => {
    const start = currentPage() * PAGE_SIZE;
    return sortedBattles().slice(start, start + PAGE_SIZE);
  });

  createEffect(() => {
    const selected = d.mapFilter();
    if (selected && selected !== "unknown") {
      void ensureMapLabels(selected);
    }
    const mapKeys = new Set<string>();
    for (const b of pagedBattles()) {
      const mk = resolveBattleMapKey(b);
      if (mk && mk !== "unknown") {
        mapKeys.add(mk);
      }
    }
    for (const mk of mapKeys) {
      void ensureMapLabels(mk);
    }
  });

  function moveToDetail(battle: BattleRecord) {
    const envUuid = String(battle.env_uuid ?? "").trim();
    const rawIndex = Number(battle.index ?? (battle as Record<string, unknown>)["battle_index"] ?? Number.NaN);
    const battleIndex = Number.isFinite(rawIndex) && rawIndex >= 0 ? rawIndex : 0;
    if (!envUuid) {
      window.alert("戦闘詳細を開くために必要な env_uuid が不足しています。");
      return;
    }
    try {
      sessionStorage.setItem("battleDetail", JSON.stringify(battle));
    } catch {}
    const detailId = envUuid;
    d.setSelectedDetailId(detailId);
    d.setSelectedBattleIndex(battleIndex);
    d.setActiveTab("detail");
  }

  const BattlesTable = () => (
    <div class="overflow-x-auto">
      <table class="table table-sm table-zebra w-full">
        <thead>
          <tr>
            <th>日時</th>
            <th>海域</th>
            <th>マス</th>
            <th>陣形</th>
            <th>制空</th>
            <th>勝敗</th>
            <th>ドロップ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <Show
            when={!d.loading()}
            fallback={<tr><td colspan={8}><LoadingState message="戦闘一覧を読込中..." size="md" /></td></tr>}
          >
            <Show
              when={pagedBattles().length > 0}
              fallback={<tr><td colspan={8}><EmptyState message="戦闘データがありません" hint="条件を変更して再検索してください" /></td></tr>}
            >
              <For each={pagedBattles()}>
                {(b) => {
                  const result = battleResultOf(b);
                  const rank = result?.win_rank ?? "-";
                  const formation = b.f_formation ?? 0;
                  const airSupLabel = airSuperiorityLabelOf(b);

                  return (
                    <tr class="hover cursor-pointer" onClick={() => moveToDetail(b)}>
                      <td class="whitespace-nowrap">{formatTimestamp(b.timestamp)}</td>
                      <td>{resolveBattleMapKey(b)}</td>
                      <td>{cellDisplayLabelOf(b)}</td>
                      <td>{FORMATION_NAMES[formation] ?? "-"}</td>
                      <td>{airSupLabel || ""}</td>
                      <td><VictoryRankBadge rank={rank} /></td>
                      <td>
                        {result?.drop_ship_id ? (
                          <div class="flex items-center gap-1 min-w-[100px]">
                            <ShipBanner
                                src={bannerUrl(result.drop_ship_id)}
                                alt={result.drop_ship_name ?? "艦"}
                                class="h-5 w-20"
                              />
                            <span class="text-xs truncate max-w-[100px]">
                              {result.drop_ship_name ?? (result.drop_ship_id ? mstShipNameMap().get(result.drop_ship_id) : undefined) ?? `#${result.drop_ship_id}`}
                            </span>
                          </div>
                        ) : "-"}
                      </td>
                      <td>
                        <button class="fusou-btn-xs-ghost" onClick={(e) => {
                          e.stopPropagation();
                          moveToDetail(b);
                        }}>詳細</button>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </Show>
          </Show>
        </tbody>
      </table>
    </div>
  );

  return (
    <div class="fusou-card">
      <div class="fusou-card-body p-4 border-b border-base-300/60 flex flex-row items-center justify-between gap-4">
        <div>
          <h3 class="font-bold text-lg">戦闘一覧</h3>
          <div class="text-xs text-base-content/60 mt-1">
            これまでの戦闘を時系列で表示します。
          </div>
        </div>
        <div>
          <button
            type="button"
            class="btn btn-xs btn-ghost border border-base-300 font-normal"
            onClick={() => {
              setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
              setCurrentPage(0);
            }}
            title={sortOrder() === "desc" ? "クリックで古い順に切り替え" : "クリックで新しい順に切り替え"}
          >
            {sortOrder() === "desc" ? "新しい順 ↓" : "古い順 ↑"}
          </button>
        </div>
      </div>

      <div class="p-0">
        <BattlesTable />
        <Show when={totalPages() > 1}>
          <div class="flex flex-wrap items-center justify-center py-4 gap-1">
            <button
              class="btn btn-sm btn-ghost"
              disabled={currentPage() === 0}
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            >
              前へ
            </button>
            <For each={(() => {
              const total = totalPages();
              const cur = currentPage();
              const start = Math.max(0, Math.min(cur - 2, total - 5));
              const end = Math.min(total, Math.max(cur + 3, 5));
              return Array.from({ length: Math.max(1, end - start) }, (_, idx) => start + idx).filter((p) => p < total);
            })()}>
              {(page) => (
                <button
                  class={`btn btn-sm ${page === currentPage() ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setCurrentPage(page)}
                >
                  {page + 1}
                </button>
              )}
            </For>
            <button
              class="btn btn-sm btn-ghost"
              disabled={currentPage() >= totalPages() - 1}
              onClick={() => setCurrentPage((p) => Math.min(totalPages() - 1, p + 1))}
            >
              次へ
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}