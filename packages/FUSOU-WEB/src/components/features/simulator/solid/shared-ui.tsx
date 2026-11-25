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
import type { MstShipData, MstSlotItemData, SlotUsageSummary } from "@/features/simulator/types";

export { StatPill } from "@/components/common/solid/StatPill";
import { StatPill } from "@/components/common/solid/StatPill";
// ── Cooperative Background Pre-Renderer ──────────────────────────────
// Hydrates below-the-fold LazyRender blocks and ProgressiveGrid chunks
// incrementally during browser idle slices so content is ready before the
// user scrolls to it, preventing layout shifts / scrollbar jumping without
// blocking initial paint or user interaction.

type BgIdleTask = {
  /** Returns true if more work remains (re-queued round-robin), false when done. */
  run: () => boolean;
  cancelled: boolean;
};

const bgQueue: BgIdleTask[] = [];
let bgScheduled = false;

function scheduleBgFlush() {
  if (bgScheduled || bgQueue.length === 0) return;
  bgScheduled = true;

  const flush = (deadline?: IdleDeadline) => {
    bgScheduled = false;
    const start = performance.now();
    // Keep each frame slice short (~8ms) so scrolling & clicking stay responsive
    while (bgQueue.length > 0) {
      const task = bgQueue.shift()!;
      if (task.cancelled) continue;
      let hasMore = false;
      try {
        hasMore = task.run();
      } catch {
        hasMore = false;
      }
      if (hasMore && !task.cancelled) {
        bgQueue.push(task);
      }
      const elapsed = performance.now() - start;
      const idleLeft = deadline ? deadline.timeRemaining() : 8 - elapsed;
      if (elapsed >= 8 || idleLeft <= 1) break;
    }
    if (bgQueue.length > 0) {
      scheduleBgFlush();
    }
  };

  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(flush, { timeout: 120 });
  } else {
    setTimeout(() => flush(), 16);
  }
}

function enqueueBgTask(run: () => boolean): () => void {
  const task: BgIdleTask = { run, cancelled: false };
  bgQueue.push(task);
  scheduleBgFlush();
  return () => {
    task.cancelled = true;
  };
}

// ── LazyRender ───────────────────────────────────────────────────────

export function LazyRender(props: { children: JSX.Element }) {
  const [isVisible, setIsVisible] = createSignal(false);
  let ref: HTMLDivElement | undefined;

  onMount(() => {
    let cancelBg: (() => void) | undefined;
    let observer: IntersectionObserver | undefined;

    const reveal = () => {
      if (isVisible()) return;
      setIsVisible(true);
      observer?.disconnect();
      observer = undefined;
      cancelBg?.();
      cancelBg = undefined;
    };

    if (typeof IntersectionObserver !== "undefined" && ref) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            reveal();
          }
        },
        { rootMargin: "400px" },
      );
      observer.observe(ref);
    }

    // Also hydrate progressively in the background from top to bottom during
    // idle frames so sections are already rendered before the user scrolls here.
    cancelBg = enqueueBgTask(() => {
      reveal();
      return false;
    });

    onCleanup(() => {
      observer?.disconnect();
      cancelBg?.();
    });
  });

  return (
    <div ref={ref}>
      <Show when={isVisible()} fallback={<div class="min-h-16 w-full rounded-lg bg-base-200/40 animate-pulse" />}>
        {props.children}
      </Show>
    </div>
  );
}

// ── ProgressiveGrid ──────────────────────────────────────────────────

const PROGRESSIVE_INITIAL_BATCH = 40;
const PROGRESSIVE_BG_BATCH = 40;
const PROGRESSIVE_SCROLL_BATCH = 80;

export function ProgressiveGrid<T>(props: {
  data: T[];
  class?: string;
  children: (item: T) => JSX.Element;
}) {
  const [limit, setLimit] = createSignal(PROGRESSIVE_INITIAL_BATCH);
  const [sentinel, setSentinel] = createSignal<HTMLDivElement | undefined>();
  const hasMore = createMemo(() => limit() < props.data.length);

  createEffect(() => {
    // Reset limit when data changes and progressively hydrate remaining items
    // in the background so scroll height settles before the user reaches the end.
    const total = props.data.length;
    setLimit(Math.min(PROGRESSIVE_INITIAL_BATCH, total));
    if (total <= PROGRESSIVE_INITIAL_BATCH) return;

    const cancelBg = enqueueBgTask(() => {
      let remaining = false;
      setLimit((prev) => {
        const next = Math.min(total, prev + PROGRESSIVE_BG_BATCH);
        remaining = next < total;
        return next;
      });
      return remaining;
    });
    onCleanup(cancelBg);
  });

  createEffect(() => {
    const el = sentinel();
    if (!el || !hasMore() || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setLimit((l) => Math.min(props.data.length, l + PROGRESSIVE_SCROLL_BATCH));
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  return (
    <>
      <div class={props.class}>
        <For each={props.data.slice(0, limit())}>{props.children}</For>
      </div>
      <Show when={hasMore()}>
        <div ref={setSentinel} class="h-px w-full" />
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
}): JSX.Element {
  const displayH = () => props.height ?? 18;
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
      <table class="table table-zebra table-sm w-full sm:hidden">
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr>
                <th class="w-28 text-base-content/65 font-medium whitespace-nowrap">
                  {row[0]}
                </th>
                <td class="font-mono text-right sm:text-left whitespace-nowrap">{row[1]}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <table class="hidden sm:table table-zebra table-sm w-full">
        <tbody>
          <For each={pairedRows()}>
            {(pair) => (
              <tr>
                <th class="text-base-content/65 font-medium whitespace-nowrap">
                  {pair[0]?.[0]}
                </th>
                <td class="font-mono text-left whitespace-nowrap">
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
                  <th class="text-base-content/65 font-medium whitespace-nowrap">
                    {pair[1]?.[0]}
                  </th>
                  <td class="font-mono text-left whitespace-nowrap">
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

export function SlotUsageBadges(props: {
  placements: SlotUsageSummary[] | undefined;
}): JSX.Element {
  const labels = () => {
    const placements = props.placements ?? [];
    return placements
      .map((placement) => {
        if (placement.normal > 0 && placement.exslot > 0) {
          return `通常${placement.normal} / 補強${placement.exslot}`;
        }
        if (placement.exslot > 0) return `補強${placement.exslot}`;
        return `通常${placement.normal}`;
      })
      .filter(Boolean);
  };

  return (
    <Show when={labels().length > 0}>
      <span class="inline-flex flex-wrap items-center gap-1">
        <For each={labels()}>
          {(label) => <span class="badge badge-outline badge-xs border-warning text-warning">{label}</span>}
        </For>
      </span>
    </Show>
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
  currentEquipId?: number | undefined;
  suppressedComponents?: number[] | undefined;
}) {
  const [expanded, setExpanded] = createSignal(false);
  
  const renderItemName = (equip: MstSlotItemData) => {
    const isSuppressed = props.suppressedComponents?.includes(equip.id);
    return (
      <span class="inline-flex items-center gap-0.5 max-w-full min-w-0">
        <span class="truncate min-w-0">{equip.name}</span>
        <Show when={isSuppressed}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 text-error shrink-0">
            <title>他装備との同時装備によりボーナスが減少・頭打ちになります</title>
            <path fill-rule="evenodd" d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z" clip-rule="evenodd" />
          </svg>
        </Show>
      </span>
    );
  };

  if (props.slotItems.length === 1) {
    const equip = props.slotItems[0];
    if (!equip) return null;
    return (
      <span class="inline-flex items-center gap-1 max-w-full min-w-0 border border-base-300 bg-base-200/30 rounded-md px-1.5 py-0.5">
        <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-300/50 shrink-0">
          <WeaponIcon iconNum={equip.type?.[3] ?? 0} />
        </span>
        <button
          class={`inline-flex items-center max-w-full min-w-0 text-left hover:underline transition-colors min-h-6 py-0.5 ${
            props.currentEquipId === equip.id ? "text-primary font-bold" : ""
          }`}
          onClick={() => props.onOpenEquip(equip.id)}
          title={equip.name}
        >
          {renderItemName(equip)}
        </button>
      </span>
    );
  }

  const iconGroups = groupItemsByIcon(props.slotItems);

  const renderGroup = (group: MstSlotItemData[], limit?: number) => {
    const items = limit && !expanded() ? group.slice(0, limit) : group;
    return (
      <>
        <For each={items}>
          {(equip, eIdx) => (
            <>
              {eIdx() > 0 && (
                <span class="text-base-content/30 text-xs font-light">/</span>
              )}
              <button
                class={`inline-flex items-center max-w-full min-w-0 text-left hover:underline text-xs transition-colors min-h-6 py-0.5 ${
                  props.currentEquipId === equip.id
                    ? "text-primary font-bold"
                    : ""
                }`}
                onClick={() => props.onOpenEquip(equip.id)}
                title={equip.name}
              >
                {renderItemName(equip)}
              </button>
            </>
          )}
        </For>
      </>
    );
  };

  if (iconGroups.length === 1) {
    const group = iconGroups[0];
    if (!group) return null;
    const firstEquip = group[0];
    if (!firstEquip) return null;
    const threshold = 4;
    return (
      <span class="inline-flex flex-wrap items-center gap-1 max-w-full min-w-0 border border-base-300 bg-base-200/30 rounded-md px-1.5 py-0.5">
        <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-300/50 shrink-0">
          <WeaponIcon iconNum={firstEquip.type?.[3] ?? 0} />
        </span>
        <span class="inline-flex flex-wrap items-center gap-1 max-w-full min-w-0">
          {renderGroup(group, threshold)}
          <Show when={group.length > threshold && !expanded()}>
            <button
              class="text-[10px] text-info hover:underline bg-info/10 px-1 rounded"
              onClick={() => setExpanded(true)}
            >
              他{group.length - threshold}件
            </button>
          </Show>
        </span>
      </span>
    );
  }

  return (
    <span class="inline-flex flex-wrap items-center gap-1 max-w-full min-w-0 border border-base-300 bg-base-200/30 rounded-md px-1.5 py-1">
      <For each={iconGroups}>
        {(group, idx) => {
          const firstEquip = group[0];
          if (!firstEquip) return null;
          const threshold = 3;
          return (
            <>
              {idx() > 0 && (
                <span class="text-base-content/60 text-sm font-light">/</span>
              )}
              <span class="inline-flex flex-wrap items-center gap-1 max-w-full min-w-0 border border-base-300/70 bg-base-100 rounded px-1.5 py-0.5">
                <span class="inline-flex w-4 h-4 items-center justify-center rounded bg-base-200/70 shrink-0">
                  <WeaponIcon iconNum={firstEquip.type?.[3] ?? 0} />
                </span>
                <span class="inline-flex flex-wrap items-center gap-0.5 max-w-full min-w-0">
                  {renderGroup(group, threshold)}
                  <Show when={group.length > threshold && !expanded()}>
                    <button
                      class="text-[10px] text-info hover:underline bg-info/10 px-1 rounded"
                      onClick={() => setExpanded(true)}
                    >
                      他{group.length - threshold}件
                    </button>
                  </Show>
                </span>
              </span>
            </>
          );
        }}
      </For>
    </span>
  );
}

// ── DetailTabBar ─────────────────────────────────────────────────────
// Wrapping FUSOU underline tab bar placed as the fixed header of the
// sticky DetailTabbedShell so all tabs remain visible even on narrow screens.

export type DetailTabItem<T extends string = string> = {
  id: T;
  label: string;
  title?: string | undefined;
  count?: number | null | undefined;
  loading?: boolean | undefined;
};

export function DetailTabBar<T extends string>(props: {
  tabs: DetailTabItem<T>[];
  activeTab: T;
  onSelect: (tab: T) => void;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={props.ariaLabel ?? "詳細セクション切り替え"}
      class="shrink-0 flex flex-wrap items-end gap-x-1 gap-y-0.5 px-2 pt-1.5 border-b border-base-300/80 bg-base-100"
    >
      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => props.activeTab === tab.id;
          const isEmpty = () =>
            !tab.loading && tab.count != null && tab.count === 0;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={isActive()}
              tabIndex={isActive() ? 0 : -1}
              title={tab.title ?? tab.label}
              onClick={() => props.onSelect(tab.id)}
              class={`px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-colors border-b-2 whitespace-nowrap -mb-px cursor-pointer select-none ${
                isActive()
                  ? "border-primary text-primary font-semibold"
                  : `border-transparent text-base-content/60 hover:text-base-content hover:border-base-300 ${
                      isEmpty() ? "opacity-55" : ""
                    }`
              }`}
            >
              <span class="inline-flex items-center gap-1">
                <span>{tab.label}</span>
                <Show
                  when={!tab.loading}
                  fallback={
                    <span class="loading loading-spinner loading-xs opacity-50" />
                  }
                >
                  <Show when={tab.count != null}>
                    <span
                      class={`px-1.5 py-0.5 text-[10px] leading-none rounded-full font-mono font-normal ${
                        isActive()
                          ? "bg-primary/15 text-primary"
                          : "bg-base-300/80 text-base-content/75"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </Show>
                </Show>
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

// ── DetailTabbedShell ────────────────────────────────────────────────
// Sticky viewport-matched card container whose top/bottom borders align
// pixel-for-pixel with the left catalog picker
// (xl:sticky xl:top-[var(--fusou-nav-offset,5rem)] xl:h-[calc(100vh-var(--fusou-nav-offset,5rem)-0.75rem)]).
// - Uses overflow-hidden so the rounded-xl corners are never clipped/overpainted.
// - Keeps height constant across all tabs (including empty states).
// - Coordinates wheel scrolling in 3 stages on desktop (xl):
//   1. Align the shell top with the left catalog picker first.
//   2. Once aligned, scroll the active tab's content internally.
//   3. Once the tab content reaches its top/bottom edge, release to outer page scroll.

export function DetailTabbedShell<T extends string>(props: {
  tabs: DetailTabItem<T>[];
  activeTab: T;
  onSelect: (tab: T) => void;
  ariaLabel?: string;
  expanded?: boolean | undefined;
  children: JSX.Element;
}): JSX.Element {
  let shellEl: HTMLDivElement | undefined;

  onMount(() => {
    const el = shellEl;
    if (!el || typeof window === "undefined") return;

    const getTargetTopPx = (): number => {
      const rootStyle = getComputedStyle(document.documentElement);
      const raw = rootStyle.getPropertyValue("--fusou-nav-offset").trim();
      const rootFont = parseFloat(rootStyle.fontSize) || 16;
      if (raw.endsWith("rem")) return parseFloat(raw) * rootFont;
      const px = parseFloat(raw);
      return Number.isFinite(px) ? px : 5 * rootFont;
    };

    const findActiveScrollEl = (): HTMLElement | null => {
      const nodes = el.querySelectorAll<HTMLElement>(
        '[data-synergy-scroll="true"]',
      );
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node && node.offsetParent !== null) return node;
      }
      return null;
    };

    const onWheel = (e: WheelEvent) => {
      if (props.expanded || e.ctrlKey) return;
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX) || e.deltaY === 0) return;
      if (!window.matchMedia("(min-width: 1280px)").matches) return;

      const dy =
        e.deltaMode === 1
          ? e.deltaY * 16
          : e.deltaMode === 2
            ? e.deltaY * window.innerHeight
            : e.deltaY;

      const scrollEl = findActiveScrollEl();
      const maxInnerScroll = scrollEl
        ? Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
        : 0;
      const rect = el.getBoundingClientRect();
      const targetTop = getTargetTopPx();
      const maxPageScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );

      if (dy > 0) {
        // Stage 1: Before scrolling inner content, align shell top with left picker
        if (rect.top > targetTop + 2 && window.scrollY < maxPageScroll - 1) {
          e.preventDefault();
          const alignStep = Math.min(
            rect.top - targetTop,
            maxPageScroll - window.scrollY,
          );
          if (dy <= alignStep) {
            window.scrollBy(0, dy);
          } else {
            window.scrollBy(0, alignStep);
            const leftover = dy - alignStep;
            if (scrollEl && maxInnerScroll > 1) {
              scrollEl.scrollTop = Math.min(
                maxInnerScroll,
                scrollEl.scrollTop + leftover,
              );
            } else {
              window.scrollBy(0, leftover);
            }
          }
          return;
        }

        // Stage 2: Aligned — scroll inner content if it still has room
        if (scrollEl && scrollEl.scrollTop < maxInnerScroll - 1) {
          // If pointer is over the tab bar/header (outside scrollEl), forward to scrollEl
          if (!scrollEl.contains(e.target as Node)) {
            e.preventDefault();
            scrollEl.scrollTop = Math.min(
              maxInnerScroll,
              scrollEl.scrollTop + dy,
            );
          }
          return;
        }
        // Stage 3: Inner content reached bottom — let outer page scroll freely
        return;
      }

      // dy < 0 (scrolling up)
      // Stage 1 (reverse): If shell was pushed above targetTop (scrolled into footer), align back first
      if (rect.top < targetTop - 2 && window.scrollY > 1) {
        e.preventDefault();
        const alignStep = Math.min(targetTop - rect.top, window.scrollY);
        const absDy = -dy;
        if (absDy <= alignStep) {
          window.scrollBy(0, dy);
        } else {
          window.scrollBy(0, -alignStep);
          const leftover = absDy - alignStep;
          if (scrollEl && scrollEl.scrollTop > 1) {
            scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - leftover);
          } else {
            window.scrollBy(0, -leftover);
          }
        }
        return;
      }

      // If shell is still below targetTop (spec table visible), let outer page scroll up freely
      if (rect.top > targetTop + 2) {
        if (scrollEl && scrollEl.scrollTop > 1 && scrollEl.contains(e.target as Node)) {
          e.preventDefault();
          window.scrollBy(0, dy);
        }
        return;
      }

      // Stage 2 (reverse): Aligned — scroll inner content back up to top
      if (scrollEl && scrollEl.scrollTop > 1) {
        if (!scrollEl.contains(e.target as Node)) {
          e.preventDefault();
          scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + dy);
        }
        return;
      }
      // Stage 3 (reverse): Inner content at top — let outer page scroll up to spec table & navbar
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => el.removeEventListener("wheel", onWheel));
  });

  return (
    <div
      ref={shellEl}
      class={`rounded-xl border border-base-300/70 bg-base-100 flex flex-col overflow-hidden ${
        props.expanded
          ? ""
          : "h-[calc(100dvh-var(--fusou-nav-offset,5rem)-3.5rem)] xl:h-[calc(100vh-var(--fusou-nav-offset,5rem)-0.75rem)] xl:sticky xl:top-[var(--fusou-nav-offset,5rem)]"
      }`}
    >
      <DetailTabBar
        tabs={props.tabs}
        activeTab={props.activeTab}
        onSelect={props.onSelect}
        {...(props.ariaLabel !== undefined ? { ariaLabel: props.ariaLabel } : {})}
      />
      <div
        class={
          props.expanded
            ? "p-3"
            : "flex-1 min-h-0 flex flex-col p-3 overflow-hidden"
        }
      >
        {props.children}
      </div>
    </div>
  );
}

// ── SynergyScrollBox ─────────────────────────────────────────────────
// Scrollable inner body inside DetailTabbedShell. Fills the shell height,
// scrolls internally when overflowing, and chains back to outer page scroll
// naturally at the top/bottom boundary.

export function SynergyScrollBox(props: {
  id?: string;
  title?: string;
  subtitle?: string;
  titleClass?: string;
  expanded?: boolean | undefined;
  boxClass?: string;
  contentClass?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class={
        props.expanded
          ? "flex flex-col"
          : "flex-1 min-h-0 flex flex-col"
      }
    >
      <Show when={props.title}>
        <div class="shrink-0 mb-2 px-0.5">
          <h4
            class={
              props.titleClass ?? "text-sm font-semibold text-base-content/80"
            }
          >
            {props.title}
          </h4>
          <Show when={props.subtitle}>
            <p class="text-xs text-base-content/55 mt-0.5">
              {props.subtitle}
            </p>
          </Show>
        </div>
      </Show>
      <div
        id={props.id}
        data-synergy-scroll="true"
        class={
          props.expanded
            ? "pr-1"
            : "flex-1 min-h-0 overflow-y-auto pr-1"
        }
      >
        <div class={props.contentClass ?? "space-y-3"}>
          {props.children}
        </div>
      </div>
    </div>
  );
}

// ── MultiEntryDisplay ────────────────────────────────────────────────

function SynergyModifierBadge(props: {
  stats: Record<string, number>;
  cancelsSingle?: boolean | undefined;
}) {
  const info = () => {
    const vals = Object.values(props.stats);
    const hasNeg = vals.some((v) => v < 0);
    if (!hasNeg) return null;
    if (props.cancelsSingle) {
      return {
        label: "[単体打消]",
        className: "text-error font-bold text-[10px] shrink-0",
        title: "装備の単体ボーナスが打ち消されます",
      };
    }
    const hasPos = vals.some((v) => v > 0);
    if (hasPos) {
      return {
        label: "[一部減少]",
        className: "text-warning font-bold text-[10px] shrink-0",
        title: "同時装備により一部ステータスのボーナスが減少します",
      };
    }
    return {
      label: "[効果減少]",
      className: "text-error/85 font-bold text-[10px] shrink-0",
      title: "同時装備による上限・重複制限などでボーナスが減少します",
    };
  };

  return (
    <Show when={info()}>
      {(badge) => (
        <span class={badge().className} title={badge().title}>
          {badge().label}
        </span>
      )}
    </Show>
  );
}

function ShipStypeRow(props: {
  stype: number;
  ships: MstShipData[];
  onOpenShip?: ((id: number) => void) | undefined;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const threshold = 4;
  const isCollapsible = () => props.ships.length > threshold + 1;
  const visibleShips = () =>
    isCollapsible() && !expanded()
      ? props.ships.slice(0, threshold)
      : props.ships;

  return (
    <div class="leading-relaxed">
      <span class="font-medium text-base-content/70">
        [{STYPE_NAMES[props.stype] ?? "不明"}]
      </span>{" "}
      <For each={visibleShips()}>
        {(ship, idx) => (
          <>
            {idx() > 0 && "、"}
            <Show
              when={props.onOpenShip}
              fallback={<span>{ship.name}</span>}
            >
              <button
                type="button"
                class="hover:underline hover:text-primary transition-colors cursor-pointer"
                onClick={() => props.onOpenShip?.(ship.id)}
              >
                {ship.name}
              </button>
            </Show>
          </>
        )}
      </For>
      <Show when={isCollapsible() && !expanded()}>
        <button
          type="button"
          class="ml-1 text-[10px] text-info hover:underline bg-info/10 px-1 rounded cursor-pointer"
          onClick={() => setExpanded(true)}
        >
          他{props.ships.length - threshold}隻
        </button>
      </Show>
      <Show when={isCollapsible() && expanded()}>
        <button
          type="button"
          class="ml-1 text-[10px] text-base-content/60 hover:underline bg-base-200 px-1 rounded cursor-pointer"
          onClick={() => setExpanded(false)}
        >
          折りたたむ
        </button>
      </Show>
    </div>
  );
}

export function MultiEntryDisplay(props: {
  entry: MultiEntry;
  onOpenEquip: (id: number) => void;
  onOpenShip?: (id: number) => void;
  currentEquipId?: number;
}) {
  return (
    <div class="rounded border border-base-300/70 p-2 space-y-1 bg-base-100/50">
      <Show when={props.entry.kind === "combo"}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
          <SynergyModifierBadge
            stats={(props.entry as MultiComboEntry).netStats}
            cancelsSingle={(props.entry as MultiComboEntry).cancels_single}
          />
          <For each={(props.entry as MultiComboEntry).combo}>
            {(equip, idx) => (
              <>
                {idx() > 0 && <span>+</span>}
                <EquipSlotGroup
                  slotItems={[equip]}
                  currentEquipId={props.currentEquipId}
                  onOpenEquip={props.onOpenEquip}
                  suppressedComponents={(props.entry as MultiComboEntry).suppressed_components}
                />
              </>
            )}
          </For>
        </div>
        <SynergyStatInline stats={(props.entry as MultiComboEntry).netStats} />
      </Show>

      <Show when={props.entry.kind === "pool"}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
          <SynergyModifierBadge
            stats={(props.entry as MultiPoolEntry).correction}
            cancelsSingle={(props.entry as MultiPoolEntry).cancels_single}
          />
          <Show
            when={(props.entry as MultiPoolEntry).fixed && (props.entry as MultiPoolEntry).freePool}
            fallback={
              <>
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
                        suppressedComponents={(props.entry as MultiPoolEntry).suppressed_components}
                      />
                    </>
                  )}
                </For>
              </>
            }
          >
            {(() => {
              const entry = props.entry as MultiPoolEntry;
              const fixed = entry.fixed ?? [];
              const free = entry.freePool ?? [];
              const pickCount =
                typeof entry.freePickCount === "number"
                  ? entry.freePickCount
                  : Math.max(0, entry.comboSize - fixed.length);
              return (
                <>
                  <span class="text-[10px] text-warning font-bold shrink-0">
                    固定{fixed.length}個
                  </span>
                  <EquipSlotGroup
                    slotItems={fixed}
                    currentEquipId={props.currentEquipId}
                    onOpenEquip={props.onOpenEquip}
                    suppressedComponents={(props.entry as MultiPoolEntry).suppressed_components}
                  />
                  <span class="text-base-content/40">+</span>
                  <span class="text-[10px] text-info font-bold shrink-0">
                    任意{pickCount}種{entry.freePoolWithReplacement ? "(重複可)" : ""}
                  </span>
                  <EquipSlotGroup
                    slotItems={free}
                    currentEquipId={props.currentEquipId}
                    onOpenEquip={props.onOpenEquip}
                    suppressedComponents={(props.entry as MultiPoolEntry).suppressed_components}
                  />
                </>
              );
            })()}
          </Show>
        </div>
        <SynergyStatInline stats={(props.entry as MultiPoolEntry).correction} />
      </Show>

      <Show when={props.entry.kind === "category"}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
          <SynergyModifierBadge
            stats={(props.entry as MultiCategoryEntry).correction}
            cancelsSingle={(props.entry as MultiCategoryEntry).cancels_single}
          />
          {(() => {
            const pools = (props.entry as MultiCategoryEntry).pools;
            const grouped = new Map<
              string,
              { pool: MstSlotItemData[]; count: number }
            >();
            for (const p of pools) {
              const k = p.map((i) => i.id).join(",");
              if (!grouped.has(k)) grouped.set(k, { pool: p, count: 0 });
              grouped.get(k)!.count++;
            }
            const groups = Array.from(grouped.values());
            const fixedGroups = groups.filter((g) => g.pool.length === 1);
            const variableGroups = groups.filter((g) => g.pool.length > 1);
            const canUseStructuredDisplay =
              fixedGroups.length > 0 &&
              variableGroups.length > 0 &&
              variableGroups.every((g) => g.count === 1);

            if (!canUseStructuredDisplay) {
              return (
                <For each={groups}>
                  {({ pool, count }, idx) => (
                    <>
                      {idx() > 0 && <span>+</span>}
                      <span class="flex items-center gap-1 bg-base-200/40 px-1 rounded">
                        <Show when={count > 1}>
                          <span class="text-[10px] text-info font-bold shrink-0">
                            {count}個:
                          </span>
                        </Show>
                        <EquipSlotGroup
                          slotItems={pool}
                          currentEquipId={props.currentEquipId}
                          onOpenEquip={props.onOpenEquip}
                          suppressedComponents={(props.entry as MultiCategoryEntry).suppressed_components}
                        />
                      </span>
                    </>
                  )}
                </For>
              );
            }

            const fixedItems = fixedGroups.flatMap((g) => {
              const firstItem = g.pool[0];
              return firstItem
                ? Array.from({ length: g.count }, () => firstItem)
                : [];
            });
            return (
              <>
                <span class="text-[10px] text-warning font-bold shrink-0">
                  固定{fixedItems.length}個
                </span>
                <EquipSlotGroup
                  slotItems={fixedItems}
                  currentEquipId={props.currentEquipId}
                  onOpenEquip={props.onOpenEquip}
                  suppressedComponents={(props.entry as MultiCategoryEntry).suppressed_components}
                />
                <For each={variableGroups}>
                  {(group) => (
                    <>
                      <span class="text-base-content/40">+</span>
                      <span class="text-[10px] text-info font-bold shrink-0">
                        任意1種
                      </span>
                      <EquipSlotGroup
                        slotItems={group.pool}
                        currentEquipId={props.currentEquipId}
                        onOpenEquip={props.onOpenEquip}
                        suppressedComponents={(props.entry as MultiCategoryEntry).suppressed_components}
                      />
                    </>
                  )}
                </For>
              </>
            );
          })()}
        </div>
        <SynergyStatInline
          stats={(props.entry as MultiCategoryEntry).correction}
        />
      </Show>

      <Show when={props.entry.kind === "grouped_combo"}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
          <SynergyModifierBadge
            stats={(props.entry as MultiGroupedComboEntry).netStats}
            cancelsSingle={(props.entry as MultiGroupedComboEntry).cancels_single}
          />
          <For
            each={(() => {
              const pools = (props.entry as MultiGroupedComboEntry)
                .groupedPools;
              const grouped = new Map<
                string,
                { pool: MstSlotItemData[]; count: number }
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
                .filter((s): s is MstShipData => Boolean(s));
              const byStype = new Map<number, MstShipData[]>();
              for (const s of ships) {
                if (!byStype.has(s.stype)) byStype.set(s.stype, []);
                byStype.get(s.stype)!.push(s);
              }
              const stypes = Array.from(byStype.keys()).sort((a, b) => a - b);
              return stypes.map((st) => ({
                stype: st,
                ships: byStype.get(st)!,
              }));
            })()}
          >
            {({ stype, ships }) => (
              <ShipStypeRow
                stype={stype}
                ships={ships}
                onOpenShip={props.onOpenShip}
              />
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
