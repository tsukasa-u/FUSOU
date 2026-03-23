// ── Simulator domain types ──

export interface MstShipData {
  id: number;
  name: string;
  stype: number;
  ctype: number;
  sort_id?: number;
  taik: number[] | null;
  souk: number[] | null;
  houg: number[] | null;
  raig: number[] | null;
  tyku: number[] | null;
  tais: number[] | null;
  kaih?: number[] | null;
  saku?: number[] | null;
  luck: number[] | null;
  soku: number;
  leng: number;
  slot_num: number;
  maxeq: number[] | null;
  /** Runtime-only: snapshot level when displayed in modal */
  _snapshotLevel?: number;
  /** Runtime-only: duplicate count in snapshot */
  _snapshotCount?: number;
}

export interface MstSlotItemData {
  id: number;
  name: string;
  sortno: number;
  type: number[];
  houg: number;
  raig: number;
  tyku: number;
  tais: number;
  baku: number;
  saku: number;
  houm: number;
  souk: number;
  kaih?: number;
  houk?: number;
  luck?: number;
  leng?: number;
  soku?: number;
  distance: number | null;
  /** 迎撃 (Interception) — computed: api_houk when type[2]==48, else 0 */
  geigeki?: number;
  /** 対爆 (Anti-Bomber) — computed: api_houm when type[2]==48, else 0 */
  taibaku?: number;
}

/** api_mst_slotitem_equiptype — equipment category master */
export interface MstSlotItemEquipTypeData {
  id: number;
  name: string;
}

export interface StatOverrides {
  [key: string]: number | undefined;
}

export interface EquipEffect {
  ships: number[];
  b: Record<string, number>;
  l?: Record<string, number>;
  c2?: Record<string, number>;
  c3?: Record<string, number>;
}

export interface CrossEffect {
  ships: number[];
  items: [number, number];
  synergy: Record<string, number>;
}

export interface SlotItemEffectsData {
  effects: Record<string, EquipEffect[]>;
  cross_effects: Record<string, CrossEffect[]>;
}

export interface FleetSlot {
  shipId: number | null;
  shipLevel: number | null;
  equipIds: (number | null)[];
  equipImprovement: number[];
  equipProficiency: number[];
  exSlotId: number | null;
  exSlotImprovement: number;
  statOverrides?: StatOverrides;
  /** Snapshot instance stats (current values including modernization). */
  instanceStats?: Record<string, number>;
}

export interface AirBaseSlot {
  equipIds: (number | null)[];
  equipImprovement: number[];
  equipProficiency: number[];
}

export interface ShipSelection {
  id: number | null;
  level?: number | null;
}

export interface EquipSelection {
  id: number | null;
  level?: number;
  alv?: number;
}

export function emptyFleetSlot(): FleetSlot {
  return {
    shipId: null,
    shipLevel: null,
    equipIds: [null, null, null, null, null],
    equipImprovement: [0, 0, 0, 0, 0],
    equipProficiency: [0, 0, 0, 0, 0],
    exSlotId: null,
    exSlotImprovement: 0,
  };
}

export function emptyAirBase(): AirBaseSlot {
  return {
    equipIds: [null, null, null, null],
    equipImprovement: [0, 0, 0, 0],
    equipProficiency: [0, 0, 0, 0],
  };
}

// ── Master data types for equipment filtering ──

/** api_mst_stype — ship type with default equippable equipment types */
export interface MstStypeData {
  id: number;
  sortno: number;
  name: string;
  /** Keys: equipment type ID (string), Values: 1=allowed, 0=disallowed */
  equip_type: Record<string, number>;
}

/** api_mst_equip_ship — per-ship equipment type overrides */
export interface MstEquipShipData {
  ship_id: number;
  /** Keys: equipment type ID (string), Values: allowed equipment IDs or null */
  equip_type: Record<string, number[] | null>;
}

/** api_mst_equip_exslot — equipment type[2] IDs available for reinforcement expansion slot */
export interface MstEquipExslotData {
  equip: number;
}

/** api_mst_equip_exslot_ship — per-equipment exslot ship restrictions */
export interface MstEquipExslotShipData {
  slotitem_id: number;
  /** Keys: ship IDs (string), Values: 1=allowed */
  ship_ids: Record<string, number> | null;
  /** Keys: ship type IDs (string), Values: 1=allowed */
  stypes: Record<string, number> | null;
  /** Keys: ship class IDs (string), Values: 1=allowed */
  ctypes: Record<string, number> | null;
  req_level: number;
  /** Optional proficiency requirement if provided by upstream master data. */
  req_alv?: number;
}

/** api_mst_equip_limit_exslot — per-ship excluded exslot equipment type[2] IDs */
export interface MstEquipLimitExslotData {
  ship_id: number;
  equip: number[];
}
