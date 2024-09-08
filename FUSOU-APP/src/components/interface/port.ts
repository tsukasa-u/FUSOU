// https://github.com/andanteyk/ElectronicObserver/blob/develop/ElectronicObserver/Other/Information/apilist.txt

export interface Port {
    material:  Material
    deck_port: DeckPort[]
    ndock:     NDock[]
    ship:       { [key: string]: Ship }
    logs:      Logs
}

export interface Material {
    materials: number[]
}

export interface DeckPort {
    id:        number
    mission:   {
        mission_id:     number
        complete_time:  number
        counter:        number
    }
    ship?: number[]
}

export interface NDock {
    ship_id:        number
    complete_time:  number
    counter:        number
    item1:          number
    item2:          number
    item3:          number
    item4:          number
}

export interface Ship {
    id:         number
    ship_id:    number
    // ship_name:  string
    lv:         number      // レベル
    exp:        number[]
    nowhp:      number      // 現在HP
    maxhp:      number      // 最大HP
    soku:       number      // 速力
    leng:       number      // 射程
    slot?:      number[]    // 装備
    onsolot?:   number[]    // 艦載機搭載数
    slot_ex?:   number      // 補強増設
    fuel:       number      // 燃料
    // max_fuel:   number      // 最大燃料
    bull:       number      // 弾薬
    // max_bull:   number      // 最大弾薬
    slotnum:    number      // 装備スロット数
    cond:       number      // 疲労度
    karyoku:    number[]      // 火力
    raisou:     number[]      // 雷装
    taiku:      number[]      // 対空
    soukou:     number[]      // 装甲
    kaihi:      number[]      // 回避
    taisen:     number[]      // 対潜
    sakuteki:   number[]      // 索敵
    lucky:      number[]      // 運
    sally_area: number      // 出撃海域
}

interface Logs {
    message?:   string[]    // メッセージ
}