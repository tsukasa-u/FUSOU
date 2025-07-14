import type { AirDamage, Battle } from "./battle";

export interface Cells {
  maparea_id: number;
  mapinfo_no: number;
  bosscell_no: number;
  bosscomp: number;
  cells: { [key: number]: Cell };
  cell_index: number[];
  event_map?: Eventmap;
  cell_data: CellData[];
  // timestamp: number,
  battles: { [key: number]: Battle };
}

export interface Cell {
  rashin_id: number;
  no: number;
  color_no: number;
  event_id: number;
  event_kind: number;
  next: number;
  e_deck_info?: EDeckInfo[];
  limit_state: number;
  m1?: number;
  destruction_battle?: DestructionBattle;
  happening?: Happening;
}

export interface CellData {
  id: number;
  no: number;
  color_no: number;
  passed: number;
  distance?: number;
}

export interface Eventmap {
  max_maphp: number;
  now_maphp: number;
  dmg: number;
}

export interface Happening {
  count: number;
  mst_id: number;
  dentan: number;
}

export interface EDeckInfo {
  kind: number;
  ship_ids: number[];
}

export interface DestructionBattle {
  formation: number[];
  ship_ke: number[];
  ship_lv: number[];
  e_nowhps: number[];
  e_maxhps: number[];
  e_slot: number[][];
  f_nowhps: number[];
  f_maxhps: number[];
  air_base_attack: ApiAirBaseAttack;
  lost_kind: number;
  f_total_damages: number[] | null;
  e_total_damages: number[] | null;
}

export interface ApiAirBaseAttack {
  air_superiority: number | null;
  stage_flag: number[];
  squadron_plane: (number | null)[] | null;
  f_damage: AirDamage;
  e_damage: AirDamage;
  map_squadron_plane: { [key: string]: number[] } | null;
}

export const default_cells: Cells = {
  maparea_id: 0,
  mapinfo_no: 0,
  bosscell_no: 0,
  bosscomp: 0,
  cells: {},
  cell_index: [],
  cell_data: [],
  battles: {},
  // timestamp: 0,
};
