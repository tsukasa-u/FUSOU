/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal } from "solid-js";
import type { SharedDashboardState } from "../../battles/solid/types";
import { mapKeyOf, formatTimestamp } from "../../map-flow/solid/battle-map-flow/dataUtils";
import type { BattleRecord } from "../../map-flow/solid/battle-map-flow/types";
import {
  battleResultOf as battleResultOfRecord,
} from "../../map-flow/solid/battle-map-flow/recordParsers";
import { firstJsonRecordOf } from "@/features/battles/payload-guards";
import { bannerUrl } from "@/features/simulator/equip-calc";
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

  const cellDisplayLabelOf = (b: BattleRecord): string => {
    const cellId = Number(b.cell_id ?? NaN);
    if (!Number.isFinite(cellId)) return "-";
    if (cellId === 0) return "開始";
    return alphaCellLabel(cellId);
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
      list = list.filter((b) => mapKeyOf(b) === selectedMap);
    }
    const query = d.searchQuery().trim().toLowerCase();
    if (query) {
      list = list.filter((b) => {
        const result = battleResultOf(b);
        const shipName = (result?.drop_ship_name ?? "").toLowerCase();
        const mapKey = mapKeyOf(b).toLowerCase();
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

  const totalPages = createMemo(() => Math.ceil(filteredBattles().length / PAGE_SIZE));

  const pagedBattles = createMemo(() => {
    const start = currentPage() * PAGE_SIZE;
    return filteredBattles().slice(start, start + PAGE_SIZE);
  });

  function moveToDetail(battle: BattleRecord) {
    const envUuid = String(battle.env_uuid ?? "").trim();
    const battleIndex = Number(battle.index ?? Number.NaN);
    if (!envUuid || !Number.isFinite(battleIndex) || battleIndex < 0) {
      window.alert("戦闘詳細を開くために必要な env_uuid または battle_index が不足しています。");
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
                      <td>{mapKeyOf(b)}</td>
                      <td>{cellDisplayLabelOf(b)}</td>
                      <td>{FORMATION_NAMES[formation] ?? "-"}</td>
                      <td>{airSupLabel || ""}</td>
                      <td><VictoryRankBadge rank={rank} /></td>
                      <td>
                        {result?.drop_ship_id ? (
                          <div class="flex items-center gap-1 min-w-[100px]">
                            <img
                              src={bannerUrl(result.drop_ship_id)}
                              alt={result.drop_ship_name ?? "艦娘"}
                              class="h-5 w-20 object-contain rounded bg-base-300"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = "none";
                              }}
                            />
                            <span class="text-xs truncate max-w-[100px]">
                              {result.drop_ship_name ?? `#${result.drop_ship_id}`}
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
      <div class="fusou-card-body p-4 border-b border-base-300/60">
        <h3 class="font-bold text-lg">戦闘一覧</h3>
        <div class="text-xs text-base-content/60 mt-1">
          これまでの戦闘を時系列で表示します。
        </div>
      </div>

      <div class="p-0">
        <BattlesTable />
        <Show when={totalPages() > 1}>
          <div class="flex justify-center py-4 gap-2">
            <For each={Array.from({ length: Math.min(totalPages(), 10) }, (_, i) => i)}>
              {(page) => (
                <button
                  class={`btn btn-sm ${page === currentPage() ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setCurrentPage(page)}
                >
                  {page + 1}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}