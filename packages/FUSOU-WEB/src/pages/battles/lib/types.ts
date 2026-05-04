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
  nowhp: number;
  maxhp: number;
  karyoku: unknown;
  raisou: unknown;
  taiku: unknown;
  soukou: unknown;
  bannerUrl: string;
  equipments: EquipmentInfo[];
}

export interface WeaponIconFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BattleFleets {
  friendlyShips: ShipInfo[];
  enemyShips: ShipInfo[];
}

export interface TimelineEvent {
  phase: string;
  type: string;
  attackerSide: "friend" | "enemy";
  attackerIdx: number | null;
  attackerGroup?: number[];
  defenderSide: "friend" | "enemy";
  defenderIdx: number | null;
  damage: number;
  crit: boolean;
  sunk: boolean;
  slotItems: unknown[];
  fHps: number[];
  eHps: number[];
  /**
   * mst_ship ID of the attacker, used when the attacker is not in the main
   * fleet arrays (friendly force ships, support ships, etc.).
   */
  attackerMstShipId?: number;
  /** If true, this event is a phase separator (blank row between phases). */
  separator?: boolean;
}

export interface TimelineStep {
  fHps: number[];
  eHps: number[];
  eventIdx: number;
}
