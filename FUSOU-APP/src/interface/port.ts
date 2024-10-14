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
    deck_ports: {}
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
    n_docks: []
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
    ships: {}
};

interface Logs {
    message?:   string[]    // メッセージ
}

export var global_logs: Logs = {
    message: [] 
};