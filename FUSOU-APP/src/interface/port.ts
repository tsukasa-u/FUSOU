// https://github.com/andanteyk/ElectronicObserver/blob/develop/ElectronicObserver/Other/Information/apilist.txt

// export interface Port {
//     material:  Material
//     deck_port: DeckPort[]
//     ndock:     NDock[]
//     ship:       { [key: string]: Ship }
//     logs:      Logs
// }

export interface Materials {
    materials:  { [key: number]: number }
    // materials: number[]
}

export var global_materials: Materials = {
    materials: [350000, 350000, 350000, 350000, 3000, 3000, 3000, 3000]
};

export interface DeckPort {
    id:        number
    name:      string
    mission:   {
        mission_id:     number
        complete_time:  number
        counter:        number
    }
    ship: number[]
}

export interface DeckPorts {
    deck_ports: { [key: number]: DeckPort }
}

export var global_deck_ports: DeckPorts = {
    deck_ports: {
        // 1: { id: 1, mission: { mission_id: 0, complete_time: 0, counter: 0 }, ship: [0, 0, 0] },
        // 2: { id: 2, mission: { mission_id: 0, complete_time: 0, counter: 0 }, ship: [0, 0, 0] },
        // 3: { id: 3, mission: { mission_id: 0, complete_time: 0, counter: 0 }, ship: [0, 0, 0] },
        // 4: { id: 4, mission: { mission_id: 0, complete_time: 0, counter: 0 }, ship: [0, 0, 0] }
    }
};

export interface NDock {
    ship_id:        number
    complete_time:  number
    counter:        number
    item1:          number
    item2:          number
    item3:          number
    item4:          number
}

export interface NDocks {
    n_docks: NDock[]
}

export var global_nDock: NDocks = {
    n_docks: [
        // { ship_id: 1, complete_time: 1722010682963, counter: 0, item1: 0, item2: 0, item3: 0, item4: 0 },
        // { ship_id: 2, complete_time: 1630000000000, counter: 0, item1: 0, item2: 0, item3: 0, item4: 0 },
        // { ship_id: 3, complete_time: 1630000000000, counter: 0, item1: 0, item2: 0, item3: 0, item4: 0 }
    ]
};

export interface Ship {
    id:         number
    ship_id:    number
    lv:         number      // レベル
    exp:        number[]    // length: 3
    nowhp:      number      // 現在HP
    maxhp:      number      // 最大HP
    soku:       number      // 速力
    leng:       number      // 射程
    slot:      number[]    // 装備 length: n
    onsolot:   number[]    // 艦載機搭載数 length: n
    slot_ex:   number      // 補強増設
    fuel:       number      // 燃料
    bull:       number      // 弾薬
    slotnum:    number      // 装備スロット数
    cond:       number      // 疲労度
    karyoku:    number[]      // 火力 length: 2
    raisou:     number[]      // 雷装 length: 2
    taiku:      number[]      // 対空 length: 2
    soukou:     number[]      // 装甲 length: 2
    kaihi:      number[]      // 回避 length: 2
    taisen:     number[]      // 対潜 length: 2
    sakuteki:   number[]      // 索敵 length: 2
    lucky:      number[]      // 運
    sally_area: number      // 出撃海域
    sp_effect_items?: SpEffectItems
}

export interface SpEffectItems {
    items: { [key: number]: SpEffectItem }
}

export interface SpEffectItem {
    kind: number
    raig?: number
    souk?: number
    houg?: number
    kaih?: number
}

export interface Ships {
    ships: { [key: number]: Ship }
}

export var global_ships: Ships = {
    ships:{
        // 1: { id: 1, ship_id: 1, lv: 1, exp: [0, 0, 0], nowhp: 80, maxhp: 80, soku: 10, leng: 1, slot: [1, 2, 3, 4], onsolot: [1, 2, 3, 4], slot_ex: 0, fuel: 100, bull: 100, slotnum: 4, cond: 49, karyoku: [0, 0], raisou: [0, 0], taiku: [0, 0], soukou: [0, 0], kaihi: [0, 0], taisen: [0, 0], sakuteki: [0, 0], lucky: [0, 0], sally_area: 0 },
        // 2: { id: 2, ship_id: 2, lv: 1, exp: [0, 0, 0], nowhp: 80, maxhp: 80, soku: 10, leng: 1, slot: [1, 2, 3, 4], onsolot: [1, 2, 3, 4], slot_ex: 0, fuel: 100, bull: 100, slotnum: 4, cond: 49, karyoku: [0, 0], raisou: [0, 0], taiku: [0, 0], soukou: [0, 0], kaihi: [0, 0], taisen: [0, 0], sakuteki: [0, 0], lucky: [0, 0], sally_area: 0 },
        // 3: { id: 3, ship_id: 3, lv: 1, exp: [0, 0, 0], nowhp: 80, maxhp: 80, soku: 10, leng: 1, slot: [1, 2, 3, 4], onsolot: [1, 2, 3, 4], slot_ex: 0, fuel: 100, bull: 100, slotnum: 4, cond: 49, karyoku: [0, 0], raisou: [0, 0], taiku: [0, 0], soukou: [0, 0], kaihi: [0, 0], taisen: [0, 0], sakuteki: [0, 0], lucky: [0, 0], sally_area: 0 }
    }
};

interface Logs {
    message?:   string[]    // メッセージ
}

export var global_logs: Logs = { message: [] };