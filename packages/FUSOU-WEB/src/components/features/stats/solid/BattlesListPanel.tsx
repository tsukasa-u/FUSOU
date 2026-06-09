/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal } from "solid-js";
import type { SharedDashboardState } from "../../battles/solid/types";
import { mapKeyOf, formatTimestamp } from "../../map-flow/solid/battle-map-flow/dataUtils";

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
  0: "航空均衡",
  1: "制空権確保",
  2: "航空優勢",
  3: "航空劣勢",
  4: "制空権喪失",
};

const PAGE_SIZE = 50;

function battleResultOf(b: any): { win_rank: string; drop_ship_id: number | null } | null {
  if (!b.battle_result || typeof b.battle_result !== "object") return null;
  return b.battle_result;
}

export default function BattlesListPanel(props: { dashboardState: SharedDashboardState }) {
  const d = props.dashboardState;
  const [currentPage, setCurrentPage] = createSignal(0);

  const masterShipNameById = createMemo(() => {
    return new Map(d.mstShips().map((s) => [s.id, s.name]));
  });

  const enemyDeckNameById = createMemo(() => {
    const deckById = new Map(d.enemyDecks().map((deck) => [deck.uuid, deck]));
    const shipsByGroupId = new Map<string, any[]>();
    for (const ship of d.enemyShips()) {
      const group = shipsByGroupId.get(ship.uuid);
      if (group) group.push(ship);
      else shipsByGroupId.set(ship.uuid, [ship]);
    }
    for (const group of shipsByGroupId.values()) {
      group.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
    }
    
    const names = new Map<string, string>();
    for (const battle of d.battleRecords()) {
      if (!battle.e_deck_id || names.has(battle.e_deck_id)) continue;
      const deck = deckById.get(battle.e_deck_id);
      if (!deck?.ship_ids) {
        names.set(battle.e_deck_id, `敵艦隊 ${battle.e_deck_id.slice(0, 8)}`);
        continue;
      }
      
      let shipIds: string[] = [];
      if (Array.isArray(deck.ship_ids)) {
        shipIds = deck.ship_ids.filter((id: any) => typeof id === "string" && id.length > 0);
      } else if (typeof deck.ship_ids === "string" && deck.ship_ids.length > 0) {
        shipIds = [deck.ship_ids];
      }
      
      const n: string[] = [];
      for (const groupId of shipIds) {
        const ships = shipsByGroupId.get(groupId) || [];
        for (const ship of ships) {
          const id = ship.mst_ship_id;
          if (id) n.push(masterShipNameById().get(id) ?? `艦ID:${id}`);
        }
      }
      const uniq = [...new Set(n)];
      if (uniq.length === 0) names.set(battle.e_deck_id, `敵艦隊 ${battle.e_deck_id.slice(0, 8)}`);
      else {
        const head = uniq.slice(0, 3).join(" / ");
        names.set(battle.e_deck_id, uniq.length > 3 ? `${head} +${uniq.length - 3}` : head);
      }
    }
    return names;
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

  const cellDisplayLabelOf = (b: any): string => {
    const cellId = Number(b.cell_id ?? NaN);
    if (!Number.isFinite(cellId)) return "-";
    if (cellId === 0) return "港";
    return alphaCellLabel(cellId); // Note: Simplified for SPA to avoid async labels for now, or we can add it to dashboard.
  };

  const mapOptions = createMemo(() => {
    const values = new Set<string>();
    for (const b of d.battleRecords()) {
      const label = mapKeyOf(b);
      if (label !== "-") values.add(label);
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ja"));
  });

  const filteredBattles = createMemo(() => {
    let list = d.battleRecords();
    if (d.resultFilter()) {
      list = list.filter((b) => battleResultOf(b)?.win_rank === d.resultFilter());
    }
    if (d.mapFilter()) {
      list = list.filter((b) => mapKeyOf(b) === d.mapFilter());
    }
    return list;
  });

  const totalPages = createMemo(() => Math.ceil(filteredBattles().length / PAGE_SIZE));

  const pagedBattles = createMemo(() => {
    const start = currentPage() * PAGE_SIZE;
    return filteredBattles().slice(start, start + PAGE_SIZE);
  });

  const recentSummary = createMemo(() => {
    return [...d.battleRecords()]
      .filter((b) => !!b.timestamp)
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, 25);
  });

  function moveToDetail(battle: any, fallbackIndex: number) {
    try {
      sessionStorage.setItem("battleDetail", JSON.stringify(battle));
    } catch {}
    const detailId = battle.uuid || battle.env_uuid || String(fallbackIndex);
    d.setSelectedDetailId(detailId);
    d.setActiveTab("detail");
  }

  return (
    <>
      <div class="card bg-base-100 shadow-sm mb-6">
        <div class="card-body p-4">
          <h3 class="font-bold">直近の進軍ルート（サマリ）</h3>
          <div class="text-sm text-base-content/70">
            <Show when={recentSummary().length > 0} fallback={<span>読込後に最新の進軍順路と交戦結果を表示します。</span>}>
              <For each={recentSummary()}>
                {(b) => {
                  const rank = battleResultOf(b)?.win_rank ?? "-";
                  return (
                    <div class="py-1 border-b border-base-200">
                      <span class="font-mono text-xs mr-2">{formatTimestamp(b.timestamp)}</span>
                      <span class="badge badge-ghost badge-sm mr-2">{mapKeyOf(b)}</span>
                      <span class="mr-2">{cellDisplayLabelOf(b)}</span>
                      <span class="mr-2">
                        {b.e_deck_id ? (enemyDeckNameById().get(b.e_deck_id) ?? `敵艦隊 ${b.e_deck_id.slice(0, 8)}`) : "-"}
                      </span>
                      <span class={`badge badge-sm ${WIN_RANK_BADGES[rank] ?? ""}`}>{rank}</span>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-0">
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
                        const airSup = b.opening_air_attack?.[0]?.air_superiority;
                        const fallbackIdx = currentPage() * PAGE_SIZE + i();
                        
                        return (
                          <tr class="hover cursor-pointer" onClick={() => moveToDetail(b, fallbackIdx)}>
                            <td class="whitespace-nowrap">{formatTimestamp(b.timestamp)}</td>
                            <td>{mapKeyOf(b)}</td>
                            <td>{cellDisplayLabelOf(b)}</td>
                            <td>{FORMATION_NAMES[formation] ?? "-"}</td>
                            <td>{airSup != null ? (AIR_SUPERIORITY_NAMES[airSup] ?? String(airSup)) : "-"}</td>
                            <td><span class={`badge badge-sm ${WIN_RANK_BADGES[rank] ?? ""}`}>{rank}</span></td>
                            <td>
                              {result?.drop_ship_id ? (
                                <div class="flex items-center gap-1 min-w-[100px]">
                                  <img
                                    src={`/api/asset-sync/ship-banner/${result.drop_ship_id}`}
                                    alt={masterShipNameById().get(result.drop_ship_id) ?? `#${result.drop_ship_id}`}
                                    class="h-5 w-20 object-cover rounded-sm"
                                    loading="lazy"
                                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                  />
                                  <span class="text-xs truncate max-w-24">
                                    {masterShipNameById().get(result.drop_ship_id) ?? `#${result.drop_ship_id}`}
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
      </div>
    </>
  );
}
