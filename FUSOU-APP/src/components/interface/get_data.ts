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
    mst_ships:{
        0: { id: 0, sortno: 0, sort_id: 0, name: "なし", yomi: "なし", stype: 0, ctype: 0, afterlv: 0, aftershipid: "0", taik: [0, 0], souk: [0, 0], houg: [0, 0], raig: [0, 0], tyku: [0, 0], luck: [0, 0], soku: 0, leng: 0, slot_num: 0, maxeq: [0, 0], buildtime: 0, broken: [0, 0], powup: [0, 0], backs: 0, getmes: "入手メッセージ", afterfuel: 0, afterbull: 0, fuel_max: 0, bull_max: 0, voicef: 0, tais: [0, 0] },
        1: { id: 1, sortno: 1, sort_id: 1, name: "駆逐艦", yomi: "くちくかん", stype: 2, ctype: 2, afterlv: 20, aftershipid: "2", taik: [14, 14], souk: [5, 5], houg: [5, 5], raig: [5, 5], tyku: [5, 5], luck: [10, 10], soku: 10, leng: 1, slot_num: 2, maxeq: [1, 1], buildtime: 20, broken: [0, 0], powup: [0, 0], backs: 1, getmes: "入手メッセージ", afterfuel: 20, afterbull: 20, fuel_max: 100, bull_max: 100, voicef: 0, tais: [0, 0] },
        2: { id: 2, sortno: 2, sort_id: 2, name: "軽巡洋艦", yomi: "けいじゅんようかん", stype: 3, ctype: 3, afterlv: 30, aftershipid: "3", taik: [20, 20], souk: [10, 10], houg: [10, 10], raig: [10, 10], tyku: [10, 10], luck: [20, 20], soku: 10, leng: 2, slot_num: 3, maxeq: [2, 2], buildtime: 30, broken: [0, 0], powup: [0, 0], backs: 1, getmes: "入手メッセージ", afterfuel: 30, afterbull: 30, fuel_max: 100, bull_max: 100, voicef: 0, tais: [0, 0] },
        3: { id: 3, sortno: 3, sort_id: 3, name: "重巡洋艦", yomi: "じゅうじゅんようかん", stype: 5, ctype: 5, afterlv: 40, aftershipid: "4", taik: [30, 30], souk: [15, 15], houg: [15, 15], raig: [15, 15], tyku: [15, 15], luck: [30, 30], soku: 10, leng: 3, slot_num: 4, maxeq: [3, 3], buildtime: 40, broken: [0, 0], powup: [0, 0], backs: 1, getmes: "入手メッセージ", afterfuel: 40, afterbull: 40, fuel_max: 100, bull_max: 100, voicef: 0, tais: [0, 0] }
    }
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
    mst_slot_items:{
        0: { id: 0, sortno: 0, name: "なし", _type: [0, 0, 0, 0, 0], taik: 0, souk: 0, houg: 0, raig: 0, soku: 0, baku: 0, tyku: 0, tais: 0, atap: 0, houm: 0, raim: 0, houk: 0, raik: 0, bakk: 0, saku: 0, sakb: 0, luck: 0, leng: 0, rare: 0, broken: [0, 0], usebull: "なし" },
        1: { id: 1, sortno: 1, name: "12.7cm連装砲", _type: [1, 1, 1, 0, 0], taik: 0, souk: 0, houg: 2, raig: 0, soku: 0, baku: 0, tyku: 1, tais: 0, atap: 0, houm: 0, raim: 0, houk: 1, raik: 0, bakk: 0, saku: 0, sakb: 0, luck: 0, leng: 1, rare: 0, broken: [0, 0], usebull: "なし" },
        2: { id: 2, sortno: 2, name: "12.7cm連装砲B型", _type: [1, 1, 1, 0, 0], taik: 0, souk: 0, houg: 2, raig: 0, soku: 0, baku: 0, tyku: 1, tais: 0, atap: 0, houm: 0, raim: 0, houk: 1, raik: 0, bakk: 0, saku: 0, sakb: 0, luck: 0, leng: 1, rare: 0, broken: [0, 0], usebull: "なし" },
    }
};