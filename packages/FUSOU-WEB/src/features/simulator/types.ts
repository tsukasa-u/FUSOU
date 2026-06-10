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

/** Single-item bonus rule: many items sharing the same (ships, bonus_profile) grouped together. */
export interface EffectRule {
  ships: number[];
  b: Record<string, number>;
  l?: Record<string, number>;
  /** Improvement-level transition list: [[starLevel, bonus], ...]. */
  i?: Array<[number, Record<string, number>]>;
  c2?: Record<string, number>;
  c3?: Record<string, number>;
  /** Item IDs that share this exact (ships, profile) combination. */
  items: number[];
}

/** Cross-item (pairwise) synergy rule: many pairs sharing the same (ships, synergy) grouped together. */
export interface CrossRule {
  ships: number[];
  synergy: Record<string, number>;
  /** Pairs [[a,b], ...] sharing this ships+synergy (a < b). */
  pairs: [number, number][];
}

/** Base for triple/quad/penta/hexa rules. Combos are stored either as item_pool
 *  (when all C(|pool|, combo_size) are present — the dominant case), as
 *  fixed_items + free_pool (when some items appear in every combo), or as explicit
 *  combos for partial/irregular patterns. */
interface MultiItemRule {
  ships: number[];
  synergy: Record<string, number>;
  /** All C(item_pool.length, combo_size) combinations share this ships+synergy.
   *  At runtime: apply synergy × C(overlap, combo_size) times where overlap is
   *  the count of item_pool members present in the equipped set. */
  item_pool?: number[];
  /** Fixed-item encoding: every combo contains all fixed_items plus exactly
   *  (combo_size - fixed_items.length) distinct items from free_pool.
   *  Combos are all C(free_pool.length, combo_size - fixed_items.length).
   *  At runtime: match if all fixed_items are equipped AND overlap from free_pool
   *  ≥ (combo_size - fixed_items.length); apply synergy × C(overlap, needed) times. */
  fixed_items?: number[];
  free_pool?: number[];
  /** Compact encoding for partial patterns: base64 of Uint8Array where each
   *  group of comboSize bytes is one combo encoded as indices into items[].
   *  items.length must be < 256. Decoded once and cached at runtime. */
  items?: number[];
  combos_b64?: string;
  /** Same as combos_b64 but with Uint16 local indices (items.length < 65536). */
  combos_u16_b64?: string;
  /** Same as combos_b64 but with Uint32 local indices. */
  combos_u32_b64?: string;
  /** Gzip-compressed local-index bytes encoded as base64. */
  combos_gz_b64?: string;
  /** Codec used for combos_gz_b64 payload. */
  combos_codec?: "u8" | "u16" | "u32";
  /** Explicit combos (fallback for items.length ≥ 256, extremely rare). */
  combos?: number[][];
  category_pools?: number[][];
  cancels_single?: boolean;
  implicants?: number[][][];
}

export interface TripleRule extends MultiItemRule {
  combos?: [number, number, number][];
  implicants?: number[][][];
}
export interface QuadRule extends MultiItemRule {
  combos?: [number, number, number, number][];
}
export interface PentaRule extends MultiItemRule {
  combos?: [number, number, number, number, number][];
}
export interface HexaRule extends MultiItemRule {
  combos?: [number, number, number, number, number, number][];
}

/** One speed observation entry: when this ship had item_ids equipped,
 *  the observed in-game speed was soku_observed.
 *  item_ids is the sorted array of non-zero slotitem_ids (slots + exslot). */
export interface SokuSpeedObs {
  soku_observed: number;
  item_ids: number[];
}

/** Speed observations keyed by master_id. Loaded from /api/soku-speed-observed/speed-upgrade. */
export type SokuSpeedData = Record<number, SokuSpeedObs[]>;

// Legacy compatibility aliases.
export type SokuLengSpeedObs = SokuSpeedObs;
export type SokuLengSpeedData = SokuSpeedData;

export interface SlotItemEffectsMeta {
  period_tag: string;
  period_revision: number;
  completed_at: number | null;
  source?: string | null;
  generator_version?: string | null;
  table_version?: string | null;
}

export interface SlotItemEffectsData {
  /** Single-item bonus rules grouped by (ships, profile). Replaces per-item effects dict. */
  effect_rules?: EffectRule[];
  /** Pairwise synergy rules grouped by (ships, synergy). Replaces per-pair cross_effects dict. */
  cross_rules?: CrossRule[];
  /** 3-item cross-synergy correction rules. */
  triple_rules?: TripleRule[];
  /** 4-item cross-synergy correction rules. */
  quad_rules?: QuadRule[];
  /** 5-item cross-synergy correction rules (for ships with ≥5 effective slots). */
  penta_rules?: PentaRule[];
  /** 6-item cross-synergy correction rules (for ships with 5+1 effective slots). */
  hexa_rules?: HexaRule[];
  /** Legacy: keyed by itemId — kept for backward-compat with server routes. */
  effects?: Record<string, EquipEffect[]>;
  /** Legacy: keyed by "a:b" pair — kept for backward-compat with server routes. */
  cross_effects?: Record<string, CrossEffect[]>;
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
export interface MstEquipShipNormalSlotTypeRestrictionData {
  slot_index?: number;
  min_slot_index?: number;
  mode: "exclude" | "allow-only";
  type_ids: number[];
}

export interface MstEquipShipData {
  ship_id: number;
  /** Keys: equipment type ID (string), Values: allowed equipment IDs or null */
  equip_type: Record<string, number[] | null>;
  /**
   * Optional per-slot restrictions for normal slots.
   * Not present in current canonical KC masters, but supported for
   * project-side enriched datasets to replace builtin exceptions.
   */
  normal_slot_type_restrictions?: MstEquipShipNormalSlotTypeRestrictionData[];
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
