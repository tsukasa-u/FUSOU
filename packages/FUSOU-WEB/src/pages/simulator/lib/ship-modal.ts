// ── Ship Selection Modal ──

import type { MstShipData } from "./types";
import {
  STYPE_NAMES,
  STYPE_SHORT,
  SPEED_NAMES,
  ENEMY_ID_THRESHOLD,
} from "./constants";
import { debounce, bannerUrl } from "./equip-calc";
import {
  SHIP_ROW_PITCH,
  HEADER_HEIGHT,
  createGroupHeader,
  renderCategoryNav,
} from "./virtual-scroll";
import { createComponent } from "solid-js";
import type { Component } from "solid-js";
import { render } from "solid-js/web";
import { VList } from "virtua/solid";
import {
  beginShipModalSession,
  consumeShipModalCallback,
  setShipModalSideFilter,
  setShipModalSource,
} from "./simulator-mutations";
import {
  getMasterShip,
  getMasterShips,
  getShipModalCurrentId,
  getShipModalSideFilter,
  getShipModalSource,
  getSnapshotShips,
  hasMasterData,
  hasSnapshotShips,
  isWorkspaceReadOnly,
} from "./simulator-selectors";

type ShipVRow =
  | { kind: "clear" }
  | { kind: "header"; stype: number }
  | { kind: "item"; ship: MstShipData };

const SHIP_CLEAR_ROW_HEIGHT = 38;
let _shipVirtuaDispose: (() => void) | null = null;
const ShipVList = VList as unknown as Component<Record<string, unknown>>;
let _shipModalVisibilityBound = false;

function syncShipModalDisplay(modal: HTMLDialogElement): void {
  modal.style.display = modal.open ? "grid" : "none";
}

function ensureShipModalVisibilityBinding(modal: HTMLDialogElement): void {
  if (_shipModalVisibilityBound) return;
  modal.addEventListener("close", () => syncShipModalDisplay(modal));
  modal.addEventListener("cancel", () => syncShipModalDisplay(modal));
  _shipModalVisibilityBound = true;
}

type SideFilter = "ally" | "enemy" | "all";

function filterShipsBySide(
  ships: MstShipData[],
  sideFilter: SideFilter,
): MstShipData[] {
  if (sideFilter === "all") return ships;
  if (sideFilter === "enemy") {
    return ships.filter((s) => s.id >= ENEMY_ID_THRESHOLD);
  }
  return ships.filter((s) => s.id < ENEMY_ID_THRESHOLD);
}

function cleanupShipVS() {
  if (_shipVirtuaDispose) {
    _shipVirtuaDispose();
    _shipVirtuaDispose = null;
  }
}

/** Find the current ship from the active VS cache (snapshot-enriched when available). */
function findCurrentShipInVS(): MstShipData | null {
  const id = getShipModalCurrentId();
  if (id == null) return null;
  // With library virtualization we don't keep a separate VS cache map.
  // For current-id fallback, master data is sufficient.
  return getMasterShip(id);
}

/** Scroll ship grid to the current ship row (call after showModal). */
function scrollToCurrentShipInVS(): void {
  const grid = document.getElementById("ship-modal-grid");
  if (!(grid instanceof HTMLElement)) return;

  // Selected row has ring classes in createShipItem.
  const selected = grid.querySelector(
    ".ring-1.ring-primary\\/30",
  ) as HTMLElement | null;
  if (!selected) return;
  selected.scrollIntoView({ block: "center" });
}

export function openShipModal(
  currentId: number | null,
  cb: (selection: { id: number | null; level?: number | null }) => void,
) {
  if (!hasMasterData()) return;
  beginShipModalSession(currentId, cb);
  if (currentId != null) {
    setShipModalSideFilter(
      currentId >= ENEMY_ID_THRESHOLD ? "enemy" : "ally",
    );
  }
  const modal = document.getElementById("ship-select-modal");
  const search = document.getElementById("ship-modal-search");
  const side = document.getElementById("ship-modal-side");
  const stype = document.getElementById("ship-modal-stype");
  if (
    !(modal instanceof HTMLDialogElement) ||
    !(search instanceof HTMLInputElement) ||
    !(side instanceof HTMLSelectElement) ||
    !(stype instanceof HTMLSelectElement)
  )
    return;
  ensureShipModalVisibilityBinding(modal);
  syncShipModalDisplay(modal);
  search.value = "";
  side.value = getShipModalSideFilter();
  populateStypeFilter(stype, getShipModalSideFilter());

  const tabsEl = document.getElementById("ship-modal-source-tabs");
  const hasSnapshot = hasSnapshotShips();
  if (tabsEl) {
    tabsEl.classList.toggle("hidden", !hasSnapshot);
  }
  setShipModalSource(hasSnapshot ? "snapshot" : "master");
  updateSourceTabs();

  renderShipGrid("", "", getShipModalSideFilter());
  const autoShowShip =
    getShipModalCurrentId() != null
      ? findCurrentShipInVS()
      : null;
  if (autoShowShip) {
    renderShipDetail(autoShowShip);
  } else {
    resetShipDetail();
  }
  modal.showModal();
  syncShipModalDisplay(modal);
  requestAnimationFrame(() => {
    if (autoShowShip) {
      scrollToCurrentShipInVS();
    } else {
      search.focus();
    }
  });
}

function updateSourceTabs() {
  const tabsEl = document.getElementById("ship-modal-source-tabs");
  if (!tabsEl) return;
  for (const btn of Array.from(tabsEl.querySelectorAll("[data-source]"))) {
    const isActive =
      (btn as HTMLElement).dataset.source === getShipModalSource();
    btn.classList.toggle("tab-active", isActive);
  }
}

function populateStypeFilter(
  select: HTMLSelectElement,
  sideFilter: SideFilter,
) {
  const current = select.value;
  select.innerHTML = '<option value="">全艦種</option>';
  const stypes = new Set<number>();
  for (const s of filterShipsBySide(
    Object.values(getMasterShips()),
    sideFilter,
  )) {
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

function renderShipGrid(
  search: string,
  stypeFilter: string,
  sideFilter: SideFilter,
) {
  const grid = document.getElementById("ship-modal-grid")!;
  grid.innerHTML = "";
  cleanupShipVS();

  let ships: MstShipData[];

  if (
    getShipModalSource() === "snapshot" &&
    hasSnapshotShips()
  ) {
    const variantMap = new Map<
      string,
      {
        shipId: number;
        level: number;
        name: string;
        stype: number;
        count: number;
      }
    >();
    for (const ss of Object.values(getSnapshotShips())) {
      const key = `${ss.shipId}_${ss.level ?? 0}`;
      const existing = variantMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        variantMap.set(key, { ...ss, count: 1 });
      }
    }
    ships = [...variantMap.values()]
      .map((v) => {
        const mst = getMasterShip(v.shipId);
        if (!mst) return null;
        return {
          ...mst,
          _snapshotLevel: v.level,
          _snapshotCount: v.count,
        } as MstShipData & { _snapshotLevel?: number; _snapshotCount?: number };
      })
      .filter((s): s is MstShipData => s != null)
      .sort((a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id));
  } else {
    ships = Object.values(getMasterShips()).sort(
      (a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id),
    );
  }

  ships = filterShipsBySide(ships, sideFilter);

  if (stypeFilter)
    ships = ships.filter((s) => s.stype === parseInt(stypeFilter, 10));
  if (search) {
    const q = search.toLowerCase();
    ships = ships.filter(
      (s) => s.name.toLowerCase().includes(q) || String(s.id).includes(q),
    );
  }

  if (ships.length === 0) {
    grid.innerHTML =
      '<p class="text-sm text-base-content/30 text-center py-12">該当する艦娘が見つかりません</p>';
    renderShipCategoryNav([]);
    return;
  }

  const rows: ShipVRow[] = [];
  let catOffsets: { stype: number; offset: number }[] = [];
  let virtualOffset = 0;

  if (getShipModalCurrentId() != null) {
    rows.push({ kind: "clear" });
    virtualOffset += SHIP_CLEAR_ROW_HEIGHT;
  }

  if (!stypeFilter) {
    const groups = new Map<number, MstShipData[]>();
    for (const s of ships) {
      const arr = groups.get(s.stype);
      if (arr) arr.push(s);
      else groups.set(s.stype, [s]);
    }
    const sortedStypes = [...groups.keys()].sort((a, b) => a - b);
    for (const st of sortedStypes) {
      catOffsets.push({ stype: st, offset: virtualOffset });
      rows.push({ kind: "header", stype: st });
      virtualOffset += HEADER_HEIGHT;
      for (const ship of groups.get(st) ?? []) {
        rows.push({ kind: "item", ship });
        virtualOffset += SHIP_ROW_PITCH;
      }
    }
  } else {
    for (const ship of ships) {
      rows.push({ kind: "item", ship });
    }
    catOffsets = [];
  }

  _shipVirtuaDispose = render(
    () =>
      createComponent(ShipVList, {
        data: rows,
        style: {
          height: "100%",
        },
        class: "overflow-x-hidden",
        children: (row: ShipVRow) => {
          if (row.kind === "clear") {
            const wrap = document.createElement("div");
            wrap.style.height = `${SHIP_CLEAR_ROW_HEIGHT}px`;
            wrap.style.boxSizing = "border-box";
            wrap.appendChild(createShipClearItem());
            return wrap;
          }
          if (row.kind === "header") {
            return createGroupHeader(STYPE_NAMES[row.stype] ?? `Type ${row.stype}`);
          }
          const wrap = document.createElement("div");
          wrap.style.height = `${SHIP_ROW_PITCH}px`;
          wrap.style.display = "flex";
          wrap.style.alignItems = "center";
          wrap.style.boxSizing = "border-box";
          wrap.appendChild(createShipItem(row.ship));
          return wrap;
        },
      }),
    grid,
  );
  renderShipCategoryNav(catOffsets);
}

function createShipClearItem(): HTMLElement {
  const clearItem = document.createElement("div");
  clearItem.className =
    "h-full flex items-center gap-2 px-3 rounded-lg cursor-pointer bg-error/5 hover:bg-error/10 text-error/70 hover:text-error transition-colors text-sm";
  clearItem.textContent = "✕ 選択を解除";
  clearItem.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isWorkspaceReadOnly()) return;
    const selection = { id: null, level: null };
    consumeShipModalCallback(selection);
    (document.getElementById("ship-select-modal") as HTMLDialogElement).close();
  });
  return clearItem;
}

function renderShipCategoryNav(
  catOffsets: { stype: number; offset: number }[],
) {
  renderCategoryNav(
    "ship-modal-categories",
    "ship-modal-grid",
    catOffsets,
    (c: { stype: number }) => ({
      text: STYPE_SHORT[c.stype] ?? STYPE_NAMES[c.stype] ?? `${c.stype}`,
      title: STYPE_NAMES[c.stype] ?? `Type ${c.stype}`,
    }),
  );
}

function createShipItem(ship: MstShipData): HTMLElement {
  const isSelected = ship.id === getShipModalCurrentId();
  const item = document.createElement("div");
  item.className = `flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
    isSelected
      ? "bg-primary/15 ring-1 ring-primary/30"
      : "hover:bg-primary/8 active:bg-primary/15"
  }`;
  item.style.height = `${SHIP_ROW_PITCH}px`;
  item.style.boxSizing = "border-box";

  const imgWrap = document.createElement("div");
  imgWrap.className =
    "w-[72px] h-[28px] bg-base-200 rounded overflow-hidden shrink-0";
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
  const snLevel = (ship as MstShipData & { _snapshotLevel?: number })
    ._snapshotLevel;
  const snShipCount = (ship as MstShipData & { _snapshotCount?: number })
    ._snapshotCount;
  let typeText =
    snLevel != null
      ? `${STYPE_NAMES[ship.stype] ?? ""} Lv.${snLevel} #${ship.id}`
      : `${STYPE_NAMES[ship.stype] ?? ""} #${ship.id}`;
  if (snShipCount != null && snShipCount > 1) typeText += ` ×${snShipCount}`;
  typeDiv.textContent = typeText;
  textDiv.appendChild(typeDiv);
  item.appendChild(textDiv);

  item.addEventListener("mouseenter", () => renderShipDetail(ship));
  item.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isWorkspaceReadOnly()) return;
    const selection = {
      id: ship.id,
      level: (ship as MstShipData & { _snapshotLevel?: number })._snapshotLevel,
    };
    consumeShipModalCallback(selection);
    (document.getElementById("ship-select-modal") as HTMLDialogElement).close();
  });

  return item;
}

function renderShipDetail(ship: MstShipData) {
  const panel = document.getElementById("ship-modal-detail")!;
  panel.innerHTML = "";

  const bannerWrap = document.createElement("div");
  bannerWrap.className =
    "w-full h-14 bg-base-200 rounded-lg overflow-hidden mb-3";
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
  const shipSideEl = document.getElementById("ship-modal-side");
  const shipStypeEl = document.getElementById("ship-modal-stype");
  if (
    shipSearchEl instanceof HTMLInputElement &&
    shipSideEl instanceof HTMLSelectElement &&
    shipStypeEl instanceof HTMLSelectElement
  ) {
    shipSearchEl.addEventListener(
      "input",
      debounce(() => {
        renderShipGrid(
          shipSearchEl.value,
          shipStypeEl.value,
          shipSideEl.value as SideFilter,
        );
      }, 120),
    );
    shipSideEl.addEventListener("change", () => {
      setShipModalSideFilter(shipSideEl.value as SideFilter);
      populateStypeFilter(shipStypeEl, getShipModalSideFilter());
      renderShipGrid(
        shipSearchEl.value,
        shipStypeEl.value,
        getShipModalSideFilter(),
      );
    });
    shipStypeEl.addEventListener("change", () => {
      renderShipGrid(
        shipSearchEl.value,
        shipStypeEl.value,
        shipSideEl.value as SideFilter,
      );
    });
  }

  document
    .getElementById("ship-modal-source-tabs")
    ?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(
        "[data-source]",
      ) as HTMLElement | null;
      if (!btn) return;
      const src = btn.dataset.source as "snapshot" | "master";
      if (src === getShipModalSource()) return;
      setShipModalSource(src);
      updateSourceTabs();
      const searchEl = document.getElementById("ship-modal-search");
      const sideEl = document.getElementById("ship-modal-side");
      const stypeEl = document.getElementById("ship-modal-stype");
      const search = searchEl instanceof HTMLInputElement ? searchEl.value : "";
      const side =
        sideEl instanceof HTMLSelectElement
          ? (sideEl.value as SideFilter)
          : getShipModalSideFilter();
      const stype = stypeEl instanceof HTMLSelectElement ? stypeEl.value : "";
      renderShipGrid(search, stype, side);
    });
}

/** Invalidate ship virtual scroll on resize. */
export function handleResizeShip() {
  // Keep API compatibility for resize hooks from index.astro.
  // `virtua` handles visible-window recalculation internally.
}
