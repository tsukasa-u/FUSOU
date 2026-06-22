/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal } from "solid-js";
import type { SharedDashboardState } from "../../battles/solid/types";
import { mapKeyOf } from "../../map-flow/solid/battle-map-flow/dataUtils";

type DailyPoint = { date: string; count: number };

type StatsState = {
  totalBattles: number;
  totalSorties: number;
  sRate: string;
  airRate: string;
  drops: number;
  dropRate: string;
  avgBattlesPerSortie: string;
  dailySorties: DailyPoint[];
  rankDistribution: Record<string, number>;
  formationUsage: Record<string, number>;
  airStateDistribution: Record<string, number>;
  mapAreaStats: Record<string, { sorties: number; sRanks: number; battles: number }>;
  dayNightRatio: { day: number; night: number };
  mvpDistribution: Record<string, number>;
};

const FORMATION_NAMES: Record<number, string> = {
  1: "単縦陣",
  2: "複縦陣",
  3: "輪形陣",
  4: "梯形陣",
  5: "単横陣",
  6: "警戒陣",
};

const AIR_NAMES: Record<number, string> = {
  0: "不明",
  1: "制空権確保",
  2: "航空優勢",
  3: "不明",
  4: "制空権喪失",
};

const RANK_COLORS: Record<string, string> = {
  S: "#22c55e",
  A: "#3b82f6",
  B: "#f59e0b",
  C: "#ef4444",
  D: "#b91c1c",
  E: "#7f1d1d",
  未記録: "#94a3b8",
};

const AIR_COLORS: Record<string, string> = {
  制空権確保: "#22c55e",
  航空優勢: "#3b82f6",
  不明: "#94a3b8",
  制空権喪失: "#ef4444",
};

function buildConicGradient(
  entries: Array<[string, number]>,
  colorMap: Record<string, string>,
): string {
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return "conic-gradient(#e5e7eb 0 100%)";

  let cursor = 0;
  const segments: string[] = [];
  for (const [label, value] of entries) {
    const ratio = value / total;
    const next = cursor + ratio * 100;
    const color = colorMap[label] ?? "#94a3b8";
    segments.push(`${color} ${cursor.toFixed(2)}% ${next.toFixed(2)}%`);
    cursor = next;
  }
  return `conic-gradient(${segments.join(",")})`;
}

function buildLinePath(
  points: DailyPoint[],
  width: number,
  height: number,
): string {
  if (points.length === 0) return "";
  const maxY = Math.max(1, ...points.map((p) => p.count));
  const stepX = points.length === 1 ? 0 : width / (points.length - 1);

  return points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - (p.count / maxY) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function BattleStatsPanel(props: { dashboardState: SharedDashboardState }) {
  const d = props.dashboardState;

  const stats = createMemo((): StatsState => {
    const battles = d.battleRecords();
    const rankCounts: Record<string, number> = {};
    const formCounts: Record<string, number> = {};
    const airCounts: Record<string, number> = {};
    const dailyCounts: Record<string, number> = {};
    const mvpCounts: Record<string, number> = {};
    
    // Sortie and Map tracking
    const uniqueSorties = new Set<string>();
    const battleToMap = new Map<string, string>();
    const mapStats: Record<string, { sorties: Set<string>; sRanks: number; battles: number }> = {};
    
    let dayCount = 0;
    let nightCount = 0;
    let drops = 0;

    for (const c of d.cellRecords()) {
      let mapLabel = mapKeyOf(c);
      if (mapLabel === "-" || mapLabel === "0-0") mapLabel = "不明";
      if (c.battles) {
        if (Array.isArray(c.battles)) {
          c.battles.forEach((bu: string) => battleToMap.set(bu, mapLabel));
        } else if (typeof c.battles === "string") {
          battleToMap.set(c.battles, mapLabel);
        }
      }
    }

    const dailySortiesByDate = new Map<string, Set<string>>();

    for (const b of battles) {
      const rank = b.battle_result?.win_rank ?? "未記録";
      rankCounts[rank] = (rankCounts[rank] ?? 0) + 1;

      if (b.battle_result?.drop_ship_id) drops++;

      const mvp = b.battle_result?.mvp;
      if (mvp != null && Number(mvp) > 0) {
        const label = Number(mvp) === 1 ? "旗艦" : `随伴艦(${mvp}番艦)`;
        mvpCounts[label] = (mvpCounts[label] ?? 0) + 1;
      }

      const form = b.f_formation ?? b.formation?.[0];
      if (form != null) {
        const name = FORMATION_NAMES[form] ?? `不明(${form})`;
        formCounts[name] = (formCounts[name] ?? 0) + 1;
      }

      const openingAir = Array.isArray(b.opening_air_attack)
        ? b.opening_air_attack[0]
        : b.opening_air_attack;
      const airSup = openingAir?.air_superiority;
      if (airSup != null) {
        const name = AIR_NAMES[airSup] ?? `不明(${airSup})`;
        airCounts[name] = (airCounts[name] ?? 0) + 1;
      }

      // Prioritize `b.uuid` (which is the proxy's real sortie ID) over the backend's artificially grouped `b.__sortie_id`
      const sortieId = b.uuid || b.__sortie_id || b.env_uuid || String(b.timestamp);

      if (b.timestamp) {
        const dDate = new Date(b.timestamp);
        const dateStr = `${dDate.getFullYear()}-${String(dDate.getMonth() + 1).padStart(2, "0")}-${String(dDate.getDate()).padStart(2, "0")}`;
        if (!dailySortiesByDate.has(dateStr)) dailySortiesByDate.set(dateStr, new Set());
        dailySortiesByDate.get(dateStr)!.add(sortieId);
      }

      if (b.midnight_timestamp != null && b.midnight_timestamp > 0) {
        nightCount++;
      } else {
        dayCount++;
      }

      uniqueSorties.add(sortieId);
      
      const mapLabel = battleToMap.get(b.uuid) || "不明";
      if (!mapStats[mapLabel]) {
        mapStats[mapLabel] = { sorties: new Set(), sRanks: 0, battles: 0 };
      }
      mapStats[mapLabel].battles++;
      mapStats[mapLabel].sorties.add(sortieId);
      if (rank === "S") mapStats[mapLabel].sRanks++;
    }

    const compiledMapStats: Record<string, { sorties: number; sRanks: number; battles: number }> = {};
    for (const [m, stat] of Object.entries(mapStats)) {
      compiledMapStats[m] = {
        sorties: stat.sorties.size,
        sRanks: stat.sRanks,
        battles: stat.battles
      };
    }

    const totalBattles = battles.length;
    const totalSortiesCount = uniqueSorties.size;
    const sCount = rankCounts.S ?? 0;
    const airSecured = airCounts["制空権確保"] ?? 0;
    const airTotal = Object.values(airCounts).reduce((sum, v) => sum + v, 0);

    for (const [date, sorties] of dailySortiesByDate.entries()) {
      dailyCounts[date] = sorties.size;
    }

    const dailySortiesRaw = Object.entries(dailyCounts).sort(([a], [b]) => a.localeCompare(b));
    const dailySorties: DailyPoint[] = [];
    if (dailySortiesRaw.length > 0) {
      const firstDate = new Date(dailySortiesRaw[0][0]);
      const lastDate = new Date(dailySortiesRaw[dailySortiesRaw.length - 1][0]);
      for (let d = new Date(firstDate); d <= lastDate; d.setDate(d.getDate() + 1)) {
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        dailySorties.push({ date: dateStr, count: dailyCounts[dateStr] ?? 0 });
      }
    }

    return {
      totalBattles,
      totalSorties: totalSortiesCount,
      sRate: totalBattles > 0 ? `${((sCount / totalBattles) * 100).toFixed(1)}%` : "-",
      airRate: airTotal > 0 ? `${((airSecured / airTotal) * 100).toFixed(1)}%` : "-",
      drops,
      dropRate: totalBattles > 0 ? `${((drops / totalBattles) * 100).toFixed(1)}%` : "-",
      avgBattlesPerSortie: totalSortiesCount > 0 ? (totalBattles / totalSortiesCount).toFixed(2) : "-",
      dailySorties,
      rankDistribution: rankCounts,
      formationUsage: formCounts,
      airStateDistribution: airCounts,
      mapAreaStats: compiledMapStats,
      dayNightRatio: { day: dayCount, night: nightCount },
      mvpDistribution: mvpCounts,
    };
  });

  const RANK_ORDER: Record<string, number> = {
    "S": 1,
    "A": 2,
    "B": 3,
    "C": 4,
    "D": 5,
    "E": 6,
    "未記録": 7
  };

  const rankEntries = createMemo(() =>
    Object.entries(stats().rankDistribution).sort((a, b) => (RANK_ORDER[a[0]] || 99) - (RANK_ORDER[b[0]] || 99)),
  );
  const formationEntries = createMemo(() =>
    Object.entries(stats().formationUsage).sort((a, b) => b[1] - a[1]),
  );
  const AIR_ORDER: Record<string, number> = {
    "制空権確保": 1,
    "航空優勢": 2,
    "不明": 3,
    "制空権喪失": 4,
  };

  const airEntries = createMemo(() =>
    Object.entries(stats().airStateDistribution).sort((a, b) => {
      const aName = a[0].startsWith("不明") ? "不明" : a[0];
      const bName = b[0].startsWith("不明") ? "不明" : b[0];
      return (AIR_ORDER[aName] || 99) - (AIR_ORDER[bName] || 99);
    }),
  );
  const mvpEntries = createMemo(() =>
    Object.entries(stats().mvpDistribution).sort((a, b) => b[1] - a[1]),
  );
  const mapAreaEntries = createMemo(() =>
    Object.entries(stats().mapAreaStats).sort((a, b) => {
      if (a[0] === "不明") return 1;
      if (b[0] === "不明") return -1;
      const [aArea, aInfo] = a[0].split("-").map(Number);
      const [bArea, bInfo] = b[0].split("-").map(Number);
      if (aArea !== bArea) return aArea - bArea;
      return aInfo - bInfo;
    }),
  );

  const rankConic = createMemo(() => buildConicGradient(rankEntries(), RANK_COLORS));
  const airConic = createMemo(() => buildConicGradient(airEntries(), AIR_COLORS));
  const linePath = createMemo(() => buildLinePath(stats().dailySorties, 760, 220));

  return (
    <>
      <div class="stats stats-vertical lg:stats-horizontal shadow-sm w-full mb-6 bg-base-100">
        <div class="stat">
          <div class="stat-title">総出撃数</div>
          <div class="stat-value text-primary">{stats().totalSorties}</div>
          <div class="stat-desc text-base-content/60 font-medium">総戦闘: {stats().totalBattles} / 平均 {stats().avgBattlesPerSortie}戦</div>
        </div>
        <div class="stat">
          <div class="stat-title">S勝利率</div>
          <div class="stat-value text-success">{stats().sRate}</div>
        </div>
        <div class="stat">
          <div class="stat-title">制空確保率</div>
          <div class="stat-value text-info">{stats().airRate}</div>
        </div>
        <div class="stat">
          <div class="stat-title">ドロップ数</div>
          <div class="stat-value text-accent">{stats().drops}</div>
          <div class="stat-desc text-base-content/60 font-medium">ドロップ率: {stats().dropRate}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="card bg-base-100 shadow-sm">
          <div class="card-body p-4 sm:p-6">
            <h3 class="card-title text-lg mb-4">日別出撃数</h3>
            <Show
              when={stats().dailySorties.length > 0}
              fallback={<div class="h-[260px] flex items-center justify-center text-base-content/40">データがありません</div>}
            >
              {(() => {
                const points = stats().dailySorties;
                const maxY = Math.max(1, ...points.map((p) => p.count));
                const width = 740;
                const height = 210;
                const stepX = points.length === 1 ? 0 : width / (points.length - 1);
                const [hoveredIdx, setHoveredIdx] = createSignal<number | null>(null);

                return (
                  <div class="relative w-full h-[260px] rounded-box bg-blue-50/20 border border-base-200">
                    <svg viewBox="0 0 800 250" class="w-full h-full">
                      <rect x="40" y="20" width="740" height="210" fill="transparent"></rect>
                      
                      {/* Grid lines and Y-axis labels */}
                      <For each={[0, 0.25, 0.5, 0.75, 1]}>
                        {(ratio) => {
                          const y = 20 + height - ratio * height;
                          return (
                            <g>
                              <line x1="40" y1={y} x2="780" y2={y} stroke="currentColor" class="text-base-300" stroke-width="1"></line>
                              <text x="32" y={y + 4} fill="currentColor" class="text-[10px] text-base-content/50" text-anchor="end">{Math.round(maxY * ratio)}</text>
                            </g>
                          );
                        }}
                      </For>

                      {/* X-axis labels (Start, Middle, End) */}
                      <Show when={points.length > 0}>
                        <text x="40" y="245" fill="currentColor" class="text-[10px] text-base-content/50" text-anchor="start">{points[0].date}</text>
                        <Show when={points.length > 2}>
                          <text x={40 + width / 2} y="245" fill="currentColor" class="text-[10px] text-base-content/50" text-anchor="middle">{points[Math.floor(points.length / 2)].date}</text>
                        </Show>
                        <Show when={points.length > 1}>
                          <text x="780" y="245" fill="currentColor" class="text-[10px] text-base-content/50" text-anchor="end">{points[points.length - 1].date}</text>
                        </Show>
                      </Show>

                      {/* Line Path */}
                      <path d={buildLinePath(points, width, height)} fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" transform="translate(40 20)"></path>
                      
                      {/* Interactive hover points */}
                      <For each={points}>
                        {(p, i) => {
                          const cx = 40 + i() * stepX;
                          const cy = 20 + height - (p.count / maxY) * height;
                          return (
                            <g
                              onMouseEnter={() => setHoveredIdx(i())}
                              onMouseLeave={() => setHoveredIdx(null)}
                              class="cursor-crosshair outline-none"
                            >
                              <circle
                                cx={cx}
                                cy={cy}
                                r={hoveredIdx() === i() ? 6 : 3}
                                fill={hoveredIdx() === i() ? "#2563eb" : "white"}
                                stroke="#2563eb"
                                stroke-width="2"
                                class="transition-all duration-200"
                              />
                              <circle cx={cx} cy={cy} r="16" fill="transparent" />
                            </g>
                          );
                        }}
                      </For>
                    </svg>

                    {/* Tooltip */}
                    <Show when={hoveredIdx() !== null}>
                      {(() => {
                        const idx = hoveredIdx()!;
                        const p = points[idx];
                        const cx = 40 + idx * stepX;
                        const cy = 20 + height - (p.count / maxY) * height;
                        const isRightHalf = idx > points.length / 2;
                        return (
                          <div
                            class="absolute bg-base-100 shadow-md border border-base-200 rounded p-2 text-xs z-10 pointer-events-none"
                            style={{
                              top: `calc(${(cy / 250) * 100}% - 8px)`,
                              left: isRightHalf ? "auto" : `calc(${(cx / 800) * 100}% + 12px)`,
                              right: isRightHalf ? `calc(${100 - (cx / 800) * 100}% + 12px)` : "auto",
                              transform: "translateY(-100%)",
                            }}
                          >
                            <div class="font-bold text-base-content mb-1 border-b border-base-200 pb-1">{p.date}</div>
                            <div class="text-primary font-mono">{p.count} 回出撃</div>
                          </div>
                        );
                      })()}
                    </Show>
                  </div>
                );
              })()}
              <div class="mt-3 text-xs text-base-content/70 flex justify-between px-2">
                <span>総出撃数: <span class="font-mono text-base-content font-bold">{stats().totalSorties}</span> 回</span>
                <span>最新: {stats().dailySorties[stats().dailySorties.length - 1]?.date}</span>
              </div>
            </Show>
          </div>
        </div>

        <div class="card bg-base-100 shadow-sm">
          <div class="card-body p-4 sm:p-6">
            <h3 class="card-title text-lg mb-4">戦闘結果分布</h3>
            <div class="flex flex-col sm:flex-row items-center gap-6">
              <div class="w-48 h-48 rounded-full shadow-inner shrink-0 overflow-hidden" style={{ background: rankConic() }}></div>
              <div class="flex-1 w-full text-sm">
                <Show when={rankEntries().length > 0} fallback={<div class="py-8 text-center text-base-content/50">データがありません</div>}>
                  <div class="space-y-2">
                    <For each={rankEntries()}>
                      {([name, value]) => (
                        <div class="flex items-center justify-between">
                          <span class="flex items-center gap-2">
                            <span class="inline-block w-3 h-3 rounded-full shadow-sm" style={{ background: RANK_COLORS[name] ?? "#94a3b8" }}></span>
                            <span class="font-medium">{name}</span>
                          </span>
                          <span class="font-mono text-base-content/80">{value}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-sm">
          <div class="card-body p-4 sm:p-6">
            <h3 class="card-title text-lg mb-4">陣形使用率</h3>
            <div class="space-y-3">
              <For each={formationEntries()}>
                {([name, value]) => {
                  const maxVal = formationEntries()[0]?.[1] || 1;
                  const width = Math.max(1, Math.round((value / maxVal) * 100));
                  return (
                    <div>
                      <div class="flex justify-between text-sm mb-1 font-medium text-base-content/80">
                        <span>{name}</span>
                        <span class="font-mono">{value}</span>
                      </div>
                      <div class="w-full h-2.5 bg-base-200 rounded-full overflow-hidden shadow-inner">
                        <div class="h-full bg-primary transition-all duration-500 ease-out" style={{ width: `${width}%` }}></div>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-sm">
          <div class="card-body p-4 sm:p-6">
            <h3 class="card-title text-lg mb-4">MVP取得枠</h3>
            <div class="space-y-3">
              <Show when={mvpEntries().length > 0} fallback={<div class="py-4 text-center text-base-content/50">データがありません</div>}>
                <For each={mvpEntries()}>
                  {([name, value]) => {
                    const maxVal = mvpEntries()[0]?.[1] || 1;
                    const width = Math.max(1, Math.round((value / maxVal) * 100));
                    return (
                      <div>
                        <div class="flex justify-between text-sm mb-1 font-medium text-base-content/80">
                          <span>{name}</span>
                          <span class="font-mono">{value}</span>
                        </div>
                        <div class="w-full h-2.5 bg-base-200 rounded-full overflow-hidden shadow-inner">
                          <div class="h-full bg-secondary transition-all duration-500 ease-out" style={{ width: `${width}%` }}></div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-sm">
          <div class="card-body p-4 sm:p-6">
            <h3 class="card-title text-lg mb-4">制空状態分布</h3>
            <div class="flex flex-col sm:flex-row items-center gap-6">
              <div class="w-48 h-48 rounded-full shadow-inner shrink-0 overflow-hidden" style={{ background: airConic() }}></div>
              <div class="flex-1 w-full text-sm">
                <Show when={airEntries().length > 0} fallback={<div class="py-8 text-center text-base-content/50">データがありません</div>}>
                  <div class="space-y-2">
                    <For each={airEntries()}>
                      {([name, value]) => (
                        <div class="flex items-center justify-between">
                          <span class="flex items-center gap-2">
                            <span class="inline-block w-3 h-3 rounded-full shadow-sm" style={{ background: AIR_COLORS[name] ?? "#94a3b8" }}></span>
                            <span class="font-medium">{name}</span>
                          </span>
                          <span class="font-mono text-base-content/80">{value}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-sm">
          <div class="card-body p-4 sm:p-6">
            <h3 class="card-title text-lg mb-4">海域別成績</h3>
            <div class="space-y-3 max-h-[300px] overflow-y-auto pr-3 scrollbar-thin scrollbar-thumb-base-300 scrollbar-track-transparent">
              <Show when={mapAreaEntries().length > 0} fallback={<div class="py-4 text-center text-base-content/50">データがありません</div>}>
                <div class="overflow-x-auto w-full">
                  <table class="table table-sm table-zebra w-full text-sm">
                    <thead>
                      <tr class="text-base-content/80">
                        <th>海域</th>
                        <th class="text-right">出撃数</th>
                        <th class="text-right">S勝利率</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={mapAreaEntries()}>
                        {([name, stat]) => {
                          const sRate = stat.battles > 0 ? ((stat.sRanks / stat.battles) * 100).toFixed(1) + "%" : "-";
                          return (
                            <tr>
                              <td class="font-medium">{name}</td>
                              <td class="text-right font-mono">{stat.sorties}</td>
                              <td class="text-right font-mono text-success">{sRate}</td>
                            </tr>
                          );
                        }}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-sm">
          <div class="card-body p-4 sm:p-6 flex flex-col">
            <h3 class="card-title text-lg mb-4">昼夜戦割合</h3>
            <div class="flex-1 flex flex-col justify-center pb-4">
              <div class="flex justify-between text-sm mb-3 px-1 font-medium">
                <span class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-warning shadow-sm"></div>昼戦終了</span>
                <span class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-indigo-500 shadow-sm"></div>夜戦突入</span>
              </div>
              <div class="w-full h-10 bg-base-200 rounded-box overflow-hidden flex shadow-inner">
                <Show when={stats().totalBattles > 0} fallback={<div class="w-full h-full bg-base-200 flex items-center justify-center text-xs text-base-content/40">データなし</div>}>
                  <div class="h-full bg-warning flex items-center pl-4 text-sm font-bold text-warning-content transition-all duration-500 overflow-hidden whitespace-nowrap" style={{ width: `${Math.max(0, (stats().dayNightRatio.day / stats().totalBattles) * 100)}%` }}>
                    <Show when={(stats().dayNightRatio.day / stats().totalBattles) > 0.1}>
                      {((stats().dayNightRatio.day / stats().totalBattles) * 100).toFixed(1)}%
                    </Show>
                  </div>
                  <div class="h-full bg-indigo-500 flex items-center pr-4 text-sm font-bold text-white justify-end transition-all duration-500 overflow-hidden whitespace-nowrap" style={{ width: `${Math.max(0, (stats().dayNightRatio.night / stats().totalBattles) * 100)}%` }}>
                    <Show when={(stats().dayNightRatio.night / stats().totalBattles) > 0.1}>
                      {((stats().dayNightRatio.night / stats().totalBattles) * 100).toFixed(1)}%
                    </Show>
                  </div>
                </Show>
              </div>
              <div class="flex justify-between text-xs text-base-content/60 mt-2 px-1 font-mono">
                <span>{stats().dayNightRatio.day} 回</span>
                <span>{stats().dayNightRatio.night} 回</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
