// ── Shared mutable application state ──
// All runtime state that was previously module-scoped `let` variables.
// Exported as a single object so modules can read/write the same values.

import type {
  MstShipData,
  MstSlotItemData,
  MstSlotItemEquipTypeData,
  SlotItemEffectsData,
  FleetSlot,
  AirBaseSlot,
  MstStypeData,
  MstEquipShipData,
  MstEquipExslotShipData,
  MstEquipLimitExslotData,
} from "./types";
import { emptyFleetSlot, emptyAirBase } from "./types";

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
  airBases: Array.from({ length: 3 }, emptyAirBase) as AirBaseSlot[],

  // Modal callbacks and state
  shipModalCb: null as ((id: number | null) => void) | null,
  equipModalCb: null as ((id: number | null) => void) | null,
  shipModalCurrentId: null as number | null,
  equipModalCurrentId: null as number | null,
  shipModalSource: "master" as "snapshot" | "master",
  equipModalSource: "master" as "snapshot" | "master",
  shipModalSideFilter: "ally" as "ally" | "enemy" | "all",
  equipModalSideFilter: "ally" as "ally" | "enemy" | "all",

  // Equipment modal target context
  equipModalTargetShipId: null as number | null,
  equipModalTargetSlot: null as FleetSlot | null,
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

  // Equipment filtering master data
  /** stype id → equip_type map (default allowed equip types per ship type) */
  mstStypes: {} as Record<number, MstStypeData>,
  /** Set of equipment IDs allowed in exslot */
  equipExslotSet: new Set<number>() as Set<number>,
  /** ship_id → per-ship equipment type overrides */
  mstEquipShip: {} as Record<number, MstEquipShipData>,
  /** equip_id → exslot ship restrictions */
  mstEquipExslotShip: {} as Record<number, MstEquipExslotShipData>,
  /** ship_id → exslot equipment limits */
  mstEquipLimitExslot: {} as Record<number, MstEquipLimitExslotData>,
};
