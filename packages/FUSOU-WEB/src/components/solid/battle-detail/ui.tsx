/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { ShipInfo, BattleFleets } from "@/pages/battles/lib/types";
import { getDamageState, hpFillClass } from "@/pages/battles/lib/helpers";
import { getWeaponIconCaches } from "@/pages/battles/lib/data-service";
import { isSafeImageUrl } from "@/utility/security";

// ── Pure helpers (no JSX) ─────────────────────────────────────────────────

export function shipNameFromIndex(
  side: "friend" | "enemy",
  idx: number,
  fleets: BattleFleets | null,
): string {
  const list = side === "friend" ? fleets?.friendlyShips : fleets?.enemyShips;
  const ship = Array.isArray(list) ? list[idx] : null;
  return ship?.name ?? `艦${idx + 1}`;
}

export function shipSlotLabel(idx: number): string {
  return `${(idx ?? 0) + 1}番`;
}

export function maxHpForShip(
  side: "friend" | "enemy",
  idx: number,
  fallbackHp: number,
  fleets: BattleFleets | null,
): number {
  const ship =
    (side === "friend"
      ? fleets?.friendlyShips
      : fleets?.enemyShips)?.[idx] ?? null;
  return Number(ship?.maxhp ?? fallbackHp ?? 0) || 0;
}

export function getRowHpSnapshot(
  row: Record<string, unknown>,
  side: "friend" | "enemy",
): unknown[] {
  if (side === "friend") {
    return Array.isArray(row?.f_now_hps)
      ? (row.f_now_hps as unknown[])
      : Array.isArray(row?.f_nowhps)
        ? (row.f_nowhps as unknown[])
        : [];
  }
  return Array.isArray(row?.e_now_hps)
    ? (row.e_now_hps as unknown[])
    : Array.isArray(row?.e_nowhps)
      ? (row.e_nowhps as unknown[])
      : [];
}

export function slotItemMeta(
  slotItemId: unknown,
  mstSlotItemById: Map<number, Record<string, unknown>> | null,
): { name: string; iconType: number | null } {
  const mst = mstSlotItemById?.get?.(Number(slotItemId ?? 0));
  if (!mst) return { name: `装備${slotItemId}`, iconType: null };
  const iconType =
    Array.isArray(mst.type) && (mst.type as unknown[]).length >= 4
      ? Number((mst.type as unknown[])[3] ?? 0) || null
      : null;
  return { name: String(mst.name ?? `装備${slotItemId}`), iconType };
}

// ── JSX components ────────────────────────────────────────────────────────

export function WeaponIcon(props: { iconType: number | null | undefined }): JSX.Element {
  const fallback = (
    <span class="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-base-300 text-[9px] text-base-content/50">
      ?
    </span>
  );
  const iconId = () => Number(props.iconType ?? 0);

  return (
    <Show when={iconId() > 0} fallback={fallback}>
      {(() => {
        const { frames, meta } = getWeaponIconCaches();
        const frame = frames?.[iconId()];
        if (!frame || frame.w <= 0 || frame.h <= 0 || meta.width <= 0 || meta.height <= 0) {
          return fallback;
        }
        const size = 14;
        const ratioX = size / frame.w;
        const ratioY = size / frame.h;
        return (
          <span
            class="inline-block overflow-hidden rounded align-middle"
            style={{ width: `${size}px`, height: `${size}px` }}
          >
            <img
              src="/api/asset-sync/weapon-icons"
              alt=""
              style={{
                display: "block",
                "max-width": "none",
                width: `${meta.width * ratioX}px`,
                height: `${meta.height * ratioY}px`,
                "margin-left": `-${frame.x * ratioX}px`,
                "margin-top": `-${frame.y * ratioY}px`,
              }}
            />
          </span>
        );
      })()}
    </Show>
  );
}

export function EquipmentBadge(props: {
  name?: string;
  iconType?: number | null;
  level?: number | null;
}): JSX.Element {
  return (
    <span class="inline-flex items-center gap-1 rounded bg-base-100 px-1.5 py-0.5 ring-1 ring-base-300">
      <WeaponIcon iconType={props.iconType ?? null} />
      <span>
        {props.name ?? "装備不明"}
        {props.level != null && props.level > 0 ? ` +${props.level}` : ""}
      </span>
    </span>
  );
}

export function EquipmentBadgesFromSlotIds(props: {
  slotIds: unknown[];
  mstSlotItemById: Map<number, Record<string, unknown>> | null;
}): JSX.Element {
  const items = () =>
    (props.slotIds ?? [])
      .map((id) => slotItemMeta(id, props.mstSlotItemById))
      .filter((m) => m.name);
  return (
    <Show when={items().length > 0} fallback={<></>}>
      <For each={items()}>
        {(meta) => <EquipmentBadge name={meta.name} iconType={meta.iconType} />}
      </For>
    </Show>
  );
}

export function InlineHpMeter(props: {
  current: number;
  max: number;
  class?: string;
}): JSX.Element {
  const safeCurrent = () => Number(props.current ?? 0) || 0;
  const safeMax = () => Number(props.max ?? props.current ?? 0) || 0;
  const pct = () =>
    safeMax() > 0
      ? Math.max(0, Math.min(100, (safeCurrent() / safeMax()) * 100))
      : 0;
  return (
    <span class={`inline-flex items-center gap-1 ${props.class ?? ""}`}>
      <span class="font-mono">
        {safeCurrent()}/{safeMax()}
      </span>
      <span class="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-base-300 align-middle">
        <span
          class={`block h-full ${hpFillClass(pct())} rounded-full`}
          style={{ width: `${pct()}%` }}
        />
      </span>
    </span>
  );
}

export function CompactHpBadge(props: { current: number; max: number }): JSX.Element {
  const safeCurrent = () => Number(props.current ?? 0) || 0;
  const safeMax = () => Number(props.max ?? props.current ?? 0) || 0;
  const pct = () =>
    safeMax() > 0
      ? Math.max(0, Math.min(100, (safeCurrent() / safeMax()) * 100))
      : 0;
  const state = () => getDamageState(props.current, props.max);
  return (
    <div class="inline-flex min-w-[92px] flex-col gap-1 rounded bg-base-100 px-2 py-1 ring-1 ring-base-300">
      <div class="flex items-center justify-between gap-2 text-[11px] leading-none">
        <span class="font-mono">
          {safeCurrent()}/{safeMax()}
        </span>
        <span class={`badge badge-xs ${state().cls}`}>{state().label}</span>
      </div>
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-base-300">
        <div
          class={`h-full ${hpFillClass(pct())} rounded-full transition-all`}
          style={{ width: `${pct()}%` }}
        />
      </div>
    </div>
  );
}

export function HPBar(props: { current: number; max: number; label?: string }): JSX.Element {
  const pct = () => (props.max > 0 ? Math.max(0, (props.current / props.max) * 100) : 0);
  const color = () => {
    const p = pct();
    if (p <= 25) return "bg-error";
    if (p <= 50) return "bg-warning";
    if (p <= 75) return "bg-info";
    return "bg-success";
  };
  return (
    <div class="flex items-center gap-2">
      <span class="text-[11px] w-12 text-base-content/60 truncate">{props.label ?? ""}</span>
      <div class="flex-1 h-2.5 bg-base-300 rounded-full overflow-hidden">
        <div
          class={`h-full ${color()} rounded-full transition-all`}
          style={{ width: `${pct()}%` }}
        />
      </div>
      <span class="text-[11px] font-mono text-base-content/70 w-14 text-right">
        {props.current}/{props.max}
      </span>
    </div>
  );
}

export function ShipIndexBadge(props: { idx: number }): JSX.Element {
  return <span class="badge badge-ghost badge-sm">{shipSlotLabel(props.idx)}</span>;
}

export function OutcomeBadges(props: {
  damage: number;
  crit: boolean;
  protect: boolean;
  sunk: boolean;
  afterState: string;
}): JSX.Element {
  return (
    <>
      <Show
        when={props.damage > 0}
        fallback={<span class="badge badge-neutral badge-sm">MISS</span>}
      >
        <span class="badge badge-outline badge-sm font-mono">-{props.damage}</span>
      </Show>
      <Show when={props.crit}>
        <span class="badge badge-error badge-sm">Critical</span>
      </Show>
      <Show when={props.protect}>
        <span class="badge badge-warning badge-sm">防御</span>
      </Show>
      <Show when={props.sunk}>
        <span class="badge badge-neutral badge-sm">撃沈</span>
      </Show>
      <Show when={!props.sunk && props.afterState === "大破"}>
        <span class="badge badge-error badge-sm">大破</span>
      </Show>
      <Show when={!props.sunk && props.afterState === "中破"}>
        <span class="badge badge-warning badge-sm">中破</span>
      </Show>
      <Show when={!props.sunk && props.afterState === "小破"}>
        <span class="badge badge-info badge-sm">小破</span>
      </Show>
    </>
  );
}

export function PhaseParticipant(props: {
  name: string;
  side: "friend" | "enemy";
  idx: number;
  hpCurrent: number;
  hpMax: number;
}): JSX.Element {
  const tone = () => (props.side === "enemy" ? "text-error" : "text-info");
  return (
    <div class="min-w-0 rounded bg-base-100 px-2 py-1 border border-base-300">
      <div class="mb-1 flex items-center gap-1.5">
        <ShipIndexBadge idx={props.idx} />
        <div class={`truncate text-xs font-semibold ${tone()}`}>{props.name}</div>
      </div>
      <div class="text-[10px] text-base-content/65">
        <InlineHpMeter current={props.hpCurrent} max={props.hpMax} />
      </div>
    </div>
  );
}

export function PhaseSummaryBadges(props: { items: (string | null)[] }): JSX.Element {
  const filtered = () => (props.items ?? []).filter(Boolean) as string[];
  return (
    <Show
      when={filtered().length > 0}
      fallback={<span class="badge badge-ghost badge-sm">記録なし</span>}
    >
      <For each={filtered()}>
        {(item) => <span class="badge badge-outline badge-sm">{item}</span>}
      </For>
    </Show>
  );
}

export function FleetSummary(props: { ships: ShipInfo[]; sideLabel: string }): JSX.Element {
  const totalNow = () =>
    props.ships.reduce((s, ship) => s + (Number(ship.nowhp ?? 0) || 0), 0);
  const totalMax = () =>
    props.ships.reduce((s, ship) => s + (Number(ship.maxhp ?? ship.nowhp ?? 0) || 0), 0);
  const taiha = () =>
    props.ships.filter((ship) => getDamageState(ship.nowhp, ship.maxhp).label === "大破").length;
  const chuuha = () =>
    props.ships.filter((ship) => getDamageState(ship.nowhp, ship.maxhp).label === "中破").length;
  const avgLevel = () => {
    const total = props.ships.reduce((s, ship) => s + (Number(ship.level ?? 0) || 0), 0);
    return Math.round(total / props.ships.length);
  };
  return (
    <div class="mb-2 flex flex-wrap gap-2 text-[11px]">
      <span class="badge badge-outline">
        {props.sideLabel} {props.ships.length}隻
      </span>
      <span class="badge badge-outline">
        総HP {totalNow()}/{totalMax()}
      </span>
      <span class="badge badge-outline">
        平均Lv {Number.isFinite(avgLevel()) ? avgLevel() : "-"}
      </span>
      <Show when={taiha() > 0}>
        <span class="badge badge-error badge-outline">大破 {taiha()}</span>
      </Show>
      <Show when={chuuha() > 0}>
        <span class="badge badge-warning badge-outline">中破 {chuuha()}</span>
      </Show>
    </div>
  );
}

export function ShipRows(props: { ships: ShipInfo[]; sideLabel: string }): JSX.Element {
  return (
    <Show
      when={props.ships.length > 0}
      fallback={<div class="text-sm text-base-content/40">データなし</div>}
    >
      <FleetSummary ships={props.ships} sideLabel={props.sideLabel} />
      <For each={props.ships}>
        {(ship) => {
          const statText = `火${ship.karyoku ?? "-"} 雷${ship.raisou ?? "-"} 対${ship.taiku ?? "-"} 装${ship.soukou ?? "-"}`;
          return (
            <div class="rounded-box bg-base-200 p-2">
              <div class="flex items-center gap-2 mb-1">
                <Show when={ship.bannerUrl && isSafeImageUrl(ship.bannerUrl)}>
                  <img
                    src={ship.bannerUrl}
                    alt={ship.name}
                    class="h-6 w-24 rounded object-cover"
                    loading="lazy"
                  />
                </Show>
                <div class="min-w-0">
                  <div class="text-sm font-semibold truncate">{ship.name}</div>
                  <div class="text-[11px] text-base-content/60">
                    {ship.level ? `Lv${ship.level} / ` : ""}
                    {statText}
                  </div>
                </div>
                <div class="shrink-0">
                  <CompactHpBadge current={ship.nowhp} max={ship.maxhp ?? ship.nowhp} />
                </div>
              </div>
              <div class="mt-1 flex flex-wrap gap-1 text-[11px] text-base-content/75">
                <Show
                  when={Array.isArray(ship.equipments) && ship.equipments.length > 0}
                  fallback={<span>装備なし</span>}
                >
                  <For each={ship.equipments}>
                    {(eq) => <EquipmentBadge name={eq.name} iconType={eq.iconType} level={eq.level} />}
                  </For>
                </Show>
              </div>
            </div>
          );
        }}
      </For>
    </Show>
  );
}
