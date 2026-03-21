// ── Shared simulator list helpers ──

export const SHIP_ROW_PITCH = 46;
export const HEADER_HEIGHT = 30;
export const EQUIP_ROW_PITCH = 45;

export function createGroupHeader(text: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "bg-base-100/90 backdrop-blur-sm px-2 text-xs font-bold text-base-content/50 border-b border-base-200/50 flex items-center";
  h.style.height = `${HEADER_HEIGHT}px`;
  h.textContent = text;
  return h;
}

export function renderCategoryNav(
  navId: string,
  gridId: string,
  catOffsets: { offset: number }[],
  labelFn: (cat: any) => { text: string; title: string },
): void {
  const nav = document.getElementById(navId);
  if (!nav) return;
  nav.innerHTML = "";
  if (catOffsets.length === 0) { nav.classList.add("hidden"); nav.classList.remove("sm:block"); return; }
  nav.classList.remove("hidden"); nav.classList.add("sm:block");
  nav.scrollTop = 0;

  const resolveScrollTarget = (grid: HTMLElement): HTMLElement => {
    const candidates = [grid, ...Array.from(grid.querySelectorAll<HTMLElement>("*"))];
    for (const el of candidates) {
      if (el.scrollHeight <= el.clientHeight) continue;
      const style = window.getComputedStyle(el);
      if (
        style.overflow === "auto"
        || style.overflow === "scroll"
        || style.overflowY === "auto"
        || style.overflowY === "scroll"
      ) {
        return el;
      }
    }
    return grid;
  };

  for (const cat of catOffsets) {
    const { text, title } = labelFn(cat);
    const btn = document.createElement("button");
    btn.className = "w-full text-left px-2 py-1.5 text-[11px] leading-tight hover:bg-primary/10 active:bg-primary/15 transition-colors text-base-content/60 hover:text-base-content";
    btn.textContent = text;
    btn.title = title;
    btn.addEventListener("click", () => {
      const grid = document.getElementById(gridId);
      if (!grid) return;
      const scrollTarget = resolveScrollTarget(grid);
      const spacer = scrollTarget.querySelector("div[style*='position: relative']") as HTMLElement | null;
      const spacerTop = spacer ? spacer.offsetTop : 0;
      scrollTarget.scrollTop = spacerTop + cat.offset;
    });
    nav.appendChild(btn);
  }
}

