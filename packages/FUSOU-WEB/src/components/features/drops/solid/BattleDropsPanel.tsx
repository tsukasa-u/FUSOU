/** @jsxImportSource solid-js */
import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import type { SharedDashboardState } from "../../battles/solid/types";
import { getBattleMapAsset, resolveBattleMapSpriteUrl, type BattleMapTheme } from "@/data/battleMapAssets";
import { mapKeyOf, cellLabel as pureCellLabel } from "../../map-flow/solid/battle-map-flow/dataUtils";
import { ShipBanner } from "../../battle-detail/solid/ui";
import { STYPE_NAMES } from "@/features/simulator/constants";
import TrustTagFilter, {
  matchesTrustFilter,
  type TrustFilterValue,
} from "@/components/common/solid/TrustTagFilter";

type MapSpot = { cellId: number; x: number; y: number };

import { ShipDropCard } from "./ShipDropCard";


export default function BattleDropsPanel(props: { dashboardState: SharedDashboardState }) {
  const d = props.dashboardState;
  const [trustFilter, setTrustFilter] = createSignal<TrustFilterValue>("all");

  const [mapSpots, setMapSpots] = createSignal<MapSpot[]>([]);
  const [mapLabels, setMapLabels] = createSignal<Record<number, string>>({});
  const [selectedCellId, setSelectedCellId] = createSignal<number | null>(null);

  const [mstMapareas, setMstMapareas] = createSignal<any[]>([]);
  const [mstMapinfos, setMstMapinfos] = createSignal<any[]>([]);

  createEffect(() => {
    fetch("/api/master-data/json?table_name=mst_map_area")
      .then(res => res.json())
      .then((payload: any) => setMstMapareas(payload.records || []))
      .catch(() => {});
    fetch("/api/master-data/json?table_name=mst_map_info")
      .then(res => res.json())
      .then((payload: any) => setMstMapinfos(payload.records || []))
      .catch(() => {});
  });

  const getAreaName = (areaIdStr: string) => {
    const fromApi = mstMapareas().find(m => String(m.id) === areaIdStr);
    if (fromApi?.name) return fromApi.name;
    const map = {
      "1": "鎮守府海域", "2": "南西諸島海域", "3": "北方海域", "4": "西方海域",
      "5": "南方海域", "6": "中部海域", "7": "南西海域",
    };
    return (map as any)[areaIdStr] || `第${areaIdStr}海域`;
  };

  const getMapInfoName = (mapKey: string) => {
    const [area, no] = mapKey.split("-");
    const fromApi = mstMapinfos().find(m => String(m.maparea_id) === area && String(m.no) === no);
    if (fromApi?.name) return fromApi.name;
    const map = {
      "1-1": "鎮守府正面海域", "1-2": "南西諸島沖", "1-3": "製油所地帯沿岸", "1-4": "南西諸島防衛線", "1-5": "鎮守府近海", "1-6": "鎮守府近海航路",
      "2-1": "南西諸島近海", "2-2": "バシー海峡", "2-3": "東部オリョール海", "2-4": "沖ノ島海域", "2-5": "沖ノ島沖",
      "3-1": "モーレイ海", "3-2": "キス島沖", "3-3": "アルフォンシーノ方面", "3-4": "北方海域全域", "3-5": "北方AL海域",
      "4-1": "ジャム島攻略作戦", "4-2": "カレー洋制圧戦", "4-3": "リランカ島空襲", "4-4": "カスガダマ沖海戦", "4-5": "カレー洋リランカ島沖",
      "5-1": "南方海域前面", "5-2": "珊瑚諸島沖", "5-3": "サブ島沖海域", "5-4": "サーモン海域", "5-5": "サーモン海域北方",
      "6-1": "中部海域哨戒線", "6-2": "MS諸島沖", "6-3": "グアノ環礁沖海域", "6-4": "中部北太平洋海域", "6-5": "KW環礁沖海域",
      "7-1": "ブルネイ泊地沖", "7-2": "タウイタウイ泊地沖", "7-3": "ペナン島沖", "7-4": "昭南本土航路"
    };
    return (map as any)[mapKey] || "";
  };

  createEffect(() => {
    // Reset selection when map changes
    setSelectedCellId(null);
    const mapKey = d.mapFilter();
    if (!mapKey) {
      setMapSpots([]);
      setMapLabels({});
      return;
    }
    const asset = getBattleMapAsset(mapKey);
    if (!asset) return;

    fetch(asset.infoUrl)
      .then((res) => res.json())
      .then((payload: any) => {
        const spots = (payload.spots || [])
          .map((s: any) => ({ cellId: Number(s.no), x: Number(s.x), y: Number(s.y) }))
          .filter((s: MapSpot) => !Number.isNaN(s.cellId) && !Number.isNaN(s.x) && !Number.isNaN(s.y));
        setMapSpots(spots);
      })
      .catch(() => setMapSpots([]));

    if (asset.labelsUrl) {
      fetch(asset.labelsUrl)
        .then((res) => res.json())
        .then((payload: any) => {
          const labels: Record<number, string> = {};
          for (const [k, v] of Object.entries(payload)) {
            labels[Number(k)] = String(v);
          }
          setMapLabels(labels);
        })
        .catch(() => setMapLabels({}));
    } else {
      setMapLabels({});
    }
  });

  const getCellLabel = (cellId: number, mapKey: string) => {
    return pureCellLabel(cellId, mapLabels());
  };

  const mstShipInfoById = createMemo(() => {
    return new Map(d.mstShips().map((ship) => [ship.id, { name: String(ship.name || ""), stype: Number(ship.stype || 0), backs: Number(ship.backs || 1) }]));
  });

  const allDrops = createMemo(() => {
    return d.battleRecords()
      .filter((r) => matchesTrustFilter(r.trust_tag, trustFilter()))
      .filter((r) => r.battle_result?.drop_ship_id)
      .map((r) => {
        const shipId = r.battle_result.drop_ship_id;
        const info = mstShipInfoById().get(shipId);
        const name = info?.name || `艦#${shipId}`;
        const stype = info?.stype || 0;
        const backs = info?.backs || 1;
        const mapKey = mapKeyOf(r);
        const winRank = r.battle_result.win_rank || "不明";
        return {
          id: r.uuid || `${r.timestamp}-${shipId}`,
          shipId,
          stype,
          backs,
          shipName: name,
          mapKey,
          cellId: r.cell_id,
          timestamp: r.timestamp,
          winRank,
        };
      })
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  });

  const totalBattlesPerMapCell = createMemo(() => {
    const counts = new Map<string, number>();
    for (const b of d.battleRecords()) {
      const mk = mapKeyOf(b);
      if (mk !== "-" && typeof b.cell_id === "number") {
        const key = `${mk}:${b.cell_id}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return counts;
  });

  const dropsInSelectedMap = createMemo(() => {
    const filter = d.mapFilter();
    if (!filter) return [];
    return allDrops().filter((d) => d.mapKey === filter);
  });

  const mapDropsByCell = createMemo(() => {
    const grouped = new Map<number, { shipId: number; shipName: string; count: number }[]>();
    for (const drop of dropsInSelectedMap()) {
      let list = grouped.get(drop.cellId);
      if (!list) {
        list = [];
        grouped.set(drop.cellId, list);
      }
      const existing = list.find((i) => i.shipId === drop.shipId);
      if (existing) existing.count++;
      else list.push({ shipId: drop.shipId, shipName: drop.shipName, count: 1 });
    }
    // Sort descending by count
    for (const list of grouped.values()) {
      list.sort((a, b) => b.count - a.count);
    }
    return grouped;
  });

  const mapAsset = createMemo(() => getBattleMapAsset(d.mapFilter()));
  const resolvedSpriteUrl = createMemo(() => {
    const asset = mapAsset();
    if (!asset) return null;
    return resolveBattleMapSpriteUrl(asset, "light"); // Simplified theme logic
  });

  const selectedCellDrops = createMemo(() => {
    const cellId = selectedCellId();
    if (cellId === null) return dropsInSelectedMap();
    return dropsInSelectedMap().filter((d) => d.cellId === cellId);
  });

  const totalBattlesInMapScope = createMemo(() => {
    const mapFilter = d.mapFilter();
    if (!mapFilter) return 1;
    const cellId = selectedCellId();
    return Math.max(1, d.battleRecords().filter(r => 
      mapKeyOf(r) === mapFilter &&
      (cellId === null || r.cell_id === cellId)
    ).length);
  });

  const mapDropsGroupedByStype = createMemo(() => {
    const drops = selectedCellDrops();
    const groupedByStype = new Map<number, typeof drops>();
    for (const drop of drops) {
      let list = groupedByStype.get(drop.stype);
      if (!list) {
        list = [];
        groupedByStype.set(drop.stype, list);
      }
      list.push(drop);
    }
    const result = [...groupedByStype.entries()].map(([stype, stypeDrops]) => {
      const uniqueShips = [...new Map(stypeDrops.map(d => [d.shipId, d])).values()].sort((a,b) => a.shipName.localeCompare(b.shipName, "ja"));
      return {
        stype,
        stypeName: STYPE_NAMES[stype] || `艦種 ${stype}`,
        uniqueShips,
      };
    });
    return result.sort((a, b) => a.stype - b.stype);
  });

  const allMapDropsOverview = createMemo(() => {
    const drops = allDrops();
    const mapStats = new Map<string, { totalDrops: number }>();
    for (const drop of drops) {
      if (!mapStats.has(drop.mapKey)) {
        mapStats.set(drop.mapKey, { totalDrops: 0 });
      }
      mapStats.get(drop.mapKey)!.totalDrops++;
    }
    
    const grouped = new Map<string, { areaId: string; maps: { mapKey: string; drops: number }[]; totalAreaDrops: number }>();
    for (const [mapKey, stats] of mapStats.entries()) {
      if (mapKey === "-" || mapKey === "0-0") continue;
      const areaId = mapKey.split("-")[0];
      if (!grouped.has(areaId)) {
        grouped.set(areaId, { areaId, maps: [], totalAreaDrops: 0 });
      }
      const g = grouped.get(areaId)!;
      g.maps.push({ mapKey, drops: stats.totalDrops });
      g.totalAreaDrops += stats.totalDrops;
    }
    
    const result = [...grouped.values()].sort((a, b) => {
      return Number(a.areaId) - Number(b.areaId);
    });
    for (const area of result) {
      area.maps.sort((a, b) => {
        const [, aNum] = a.mapKey.split("-").map(Number);
        const [, bNum] = b.mapKey.split("-").map(Number);
        return (aNum || 0) - (bNum || 0);
      });
    }
    return result;
  });

  // Global grouping for when NO map is selected
  const dropsGroupedByStype = createMemo(() => {
    const groupedByStype = new Map<number, { shipId: number; shipName: string; backs: number; drops: { mapKey: string; cellId: number; count: number; winRanks: Record<string, number> }[] }[]>();
    for (const drop of allDrops()) {
      let stypeList = groupedByStype.get(drop.stype);
      if (!stypeList) {
        stypeList = [];
        groupedByStype.set(drop.stype, stypeList);
      }
      let info = stypeList.find(s => s.shipId === drop.shipId);
      if (!info) {
        info = { shipId: drop.shipId, shipName: drop.shipName, backs: drop.backs, drops: [] };
        stypeList.push(info);
      }
      const loc = info.drops.find((l) => l.mapKey === drop.mapKey && l.cellId === drop.cellId);
      if (loc) {
        loc.count++;
        loc.winRanks[drop.winRank] = (loc.winRanks[drop.winRank] || 0) + 1;
      } else {
        info.drops.push({ mapKey: drop.mapKey, cellId: drop.cellId, count: 1, winRanks: { [drop.winRank]: 1 } });
      }
    }
    const result = [...groupedByStype.entries()].map(([stype, ships]) => {
      return {
        stype,
        stypeName: STYPE_NAMES[stype] || `艦種 ${stype}`,
        ships: ships.sort((a, b) => a.shipId - b.shipId)
      };
    });
    return result.sort((a, b) => a.stype - b.stype);
  });

  const [viewMode, setViewMode] = createSignal<"map" | "ship">("map");

  const panelTitle = createMemo(() => {
    if (viewMode() === "ship") return "全ドロップ履歴 (艦別)";
    return d.mapFilter() ? "ドロップマップ" : "海域を選択";
  });

  const panelSubtitle = createMemo(() => {
    if (viewMode() === "ship") return "ドロップ歴のあるすべての艦を一覧表示しています。";
    return d.mapFilter()
      ? "セルをクリックすると、そのマスでドロップした艦に絞り込みます。赤いセルはドロップ実績があるマスです。"
      : "ドロップ履歴のある海域一覧です。クリックして詳細なドロップ情報を確認できます。";
  });

  return (
    <div class="space-y-6">
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <div class="flex items-start justify-between mb-4">
            <div>
              <h3 class="card-title text-lg">{panelTitle()}</h3>
              <div class="text-xs text-base-content/60 mt-1">
                {panelSubtitle()}
              </div>
            </div>
            <div 
              class="relative flex items-center bg-base-200 rounded-md p-1 cursor-pointer select-none w-64 shadow-inner"
              onClick={() => setViewMode(viewMode() === "map" ? "ship" : "map")}
            >
              <div 
                class="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-primary rounded-md transition-transform duration-300 ease-in-out"
                style={{ transform: viewMode() === "map" ? "translateX(0)" : "translateX(100%)" }}
              />
              <div class={`relative z-10 flex-1 text-center text-sm px-2 py-1.5 transition-colors duration-300 ${viewMode() === "map" ? "font-bold text-primary-content" : "text-base-content/60 hover:text-primary-content"}`}>
                海域から探す
              </div>
              <div class={`relative z-10 flex-1 text-center text-sm px-2 py-1.5 transition-colors duration-300 ${viewMode() === "ship" ? "font-bold text-primary-content" : "text-base-content/60 hover:text-primary-content"}`}>
                艦から探す
              </div>
            </div>
          </div>

          <div class="mb-4 flex items-center justify-end">
            <TrustTagFilter value={trustFilter()} onChange={setTrustFilter} />
          </div>

          <Show when={viewMode() === "ship"}>
            <div class="space-y-6">
              <For each={dropsGroupedByStype()}>
                {(group) => (
                  <div>
                    <h4 class="font-bold text-sm text-base-content/80 mb-2 border-b border-base-200 pb-1">
                      {group.stypeName}
                    </h4>
                    <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                      <For each={group.ships}>
                        {(ship) => {
                          const maxCount = Math.max(...ship.drops.map(d => d.count));
                          const shipTotalDrops = ship.drops.reduce((sum, d) => sum + d.count, 0);
                          const totalOverallBattles = Math.max(1, d.battleRecords().length);
                          const overallRate = ((shipTotalDrops / totalOverallBattles) * 100).toFixed(2) + "%";

                          const dropLocs = ship.drops.sort((a, b) => b.count - a.count).map(loc => {
                            const pct = Math.max(2, (loc.count / maxCount) * 100);
                            const totalAtLoc = totalBattlesPerMapCell().get(`${loc.mapKey}:${loc.cellId}`) || 0;
                            const dropRate = totalAtLoc > 0 ? ((loc.count / totalAtLoc) * 100).toFixed(1) + "%" : "-";
                            const ranksStr = Object.entries(loc.winRanks).map(([r, c]) => `${r}:${c}`).join(" ");
                            return {
                              label: `${loc.mapKey}-${pureCellLabel(loc.cellId, undefined)}`,
                              dropRateStr: dropRate,
                              ranksStr,
                              count: loc.count,
                              pct
                            };
                          });

                          return (
                            <ShipDropCard
                              shipId={ship.shipId}
                              shipName={ship.shipName}
                              backs={ship.backs}
                              overallRateLabel="全体ドロップ率"
                              overallRateStr={overallRate}
                              overallCount={shipTotalDrops}
                              dropLocs={dropLocs}
                            />
                          );
                        }}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={viewMode() === "map"}>
            <Show when={d.mapFilter()} fallback={
              <div class="space-y-6">
                <Show when={allMapDropsOverview().length > 0} fallback={<div class="py-10 text-center text-base-content/50">ドロップ履歴がありません</div>}>
                  <For each={allMapDropsOverview()}>
                    {(area) => (
                      <div>
                        <h4 class="font-bold text-sm text-base-content/80 mb-3 border-b border-base-200 pb-1 flex justify-between">
                          <span>{area.areaId} {getAreaName(area.areaId)}</span>
                          <span class="font-mono text-xs text-base-content/60">計 {area.totalAreaDrops}件</span>
                        </h4>
                        <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                          <For each={area.maps}>
                            {(mapInfo) => {
                              const infoName = getMapInfoName(mapInfo.mapKey);
                              return (
                                <button 
                                  class="btn btn-outline h-auto py-2 flex flex-col items-center gap-1 hover:bg-base-200 hover:text-base-content hover:border-base-300"
                                  onClick={() => d.setMapFilter(mapInfo.mapKey)}
                                >
                                  <div class="flex items-center gap-2">
                                    <span class="font-bold text-base">{mapInfo.mapKey}</span>
                                    <span class="badge badge-accent badge-sm font-mono">{mapInfo.drops}</span>
                                  </div>
                                  <Show when={infoName}>
                                    <span class="text-[10px] font-normal opacity-75 max-w-full truncate px-1">{infoName}</span>
                                  </Show>
                                </button>
                              );
                            }}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            }>

              <Show when={mapAsset()} fallback={<div class="py-8 text-center text-base-content/40">マップデータがありません</div>}>
                {(asset) => (
                  <div class="space-y-4">
                    <div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3 text-sm">
                      <div class="flex items-center gap-2">
                        <Show when={selectedCellId() !== null}>
                          <button
                            class="btn btn-secondary btn-xs"
                            onClick={() => setSelectedCellId(null)}
                          >
                            選択解除: {getCellLabel(selectedCellId()!, d.mapFilter())}
                          </button>
                        </Show>
                      </div>
                    </div>

                    <div class="rounded-box overflow-hidden border border-base-300 bg-slate-100 shadow-inner">
                      <svg
                        viewBox={`0 0 ${asset().routeLayoutFrame.width} ${asset().routeLayoutFrame.height}`}
                        class="w-full h-auto block"
                      >
                        <rect width="100%" height="100%" fill="#f8fafc" />
                        <Show when={resolvedSpriteUrl()}>
                          <image
                            href={resolvedSpriteUrl()!}
                            x={-asset().seaMapFrame.x}
                            y={-asset().seaMapFrame.y}
                            width={asset().spriteSheetSize.width}
                            height={asset().spriteSheetSize.height}
                            style={{ opacity: "0.96" }}
                          />
                        </Show>

                        <For each={mapSpots()}>
                          {(spot) => {
                            const drops = mapDropsByCell().get(spot.cellId) || [];
                            const hasDrops = drops.length > 0;
                            const isSelected = selectedCellId() === spot.cellId;
                            const totalCount = drops.reduce((sum, d) => sum + d.count, 0);

                            return (
                              <g
                                class="cursor-pointer"
                                onClick={() => setSelectedCellId(isSelected ? null : spot.cellId)}
                              >
                                <circle
                                  cx={spot.x}
                                  cy={spot.y}
                                  r={isSelected ? "18" : "14"}
                                  fill={hasDrops ? "#fecdd3" : "#f1f5f9"}
                                  stroke={hasDrops ? "#e11d48" : "#94a3b8"}
                                  stroke-width={isSelected ? "3" : "2"}
                                  class="transition-all"
                                />
                                <text
                                  x={spot.x}
                                  y={spot.y + 4}
                                  text-anchor="middle"
                                  font-size="12"
                                  font-weight="bold"
                                  fill={hasDrops ? "#9f1239" : "#475569"}
                                >
                                  {getCellLabel(spot.cellId, d.mapFilter())}
                                </text>
                                <Show when={hasDrops}>
                                  <g transform={`translate(${spot.x + 12}, ${spot.y - 12})`}>
                                    <rect x="-8" y="-8" width="16" height="16" rx="8" fill="#e11d48" />
                                    <text x="0" y="3" text-anchor="middle" font-size="9" font-weight="bold" fill="white">
                                      {totalCount}
                                    </text>
                                  </g>
                                </Show>
                              </g>
                            );
                          }}
                        </For>
                      </svg>
                    </div>
                  </div>
                )}
              </Show>

              <div class="mt-6 border-t border-base-200 pt-6">
                <h3 class="font-bold text-base mb-3">
                  {selectedCellId() !== null ? `${getCellLabel(selectedCellId()!, d.mapFilter())}マスのドロップ` : '海域全体のドロップ'}
                </h3>
                <div class="space-y-6 mt-3">
                  <Show when={mapDropsGroupedByStype().length > 0} fallback={<div class="py-4 text-center text-base-content/40">ドロップ履歴がありません</div>}>
                    <For each={mapDropsGroupedByStype()}>
                      {(group) => (
                        <div>
                          <h4 class="font-bold text-sm text-base-content/80 mb-2 border-b border-base-200 pb-1">
                            {group.stypeName}
                          </h4>
                          <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            <For each={group.uniqueShips}>
                              {(uniqueDrop) => {
                                const dropsForShip = selectedCellDrops().filter(x => x.shipId === uniqueDrop.shipId);
                                const count = dropsForShip.length;
                                const overallRate = ((count / totalBattlesInMapScope()) * 100).toFixed(2) + "%";
                                
                                const groupedByCell = new Map<number, { count: number; winRanks: Record<string, number> }>();
                                for (const d of dropsForShip) {
                                  if (!groupedByCell.has(d.cellId)) {
                                    groupedByCell.set(d.cellId, { count: 0, winRanks: {} });
                                  }
                                  const g = groupedByCell.get(d.cellId)!;
                                  g.count++;
                                  g.winRanks[d.winRank] = (g.winRanks[d.winRank] || 0) + 1;
                                }
                                const cellDrops = [...groupedByCell.entries()]
                                  .map(([cellId, info]) => ({ cellId, count: info.count, winRanks: info.winRanks }))
                                  .sort((a, b) => b.count - a.count);

                                const dropLocs = cellDrops.map(loc => {
                                  const pct = Math.max(2, (loc.count / count) * 100);
                                  const totalAtLoc = totalBattlesPerMapCell().get(`${d.mapFilter()}:${loc.cellId}`) || 0;
                                  const dropRate = totalAtLoc > 0 ? ((loc.count / totalAtLoc) * 100).toFixed(1) + "%" : "-";
                                  const ranksStr = Object.entries(loc.winRanks).map(([r, c]) => `${r}:${c}`).join(" ");
                                  return {
                                    label: `${getCellLabel(loc.cellId, d.mapFilter())}マス`,
                                    dropRateStr: dropRate,
                                    ranksStr,
                                    count: loc.count,
                                    pct
                                  };
                                });

                                return (
                                  <ShipDropCard
                                    shipId={uniqueDrop.shipId}
                                    shipName={uniqueDrop.shipName}
                                    backs={uniqueDrop.backs}
                                    overallRateLabel={selectedCellId() !== null ? "マスドロップ率" : "海域ドロップ率"}
                                    overallRateStr={overallRate}
                                    overallCount={count}
                                    dropLocs={dropLocs}
                                  />
                                );
                              }}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}