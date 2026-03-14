// ── Ship Selection Modal ──

import { state } from "./state";
import type { MstShipData } from "./types";
import { STYPE_NAMES, STYPE_SHORT, SPEED_NAMES } from "./constants";
import { debounce, bannerUrl } from "./equip-calc";
import type { FlatVSState, GroupedVSState } from "./virtual-scroll";
import {
  SHIP_ROW_PITCH, HEADER_HEIGHT,
  syncFlatVS, syncGroupedVS,
  createGroupHeader, createVSContainer, renderCategoryNav, cleanupSingleVS,
} from "./virtual-scroll";

// ── Ship virtual scroll (flat, for filtered view) ──
type ShipGRow =
  | { kind: "header"; stype: number }
  | { kind: "items"; ships: MstShipData[] };

let _shipVS: (FlatVSState & { items: MstShipData[] }) | null = null;
let _shipScrollRaf = 0;
let _shipGVS: (GroupedVSState & { rows: ShipGRow[]; cols: number }) | null = null;
let _shipGScrollRaf = 0;

function onShipScroll() {
  if (!_shipScrollRaf) {
    _shipScrollRaf = requestAnimationFrame(() => { _shipScrollRaf = 0; syncShipVS(); });
  }
}
function onShipGScroll() {
  if (!_shipGScrollRaf) {
    _shipGScrollRaf = requestAnimationFrame(() => { _shipGScrollRaf = 0; syncShipGVS(); });
  }
}

function cleanupShipVS() {
  _shipScrollRaf = cleanupSingleVS(_shipVS, onShipScroll, _shipScrollRaf);
  _shipVS = null;
  _shipGScrollRaf = cleanupSingleVS(_shipGVS, onShipGScroll, _shipGScrollRaf);
  _shipGVS = null;
}

const shipResponsiveCols = () => window.matchMedia("(min-width: 640px)").matches ? 2 : 1;

function syncShipVS() {
  if (!_shipVS) return;
  syncFlatVS(_shipVS, createShipItem, shipResponsiveCols);
}

function syncShipGVS() {
  if (!_shipGVS) return;
  const { cols } = _shipGVS;
  syncGroupedVS(_shipGVS, (row: ShipGRow) => {
    if (row.kind === "header") {
      return createGroupHeader(STYPE_NAMES[row.stype] ?? `Type ${row.stype}`);
    }
    const rd = document.createElement("div");
    rd.style.height = `${SHIP_ROW_PITCH}px`;
    if (cols > 1) { rd.style.display = "grid"; rd.style.gridTemplateColumns = "repeat(2,1fr)"; rd.style.gap = "2px"; }
    for (const s of row.ships) rd.appendChild(createShipItem(s));
    return rd;
  });
}

export function openShipModal(currentId: number | null, cb: (id: number | null) => void) {
  if (!state.hasMasterData) return;
  state.shipModalCb = cb;
  state.shipModalCurrentId = currentId;
  const modal = document.getElementById("ship-select-modal");
  const search = document.getElementById("ship-modal-search");
  const stype = document.getElementById("ship-modal-stype");
  if (!(modal instanceof HTMLDialogElement) || !(search instanceof HTMLInputElement) || !(stype instanceof HTMLSelectElement)) return;
  search.value = "";
  populateStypeFilter(stype);

  const tabsEl = document.getElementById("ship-modal-source-tabs");
  const hasSnapshot = Object.keys(state.snapshotShips).length > 0;
  if (tabsEl) {
    tabsEl.classList.toggle("hidden", !hasSnapshot);
  }
  state.shipModalSource = hasSnapshot ? "snapshot" : "master";
  updateSourceTabs();

  renderShipGrid("", "");
  resetShipDetail();
  modal.showModal();
  requestAnimationFrame(() => search.focus());
}

function updateSourceTabs() {
  const tabsEl = document.getElementById("ship-modal-source-tabs");
  if (!tabsEl) return;
  for (const btn of Array.from(tabsEl.querySelectorAll("[data-source]"))) {
    const isActive = (btn as HTMLElement).dataset.source === state.shipModalSource;
    btn.classList.toggle("tab-active", isActive);
  }
}

function populateStypeFilter(select: HTMLSelectElement) {
  const current = select.value;
  select.innerHTML = '<option value="">全艦種</option>';
  const stypes = new Set<number>();
  for (const s of Object.values(state.mstShips)) {
    if (s.stype >= 1 && s.stype <= 22) stypes.add(s.stype);
  }
  for (const st of [...stypes].sort((a, b) => a - b)) {
    const opt = document.createElement("option");
    opt.value = String(st);
    opt.textContent = STYPE_NAMES[st] ?? `Type ${st}`;
    if (String(st) === current) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderShipGrid(search: string, stypeFilter: string) {
  const grid = document.getElementById("ship-modal-grid")!;
  grid.innerHTML = "";
  cleanupShipVS();

  let ships: MstShipData[];

  if (state.shipModalSource === "snapshot" && Object.keys(state.snapshotShips).length > 0) {
    const variantMap = new Map<string, { shipId: number; level: number; name: string; stype: number; count: number }>();
    for (const ss of Object.values(state.snapshotShips)) {
      const key = `${ss.shipId}_${ss.level ?? 0}`;
      const existing = variantMap.get(key);
      if (existing) { existing.count++; } else { variantMap.set(key, { ...ss, count: 1 }); }
    }
    ships = [...variantMap.values()]
      .map((v) => {
        const mst = state.mstShips[v.shipId];
        if (!mst) return null;
        return { ...mst, _snapshotLevel: v.level, _snapshotCount: v.count } as MstShipData & { _snapshotLevel?: number; _snapshotCount?: number };
      })
      .filter((s): s is MstShipData => s != null)
      .sort((a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id));
  } else {
    ships = Object.values(state.mstShips).sort((a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id));
  }

  if (stypeFilter) ships = ships.filter((s) => s.stype === parseInt(stypeFilter, 10));
  if (search) {
    const q = search.toLowerCase();
    ships = ships.filter((s) => s.name.toLowerCase().includes(q) || String(s.id).includes(q));
  }

  if (ships.length === 0) {
    grid.innerHTML = '<p class="text-sm text-base-content/30 text-center py-12">該当する艦娘が見つかりません</p>';
    renderShipCategoryNav([]);
    return;
  }

  if (state.shipModalCurrentId != null) {
    const clearItem = document.createElement("div");
    clearItem.className = "flex items-center gap-2 px-3 py-2 mb-1 rounded-lg cursor-pointer bg-error/5 hover:bg-error/10 text-error/70 hover:text-error transition-colors text-sm";
    clearItem.textContent = "✕ 選択を解除";
    clearItem.addEventListener("click", () => {
      state.shipModalCb?.(null);
      state.shipModalCb = null;
      (document.getElementById("ship-select-modal") as HTMLDialogElement).close();
    });
    grid.appendChild(clearItem);
  }

  const cols = window.matchMedia("(min-width: 640px)").matches ? 2 : 1;

  if (!stypeFilter) {
    const groups = new Map<number, MstShipData[]>();
    for (const s of ships) {
      const arr = groups.get(s.stype);
      if (arr) arr.push(s);
      else groups.set(s.stype, [s]);
    }
    const sortedStypes = [...groups.keys()].sort((a, b) => a - b);
    const rows: ShipGRow[] = [];
    const catOffsets: { stype: number; offset: number }[] = [];
    let totalH = 0;
    for (const st of sortedStypes) {
      catOffsets.push({ stype: st, offset: totalH });
      rows.push({ kind: "header", stype: st });
      totalH += HEADER_HEIGHT;
      const items = groups.get(st)!;
      for (let i = 0; i < items.length; i += cols) {
        rows.push({ kind: "items", ships: items.slice(i, i + cols) });
        totalH += SHIP_ROW_PITCH;
      }
    }
    const offsets = new Array<number>(rows.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < rows.length; i++) {
      offsets[i + 1] = offsets[i] + (rows[i].kind === "header" ? HEADER_HEIGHT : SHIP_ROW_PITCH);
    }

    const { spacer, viewport } = createVSContainer();
    spacer.style.height = `${totalH}px`;
    grid.appendChild(spacer);

    _shipGVS = { rows, offsets, spacer, viewport, grid, cols, rStart: -1, rEnd: -1 };
    grid.addEventListener("scroll", onShipGScroll);
    syncShipGVS();
    renderShipCategoryNav(catOffsets);
  } else {
    const rowCount = Math.ceil(ships.length / cols);
    const { spacer, viewport } = createVSContainer();
    spacer.style.height = `${rowCount * SHIP_ROW_PITCH}px`;
    viewport.className = "grid grid-cols-1 sm:grid-cols-2 gap-0.5";
    grid.appendChild(spacer);

    _shipVS = { items: ships, spacer, viewport, grid, cols, pitch: SHIP_ROW_PITCH, measured: false, rStart: -1, rEnd: -1 };
    grid.addEventListener("scroll", onShipScroll);
    syncShipVS();
    renderShipCategoryNav([]);
  }
}

function renderShipCategoryNav(catOffsets: { stype: number; offset: number }[]) {
  renderCategoryNav("ship-modal-categories", "ship-modal-grid", catOffsets, (c: { stype: number }) => ({
    text: STYPE_SHORT[c.stype] ?? STYPE_NAMES[c.stype] ?? `${c.stype}`,
    title: STYPE_NAMES[c.stype] ?? `Type ${c.stype}`,
  }));
}

function createShipItem(ship: MstShipData): HTMLElement {
  const isSelected = ship.id === state.shipModalCurrentId;
  const item = document.createElement("div");
  item.className = `flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
    isSelected ? "bg-primary/15 ring-1 ring-primary/30" : "hover:bg-primary/8 active:bg-primary/15"
  }`;

  const imgWrap = document.createElement("div");
  imgWrap.className = "w-[72px] h-[28px] bg-base-200 rounded overflow-hidden shrink-0";
  const img = document.createElement("img");
  img.src = bannerUrl(ship.id);
  img.alt = ship.name;
  img.className = "w-full h-full object-cover";
  img.loading = "lazy";
  img.onerror = function () {
    (this as HTMLImageElement).parentElement!.innerHTML =
      `<div class="w-full h-full flex items-center justify-center text-[9px] text-base-content/20 bg-base-200">${ship.id}</div>`;
  };
  imgWrap.appendChild(img);
  item.appendChild(imgWrap);

  const textDiv = document.createElement("div");
  textDiv.className = "min-w-0 flex-1";
  const nameDiv = document.createElement("div");
  nameDiv.className = "text-sm font-medium truncate leading-tight";
  nameDiv.textContent = ship.name;
  textDiv.appendChild(nameDiv);
  const typeDiv = document.createElement("div");
  typeDiv.className = "text-[11px] text-base-content/40 leading-tight";
  const snLevel = (ship as MstShipData & { _snapshotLevel?: number })._snapshotLevel;
  const snShipCount = (ship as MstShipData & { _snapshotCount?: number })._snapshotCount;
  let typeText = snLevel != null
    ? `${STYPE_NAMES[ship.stype] ?? ""} Lv.${snLevel} #${ship.id}`
    : `${STYPE_NAMES[ship.stype] ?? ""} #${ship.id}`;
  if (snShipCount != null && snShipCount > 1) typeText += ` ×${snShipCount}`;
  typeDiv.textContent = typeText;
  textDiv.appendChild(typeDiv);
  item.appendChild(textDiv);

  item.addEventListener("mouseenter", () => renderShipDetail(ship));
  item.addEventListener("click", () => {
    state.shipModalCb?.(ship.id);
    state.shipModalCb = null;
    (document.getElementById("ship-select-modal") as HTMLDialogElement).close();
  });

  return item;
}

function renderShipDetail(ship: MstShipData) {
  const panel = document.getElementById("ship-modal-detail")!;
  panel.innerHTML = "";

  const bannerWrap = document.createElement("div");
  bannerWrap.className = "w-full h-14 bg-base-200 rounded-lg overflow-hidden mb-3";
  const bannerImg = document.createElement("img");
  bannerImg.src = bannerUrl(ship.id);
  bannerImg.className = "w-full h-full object-cover";
  bannerImg.onerror = function () {
    (this as HTMLImageElement).parentElement!.innerHTML =
      '<div class="w-full h-full flex items-center justify-center text-base-content/20 text-xs">No Image</div>';
  };
  bannerWrap.appendChild(bannerImg);
  panel.appendChild(bannerWrap);

  const nameH = document.createElement("h4");
  nameH.className = "font-bold text-lg text-center leading-tight";
  nameH.textContent = ship.name;
  panel.appendChild(nameH);

  const badgeDiv = document.createElement("div");
  badgeDiv.className = "text-center mb-4 mt-1";
  const badge = document.createElement("span");
  badge.className = "badge badge-sm badge-outline gap-1";
  badge.textContent = `${STYPE_NAMES[ship.stype] ?? "?"} #${ship.id}`;
  badgeDiv.appendChild(badge);
  panel.appendChild(badgeDiv);

  const stats: [string, string | number][] = [
    ["耐久", ship.taik?.[0] ?? "—"],
    ["装甲", ship.souk?.[0] ?? "—"],
    ["火力", ship.houg?.[0] ?? "—"],
    ["雷装", ship.raig?.[0] ?? "—"],
    ["対空", ship.tyku?.[0] ?? "—"],
    ["対潜", ship.tais?.[0] ?? "—"],
    ["運", ship.luck?.[0] ?? "—"],
    ["速力", SPEED_NAMES[ship.soku] ?? String(ship.soku)],
    ["スロット数", ship.slot_num],
    ["搭載", ship.maxeq ? ship.maxeq.slice(0, ship.slot_num).join(" / ") : "—"],
  ];

  const grid = document.createElement("div");
  grid.className = "divide-y divide-base-200";
  for (const [label, value] of stats) {
    const row = document.createElement("div");
    row.className = "flex justify-between py-1.5 text-sm";
    const l = document.createElement("span");
    l.className = "text-base-content/50";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "font-mono text-base-content/80 font-medium";
    v.textContent = String(value);
    row.appendChild(l);
    row.appendChild(v);
    grid.appendChild(row);
  }
  panel.appendChild(grid);
}

function resetShipDetail() {
  document.getElementById("ship-modal-detail")!.innerHTML =
    '<p class="text-sm text-base-content/30 text-center pt-10">艦娘にカーソルを合わせると<br/>詳細が表示されます</p>';
}

/** Wire up DOM event listeners for the ship modal. Call once at init time. */
export function initShipModalEvents() {
  const shipSearchEl = document.getElementById("ship-modal-search");
  const shipStypeEl = document.getElementById("ship-modal-stype");
  if (shipSearchEl instanceof HTMLInputElement && shipStypeEl instanceof HTMLSelectElement) {
    shipSearchEl.addEventListener(
      "input",
      debounce(() => {
        renderShipGrid(shipSearchEl.value, shipStypeEl.value);
      }, 120),
    );
    shipStypeEl.addEventListener("change", () => {
      renderShipGrid(shipSearchEl.value, shipStypeEl.value);
    });
  }

  document.getElementById("ship-modal-source-tabs")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-source]") as HTMLElement | null;
    if (!btn) return;
    const src = btn.dataset.source as "snapshot" | "master";
    if (src === state.shipModalSource) return;
    state.shipModalSource = src;
    updateSourceTabs();
    const searchEl = document.getElementById("ship-modal-search");
    const stypeEl = document.getElementById("ship-modal-stype");
    const search = searchEl instanceof HTMLInputElement ? searchEl.value : "";
    const stype = stypeEl instanceof HTMLSelectElement ? stypeEl.value : "";
    renderShipGrid(search, stype);
  });
}

/** Invalidate ship virtual scroll on resize. */
export function handleResizeShip() {
  if (_shipVS) { _shipVS.rStart = -1; _shipVS.measured = false; syncShipVS(); }
  if (_shipGVS) { _shipGVS.rStart = -1; syncShipGVS(); }
}
