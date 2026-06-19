/* @jsxImportSource solid-js */
import { createSignal, createMemo, onMount, onCleanup, createEffect, Show, For } from "solid-js";
import { VList } from "virtua/solid";
import type { Component } from "solid-js";
import { useStore } from "@nanostores/solid";
import type { MstShipData } from "@/features/simulator/types";
import { STYPE_NAMES, STYPE_SHORT, SPEED_NAMES, ENEMY_ID_THRESHOLD } from "@/features/simulator/constants";
import { canAssignShipWithoutWorseningCombinedRules } from "@/features/simulator/combined-fleet";
import { bannerUrl } from "@/features/simulator/equip-calc";
import { SHIP_ROW_PITCH, HEADER_HEIGHT } from "@/features/simulator/virtual-scroll";
import { consumeShipModalCallback, setShipModalSideFilter, setShipModalSource } from "@/features/simulator/simulator-mutations";
import { getCombinedFleetType, getFleetState, getMasterShip, getMasterShips, getShipModalCurrentId, getShipModalTarget, getShipModalSideFilter, getShipModalSource, getSnapshotShips, hasMasterData, hasSnapshotShips, isWorkspaceReadOnly } from "@/features/simulator/simulator-selectors";
import { cachedFetch } from "@/utils/fetchCache";
import { masterDataStatusStore } from "@/features/simulator/data-loader";

// Modal trigger signal
export const [shipModalTrigger, setShipModalTrigger] = createSignal(0);

// --- Ship Growth Logic ---
type ShipGrowthSummary = { ok: boolean; periods?: Array<{ period_tag: string; table_version: string }> };
type ShipGrowthCaps = { master_id: number; kaihi_max?: number; taisen_max?: number; sakuteki_max?: number; kaih_max?: number; tais_max?: number; saku_max?: number; };
type NormalizedShipGrowthCaps = { master_id: number; kaihi_max: number; taisen_max: number; sakuteki_max: number; };
type ShipGrowthBoundRow = { master_id: number; lv: number; kaihi_naked: number; taisen_naked: number; sakuteki_naked: number; };
type ShipGrowthBoundsResponse = { caps?: ShipGrowthCaps[]; bounds?: ShipGrowthBoundRow[]; updated_at?: number; updated_at_iso?: string | null; };
type ShipGrowthCapLookup = { cap: NormalizedShipGrowthCaps | null; updatedAtIso: string | null; };

function normalizeShipGrowthCaps(raw: ShipGrowthCaps | null): NormalizedShipGrowthCaps | null {
  if (!raw) return null;
  return { master_id: raw.master_id, kaihi_max: Number(raw.kaihi_max ?? raw.kaih_max ?? 0), taisen_max: Number(raw.taisen_max ?? raw.tais_max ?? 0), sakuteki_max: Number(raw.sakuteki_max ?? raw.saku_max ?? 0) };
}
function deriveShipGrowthCapsFromBounds(masterId: number, bounds: ShipGrowthBoundRow[]): NormalizedShipGrowthCaps | null {
  if (!Array.isArray(bounds) || bounds.length === 0) return null;
  const shipBounds = bounds.filter((row) => row.master_id === masterId);
  if (shipBounds.length === 0) return null;
  return { master_id: masterId, kaihi_max: Math.max(0, ...shipBounds.map((row) => Number(row.kaihi_naked || 0))), taisen_max: Math.max(0, ...shipBounds.map((row) => Number(row.taisen_naked || 0))), sakuteki_max: Math.max(0, ...shipBounds.map((row) => Number(row.sakuteki_naked || 0))) };
}
function mergeShipGrowthCaps(primary: NormalizedShipGrowthCaps | null, fallback: NormalizedShipGrowthCaps | null): NormalizedShipGrowthCaps | null {
  if (!primary && !fallback) return null;
  if (!primary) return fallback;
  if (!fallback) return primary;
  return { master_id: primary.master_id, kaihi_max: primary.kaihi_max > 0 ? primary.kaihi_max : fallback.kaihi_max, taisen_max: primary.taisen_max > 0 ? primary.taisen_max : fallback.taisen_max, sakuteki_max: primary.sakuteki_max > 0 ? primary.sakuteki_max : fallback.sakuteki_max };
}
function needsStatFallback(value: number[] | null | undefined): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.every((v) => !Number.isFinite(v) || v <= 0);
}

let _shipGrowthPeriodPromise: Promise<{ period_tag: string; table_version: string; } | null> | null = null;
const _shipGrowthCapsCache = new Map<number, ShipGrowthCapLookup | null>();

function getLatestShipGrowthPeriod(): Promise<{ period_tag: string; table_version: string; } | null> {
  if (_shipGrowthPeriodPromise) return _shipGrowthPeriodPromise;
  _shipGrowthPeriodPromise = (async () => {
    const res = await cachedFetch("/api/ship-growth/summary");
    if (!res.ok) return null;
    const json = (await res.json()) as ShipGrowthSummary;
    const latest = json.periods?.[0];
    return latest ? { period_tag: latest.period_tag, table_version: latest.table_version } : null;
  })().catch(() => null);
  return _shipGrowthPeriodPromise;
}

async function getShipGrowthCaps(masterId: number): Promise<ShipGrowthCapLookup | null> {
  if (_shipGrowthCapsCache.has(masterId)) return _shipGrowthCapsCache.get(masterId) ?? null;
  try {
    const latest = await getLatestShipGrowthPeriod();
    if (!latest) { _shipGrowthCapsCache.set(masterId, null); return null; }
    const boundsRes = await cachedFetch(`/api/ship-growth/bounds?period_tag=${encodeURIComponent(latest.period_tag)}&table_version=${encodeURIComponent(latest.table_version)}`);
    if (!boundsRes.ok) { _shipGrowthCapsCache.set(masterId, null); return null; }
    const boundsJson = (await boundsRes.json()) as ShipGrowthBoundsResponse;
    const capFromCaps = normalizeShipGrowthCaps((boundsJson.caps ?? []).find((row) => row.master_id === masterId) ?? null);
    const capFromBounds = deriveShipGrowthCapsFromBounds(masterId, boundsJson.bounds ?? []);
    const merged = mergeShipGrowthCaps(capFromCaps, capFromBounds);
    const result: ShipGrowthCapLookup = { cap: merged, updatedAtIso: typeof boundsJson.updated_at_iso === "string" ? boundsJson.updated_at_iso : null };
    _shipGrowthCapsCache.set(masterId, result);
    return result;
  } catch {
    _shipGrowthCapsCache.set(masterId, null);
    return null;
  }
}

type SideFilter = "ally" | "enemy" | "all";
function filterShipsBySide(ships: MstShipData[], sideFilter: SideFilter): MstShipData[] {
  if (sideFilter === "all") return ships;
  if (sideFilter === "enemy") return ships.filter((s) => s.id >= ENEMY_ID_THRESHOLD);
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
    return canAssignShipWithoutWorseningCombinedRules(combinedType, fleet1, fleet2, fleetIndex, shipSlotIndex, ship.id);
  });
}

// --- Component ---
export function ShipSelectionModal() {
  let dialogRef!: HTMLDialogElement;
  let vlistRef: any;
  const masterDataStatus = useStore(masterDataStatusStore);

  const [search, setSearch] = createSignal("");
  const [sideFilter, setSideFilter] = createSignal<SideFilter>(getShipModalSideFilter());
  const [stypeFilter, setStypeFilter] = createSignal("");
  const [source, setSource] = createSignal<"snapshot" | "master">(getShipModalSource());
  const [hoveredShipId, setHoveredShipId] = createSignal<number | null>(null);

  // Sync state when opened
  createEffect(() => {
    if (shipModalTrigger() > 0) {
      setSearch("");
      setStypeFilter("");
      setSideFilter(getShipModalSideFilter());
      setSource(hasSnapshotShips() ? "snapshot" : "master");
      setHoveredShipId(getShipModalCurrentId() ?? null);
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

  const closeModal = () => {
    if (dialogRef && dialogRef.open) dialogRef.close();
  };

  const stypeOptions = createMemo(() => {
    masterDataStatus();
    shipModalTrigger();
    const stypes = new Set<number>();
    for (const s of filterShipsBySide(Object.values(getMasterShips()), sideFilter())) {
      if (s.stype >= 1 && s.stype <= 22) stypes.add(s.stype);
    }
    return [...stypes].sort((a, b) => a - b);
  });

  const filteredShips = createMemo(() => {
    masterDataStatus();
    shipModalTrigger();
    if (!hasMasterData()) return [];
    let ships: MstShipData[];
    if (source() === "snapshot" && hasSnapshotShips()) {
      const variantMap = new Map<string, any>();
      for (const ss of Object.values(getSnapshotShips())) {
        const key = `${ss.shipId}_${ss.level ?? 0}`;
        const existing = variantMap.get(key);
        if (existing) existing.count++;
        else variantMap.set(key, { ...ss, count: 1 });
      }
      ships = [...variantMap.values()]
        .map((v) => {
          const mst = getMasterShip(v.shipId);
          if (!mst) return null;
          return { ...mst, _snapshotLevel: v.level, _snapshotCount: v.count };
        })
        .filter((s): s is any => s != null)
        .sort((a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id));
    } else {
      ships = Object.values(getMasterShips()).sort((a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id));
    }
    ships = filterShipsBySide(ships, sideFilter());
    ships = filterShipsByCombinedRules(ships);
    if (stypeFilter()) {
      const st = parseInt(stypeFilter(), 10);
      ships = ships.filter((s) => s.stype === st);
    }
    if (search()) {
      const q = search().toLowerCase();
      ships = ships.filter((s) => s.name.toLowerCase().includes(q) || String(s.id).includes(q));
    }
    return ships;
  });

  const listData = createMemo(() => {
    const ships = filteredShips();
    const rows: any[] = [];
    let catOffsets: { stype: number; offset: number }[] = [];
    let virtualOffset = 0;
    const filter = stypeFilter();

    // Clear selection row if needed
    const currentId = getShipModalCurrentId();

    if (!filter) {
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
    }
    return { rows, catOffsets, currentId };
  });

  const activeRowIndex = createMemo(() => {
    const data = listData();
    if (data.currentId == null) return -1;
    return data.rows.findIndex(r => r.kind === "item" && r.ship.id === data.currentId);
  });

  const handleSelect = (ship: MstShipData) => {
    if (isWorkspaceReadOnly()) return;
    consumeShipModalCallback({ id: ship.id, level: (ship as any)._snapshotLevel });
    closeModal();
  };

  const handleClear = () => {
    if (isWorkspaceReadOnly()) return;
    consumeShipModalCallback({ id: null, level: null });
    closeModal();
  };

  return (
    <dialog
      id="ship-select-modal"
      ref={dialogRef}
      class="modal modal-bottom sm:modal-middle z-1200"
      onClose={() => setHoveredShipId(null)}
    >
      <div class="modal-box max-w-5xl w-[95vw] h-[85vh] sm:h-[80vh] max-h-[800px] p-0 flex flex-col rounded-t-2xl sm:rounded-xl relative z-1201">
        <div class="px-5 pt-4 pb-3 border-b border-base-200 shrink-0">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-bold text-lg">艦を選択</h3>
            <form method="dialog">
              <button class="btn btn-ghost btn-sm btn-circle">✕</button>
            </form>
          </div>
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="名前・IDで検索..."
              class="input input-bordered input-sm flex-1"
              autocomplete="off"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
            <select
              class="select select-bordered select-sm w-28 sm:w-32"
              value={sideFilter()}
              onChange={(e) => {
                setSideFilter(e.currentTarget.value as SideFilter);
                setShipModalSideFilter(e.currentTarget.value as SideFilter);
              }}
            >
              <option value="ally">味方のみ</option>
              <option value="enemy">敵のみ</option>
              <option value="all">全て</option>
            </select>
            <select
              class="select select-bordered select-sm w-32 sm:w-36"
              value={stypeFilter()}
              onChange={(e) => setStypeFilter(e.currentTarget.value)}
            >
              <option value="">全艦種</option>
              <For each={stypeOptions()}>
                {(st) => <option value={st}>{STYPE_NAMES[st] ?? `Type ${st}`}</option>}
              </For>
            </select>
          </div>
          <Show when={hasSnapshotShips()}>
            <div class="tabs tabs-boxed mt-2">
              <button
                class={`tab tab-sm ${source() === "snapshot" ? "tab-active" : ""}`}
                onClick={() => { setSource("snapshot"); setShipModalSource("snapshot"); }}
              >スナップショット</button>
              <button
                class={`tab tab-sm ${source() === "master" ? "tab-active" : ""}`}
                onClick={() => { setSource("master"); setShipModalSource("master"); }}
              >マスターデータ</button>
            </div>
          </Show>
        </div>
        
        <div class="flex flex-1 min-h-0">
          <div class="w-20 overflow-y-auto border-r border-base-200 bg-base-200/20 shrink-0 hidden sm:block hide-scrollbar">
             <For each={listData().catOffsets}>
               {(cat) => (
                 <button
                   class="w-full text-left px-2 py-1.5 text-[11px] leading-tight hover:bg-primary/10 active:bg-primary/15 transition-colors text-base-content/60 hover:text-base-content"
                   title={STYPE_NAMES[cat.stype] ?? `Type ${cat.stype}`}
                   onClick={() => {
                     // Virtua scroll To offset or index. VList scrollToIndex is easier.
                     const targetIdx = listData().rows.findIndex(r => r.kind === 'header' && r.stype === cat.stype);
                     if (targetIdx >= 0 && vlistRef) vlistRef.scrollToIndex(targetIdx);
                   }}
                 >
                   {STYPE_SHORT[cat.stype] ?? STYPE_NAMES[cat.stype] ?? `${cat.stype}`}
                 </button>
               )}
             </For>
          </div>

          <div class="relative flex-1 p-2 sm:p-3 flex flex-col min-h-0 overflow-hidden">
             <Show when={getShipModalCurrentId() != null}>
               <div
                  class="shrink-0 flex items-center gap-2 px-3 py-2 mb-1 rounded-lg cursor-pointer bg-error/5 hover:bg-error/10 text-error/70 hover:text-error transition-colors text-sm"
                  style={isWorkspaceReadOnly() ? "opacity: 0.5; pointer-events: none" : ""}
                  onClick={handleClear}
               >
                 ✕ 選択を解除
               </div>
             </Show>
             <Show when={listData().rows.length === 0}>
                <p class="text-sm text-base-content/30 text-center py-12">該当する艦が見つかりません</p>
             </Show>
             <div id="ship-modal-grid" class="flex-1 min-h-0 overflow-hidden">
               <VList
                 data={listData().rows}
                 ref={vlistRef}
                 style={{ height: "100%" }}
                 class="overflow-x-hidden"
               >
                 {(row: any) => {
                   if (row.kind === "header") {
                     return (
                       <div class="bg-base-100/90 backdrop-blur-sm px-2 text-xs font-bold text-base-content/50 border-b border-base-200/50 flex items-center" style={{ height: `${HEADER_HEIGHT}px` }}>
                         {STYPE_NAMES[row.stype] ?? `Type ${row.stype}`}
                       </div>
                     );
                   }
                   const ship = row.ship;
                   const isSelected = ship.id === getShipModalCurrentId();
                   return (
                     <div style={{ height: `${SHIP_ROW_PITCH}px`, display: "flex", "align-items": "center", "box-sizing": "border-box" }}>
                       <div
                         class={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors min-w-0 ${isSelected ? "bg-primary/15 ring-1 ring-primary/30" : "hover:bg-primary/8 active:bg-primary/15"}`}
                         onMouseEnter={() => setHoveredShipId(ship.id)}
                         onClick={() => handleSelect(ship)}
                       >
                         <div class="w-[72px] h-7 bg-base-200 rounded overflow-hidden shrink-0">
                           <img src={bannerUrl(ship.id, { f: "auto" })} alt={ship.name} class="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display='none'; }} />
                         </div>
                         <div class="min-w-0 flex-1 overflow-hidden">
                           <div class="text-sm font-medium truncate leading-tight">{ship.name}</div>
                           <div class="grid grid-cols-[minmax(0,1fr)_3.1rem_2.4rem] items-center gap-0.5 text-[11px] text-base-content/40 leading-tight">
                             <span class="truncate">{STYPE_NAMES[ship.stype] ?? ""} #{ship.id}</span>
                             <span class={`text-right font-mono ${ship._snapshotLevel ? "text-teal-700 font-bold" : "text-base-content/30"}`}>
                               {ship._snapshotLevel ? `Lv${ship._snapshotLevel}` : ""}
                             </span>
                             <span class={`text-right font-mono ${ship._snapshotCount > 1 ? "font-bold text-base-content/60" : "text-base-content/30"}`}>
                               {ship._snapshotCount > 1 ? `×${ship._snapshotCount}` : ""}
                             </span>
                           </div>
                         </div>
                         <div class="w-[5.2rem] shrink-0 flex items-center justify-end gap-0.5 whitespace-nowrap overflow-hidden text-right">
                           <Show when={(ship.houg?.[0] ?? 0) > 0}><span class="text-[10px] px-1 py-0.5 rounded font-mono shrink-0 bg-success/10 text-success">火+{ship.houg[0]}</span></Show>
                           <Show when={(ship.raig?.[0] ?? 0) > 0}><span class="text-[10px] px-1 py-0.5 rounded font-mono shrink-0 bg-success/10 text-success">雷+{ship.raig[0]}</span></Show>
                           <Show when={(ship.tyku?.[0] ?? 0) > 0 && !((ship.houg?.[0] ?? 0) > 0 && (ship.raig?.[0] ?? 0) > 0)}><span class="text-[10px] px-1 py-0.5 rounded font-mono shrink-0 bg-success/10 text-success">空+{ship.tyku[0]}</span></Show>
                         </div>
                       </div>
                     </div>
                   );
                 }}
               </VList>
             </div>
          </div>
          
          <div class="w-72 xl:w-80 overflow-y-auto p-4 bg-base-200/30 border-l border-base-200 hidden md:block">
            <Show when={hoveredShipId()} fallback={<p class="text-sm text-base-content/30 text-center pt-10">艦にカーソルを合わせると<br />詳細が表示されます</p>}>
              {(id) => <ShipDetail ship={getMasterShip(id())!} />}
            </Show>
          </div>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}

function ShipDetail(props: { ship: MstShipData }) {
  const [growthCap, setGrowthCap] = createSignal<ShipGrowthCapLookup | null>(null);
  
  createEffect(() => {
    const s = props.ship;
    const isMasterSource = getShipModalSource() === "master";
    const shouldLookup = !isMasterSource && (needsStatFallback(s.tais) || needsStatFallback(s.kaih) || needsStatFallback(s.saku));
    if (shouldLookup) {
      getShipGrowthCaps(s.id).then(setGrowthCap);
    } else {
      setGrowthCap(null);
    }
  });

  const statValueOrDash = (v: any) => v == null || v === 0 ? "-" : v;
  const statValueWithFallback = (val: any, fallback: any) => {
    if (Array.isArray(val) && val.length > 0 && !needsStatFallback(val)) return String(val[0]);
    if (typeof fallback === "number" && fallback > 0) return `- / ${fallback}`;
    return "-";
  };

  const rangeMap: Record<number, string> = { 0: "無", 1: "短", 2: "中", 3: "長", 4: "超長", 5: "超長+" };

  return (
    <>
      <div class="w-full h-14 bg-base-200 rounded-lg overflow-hidden mb-3">
        <img src={bannerUrl(props.ship.id, { f: "auto" })} class="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      </div>
      <h4 class="font-bold text-lg text-center leading-tight">{props.ship.name}</h4>
      <div class="text-center mb-4 mt-1">
        <span class="badge badge-sm badge-outline gap-1">{STYPE_NAMES[props.ship.stype] ?? "?"} #{props.ship.id}</span>
      </div>
      <div class="divide-y divide-base-200">
        {[
          ["耐久", statValueOrDash(props.ship.taik?.[0])],
          ["装甲", statValueOrDash(props.ship.souk?.[0])],
          ["回避", getShipModalSource() === "master" ? statValueOrDash(props.ship.kaih?.[0]) : statValueWithFallback(props.ship.kaih, growthCap()?.cap?.kaihi_max)],
          ["搭載", props.ship.maxeq ? props.ship.maxeq.slice(0, props.ship.slot_num).reduce((sum, s) => sum + s, 0) : "-"],
          ["速力", SPEED_NAMES[props.ship.soku] ?? String(props.ship.soku)],
          ["射程", props.ship.leng != null ? (rangeMap[props.ship.leng] ?? String(props.ship.leng)) : "-"],
          ["火力", statValueOrDash(props.ship.houg?.[0])],
          ["雷装", statValueOrDash(props.ship.raig?.[0])],
          ["対空", statValueOrDash(props.ship.tyku?.[0])],
          ["対潜", getShipModalSource() === "master" ? statValueOrDash(props.ship.tais?.[0]) : statValueWithFallback(props.ship.tais, growthCap()?.cap?.taisen_max)],
          ["索敵", getShipModalSource() === "master" ? statValueOrDash(props.ship.saku?.[0]) : statValueWithFallback(props.ship.saku, growthCap()?.cap?.sakuteki_max)],
          ["運", statValueOrDash(props.ship.luck?.[0])],
          ["スロット数", props.ship.slot_num],
          ["搭載内訳", props.ship.maxeq ? props.ship.maxeq.slice(0, props.ship.slot_num).join(" / ") : "-"],
        ].map(([label, val]) => (
          <div class="flex justify-between py-1.5 text-sm">
            <span class="text-base-content/50">{label}</span>
            <span class="font-mono text-base-content/80 font-medium">{val}</span>
          </div>
        ))}
      </div>
      <Show when={!((getShipModalSource() === "master")) && growthCap()}>
        <p class="mt-2 text-xs text-base-content/60">対潜/回避/索敵の欠損値は ship-growth データの上限値で補完表示しています。</p>
      </Show>
    </>
  );
}
