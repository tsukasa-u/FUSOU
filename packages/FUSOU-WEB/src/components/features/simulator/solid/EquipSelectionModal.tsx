/* @jsxImportSource solid-js */
import { createSignal, createMemo, onMount, onCleanup, createEffect, Show, For } from "solid-js";
import { VList } from "virtua/solid";
import type { Component } from "solid-js";
import { useStore } from "@nanostores/solid";
import type { MstSlotItemData } from "@/features/simulator/types";
import { AIRCRAFT_TYPES, EQUIP_TYPE_NAMES, EQUIP_TYPE_SHORT, ENEMY_ID_THRESHOLD, RANGE_NAMES } from "@/features/simulator/constants";
import { equipImageUrl, computeEquipBonuses } from "@/features/simulator/equip-calc";
import { filterForNormalSlot, filterForExslot, getExslotSelectionRequirement } from "@/features/simulator/equip-filter";
import { EQUIP_ROW_PITCH, HEADER_HEIGHT } from "@/features/simulator/virtual-scroll";
import { consumeEquipModalCallback, setEquipModalSideFilter, setEquipModalSource } from "@/features/simulator/simulator-mutations";
import { getEquipModalCurrentId, getEquipModalSideFilter, getEquipModalSource, getEquipModalTarget, getMasterEquipTypeName, getMasterShip, getMasterSlotItem, getMasterSlotItems, getSlotItemEffects, getSnapshotSlotItems, getSpriteSheetMeta, getWeaponIconFrame, hasMasterData, hasSnapshotSlotItems, isAirBaseEquipModalTarget, isWorkspaceReadOnly } from "@/features/simulator/simulator-selectors";
import { masterDataStatusStore } from "@/features/simulator/data-loader";
import {
  PickerQuickAccess,
  type PickerQuickAccessEntry,
} from "./picker-quick-access";
import { StatPill, WeaponIcon } from "./shared-ui";
import { SelectionModalShell } from "./selection-modal-shell";

export const [equipModalTrigger, setEquipModalTrigger] = createSignal(0);

type EquipRuntimeMeta = MstSlotItemData & { _snapshotLevel?: number; _snapshotAlv?: number; _snapshotCount?: number; _requiredLevel?: number; _requiredAlv?: number; };
type SideFilter = "ally" | "enemy" | "all";

function getCandidateLevel(equip: MstSlotItemData): number {
  const e = equip as EquipRuntimeMeta;
  return Math.max(0, e._snapshotLevel ?? e._requiredLevel ?? 0);
}
function getCandidateAlv(equip: MstSlotItemData): number {
  const e = equip as EquipRuntimeMeta;
  return Math.max(0, e._snapshotAlv ?? e._requiredAlv ?? 0);
}

function filterEquipsBySide(equips: MstSlotItemData[], sideFilter: SideFilter): MstSlotItemData[] {
  if (sideFilter === "all") return equips;
  if (sideFilter === "enemy") return equips.filter((e) => e.id >= ENEMY_ID_THRESHOLD);
  return equips.filter((e) => e.id < ENEMY_ID_THRESHOLD);
}
function isValidAirBaseItem(e: MstSlotItemData): boolean {
  const type2 = e.type?.[2] ?? -1;
  if (!AIRCRAFT_TYPES.has(type2)) return false;
  return (e.distance ?? 0) > 0;
}
function getEquipTypeName(typeId: number): string {
  return getMasterEquipTypeName(typeId) ?? EQUIP_TYPE_NAMES[typeId] ?? `Type ${typeId}`;
}

export function EquipSelectionModal() {
  let dialogRef!: HTMLDialogElement;
  let vlistRef: any;
  const masterDataStatus = useStore(masterDataStatusStore);

  const [search, setSearch] = createSignal("");
  const [sideFilter, setSideFilter] = createSignal<SideFilter>(getEquipModalSideFilter());
  const [typeFilter, setTypeFilter] = createSignal("");
  const [source, setSource] = createSignal<"snapshot" | "master">(getEquipModalSource());
  const [hoveredEquipId, setHoveredEquipId] = createSignal<number | null>(null);
  const [activeQuickAccessId, setActiveQuickAccessId] = createSignal<string | null>(null);

  createEffect(() => {
    if (equipModalTrigger() > 0) {
      setSearch("");
      setTypeFilter("");
      setSideFilter(getEquipModalSideFilter());
      setSource(hasSnapshotSlotItems() ? "snapshot" : "master");
      setHoveredEquipId(getEquipModalCurrentId() ?? null);
      if (dialogRef && !dialogRef.open) {
        dialogRef.showModal();
        requestAnimationFrame(() => {
          if (vlistRef && activeRowIndex() >= 0) {
            vlistRef.scrollToIndex(activeRowIndex(), { align: "center" });
          }
        });
      }
    }
  });

  const closeModal = () => { if (dialogRef && dialogRef.open) dialogRef.close(); };

  const equipOptions = createMemo(() => {
    masterDataStatus();
    equipModalTrigger();
    const types = new Map<number, string>();
    let items = filterEquipsBySide(Object.values(getMasterSlotItems()), sideFilter());
    if (isAirBaseEquipModalTarget()) items = items.filter((e) => isValidAirBaseItem(e));
    for (const e of items) {
      const t = e.type?.[2];
      if (t != null && !types.has(t)) types.set(t, getEquipTypeName(t));
    }
    return [...types.entries()].sort((a, b) => a[0] - b[0]);
  });

  const filteredEquips = createMemo(() => {
    masterDataStatus();
    equipModalTrigger();
    if (!hasMasterData()) return [];
    let items: MstSlotItemData[];
    const isAirBase = isAirBaseEquipModalTarget();
    
    if (source() === "snapshot" && hasSnapshotSlotItems()) {
      const variantMap = new Map<string, any>();
      for (const si of Object.values(getSnapshotSlotItems())) {
        const key = `${si.slotitem_id}_${si.level ?? 0}_${si.alv ?? 0}`;
        const existing = variantMap.get(key);
        if (existing) existing.count++;
        else variantMap.set(key, { slotitem_id: si.slotitem_id, level: si.level ?? 0, alv: si.alv ?? 0, count: 1 });
      }
      items = [...variantMap.values()]
        .map((v) => {
          const mst = getMasterSlotItem(v.slotitem_id);
          if (!mst) return null;
          return { ...mst, _snapshotLevel: v.level, _snapshotAlv: v.alv, _snapshotCount: v.count };
        })
        .filter((e): e is any => e != null)
        .sort((a, b) => (a.sortno ?? a.id) - (b.sortno ?? b.id));
    } else {
      items = Object.values(getMasterSlotItems()).sort((a, b) => (a.sortno ?? a.id) - (b.sortno ?? b.id));
    }

    items = filterEquipsBySide(items, sideFilter());
    if (isAirBase) items = items.filter((e) => isValidAirBaseItem(e));

    const equipTarget = getEquipModalTarget();
    const isExslot = equipTarget.slotIdx === -1;
    if (!isAirBase && equipTarget.shipId != null) {
      if (isExslot) {
        items = filterForExslot(equipTarget.shipId, items) || items;
      } else {
        items = filterForNormalSlot(equipTarget.shipId, items, equipTarget.slotIdx) || items;
      }
    }

    if (source() === "master" && equipTarget.shipId != null && !isAirBase) {
      if (isExslot) {
        items = items.map((item) => {
          const req = getExslotSelectionRequirement(equipTarget.shipId!, item);
          if (!req || (req.level <= 0 && req.alv <= 0)) return item;
          return { ...item, _requiredLevel: req.level, _requiredAlv: req.alv } as any;
        });
      }
    }

    if (typeFilter()) {
      const ft = parseInt(typeFilter(), 10);
      items = items.filter((e) => e.type?.[2] === ft);
    }
    if (search()) {
      const q = search().toLowerCase();
      items = items.filter((e) => e.name.toLowerCase().includes(q) || String(e.id).includes(q));
    }
    return items;
  });

  const listData = createMemo(() => {
    const items = filteredEquips();
    const rows: any[] = [];
    let catOffsets: { typeId: number; offset: number }[] = [];
    let virtualOffset = 0;
    const filter = typeFilter();
    
    if (!filter) {
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
      for (const equip of items) rows.push({ kind: "item", equip });
    }
    return { rows, catOffsets };
  });

  const activeRowIndex = createMemo(() => {
    const data = listData();
    const currentId = getEquipModalCurrentId();
    if (currentId == null) return -1;
    return data.rows.findIndex(r => r.kind === "item" && r.equip.id === currentId);
  });

  const quickAccessEntries = createMemo<PickerQuickAccessEntry[]>(() =>
    listData().catOffsets.map((cat) => {
      const iconNum =
        filteredEquips().find((e) => (e.type?.[2] ?? 0) === cat.typeId)?.type?.[3] ??
        0;
      return {
        id: String(cat.typeId),
        label: EQUIP_TYPE_SHORT[cat.typeId] ?? getEquipTypeName(cat.typeId),
        icon: <WeaponIcon iconNum={iconNum} size={22} />,
        onSelect: () => {
          const targetIdx = listData().rows.findIndex(
            (r) => r.kind === "header" && r.typeId === cat.typeId,
          );
          if (targetIdx >= 0 && vlistRef) {
            setActiveQuickAccessId(String(cat.typeId));
            vlistRef.scrollToIndex(targetIdx);
          }
        },
      };
    }),
  );

  const updateActiveQuickAccessByOffset = (offset: number) => {
    const cats = listData().catOffsets;
    if (cats.length === 0) {
      setActiveQuickAccessId(null);
      return;
    }
    let current = cats[0].typeId;
    for (const cat of cats) {
      if (cat.offset <= offset + 2) current = cat.typeId;
      else break;
    }
    setActiveQuickAccessId(String(current));
  };

  createEffect(() => {
    const cats = listData().catOffsets;
    if (cats.length === 0) {
      setActiveQuickAccessId(null);
      return;
    }
    if (!activeQuickAccessId()) {
      setActiveQuickAccessId(String(cats[0].typeId));
    }
  });

  const handleSelect = (equip: MstSlotItemData) => {
    if (isWorkspaceReadOnly()) return;
    consumeEquipModalCallback({ id: equip.id, level: getCandidateLevel(equip), alv: getCandidateAlv(equip) });
    closeModal();
  };

  const handleClear = () => {
    if (isWorkspaceReadOnly()) return;
    consumeEquipModalCallback({ id: null, level: 0, alv: 0 });
    closeModal();
  };

  return (
    <SelectionModalShell
      id="equip-select-modal"
      dialogRef={(el) => {
        dialogRef = el;
      }}
      boxClass="w-[min(96vw,84rem)] max-w-[84rem]"
      onClose={() => setHoveredEquipId(null)}
    >
        <div class="px-5 pt-4 pb-3 border-b border-base-200 shrink-0">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-bold text-lg">装備を選択</h3>
            <form method="dialog"><button class="btn btn-ghost btn-sm btn-circle">✕</button></form>
          </div>
          <div class="flex gap-2">
            <input id="equip-modal-search" type="text" placeholder="装備名で検索..." class="input input-bordered input-sm flex-1" autocomplete="off" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
            <select class="select select-bordered select-sm w-28 sm:w-32" value={sideFilter()} onChange={(e) => { setSideFilter(e.currentTarget.value as SideFilter); setEquipModalSideFilter(e.currentTarget.value as SideFilter); }}>
              <option value="ally">味方のみ</option><option value="enemy">敵のみ</option><option value="all">全て</option>
            </select>
            <select class="select select-bordered select-sm w-32 sm:w-40" value={typeFilter()} onChange={(e) => setTypeFilter(e.currentTarget.value)}>
              <option value="">全装備種</option>
              <For each={equipOptions()}>
                {([id, name]) => <option value={id}>{name}</option>}
              </For>
            </select>
          </div>
          <Show when={hasSnapshotSlotItems()}>
            <div class="tabs tabs-boxed mt-2">
              <button class={`tab tab-sm ${source() === "snapshot" ? "tab-active" : ""}`} onClick={() => { setSource("snapshot"); setEquipModalSource("snapshot"); }}>スナップショット</button>
              <button class={`tab tab-sm ${source() === "master" ? "tab-active" : ""}`} onClick={() => { setSource("master"); setEquipModalSource("master"); }}>マスターデータ</button>
            </div>
          </Show>
        </div>

        <div class="flex flex-1 min-h-0">
          <PickerQuickAccess
            entries={quickAccessEntries()}
            widthClass="w-32"
            activeId={activeQuickAccessId()}
          />

          <div class="relative flex-1 p-2 sm:p-3 flex flex-col min-h-0 overflow-hidden">
             <Show when={getEquipModalCurrentId() != null}>
               <div
                  class="shrink-0 flex items-center gap-2 px-3 py-2 mb-1 rounded-lg cursor-pointer bg-error/5 hover:bg-error/10 text-error/70 hover:text-error transition-colors text-sm"
                  style={isWorkspaceReadOnly() ? "opacity: 0.5; pointer-events: none" : ""}
                  onClick={handleClear}
               >
                 ✕ 装備を外す
               </div>
             </Show>
             <Show when={listData().rows.length === 0}>
                <p class="text-sm text-base-content/30 text-center py-12">該当する装備が見つかりません</p>
             </Show>
             <div id="equip-modal-grid" class="flex-1 min-h-0 overflow-hidden">
               <VList data={listData().rows} ref={vlistRef} style={{ height: "100%" }} class="overflow-x-hidden" onScroll={updateActiveQuickAccessByOffset}>
                 {(row: any) => {
                   if (row.kind === "header") {
                     return <div class="bg-base-100/90 backdrop-blur-sm px-2 text-xs font-bold text-base-content/50 border-b border-base-200/50 flex items-center" style={{ height: `${HEADER_HEIGHT}px` }}>{getEquipTypeName(row.typeId)}</div>;
                   }
                   const equip = row.equip;
                   const isSelected = equip.id === getEquipModalCurrentId();
                   const iconNum = equip.type?.[3] ?? 0;
                   const frame = getWeaponIconFrame(iconNum);
                   const spriteSheet = getSpriteSheetMeta();
                   const displayLv = getCandidateLevel(equip);
                   const displayAlv = getCandidateAlv(equip);
                   const reqLv = equip._requiredLevel ?? 0;
                   const reqAlv = equip._requiredAlv ?? 0;
                   const hasRequiredMeta = reqLv > 0 || reqAlv > 0;
                   const isSnapshot = source() === "snapshot";
                   const profSymbols = ["|", "|", "||", "|||", "\\", "\\\\", "\\\\\\", ">>"];
                   const iconPx = 30;

                   return (
                     <div style={{ height: `${EQUIP_ROW_PITCH}px`, display: "flex", "align-items": "center", "box-sizing": "border-box" }}>
                       <div class={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors min-w-0 ${isSelected ? "bg-primary/15 ring-1 ring-primary/30" : "hover:bg-primary/8 active:bg-primary/15"}`} onMouseEnter={() => setHoveredEquipId(equip.id)} onClick={() => handleSelect(equip)}>
                         <div class="rounded shrink-0" style={frame && spriteSheet.url ? { width: `${iconPx}px`, height: `${iconPx}px`, "background-image": `url('${spriteSheet.url}')`, "background-position": `-${frame[0] * (iconPx / frame[2])}px -${frame[1] * (iconPx / frame[3])}px`, "background-size": `${spriteSheet.width * (iconPx / frame[2])}px ${spriteSheet.height * (iconPx / frame[3])}px`, "background-repeat": "no-repeat" } : { width: `${iconPx}px`, height: `${iconPx}px` }}></div>
                         <div class="min-w-0 flex-1 overflow-hidden">
                           <div class="text-sm truncate leading-tight font-medium">{equip.name}</div>
                           <div class="grid grid-cols-[minmax(0,1fr)_2.1rem_2.1rem_2.4rem] items-center gap-0.5 text-[11px] text-base-content/40 leading-tight">
                             <span class="truncate">
                               {getEquipTypeName(equip.type?.[2] ?? 0)}
                               <Show when={!isSnapshot && hasRequiredMeta}>
                                  <span class="text-[10px] leading-tight text-warning/80 font-mono shrink-0 ml-2">必要最低 {(displayLv > 0 ? `★${displayLv}+` : "")}{(displayAlv > 0 ? `熟練${profSymbols[displayAlv] ?? ">>"}+` : "")}</span>
                               </Show>
                             </span>
                             <Show when={isSnapshot}>
                               <span class={`text-right font-mono ${equip._snapshotAlv > 0 ? (equip._snapshotAlv <= 3 ? "text-blue-700 font-bold" : equip._snapshotAlv <= 6 ? "text-amber-700 font-bold" : "text-orange-700 font-bold") : "text-base-content/30"}`}>{equip._snapshotAlv > 0 ? (profSymbols[equip._snapshotAlv] ?? ">>") : ""}</span>
                               <span class={`text-right font-mono ${equip._snapshotLevel > 0 ? "text-teal-700 font-bold" : "text-base-content/30"}`}>{equip._snapshotLevel > 0 ? `★${equip._snapshotLevel}` : ""}</span>
                               <span class={`text-right font-mono ${equip._snapshotCount > 1 ? "font-bold text-base-content/60" : "text-base-content/30"}`}>{equip._snapshotCount > 1 ? `×${equip._snapshotCount}` : ""}</span>
                             </Show>
                           </div>
                         </div>
                         <div class="ml-auto flex shrink-0 items-center justify-end gap-0.5 whitespace-nowrap overflow-hidden text-right min-w-38 sm:min-w-42">
                           <StatPill label="火" value={equip.houg} tone="fire" />
                           <StatPill label="雷" value={equip.raig} tone="torpedo" />
                           <StatPill label="空" value={equip.tyku} tone="aa" />
                           <StatPill label="装" value={equip.souk} tone="armor" />
                         </div>
                       </div>
                     </div>
                   );
                 }}
               </VList>
             </div>
          </div>

          <div id="equip-modal-detail" class="w-64 xl:w-72 overflow-y-auto p-4 bg-base-200/30 border-l border-base-200 hidden md:block">
            <Show when={hoveredEquipId()} fallback={<p class="text-sm text-base-content/30 text-center pt-10">装備にカーソルを合わせると<br />詳細が表示されます</p>}>
              {(id) => <EquipDetail equip={getMasterSlotItem(id())!} />}
            </Show>
          </div>
        </div>
    </SelectionModalShell>
  );
}

function EquipDetail(props: { equip: MstSlotItemData }) {
  const statsDef = createMemo(() => {
    const e = props.equip;
    const res: [string, number][] = [];
    if (e.houg) res.push(["火力", e.houg]);
    if (e.raig) res.push(["雷装", e.raig]);
    if (e.tyku) res.push(["対空", e.tyku]);
    if (e.tais) res.push(["対潜", e.tais]);
    if (e.baku) res.push(["爆装", e.baku]);
    if (e.saku) res.push(["索敵", e.saku]);
    if (e.houm) res.push(["命中", e.houm]);
    if (e.kaih ?? e.houk) res.push(["回避", e.kaih ?? e.houk ?? 0]);
    if (e.souk) res.push(["装甲", e.souk]);
    if (e.leng) res.push(["射程", e.leng]);
    if (e.taibaku) res.push(["対爆", e.taibaku]);
    if (e.geigeki) res.push(["迎撃", e.geigeki]);
    return res;
  });

  const bonusInfo = createMemo(() => {
    const equipTarget = getEquipModalTarget();
    if (!getSlotItemEffects() || equipTarget.shipId == null || !equipTarget.slot) return null;
    const shipId = equipTarget.shipId;
    const targetSlot = equipTarget.slot;
    const targetIdx = equipTarget.slotIdx;
    const shipData = getMasterShip(shipId);

    const testEquipIds = [...targetSlot.equipIds];
    let testExSlotId = targetSlot.exSlotId;
    if (targetIdx >= 0) testEquipIds[targetIdx] = props.equip.id;
    else testExSlotId = props.equip.id;

    const bonusWith = computeEquipBonuses(shipId, testEquipIds, testExSlotId, targetSlot.equipImprovement, targetSlot.exSlotImprovement);
    
    const testEquipIdsWithout = [...targetSlot.equipIds];
    let testExSlotIdWithout = targetSlot.exSlotId;
    if (targetIdx >= 0) testEquipIdsWithout[targetIdx] = null;
    else testExSlotIdWithout = null;
    
    const bonusWithout = computeEquipBonuses(shipId, testEquipIdsWithout, testExSlotIdWithout, targetSlot.equipImprovement, targetSlot.exSlotImprovement);

    const delta: Record<string, number> = {};
    const bonusKeys = new Set([...Object.keys(bonusWith), ...Object.keys(bonusWithout)]);
    for (const k of bonusKeys) {
      const d = ((bonusWith as any)[k] || 0) - ((bonusWithout as any)[k] || 0);
      if (d !== 0) delta[k] = d;
    }
    return { delta, shipName: shipData?.name };
  });

  return (
    <>
      <Show when={equipImageUrl(props.equip.id, { f: "auto" })}>
        {(src) => (
          <div class="w-full aspect-[1.6] bg-base-200 rounded-lg overflow-hidden mb-3 flex items-center justify-center">
            <img src={src()} alt={props.equip.name} class="max-w-full max-h-full object-contain" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          </div>
        )}
      </Show>
      <h4 class="font-bold text-base mb-1">{props.equip.name}</h4>
      <span class="badge badge-sm badge-outline mb-4">{getEquipTypeName(props.equip.type?.[2] ?? 0)} #{props.equip.id}</span>
      <div class="divide-y divide-base-200">
        <For each={statsDef()}>
          {([label, value]) => (
            <div class="flex justify-between py-1.5 text-sm">
              <span class="text-base-content/50">{label}</span>
              <span class={`font-mono font-medium ${label === '射程' ? 'text-base-content/80' : value > 0 ? 'text-success' : 'text-error'}`}>
                {label === '射程' ? RANGE_NAMES[value] ?? String(value) : `${value > 0 ? "+" : ""}${value}`}
              </span>
            </div>
          )}
        </For>
        <Show when={props.equip.distance != null && props.equip.distance > 0}>
          <div class="flex justify-between py-1.5 text-sm">
            <span class="text-base-content/50">行動半径</span>
            <span class="font-mono font-medium">{props.equip.distance}</span>
          </div>
        </Show>
      </div>

      <Show when={bonusInfo() && Object.keys(bonusInfo()!.delta).length > 0 ? bonusInfo() : null}>
        {(info) => {
          const STAT_JP: Record<string, string> = { houg: "火力", raig: "雷装", tyku: "対空", souk: "装甲", soku: "速力", kaih: "回避", tais: "対潜", saku: "索敵", baku: "爆装", houm: "命中", leng: "射程" };
          return (
            <div class="mt-4 pt-3 border-t border-base-200">
              <div class="text-[11px] font-bold text-warning/80 mb-2 flex items-center gap-1">
                <span class="text-warning">★</span> 装備ボーナス{info().shipName ? ` (${info().shipName})` : ""}
              </div>
              <div class="divide-y divide-base-200/50">
                <For each={Object.entries(info().delta) as [string, number][]}>
                  {([k, v]) => (
                    <div class="flex justify-between py-1 text-xs">
                      <span class="text-base-content/50">{STAT_JP[k] ?? k}</span>
                      <span class={`font-mono font-medium ${v > 0 ? "text-success" : "text-error"}`}>
                        {v > 0 ? "+" : ""}{v}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )
        }}
      </Show>
    </>
  );
}
