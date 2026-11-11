import type { Accessor, JSX } from "solid-js";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { VList } from "virtua/solid";
import IconChevronLeft from "../../icons/chevron_left";
import IconChevronRight from "../../icons/chevron_right";
import {
  canScrollHorizontally,
  drag_scroll_fn,
  getHorizontalWheelDelta,
  scrollElementHorizontally,
  scroll_fn,
} from "../../utility/scroll.tsx";

export const SPEC_SCROLL_STEP = 160;

export interface SpecScrollArrowButtonProps {
  direction: "left" | "right";
  disabled: boolean;
  ariaLabel: string;
  dataRole: string;
  divider?: "left" | "right";
  class?: string;
  onClick: () => void;
}

/**
 * Shared compact horizontal scroll control used on both category tab strips and table headers.
 */
export function SpecScrollArrowButton(props: SpecScrollArrowButtonProps) {
  const dividerEl = () => (
    <span aria-hidden="true" class="h-4 w-px bg-base-300 shrink-0" />
  );

  return (
    <div
      class={[
        "inline-flex items-center gap-1 shrink-0",
        props.class ?? "",
      ].join(" ")}
    >
      <Show when={props.divider === "left"}>{dividerEl()}</Show>
      <button
        type="button"
        data-spec-scroll={props.dataRole}
        aria-label={props.ariaLabel}
        title={props.direction === "left" ? "Scroll left" : "Scroll right"}
        disabled={props.disabled}
        class="btn btn-ghost btn-xs h-6 w-5 p-0 rounded shrink-0 flex items-center justify-center text-base-content/70 hover:text-base-content disabled:opacity-25 disabled:bg-transparent"
        onClick={(e) => {
          e.stopPropagation();
          props.onClick();
        }}
      >
        <Show
          when={props.direction === "left"}
          fallback={<IconChevronRight class="h-3.5 w-3.5" />}
        >
          <IconChevronLeft class="h-3.5 w-3.5" />
        </Show>
      </button>
      <Show when={props.divider === "right"}>{dividerEl()}</Show>
    </div>
  );
}

export interface CategoryTabStripProps {
  radioName: string;
  categories: Accessor<string[]>;
  hasItems: (category: string) => boolean;
  activeCategory: Accessor<string>;
  onSelect: (category: string) => void;
  modalOpen: Accessor<boolean>;
}

/**
 * Horizontally scrollable category tab strip supporting mouse wheel, drag, and arrow buttons.
 */
export function CategoryTabStrip(props: CategoryTabStripProps) {
  const [canScrollLeft, setCanScrollLeft] = createSignal(false);
  const [canScrollRight, setCanScrollRight] = createSignal(false);

  let barEl!: HTMLDivElement;
  let scrollEl!: HTMLDivElement;
  let contentEl!: HTMLDivElement;

  const updateEdges = () => {
    if (!scrollEl) return;
    const maxScrollLeft = Math.max(
      0,
      scrollEl.scrollWidth - scrollEl.clientWidth,
    );
    setCanScrollLeft(scrollEl.scrollLeft > 1);
    setCanScrollRight(scrollEl.scrollLeft < maxScrollLeft - 1);
  };

  onMount(() => {
    const cleanupWheel = scroll_fn(barEl, props.modalOpen, scrollEl);
    const cleanupDrag = drag_scroll_fn(scrollEl, props.modalOpen);

    scrollEl.addEventListener("scroll", updateEdges);
    const resizeObserver = new ResizeObserver(updateEdges);
    resizeObserver.observe(scrollEl);
    if (contentEl) {
      resizeObserver.observe(contentEl);
    }

    updateEdges();
    onCleanup(() => {
      cleanupWheel();
      cleanupDrag();
      scrollEl.removeEventListener("scroll", updateEdges);
      resizeObserver.disconnect();
    });
  });

  createEffect(() => {
    props.categories();
    props.activeCategory();
    queueMicrotask(updateEdges);
  });

  return (
    <div
      ref={barEl}
      data-spec-scroll="category-bar"
      class="flex items-center w-full bg-base-100 shrink-0"
    >
      <SpecScrollArrowButton
        direction="left"
        disabled={!canScrollLeft()}
        ariaLabel="Scroll category tabs left"
        dataRole="category-left"
        divider="right"
        class="h-8 pl-1 bg-base-100"
        onClick={() => {
          scrollElementHorizontally(scrollEl, -SPEC_SCROLL_STEP);
          updateEdges();
        }}
      />
      <div
        ref={scrollEl}
        data-spec-scroll="category-viewport"
        class="overflow-x-auto flex-1 min-w-0 mx-1 specification-tab-scroll"
      >
        <div ref={contentEl} class="tabs tabs-border tabs-sm min-w-max">
          <For each={props.categories()}>
            {(name) => (
              <Show when={props.hasItems(name)}>
                <input
                  type="radio"
                  name={props.radioName}
                  class="tab"
                  aria-label={name}
                  onClick={() => props.onSelect(name)}
                  checked={props.activeCategory() === name}
                />
              </Show>
            )}
          </For>
        </div>
      </div>
      <SpecScrollArrowButton
        direction="right"
        disabled={!canScrollRight()}
        ariaLabel="Scroll category tabs right"
        dataRole="category-right"
        divider="left"
        class="h-8 pr-1 bg-base-100"
        onClick={() => {
          scrollElementHorizontally(scrollEl, SPEC_SCROLL_STEP);
          updateEdges();
        }}
      />
    </div>
  );
}

export interface SpecTableScrollController {
  canScrollLeft: Accessor<boolean>;
  canScrollRight: Accessor<boolean>;
  bindHeader: (el: HTMLDivElement) => void;
  bindVListWrapper: (wrapper: HTMLDivElement) => void;
  scrollBy: (direction: -1 | 1) => void;
  onHeaderWheel: (e: WheelEvent) => void;
  refreshEdges: () => void;
}

/**
 * Synchronizes horizontal scroll state across the table header, virtualized list, and arrow controls.
 */
export function createSpecTableScrollController(
  specModal: Accessor<boolean>,
): SpecTableScrollController {
  const [canScrollLeft, setCanScrollLeft] = createSignal(false);
  const [canScrollRight, setCanScrollRight] = createSignal(false);

  let headerEl: HTMLDivElement | undefined;
  let wrapperEl: HTMLDivElement | undefined;
  let vlistEl: HTMLDivElement | undefined;
  let attachedVlist: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let headerResizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;
  let scrollHandler: (() => void) | undefined;
  let dragCleanup: (() => void) | undefined;
  let observedRightMax: number | null = null;

  const updateEdges = () => {
    if (!vlistEl) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const maxScrollLeft = Math.max(
      0,
      vlistEl.scrollWidth - vlistEl.clientWidth,
    );
    const effectiveMax =
      observedRightMax !== null
        ? Math.min(maxScrollLeft, observedRightMax)
        : maxScrollLeft;
    setCanScrollLeft(vlistEl.scrollLeft > 1);
    setCanScrollRight(vlistEl.scrollLeft < effectiveMax - 1);
  };

  const syncFromVlist = () => {
    if (headerEl && vlistEl) {
      headerEl.scrollLeft = vlistEl.scrollLeft;
    }
    updateEdges();
  };

  const detachVlist = () => {
    resizeObserver?.disconnect();
    dragCleanup?.();
    dragCleanup = undefined;
    if (attachedVlist && scrollHandler) {
      attachedVlist.removeEventListener("scroll", scrollHandler);
    }
    attachedVlist = undefined;
    scrollHandler = undefined;
  };

  const attachCurrentVlist = () => {
    const nextVlist = wrapperEl?.querySelector(
      ".specification-vlist",
    ) as HTMLDivElement | null;
    if (!nextVlist) {
      detachVlist();
      vlistEl = undefined;
      observedRightMax = null;
      updateEdges();
      return;
    }

    vlistEl = nextVlist;
    if (attachedVlist !== nextVlist) {
      detachVlist();
      attachedVlist = nextVlist;
      observedRightMax = null;
      scrollHandler = syncFromVlist;
      dragCleanup = drag_scroll_fn(nextVlist, specModal);
      nextVlist.addEventListener("scroll", scrollHandler);

      resizeObserver = new ResizeObserver(() => {
        observedRightMax = null;
        syncFromVlist();
      });
      resizeObserver.observe(nextVlist);
      if (nextVlist.firstElementChild) {
        resizeObserver.observe(nextVlist.firstElementChild);
      }
    }
    syncFromVlist();
  };

  const ensureConnectedVlist = () => {
    if ((!vlistEl || !vlistEl.isConnected) && wrapperEl) {
      attachCurrentVlist();
    }
  };

  onCleanup(() => {
    mutationObserver?.disconnect();
    headerResizeObserver?.disconnect();
    detachVlist();
  });

  const bindHeader = (el: HTMLDivElement) => {
    headerEl = el;
    headerResizeObserver?.disconnect();
    headerResizeObserver = new ResizeObserver(() => {
      observedRightMax = null;
      syncFromVlist();
    });
    headerResizeObserver.observe(el);
    syncFromVlist();
  };

  const bindVListWrapper = (wrapper: HTMLDivElement) => {
    wrapperEl = wrapper;
    mutationObserver?.disconnect();
    // Re-bind if Solid or a child list update ever replaces the .specification-vlist node.
    mutationObserver = new MutationObserver(() => {
      const current = wrapper.querySelector(
        ".specification-vlist",
      ) as HTMLDivElement | null;
      if (current !== attachedVlist) {
        attachCurrentVlist();
      }
    });
    mutationObserver.observe(wrapper, { childList: true, subtree: true });

    attachCurrentVlist();
    queueMicrotask(attachCurrentVlist);
  };

  const applyHorizontalDelta = (delta: number) => {
    ensureConnectedVlist();
    const moved = scrollElementHorizontally(vlistEl, delta);
    if (!moved && delta > 0 && vlistEl && canScrollHorizontally(vlistEl)) {
      observedRightMax = vlistEl.scrollLeft;
    } else if (delta < 0) {
      observedRightMax = null;
    }
    syncFromVlist();
  };

  const scrollBy = (direction: -1 | 1) => {
    if (specModal()) return;
    applyHorizontalDelta(direction * SPEC_SCROLL_STEP);
  };

  const onHeaderWheel = (e: WheelEvent) => {
    if (specModal()) return;
    ensureConnectedVlist();
    if (!canScrollHorizontally(vlistEl)) return;

    const delta = getHorizontalWheelDelta(e);
    if (delta === 0) return;

    // Keep wheel locked to horizontal header scrolling even after reaching the left/right edge.
    e.preventDefault();
    applyHorizontalDelta(delta);
  };

  return {
    canScrollLeft,
    canScrollRight,
    bindHeader,
    bindVListWrapper,
    scrollBy,
    onHeaderWheel,
    refreshEdges: () =>
      queueMicrotask(() => {
        ensureConnectedVlist();
        syncFromVlist();
      }),
  };
}

export interface SpecTableHeaderBarProps {
  controller: SpecTableScrollController;
  tableWidth: string;
  children: JSX.Element;
}

/**
 * Specification table header container with wheel-to-horizontal scroll and right scroll arrow control.
 */
export function SpecTableHeaderBar(props: SpecTableHeaderBarProps) {
  let wrapperEl!: HTMLDivElement;

  onMount(() => {
    const handleWheel = (e: WheelEvent) => {
      props.controller.onHeaderWheel(e);
    };
    wrapperEl.addEventListener("wheel", handleWheel, { passive: false });
    onCleanup(() => {
      wrapperEl.removeEventListener("wheel", handleWheel);
    });
  });

  return (
    <div ref={wrapperEl} class="relative w-full bg-base-100 shrink-0">
      <div ref={props.controller.bindHeader} class="specification-header">
        <table class="table table-xs" style={{ width: props.tableWidth }}>
          {props.children}
        </table>
      </div>
      <div class="absolute right-0 top-0 bottom-0 z-[25] w-9 pt-4 pb-1 flex items-center justify-end pr-1 bg-base-100">
        <SpecScrollArrowButton
          direction="right"
          disabled={!props.controller.canScrollRight()}
          ariaLabel="Scroll table columns right"
          dataRole="header-right"
          divider="left"
          onClick={() => props.controller.scrollBy(1)}
        />
      </div>
    </div>
  );
}

export type SpecTableRowEntry = [number, boolean, number];

/**
 * Filters specification table IDs while preserving the original sorted row index for virtual rendering.
 */
export function buildVisibleSpecRows(
  ids: (number | string)[],
  visibleById: Record<number, boolean>,
): SpecTableRowEntry[] {
  return ids
    .map((id, index): SpecTableRowEntry => {
      const numericId = Number(id);
      return [numericId, visibleById[numericId] ?? false, index];
    })
    .filter(([, visible]) => visible);
}

export interface SpecTableVirtualListProps {
  rows: Accessor<SpecTableRowEntry[]>;
  height?: string;
  tableWidth: string;
  renderRow: (id: number, index: number) => JSX.Element;
}

/**
 * Virtualized specification table body that keeps the scroll container stable across data/sort updates.
 */
export function SpecTableVirtualList(props: SpecTableVirtualListProps) {
  return (
    <VList
      data={props.rows()}
      style={{
        height: props.height ?? "100%",
        "--table-width": props.tableWidth,
      }}
      class="specification-vlist"
    >
      {([id, , index]) => (
        <table class="table table-xs" style={{ width: props.tableWidth }}>
          <tbody>{props.renderRow(Number(id), Number(index))}</tbody>
        </table>
      )}
    </VList>
  );
}
