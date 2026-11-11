import type { Accessor, JSX } from "solid-js";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
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
  class?: string;
  onClick: () => void;
}

/**
 * Compact horizontal scroll arrow button used on category tab strips and table headers.
 */
export function SpecScrollArrowButton(props: SpecScrollArrowButtonProps) {
  return (
    <button
      type="button"
      data-spec-scroll={props.dataRole}
      aria-label={props.ariaLabel}
      title={props.direction === "left" ? "Scroll left" : "Scroll right"}
      disabled={props.disabled}
      class={[
        "btn btn-ghost btn-xs p-0 rounded-none shrink-0 flex items-center justify-center text-base-content/70 hover:text-base-content disabled:opacity-25 disabled:bg-transparent",
        props.class ?? "",
      ].join(" ")}
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
    scroll_fn(barEl, props.modalOpen, scrollEl);
    drag_scroll_fn(scrollEl, props.modalOpen);

    scrollEl.addEventListener("scroll", updateEdges);
    const resizeObserver = new ResizeObserver(updateEdges);
    resizeObserver.observe(scrollEl);
    if (contentEl) {
      resizeObserver.observe(contentEl);
    }

    updateEdges();
    onCleanup(() => {
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
      class="flex items-center w-full bg-base-100"
    >
      <SpecScrollArrowButton
        direction="left"
        disabled={!canScrollLeft()}
        ariaLabel="Scroll category tabs left"
        dataRole="category-left"
        class="h-8 w-7 border-r border-base-300/60"
        onClick={() => {
          scrollElementHorizontally(scrollEl, -SPEC_SCROLL_STEP);
          updateEdges();
        }}
      />
      <div
        ref={scrollEl}
        data-spec-scroll="category-viewport"
        class="overflow-x-auto flex-1 min-w-0 specification-tab-scroll"
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
        class="h-8 w-7 border-l border-base-300/60"
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
  let vlistEl: HTMLDivElement | undefined;
  let attachedVlist: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let scrollHandler: (() => void) | undefined;
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

  onCleanup(() => {
    resizeObserver?.disconnect();
    if (attachedVlist && scrollHandler) {
      attachedVlist.removeEventListener("scroll", scrollHandler);
    }
  });

  const bindHeader = (el: HTMLDivElement) => {
    headerEl = el;
    syncFromVlist();
  };

  const bindVListWrapper = (wrapper: HTMLDivElement) => {
    queueMicrotask(() => {
      const nextVlist = wrapper?.querySelector(
        ".specification-vlist",
      ) as HTMLDivElement | null;
      if (!nextVlist) return;

      vlistEl = nextVlist;
      if (attachedVlist !== nextVlist) {
        if (attachedVlist && scrollHandler) {
          attachedVlist.removeEventListener("scroll", scrollHandler);
        }
        attachedVlist = nextVlist;
        scrollHandler = syncFromVlist;
        drag_scroll_fn(nextVlist, specModal);
        nextVlist.addEventListener("scroll", scrollHandler);

        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
          observedRightMax = null;
          updateEdges();
        });
        resizeObserver.observe(nextVlist);
        if (nextVlist.firstElementChild) {
          resizeObserver.observe(nextVlist.firstElementChild);
        }
      }
      syncFromVlist();
    });
  };

  const applyHorizontalDelta = (delta: number) => {
    const moved = scrollElementHorizontally(vlistEl, delta);
    if (!moved && delta > 0 && vlistEl) {
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
    refreshEdges: () => queueMicrotask(updateEdges),
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
    <div ref={wrapperEl} class="relative w-full bg-base-100">
      <div ref={props.controller.bindHeader} class="specification-header">
        <table class="table table-xs" style={{ width: props.tableWidth }}>
          {props.children}
        </table>
      </div>
      <SpecScrollArrowButton
        direction="right"
        disabled={!props.controller.canScrollRight()}
        ariaLabel="Scroll table columns right"
        dataRole="header-right"
        class="absolute right-0 top-1 bottom-0 z-[6] h-auto w-7 bg-base-100 border-l border-base-300/60"
        onClick={() => props.controller.scrollBy(1)}
      />
    </div>
  );
}
