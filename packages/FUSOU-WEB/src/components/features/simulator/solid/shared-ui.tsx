/** @jsxImportSource solid-js */

/**
 * Shared UI components used by both ShipDetailPanel and EquipDetailPanel.
 * These are pure presentational SolidJS components with no business logic coupling.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  onCleanup,
  type JSX,
} from "solid-js";
import {
  getWeaponIconFrame,
  getSpriteSheetMeta,
  getShipTypeIconFrame,
  getShipTypeSpriteSheetMeta,
} from "@/features/simulator/simulator-selectors";
import {
  toSynergyStatRows,
  splitSynergyStatRows,
  groupItemsByIcon,
  type MultiEntry,
  type MultiComboEntry,
  type MultiPoolEntry,
  type MultiCategoryEntry,
  type MultiGroupedComboEntry,
  type SynergyStatRows as SynergyStatRowsType,
} from "@/features/simulator/synergy-utils";
import { equipDisplayTypeName } from "@/features/simulator/display-utils";
import type { EquipSelectionRequirement } from "@/features/simulator/equip-filter";
import { getMasterShip } from "@/features/simulator/simulator-selectors";
import { STYPE_NAMES } from "@/features/simulator/constants";
import type { MstSlotItemData } from "@/features/simulator/types";

export function StatPill(props: {
  label: string;
  value: number | null | undefined;
  tone: "fire" | "torpedo" | "aa" | "armor";
  showLabel?: boolean;
  hideLabelOnTiny?: boolean;
}): JSX.Element {
  const toneClass = () => {
    switch (props.tone) {
      case "fire":
        return "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300";
      case "torpedo":
        return "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300";
      case "aa":
        return "border-orange-600/30 bg-orange-500/12 text-orange-800 dark:text-orange-200";
      case "armor":
        return "border-yellow-500/35 bg-yellow-400/12 text-yellow-800 dark:text-yellow-200";
    }
  };

  const displayValue = () => {
    if (props.value == null || props.value === 0) return null;
    return `${props.value > 0 ? "+" : ""}${props.value}`;
  };

  return (
    <Show when={displayValue()}>
      {(value) => (
        <span
          class={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-mono font-semibold leading-none whitespace-nowrap border ${toneClass()}`}
          title={`${props.label} ${value()}`}
        >
          <Show when={props.showLabel ?? true}>
            <span class={props.hideLabelOnTiny ? "max-[360px]:hidden" : undefined}>{props.label}</span>
          </Show>
          <span>{value()}</span>
        </span>
      )}
    </Show>
  );
}

// ── LazyRender ───────────────────────────────────────────────────────

export function LazyRender(props: { children: JSX.Element }) {
  const [isVisible, setIsVisible] = createSignal(false);
  let ref: HTMLDivElement | undefined;

  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "10px" },
    );
    if (ref) observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div ref={ref}>
      <Show when={isVisible()} fallback={<div class="min-h-16 w-full" />}>
        {props.children}
      </Show>
    </div>
  );
}

// ── ProgressiveGrid ──────────────────────────────────────────────────

export function ProgressiveGrid<T>(props: {
  data: T[];
  class?: string;
  children: (item: T) => JSX.Element;
}) {
  const [limit, setLimit] = createSignal(40);
  let observerTarget: HTMLDivElement | undefined;

  createEffect(() => {
    // Reset limit when data changes
    props.data;
    setLimit(40);
  });

  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setLimit((l) => l + 40);
        }
      },
      { rootMargin: "200px" },
    );
    if (observerTarget) observer.observe(observerTarget);
    onCleanup(() => observer.disconnect());
  });

  return (
    <>
      <div class={props.class}>
        <For each={props.data.slice(0, limit())}>{props.children}</For>
      </div>
      <Show when={limit() < props.data.length}>
        <div ref={observerTarget} class="h-px w-full" />
      </Show>
    </>
  );
}

// ── WeaponIcon ───────────────────────────────────────────────────────

export function WeaponIcon(props: { iconNum: number; size?: number }): JSX.Element {
  const size = () => props.size ?? 18;
  const frame = () => getWeaponIconFrame(props.iconNum);
  const spriteSheet = () => getSpriteSheetMeta();

  const imgStyle = () => {
    const f = frame();
    const s = spriteSheet();
    if (!f || !s.url) return undefined;
    const [fx, fy, fw, fh] = f;
    const scaleX = size() / fw;
    const scaleY = size() / fh;
    return {
      width: `${s.width * scaleX}px`,
      height: `${s.height * scaleY}px`,
      "margin-left": `-${fx * scaleX}px`,
      "margin-top": `-${fy * scaleY}px`,
      "max-width": "none",
      display: "block",
    };
  };

  return (
    <div
      class="shrink-0 overflow-hidden"
      style={{ width: `${size()}px`, height: `${size()}px` }}
    >
      <Show when={frame() && spriteSheet().url}>
        <img
          src={spriteSheet().url!}
          alt=""
          loading="lazy"
          decoding="async"
          style={imgStyle()}
        />
      </Show>
    </div>
  );
}

// ── ShipTypeIcon ─────────────────────────────────────────────────────

/** 艦種アイコン。height を基準に縦横比を保持してレンダリングする。 */
export function ShipTypeIcon(props: {
  stype: number;
  /** 表示高さ（px）。フレームの縦横比を保持して横幅を自動計算する。 */
  height?: number;
  /** @deprecated `height` を使用してください（後方互換のため残存） */
  size?: number;
}): JSX.Element {
  const displayH = () => props.height ?? props.size ?? 18;
  const frame = () => getShipTypeIconFrame(props.stype);
  const spriteSheet = () => getShipTypeSpriteSheetMeta();

  /** 高さ基準の単一スケールで縦横比を保持する */
  const layout = () => {
    const f = frame();
    if (!f) return { w: displayH(), h: displayH() };
    const [, , fw, fh] = f;
    const scale = displayH() / fh;
    return { w: Math.round(fw * scale), h: displayH(), scale };
  };

  const imgStyle = () => {
    const f = frame();
    const s = spriteSheet();
    const { scale } = layout() as { w: number; h: number; scale?: number };
    if (!f || !s.url || scale == null) return undefined;
    const [fx, fy] = f;
    return {
      width: `${s.width * scale}px`,
      height: `${s.height * scale}px`,
      "margin-left": `-${fx * scale}px`,
      "margin-top": `-${fy * scale}px`,
      "max-width": "none",
      display: "block",
    };
  };

  return (
    <div
      class="shrink-0 overflow-hidden"
      style={{ width: `${layout().w}px`, height: `${layout().h}px` }}
    >
      <Show when={frame() && spriteSheet().url}>
        <img
          src={spriteSheet().url!}
          alt=""
          loading="lazy"
          decoding="async"
          style={imgStyle()}
        />
      </Show>
    </div>
  );
}

// ── ImageFallbackBox ─────────────────────────────────────────────────

export function ImageFallbackBox(props: {
  src: string;
  alt: string;
  class: string;
  fallbackText?: string;
  objectClass?: string;
  loading?: "lazy" | "eager" | undefined;
  fetchpriority?: "high" | "low" | "auto" | undefined;
}): JSX.Element {
  const [errored, setErrored] = createSignal(!props.src);

  createEffect(() => {
    setErrored(!props.src);
  });

  return (
    <div class={`${props.class} overflow-hidden bg-base-200`}>
      <Show
        when={!errored()}
        fallback={
          <div class="w-full h-full flex items-center justify-center text-base-content/20 text-xs">
            {props.fallbackText ?? "No Image"}
          </div>
        }
      >
        <img
          src={props.src}
          alt={props.alt}
          class={props.objectClass ?? "w-full h-full object-cover"}
          loading={props.loading}
          fetchpriority={props.fetchpriority ?? "auto"}
          decoding="async"
          onError={() => setErrored(true)}
        />
      </Show>
    </div>
  );
}

// ── SpecTable ────────────────────────────────────────────────────────

export function SpecTable(props: {
  rows: Array<[label: string, value: string | number]>;
}): JSX.Element {
  const pairedRows = createMemo(() => {
    const chunks: Array<Array<[label: string, value: string | number]>> = [];
    for (let index = 0; index < props.rows.length; index += 2) {
      chunks.push(props.rows.slice(index, index + 2));
    }
    return chunks;
  });

  return (
    <div class="overflow-x-auto rounded-xl border border-base-300/70">
      <table class="table table-fixed table-zebra table-sm w-full sm:hidden">
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr>
                <th class="w-28 md:w-36 text-base-content/65 font-medium whitespace-nowrap">
                  {row[0]}
                </th>
                <td class="font-mono text-right md:text-left">{row[1]}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <table class="hidden sm:table table-fixed table-zebra table-sm w-full">
        <tbody>
          <For each={pairedRows()}>
            {(pair) => (
              <tr>
                <th class="w-28 md:w-36 text-base-content/65 font-medium whitespace-nowrap">
                  {pair[0]?.[0]}
                </th>
                <td class="font-mono text-right md:text-left">
                  {pair[0]?.[1]}
                </td>
                <Show
                  when={pair[1]}
                  fallback={
                    <>
                      <th></th>
                      <td></td>
                    </>
                  }
                >
                  <th class="w-28 md:w-36 text-base-content/65 font-medium whitespace-nowrap">
                    {pair[1]?.[0]}
                  </th>
                  <td class="font-mono text-right md:text-left">
                    {pair[1]?.[1]}
                  </td>
                </Show>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

// ── SynergyStatInline ────────────────────────────────────────────────

export function SynergyStatInline(props: {
  stats: Record<string, number>;
}): JSX.Element {
  const rows = createMemo(() => toSynergyStatRows(props.stats));
  const groupedRows = createMemo(() => splitSynergyStatRows(rows()));

  const renderBadgeRows = (badgeRows: SynergyStatRowsType): JSX.Element => (
    <div class="flex flex-wrap items-center gap-1">
      <For each={badgeRows}>
        {(row) => (
          <span
            class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
              row.value > 0
                ? "text-success border-success/30 bg-success/5"
                : "text-error border-error/30 bg-error/5"
            }`}
          >
            {row.label} {row.value > 0 ? `+${row.value}` : row.value}
          </span>
        )}
      </For>
    </div>
  );

  return (
    <Show
      when={rows().length > 0}
      fallback={<span class="text-xs text-base-content/50">効果なし</span>}
    >
      {renderBadgeRows(groupedRows().core)}
    </Show>
  );
}

// ── CompatibilityBadges ──────────────────────────────────────────────

export function CompatibilityBadges(props: {
  normalSlots: number[];
  slotCount: number;
  exslot: EquipSelectionRequirement | null;
}): JSX.Element {
  const exslotOnly = createMemo(
    () => props.normalSlots.length === 0 && props.exslot != null,
  );

  return (
    <span class="ml-auto inline-flex flex-wrap items-center justify-end gap-1 shrink-0">
      <Show when={exslotOnly()}>
        <span class="badge badge-warning badge-xs">補強のみ</span>
      </Show>
      <Show
        when={
          props.exslot != null &&
          (props.exslot.level > 0 || props.exslot.alv > 0)
        }
      >
        <span class="badge badge-outline badge-xs border-warning text-warning">
          {[
            props.exslot!.level > 0 ? `補強★${props.exslot!.level}` : null,
            props.exslot!.alv > 0 ? `熟${props.exslot!.alv}` : null,
          ]
            .filter(Boolean)
            .join(" /")}
        </span>
      </Show>
    </span>
  );
}

// ── EquipListRow ─────────────────────────────────────────────────────

export function EquipListRow(props: {
  equip: MstSlotItemData;
  active: boolean;
  onSelect: () => void;
  onPreview?: () => void;
  showStatLabels?: boolean;
  showStats?: boolean;
}): JSX.Element {
  const iconNum = props.equip.type?.[3] ?? 0;

  return (
    <button
      class={`w-full h-[52px] flex items-center gap-2 px-2.5 py-2 rounded-lg transition border overflow-hidden ${
        props.active
          ? "bg-accent/12 border-accent/35"
          : "hover:bg-primary/8 active:bg-primary/15 border-transparent"
      }`}
      aria-label={`${props.equip.name} ID ${props.equip.id}`}
      onClick={props.onSelect}
      onMouseEnter={props.onPreview}
      onFocusIn={props.onPreview}
    >
      <span class="w-7 h-7 inline-flex items-center justify-center rounded bg-base-200/70 shrink-0">
        <WeaponIcon iconNum={iconNum} size={22} />
      </span>
      <div class="min-w-0 text-left">
        <p
          class="text-sm leading-tight truncate font-medium"
          title={props.equip.name}
        >
          {props.equip.name}
        </p>
          <div class="text-[11px] text-base-content/45 leading-tight mt-0.5 min-w-0 flex items-center gap-1.5 whitespace-nowrap">
            <span class="truncate min-w-0 inline flex-1 md:hidden">
              {equipDisplayTypeName(props.equip)} ID {props.equip.id}
            </span>
            <span class="hidden md:inline truncate min-w-0 flex-1">
            ID {props.equip.id} / {equipDisplayTypeName(props.equip)}
          </span>
            <Show when={props.showStats ?? true}>
              <span class="inline-flex items-center gap-1 shrink-0 md:hidden">
                <StatPill label="火" value={props.equip.houg} tone="fire" showLabel={props.showStatLabels ?? true} hideLabelOnTiny />
                <StatPill label="雷" value={props.equip.raig} tone="torpedo" showLabel={props.showStatLabels ?? true} hideLabelOnTiny />
                <StatPill label="空" value={props.equip.tyku} tone="aa" showLabel={props.showStatLabels ?? true} hideLabelOnTiny />
                <StatPill label="装" value={props.equip.souk} tone="armor" showLabel={props.showStatLabels ?? true} hideLabelOnTiny />
            </span>
            </Show>
        </div>
      </div>
      <Show when={props.showStats ?? true}>
        <div class="ml-auto hidden shrink-0 items-center justify-end gap-1 whitespace-nowrap overflow-hidden text-right min-w-0 max-w-48 md:flex">
            <StatPill label="火" value={props.equip.houg} tone="fire" showLabel={props.showStatLabels ?? true} />
            <StatPill label="雷" value={props.equip.raig} tone="torpedo" showLabel={props.showStatLabels ?? true} />
            <StatPill label="空" value={props.equip.tyku} tone="aa" showLabel={props.showStatLabels ?? true} />
            <StatPill label="装" value={props.equip.souk} tone="armor" showLabel={props.showStatLabels ?? true} />
        </div>
      </Show>
    </button>
  );
}

// ── EquipSlotGroup ───────────────────────────────────────────────────

export function EquipSlotGroup(props: {
  slotItems: MstSlotItemData[];
  onOpenEquip: (id: number) => void;
  currentEquipId?: number;
}) {
  if (props.slotItems.length === 1) {
    const equip = props.slotItems[0];
    return (
      <span class="inline-flex items-center gap-1 min-w-0 border border-base-300 bg-base-200/30 rounded-md px-1.5 py-0.5">
        <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-300/50 shrink-0">
          <WeaponIcon iconNum={equip.type?.[3] ?? 0} />
        </span>
        <button
          class={`hover:underline truncate max-w-40 transition-colors min-h-6 py-0.5 ${
            props.currentEquipId === equip.id ? "text-primary font-bold" : ""
          }`}
          onClick={() => props.onOpenEquip(equip.id)}
          title={equip.name}
        >
          {equip.name}
        </button>
      </span>
    );
  }

  const iconGroups = groupItemsByIcon(props.slotItems);

  if (iconGroups.length === 1) {
    return (
      <span class="inline-flex flex-wrap items-center gap-1 min-w-0 border border-base-300 bg-base-200/30 rounded-md px-1.5 py-0.5">
        <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-300/50 shrink-0">
          <WeaponIcon iconNum={iconGroups[0][0].type?.[3] ?? 0} />
        </span>
        <span class="inline-flex flex-wrap items-center gap-1 min-w-0">
          <For each={iconGroups[0]}>
            {(equip, idx) => (
              <>
                {idx() > 0 && (
                  <span class="text-base-content/30 text-sm font-light">/</span>
                )}
                <button
                  class={`hover:underline truncate max-w-40 transition-colors min-h-6 py-0.5 ${
                    props.currentEquipId === equip.id
                      ? "text-primary font-bold"
                      : ""
                  }`}
                  onClick={() => props.onOpenEquip(equip.id)}
                  title={equip.name}
                >
                  {equip.name}
                </button>
              </>
            )}
          </For>
        </span>
      </span>
    );
  }

  return (
    <span class="inline-flex flex-wrap items-center gap-1 min-w-0 border border-base-300 bg-base-200/30 rounded-md px-1.5 py-1">
      <For each={iconGroups}>
        {(group, idx) => (
          <>
            {idx() > 0 && (
              <span class="text-base-content/60 text-sm font-light">/</span>
            )}
            <span class="inline-flex flex-wrap items-center gap-1 min-w-0 border border-base-300/50 bg-base-100 rounded px-1.5 py-0.5 shadow-sm">
              <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                <WeaponIcon iconNum={group[0].type?.[3] ?? 0} />
              </span>
              <span class="inline-flex flex-wrap items-center gap-0.5 min-w-0">
                <For each={group}>
                  {(equip, eIdx) => (
                    <>
                      {eIdx() > 0 && (
                        <span class="text-base-content/30 text-xs font-light">
                          /
                        </span>
                      )}
                      <button
                        class={`hover:underline text-xs truncate max-w-40 transition-colors min-h-6 py-0.5 ${
                          props.currentEquipId === equip.id
                            ? "text-primary font-bold"
                            : ""
                        }`}
                        onClick={() => props.onOpenEquip(equip.id)}
                        title={equip.name}
                      >
                        {equip.name}
                      </button>
                    </>
                  )}
                </For>
              </span>
            </span>
          </>
        )}
      </For>
    </span>
  );
}

// ── MultiEntryDisplay ────────────────────────────────────────────────

export function MultiEntryDisplay(props: {
  entry: MultiEntry;
  onOpenEquip: (id: number) => void;
  currentEquipId?: number;
}) {
  return (
    <div class="rounded border border-base-300/70 p-2 space-y-1 bg-base-100/50">
      <Show when={props.entry.kind === "combo"}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
          <For each={(props.entry as MultiComboEntry).combo}>
            {(equip, idx) => (
              <>
                {idx() > 0 && <span>+</span>}
                <EquipSlotGroup
                  slotItems={[equip]}
                  currentEquipId={props.currentEquipId}
                  onOpenEquip={props.onOpenEquip}
                />
              </>
            )}
          </For>
        </div>
        <SynergyStatInline stats={(props.entry as MultiComboEntry).netStats} />
      </Show>

      <Show when={props.entry.kind === "pool"}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
          <span class="text-[10px] text-info font-bold shrink-0">
            任意{(props.entry as MultiPoolEntry).comboSize}種
          </span>
          <For each={[(props.entry as MultiPoolEntry).pool]}>
            {(group, idx) => (
              <>
                {idx() > 0 && <span class="text-base-content/30">/</span>}
                <EquipSlotGroup
                  slotItems={group}
                  currentEquipId={props.currentEquipId}
                  onOpenEquip={props.onOpenEquip}
                />
              </>
            )}
          </For>
        </div>
        <SynergyStatInline stats={(props.entry as MultiPoolEntry).correction} />
      </Show>

      <Show when={props.entry.kind === "category"}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
          <Show when={(props.entry as MultiCategoryEntry).cancels_single}>
            <span
              class="text-error font-bold text-[10px] shrink-0"
              title="単体シナジーを打ち消します"
            >
              [単体打消]
            </span>
          </Show>
          <For
            each={(() => {
              const pools = (props.entry as MultiCategoryEntry).pools;
              const grouped = new Map<
                string,
                { pool: (typeof pools)[0]; count: number }
              >();
              for (const p of pools) {
                const k = p.map((i) => i.id).join(",");
                if (!grouped.has(k)) grouped.set(k, { pool: p, count: 0 });
                grouped.get(k)!.count++;
              }
              return Array.from(grouped.values());
            })()}
          >
            {({ pool, count }, idx) => (
              <>
                {idx() > 0 && <span>+</span>}
                <span class="flex items-center gap-1 bg-base-200/40 px-1 rounded">
                  <Show when={count > 1}>
                    <span class="text-[10px] text-info font-bold shrink-0">
                      {count}個:
                    </span>
                  </Show>
                  <For each={[pool]}>
                    {(group, gIdx) => (
                      <>
                        {gIdx() > 0 && (
                          <span class="text-base-content/30">/</span>
                        )}
                        <EquipSlotGroup
                          slotItems={group}
                          currentEquipId={props.currentEquipId}
                          onOpenEquip={props.onOpenEquip}
                        />
                      </>
                    )}
                  </For>
                </span>
              </>
            )}
          </For>
        </div>
        <SynergyStatInline
          stats={(props.entry as MultiCategoryEntry).correction}
        />
      </Show>

      <Show when={props.entry.kind === "grouped_combo"}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
          <For
            each={(() => {
              const pools = (props.entry as MultiGroupedComboEntry)
                .groupedPools;
              const grouped = new Map<
                string,
                { pool: (typeof pools)[0]; count: number }
              >();
              for (const p of pools) {
                const k = p.map((i) => i.id).join(",");
                if (!grouped.has(k)) grouped.set(k, { pool: p, count: 0 });
                grouped.get(k)!.count++;
              }
              return Array.from(grouped.values());
            })()}
          >
            {({ pool, count }, idx) => (
              <>
                {idx() > 0 && <span>+</span>}
                <span class="flex items-center gap-1 bg-base-200/40 px-1 rounded">
                  <Show when={count > 1}>
                    <span class="text-[10px] text-info font-bold shrink-0">
                      {count}個:
                    </span>
                  </Show>
                  <For each={[pool]}>
                    {(group, gIdx) => (
                      <>
                        {gIdx() > 0 && (
                          <span class="text-base-content/30">/</span>
                        )}
                        <EquipSlotGroup
                          slotItems={group}
                          currentEquipId={props.currentEquipId}
                          onOpenEquip={props.onOpenEquip}
                        />
                      </>
                    )}
                  </For>
                </span>
              </>
            )}
          </For>
        </div>
        <SynergyStatInline
          stats={(props.entry as MultiGroupedComboEntry).netStats}
        />
      </Show>

      <Show when={props.entry.ships && props.entry.ships.length > 0}>
        <div class="mt-1 text-[10px] text-base-content/60 border-t border-base-200 pt-1 space-y-0.5">
          <div class="font-bold">対象艦 (計{props.entry.ships!.length}隻):</div>
          <For
            each={(() => {
              const ships = props.entry
                .ships!.map((id) => getMasterShip(id))
                .filter(Boolean);
              const byStype = new Map<number, typeof ships>();
              for (const s of ships) {
                if (!byStype.has(s!.stype)) byStype.set(s!.stype, []);
                byStype.get(s!.stype)!.push(s);
              }
              const stypes = Array.from(byStype.keys()).sort((a, b) => a - b);
              return stypes.map((st) => ({
                stype: st,
                ships: byStype.get(st)!,
              }));
            })()}
          >
            {({ stype, ships }) => (
              <div>
                <span class="font-medium text-base-content/70">
                  [{STYPE_NAMES[stype] ?? "不明"}]
                </span>{" "}
                {ships.length <= 5
                  ? ships.map((s) => s!.name).join("、")
                  : `${ships
                      .slice(0, 4)
                      .map((s) => s!.name)
                      .join("、")} など(計${ships.length}隻)`}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// ── statKeyToLabel ───────────────────────────────────────────────────

export function statKeyToLabel(key: string): string {
  const map: Record<string, string> = {
    houg: "火力",
    raig: "雷装",
    tyku: "対空",
    souk: "装甲",
    kaih: "回避",
    tais: "対潜",
    saku: "索敵",
    baku: "爆装",
    houm: "命中",
    leng: "射程",
  };
  return map[key] || key;
}
