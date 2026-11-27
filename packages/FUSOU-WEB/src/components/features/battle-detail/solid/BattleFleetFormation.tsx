/** @jsxImportSource solid-js */
import { createMemo, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { LoadingState } from "@/components/common/solid/LoadingState";
import {
  formatNullableNumber,
  getDamageState,
  hpFillClass,
} from "@/features/battles/helpers";
import type {
  MstSlotItemRecord,
  ShipInfo,
} from "@/features/battles/types";
import { EquipmentBadge, ShipBanner, slotItemMeta } from "./ui";

export interface AirBaseFormation {
  baseNo: number | null;
  slotItemIds: number[];
  actionLabel?: string | null;
  range?: number | null;
}

export interface BattleFleetFormationProps {
  friendlyShips: ShipInfo[];
  enemyShips: ShipInfo[];
  supportShips?: ShipInfo[];
  friendlyForceShips?: ShipInfo[];
  airBaseFormations?: AirBaseFormation[];
  mstSlotItemById: Map<number, MstSlotItemRecord> | null;
  loading?: boolean;
  enemyEmptyLabel?: string;
}

function CompactStackedHp(props: {
  now: number | null;
  max: number | null;
}): JSX.Element {
  const safeMax = createMemo(() => {
    const m = Number(props.max ?? props.now ?? 1);
    return Number.isFinite(m) && m > 0 ? m : 1;
  });
  const clampedNow = createMemo(() => {
    const n = Number(props.now);
    return Number.isFinite(n) ? Math.max(0, Math.min(safeMax(), n)) : 0;
  });
  const pct = createMemo(() => (clampedNow() / safeMax()) * 100);
  const fillCls = createMemo(() =>
    clampedNow() <= 0 ? "bg-base-content/30" : hpFillClass(pct()),
  );

  return (
    <div
      class="inline-flex flex-col items-stretch gap-0.5 w-[64px] shrink-0"
      title={`HP ${formatNullableNumber(props.now)} / ${formatNullableNumber(props.max ?? props.now)}`}
    >
      <div class="font-mono tabular-nums text-[10px] leading-none text-center text-base-content/55">
        <span class="text-base-content font-semibold">
          {formatNullableNumber(props.now)}
        </span>
        /{formatNullableNumber(props.max ?? props.now)}
      </div>
      <div class="h-1.5 w-full rounded-full overflow-hidden bg-base-300/80">
        <div
          class={`h-full rounded-full ${fillCls()}`}
          style={{ width: `${pct().toFixed(1)}%` }}
        />
      </div>
    </div>
  );
}

function ShipStateBadges(props: { ship: ShipInfo }): JSX.Element | null {
  const damageState = createMemo(() => {
    const now = props.ship.nowhp;
    const max = props.ship.maxhp ?? props.ship.nowhp;
    if (now === null || max === null || max <= 0) return null;
    const st = getDamageState(now, max);
    if (st.label === "無傷" || st.label === "健在" || st.label === "不明") {
      return null;
    }
    return st;
  });

  const damageToneCls = createMemo(() => {
    const label = damageState()?.label;
    if (label === "撃沈") {
      return "text-base-content/60 bg-base-200 border-base-content/30";
    }
    if (label === "大破") {
      return "text-error bg-error/10 border-error/40";
    }
    if (label === "中破") {
      return "text-warning bg-warning/10 border-warning/40";
    }
    if (label === "小破") {
      return "text-info bg-info/10 border-info/35";
    }
    return "";
  });

  return (
    <Show when={props.ship.escaped || damageState()}>
      <div class="inline-flex items-center gap-1 shrink-0">
        <Show when={props.ship.escaped}>
          <span class="inline-flex items-center justify-center h-4 px-1.5 rounded text-[10px] leading-none font-semibold shrink-0 border border-base-content/30 bg-base-200 text-base-content/75">
            退避
          </span>
        </Show>
        <Show when={damageState()}>
          {(st) => (
            <span
              class={`inline-flex items-center justify-center h-4 px-1.5 rounded text-[10px] leading-none font-semibold shrink-0 border ${damageToneCls()}`}
            >
              {st().label}
            </span>
          )}
        </Show>
      </div>
    </Show>
  );
}

function CompactShipRow(props: { ship: ShipInfo }): JSX.Element {
  const hasStats = createMemo(
    () =>
      props.ship.karyoku !== null ||
      props.ship.raisou !== null ||
      props.ship.taiku !== null ||
      props.ship.soukou !== null,
  );
  const hasHp = createMemo(
    () => props.ship.nowhp !== null || props.ship.maxhp !== null,
  );

  return (
    <div
      class={`px-2.5 py-2 space-y-1.5 border-t first:border-t-0 border-base-300/60 ${
        props.ship.escaped ? "opacity-75 bg-base-200/40" : ""
      }`}
    >
      {/* Left-packed ship cluster: Banner -> Name/Stats -> HP bar -> State/Escape labels */}
      <div class="flex items-center gap-2 min-w-0">
        <div
          class="relative w-[88px] h-[22px] shrink-0 rounded overflow-hidden border border-base-300/75 bg-base-200/60"
          title={`${props.ship.name}${props.ship.escaped ? "（退避）" : ""}`}
        >
          <ShipBanner
            src={props.ship.bannerUrl || undefined}
            alt={props.ship.name}
            class={`w-[88px] h-[22px] rounded-none ${
              props.ship.escaped ? "grayscale opacity-55" : ""
            }`}
          />
        </div>
        <div class="w-[126px] shrink-0 min-w-0">
          <div class="flex items-baseline gap-1.5 min-w-0">
            <span
              class={`text-xs font-semibold truncate ${
                props.ship.escaped ? "text-base-content/60" : "text-base-content"
              }`}
              title={props.ship.name}
            >
              {props.ship.name}
            </span>
            <Show when={props.ship.level !== null}>
              <span class="font-mono tabular-nums text-[10px] shrink-0 text-base-content/55">
                Lv{props.ship.level}
              </span>
            </Show>
          </div>
          <Show when={hasStats()}>
            <div class="font-mono tabular-nums text-[10px] flex items-center gap-1.5 text-base-content/55">
              <span>火{props.ship.karyoku ?? "-"}</span>
              <span>雷{props.ship.raisou ?? "-"}</span>
              <span>対{props.ship.taiku ?? "-"}</span>
              <span>装{props.ship.soukou ?? "-"}</span>
            </div>
          </Show>
        </div>
        <Show when={hasHp()}>
          <CompactStackedHp
            now={props.ship.nowhp}
            max={props.ship.maxhp ?? props.ship.nowhp}
          />
        </Show>
        <ShipStateBadges ship={props.ship} />
      </div>

      <Show when={Array.isArray(props.ship.equipments) && props.ship.equipments.length > 0}>
        <div class="flex flex-wrap gap-1 text-[11px] text-base-content/75">
          <For each={props.ship.equipments}>
            {(eq) => (
              <EquipmentBadge
                name={eq.name}
                iconType={eq.iconType}
                level={eq.level}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function FleetCard(props: {
  title: string;
  subTitle?: string | undefined;
  toneClass: string;
  ships: ShipInfo[];
  loading?: boolean | undefined;
  emptyLabel: string;
}): JSX.Element {
  return (
    <div class="fusou-card overflow-hidden min-w-0">
      <div class="px-3 py-1.5 border-b border-base-300/60 bg-base-200/50 flex items-center justify-between gap-2">
        <span class={`text-xs font-semibold ${props.toneClass}`}>
          {props.title}
        </span>
        <Show when={props.subTitle}>
          <span class="text-[10px] text-base-content/50">{props.subTitle}</span>
        </Show>
      </div>
      <Show
        when={props.ships.length > 0}
        fallback={
          <div class="flex items-center justify-center py-6 text-base-content/40">
            <Show
              when={props.loading}
              fallback={<span class="text-xs">{props.emptyLabel}</span>}
            >
              <LoadingState message="艦隊データ読込中…" size="sm" />
            </Show>
          </div>
        }
      >
        <div>
          <For each={props.ships}>
            {(ship) => <CompactShipRow ship={ship} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

function AirBaseSquadronCard(props: {
  formation: AirBaseFormation;
  mstSlotItemById: Map<number, MstSlotItemRecord> | null;
}): JSX.Element {
  return (
    <div class="fusou-card overflow-hidden min-w-0">
      <div class="px-3 py-1.5 border-b border-base-300/60 bg-base-200/50 flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-info">
          <Show
            when={props.formation.baseNo != null}
            fallback={<span>基地航空隊</span>}
          >
            第{props.formation.baseNo}基地航空隊
          </Show>
        </span>
        <Show when={props.formation.actionLabel || props.formation.range != null}>
          <span class="text-[10px] font-mono tabular-nums text-base-content/55">
            {[
              props.formation.actionLabel ?? null,
              props.formation.range != null ? `半径${props.formation.range}` : null,
            ]
              .filter(Boolean)
              .join(" / ")}
          </span>
        </Show>
      </div>
      <div class="p-2.5 flex flex-wrap gap-1 text-[11px] text-base-content/75">
        <For each={props.formation.slotItemIds}>
          {(slotItemId) => {
            const meta = createMemo(() =>
              slotItemMeta(slotItemId, props.mstSlotItemById),
            );
            return (
              <EquipmentBadge
                name={meta().name || `装備#${slotItemId}`}
                iconType={meta().iconType}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}

function AirBaseStackedCard(props: {
  formations: AirBaseFormation[];
  mstSlotItemById: Map<number, MstSlotItemRecord> | null;
  columnsClass?: string;
}): JSX.Element {
  return (
    <div class="fusou-card overflow-hidden min-w-0">
      <div class="px-3 py-1.5 border-b border-base-300/60 bg-base-200/50">
        <span class="text-xs font-semibold text-info">基地航空隊</span>
      </div>
      <div class={props.columnsClass ?? "divide-y divide-base-300/60"}>
        <For each={props.formations}>
          {(ab) => (
            <div class="px-2.5 py-2 min-w-0">
              <div class="flex items-center justify-between gap-2 mb-1.5">
                <span class="text-xs font-semibold text-base-content">
                  <Show when={ab.baseNo != null} fallback={<span>基地航空隊</span>}>
                    第{ab.baseNo}基地航空隊
                  </Show>
                </span>
                <Show when={ab.actionLabel || ab.range != null}>
                  <span class="text-[10px] font-mono tabular-nums text-base-content/55">
                    {[
                      ab.actionLabel ?? null,
                      ab.range != null ? `半径${ab.range}` : null,
                    ]
                      .filter(Boolean)
                      .join(" / ")}
                  </span>
                </Show>
              </div>
              <div class="flex flex-wrap gap-1 text-[11px] text-base-content/75">
                <For each={ab.slotItemIds}>
                  {(slotItemId) => {
                    const meta = createMemo(() =>
                      slotItemMeta(slotItemId, props.mstSlotItemById),
                    );
                    return (
                      <EquipmentBadge
                        name={meta().name || `装備#${slotItemId}`}
                        iconType={meta().iconType}
                      />
                    );
                  }}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export default function BattleFleetFormation(
  props: BattleFleetFormationProps,
): JSX.Element {
  const friendlyCombined = createMemo(() => props.friendlyShips.length > 6);
  const enemyCombined = createMemo(() => props.enemyShips.length > 6);
  const isAnyCombined = createMemo(() => friendlyCombined() || enemyCombined());

  const supportShips = createMemo(() => props.supportShips ?? []);
  const friendlyForceShips = createMemo(() => props.friendlyForceShips ?? []);
  const airBases = createMemo(() => props.airBaseFormations ?? []);

  const hasSupport = createMemo(() => supportShips().length > 0);
  const hasFriendlyForce = createMemo(() => friendlyForceShips().length > 0);
  const hasAirBase = createMemo(() => airBases().length > 0);
  const hasAuxShips = createMemo(() => hasSupport() || hasFriendlyForce());

  // Combined mode: 3rd lane holds support+friendlyForce (if any), or airbases (if no aux ships).
  // When both aux ships AND airbases exist in combined mode, airbases render as a balanced 3-col strip below.
  const combinedHasThirdLane = createMemo(() => hasAuxShips() || hasAirBase());
  const combinedAirBaseSeparateStrip = createMemo(
    () => isAnyCombined() && hasAuxShips() && hasAirBase(),
  );

  // Single-fleet mode: count total ship cards (2 = friend+enemy, 3 = +1 aux, 4 = +support+friendlyForce)
  const singleShipCardCount = createMemo(
    () => 2 + (hasSupport() ? 1 : 0) + (hasFriendlyForce() ? 1 : 0),
  );
  // If single-fleet has 3 ship cards (e.g. friend+enemy+support) + airbases, render airbases in a clean 3-col strip below.
  // If 2 ship cards + airbases, airbases fill the 3rd column. If 4 ship cards + airbases, airbases span 2 cols next to the 4th card!
  const singleAirBaseSeparateStrip = createMemo(
    () => !isAnyCombined() && hasAirBase() && singleShipCardCount() === 3,
  );

  return (
    <div class="space-y-3 mb-6">
      <Show
        when={isAnyCombined()}
        fallback={
          /* Single-Fleet Mode: balanced 2-col or 3-col flat grid (zero tabs) */
          <div
            class={`grid grid-cols-1 md:grid-cols-2 ${
              singleShipCardCount() >= 3 || hasAirBase() ? "lg:grid-cols-3" : ""
            } gap-3 items-start`}
          >
            <FleetCard
              title="味方艦隊"
              toneClass="text-info"
              ships={props.friendlyShips}
              loading={props.loading}
              emptyLabel="味方艦隊データなし"
            />
            <FleetCard
              title="敵艦隊"
              toneClass="text-error"
              ships={props.enemyShips}
              loading={props.loading}
              emptyLabel={props.enemyEmptyLabel ?? "敵艦隊データなし"}
            />
            <Show when={hasSupport()}>
              <FleetCard
                title="支援艦隊"
                toneClass="text-warning"
                ships={supportShips()}
                emptyLabel="支援艦隊データなし"
              />
            </Show>
            <Show when={hasFriendlyForce()}>
              <FleetCard
                title="友軍艦隊"
                toneClass="text-success"
                ships={friendlyForceShips()}
                emptyLabel="友軍艦隊データなし"
              />
            </Show>
            <Show when={hasAirBase() && !singleAirBaseSeparateStrip()}>
              <div
                class={
                  singleShipCardCount() === 4
                    ? "md:col-span-2 lg:col-span-2 min-w-0"
                    : "min-w-0"
                }
              >
                <AirBaseStackedCard
                  formations={airBases()}
                  mstSlotItemById={props.mstSlotItemById}
                  columnsClass={
                    singleShipCardCount() === 4 && airBases().length > 1
                      ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-base-300/60"
                      : "divide-y divide-base-300/60"
                  }
                />
              </div>
            </Show>
          </div>
        }
      >
        {/* Combined-Fleet Mode: 3 balanced vertical lanes (Left: Friend 1+2 | Center: Enemy Main+Escort | Right: Support+FriendlyForce or Airbases) */}
        <div
          class={`grid grid-cols-1 md:grid-cols-2 ${
            combinedHasThirdLane() ? "lg:grid-cols-3" : ""
          } gap-3 items-start`}
        >
          {/* Lane 1: Friendly */}
          <div class="space-y-3 min-w-0">
            <Show
              when={friendlyCombined()}
              fallback={
                <FleetCard
                  title="味方艦隊"
                  toneClass="text-info"
                  ships={props.friendlyShips}
                  loading={props.loading}
                  emptyLabel="味方艦隊データなし"
                />
              }
            >
              <FleetCard
                title="味方 第1艦隊"
                subTitle="連合"
                toneClass="text-info"
                ships={props.friendlyShips.slice(0, 6)}
                loading={props.loading}
                emptyLabel="味方第1艦隊データなし"
              />
              <FleetCard
                title="味方 第2艦隊"
                subTitle="連合"
                toneClass="text-info"
                ships={props.friendlyShips.slice(6)}
                loading={props.loading}
                emptyLabel="味方第2艦隊データなし"
              />
            </Show>
          </div>

          {/* Lane 2: Enemy */}
          <div class="space-y-3 min-w-0">
            <Show
              when={enemyCombined()}
              fallback={
                <FleetCard
                  title="敵艦隊"
                  toneClass="text-error"
                  ships={props.enemyShips}
                  loading={props.loading}
                  emptyLabel={props.enemyEmptyLabel ?? "敵艦隊データなし"}
                />
              }
            >
              <FleetCard
                title="敵 主力艦隊"
                subTitle="敵連合"
                toneClass="text-error"
                ships={props.enemyShips.slice(0, 6)}
                loading={props.loading}
                emptyLabel="敵主力艦隊データなし"
              />
              <FleetCard
                title="敵 随伴艦隊"
                subTitle="敵連合"
                toneClass="text-error"
                ships={props.enemyShips.slice(6)}
                loading={props.loading}
                emptyLabel="敵随伴艦隊データなし"
              />
            </Show>
          </div>

          {/* Lane 3: Support + Friendly Force stacked cleanly (or Airbases if no aux ships) */}
          <Show when={combinedHasThirdLane()}>
            <div class="space-y-3 min-w-0 md:col-span-2 lg:col-span-1">
              <Show when={hasSupport()}>
                <FleetCard
                  title="支援艦隊"
                  toneClass="text-warning"
                  ships={supportShips()}
                  emptyLabel="支援艦隊データなし"
                />
              </Show>
              <Show when={hasFriendlyForce()}>
                <FleetCard
                  title="友軍艦隊"
                  toneClass="text-success"
                  ships={friendlyForceShips()}
                  emptyLabel="友軍艦隊データなし"
                />
              </Show>
              <Show when={!hasAuxShips() && hasAirBase()}>
                <AirBaseStackedCard
                  formations={airBases()}
                  mstSlotItemById={props.mstSlotItemById}
                />
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      {/* Horizontal 3-column Airbase Strip when auxiliary ship fleets already fill the 3rd lane */}
      <Show when={combinedAirBaseSeparateStrip() || singleAirBaseSeparateStrip()}>
        <div
          class={`grid grid-cols-1 ${
            airBases().length === 1
              ? ""
              : airBases().length === 2
                ? "md:grid-cols-2"
                : "md:grid-cols-2 lg:grid-cols-3"
          } gap-3 items-start`}
        >
          <For each={airBases()}>
            {(ab) => (
              <AirBaseSquadronCard
                formation={ab}
                mstSlotItemById={props.mstSlotItemById}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
