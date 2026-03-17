// ── Equipment Selection Modal ──

import { state } from "./state";
import type { MstSlotItemData } from "./types";
import {
  AIRCRAFT_TYPES,
  EQUIP_TYPE_NAMES,
  EQUIP_TYPE_SHORT,
  ENEMY_ID_THRESHOLD,
} from "./constants";
import { debounce, equipImageUrl, computeEquipBonuses } from "./equip-calc";
import { filterForNormalSlot, filterForExslot } from "./equip-filter";
import type { FlatVSState, GroupedVSState } from "./virtual-scroll";
import {
  EQUIP_ROW_PITCH,
  HEADER_HEIGHT,
  syncFlatVS,
  syncGroupedVS,
  createGroupHeader,
  createVSContainer,
  renderCategoryNav,
  cleanupSingleVS,
} from "./virtual-scroll";

// ── Equip virtual scroll state ──
type EquipGRow =
  | { kind: "header"; typeId: number }
  | { kind: "item"; equip: MstSlotItemData };

let _equipVS: (FlatVSState & { items: MstSlotItemData[] }) | null = null;
let _equipScrollRaf = 0;
let _equipGVS: (GroupedVSState & { rows: EquipGRow[] }) | null = null;
let _equipGScrollRaf = 0;

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
  return (
    state.equipModalTargetShipId == null &&
    state.equipModalTargetSlot == null &&
    state.equipModalTargetSlotIdx === -1
  );
}

function getEquipTypeName(typeId: number): string {
  return (
    state.mstSlotItemEquipTypes[typeId]?.name ??
    EQUIP_TYPE_NAMES[typeId] ??
    `Type ${typeId}`
  );
}

function onEquipScroll() {
  if (!_equipScrollRaf) {
    _equipScrollRaf = requestAnimationFrame(() => {
      _equipScrollRaf = 0;
      syncEquipVS();
    });
  }
}
function onEquipGScroll() {
  if (!_equipGScrollRaf) {
    _equipGScrollRaf = requestAnimationFrame(() => {
      _equipGScrollRaf = 0;
      syncEquipGVS();
    });
  }
}

function cleanupEquipVS() {
  _equipScrollRaf = cleanupSingleVS(_equipVS, onEquipScroll, _equipScrollRaf);
  _equipVS = null;
  _equipGScrollRaf = cleanupSingleVS(
    _equipGVS,
    onEquipGScroll,
    _equipGScrollRaf,
  );
  _equipGVS = null;
}

function syncEquipVS() {
  if (!_equipVS) return;
  syncFlatVS(_equipVS, createEquipItem);
}

function syncEquipGVS() {
  if (!_equipGVS) return;
  syncGroupedVS(_equipGVS, (row: EquipGRow) => {
    if (row.kind === "header") {
      return createGroupHeader(getEquipTypeName(row.typeId));
    }
    const rd = document.createElement("div");
    rd.style.height = `${EQUIP_ROW_PITCH}px`;
    rd.appendChild(createEquipItem(row.equip));
    return rd;
  });
}

/** Return the MstSlotItemData for the currently selected equip from the active VS state (snapshot-enriched if available), falling back to master data. */
function findCurrentEquipInVS(): MstSlotItemData | null {
  const id = state.equipModalCurrentId;
  if (id == null) return null;
  if (_equipGVS) {
    for (const row of (_equipGVS.rows as EquipGRow[])) {
      if (row.kind === "item" && row.equip.id === id) return row.equip;
    }
  } else if (_equipVS) {
    const item = (_equipVS.items as MstSlotItemData[]).find((e) => e.id === id);
    if (item) return item;
  }
  return state.mstSlotItems[id] ?? null;
}

/** Scroll the equip grid so the currently selected equip row is visible (call after showModal). */
function scrollToCurrentEquipInVS(): void {
  const id = state.equipModalCurrentId;
  if (id == null) return;
  if (_equipGVS) {
    const rowIdx = (_equipGVS.rows as EquipGRow[]).findIndex(
      (r) => r.kind === "item" && r.equip.id === id,
    );
    if (rowIdx < 0) return;
    const offset = _equipGVS.offsets[rowIdx];
    const spacerTop = _equipGVS.spacer.offsetTop;
    _equipGVS.grid.scrollTop = spacerTop + offset;
    syncEquipGVS();
  } else if (_equipVS) {
    const itemIdx = (_equipVS.items as MstSlotItemData[]).findIndex(
      (e) => e.id === id,
    );
    if (itemIdx < 0) return;
    const spacerTop = _equipVS.spacer.offsetTop;
    _equipVS.grid.scrollTop = spacerTop + itemIdx * _equipVS.pitch;
    syncEquipVS();
  }
}

export function openEquipModal(
  currentId: number | null,
  cb: (id: number | null) => void,
) {
  if (!state.hasMasterData) return;
  state.equipModalCb = cb;
  state.equipModalCurrentId = currentId;
  if (currentId != null) {
    state.equipModalSideFilter =
      currentId >= ENEMY_ID_THRESHOLD ? "enemy" : "ally";
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
  search.value = "";
  side.value = state.equipModalSideFilter;
  populateEquipTypeFilter(typeFilter, state.equipModalSideFilter);

  const tabsEl = document.getElementById("equip-modal-source-tabs");
  const hasSnapshot = Object.keys(state.snapshotSlotItems).length > 0;
  if (tabsEl) {
    tabsEl.classList.toggle("hidden", !hasSnapshot);
  }
  state.equipModalSource = hasSnapshot ? "snapshot" : "master";
  updateEquipSourceTabs();

  renderEquipGrid("", "", state.equipModalSideFilter);
  const autoShowEquip =
    state.isWorkspaceReadOnly && state.equipModalCurrentId != null
      ? findCurrentEquipInVS()
      : null;
  if (autoShowEquip) {
    renderEquipDetail(autoShowEquip);
  } else {
    resetEquipDetail();
  }
  modal.showModal();
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
      (btn as HTMLElement).dataset.source === state.equipModalSource;
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
    Object.values(state.mstSlotItems),
    sideFilter,
  );
  if (isAirBaseEquipTarget()) {
    sourceItems = sourceItems.filter((e) =>
      AIRCRAFT_TYPES.has(e.type?.[2] ?? -1),
    );
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
  const isSelected = equip.id === state.equipModalCurrentId;
  const item = document.createElement("div");
  item.className = `flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
    isSelected
      ? "bg-primary/15 ring-1 ring-primary/30"
      : "hover:bg-primary/8 active:bg-primary/15"
  }`;

  const iconNum = equip.type?.[3] ?? 0;
  const frame = state.weaponIconFrames[iconNum];
  const iconEl = document.createElement("div");
  iconEl.className = "w-6 h-6 shrink-0 rounded";
  if (frame && state.spriteSheetUrl) {
    const [fx, fy, fw, fh] = frame;
    const scaleX = 24 / fw;
    const scaleY = 24 / fh;
    iconEl.style.backgroundImage = `url('${state.spriteSheetUrl}')`;
    iconEl.style.backgroundPosition = `-${fx * scaleX}px -${fy * scaleY}px`;
    iconEl.style.backgroundSize = `${state.spriteSheetW * scaleX}px ${state.spriteSheetH * scaleY}px`;
    iconEl.style.backgroundRepeat = "no-repeat";
  }
  item.appendChild(iconEl);

  const textDiv = document.createElement("div");
  textDiv.className = "min-w-0 flex-1";
  const nameSpan = document.createElement("div");
  nameSpan.className = "text-sm truncate leading-tight";
  nameSpan.textContent = equip.name;
  textDiv.appendChild(nameSpan);
  const typeSpan = document.createElement("div");
  typeSpan.className = "text-[11px] text-base-content/40 leading-tight";
  const snLv = (equip as MstSlotItemData & { _snapshotLevel?: number })
    ._snapshotLevel;
  const snAlv = (equip as MstSlotItemData & { _snapshotAlv?: number })
    ._snapshotAlv;
  const snCount = (equip as MstSlotItemData & { _snapshotCount?: number })
    ._snapshotCount;
  typeSpan.textContent = getEquipTypeName(equip.type?.[2] ?? 0);
  if (snLv != null && snLv > 0) {
    const impSpan = document.createElement("span");
    impSpan.style.color = "#00897b";
    impSpan.style.fontWeight = "bold";
    impSpan.textContent = ` ★${snLv}`;
    typeSpan.appendChild(impSpan);
  }
  if (snAlv != null && snAlv > 0) {
    const profSpan = document.createElement("span");
    const profSymbols = ["|", "|", "||", "|||", "\\", "\\\\", "\\\\\\", ">>"];
    profSpan.style.fontWeight = "bold";
    profSpan.style.textShadow =
      "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)";
    if (snAlv <= 3) profSpan.style.color = "#1976d2";
    else if (snAlv <= 6) profSpan.style.color = "#f57c00";
    else profSpan.style.color = "#e65100";
    profSpan.textContent = ` ${profSymbols[snAlv] ?? ">>"}`;
    typeSpan.appendChild(profSpan);
  }
  if (snCount != null && snCount > 1) {
    const cntSpan = document.createElement("span");
    cntSpan.style.color = "#6b7280";
    cntSpan.textContent = ` ×${snCount}`;
    typeSpan.appendChild(cntSpan);
  }
  textDiv.appendChild(typeSpan);
  item.appendChild(textDiv);

  // Key stat badges
  const badges = document.createElement("div");
  badges.className = "flex gap-1 shrink-0 flex-wrap justify-end";
  if (snLv != null && snLv > 0) {
    const lvBadge = document.createElement("span");
    lvBadge.className = "text-[10px] px-1 py-0.5 rounded font-mono font-bold";
    lvBadge.style.color = "#00897b";
    lvBadge.style.textShadow =
      "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)";
    lvBadge.textContent = `★${snLv}`;
    badges.appendChild(lvBadge);
  }
  if (snAlv != null && snAlv > 0) {
    const profSymbols = ["|", "|", "||", "|||", "\\", "\\\\", "\\\\\\", ">>"];
    const alvBadge = document.createElement("span");
    alvBadge.className = "text-[10px] px-1 py-0.5 rounded font-mono font-bold";
    alvBadge.style.textShadow =
      "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)";
    if (snAlv <= 3) alvBadge.style.color = "#1976d2";
    else if (snAlv <= 6) alvBadge.style.color = "#f57c00";
    else alvBadge.style.color = "#e65100";
    alvBadge.textContent = profSymbols[snAlv] ?? ">>";
    badges.appendChild(alvBadge);
  }
  if (snCount != null && snCount > 1) {
    const cntBadge = document.createElement("span");
    cntBadge.className =
      "text-[10px] px-1 py-0.5 rounded font-mono font-bold bg-base-200/60 text-base-content/60";
    cntBadge.textContent = `×${snCount}`;
    badges.appendChild(cntBadge);
  }
  const statPairs: [string, number][] = [];
  if (equip.houg) statPairs.push(["火", equip.houg]);
  if (equip.raig) statPairs.push(["雷", equip.raig]);
  if (equip.tyku) statPairs.push(["空", equip.tyku]);
  if (equip.tais) statPairs.push(["潜", equip.tais]);
  if (equip.baku) statPairs.push(["爆", equip.baku]);
  for (const [lbl, val] of statPairs.slice(0, 3)) {
    const b = document.createElement("span");
    b.className = `text-[10px] px-1 py-0.5 rounded font-mono ${val > 0 ? "bg-success/10 text-success" : "bg-error/10 text-error"}`;
    b.textContent = `${lbl}${val > 0 ? "+" : ""}${val}`;
    badges.appendChild(b);
  }
  item.appendChild(badges);

  item.addEventListener("mouseenter", () => renderEquipDetail(equip));
  item.addEventListener("click", () => {
    if (state.isWorkspaceReadOnly) return;
    state.equipModalCb?.(equip.id);
    state.equipModalCb = null;
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
    state.equipModalSource === "snapshot" &&
    Object.keys(state.snapshotSlotItems).length > 0
  ) {
    const variantMap = new Map<
      string,
      { slotitem_id: number; level: number; alv: number; count: number }
    >();
    for (const si of Object.values(state.snapshotSlotItems)) {
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
        const mst = state.mstSlotItems[v.slotitem_id];
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
    items = Object.values(state.mstSlotItems).sort(
      (a, b) => (a.sortno ?? a.id) - (b.sortno ?? b.id),
    );
  }

  items = filterEquipsBySide(items, sideFilter);

  if (isAirBaseEquipTarget()) {
    items = items.filter((e) => AIRCRAFT_TYPES.has(e.type?.[2] ?? -1));
  }

  // Apply ship-based equipment filter
  const isExslot = state.equipModalTargetSlotIdx === -1;
  if (isExslot && !isAirBaseEquipTarget()) {
    const filtered = filterForExslot(
      state.equipModalTargetShipId,
      state.equipModalTargetSlot?.shipLevel ?? null,
      items,
    );
    if (filtered) items = filtered;
  } else {
    const filtered = filterForNormalSlot(state.equipModalTargetShipId, items);
    if (filtered) items = filtered;
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

  if (state.equipModalCurrentId != null) {
    const clearItem = document.createElement("div");
    clearItem.className =
      "flex items-center gap-2 px-3 py-2 mb-1 rounded-lg cursor-pointer bg-error/5 hover:bg-error/10 text-error/70 hover:text-error transition-colors text-sm";
    clearItem.textContent = "✕ 装備を外す";
    clearItem.addEventListener("click", () => {
      if (state.isWorkspaceReadOnly) return;
      state.equipModalCb?.(null);
      state.equipModalCb = null;
      (
        document.getElementById("equip-select-modal") as HTMLDialogElement
      ).close();
    });
    grid.appendChild(clearItem);
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
    const rows: EquipGRow[] = [];
    const catOffsets: { typeId: number; offset: number }[] = [];
    let totalH = 0;
    for (const t of sortedTypes) {
      catOffsets.push({ typeId: t, offset: totalH });
      rows.push({ kind: "header", typeId: t });
      totalH += HEADER_HEIGHT;
      for (const e of groups.get(t)!) {
        rows.push({ kind: "item", equip: e });
        totalH += EQUIP_ROW_PITCH;
      }
    }
    const offsets = new Array<number>(rows.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < rows.length; i++) {
      offsets[i + 1] =
        offsets[i] +
        (rows[i].kind === "header" ? HEADER_HEIGHT : EQUIP_ROW_PITCH);
    }

    const { spacer, viewport } = createVSContainer();
    spacer.style.height = `${totalH}px`;
    grid.appendChild(spacer);

    _equipGVS = { rows, offsets, spacer, viewport, grid, rStart: -1, rEnd: -1 };
    grid.addEventListener("scroll", onEquipGScroll);
    syncEquipGVS();
    renderEquipCategoryNav(catOffsets);
  } else {
    const { spacer, viewport } = createVSContainer();
    spacer.style.height = `${items.length * EQUIP_ROW_PITCH}px`;
    viewport.style.cssText += "display:flex;flex-direction:column;gap:1px;";
    grid.appendChild(spacer);

    _equipVS = {
      items,
      spacer,
      viewport,
      grid,
      cols: 1,
      pitch: EQUIP_ROW_PITCH,
      measured: false,
      rStart: -1,
      rEnd: -1,
    };
    grid.addEventListener("scroll", onEquipScroll);
    syncEquipVS();
    renderEquipCategoryNav([]);
  }
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
    ["装甲", equip.souk],
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
    v.className = `font-mono font-medium ${value > 0 ? "text-success" : "text-error"}`;
    v.textContent = `${value > 0 ? "+" : ""}${value}`;
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
  if (
    state.slotItemEffects &&
    state.equipModalTargetShipId != null &&
    state.equipModalTargetSlot
  ) {
    const shipId = state.equipModalTargetShipId;
    const targetSlot = state.equipModalTargetSlot;
    const targetIdx = state.equipModalTargetSlotIdx;
    const shipData = state.mstShips[shipId];

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
      state.equipModalSideFilter = equipSideEl.value as SideFilter;
      populateEquipTypeFilter(equipTypeEl, state.equipModalSideFilter);
      renderEquipGrid(
        equipSearchEl.value,
        equipTypeEl.value,
        state.equipModalSideFilter,
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
      if (src === state.equipModalSource) return;
      state.equipModalSource = src;
      updateEquipSourceTabs();
      const search =
        equipSearchEl instanceof HTMLInputElement ? equipSearchEl.value : "";
      const side =
        equipSideEl instanceof HTMLSelectElement
          ? (equipSideEl.value as SideFilter)
          : state.equipModalSideFilter;
      const type =
        equipTypeEl instanceof HTMLSelectElement ? equipTypeEl.value : "";
      renderEquipGrid(search, type, side);
    });
}

/** Invalidate equip virtual scroll on resize. */
export function handleResizeEquip() {
  if (_equipVS) {
    _equipVS.rStart = -1;
    _equipVS.measured = false;
    syncEquipVS();
  }
  if (_equipGVS) {
    _equipGVS.rStart = -1;
    syncEquipGVS();
  }
}
