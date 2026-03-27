/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { cachedFetch } from "@/utility/fetchCache";

type BattleRecord = {
  timestamp: number | null;
  midnight_timestamp?: number | null;
  f_formation?: number | null;
  formation?: number[] | null;
  battle_result?: { win_rank: string; drop_ship_id: number | null } | string | null;
  opening_air_attack?: Array<{ air_superiority: number | null } | null> | null;
};

type BattleResultRecord = {
  uuid?: string;
  win_rank?: string | null;
  drop_ship_id?: number | null;
};

type DailyPoint = { date: string; count: number };

type StatsState = {
  total: number;
  sRate: string;
  airRate: string;
  drops: number;
  dailySorties: DailyPoint[];
  rankDistribution: Record<string, number>;
  formationUsage: Record<string, number>;
  airStateDistribution: Record<string, number>;
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
  0: "航空均衡",
  1: "制空権確保",
  2: "航空優勢",
  3: "航空劣勢",
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
  航空均衡: "#f59e0b",
  航空劣勢: "#fb923c",
  制空権喪失: "#ef4444",
};

function emptyStats(): StatsState {
  return {
    total: 0,
    sRate: "-",
    airRate: "-",
    drops: 0,
    dailySorties: [],
    rankDistribution: {},
    formationUsage: {},
    airStateDistribution: {},
  };
}

function buildConicGradient(entries: Array<[string, number]>, colorMap: Record<string, string>): string {
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

function buildLinePath(points: DailyPoint[], width: number, height: number): string {
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

export default function BattleStatsPanel() {
  const [periodTag, setPeriodTag] = createSignal("latest");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [stats, setStats] = createSignal<StatsState>(emptyStats());

  const rankEntries = createMemo(() =>
    Object.entries(stats().rankDistribution).sort((a, b) => b[1] - a[1]),
  );
  const formationEntries = createMemo(() =>
    Object.entries(stats().formationUsage).sort((a, b) => b[1] - a[1]),
  );
  const airEntries = createMemo(() =>
    Object.entries(stats().airStateDistribution).sort((a, b) => b[1] - a[1]),
  );

  const rankConic = createMemo(() => buildConicGradient(rankEntries(), RANK_COLORS));
  const airConic = createMemo(() => buildConicGradient(airEntries(), AIR_COLORS));

  const linePath = createMemo(() => buildLinePath(stats().dailySorties, 760, 220));

  function normalizeEpochMs(value: number | null | undefined): number | null {
    if (!value || !Number.isFinite(value)) return null;
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  function resolveBattleResult(
    raw: BattleRecord["battle_result"],
    battleResultByUuid: Map<string, { win_rank: string; drop_ship_id: number | null }>,
  ): { win_rank: string; drop_ship_id: number | null } | null {
    if (!raw) return null;
    if (typeof raw === "string") return battleResultByUuid.get(raw) ?? null;
    if (typeof raw === "object" && raw.win_rank) {
      return { win_rank: raw.win_rank, drop_ship_id: raw.drop_ship_id ?? null };
    }
    return null;
  }

  async function loadStats() {
    setLoading(true);
    setError(null);
    try {
      const [res, battleResultRes] = await Promise.all([
        cachedFetch(
          `/api/battle-data/global/records?table=battle&period_tag=${encodeURIComponent(periodTag())}&limit_blocks=20&limit_records=8000`,
        ),
        cachedFetch(
          `/api/battle-data/global/records?table=battle_result&period_tag=${encodeURIComponent(periodTag())}&limit_blocks=20&limit_records=8000`,
        ),
      ]);
      if (!res.ok) {
        setError("戦闘データの取得に失敗しました。");
        setStats(emptyStats());
        return;
      }

      const result = (await res.json()) as { records?: BattleRecord[] };
      const battleResultPayload = battleResultRes.ok
        ? ((await battleResultRes.json()) as { records?: BattleResultRecord[] })
        : { records: [] };
      const battleResultByUuid = new Map<string, { win_rank: string; drop_ship_id: number | null }>();
      for (const rec of battleResultPayload.records || []) {
        if (!rec?.uuid || !rec.win_rank) continue;
        battleResultByUuid.set(rec.uuid, {
          win_rank: rec.win_rank,
          drop_ship_id: rec.drop_ship_id ?? null,
        });
      }

      const battles = result.records ?? [];
      if (battles.length === 0) {
        setStats(emptyStats());
        return;
      }

      const unresolvedResultUuids = new Set<string>();
      for (const battle of battles) {
        if (typeof battle.battle_result === "string" && !battleResultByUuid.has(battle.battle_result)) {
          unresolvedResultUuids.add(battle.battle_result);
        }
      }

      if (unresolvedResultUuids.size > 0) {
        const fillTargets = [...unresolvedResultUuids].slice(0, 100);
        const batchFilterJson = encodeURIComponent(JSON.stringify({ uuid: fillTargets }));
        const batchRes = await cachedFetch(
          `/api/battle-data/global/records?table=battle_result&period_tag=all&limit_blocks=120&limit_records=${fillTargets.length * 2}&filter_json=${batchFilterJson}`,
        );
        if (batchRes.ok) {
          const body = (await batchRes.json().catch(() => ({}))) as { records?: BattleResultRecord[] };
          for (const found of body.records || []) {
            if (found?.uuid && found.win_rank && !battleResultByUuid.has(found.uuid)) {
              battleResultByUuid.set(found.uuid, {
                win_rank: found.win_rank,
                drop_ship_id: found.drop_ship_id ?? null,
              });
            }
          }
        }
      }

      const rankCounts: Record<string, number> = {};
      const formCounts: Record<string, number> = {};
      const airCounts: Record<string, number> = {};
      const dailyCounts: Record<string, number> = {};
      let drops = 0;

      for (const b of battles) {
        const resolvedBattleResult = resolveBattleResult(b.battle_result, battleResultByUuid);
        const rank = resolvedBattleResult?.win_rank ?? "未記録";
        rankCounts[rank] = (rankCounts[rank] ?? 0) + 1;

        if (resolvedBattleResult?.drop_ship_id) drops++;

        const form = b.f_formation ?? b.formation?.[0];
        if (form != null) {
          const name = FORMATION_NAMES[form] ?? `不明(${form})`;
          formCounts[name] = (formCounts[name] ?? 0) + 1;
        }

        const airSup = b.opening_air_attack?.[0]?.air_superiority;
        if (airSup != null) {
          const name = AIR_NAMES[airSup] ?? `不明(${airSup})`;
          airCounts[name] = (airCounts[name] ?? 0) + 1;
        }

        const ts = normalizeEpochMs(b.timestamp) ?? normalizeEpochMs(b.midnight_timestamp);
        if (ts) {
          const d = new Date(ts);
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          dailyCounts[dateStr] = (dailyCounts[dateStr] ?? 0) + 1;
        }
      }

      const total = battles.length;
      const sCount = rankCounts.S ?? 0;
      const airSecured = airCounts["制空権確保"] ?? 0;
      const airTotal = Object.values(airCounts).reduce((sum, v) => sum + v, 0);

      const dailySorties = Object.entries(dailyCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));

      setStats({
        total,
        sRate: `${((sCount / total) * 100).toFixed(1)}%`,
        airRate: airTotal > 0 ? `${((airSecured / airTotal) * 100).toFixed(1)}%` : "-",
        drops,
        dailySorties,
        rankDistribution: rankCounts,
        formationUsage: formCounts,
        airStateDistribution: airCounts,
      });
    } catch (e) {
      setError(`読込エラー: ${String(e)}`);
      setStats(emptyStats());
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    void loadStats();
  });

  return (
    <>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="stat bg-base-100 rounded-box shadow-sm">
          <div class="stat-title">総出撃数</div>
          <div class="stat-value text-primary">{stats().total}</div>
        </div>
        <div class="stat bg-base-100 rounded-box shadow-sm">
          <div class="stat-title">S勝利率</div>
          <div class="stat-value text-success">{stats().sRate}</div>
        </div>
        <div class="stat bg-base-100 rounded-box shadow-sm">
          <div class="stat-title">制空確保率</div>
          <div class="stat-value text-info">{stats().airRate}</div>
        </div>
        <div class="stat bg-base-100 rounded-box shadow-sm">
          <div class="stat-title">ドロップ数</div>
          <div class="stat-value text-accent">{stats().drops}</div>
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm mb-6">
        <div class="card-body p-4">
          <div class="flex flex-wrap gap-4 items-end">
            <div class="form-control">
              <label class="label"><span class="label-text">期間</span></label>
              <select
                class="select select-bordered select-sm"
                value={periodTag()}
                onInput={(e) => setPeriodTag(e.currentTarget.value)}
              >
                <option value="latest">最新</option>
                <option value="all">全期間</option>
              </select>
            </div>
            <button class="btn btn-primary btn-sm" onClick={() => void loadStats()} disabled={loading()}>
              {loading() ? "集計中..." : "集計"}
            </button>
          </div>
          <Show when={error()}>{(msg) => <p class="mt-2 text-sm text-error">{msg()}</p>}</Show>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-base-100 rounded-box p-4 shadow-sm">
          <h3 class="font-bold mb-2">日別出撃数</h3>
          <Show
            when={stats().dailySorties.length > 0}
            fallback={<div class="h-[260px] flex items-center justify-center text-base-content/40">データ読込後に表示されます</div>}
          >
            <svg viewBox="0 0 800 260" class="w-full h-[260px]">
              <rect x="20" y="20" width="760" height="220" fill="#eff6ff"></rect>
              <path d={linePath()} fill="none" stroke="#2563eb" stroke-width="3" transform="translate(20 20)"></path>
            </svg>
            <div class="mt-2 text-xs text-base-content/70">
              最新: {stats().dailySorties[stats().dailySorties.length - 1]?.date} / {stats().dailySorties[stats().dailySorties.length - 1]?.count} 回
            </div>
          </Show>
        </div>

        <div class="bg-base-100 rounded-box p-4 shadow-sm">
          <h3 class="font-bold mb-2">戦闘結果分布</h3>
          <div class="flex items-center gap-6">
            <div class="w-44 h-44 rounded-full border border-base-300" style={{ background: rankConic() }}></div>
            <div class="flex-1 text-sm">
              <Show
                when={rankEntries().length > 0}
                fallback={<div class="py-8 text-base-content/50">戦闘結果データがありません</div>}
              >
                <For each={rankEntries()}>
                  {([name, value]) => (
                    <div class="flex items-center justify-between py-1 border-b border-base-200">
                      <span class="flex items-center gap-2">
                        <span class="inline-block w-3 h-3 rounded-sm" style={{ background: RANK_COLORS[name] ?? "#94a3b8" }}></span>
                        {name}
                      </span>
                      <span>{value}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>

        <div class="bg-base-100 rounded-box p-4 shadow-sm">
          <h3 class="font-bold mb-2">陣形使用率</h3>
          <div class="space-y-2">
            <For each={formationEntries()}>
              {([name, value]) => {
                const max = Math.max(1, ...(formationEntries().map(([, c]) => c)));
                const width = Math.max(4, Math.round((value / max) * 100));
                return (
                  <div>
                    <div class="flex justify-between text-xs mb-1"><span>{name}</span><span>{value}</span></div>
                    <div class="w-full h-3 bg-base-200 rounded-full overflow-hidden">
                      <div class="h-full bg-primary" style={{ width: `${width}%` }}></div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        <div class="bg-base-100 rounded-box p-4 shadow-sm">
          <h3 class="font-bold mb-2">制空状態分布</h3>
          <div class="flex items-center gap-6">
            <div class="w-44 h-44 rounded-full border border-base-300" style={{ background: airConic() }}></div>
            <div class="flex-1 text-sm">
              <Show
                when={airEntries().length > 0}
                fallback={<div class="py-8 text-base-content/50">制空データがありません</div>}
              >
                <For each={airEntries()}>
                  {([name, value]) => (
                    <div class="flex items-center justify-between py-1 border-b border-base-200">
                      <span class="flex items-center gap-2">
                        <span class="inline-block w-3 h-3 rounded-sm" style={{ background: AIR_COLORS[name] ?? "#94a3b8" }}></span>
                        {name}
                      </span>
                      <span>{value}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
