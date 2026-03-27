/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { getBattleMapAsset } from "@/data/battleMapAssets";
import { cachedFetch } from "@/utility/fetchCache";

type WinRank = "S" | "A" | "B" | "C" | "D" | "E" | string;

type BattleRecord = {
  uuid?: string;
  env_uuid?: string;
  index?: number | null;
  timestamp: number | null;
  midnight_timestamp?: number | null;
  maparea_id?: number | null;
  mapinfo_no?: number | null;
  cell_id: number;
  f_formation?: number | null;
  battle_result?: { win_rank: WinRank; drop_ship_id: number | null } | string | null;
  opening_air_attack: Array<{ air_superiority: number | null } | null> | null;
  e_deck_id?: string | null;
};

type BattleResultRecord = {
  uuid?: string;
  win_rank?: WinRank | null;
  drop_ship_id?: number | null;
};

type CellRecord = {
  battles?: string | null;
  maparea_id?: number | null;
  mapinfo_no?: number | null;
};

type EnemyDeckRecord = {
  uuid: string;
  ship_ids?: string[] | string | null;
};

type EnemyShipRecord = {
  uuid: string;
  index?: number | null;
  mst_ship_id?: number | null;
};

type MstShipRecord = {
  id: number;
  name: string;
};

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

function formatTimestamp(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function normalizeEpochMs(value: number | null | undefined): number | null {
  if (!value || !Number.isFinite(value)) return null;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function resolveBattleResult(
  raw: BattleRecord["battle_result"],
  battleResultByUuid: Map<string, { win_rank: WinRank; drop_ship_id: number | null }>,
): { win_rank: WinRank; drop_ship_id: number | null } | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    return battleResultByUuid.get(raw) ?? null;
  }
  if (typeof raw === "object" && raw.win_rank) {
    return { win_rank: raw.win_rank, drop_ship_id: raw.drop_ship_id ?? null };
  }
  return null;
}

function battleResultOf(b: BattleRecord): { win_rank: WinRank; drop_ship_id: number | null } | null {
  if (!b.battle_result || typeof b.battle_result !== "object") return null;
  return b.battle_result;
}

function mapLabelOf(b: BattleRecord): string {
  return b.maparea_id && b.mapinfo_no ? `${b.maparea_id}-${b.mapinfo_no}` : "-";
}

export default function BattlesListPanel() {
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [periodTag, setPeriodTag] = createSignal("latest");
  const [mapFilter, setMapFilter] = createSignal("");
  const [resultFilter, setResultFilter] = createSignal("");
  const [currentPage, setCurrentPage] = createSignal(0);
  const [allBattles, setAllBattles] = createSignal<BattleRecord[]>([]);
  const [enemyDeckNameById, setEnemyDeckNameById] = createSignal<Map<string, string>>(new Map());
  const [cellLabelsByMapKey, setCellLabelsByMapKey] = createSignal<Record<string, Record<number, string>>>({});

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
    if (cellId === 0) return "港";
    const mapKey = mapLabelOf(b);
    const labels = mapKey !== "-" ? cellLabelsByMapKey()[mapKey] : undefined;
    return labels?.[cellId] || alphaCellLabel(cellId);
  };

  const mapOptions = createMemo(() => {
    const values = new Set<string>();
    for (const b of allBattles()) {
      const label = mapLabelOf(b);
      if (label !== "-") values.add(label);
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ja"));
  });

  const filteredBattles = createMemo(() => {
    let list = allBattles();
    if (resultFilter()) {
      list = list.filter((b) => battleResultOf(b)?.win_rank === resultFilter());
    }
    if (mapFilter()) {
      list = list.filter((b) => mapLabelOf(b) === mapFilter());
    }
    return list;
  });

  const totalPages = createMemo(() => Math.ceil(filteredBattles().length / PAGE_SIZE));

  const pagedBattles = createMemo(() => {
    const start = currentPage() * PAGE_SIZE;
    return filteredBattles().slice(start, start + PAGE_SIZE);
  });

  const recentSummary = createMemo(() => {
    return [...allBattles()]
      .filter((b) => !!b.timestamp)
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, 25);
  });

  async function loadBattles() {
    setLoading(true);
    setError(null);
    try {
      const [response, cellsResponse, battleResultResponse, enemyDeckResponse, enemyShipResponse, mstShipResponse] = await Promise.all([
        cachedFetch(
          `/api/battle-data/global/records?table=battle&period_tag=${encodeURIComponent(periodTag())}&limit_blocks=12&limit_records=5000`,
        ),
        cachedFetch(
          `/api/battle-data/global/records?table=cells&period_tag=${encodeURIComponent(periodTag())}&limit_blocks=12&limit_records=5000`,
        ),
        cachedFetch(
          `/api/battle-data/global/records?table=battle_result&period_tag=${encodeURIComponent(periodTag())}&limit_blocks=12&limit_records=5000`,
        ),
        cachedFetch(
          `/api/battle-data/global/records?table=enemy_deck&period_tag=${encodeURIComponent(periodTag())}&limit_blocks=12&limit_records=8000`,
        ),
        cachedFetch(
          `/api/battle-data/global/records?table=enemy_ship&period_tag=${encodeURIComponent(periodTag())}&limit_blocks=12&limit_records=20000`,
        ),
        cachedFetch(`/api/master-data/json?table_name=mst_ship`),
      ]);
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        setError(payload.message || "戦闘データの取得に失敗しました。");
        setAllBattles([]);
        return;
      }

      const payload = (await response.json()) as { records?: BattleRecord[] };
      const cellsPayload = cellsResponse.ok
        ? ((await cellsResponse.json()) as { records?: CellRecord[] })
        : { records: [] };
      const battleResultPayload = battleResultResponse.ok
        ? ((await battleResultResponse.json()) as { records?: BattleResultRecord[] })
        : { records: [] };
      const enemyDeckPayload = enemyDeckResponse.ok
        ? ((await enemyDeckResponse.json()) as { records?: EnemyDeckRecord[] })
        : { records: [] };
      const enemyShipPayload = enemyShipResponse.ok
        ? ((await enemyShipResponse.json()) as { records?: EnemyShipRecord[] })
        : { records: [] };
      const mstShipPayload = mstShipResponse.ok
        ? ((await mstShipResponse.json()) as { records?: MstShipRecord[] })
        : { records: [] };
      const battleResultByUuid = new Map<string, { win_rank: WinRank; drop_ship_id: number | null }>();
      for (const rec of battleResultPayload.records || []) {
        if (!rec?.uuid || !rec.win_rank) continue;
        battleResultByUuid.set(rec.uuid, {
          win_rank: rec.win_rank,
          drop_ship_id: rec.drop_ship_id ?? null,
        });
      }

      const unresolvedResultUuids = new Set<string>();
      for (const rec of payload.records || []) {
        if (typeof rec?.battle_result === "string" && !battleResultByUuid.has(rec.battle_result)) {
          unresolvedResultUuids.add(rec.battle_result);
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

      const mapByBattleUuid = new Map<string, { maparea_id: number; mapinfo_no: number }>();
      for (const cell of cellsPayload.records || []) {
        const battleUuid = cell.battles;
        if (!battleUuid) continue;
        const maparea = Number(cell.maparea_id ?? 0);
        const mapinfo = Number(cell.mapinfo_no ?? 0);
        if (maparea > 0 && mapinfo > 0) {
          mapByBattleUuid.set(battleUuid, { maparea_id: maparea, mapinfo_no: mapinfo });
        }
      }

      const sorted = (payload.records || [])
        .filter((b) => typeof b.cell_id === "number")
        .map((b) => {
          const normalizedTimestamp =
            normalizeEpochMs(b.timestamp) ?? normalizeEpochMs(b.midnight_timestamp) ?? null;
          const normalizedBattleResult = resolveBattleResult(
            b.battle_result,
            battleResultByUuid,
          );

          if (b.maparea_id && b.mapinfo_no) {
            return {
              ...b,
              timestamp: normalizedTimestamp,
              battle_result: normalizedBattleResult,
            };
          }
          const resolved = b.uuid ? mapByBattleUuid.get(b.uuid) : undefined;
          return {
            ...b,
            ...(resolved || {}),
            timestamp: normalizedTimestamp,
            battle_result: normalizedBattleResult,
          };
        })
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

      const deckById = new Map((enemyDeckPayload.records || []).map((d) => [d.uuid, d]));
      const shipsByGroupId = new Map<string, EnemyShipRecord[]>();
      for (const ship of enemyShipPayload.records || []) {
        const group = shipsByGroupId.get(ship.uuid);
        if (group) {
          group.push(ship);
        } else {
          shipsByGroupId.set(ship.uuid, [ship]);
        }
      }
      for (const group of shipsByGroupId.values()) {
        group.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
      }
      const mstShipNameById = new Map((mstShipPayload.records || []).map((s) => [s.id, s.name]));

      const toGroupIds = (shipIds: EnemyDeckRecord["ship_ids"]): string[] => {
        if (Array.isArray(shipIds)) {
          return shipIds.filter((id): id is string => typeof id === "string" && id.length > 0);
        }
        if (typeof shipIds === "string" && shipIds.length > 0) {
          return [shipIds];
        }
        return [];
      };

      const describeEnemy = (deckId?: string | null): string => {
        if (!deckId) return "-";
        const deck = deckById.get(deckId);
        if (!deck?.ship_ids) return `敵艦隊 ${deckId.slice(0, 8)}`;
        const names: string[] = [];
        for (const groupId of toGroupIds(deck.ship_ids)) {
          const ships = shipsByGroupId.get(groupId) || [];
          for (const ship of ships) {
            const id = ship.mst_ship_id;
            if (!id) continue;
            names.push(mstShipNameById.get(id) ?? `艦ID:${id}`);
          }
        }
        const uniq = [...new Set(names)];
        if (uniq.length === 0) return `敵艦隊 ${deckId.slice(0, 8)}`;
        const head = uniq.slice(0, 3).join(" / ");
        return uniq.length > 3 ? `${head} +${uniq.length - 3}` : head;
      };

      const enemyNames = new Map<string, string>();
      for (const battle of sorted) {
        if (!battle.e_deck_id || enemyNames.has(battle.e_deck_id)) continue;
        enemyNames.set(battle.e_deck_id, describeEnemy(battle.e_deck_id));
      }

      const mapKeys = [...new Set(sorted.map((b) => mapLabelOf(b)).filter((key) => key !== "-"))];
      const labelEntries = await Promise.all(
        mapKeys.map(async (mapKey) => {
          const asset = getBattleMapAsset(mapKey);
          if (!asset?.labelsUrl) return [mapKey, {} as Record<number, string>] as const;
          try {
            const response = await fetch(asset.labelsUrl, { headers: { "Content-Type": "application/json" } });
            if (!response.ok) return [mapKey, {} as Record<number, string>] as const;
            const payload = (await response.json()) as Record<string, string>;
            const labels: Record<number, string> = {};
            for (const [rawId, label] of Object.entries(payload || {})) {
              const id = Number(rawId);
              if (!Number.isFinite(id) || typeof label !== "string" || !label) continue;
              labels[id] = label;
            }
            return [mapKey, labels] as const;
          } catch {
            return [mapKey, {} as Record<number, string>] as const;
          }
        }),
      );

      const labelsByMap: Record<string, Record<number, string>> = {};
      for (const [mapKey, labels] of labelEntries) {
        labelsByMap[mapKey] = labels;
      }

      setAllBattles(sorted);
      setEnemyDeckNameById(enemyNames);
      setCellLabelsByMapKey(labelsByMap);
      setCurrentPage(0);
      if (mapFilter() && !sorted.some((b) => mapLabelOf(b) === mapFilter())) {
        setMapFilter("");
      }
    } catch (e) {
      setError(`読込エラー: ${String(e)}`);
      setAllBattles([]);
    } finally {
      setLoading(false);
    }
  }

  function moveToDetail(battle: BattleRecord, fallbackIndex: number) {
    try {
      sessionStorage.setItem("battleDetail", JSON.stringify(battle));
    } catch {
      // Ignore storage errors and keep navigation.
    }
    const detailId = battle.uuid || String(fallbackIndex);
    window.location.href = `/battles/${encodeURIComponent(detailId)}`;
  }

  onMount(() => {
    void loadBattles();
  });

  return (
    <>
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
            <div class="form-control">
              <label class="label"><span class="label-text">マップ</span></label>
              <select
                class="select select-bordered select-sm"
                value={mapFilter()}
                onInput={(e) => {
                  setMapFilter(e.currentTarget.value);
                  setCurrentPage(0);
                }}
              >
                <option value="">全て</option>
                <For each={mapOptions()}>{(map) => <option value={map}>{map}</option>}</For>
              </select>
            </div>
            <div class="form-control">
              <label class="label"><span class="label-text">結果</span></label>
              <select
                class="select select-bordered select-sm"
                value={resultFilter()}
                onInput={(e) => {
                  setResultFilter(e.currentTarget.value);
                  setCurrentPage(0);
                }}
              >
                <option value="">全て</option>
                <option value="S">S勝利</option>
                <option value="A">A勝利</option>
                <option value="B">B勝利</option>
                <option value="C">C敗北</option>
                <option value="D">D敗北</option>
              </select>
            </div>
            <button class="btn btn-primary btn-sm" onClick={() => void loadBattles()} disabled={loading()}>
              {loading() ? "読込中..." : "読込"}
            </button>
          </div>
          <Show when={error()}>
            {(msg) => <p class="mt-3 text-sm text-error">{msg()}</p>}
          </Show>
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm mb-6">
        <div class="card-body p-4">
          <h3 class="font-bold">直近の進軍ルート（サマリ）</h3>
          <div class="text-sm text-base-content/70">
            <Show
              when={recentSummary().length > 0}
              fallback={<span>読込後に最新の進軍順路と交戦結果を表示します。</span>}
            >
              <For each={recentSummary()}>
                {(b) => {
                  const rank = battleResultOf(b)?.win_rank ?? "-";
                  return (
                    <div class="py-1 border-b border-base-200">
                      <span class="font-mono text-xs mr-2">{formatTimestamp(b.timestamp)}</span>
                      <span class="badge badge-ghost badge-sm mr-2">{mapLabelOf(b)}</span>
                      <span class="mr-2">{cellDisplayLabelOf(b)}</span>
                      <span class="mr-2">
                        {b.e_deck_id
                          ? (enemyDeckNameById().get(b.e_deck_id) ?? `敵艦隊 ${b.e_deck_id.slice(0, 8)}`)
                          : "-"}
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
                <Show when={!loading()} fallback={<tr><td colspan={8} class="text-center py-12"><span class="loading loading-spinner loading-md"></span></td></tr>}>
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
                        const detailId = b.uuid || String(fallbackIdx);
                        const detailHref = `/battles/${encodeURIComponent(detailId)}`;
                        return (
                          <tr class="hover cursor-pointer" onClick={() => moveToDetail(b, fallbackIdx)}>
                            <td class="whitespace-nowrap">{formatTimestamp(b.timestamp)}</td>
                            <td>{mapLabelOf(b)}</td>
                            <td>{cellDisplayLabelOf(b)}</td>
                            <td>{FORMATION_NAMES[formation] ?? "-"}</td>
                            <td>{airSup != null ? AIR_SUPERIORITY_NAMES[airSup] ?? String(airSup) : "-"}</td>
                            <td><span class={`badge badge-sm ${WIN_RANK_BADGES[rank] ?? ""}`}>{rank}</span></td>
                            <td>{result?.drop_ship_id ? `#${result.drop_ship_id}` : "-"}</td>
                            <td>
                              <a
                                href={detailHref}
                                class="btn btn-ghost btn-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  try {
                                    sessionStorage.setItem("battleDetail", JSON.stringify(b));
                                  } catch {
                                    // Ignore storage errors.
                                  }
                                }}
                              >
                                詳細
                              </a>
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
