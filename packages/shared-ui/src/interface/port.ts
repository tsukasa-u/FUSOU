// https://github.com/andanteyk/ElectronicObserver/blob/develop/ElectronicObserver/Other/Information/apilist.txt

// export interface Port {
//     material:  Material
//     deck_port: DeckPort[]
//     ndock:     NDock[]
//     ship:       { [key: string]: Ship }
//     logs:      Logs
// }

export interface Materials {
  materials: { [key: number]: number };
  // materials: number[]
}

export const default_materials: Materials = {
  materials: [350000, 350000, 350000, 350000, 3000, 3000, 3000, 3000],
};

export interface DeckPort {
  id: number;
  name: string;
  mission: {
    mission_id: number;
    complete_time: number;
    counter: number;
  };
  ship: number[];
}

export interface DeckPorts {
  deck_ports: { [key: number]: DeckPort };
  combined_flag: number | null;
}

export const default_deck_ports: DeckPorts = {
  deck_ports: {},
  combined_flag: null,
};

export interface NDock {
  ship_id: number;
  complete_time: number;
  counter: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
}

export interface NDocks {
  n_docks: NDock[];
}

export const default_nDock: NDocks = {
  n_docks: [],
};

export interface Ship {
  id: number;
  ship_id: number;
  lv: number; // レベル
  exp: number[]; // length: 3
  nowhp: number; // 現在HP
  maxhp: number; // 最大HP
  soku: number; // 速力
  leng: number; // 射程
  slot: number[]; // 装備 length: n
  onslot: number[]; // 艦載機搭載数 length: n
  slot_ex: number; // 補強増設
  fuel: number; // 燃料
  bull: number; // 弾薬
  slotnum: number; // 装備スロット数
  cond: number; // 疲労度
  karyoku: number[]; // 火力 length: 2
  raisou: number[]; // 雷装 length: 2
  taiku: number[]; // 対空 length: 2
  soukou: number[]; // 装甲 length: 2
  kaihi: number[]; // 回避 length: 2
  taisen: number[]; // 対潜 length: 2
  sakuteki: number[]; // 索敵 length: 2
  lucky: number[]; // 運
  sally_area: number; // 出撃海域
  sp_effect_items?: SpEffectItems;
}

export const default_ship: Ship = {
  id: 0,
  ship_id: 0,
  lv: 0,
  exp: [0, 0, 0],
  nowhp: 0,
  maxhp: 0,
  soku: 0,
  leng: 0,
  slot: [-1, -1, -1, -1, -1],
  onslot: [0, 0, 0, 0, 0],
  slot_ex: 0,
  fuel: 0,
  bull: 0,
  slotnum: 0,
  cond: 0,
  karyoku: [0, 0],
  raisou: [0, 0],
  taiku: [0, 0],
  soukou: [0, 0],
  kaihi: [0, 0],
  taisen: [0, 0],
  sakuteki: [0, 0],
  lucky: [0, 0],
  sally_area: 0,
  sp_effect_items: {
    items: {
      0: {
        kind: 0,
        raig: 0,
        souk: 0,
        houg: 0,
        kaih: 0,
      },
    },
  },
};

export interface SpEffectItems {
  items: { [key: number]: SpEffectItem };
}

export interface SpEffectItem {
  kind: number;
  raig?: number;
  souk?: number;
  houg?: number;
  kaih?: number;
}

export interface Ships {
  ships: { [key: number]: Ship };
}

export const default_ships: Ships = {
  ships: {},
};

interface Logs {
  message?: string[]; // メッセージ
}

export const default_logs: Logs = {
  message: [],
};
