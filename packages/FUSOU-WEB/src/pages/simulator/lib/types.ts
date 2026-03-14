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
  return { equipIds: [null, null, null, null], equipImprovement: [0, 0, 0, 0], equipProficiency: [0, 0, 0, 0] };
}
