export interface MstShip {
    id: number,
    sortno: number,
    sort_id: number,
    name: string,
    yomi: string,
    stype: number,
    ctype: number,
    afterlv: number,
    aftershipid: string,
    taik: number[],
    souk: number[],
    houg: number[],
    raig: number[],
    tyku: number[],
    luck: number[],
    soku: number,
    leng: number,
    slot_num: number,
    maxeq: number[],
    buildtime: number,
    broken: number[],
    powup: number[],
    backs: number,
    getmes: string,
    afterfuel: number,
    afterbull: number,
    fuel_max: number,
    bull_max: number,
    voicef: number,
    tais: number[]
}

export interface MstShips {
    mst_ships: { [key: number]: MstShip }
}

export var global_mst_ships: MstShips = {
    mst_ships: {}
};

export interface MstSlotitem {
    id: number,
    sortno: number,
    name: string,
    _type: number[], // length: 5
    taik: number,
    souk: number,
    houg: number,
    raig: number,
    soku: number,
    baku: number,
    tyku: number,
    tais: number,
    atap: number,
    houm: number,
    raim: number,
    houk: number,
    raik: number,
    bakk: number,
    saku: number,
    sakb: number,
    luck: number,
    leng: number,
    rare: number,
    broken: number[],
    usebull: string,
    version?: number,
    cost?: number,
    distance?: number,
}

export interface MstSlotitems {
    mst_slot_items: { [key: number]: MstSlotitem }
}

export var global_mst_slot_items: MstSlotitems = {
    mst_slot_items: {}
};

export interface MstEquipExslotShip {
    ship_ids: { [key: string]: number },
    stypes: { [key: string]: number },
    ctypes: { [key: string]: number },
    req_level: number,
}

export interface MstEquipExslotShips {
    mst_equip_exslot_ships: { [key: number]: number }
}