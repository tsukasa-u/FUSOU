// ── Generic virtual scroll helpers ──

const VS_BUFFER = 10;

export const SHIP_ROW_PITCH = 46;
export const HEADER_HEIGHT = 30;
export const EQUIP_ROW_PITCH = 45;

/** State for grouped (variable-height) virtual scroll. */
export interface GroupedVSState {
  rows: unknown[];
  offsets: number[];
  spacer: HTMLElement;
  viewport: HTMLElement;
  grid: HTMLElement;
  rStart: number;
  rEnd: number;
}

/** State for flat (uniform-height) virtual scroll. */
export interface FlatVSState {
  items: unknown[];
  spacer: HTMLElement;
  viewport: HTMLElement;
  grid: HTMLElement;
  cols: number;
  pitch: number;
  measured: boolean;
  rStart: number;
  rEnd: number;
}

/**
 * Core sync logic for grouped (variable-height) virtual scroll.
 * Binary-searches for the first visible row and renders the visible window.
 */
export function syncGroupedVS(
  st: GroupedVSState,
  renderRow: (row: any, index: number) => HTMLElement,
): boolean {
  const { rows, offsets, spacer, viewport, grid } = st;
  const totalH = offsets[rows.length];
  spacer.style.height = `${totalH}px`;
  const spacerTop = spacer.offsetTop;
  const scrollTop = Math.max(0, grid.scrollTop - spacerTop);
  const viewH = grid.clientHeight;
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (offsets[mid + 1] <= scrollTop) lo = mid + 1; else hi = mid; }
  const rStart = Math.max(0, lo - VS_BUFFER);
  let rEnd = lo;
  while (rEnd < rows.length && offsets[rEnd] < scrollTop + viewH) rEnd++;
  rEnd = Math.min(rows.length, rEnd + VS_BUFFER);
  if (rStart === st.rStart && rEnd === st.rEnd) return false;
  st.rStart = rStart;
  st.rEnd = rEnd;
  viewport.style.top = `${offsets[rStart]}px`;
  viewport.innerHTML = "";
  for (let i = rStart; i < rEnd; i++) {
    viewport.appendChild(renderRow(rows[i], i));
  }
  return true;
}

/**
 * Core sync logic for flat (uniform-height) virtual scroll.
 * Supports multi-column layouts via `state.cols`.
 */
export function syncFlatVS(
  st: FlatVSState,
  renderItem: (item: any) => HTMLElement,
  responsiveCols?: () => number,
): boolean {
  if (responsiveCols) {
    const newCols = responsiveCols();
    if (newCols !== st.cols) {
      st.cols = newCols;
      st.measured = false;
      st.rStart = -1;
    }
  }
  const { items, spacer, viewport, grid, cols } = st;
  const pitch = st.pitch;
  const rc = Math.ceil(items.length / cols);
  spacer.style.height = `${rc * pitch}px`;

  const spacerTop = spacer.offsetTop;
  const vis0 = Math.max(0, grid.scrollTop - spacerTop);
  const vis1 = vis0 + grid.clientHeight;
  const rStart = Math.max(0, Math.floor(vis0 / pitch) - VS_BUFFER);
  const rEnd = Math.min(rc, Math.ceil(vis1 / pitch) + VS_BUFFER);
  if (rStart === st.rStart && rEnd === st.rEnd) return false;
  st.rStart = rStart;
  st.rEnd = rEnd;

  viewport.style.top = `${rStart * pitch}px`;
  viewport.innerHTML = "";
  const iEnd = Math.min(items.length, rEnd * cols);
  for (let i = rStart * cols; i < iEnd; i++) {
    viewport.appendChild(renderItem(items[i]));
  }

  if (!st.measured && viewport.children.length > cols) {
    const first = (viewport.children[0] as HTMLElement).getBoundingClientRect();
    const second = (viewport.children[cols] as HTMLElement).getBoundingClientRect();
    const actual = second.top - first.top;
    if (actual > 0 && Math.abs(actual - pitch) > 1) {
      st.pitch = actual;
      st.rStart = -1;
      syncFlatVS(st, renderItem, responsiveCols);
      return true;
    }
    st.measured = true;
  }
  return true;
}

export function createGroupHeader(text: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "bg-base-100/90 backdrop-blur-sm px-2 text-xs font-bold text-base-content/50 border-b border-base-200/50 flex items-center";
  h.style.height = `${HEADER_HEIGHT}px`;
  h.textContent = text;
  return h;
}

export function createVSContainer(): { spacer: HTMLElement; viewport: HTMLElement } {
  const spacer = document.createElement("div");
  spacer.style.position = "relative";
  const viewport = document.createElement("div");
  viewport.style.cssText = "position:absolute;left:0;right:0;";
  spacer.appendChild(viewport);
  return { spacer, viewport };
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
  for (const cat of catOffsets) {
    const { text, title } = labelFn(cat);
    const btn = document.createElement("button");
    btn.className = "w-full text-left px-2 py-1.5 text-[11px] leading-tight hover:bg-primary/10 active:bg-primary/15 transition-colors text-base-content/60 hover:text-base-content";
    btn.textContent = text;
    btn.title = title;
    btn.addEventListener("click", () => {
      const grid = document.getElementById(gridId);
      if (!grid) return;
      const spacer = grid.querySelector("div[style*='position: relative']") as HTMLElement | null;
      const spacerTop = spacer ? spacer.offsetTop : 0;
      grid.scrollTop = spacerTop + cat.offset;
    });
    nav.appendChild(btn);
  }
}

export function cleanupSingleVS(
  vsState: { grid: HTMLElement } | null,
  handler: EventListener,
  rafId: number,
): number {
  if (vsState) {
    vsState.grid.removeEventListener("scroll", handler);
    if (rafId) cancelAnimationFrame(rafId);
  }
  return 0;
}
