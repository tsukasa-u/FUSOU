/**
 * Attaches 3-stage sticky wheel coordination to a sticky scrollable container:
 * 1. If the container is not yet pinned at its sticky top target, scroll the
 *    outer page first until it reaches the sticky position.
 * 2. Once pinned, scroll the inner scrollable element under the pointer (or
 *    fallback scrollable element).
 * 3. Once the inner element reaches its top/bottom boundary, release to outer
 *    page scroll naturally.
 */

export type StickyWheelScrollOptions = {
  /** Skip interception when true (e.g. when a panel is in full-expand mode). */
  isDisabled?: () => boolean;
  /** Optional fallback scrollable element when pointer is over a non-scrolling header. */
  getFallbackScrollEl?: () => HTMLElement | null;
  /** Include --fusou-mobile-picker-offset below xl (1280px). Default: false. */
  includeMobilePickerOffset?: boolean;
};

function parseCssLength(
  raw: string,
  rootFont: number,
  fallback: number,
): number {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (trimmed.endsWith("rem")) return parseFloat(trimmed) * rootFont;
  const px = parseFloat(trimmed);
  return Number.isFinite(px) ? px : fallback;
}

function isScrollableY(el: HTMLElement): boolean {
  if (el.offsetParent === null) return false;
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const overflowY = getComputedStyle(el).overflowY;
  return overflowY === "auto" || overflowY === "scroll";
}

function findScrollableTarget(
  container: HTMLElement,
  eventTarget: EventTarget | null,
  getFallbackScrollEl?: () => HTMLElement | null,
): HTMLElement | null {
  let node: Element | null =
    eventTarget instanceof Element ? eventTarget : null;
  while (node && node !== container) {
    if (node instanceof HTMLElement && isScrollableY(node)) {
      return node;
    }
    node = node.parentElement;
  }
  if (getFallbackScrollEl) {
    const fallback = getFallbackScrollEl();
    if (fallback && fallback.offsetParent !== null) return fallback;
  }
  return null;
}

export function attachStickyWheelScroll(
  container: HTMLElement,
  options: StickyWheelScrollOptions = {},
): () => void {
  if (typeof window === "undefined") return () => {};

  const getTargetTopPx = (): number => {
    const rootStyle = getComputedStyle(document.documentElement);
    const rootFont = parseFloat(rootStyle.fontSize) || 16;
    const navOffset = parseCssLength(
      rootStyle.getPropertyValue("--fusou-nav-offset"),
      rootFont,
      5 * rootFont,
    );
    if (
      !options.includeMobilePickerOffset ||
      window.matchMedia("(min-width: 1280px)").matches
    ) {
      return navOffset;
    }
    const mobilePickerOffset = parseCssLength(
      getComputedStyle(container).getPropertyValue(
        "--fusou-mobile-picker-offset",
      ),
      rootFont,
      0,
    );
    return navOffset + mobilePickerOffset;
  };

  const onWheel = (e: WheelEvent) => {
    if (options.isDisabled?.() || e.ctrlKey) return;
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX) || e.deltaY === 0) return;

    const dy =
      e.deltaMode === 1
        ? e.deltaY * 16
        : e.deltaMode === 2
          ? e.deltaY * window.innerHeight
          : e.deltaY;

    const scrollEl = findScrollableTarget(
      container,
      e.target,
      options.getFallbackScrollEl,
    );
    const maxInnerScroll = scrollEl
      ? Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
      : 0;
    const rect = container.getBoundingClientRect();
    const targetTop = getTargetTopPx();
    const maxPageScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );

    if (dy > 0) {
      // Stage 1: Align container top to sticky target before scrolling inner content
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

      // Stage 2: Pinned — scroll inner content while it still has room
      if (scrollEl && scrollEl.scrollTop < maxInnerScroll - 1) {
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
    // Stage 1 (reverse): If container was pushed above targetTop, align back first
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

    // If container is still below targetTop, let outer page scroll up freely
    if (rect.top > targetTop + 2) {
      if (
        scrollEl &&
        scrollEl.scrollTop > 1 &&
        scrollEl.contains(e.target as Node)
      ) {
        e.preventDefault();
        window.scrollBy(0, dy);
      }
      return;
    }

    // Stage 2 (reverse): Pinned — scroll inner content back to top
    if (scrollEl && scrollEl.scrollTop > 1) {
      if (!scrollEl.contains(e.target as Node)) {
        e.preventDefault();
        scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + dy);
      }
      return;
    }
    // Stage 3 (reverse): Inner content at top — let outer page scroll up freely
  };

  container.addEventListener("wheel", onWheel, { passive: false });
  return () => container.removeEventListener("wheel", onWheel);
}
