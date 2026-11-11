import type { Accessor } from "solid-js";

/**
 * Normalizes a WheelEvent delta value across pixel, line, and page delta modes.
 */
export function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 40;
  if (deltaMode === 2) return delta * 320;
  return delta;
}

/**
 * Normalizes WheelEvent vertical delta across pixel, line, and page delta modes.
 */
export function normalizeWheelDeltaY(e: WheelEvent): number {
  return normalizeWheelDelta(e.deltaY, e.deltaMode);
}

/**
 * Picks the dominant horizontal scroll delta (deltaX when horizontal, otherwise deltaY).
 */
export function getHorizontalWheelDelta(e: WheelEvent): number {
  const dominant =
    Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  return normalizeWheelDelta(dominant, e.deltaMode);
}

/**
 * Returns true if the target element currently has horizontal overflow to scroll.
 */
export function canScrollHorizontally(
  el: HTMLElement | null | undefined,
): boolean {
  return Boolean(el && el.scrollWidth - el.clientWidth > 1);
}

/**
 * Scrolls an element horizontally by deltaX, clamping within its scrollable bounds.
 * Returns true if scrollLeft actually changed.
 */
export function scrollElementHorizontally(
  el: HTMLElement | null | undefined,
  deltaX: number,
): boolean {
  if (!el || deltaX === 0) return false;
  const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
  if (maxScrollLeft <= 0) return false;

  const before = el.scrollLeft;
  const nextScrollLeft = Math.max(
    0,
    Math.min(maxScrollLeft, before + deltaX),
  );
  el.scrollLeft = nextScrollLeft;
  return Math.abs(el.scrollLeft - before) >= 0.5;
}

export const drag_scroll_fn = (
  el: HTMLDivElement,
  spec_modal: Accessor<boolean>,
) => {
  let isDragging = false;
  let startX = 0;
  let scrollStartX = 0;

  let velocity = 0;
  let animationFrameId: number;
  let lastPageX = 0;

  el.addEventListener("mousedown", (e) => {
    if (spec_modal()) return;
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.pageX;
    scrollStartX = el.scrollLeft;
    el.style.cursor = "grabbing";

    velocity = 0;
    lastPageX = e.pageX;

    cancelAnimationFrame(animationFrameId);
  });

  document.addEventListener("mousemove", (e) => {
    if (spec_modal()) return;
    if (!isDragging) return;

    const deltaX = e.pageX - startX;
    el.scrollLeft = scrollStartX - deltaX;

    velocity = e.pageX - lastPageX;
    lastPageX = e.pageX;
  });

  document.addEventListener("mouseup", () => {
    if (spec_modal()) return;
    if (isDragging) {
      isDragging = false;
      el.style.cursor = "auto";

      startInertiaScroll();
    }
  });

  el.addEventListener("mouseleave", () => {
    if (spec_modal()) return;
    if (isDragging) {
      isDragging = false;
      el.style.cursor = "auto";

      startInertiaScroll();
    }
  });

  function startInertiaScroll() {
    const friction = 0.95;
    function inertia() {
      el.scrollLeft -= velocity;
      velocity *= friction;
      if (Math.abs(velocity) > 0.1) {
        animationFrameId = requestAnimationFrame(inertia);
      }
    }
    inertia();
  }
};

export const scroll_parent_fn = (
  el: HTMLDivElement,
  pa: HTMLDivElement,
  spec_modal: Accessor<boolean>,
) => {
  el.addEventListener("wheel", (e) => {
    if (spec_modal()) return;
    if (
      el.offsetLeft > e.pageX ||
      e.pageX > el.offsetLeft + el.clientWidth ||
      el.offsetTop > e.pageY ||
      e.pageY > el.offsetTop + el.clientHeight
    )
      return;
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;

    const maxScrollLeft = pa.scrollWidth - pa.clientWidth;

    if (
      (pa.scrollLeft <= 0 && e.deltaY < 0) ||
      (pa.scrollLeft >= maxScrollLeft && e.deltaY > 0)
    )
      return;

    e.preventDefault();
    pa.scrollLeft += e.deltaY;
  });
};

export const scroll_fn = (
  wheelTarget: HTMLElement,
  spec_modal: Accessor<boolean>,
  scrollTarget: HTMLElement = wheelTarget,
) => {
  wheelTarget.addEventListener(
    "wheel",
    (e) => {
      if (spec_modal()) return;
      if (!canScrollHorizontally(scrollTarget)) return;

      const delta = getHorizontalWheelDelta(e);
      if (delta === 0) return;

      // Consume the wheel on horizontal strips even at scroll boundaries
      // so reaching either end does not suddenly chain into vertical scrolling.
      e.preventDefault();
      scrollElementHorizontally(scrollTarget, delta);
    },
    { passive: false },
  );
};
