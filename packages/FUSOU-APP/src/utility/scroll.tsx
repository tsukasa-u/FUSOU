import type { Accessor } from "solid-js/types/server/reactive.js";

export const drag_scroll_fn = (
  el: HTMLDivElement,
  spec_modal: Accessor<boolean>
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
  spec_modal: Accessor<boolean>
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
  el: HTMLDivElement,
  spec_modal: Accessor<boolean>
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

    const maxScrollLeft = el.scrollWidth - el.clientWidth;

    if (
      (el.scrollLeft <= 0 && e.deltaY < 0) ||
      (el.scrollLeft >= maxScrollLeft && e.deltaY > 0)
    )
      return;

    e.preventDefault();
    el.scrollLeft += e.deltaY;
  });
};
