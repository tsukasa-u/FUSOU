export interface EquipmentInfo {
  name: string;
  level: number | null;
  iconType: number | null;
  slotItemId: number | null;
}

export interface ShipInfo {
  name: string;
  shipId: number | null;
  level: number | null;
  nowhp: number | null;
  maxhp: number | null;
  karyoku: number | null;
  raisou: number | null;
  taiku: number | null;
  soukou: number | null;
  bannerUrl: string;
  equipments: EquipmentInfo[];
}

export interface WeaponIconFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MstShipRecord {
  id: number;
  name?: string;
  [field: string]: unknown;
}

export interface MstSlotItemRecord {
  id: number;
  name?: string;
  type?: number[];
  [field: string]: unknown;
}

export interface BattleFleets {
  friendlyShips: ShipInfo[];
  enemyShips: ShipInfo[];
}

export interface TimelineEvent {
  phase: string;
  type: string;
  actorRole?: "main" | "airbase" | "support" | "friendly_force";
  affectsHp?: boolean;
  attackerSide: "friend" | "enemy";
  attackerIdx: number | null;
  attackerGroup?: number[];
  attackerNowHp?: number | null;
  attackerMaxHp?: number | null;
  defenderSide: "friend" | "enemy";
  defenderIdx: number | null;
  damage: number;
  crit: boolean;
  sunk: boolean;
  slotItems: number[];
  fHps: Array<number | null>;
  eHps: Array<number | null>;
  /**
   * mst_ship ID of the attacker, used when the attacker is not in the main
   * fleet arrays (friendly force ships, support ships, etc.).
   */
  attackerMstShipId?: number;
  /** If true, this event is a phase separator (blank row between phases). */
  separator?: boolean;
  /** Air-attack invocation group id (one extractAirAttackEvents call). */
  airBatchId?: number;
}

export interface TimelineStep {
  fHps: Array<number | null>;
  eHps: Array<number | null>;
  eventIdx: number;
}
