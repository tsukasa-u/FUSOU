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
        1: { id: 1, sortno: 1, sort_id: 1, name: "駆逐艦", yomi: "くちくかん", stype: 2, ctype: 2, afterlv: 20, aftershipid: "2", taik: [14, 14], souk: [5, 5], houg: [5, 5], raig: [5, 5], tyku: [5, 5], luck: [10, 10], soku: 10, leng: 1, slot_num: 2, maxeq: [1, 1], buildtime: 20, broken: [0, 0], powup: [0, 0], backs: 1, getmes: "入手メッセージ", afterfuel: 20, afterbull: 20, fuel_max: 100, bull_max: 100, voicef: 0, tais: [0, 0] },
        2: { id: 2, sortno: 2, sort_id: 2, name: "軽巡洋艦", yomi: "けいじゅんようかん", stype: 3, ctype: 3, afterlv: 30, aftershipid: "3", taik: [20, 20], souk: [10, 10], houg: [10, 10], raig: [10, 10], tyku: [10, 10], luck: [20, 20], soku: 10, leng: 2, slot_num: 3, maxeq: [2, 2], buildtime: 30, broken: [0, 0], powup: [0, 0], backs: 1, getmes: "入手メッセージ", afterfuel: 30, afterbull: 30, fuel_max: 100, bull_max: 100, voicef: 0, tais: [0, 0] },
        3: { id: 3, sortno: 3, sort_id: 3, name: "重巡洋艦", yomi: "じゅうじゅんようかん", stype: 5, ctype: 5, afterlv: 40, aftershipid: "4", taik: [30, 30], souk: [15, 15], houg: [15, 15], raig: [15, 15], tyku: [15, 15], luck: [30, 30], soku: 10, leng: 3, slot_num: 4, maxeq: [3, 3], buildtime: 40, broken: [0, 0], powup: [0, 0], backs: 1, getmes: "入手メッセージ", afterfuel: 40, afterbull: 40, fuel_max: 100, bull_max: 100, voicef: 0, tais: [0, 0] }
    }
};