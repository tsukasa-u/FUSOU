export interface Cells {
    maparea_id: number,
    mapinfo_no: number,
    bosscell_no: number,
    bosscomp: number,
    cells: {[key: number]: Cell},
    cell_index: number[],
    event_map?: Eventmap,
    cell_data: CellData[],
}

export interface Cell {
    rashin_id: number,
    no: number,
    color_no: number,
    event_id: number,
    event_kind: number,
    next: number,
    e_deck_info?: EDeckInfo[],
    limit_state: number,
    m1?: number,
    destruction_battle?: DestructionBattle,
    happening?: Happening,
}

export interface CellData {
    id: number,
    no: number,
    color_no: number,
    passed: number,
    distance?: number,
}

export interface Eventmap {
    max_maphp: number,
    now_maphp: number,
    dmg: number,
}

export interface Happening {
    count: number,
    mst_id: number,
    dentan: number,
}

export interface EDeckInfo {
    kind: number,
    ship_ids: number[],
}

export interface DestructionBattle {
    formation: number[],
    ship_ke: number[],
    e_nowhps: number[],
    e_maxhps: number[],
    e_slot: number[][],
    f_nowhps: number[],
    f_maxhps: number[],
    // Need to implement 
    // air_base_attack: ApiAirBaseAttack,
}

export var global_cells: Cells = {
    maparea_id: 0,
    mapinfo_no: 0,
    bosscell_no: 0,
    bosscomp: 0,
    cells: {},
    cell_index: [],
    cell_data: [],
}