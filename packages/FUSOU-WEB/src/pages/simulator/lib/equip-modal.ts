// ── Equipment Selection Modal ──

import type { MstSlotItemData } from "./types";
import {
  AIRCRAFT_TYPES,
  EQUIP_TYPE_NAMES,
  EQUIP_TYPE_SHORT,
  ENEMY_ID_THRESHOLD,
  RANGE_NAMES,
} from "./constants";
import { debounce, equipImageUrl, computeEquipBonuses } from "./equip-calc";
import {
  filterForNormalSlot,
  filterForExslot,
  getExslotSelectionRequirement,
} from "./equip-filter";
import {
  EQUIP_ROW_PITCH,
  HEADER_HEIGHT,
  createGroupHeader,
  renderCategoryNav,
} from "./virtual-scroll";
import { createComponent } from "solid-js";
import type { Component } from "solid-js";
import { render } from "solid-js/web";
import { VList } from "virtua/solid";
import {
  applyAirBaseEquipSelection,
  applyFleetEquipSelection,
  applyFleetExslotSelection,
  beginEquipModalSession,
  consumeEquipModalCallback,
  setEquipModalSideFilter,
  setEquipModalSource,
} from "./simulator-mutations";
import {
  getEquipModalCurrentId,
  getEquipModalSideFilter,
  getEquipModalSource,
  getEquipModalTarget,
  getMasterEquipTypeName,
  getMasterShip,
  getMasterSlotItem,
  getMasterSlotItems,
  getSlotItemEffects,
  getSnapshotSlotItems,
  getSpriteSheetMeta,
  getWeaponIconFrame,
  hasMasterData,
  hasSnapshotSlotItems,
  isAirBaseEquipModalTarget,
  isWorkspaceReadOnly,
} from "./simulator-selectors";

type EquipVRow =
  | { kind: "clear" }
  | { kind: "header"; typeId: number }
  | { kind: "item"; equip: MstSlotItemData };

type EquipRuntimeMeta = MstSlotItemData & {
  _snapshotLevel?: number;
  _snapshotAlv?: number;
  _snapshotCount?: number;
  _requiredLevel?: number;
  _requiredAlv?: number;
};

function getCandidateLevel(equip: MstSlotItemData): number {
  const e = equip as EquipRuntimeMeta;
  return Math.max(0, e._snapshotLevel ?? e._requiredLevel ?? 0);
}

function getCandidateAlv(equip: MstSlotItemData): number {
  const e = equip as EquipRuntimeMeta;
  return Math.max(0, e._snapshotAlv ?? e._requiredAlv ?? 0);
}

const EQUIP_CLEAR_ROW_HEIGHT = 38;
let _equipVirtuaDispose: (() => void) | null = null;
const EquipVList = VList as unknown as Component<Record<string, unknown>>;
let _equipModalVisibilityBound = false;

function syncEquipModalDisplay(modal: HTMLDialogElement): void {
  modal.style.display = modal.open ? "grid" : "none";
}

function ensureEquipModalVisibilityBinding(modal: HTMLDialogElement): void {
  if (_equipModalVisibilityBound) return;
  modal.addEventListener("close", () => syncEquipModalDisplay(modal));
  modal.addEventListener("cancel", () => syncEquipModalDisplay(modal));
  _equipModalVisibilityBound = true;
}

type SideFilter = "ally" | "enemy" | "all";

function filterEquipsBySide(
  equips: MstSlotItemData[],
  sideFilter: SideFilter,
): MstSlotItemData[] {
  if (sideFilter === "all") return equips;
  if (sideFilter === "enemy") {
    return equips.filter((e) => e.id >= ENEMY_ID_THRESHOLD);
  }
  return equips.filter((e) => e.id < ENEMY_ID_THRESHOLD);
}

function isAirBaseEquipTarget(): boolean {
  return isAirBaseEquipModalTarget();
}

function isValidAirBaseItem(e: MstSlotItemData): boolean {
  const type2 = e.type?.[2] ?? -1;
  if (!AIRCRAFT_TYPES.has(type2)) return false;
  // Airbase sortie radius must be defined and positive.
  const dist = e.distance ?? 0;
  return dist > 0;
}

function getEquipTypeName(typeId: number): string {
  return (
    getMasterEquipTypeName(typeId) ??
    EQUIP_TYPE_NAMES[typeId] ??
    `Type ${typeId}`
  );
}

function cleanupEquipVS() {
  if (_equipVirtuaDispose) {
    _equipVirtuaDispose();
    _equipVirtuaDispose = null;
  }
}

/** Return the MstSlotItemData for the currently selected equip from the active VS state (snapshot-enriched if available), falling back to master data. */
function findCurrentEquipInVS(): MstSlotItemData | null {
  const id = getEquipModalCurrentId();
  if (id == null) return null;
  // With library virtualization we don't keep a separate VS cache map.
  // For current-id fallback, master data is sufficient.
  return getMasterSlotItem(id);
}

/** Scroll the equip grid so the currently selected equip row is visible (call after showModal). */
function scrollToCurrentEquipInVS(): void {
  const grid = document.getElementById("equip-modal-grid");
  if (!(grid instanceof HTMLElement)) return;

  // Selected row has ring classes in createEquipItem.
  const selected = grid.querySelector(
    ".ring-1.ring-primary\\/30",
  ) as HTMLElement | null;
  if (!selected) return;
  selected.scrollIntoView({ block: "center" });
}

export function openEquipModal(
  currentId: number | null,
  cb: (selection: { id: number | null; level?: number; alv?: number }) => void,
) {
  if (!hasMasterData()) return;
  beginEquipModalSession(currentId, cb);
  if (currentId != null) {
    setEquipModalSideFilter(
      currentId >= ENEMY_ID_THRESHOLD ? "enemy" : "ally",
    );
  }
  const modal = document.getElementById("equip-select-modal");
  const search = document.getElementById("equip-modal-search");
  const side = document.getElementById("equip-modal-side");
  const typeFilter = document.getElementById("equip-modal-type");
  if (
    !(modal instanceof HTMLDialogElement) ||
    !(search instanceof HTMLInputElement) ||
    !(side instanceof HTMLSelectElement) ||
    !(typeFilter instanceof HTMLSelectElement)
  )
    return;
  ensureEquipModalVisibilityBinding(modal);
  syncEquipModalDisplay(modal);
  search.value = "";
  side.value = getEquipModalSideFilter();
  populateEquipTypeFilter(typeFilter, getEquipModalSideFilter());

  const tabsEl = document.getElementById("equip-modal-source-tabs");
  const hasSnapshot = hasSnapshotSlotItems();
  if (tabsEl) {
    tabsEl.classList.toggle("hidden", !hasSnapshot);
  }
  setEquipModalSource(hasSnapshot ? "snapshot" : "master");
  updateEquipSourceTabs();

  renderEquipGrid("", "", getEquipModalSideFilter());
  const autoShowEquip =
    getEquipModalCurrentId() != null
      ? findCurrentEquipInVS()
      : null;
  if (autoShowEquip) {
    renderEquipDetail(autoShowEquip);
  } else {
    resetEquipDetail();
  }
  modal.showModal();
  syncEquipModalDisplay(modal);
  requestAnimationFrame(() => {
    if (autoShowEquip) {
      scrollToCurrentEquipInVS();
    } else {
      search.focus();
    }
  });
}

function updateEquipSourceTabs() {
  const tabsEl = document.getElementById("equip-modal-source-tabs");
  if (!tabsEl) return;
  for (const btn of Array.from(tabsEl.querySelectorAll("[data-source]"))) {
    const isActive =
      (btn as HTMLElement).dataset.source === getEquipModalSource();
    btn.classList.toggle("tab-active", isActive);
  }
}

function populateEquipTypeFilter(
  select: HTMLSelectElement,
  sideFilter: SideFilter,
) {
  const current = select.value;
  select.innerHTML = '<option value="">全装備種</option>';
  const types = new Map<number, string>();
  let sourceItems = filterEquipsBySide(
    Object.values(getMasterSlotItems()),
    sideFilter,
  );
  if (isAirBaseEquipTarget()) {
    sourceItems = sourceItems.filter((e) => isValidAirBaseItem(e));
  }

  for (const e of sourceItems) {
    const t = e.type?.[2];
    if (t != null && !types.has(t))
      types.set(t, getEquipTypeName(t));
  }
  for (const [id, name] of [...types.entries()].sort((a, b) => a[0] - b[0])) {
    const opt = document.createElement("option");
    opt.value = String(id);
    opt.textContent = name;
    if (String(id) === current) opt.selected = true;
    select.appendChild(opt);
  }
}

function createEquipItem(equip: MstSlotItemData): HTMLElement {
  const isSelected = equip.id === getEquipModalCurrentId();
  const item = document.createElement("div");
  item.className = `w-full flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors min-w-0 ${
    isSelected
      ? "bg-primary/15 ring-1 ring-primary/30"
      : "hover:bg-primary/8 active:bg-primary/15"
  }`;
  item.style.height = `${EQUIP_ROW_PITCH}px`;
  item.style.boxSizing = "border-box";

  const iconNum = equip.type?.[3] ?? 0;
  const frame = getWeaponIconFrame(iconNum);
  const spriteSheet = getSpriteSheetMeta();
  const iconEl = document.createElement("div");
  iconEl.className = "w-6 h-6 rounded";
  if (frame && spriteSheet.url) {
    const [fx, fy, fw, fh] = frame;
    const scaleX = 24 / fw;
    const scaleY = 24 / fh;
    iconEl.style.backgroundImage = `url('${spriteSheet.url}')`;
    iconEl.style.backgroundPosition = `-${fx * scaleX}px -${fy * scaleY}px`;
    iconEl.style.backgroundSize = `${spriteSheet.width * scaleX}px ${spriteSheet.height * scaleY}px`;
    iconEl.style.backgroundRepeat = "no-repeat";
  }
  item.appendChild(iconEl);

  const textDiv = document.createElement("div");
  textDiv.className = "min-w-0 flex-1 overflow-hidden";
  const nameSpan = document.createElement("div");
  nameSpan.className = "text-sm truncate leading-tight font-medium";
  nameSpan.textContent = equip.name;
  textDiv.appendChild(nameSpan);

  const metaRow = document.createElement("div");
  metaRow.className = "grid grid-cols-[minmax(0,1fr)_2.1rem_2.1rem_2.4rem] items-center gap-0.5 text-[11px] text-base-content/40 leading-tight";

  const typeSpan = document.createElement("span");
  typeSpan.className = "truncate";
  const meta = equip as EquipRuntimeMeta;
  const snLv = meta._snapshotLevel;
  const snAlv = meta._snapshotAlv;
  const snCount = meta._snapshotCount;
  const reqLv = meta._requiredLevel ?? 0;
  const reqAlv = meta._requiredAlv ?? 0;
  const displayLv = getCandidateLevel(equip);
  const displayAlv = getCandidateAlv(equip);
  const hasRequiredMeta = reqLv > 0 || reqAlv > 0;
  const isSnapshotSource = getEquipModalSource() === "snapshot";
  const profSymbols = ["|", "|", "||", "|||", "\\", "\\\\", "\\\\\\", ">>"];
  typeSpan.textContent = getEquipTypeName(equip.type?.[2] ?? 0);
  metaRow.appendChild(typeSpan);

  if (isSnapshotSource) {
    const profCol = document.createElement("span");
    profCol.className = "text-right font-mono";
    if (snAlv != null && snAlv > 0) {
      profCol.classList.add("font-bold");
      if (snAlv <= 3) profCol.classList.add("text-blue-700");
      else if (snAlv <= 6) profCol.classList.add("text-amber-700");
      else profCol.classList.add("text-orange-700");
      profCol.textContent = profSymbols[snAlv] ?? ">>";
    } else {
      profCol.classList.add("text-base-content/30");
      profCol.textContent = "";
    }
    metaRow.appendChild(profCol);

    const impCol = document.createElement("span");
    impCol.className = "text-right font-mono";
    if (snLv != null && snLv > 0) {
      impCol.classList.add("text-teal-700", "font-bold");
      impCol.textContent = `★${snLv}`;
    } else {
      impCol.classList.add("text-base-content/30");
      impCol.textContent = "";
    }
    metaRow.appendChild(impCol);

    const countCol = document.createElement("span");
    countCol.className = "text-right text-base-content/60 font-mono";
    countCol.textContent = snCount != null && snCount > 1 ? `×${snCount}` : "";
    if (snCount != null && snCount > 1) countCol.classList.add("font-bold");
    else countCol.classList.add("text-base-content/30");
    metaRow.appendChild(countCol);

    textDiv.appendChild(metaRow);
  } else {
    const typeLine = document.createElement("div");
    typeLine.className = "text-[11px] text-base-content/40 leading-tight flex items-baseline gap-3 min-w-0";

    const typeName = document.createElement("span");
    typeName.className = "truncate";
    typeName.textContent = typeSpan.textContent;
    typeLine.appendChild(typeName);

    if (hasRequiredMeta) {
      const reqLine = document.createElement("span");
      reqLine.className = "text-[10px] leading-tight text-warning/80 font-mono shrink-0";
      const reqParts: string[] = [];
      if (displayLv > 0) reqParts.push(`★${displayLv}+`);
      if (displayAlv > 0) reqParts.push(`熟練${profSymbols[displayAlv] ?? ">>"}+`);
      reqLine.textContent = `必要最低 ${reqParts.join(" /")}`;
      typeLine.appendChild(reqLine);
    }

    textDiv.appendChild(typeLine);
  }
  item.appendChild(textDiv);

  // Key stat badges
  const badges = document.createElement("div");
  badges.className = "w-[5.2rem] shrink-0 flex items-center justify-end gap-0.5 whitespace-nowrap overflow-hidden text-right";
  const statPairs: [string, number][] = [];
  if (equip.houg) statPairs.push(["火", equip.houg]);
  if (equip.raig) statPairs.push(["雷", equip.raig]);
  if (equip.tyku) statPairs.push(["空", equip.tyku]);
  if (equip.tais) statPairs.push(["潜", equip.tais]);
  if (equip.baku) statPairs.push(["爆", equip.baku]);
  for (const [lbl, val] of statPairs.slice(0, 2)) {
    const b = document.createElement("span");
    b.className = `text-[10px] px-1 py-0.5 rounded font-mono shrink-0 ${val > 0 ? "bg-success/10 text-success" : "bg-error/10 text-error"}`;
    b.textContent = `${lbl}${val > 0 ? "+" : ""}${val}`;
    badges.appendChild(b);
  }
  item.appendChild(badges);

  item.addEventListener("mouseenter", () => renderEquipDetail(equip));
  item.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isWorkspaceReadOnly()) return;
    const selection = {
      id: equip.id,
      level: getCandidateLevel(equip),
      alv: getCandidateAlv(equip),
    };
    consumeEquipModalCallback(selection);
    const target = getEquipModalTarget();
    if (target.kind === "fleet" && target.slot) {
      if (target.slotIdx >= 0) {
        applyFleetEquipSelection(target.slot, target.slotIdx, selection);
      } else {
        applyFleetExslotSelection(target.slot, selection);
      }
    } else if (target.kind === "airbase" && target.airBase && target.slotIdx >= 0) {
      applyAirBaseEquipSelection(target.airBase, target.slotIdx, selection);
    }
    (
      document.getElementById("equip-select-modal") as HTMLDialogElement
    ).close();
  });
  return item;
}

function renderEquipGrid(
  search: string,
  typeFilter: string,
  sideFilter: SideFilter,
) {
  const grid = document.getElementById("equip-modal-grid")!;
  grid.innerHTML = "";
  cleanupEquipVS();

  let items: MstSlotItemData[];

  if (
    getEquipModalSource() === "snapshot" &&
    hasSnapshotSlotItems()
  ) {
    const variantMap = new Map<
      string,
      { slotitem_id: number; level: number; alv: number; count: number }
    >();
    for (const si of Object.values(getSnapshotSlotItems())) {
      const key = `${si.slotitem_id}_${si.level ?? 0}_${si.alv ?? 0}`;
      const existing = variantMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        variantMap.set(key, {
          slotitem_id: si.slotitem_id,
          level: si.level ?? 0,
          alv: si.alv ?? 0,
          count: 1,
        });
      }
    }
    items = [...variantMap.values()]
      .map((v) => {
        const mst = getMasterSlotItem(v.slotitem_id);
        if (!mst) return null;
        return {
          ...mst,
          _snapshotLevel: v.level,
          _snapshotAlv: v.alv,
          _snapshotCount: v.count,
        } as MstSlotItemData & {
          _snapshotLevel?: number;
          _snapshotAlv?: number;
          _snapshotCount?: number;
        };
      })
      .filter((e): e is MstSlotItemData => e != null)
      .sort((a, b) => (a.sortno ?? a.id) - (b.sortno ?? b.id));
  } else {
    items = Object.values(getMasterSlotItems()).sort(
      (a, b) => (a.sortno ?? a.id) - (b.sortno ?? b.id),
    );
  }

  items = filterEquipsBySide(items, sideFilter);

  if (isAirBaseEquipTarget()) {
    items = items.filter((e) => isValidAirBaseItem(e));
  }

  // Apply ship-based equipment filter
  const equipTarget = getEquipModalTarget();
  const isExslot = equipTarget.slotIdx === -1;
  if (isExslot && !isAirBaseEquipTarget()) {
    const filtered = filterForExslot(
      equipTarget.shipId,
      equipTarget.slot?.shipLevel ?? null,
      items,
    );
    if (filtered) items = filtered;
  } else {
    const filtered = filterForNormalSlot(equipTarget.shipId, items);
    if (filtered) items = filtered;
  }

  // Master-source candidates don't carry inventory metadata, so attach the
  // minimum requirement values when slot rules demand improved equipment.
  if (
    getEquipModalSource() === "master" &&
    equipTarget.shipId != null &&
    !isAirBaseEquipTarget()
  ) {
    if (isExslot) {
      items = items.map((item) => {
        const req = getExslotSelectionRequirement(equipTarget.shipId, item);
        if (!req || (req.level <= 0 && req.alv <= 0)) return item;
        return {
          ...item,
          _requiredLevel: req.level,
          _requiredAlv: req.alv,
        } as EquipRuntimeMeta;
      });
    }
  }

  if (typeFilter) {
    const ft = parseInt(typeFilter, 10);
    items = items.filter((e) => e.type?.[2] === ft);
  }
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(
      (e) => e.name.toLowerCase().includes(q) || String(e.id).includes(q),
    );
  }

  if (items.length === 0) {
    grid.innerHTML =
      '<p class="text-sm text-base-content/30 text-center py-12">該当する装備が見つかりません</p>';
    renderEquipCategoryNav([]);
    return;
  }

  const rows: EquipVRow[] = [];
  let catOffsets: { typeId: number; offset: number }[] = [];
  let virtualOffset = 0;

  if (getEquipModalCurrentId() != null) {
    rows.push({ kind: "clear" });
    virtualOffset += EQUIP_CLEAR_ROW_HEIGHT;
  }

  if (!typeFilter) {
    const groups = new Map<number, MstSlotItemData[]>();
    for (const e of items) {
      const t = e.type?.[2] ?? 0;
      const arr = groups.get(t);
      if (arr) arr.push(e);
      else groups.set(t, [e]);
    }
    const sortedTypes = [...groups.keys()].sort((a, b) => a - b);
    for (const t of sortedTypes) {
      catOffsets.push({ typeId: t, offset: virtualOffset });
      rows.push({ kind: "header", typeId: t });
      virtualOffset += HEADER_HEIGHT;
      for (const equip of groups.get(t) ?? []) {
        rows.push({ kind: "item", equip });
        virtualOffset += EQUIP_ROW_PITCH;
      }
    }
  } else {
    for (const equip of items) {
      rows.push({ kind: "item", equip });
    }
    catOffsets = [];
  }

  _equipVirtuaDispose = render(
    () =>
      createComponent(EquipVList, {
        data: rows,
        style: {
          height: "100%",
        },
        class: "overflow-x-hidden",
        children: (row: EquipVRow) => {
          if (row.kind === "clear") {
            const wrap = document.createElement("div");
            wrap.style.height = `${EQUIP_CLEAR_ROW_HEIGHT}px`;
            wrap.style.boxSizing = "border-box";
            wrap.appendChild(createEquipClearItem());
            return wrap;
          }
          if (row.kind === "header") return createGroupHeader(getEquipTypeName(row.typeId));
          const wrap = document.createElement("div");
          wrap.style.height = `${EQUIP_ROW_PITCH}px`;
          wrap.style.display = "flex";
          wrap.style.alignItems = "center";
          wrap.style.boxSizing = "border-box";
          wrap.appendChild(createEquipItem(row.equip));
          return wrap;
        },
      }),
    grid,
  );
  renderEquipCategoryNav(catOffsets);
}

function createEquipClearItem(): HTMLElement {
  const clearItem = document.createElement("div");
  clearItem.className =
    "h-full flex items-center gap-2 px-3 rounded-lg cursor-pointer bg-error/5 hover:bg-error/10 text-error/70 hover:text-error transition-colors text-sm";
  clearItem.textContent = "✕ 装備を外す";
  clearItem.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isWorkspaceReadOnly()) return;
    const selection = { id: null, level: 0, alv: 0 };
    consumeEquipModalCallback(selection);
    const target = getEquipModalTarget();
    if (target.kind === "fleet" && target.slot) {
      if (target.slotIdx >= 0) {
        applyFleetEquipSelection(target.slot, target.slotIdx, selection);
      } else {
        applyFleetExslotSelection(target.slot, selection);
      }
    } else if (target.kind === "airbase" && target.airBase && target.slotIdx >= 0) {
      applyAirBaseEquipSelection(target.airBase, target.slotIdx, selection);
    }
    (document.getElementById("equip-select-modal") as HTMLDialogElement).close();
  });
  return clearItem;
}

function renderEquipCategoryNav(
  catOffsets: { typeId: number; offset: number }[],
) {
  renderCategoryNav(
    "equip-modal-categories",
    "equip-modal-grid",
    catOffsets,
    (c: { typeId: number }) => ({
      text:
        EQUIP_TYPE_SHORT[c.typeId] ??
        getEquipTypeName(c.typeId),
      title: getEquipTypeName(c.typeId),
    }),
  );
}

function renderEquipDetail(equip: MstSlotItemData) {
  const panel = document.getElementById("equip-modal-detail")!;
  panel.innerHTML = "";

  const imgSrc = equipImageUrl(equip.id);
  if (imgSrc) {
    const imgWrap = document.createElement("div");
    imgWrap.className =
      "w-full aspect-[1.6] bg-base-200 rounded-lg overflow-hidden mb-3 flex items-center justify-center";
    const img = document.createElement("img");
    img.src = imgSrc;
    img.alt = equip.name;
    img.className = "max-w-full max-h-full object-contain";
    img.loading = "lazy";
    img.onerror = function () {
      imgWrap.remove();
    };
    imgWrap.appendChild(img);
    panel.appendChild(imgWrap);
  }

  const nameH = document.createElement("h4");
  nameH.className = "font-bold text-base mb-1";
  nameH.textContent = equip.name;
  panel.appendChild(nameH);

  const typeBadge = document.createElement("span");
  typeBadge.className = "badge badge-sm badge-outline mb-4";
  typeBadge.textContent = `${getEquipTypeName(equip.type?.[2] ?? 0)} #${equip.id}`;
  panel.appendChild(typeBadge);

  const statsDef: [string, number][] = [
    ["火力", equip.houg],
    ["雷装", equip.raig],
    ["対空", equip.tyku],
    ["対潜", equip.tais],
    ["爆装", equip.baku],
    ["索敵", equip.saku],
    ["命中", equip.houm],
    ["回避", equip.kaih ?? equip.houk ?? 0],
    ["装甲", equip.souk],
    ["射程", equip.leng ?? 0],
    ["対爆", equip.taibaku ?? 0],
    ["迎撃", equip.geigeki ?? 0],
  ];

  const grid = document.createElement("div");
  grid.className = "divide-y divide-base-200";
  for (const [label, value] of statsDef) {
    if (value === 0) continue;
    const row = document.createElement("div");
    row.className = "flex justify-between py-1.5 text-sm";
    const l = document.createElement("span");
    l.className = "text-base-content/50";
    l.textContent = label;
    const v = document.createElement("span");
    if (label === "射程") {
      v.className = "font-mono font-medium text-base-content/80";
      v.textContent = RANGE_NAMES[value] ?? String(value);
    } else {
      v.className = `font-mono font-medium ${value > 0 ? "text-success" : "text-error"}`;
      v.textContent = `${value > 0 ? "+" : ""}${value}`;
    }
    row.appendChild(l);
    row.appendChild(v);
    grid.appendChild(row);
  }

  if (equip.distance != null && equip.distance > 0) {
    const row = document.createElement("div");
    row.className = "flex justify-between py-1.5 text-sm";
    const l = document.createElement("span");
    l.className = "text-base-content/50";
    l.textContent = "行動半径";
    const v = document.createElement("span");
    v.className = "font-mono font-medium";
    v.textContent = String(equip.distance);
    row.appendChild(l);
    row.appendChild(v);
    grid.appendChild(row);
  }

  panel.appendChild(grid);

  // ── Equipment Bonus Section (when ship context is available) ──
  const equipTarget = getEquipModalTarget();
  if (getSlotItemEffects() && equipTarget.shipId != null && equipTarget.slot) {
    const shipId = equipTarget.shipId;
    const targetSlot = equipTarget.slot;
    const targetIdx = equipTarget.slotIdx;
    const shipData = getMasterShip(shipId);

    const testEquipIds = [...targetSlot.equipIds];
    let testExSlotId = targetSlot.exSlotId;
    if (targetIdx >= 0) {
      testEquipIds[targetIdx] = equip.id;
    } else {
      testExSlotId = equip.id;
    }

    const bonusWith = computeEquipBonuses(
      shipId,
      testEquipIds,
      testExSlotId,
      targetSlot.equipImprovement,
      targetSlot.exSlotImprovement,
    );
    const testEquipIdsWithout = [...targetSlot.equipIds];
    let testExSlotIdWithout = targetSlot.exSlotId;
    if (targetIdx >= 0) {
      testEquipIdsWithout[targetIdx] = null;
    } else {
      testExSlotIdWithout = null;
    }
    const bonusWithout = computeEquipBonuses(
      shipId,
      testEquipIdsWithout,
      testExSlotIdWithout,
      targetSlot.equipImprovement,
      targetSlot.exSlotImprovement,
    );

    const delta: Record<string, number> = {};
    const bonusKeys = new Set([
      ...Object.keys(bonusWith),
      ...Object.keys(bonusWithout),
    ]);
    for (const k of bonusKeys) {
      const d = (bonusWith[k] || 0) - (bonusWithout[k] || 0);
      if (d !== 0) delta[k] = d;
    }

    if (Object.keys(delta).length > 0) {
      const STAT_JP: Record<string, string> = {
        houg: "火力",
        raig: "雷装",
        tyku: "対空",
        souk: "装甲",
        kaih: "回避",
        tais: "対潜",
        saku: "索敵",
        baku: "爆装",
        houm: "命中",
        leng: "射程",
      };

      const section = document.createElement("div");
      section.className = "mt-4 pt-3 border-t border-base-200";

      const sectionTitle = document.createElement("div");
      sectionTitle.className =
        "text-[11px] font-bold text-warning/80 mb-2 flex items-center gap-1";
      sectionTitle.innerHTML = `<span class="text-warning">★</span>装備ボーナス${shipData ? ` (${shipData.name})` : ""}`;
      section.appendChild(sectionTitle);

      const bonusGrid = document.createElement("div");
      bonusGrid.className = "divide-y divide-base-200";
      for (const [k, v] of Object.entries(delta)) {
        const label = STAT_JP[k] ?? k;
        const row = document.createElement("div");
        row.className = "flex justify-between py-1 text-sm";
        const l = document.createElement("span");
        l.className = "text-base-content/50";
        l.textContent = label;
        const val = document.createElement("span");
        val.className = `font-mono font-medium ${v > 0 ? "text-warning" : "text-error"}`;
        val.textContent = `${v > 0 ? "+" : ""}${v}`;
        row.appendChild(l);
        row.appendChild(val);
        bonusGrid.appendChild(row);
      }
      section.appendChild(bonusGrid);
      panel.appendChild(section);
    }
  }
}

function resetEquipDetail() {
  document.getElementById("equip-modal-detail")!.innerHTML =
    '<p class="text-sm text-base-content/30 text-center pt-10">装備にカーソルを合わせると<br/>詳細が表示されます</p>';
}

/** Wire up DOM event listeners for the equip modal. Call once at init time. */
export function initEquipModalEvents() {
  const equipSearchEl = document.getElementById("equip-modal-search");
  const equipSideEl = document.getElementById("equip-modal-side");
  const equipTypeEl = document.getElementById("equip-modal-type");
  if (
    equipSearchEl instanceof HTMLInputElement &&
    equipSideEl instanceof HTMLSelectElement &&
    equipTypeEl instanceof HTMLSelectElement
  ) {
    equipSearchEl.addEventListener(
      "input",
      debounce(() => {
        renderEquipGrid(
          equipSearchEl.value,
          equipTypeEl.value,
          equipSideEl.value as SideFilter,
        );
      }, 120),
    );
    equipSideEl.addEventListener("change", () => {
      setEquipModalSideFilter(equipSideEl.value as SideFilter);
      populateEquipTypeFilter(equipTypeEl, getEquipModalSideFilter());
      renderEquipGrid(
        equipSearchEl.value,
        equipTypeEl.value,
        getEquipModalSideFilter(),
      );
    });
    equipTypeEl.addEventListener("change", () => {
      renderEquipGrid(
        equipSearchEl.value,
        equipTypeEl.value,
        equipSideEl.value as SideFilter,
      );
    });
  }

  document
    .getElementById("equip-modal-source-tabs")
    ?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(
        "[data-source]",
      ) as HTMLElement | null;
      if (!btn) return;
      const src = btn.dataset.source as "snapshot" | "master";
      if (src === getEquipModalSource()) return;
      setEquipModalSource(src);
      updateEquipSourceTabs();
      const search =
        equipSearchEl instanceof HTMLInputElement ? equipSearchEl.value : "";
      const side =
        equipSideEl instanceof HTMLSelectElement
          ? (equipSideEl.value as SideFilter)
          : getEquipModalSideFilter();
      const type =
        equipTypeEl instanceof HTMLSelectElement ? equipTypeEl.value : "";
      renderEquipGrid(search, type, side);
    });
}

/** Invalidate equip virtual scroll on resize. */
export function handleResizeEquip() {
  // Keep API compatibility for resize hooks from index.astro.
  // `virtua` handles visible-window recalculation internally.
}
