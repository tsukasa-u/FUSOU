/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import { isSafeImageUrl } from "@/utility/security";
import type { SelectedCellDetails, WeaponIconFrame, WeaponIconMeta } from "./types";
import { WIN_RANK_BADGES } from "./constants";

type Props = {
  details: SelectedCellDetails;
  displayedSortieRoutesCount: number;
  mstShipNameById: Map<number, string>;
  weaponIconFrames: Record<number, WeaponIconFrame>;
  weaponIconMeta: WeaponIconMeta;
  onClear: () => void;
};

function WeaponIcon(props: {
  iconType: number | null;
  frames: Record<number, WeaponIconFrame>;
  meta: WeaponIconMeta;
}) {
  // iconType 0 and negative mean "no icon" in the KC master data
  const frame = () =>
    props.iconType != null && props.iconType > 0
      ? props.frames[props.iconType]
      : undefined;

  return (
    <Show
      when={frame()}
      fallback={
        <span class="inline-flex h-4 w-4 flex-none items-center justify-center rounded text-[9px] text-base-content/60">
          ?
        </span>
      }
    >
      {(f) => {
        // f() is the WeaponIconFrame object (the resolved when-accessor value)
        const size = 16;
        const ratioX = size / f().w;
        const ratioY = size / f().h;
        return (
          <span
            class="inline-block flex-none overflow-hidden rounded"
            style={{ width: `${size}px`, height: `${size}px` }}
          >
            <img
              src="/api/asset-sync/weapon-icons"
              alt=""
              class="block max-w-none opacity-0 transition-opacity duration-150"
              style={{
                width: `${props.meta.width * ratioX}px`,
                height: `${props.meta.height * ratioY}px`,
                "margin-left": `-${f().x * ratioX}px`,
                "margin-top": `-${f().y * ratioY}px`,
              }}
              onLoad={(e) => {
                (e.currentTarget as HTMLImageElement).classList.replace("opacity-0", "opacity-100");
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </span>
        );
      }}
    </Show>
  );
}

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
              when={d().topEnemyFleets.length > 0}
              fallback={<div class="text-xs text-base-content/50">戦闘記録はありません</div>}
            >
              <div class="space-y-2">
                <For each={d().topEnemyFleets}>
                  {(fleet) => (
                    <div class="rounded-box bg-base-200 px-2 py-1.5">
                      {/* Fleet header */}
                      <div class="mb-1 flex items-center justify-between text-[11px]">
                        <span class="font-semibold text-base-content/80">遭遇 {fleet.count} 回</span>
                        <span class="text-base-content/50">艦数 {fleet.ships.length}</span>
                      </div>
                      {/* Ships */}
                      <div class="divide-y divide-base-300">
                        <For each={fleet.ships}>
                          {(ship) => (
                            <div class="py-1 first:pt-0 last:pb-0">
                              {/* Ship header: banner + name + params */}
                              <div class="flex min-w-0 items-center gap-1.5">
                                <span class="h-5 w-20 inline-block flex-none rounded overflow-hidden">
                                  <Show when={ship.bannerUrl && isSafeImageUrl(ship.bannerUrl)}>
                                    <img
                                      src={ship.bannerUrl}
                                      alt={ship.name}
                                      class="h-full w-full rounded object-cover opacity-0 transition-opacity duration-200"
                                      loading="lazy"
                                      onLoad={(e) => {
                                        (e.currentTarget as HTMLImageElement).classList.replace("opacity-0", "opacity-100");
                                      }}
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = "none";
                                      }}
                                    />
                                  </Show>
                                </span>
                                <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-base-content/90">
                                  {ship.name}
                                </span>
                                <span class="flex-none text-[10px] text-base-content/55">
                                  火{ship.karyoku ?? "-"} 雷{ship.raisou ?? "-"} 対{ship.taiku ?? "-"} 装{ship.soukou ?? "-"}
                                </span>
                              </div>
                              {/* Equipment: inline badges */}
                              <Show when={ship.equipments.length > 0}>
                                <div class="mt-0.5 flex flex-wrap gap-0.5 pl-1">
                                  <For each={ship.equipments}>
                                    {(equip) => (
                                      <span class="inline-flex items-center gap-0.5 rounded bg-base-100 px-1 py-0.5 text-[10px] text-base-content/70 ring-1 ring-base-300">
                                        <WeaponIcon
                                          iconType={equip.iconType}
                                          frames={props.weaponIconFrames}
                                          meta={props.weaponIconMeta}
                                        />
                                        {equip.name}
                                      </span>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
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
                            ドロップ: {props.mstShipNameById.get(dropId()) ?? `艦ID:${dropId()}`}
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
