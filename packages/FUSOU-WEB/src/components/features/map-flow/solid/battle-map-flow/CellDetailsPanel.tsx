/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import type { SelectedCellDetails } from "./types";
import { WIN_RANK_BADGES } from "./constants";

type Props = {
  details: SelectedCellDetails;
  displayedSortieRoutesCount: number;
  onClear: () => void;
};

export default function CellDetailsPanel(props: Props) {
  const d = () => props.details;

  return (
    <div class="rounded-box border border-secondary/30 bg-secondary/5 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <div class="text-sm font-semibold">{d().mapKey} / {d().label} の戦闘と進路</div>
          <div class="text-xs text-base-content/70">対象セル: {d().label}</div>
        </div>
        <button class="btn btn-ghost btn-xs" onClick={props.onClear}>選択解除</button>
      </div>

      <div class="grid gap-3 lg:grid-cols-4 md:grid-cols-2 mb-4">
        <div class="rounded-box bg-base-100 p-3 text-sm">
          <div class="text-xs text-base-content/60">到達した出撃</div>
          <div class="text-2xl font-semibold">{d().routeCount}</div>
        </div>
        <div class="rounded-box bg-base-100 p-3 text-sm">
          <div class="text-xs text-base-content/60">通過回数</div>
          <div class="text-2xl font-semibold">{d().passCount}</div>
        </div>
        <div class="rounded-box bg-base-100 p-3 text-sm">
          <div class="text-xs text-base-content/60">戦闘発生回数</div>
          <div class="text-2xl font-semibold">{d().battleCount}</div>
        </div>
        <div class="rounded-box bg-base-100 p-3 text-sm">
          <div class="text-xs text-base-content/60">表示中の進路</div>
          <div class="text-2xl font-semibold">{props.displayedSortieRoutesCount}</div>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="space-y-3">
          <div class="rounded-box bg-base-100 p-3">
            <div class="font-semibold text-sm mb-2">よく遭遇する敵艦隊</div>
            <Show
              when={d().topEnemyLabels.length > 0}
              fallback={<div class="text-xs text-base-content/50">戦闘記録はありません</div>}
            >
              <div class="space-y-1.5">
                <For each={d().topEnemyLabels}>
                  {([label, count]) => (
                    <div class="rounded-box bg-base-200 px-3 py-2 text-xs text-base-content/85">
                      <div class="flex items-center justify-between gap-3">
                        <span class="truncate font-medium">{label}</span>
                        <span class="shrink-0 text-base-content/60">遭遇 {count} 回</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <div class="rounded-box bg-base-100 p-3">
            <div class="font-semibold text-sm mb-2">次に進んだ先</div>
            <Show
              when={d().outgoingCounts.length > 0}
              fallback={<div class="text-xs text-base-content/50">このマスで終了した記録のみです</div>}
            >
              <For each={d().outgoingCounts}>
                {([routeLabel, count]) => <div class="text-xs text-base-content/80">{routeLabel} ({count})</div>}
              </For>
            </Show>
          </div>
        </div>

        <div class="space-y-3">
          <div class="rounded-box bg-base-100 p-3">
            <div class="font-semibold text-sm mb-2">勝敗とドロップ</div>
            <div class="flex flex-wrap gap-2 mb-2">
              <For each={d().resultCounts}>
                {([rank, count]) => (
                  <span class={`badge badge-sm ${WIN_RANK_BADGES[rank] ?? "badge-ghost"}`}>
                    {rank} x{count}
                  </span>
                )}
              </For>
            </div>
            <Show
              when={d().dropCounts.length > 0}
              fallback={<div class="text-xs text-base-content/50">艦ドロップ記録はありません</div>}
            >
              <For each={d().dropCounts}>
                {([drop, count]) => <div class="text-xs text-base-content/80">{drop} ({count})</div>}
              </For>
            </Show>
          </div>
          <div class="rounded-box bg-base-100 p-3">
            <div class="font-semibold text-sm mb-2">直近の戦闘</div>
            <Show
              when={d().recentBattles.length > 0}
              fallback={<div class="text-xs text-base-content/50">戦闘記録はありません</div>}
            >
              <div class="space-y-2">
                <For each={d().recentBattles}>
                  {(battle) => (
                    <div class="rounded-box bg-base-200 px-3 py-2 text-xs">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <span>{battle.timestamp}</span>
                        <Show when={battle.result?.win_rank}>
                          {(rank) => (
                            <span class={`badge badge-xs ${WIN_RANK_BADGES[rank()] ?? "badge-ghost"}`}>
                              {rank()}
                            </span>
                          )}
                        </Show>
                      </div>
                      <div class="text-base-content/80">{battle.enemy}</div>
                      <Show when={battle.result?.drop_ship_id}>
                        {(dropId) => (
                          <div class="text-base-content/60">
                            ドロップ: {battle.result?.drop_ship_name ?? `艦ID:${dropId()}`}
                          </div>
                        )}
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
