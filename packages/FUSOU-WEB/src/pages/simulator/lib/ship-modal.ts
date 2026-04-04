// ── Ship Selection Modal ──

import type { MstShipData } from "./types";
import {
  STYPE_NAMES,
  STYPE_SHORT,
  SPEED_NAMES,
  ENEMY_ID_THRESHOLD,
} from "./constants";
import { canAssignShipWithoutWorseningCombinedRules } from "./combined-fleet";
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
  getCombinedFleetType,
  getFleetState,
  getMasterShip,
  getMasterShips,
  getShipModalCurrentId,
  getShipModalTarget,
  getShipModalSideFilter,
  getShipModalSource,
  getSnapshotShips,
  hasMasterData,
  hasSnapshotShips,
  isWorkspaceReadOnly,
} from "./simulator-selectors";

type ShipVRow =
  | { kind: "header"; stype: number }
  | { kind: "item"; ship: MstShipData };

let _shipVirtuaDispose: (() => void) | null = null;
const ShipVList = VList as unknown as Component<Record<string, unknown>>;
let _shipModalVisibilityBound = false;
let _shipVListHandle: { scrollToIndex: (index: number, opts?: { align?: string }) => void } | null = null;
let _currentShipRowIndex = -1;

function syncShipModalDisplay(modal: HTMLDialogElement): void {
  modal.style.display = modal.open ? "grid" : "none";
}

function ensureShipModalVisibilityBinding(modal: HTMLDialogElement): void {
  if (_shipModalVisibilityBound) return;
  modal.addEventListener("close", () => { cleanupShipVS(); syncShipModalDisplay(modal); });
  modal.addEventListener("cancel", () => { cleanupShipVS(); syncShipModalDisplay(modal); });
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

function filterShipsByCombinedRules(ships: MstShipData[]): MstShipData[] {
  const combinedType = getCombinedFleetType();
  if (combinedType === 0) return ships;

  const { fleetIndex, shipSlotIndex } = getShipModalTarget();
  if ((fleetIndex !== 1 && fleetIndex !== 2) || shipSlotIndex == null) return ships;

  const { fleet1, fleet2 } = getFleetState();
  const currentId = getShipModalCurrentId();
  return ships.filter((ship) => {
    if (ship.id === currentId) return true;
    return canAssignShipWithoutWorseningCombinedRules(
      combinedType,
      fleet1,
      fleet2,
      fleetIndex,
      shipSlotIndex,
      ship.id,
    );
  });
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

function scheduleScrollToCurrentShip(attempt = 0): void {
  if (_shipVListHandle && _currentShipRowIndex >= 0) {
    _shipVListHandle.scrollToIndex(_currentShipRowIndex, { align: "center" });
    return;
  }
  if (attempt >= 8) return;
  window.setTimeout(() => { scheduleScrollToCurrentShip(attempt + 1); }, attempt < 2 ? 0 : 16);
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
      scheduleScrollToCurrentShip();
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
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "全艦種";
  select.replaceChildren(defaultOption);
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
  const grid = document.getElementById("ship-modal-grid");
  if (!(grid instanceof HTMLElement)) return;
  const modal = document.getElementById("ship-select-modal");
  if (!(modal instanceof HTMLDialogElement)) return;
  grid.style.display = "flex";
  grid.style.flexDirection = "column";
  grid.style.minHeight = "0";
  grid.style.overflowY = "hidden";
  grid.replaceChildren();
  cleanupShipVS();

  // Clear-selection button — always at the top of the grid, never scrolls away
  if (getShipModalCurrentId() != null) {
    const clearItem = document.createElement("div");
    clearItem.className =
      "shrink-0 flex items-center gap-2 px-3 py-2 mb-1 rounded-lg cursor-pointer bg-error/5 hover:bg-error/10 text-error/70 hover:text-error transition-colors text-sm";
    clearItem.textContent = "✕ 選択を解除";
    if (isWorkspaceReadOnly()) {
      clearItem.style.opacity = "0.5";
      clearItem.style.pointerEvents = "none";
    } else {
      clearItem.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        consumeShipModalCallback({ id: null, level: null });
        modal.close();
      });
    }
    grid.appendChild(clearItem);
  }

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
  ships = filterShipsByCombinedRules(ships);

  if (stypeFilter)
    ships = ships.filter((s) => s.stype === parseInt(stypeFilter, 10));
  if (search) {
    const q = search.toLowerCase();
    ships = ships.filter(
      (s) => s.name.toLowerCase().includes(q) || String(s.id).includes(q),
    );
  }

  if (ships.length === 0) {
    const empty = document.createElement("p");
    empty.className = "text-sm text-base-content/30 text-center py-12";
    empty.textContent = "該当する艦が見つかりません";
    grid.appendChild(empty);
    renderShipCategoryNav([]);
    return;
  }

  const rows: ShipVRow[] = [];
  let catOffsets: { stype: number; offset: number }[] = [];
  let virtualOffset = 0;

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

  // Find the row index of the currently selected ship so scrollToIndex can jump directly to it.
  const currentId = getShipModalCurrentId();
  _currentShipRowIndex = -1;
  if (currentId != null) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.kind === "item" && r.ship.id === currentId) {
        _currentShipRowIndex = i;
        break;
      }
    }
  }
  _shipVListHandle = null;

  const vlistWrapper = document.createElement("div");
  vlistWrapper.style.flex = "1";
  vlistWrapper.style.minHeight = "0";
  vlistWrapper.style.overflow = "hidden";
  grid.appendChild(vlistWrapper);

  _shipVirtuaDispose = render(
    () =>
      createComponent(ShipVList, {
        data: rows,
        ref: (handle: unknown) => { _shipVListHandle = handle as typeof _shipVListHandle; },
        style: {
          height: "100%",
        },
        class: "overflow-x-hidden",
        children: (row: ShipVRow) => {
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
    vlistWrapper,
  );
  renderShipCategoryNav(catOffsets);
}

function renderShipCategoryNav(
  catOffsets: { stype: number; offset: number }[],
) {
  renderCategoryNav(
    "ship-modal-categories",
    "ship-modal-grid",
    catOffsets,
    (c) => ({
      text: STYPE_SHORT[c.stype] ?? STYPE_NAMES[c.stype] ?? `${c.stype}`,
      title: STYPE_NAMES[c.stype] ?? `Type ${c.stype}`,
    }),
  );
}

function createShipItem(ship: MstShipData): HTMLElement {
  const isSelected = ship.id === getShipModalCurrentId();
  const item = document.createElement("div");
  item.className = `w-full flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors min-w-0 ${
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
    const parent = (this as HTMLImageElement).parentElement;
    if (!parent) return;
    parent.replaceChildren();
    const fallback = document.createElement("div");
    fallback.className = "w-full h-full flex items-center justify-center text-[9px] text-base-content/20 bg-base-200";
    fallback.textContent = String(ship.id);
    parent.appendChild(fallback);
  };
  imgWrap.appendChild(img);
  item.appendChild(imgWrap);

  const textDiv = document.createElement("div");
  textDiv.className = "min-w-0 flex-1 overflow-hidden";

  const nameDiv = document.createElement("div");
  nameDiv.className = "text-sm font-medium truncate leading-tight";
  nameDiv.textContent = ship.name;
  textDiv.appendChild(nameDiv);

  const typeDiv = document.createElement("div");
  typeDiv.className = "grid grid-cols-[minmax(0,1fr)_3.1rem_2.4rem] items-center gap-0.5 text-[11px] text-base-content/40 leading-tight";
  const typeName = document.createElement("span");
  typeName.className = "truncate";
  const snLevel = (ship as MstShipData & { _snapshotLevel?: number })
    ._snapshotLevel;
  const snShipCount = (ship as MstShipData & { _snapshotCount?: number })
    ._snapshotCount;
  typeName.textContent = `${STYPE_NAMES[ship.stype] ?? ""} #${ship.id}`;
  typeDiv.appendChild(typeName);

  const levelCol = document.createElement("span");
  levelCol.className = "text-right font-mono";
  if (snLevel != null && snLevel > 0) {
    levelCol.classList.add("text-teal-700", "font-bold");
    levelCol.textContent = `Lv${snLevel}`;
  } else {
    levelCol.classList.add("text-base-content/30");
    levelCol.textContent = "";
  }
  typeDiv.appendChild(levelCol);

  const countCol = document.createElement("span");
  countCol.className = "text-right text-base-content/60 font-mono";
  countCol.textContent = snShipCount != null && snShipCount > 1 ? `×${snShipCount}` : "";
  if (snShipCount != null && snShipCount > 1) countCol.classList.add("font-bold");
  else countCol.classList.add("text-base-content/30");
  typeDiv.appendChild(countCol);

  textDiv.appendChild(typeDiv);
  item.appendChild(textDiv);

  const badges = document.createElement("div");
  badges.className = "w-[5.2rem] shrink-0 flex items-center justify-end gap-0.5 whitespace-nowrap overflow-hidden text-right";
  const statPairs: [string, number][] = [];
  if ((ship.houg?.[0] ?? 0) > 0) statPairs.push(["火", ship.houg?.[0] ?? 0]);
  if ((ship.raig?.[0] ?? 0) > 0) statPairs.push(["雷", ship.raig?.[0] ?? 0]);
  if ((ship.tyku?.[0] ?? 0) > 0) statPairs.push(["空", ship.tyku?.[0] ?? 0]);
  if ((ship.tais?.[0] ?? 0) > 0) statPairs.push(["潜", ship.tais?.[0] ?? 0]);
  for (const [lbl, val] of statPairs.slice(0, 2)) {
    const badge = document.createElement("span");
    badge.className = "text-[10px] px-1 py-0.5 rounded font-mono shrink-0 bg-success/10 text-success";
    badge.textContent = `${lbl}+${val}`;
    badges.appendChild(badge);
  }
  item.appendChild(badges);

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
  const panel = document.getElementById("ship-modal-detail");
  if (!(panel instanceof HTMLElement)) return;
  panel.replaceChildren();

  const bannerWrap = document.createElement("div");
  bannerWrap.className =
    "w-full h-14 bg-base-200 rounded-lg overflow-hidden mb-3";
  const bannerImg = document.createElement("img");
  bannerImg.src = bannerUrl(ship.id);
  bannerImg.className = "w-full h-full object-cover";
  bannerImg.onerror = function () {
    const parent = (this as HTMLImageElement).parentElement;
    if (!parent) return;
    parent.replaceChildren();
    const fallback = document.createElement("div");
    fallback.className = "w-full h-full flex items-center justify-center text-base-content/20 text-xs";
    fallback.textContent = "No Image";
    parent.appendChild(fallback);
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
    ["回避", ship.kaih?.[0] ?? "—"],
    ["搭載", ship.maxeq ? ship.maxeq.slice(0, ship.slot_num).reduce((sum, slot) => sum + slot, 0) : "—"],
    ["速力", SPEED_NAMES[ship.soku] ?? String(ship.soku)],
    ["射程", ship.leng != null ? String(ship.leng) : "—"],
    ["火力", ship.houg?.[0] ?? "—"],
    ["雷装", ship.raig?.[0] ?? "—"],
    ["対空", ship.tyku?.[0] ?? "—"],
    ["対潜", ship.tais?.[0] ?? "—"],
    ["索敵", ship.saku?.[0] ?? "—"],
    ["運", ship.luck?.[0] ?? "—"],
    ["スロット数", ship.slot_num],
    ["搭載内訳", ship.maxeq ? ship.maxeq.slice(0, ship.slot_num).join(" / ") : "—"],
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
    if (label === "射程") {
      const rangeMap: Record<number, string> = { 0: "無", 1: "短", 2: "中", 3: "長", 4: "超長", 5: "超長+" };
      const numeric = typeof value === "number" ? value : Number(value);
      v.textContent = Number.isFinite(numeric) ? (rangeMap[numeric] ?? String(value)) : String(value);
    } else {
      v.textContent = String(value);
    }
    row.appendChild(l);
    row.appendChild(v);
    grid.appendChild(row);
  }
  panel.appendChild(grid);
}

function resetShipDetail() {
  const panel = document.getElementById("ship-modal-detail");
  if (panel instanceof HTMLElement) {
    const message = document.createElement("p");
    message.className = "text-sm text-base-content/30 text-center pt-10";
    message.appendChild(document.createTextNode("艦にカーソルを合わせると"));
    message.appendChild(document.createElement("br"));
    message.appendChild(document.createTextNode("詳細が表示されます"));
    panel.replaceChildren(message);
  }
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
      if (getShipModalCurrentId() != null) {
        requestAnimationFrame(() => {
          scheduleScrollToCurrentShip();
        });
      }
    });
}

/** Invalidate ship virtual scroll on resize. */
export function handleResizeShip() {
  // Keep API compatibility for resize hooks from index.astro.
  // `virtua` handles visible-window recalculation internally.
}
