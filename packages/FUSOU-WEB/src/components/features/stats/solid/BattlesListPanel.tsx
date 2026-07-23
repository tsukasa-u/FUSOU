/** @jsxImportSource solid-js */
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { SharedDashboardState } from "../../battles/solid/types";
import { mapKeyOf, formatTimestamp } from "../../map-flow/solid/battle-map-flow/dataUtils";
import { bannerUrl } from "@/features/simulator/equip-calc";

const WIN_RANK_BADGES: Record<string, string> = {
  S: "badge-success",
  A: "badge-info",
  B: "badge-warning",
  C: "badge-error",
  D: "badge-error",
  E: "badge-error",
};

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

function airSuperiorityLabelOf(battle: any): string {
  const openingAir = Array.isArray(battle?.opening_air_attack)
    ? battle.opening_air_attack[0]
    : battle?.opening_air_attack;
  if (!openingAir || typeof openingAir !== "object") {
    return "";
  }

  const fDamages = Array.isArray(openingAir.f_damages)
    ? openingAir.f_damages
    : [];
  const eDamages = Array.isArray(openingAir.e_damages)
    ? openingAir.e_damages
    : [];
  const hasAnyAirDamage =
    fDamages.some((d: unknown) => (Number(d ?? 0) || 0) > 0) ||
    eDamages.some((d: unknown) => (Number(d ?? 0) || 0) > 0);
  const hasAnyAirSortie =
    (Array.isArray(openingAir.f_plane_from) && openingAir.f_plane_from.length > 0) ||
    (Array.isArray(openingAir.e_plane_from) && openingAir.e_plane_from.length > 0);
  if (!hasAnyAirDamage && !hasAnyAirSortie) {
    return "";
  }

  const airSup = Number(openingAir.air_superiority);
  if (!Number.isFinite(airSup)) {
    return "";
  }
  return AIR_SUPERIORITY_NAMES[airSup] ?? "";
}

const PAGE_SIZE = 50;

function battleResultOf(b: any): { win_rank: string; drop_ship_id: number | null; drop_ship_name?: string | null } | null {
  if (!b.battle_result || typeof b.battle_result !== "object") return null;
  return b.battle_result;
}

export default function BattlesListPanel(props: { dashboardState: SharedDashboardState }) {
  const d = props.dashboardState;
  const [currentPage, setCurrentPage] = createSignal(0);
  const [viewMode, setViewMode] = createSignal<"list" | "map">("list");

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

  const cellDisplayLabelOf = (b: any): string => {
    const cellId = Number(b.cell_id ?? NaN);
    if (!Number.isFinite(cellId)) return "-";
    if (cellId === 0) return "港";
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
    if (viewMode() === "list") {
      return resultFilteredBattles();
    }
    const selectedMap = d.mapFilter();
    if (!selectedMap) return [];
    return resultFilteredBattles().filter((b) => mapKeyOf(b) === selectedMap);
  });

  const mapOverview = createMemo(() => {
    const mapStats = new Map<string, number>();
    for (const battle of resultFilteredBattles()) {
      const mapKey = mapKeyOf(battle);
      if (!mapKey || mapKey === "-") continue;
      mapStats.set(mapKey, (mapStats.get(mapKey) ?? 0) + 1);
    }

    const grouped = new Map<
      string,
      { areaId: string; maps: Array<{ mapKey: string; count: number }>; total: number }
    >();
    for (const [mapKey, count] of mapStats.entries()) {
      const areaId = mapKey.split("-")[0] || "?";
      if (!grouped.has(areaId)) {
        grouped.set(areaId, { areaId, maps: [], total: 0 });
      }
      const group = grouped.get(areaId)!;
      group.maps.push({ mapKey, count });
      group.total += count;
    }

    const groups = [...grouped.values()].sort(
      (a, b) => Number(a.areaId) - Number(b.areaId),
    );
    for (const group of groups) {
      group.maps.sort((a, b) => {
        const [, aNo] = a.mapKey.split("-").map(Number);
        const [, bNo] = b.mapKey.split("-").map(Number);
        return (aNo || 0) - (bNo || 0);
      });
    }
    return groups;
  });

  const totalPages = createMemo(() => Math.ceil(filteredBattles().length / PAGE_SIZE));

  const pagedBattles = createMemo(() => {
    const start = currentPage() * PAGE_SIZE;
    return filteredBattles().slice(start, start + PAGE_SIZE);
  });

  createEffect(() => {
    filteredBattles();
    setCurrentPage(0);
  });

  function moveToDetail(battle: any, fallbackIndex: number) {
    try {
      sessionStorage.setItem("battleDetail", JSON.stringify(battle));
    } catch {}
    const detailId = battle.uuid || battle.env_uuid || String(fallbackIndex);
    d.setSelectedDetailId(detailId);
    d.setActiveTab("detail");
  }

  const BattlesTable = () => (
    <div class="overflow-x-auto">
      <table class="table table-zebra table-sm">
        <thead>
          <tr>
            <th>日時</th>
            <th>マップ</th>
            <th>セル</th>
            <th>陣形</th>
            <th>制空</th>
            <th>結果</th>
            <th>ドロップ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <Show
            when={!d.loading()}
            fallback={<tr><td colspan={8} class="text-center py-12"><span class="loading loading-spinner loading-md"></span></td></tr>}
          >
            <Show
              when={pagedBattles().length > 0}
              fallback={<tr><td colspan={8} class="text-center py-12 text-base-content/40">データがありません</td></tr>}
            >
              <For each={pagedBattles()}>
                {(b, i) => {
                  const result = battleResultOf(b);
                  const rank = result?.win_rank ?? "-";
                  const formation = b.f_formation ?? 0;
                  const airSupLabel = airSuperiorityLabelOf(b);
                  const fallbackIdx = currentPage() * PAGE_SIZE + i();

                  return (
                    <tr class="hover cursor-pointer" onClick={() => moveToDetail(b, fallbackIdx)}>
                      <td class="whitespace-nowrap">{formatTimestamp(b.timestamp)}</td>
                      <td>{mapKeyOf(b)}</td>
                      <td>{cellDisplayLabelOf(b)}</td>
                      <td>{FORMATION_NAMES[formation] ?? "-"}</td>
                      <td>{airSupLabel || ""}</td>
                      <td><span class={`badge badge-sm ${WIN_RANK_BADGES[rank] ?? ""}`}>{rank}</span></td>
                      <td>
                        {result?.drop_ship_id ? (
                          <div class="flex items-center gap-1 min-w-[100px]">
                            <img
                              src={bannerUrl(result.drop_ship_id, { f: "auto" })}
                              alt={result.drop_ship_name ?? `#${result.drop_ship_id}`}
                              class="h-5 w-20 object-cover rounded-sm"
                              loading="lazy"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                            <span class="text-xs truncate max-w-24">
                              {result.drop_ship_name ?? `#${result.drop_ship_id}`}
                            </span>
                          </div>
                        ) : "-"}
                      </td>
                      <td>
                        <button class="btn btn-ghost btn-xs" onClick={(e) => {
                          e.stopPropagation();
                          moveToDetail(b, fallbackIdx);
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
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 border-b border-base-200">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-bold text-lg">戦闘一覧</h3>
            <div class="text-xs text-base-content/60 mt-1">
              {viewMode() === "list" ? "これまでの一覧を時系列で表示します。" : "海域を選択して一覧を絞り込みます。"}
            </div>
          </div>
          <div
            class="relative flex items-center bg-base-200 rounded-md p-1 cursor-pointer select-none w-64 shadow-inner"
            onClick={() => {
              const next = viewMode() === "list" ? "map" : "list";
              setViewMode(next);
              if (next === "list") d.setMapFilter("");
            }}
          >
            <div
              class="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-primary rounded-md transition-transform duration-300 ease-in-out"
              style={{ transform: viewMode() === "list" ? "translateX(0)" : "translateX(100%)" }}
            />
            <div class={`relative z-10 flex-1 text-center text-sm px-2 py-1.5 transition-colors duration-300 ${viewMode() === "list" ? "font-bold text-primary-content" : "text-base-content/60 hover:text-primary-content"}`}>
              一覧表示
            </div>
            <div class={`relative z-10 flex-1 text-center text-sm px-2 py-1.5 transition-colors duration-300 ${viewMode() === "map" ? "font-bold text-primary-content" : "text-base-content/60 hover:text-primary-content"}`}>
              海域から絞る
            </div>
          </div>
        </div>
      </div>

      <Show when={viewMode() === "map" && !d.mapFilter()}>
        <div class="card-body space-y-6">
          <Show when={mapOverview().length > 0} fallback={<div class="py-10 text-center text-base-content/50">一覧データがありません</div>}>
            <For each={mapOverview()}>
              {(area) => (
                <div>
                  <h4 class="font-bold text-sm text-base-content/80 mb-3 border-b border-base-200 pb-1 flex justify-between">
                    <span>{area.areaId} 海域</span>
                    <span class="font-mono text-xs text-base-content/60">計 {area.total} 件</span>
                  </h4>
                  <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    <For each={area.maps}>
                      {(mapInfo) => (
                        <button
                          class="btn btn-outline h-auto py-2 flex flex-col items-center gap-1 hover:bg-base-200 hover:text-base-content hover:border-base-300"
                          onClick={() => d.setMapFilter(mapInfo.mapKey)}
                        >
                          <div class="flex items-center gap-2">
                            <span class="font-bold text-base">{mapInfo.mapKey}</span>
                            <span class="badge badge-accent badge-sm font-mono">{mapInfo.count}</span>
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>

      <Show when={viewMode() === "list" || !!d.mapFilter()}>
        <div class="card-body p-0">
          <Show when={viewMode() === "map" && d.mapFilter()}>
            <div class="px-4 pt-4">
              <button class="btn btn-secondary btn-xs" onClick={() => d.setMapFilter("")}>選択解除: {d.mapFilter()}</button>
            </div>
          </Show>
          <BattlesTable />
          <Show when={totalPages() > 1}>
            <div class="flex justify-center py-4 gap-2">
              <For each={Array.from({ length: Math.min(totalPages(), 10) }, (_, i) => i)}>
                {(page) => (
                  <button
                    class={`btn btn-sm ${page === currentPage() ? "btn-active" : ""}`}
                    onClick={() => setCurrentPage(page)}
                  >
                    {page + 1}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
