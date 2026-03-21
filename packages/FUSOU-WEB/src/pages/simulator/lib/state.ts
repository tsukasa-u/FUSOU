// ── Shared mutable application state ──
// All runtime state that was previously module-scoped `let` variables.
// Exported as a single object so modules can read/write the same values.

import { atom } from "nanostores";

import type {
  AirBaseSlot,
  FleetSlot,
  MstShipData,
  MstSlotItemData,
  MstSlotItemEquipTypeData,
  SlotItemEffectsData,
  ShipSelection,
  EquipSelection,
  MstStypeData,
  MstEquipShipData,
  MstEquipExslotShipData,
  MstEquipLimitExslotData,
} from "./types";
import { emptyFleetSlot, emptyAirBase } from "./types";

// Cross-framework reactive revision stores.
// Any runtime state mutation should call `markSimulatorStateDirty`.
export type SimulatorDirtyScope = "fleet" | "airbase" | "all";

export const simulatorFleetRevision = atom(0);
export const simulatorAirbaseRevision = atom(0);
export const simulatorReadOnly = atom(false);
export const simulatorFleetState = atom({
  fleet1: [] as FleetSlot[],
  fleet2: [] as FleetSlot[],
  fleet3: [] as FleetSlot[],
  fleet4: [] as FleetSlot[],
});
export const simulatorAirbaseState = atom([] as AirBaseSlot[]);

function cloneFleetSlot(slot: FleetSlot): FleetSlot {
  return {
    ...slot,
    equipIds: [...slot.equipIds],
    equipImprovement: [...slot.equipImprovement],
    equipProficiency: [...slot.equipProficiency],
    statOverrides: slot.statOverrides ? { ...slot.statOverrides } : undefined,
    instanceStats: slot.instanceStats ? { ...slot.instanceStats } : undefined,
  };
}

function cloneAirBaseSlot(base: AirBaseSlot): AirBaseSlot {
  return {
    ...base,
    equipIds: [...base.equipIds],
    equipImprovement: [...base.equipImprovement],
    equipProficiency: [...base.equipProficiency],
  };
}

function snapshotFleetState() {
  return {
    fleet1: state.fleet1.map(cloneFleetSlot),
    fleet2: state.fleet2.map(cloneFleetSlot),
    fleet3: state.fleet3.map(cloneFleetSlot),
    fleet4: state.fleet4.map(cloneFleetSlot),
  };
}

function snapshotAirbaseState() {
  return state.airBases.map(cloneAirBaseSlot);
}

let dirtyQueued = false;
let pendingFleetDirty = false;
let pendingAirbaseDirty = false;
// When bulkLoadDepth > 0, dirty notifications are suppressed and coalesced
// into a single "all" notification emitted by endBulkLoad().
let bulkLoadDepth = 0;
let bulkPendingFleet = false;
let bulkPendingAirbase = false;

/**
 * Suppress individual dirty notifications during bulk data loads (e.g. loading
 * master data from R2/JSON). Calls can be nested; the outermost endBulkLoad()
 * fires the final consolidated notification.
 */
export function beginBulkLoad(): void {
  bulkLoadDepth++;
}

export function endBulkLoad(scope: SimulatorDirtyScope = "all"): void {
  if (bulkLoadDepth > 0) bulkLoadDepth--;

  if (scope === "fleet" || scope === "all") bulkPendingFleet = true;
  if (scope === "airbase" || scope === "all") bulkPendingAirbase = true;

  if (bulkLoadDepth === 0) {
    const fs = bulkPendingFleet;
    const as = bulkPendingAirbase;
    bulkPendingFleet = false;
    bulkPendingAirbase = false;
    if (fs) markSimulatorStateDirty("fleet");
    if (as) markSimulatorStateDirty("airbase");
  }
}

export function markSimulatorStateDirty(scope: SimulatorDirtyScope = "all"): void {
  // During a bulk load, accumulate the scope but don't trigger a rerender yet.
  if (bulkLoadDepth > 0) {
    if (scope === "fleet" || scope === "all") bulkPendingFleet = true;
    if (scope === "airbase" || scope === "all") bulkPendingAirbase = true;
    return;
  }

  if (scope === "fleet" || scope === "all") pendingFleetDirty = true;
  if (scope === "airbase" || scope === "all") pendingAirbaseDirty = true;

  if (dirtyQueued) return;
  dirtyQueued = true;
  queueMicrotask(() => {
    dirtyQueued = false;

    if (pendingFleetDirty) {
      pendingFleetDirty = false;
      simulatorFleetState.set(snapshotFleetState());
      simulatorFleetRevision.set(simulatorFleetRevision.get() + 1);
    }
    if (pendingAirbaseDirty) {
      pendingAirbaseDirty = false;
      simulatorAirbaseState.set(snapshotAirbaseState());
      simulatorAirbaseRevision.set(simulatorAirbaseRevision.get() + 1);
    }
  });
}

export function onSimulatorStateDirty(cb: () => void): () => void;
export function onSimulatorStateDirty(scope: SimulatorDirtyScope | SimulatorDirtyScope[], cb: () => void): () => void;
export function onSimulatorStateDirty(
  scopeOrCb: SimulatorDirtyScope | SimulatorDirtyScope[] | (() => void),
  maybeCb?: () => void,
): () => void {
  const cb = typeof scopeOrCb === "function" ? scopeOrCb : maybeCb;
  if (!cb) return () => {};

  const scopes = typeof scopeOrCb === "function"
    ? ["fleet", "airbase"] as SimulatorDirtyScope[]
    : Array.isArray(scopeOrCb)
      ? scopeOrCb
      : [scopeOrCb];

  const unsubscribers: Array<() => void> = [];
  if (scopes.includes("fleet") || scopes.includes("all")) {
    unsubscribers.push(simulatorFleetRevision.subscribe(() => cb()));
  }
  if (scopes.includes("airbase") || scopes.includes("all")) {
    unsubscribers.push(simulatorAirbaseRevision.subscribe(() => cb()));
  }

  return () => {
    unsubscribers.forEach((unsub) => unsub());
  };
}

export const state = {
  // Master data
  mstShips: {} as Record<number, MstShipData>,
  mstSlotItems: {} as Record<number, MstSlotItemData>,
  mstSlotItemEquipTypes: {} as Record<number, MstSlotItemEquipTypeData>,
  hasMasterData: false,

  // Equipment bonus / synergy data
  slotItemEffects: null as SlotItemEffectsData | null,

  // Weapon icon sprite sheet
  weaponIconFrames: {} as Record<number, [number, number, number, number]>,
  spriteSheetW: 0,
  spriteSheetH: 0,
  spriteSheetUrl: "",

  // Asset URL maps
  bannerMap: {} as Record<string, string>,
  cardMap: {} as Record<string, string>,
  assetBaseUrl: "",
  equipCardMap: {} as Record<string, string>,
  equipItemUpMap: {} as Record<string, string>,

  // Fleet state
  fleet1: Array.from({ length: 6 }, emptyFleetSlot) as FleetSlot[],
  fleet2: Array.from({ length: 6 }, emptyFleetSlot) as FleetSlot[],
  fleet3: Array.from({ length: 6 }, emptyFleetSlot) as FleetSlot[],
  fleet4: Array.from({ length: 6 }, emptyFleetSlot) as FleetSlot[],
  fleetSectionVisible: {
    1: true,
    2: true,
    3: false,
    4: false,
  } as Record<number, boolean>,
  airbaseSectionVisible: true,
  visibleAirbaseCount: 3,
  airBases: Array.from({ length: 3 }, emptyAirBase) as AirBaseSlot[],

  // Modal callbacks and state
  shipModalCb: null as ((selection: ShipSelection) => void) | null,
  equipModalCb: null as ((selection: EquipSelection) => void) | null,
  shipModalCurrentId: null as number | null,
  equipModalCurrentId: null as number | null,
  shipModalSource: "master" as "snapshot" | "master",
  equipModalSource: "master" as "snapshot" | "master",
  shipModalSideFilter: "ally" as "ally" | "enemy" | "all",
  equipModalSideFilter: "ally" as "ally" | "enemy" | "all",

  // Ship modal target context
  shipModalTargetFleetIndex: null as 1 | 2 | 3 | 4 | null,
  shipModalTargetShipSlotIndex: null as number | null,

  // Equipment modal target context
  equipModalTargetKind: null as "fleet" | "airbase" | null,
  equipModalTargetFleetIndex: null as 1 | 2 | 3 | 4 | null,
  equipModalTargetShipSlotIndex: null as number | null,
  equipModalTargetAirBaseIndex: null as number | null,
  equipModalTargetSlotIdx: -1,

  // Snapshot data
  snapshotShips: {} as Record<
    number,
    { shipId: number; level: number; name: string; stype: number }
  >,
  snapshotSlotItems: {} as Record<
    number,
    { slotitem_id: number; level: number; alv: number }
  >,

  // UI guard: true when active workspace entry is locked and edits must be blocked.
  isWorkspaceReadOnly: false,

  // Equipment filtering master data
  /** stype id → equip_type map (default allowed equip types per ship type) */
  mstStypes: {} as Record<number, MstStypeData>,
  /** Set of equipment type[2] IDs allowed in exslot */
  equipExslotSet: new Set<number>() as Set<number>,
  /** ship_id → per-ship equipment type overrides */
  mstEquipShip: {} as Record<number, MstEquipShipData>,
  /** equip_id → exslot ship restrictions */
  mstEquipExslotShip: {} as Record<number, MstEquipExslotShipData>,
  /** ship_id → excluded exslot equipment type[2] IDs */
  mstEquipLimitExslot: {} as Record<number, MstEquipLimitExslotData>,
};

// Keep atom-backed UI guard aligned with initial mutable state snapshot.
simulatorReadOnly.set(state.isWorkspaceReadOnly);
simulatorFleetState.set(snapshotFleetState());
simulatorAirbaseState.set(snapshotAirbaseState());
