import type { ViewerWorkspace } from "../features/simulator/viewer-workspace";
import { buildBattleDropsPayload } from "../features/battles/resolvers/drops";
import { resolveBattleDetail, type BattleDetailTables } from "../features/battles/resolvers/detail";
import { buildBattleOverviewPayload } from "../features/battles/resolvers/overview";
import type { MstShipData, MstSlotItemData } from "../features/simulator/types";
import type { BattleDetailPayload } from "../features/battles/repository/types";
import type { PageMockScenario } from "./storybook-page-state";

export const STORYBOOK_SAMPLE_SORTIE_ID = "storybook-sortie-001";
export const STORYBOOK_PROJECT_API_ORIGIN = "https://fusou.dev";
export const STORYBOOK_SAMPLE_PERIOD = {
  period_tag: "2026-02-13",
  table_version: "0.7.0",
};
export const STORYBOOK_SAMPLE_FLEET_TAG = "storybook-sample-fleet";
export const STORYBOOK_SAMPLE_FLEET_UPLOADED = "2026-02-13T08:30:00.000Z";

export const STORYBOOK_SAMPLE_SHIPS = [
  {
    id: 83,
    name: "赤城",
    stype: 11,
    ctype: 14,
    sort_id: 2011,
    taik: [69, 79],
    souk: [28, 54],
    houg: [0, 39],
    raig: [0, 0],
    tyku: [32, 69],
    tais: null,
    kaih: null,
    saku: null,
    luck: [12, 49],
    soku: 10,
    leng: 1,
    slot_num: 4,
    maxeq: [18, 18, 27, 10, 0],
  },
  {
    id: 78,
    name: "金剛",
    stype: 8,
    ctype: 6,
    sort_id: 1011,
    taik: [63, 79],
    souk: [52, 69],
    houg: [63, 89],
    raig: [0, 0],
    tyku: [24, 69],
    tais: null,
    kaih: null,
    saku: null,
    luck: [12, 49],
    soku: 10,
    leng: 3,
    slot_num: 3,
    maxeq: [3, 3, 3, 0, 0],
  },
  {
    id: 144,
    name: "夕立改二",
    stype: 2,
    ctype: 23,
    sort_id: 15106,
    taik: [31, 58],
    souk: [14, 52],
    houg: [17, 74],
    raig: [37, 94],
    tyku: [16, 59],
    tais: null,
    kaih: null,
    saku: null,
    luck: [22, 65],
    soku: 10,
    leng: 1,
    slot_num: 3,
    maxeq: [0, 0, 0, 0, 0],
  },
  {
    id: 145,
    name: "時雨改二",
    stype: 2,
    ctype: 23,
    sort_id: 15086,
    taik: [31, 49],
    souk: [14, 52],
    houg: [13, 62],
    raig: [28, 89],
    tyku: [24, 72],
    tais: null,
    kaih: null,
    saku: null,
    luck: [50, 88],
    soku: 10,
    leng: 1,
    slot_num: 3,
    maxeq: [0, 0, 0, 0, 0],
  },
  {
    id: 13,
    name: "綾波",
    stype: 2,
    ctype: 1,
    sort_id: 14111,
    taik: [15, 29],
    souk: [5, 19],
    houg: [10, 29],
    raig: [27, 79],
    tyku: [12, 39],
    tais: null,
    kaih: null,
    saku: null,
    luck: [12, 49],
    soku: 10,
    leng: 1,
    slot_num: 2,
    maxeq: [0, 0, 0, 0, 0],
  },
  {
    id: 20,
    name: "雪風",
    stype: 2,
    ctype: 30,
    sort_id: 16081,
    taik: [16, 39],
    souk: [7, 29],
    houg: [10, 29],
    raig: [24, 79],
    tyku: [12, 49],
    tais: null,
    kaih: null,
    saku: null,
    luck: [50, 99],
    soku: 10,
    leng: 1,
    slot_num: 2,
    maxeq: [0, 0, 0, 0, 0],
  },
  {
    id: 84,
    name: "加賀",
    stype: 11,
    ctype: 3,
    sort_id: 2021,
    taik: [71, 89],
    souk: [29, 59],
    houg: [0, 39],
    raig: [0, 0],
    tyku: [28, 69],
    tais: null,
    kaih: null,
    saku: null,
    luck: [10, 49],
    soku: 10,
    leng: 1,
    slot_num: 4,
    maxeq: [18, 18, 45, 12, 0],
  },
  {
    id: 79,
    name: "榛名",
    stype: 8,
    ctype: 6,
    sort_id: 1031,
    taik: [63, 79],
    souk: [52, 69],
    houg: [63, 89],
    raig: [0, 0],
    tyku: [24, 69],
    tais: null,
    kaih: null,
    saku: null,
    luck: [15, 69],
    soku: 10,
    leng: 3,
    slot_num: 3,
    maxeq: [3, 3, 3, 0, 0],
  },
  {
    id: 9,
    name: "吹雪",
    stype: 2,
    ctype: 12,
    sort_id: 14011,
    taik: [15, 29],
    souk: [5, 19],
    houg: [10, 29],
    raig: [27, 79],
    tyku: [10, 39],
    tais: null,
    kaih: null,
    saku: null,
    luck: [17, 49],
    soku: 10,
    leng: 1,
    slot_num: 2,
    maxeq: [0, 0, 0, 0, 0],
  },
  {
    id: 12,
    name: "磯波",
    stype: 2,
    ctype: 12,
    sort_id: 14091,
    taik: [15, 29],
    souk: [5, 19],
    houg: [10, 29],
    raig: [27, 69],
    tyku: [10, 39],
    tais: null,
    kaih: null,
    saku: null,
    luck: [10, 49],
    soku: 10,
    leng: 1,
    slot_num: 2,
    maxeq: [0, 0, 0, 0, 0],
  },
  {
    id: 16,
    name: "潮",
    stype: 2,
    ctype: 1,
    sort_id: 14201,
    taik: [15, 29],
    souk: [5, 19],
    houg: [10, 29],
    raig: [27, 69],
    tyku: [12, 39],
    tais: null,
    kaih: null,
    saku: null,
    luck: [20, 79],
    soku: 10,
    leng: 1,
    slot_num: 2,
    maxeq: [0, 0, 0, 0, 0],
  },
  {
    id: 17,
    name: "陽炎",
    stype: 2,
    ctype: 30,
    sort_id: 16011,
    taik: [16, 34],
    souk: [6, 19],
    houg: [10, 29],
    raig: [24, 79],
    tyku: [12, 39],
    tais: null,
    kaih: null,
    saku: null,
    luck: [12, 49],
    soku: 10,
    leng: 1,
    slot_num: 2,
    maxeq: [0, 0, 0, 0, 0],
  },
] satisfies MstShipData[];

export const STORYBOOK_SAMPLE_BATTLE_SHIPS = [
  ...STORYBOOK_SAMPLE_SHIPS.map((ship) => ({ ...ship })),
  { id: 1501, name: "駆逐イ級", stype: 2, ctype: 1, taik: null, souk: null, houg: null, raig: null, tyku: null, tais: null, kaih: null, saku: null, luck: null, soku: 10, leng: null, slot_num: 2, maxeq: null },
  { id: 1502, name: "駆逐ロ級", stype: 2, ctype: 1, taik: null, souk: null, houg: null, raig: null, tyku: null, tais: null, kaih: null, saku: null, luck: null, soku: 10, leng: null, slot_num: 2, maxeq: null },
  { id: 1505, name: "軽巡ホ級", stype: 3, ctype: 1, taik: null, souk: null, houg: null, raig: null, tyku: null, tais: null, kaih: null, saku: null, luck: null, soku: 10, leng: null, slot_num: 2, maxeq: null },
  { id: 1509, name: "重巡リ級", stype: 5, ctype: 1, taik: null, souk: null, houg: null, raig: null, tyku: null, tais: null, kaih: null, saku: null, luck: null, soku: 10, leng: null, slot_num: 3, maxeq: null },
  { id: 1511, name: "戦艦ル級", stype: 9, ctype: 1, taik: null, souk: null, houg: null, raig: null, tyku: null, tais: null, kaih: null, saku: null, luck: null, soku: 5, leng: null, slot_num: 3, maxeq: null },
  { id: 1512, name: "空母ヲ級", stype: 11, ctype: 1, taik: null, souk: null, houg: null, raig: null, tyku: null, tais: null, kaih: null, saku: null, luck: null, soku: 10, leng: null, slot_num: 3, maxeq: null },
  { id: 1530, name: "潜水カ級", stype: 13, ctype: 1, taik: null, souk: null, houg: null, raig: null, tyku: null, tais: null, kaih: null, saku: null, luck: null, soku: 5, leng: null, slot_num: 2, maxeq: null },
] satisfies Record<string, unknown>[];

export const STORYBOOK_SAMPLE_SLOT_ITEMS = [
  {
    id: 2,
    name: "12.7cm連装砲",
    sortno: 2,
    type: [1, 1, 1, 1, 0],
    houg: 2,
    raig: 0,
    tyku: 2,
    tais: 0,
    baku: 0,
    saku: 0,
    houm: 0,
    souk: 0,
    distance: null,
  },
  {
    id: 15,
    name: "61cm四連装(酸素)魚雷",
    sortno: 15,
    type: [2, 3, 5, 5, 0],
    houg: 0,
    raig: 10,
    tyku: 0,
    tais: 0,
    baku: 0,
    saku: 0,
    houm: 0,
    souk: 0,
    distance: null,
  },
  {
    id: 16,
    name: "九七式艦攻",
    sortno: 16,
    type: [3, 5, 8, 8, 1],
    houg: 0,
    raig: 5,
    tyku: 0,
    tais: 4,
    baku: 0,
    saku: 1,
    houm: 0,
    souk: 0,
    distance: 4,
  },
  {
    id: 24,
    name: "彗星",
    sortno: 24,
    type: [3, 5, 7, 7, 16],
    houg: 0,
    raig: 0,
    tyku: 0,
    tais: 3,
    baku: 8,
    saku: 0,
    houm: 0,
    souk: 0,
    distance: 4,
  },
  {
    id: 25,
    name: "零式水上偵察機",
    sortno: 25,
    type: [5, 7, 10, 10, 2],
    houg: 0,
    raig: 0,
    tyku: 1,
    tais: 2,
    baku: 1,
    saku: 5,
    houm: 1,
    souk: 0,
    distance: 7,
  },
  {
    id: 27,
    name: "13号対空電探",
    sortno: 27,
    type: [5, 8, 12, 11, 0],
    houg: 0,
    raig: 0,
    tyku: 2,
    tais: 0,
    baku: 0,
    saku: 3,
    houm: 1,
    souk: 0,
    distance: null,
  },
  {
    id: 28,
    name: "22号対水上電探",
    sortno: 28,
    type: [5, 8, 12, 11, 0],
    houg: 0,
    raig: 0,
    tyku: 0,
    tais: 0,
    baku: 0,
    saku: 5,
    houm: 3,
    souk: 0,
    distance: null,
  },
  {
    id: 30,
    name: "21号対空電探",
    sortno: 30,
    type: [5, 8, 13, 11, 0],
    houg: 0,
    raig: 0,
    tyku: 4,
    tais: 0,
    baku: 0,
    saku: 4,
    houm: 2,
    souk: 0,
    distance: null,
  },
  {
    id: 45,
    name: "三式爆雷投射機",
    sortno: 45,
    type: [7, 32, 15, 17, 0],
    houg: 0,
    raig: 0,
    tyku: 0,
    tais: 8,
    baku: 0,
    saku: 0,
    houm: 0,
    souk: 0,
    distance: null,
  },
  {
    id: 46,
    name: "九三式水中聴音機",
    sortno: 46,
    type: [7, 10, 14, 18, 0],
    houg: 0,
    raig: 0,
    tyku: 0,
    tais: 6,
    baku: 0,
    saku: 0,
    houm: 1,
    souk: 0,
    distance: null,
  },
  {
    id: 57,
    name: "彗星一二型甲",
    sortno: 57,
    type: [3, 5, 7, 7, 16],
    houg: 0,
    raig: 0,
    tyku: 0,
    tais: 3,
    baku: 10,
    saku: 1,
    houm: 0,
    souk: 0,
    distance: 5,
  },
  {
    id: 58,
    name: "61cm五連装(酸素)魚雷",
    sortno: 58,
    type: [2, 3, 5, 5, 0],
    houg: 0,
    raig: 12,
    tyku: 0,
    tais: 0,
    baku: 0,
    saku: 0,
    houm: 1,
    souk: 0,
    distance: null,
  },
  {
    id: 59,
    name: "零式水上観測機",
    sortno: 59,
    type: [5, 7, 10, 10, 2],
    houg: 0,
    raig: 0,
    tyku: 2,
    tais: 4,
    baku: 1,
    saku: 6,
    houm: 2,
    souk: 0,
    distance: 3,
  },
] satisfies MstSlotItemData[];

export const STORYBOOK_SAMPLE_FLEET = {
  v: 2,
  fleet1: [
    {
      shipId: 83,
      shipLevel: 99,
      equipIds: [16, 24, 16, 25, null],
      equipImprovement: [0, 0, 0, 0, 0],
      equipProficiency: [7, 7, 7, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
    {
      shipId: 78,
      shipLevel: 99,
      equipIds: [2, 2, 27, null, null],
      equipImprovement: [10, 10, 0, 0, 0],
      equipProficiency: [0, 0, 0, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
    {
      shipId: 144,
      shipLevel: 99,
      equipIds: [2, 58, 45, null, null],
      equipImprovement: [10, 10, 0, 0, 0],
      equipProficiency: [0, 0, 0, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
    {
      shipId: 145,
      shipLevel: 99,
      equipIds: [2, 15, 46, null, null],
      equipImprovement: [10, 10, 0, 0, 0],
      equipProficiency: [0, 0, 0, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
    {
      shipId: 13,
      shipLevel: 99,
      equipIds: [2, 15, null, null, null],
      equipImprovement: [10, 10, 0, 0, 0],
      equipProficiency: [0, 0, 0, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
    {
      shipId: 20,
      shipLevel: 99,
      equipIds: [2, 58, null, null, null],
      equipImprovement: [10, 10, 0, 0, 0],
      equipProficiency: [0, 0, 0, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
  ],
  fleet2: [
    {
      shipId: 84,
      shipLevel: 99,
      equipIds: [16, 24, 16, 25, null],
      equipImprovement: [0, 0, 0, 0, 0],
      equipProficiency: [7, 7, 7, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
    {
      shipId: 79,
      shipLevel: 99,
      equipIds: [2, 2, 27, null, null],
      equipImprovement: [10, 10, 0, 0, 0],
      equipProficiency: [0, 0, 0, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
    {
      shipId: 9,
      shipLevel: 99,
      equipIds: [2, 15, null, null, null],
      equipImprovement: [10, 10, 0, 0, 0],
      equipProficiency: [0, 0, 0, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
    {
      shipId: 12,
      shipLevel: 99,
      equipIds: [2, 15, null, null, null],
      equipImprovement: [10, 10, 0, 0, 0],
      equipProficiency: [0, 0, 0, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
    {
      shipId: 16,
      shipLevel: 99,
      equipIds: [2, 15, 46, null, null],
      equipImprovement: [10, 10, 0, 0, 0],
      equipProficiency: [0, 0, 0, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
    {
      shipId: 17,
      shipLevel: 99,
      equipIds: [2, 58, 28, null, null],
      equipImprovement: [10, 10, 0, 0, 0],
      equipProficiency: [0, 0, 0, 0, 0],
      exSlotId: null,
      exSlotImprovement: 0,
    },
  ],
  fleet3: [],
  fleet4: [],
  airBases: [
    {
      equipIds: [16, 57, 24, 25],
      equipImprovement: [0, 0, 0, 0],
      equipProficiency: [7, 7, 7, 0],
    },
    {
      equipIds: [16, 16, 57, 59],
      equipImprovement: [0, 0, 0, 0],
      equipProficiency: [7, 7, 7, 0],
    },
    {
      equipIds: [16, 24, 25, 59],
      equipImprovement: [0, 0, 0, 0],
      equipProficiency: [7, 7, 0, 0],
    },
  ],
  snapshotShips: {},
  snapshotSlotItems: {},
  combinedFleetType: 1,
  fleetFormations: { 1: 11, 2: 12, 3: 0, 4: 0 },
};

const sampleWorkspaceEntryId = "storybook-workspace-entry";

export const STORYBOOK_SAMPLE_VIEWER_WORKSPACE: ViewerWorkspace = {
  activeId: null,
  entries: [
    {
      id: sampleWorkspaceEntryId,
      name: "第一遊撃部隊・機動部隊",
      memo: "赤城・加賀を基幹とする連合艦隊。艦載機・対空装備・対潜装備を確認できます。",
      sourceType: "ownDeck",
      sourceValue: "storybook-sample-sortie",
      payloadKind: "exportedFleet",
      payload: STORYBOOK_SAMPLE_FLEET,
      updatedAt: Date.UTC(2026, 1, 13),
      pinned: false,
      locked: true,
    },
  ],
};

export const STORYBOOK_SAMPLE_PERIODS = [
  STORYBOOK_SAMPLE_PERIOD,
  { period_tag: "2026-01-15", table_version: "0.6.1" },
];

const growthLevels = [1, 10, 25, 50, 99];

function growthBounds(masterId: number, offset = 0) {
  return growthLevels.map((lv) => ({
    master_id: masterId,
    lv,
    kaihi_naked: Math.max(0, Math.round(lv * 0.38 + offset)),
    taisen_naked: Math.max(0, Math.round(lv * 0.22 + offset)),
    sakuteki_naked: Math.max(0, Math.round(lv * 0.19 + offset)),
    lucky_naked: Math.max(0, Math.round(10 + lv * 0.04 + offset)),
  }));
}

function growthCaps(masterId: number, offset = 0) {
  return [
    {
      master_id: masterId,
      kaihi_max: 40 + offset,
      taisen_max: 30 + offset,
      sakuteki_max: 20 + offset,
    },
  ];
}

const sampleBattleRecords = [
  {
    uuid: "storybook-battle-001",
    env_uuid: STORYBOOK_SAMPLE_SORTIE_ID,
    __sortie_id: STORYBOOK_SAMPLE_SORTIE_ID,
    index: 0,
    cell_id: 2,
    timestamp: Date.UTC(2026, 1, 13, 8, 30),
    maparea_id: 1,
    mapinfo_no: 1,
    f_formation: 1,
    e_formation: 1,
    formation: [1, 1],
    e_deck_id: "storybook-enemy-deck-001",
    battle_result: "storybook-result-001",
    hougeki: "storybook-hougeki-list-001",
    battle_order: [{ Hougeki: 0 }],
    f_nowhps: [48, 62, 24, 21, 20, 35],
    e_nowhps: [7, 13, 30],
  },
  {
    uuid: "storybook-battle-002",
    env_uuid: STORYBOOK_SAMPLE_SORTIE_ID,
    __sortie_id: STORYBOOK_SAMPLE_SORTIE_ID,
    index: 1,
    cell_id: 3,
    timestamp: Date.UTC(2026, 1, 13, 8, 38),
    maparea_id: 1,
    mapinfo_no: 1,
    f_formation: 1,
    e_formation: 1,
    formation: [1, 1],
    e_deck_id: "storybook-enemy-deck-002",
    battle_result: "storybook-result-002",
    hougeki: "storybook-hougeki-list-002",
    battle_order: [{ Hougeki: 0 }],
    f_nowhps: [58, 68, 32, 29, 28, 37],
    e_nowhps: [12, 24, 27],
  },
];

const sampleCells = [
  {
    uuid: "storybook-cell-001",
    env_uuid: STORYBOOK_SAMPLE_SORTIE_ID,
    battles: "storybook-battle-001",
    maparea_id: 1,
    mapinfo_no: 1,
    cell_index: [1, 2],
    battle_index: [0],
  },
  {
    uuid: "storybook-cell-002",
    env_uuid: STORYBOOK_SAMPLE_SORTIE_ID,
    battles: "storybook-battle-002",
    maparea_id: 1,
    mapinfo_no: 1,
    cell_index: [1, 3],
    battle_index: [1],
  },
];

const sampleEnemyDecks = [
  { uuid: "storybook-enemy-deck-001", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, ship_ids: ["storybook-enemy-ships-001"] },
  { uuid: "storybook-enemy-deck-002", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, ship_ids: ["storybook-enemy-ships-002"] },
];

const sampleEnemyShips = [
  { uuid: "storybook-enemy-ships-001", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 0, mst_ship_id: 1501, nowhp: 7, maxhp: 15 },
  { uuid: "storybook-enemy-ships-001", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 1, mst_ship_id: 1502, nowhp: 13, maxhp: 18 },
  { uuid: "storybook-enemy-ships-001", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 2, mst_ship_id: 1505, nowhp: 30, maxhp: 37 },
  { uuid: "storybook-enemy-ships-002", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 0, mst_ship_id: 1502, nowhp: 12, maxhp: 18 },
  { uuid: "storybook-enemy-ships-002", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 1, mst_ship_id: 1505, nowhp: 24, maxhp: 37 },
  { uuid: "storybook-enemy-ships-002", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 2, mst_ship_id: 1509, nowhp: 27, maxhp: 48 },
];

const sampleBattleResults = [
  { uuid: "storybook-result-001", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 0, win_rank: "S", drop_ship_id: 9 },
  { uuid: "storybook-result-002", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 1, win_rank: "A", drop_ship_id: 12 },
];

const sampleOwnShips = [
  { uuid: "storybook-own-ships-main", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 0, mst_ship_id: 83, nowhp: 48, maxhp: 79, lv: 99, slot: "storybook-own-slotitems-main-0" },
  { uuid: "storybook-own-ships-main", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 1, mst_ship_id: 78, nowhp: 62, maxhp: 79, lv: 99, slot: "storybook-own-slotitems-main-1" },
  { uuid: "storybook-own-ships-main", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 2, mst_ship_id: 144, nowhp: 24, maxhp: 58, lv: 99, slot: "storybook-own-slotitems-main-2" },
  { uuid: "storybook-own-ships-main", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 3, mst_ship_id: 145, nowhp: 21, maxhp: 49, lv: 99, slot: "storybook-own-slotitems-main-3" },
  { uuid: "storybook-own-ships-main", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 4, mst_ship_id: 13, nowhp: 20, maxhp: 29, lv: 99, slot: "storybook-own-slotitems-main-4" },
  { uuid: "storybook-own-ships-main", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 5, mst_ship_id: 20, nowhp: 35, maxhp: 39, lv: 99, slot: "storybook-own-slotitems-main-5" },
  { uuid: "storybook-own-ships-escort", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 0, mst_ship_id: 84, nowhp: 58, maxhp: 89, lv: 99, slot: "storybook-own-slotitems-escort-0" },
  { uuid: "storybook-own-ships-escort", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 1, mst_ship_id: 79, nowhp: 68, maxhp: 79, lv: 99, slot: "storybook-own-slotitems-escort-1" },
  { uuid: "storybook-own-ships-escort", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 2, mst_ship_id: 9, nowhp: 27, maxhp: 29, lv: 99, slot: "storybook-own-slotitems-escort-2" },
  { uuid: "storybook-own-ships-escort", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 3, mst_ship_id: 12, nowhp: 25, maxhp: 29, lv: 99, slot: "storybook-own-slotitems-escort-3" },
  { uuid: "storybook-own-ships-escort", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 4, mst_ship_id: 16, nowhp: 24, maxhp: 29, lv: 99, slot: "storybook-own-slotitems-escort-4" },
  { uuid: "storybook-own-ships-escort", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 5, mst_ship_id: 17, nowhp: 30, maxhp: 34, lv: 99, slot: "storybook-own-slotitems-escort-5" },
];

const ownShipEquipment = [
  ["storybook-own-slotitems-main-0", [16, 24, 16, 25]],
  ["storybook-own-slotitems-main-1", [2, 2, 27]],
  ["storybook-own-slotitems-main-2", [2, 58, 45]],
  ["storybook-own-slotitems-main-3", [2, 15, 46]],
  ["storybook-own-slotitems-main-4", [2, 15]],
  ["storybook-own-slotitems-main-5", [2, 58]],
  ["storybook-own-slotitems-escort-0", [16, 24, 16, 25]],
  ["storybook-own-slotitems-escort-1", [2, 2, 27]],
  ["storybook-own-slotitems-escort-2", [2, 15]],
  ["storybook-own-slotitems-escort-3", [2, 15]],
  ["storybook-own-slotitems-escort-4", [2, 15, 46]],
  ["storybook-own-slotitems-escort-5", [2, 58, 28]],
] satisfies Array<[string, number[]]>;

const sampleOwnSlotItems = ownShipEquipment.flatMap(([uuid, itemIds]) =>
  itemIds.map((mst_slotitem_id, index) => ({
    uuid,
    env_uuid: STORYBOOK_SAMPLE_SORTIE_ID,
    index,
    mst_slotitem_id,
    level: 0,
  })),
);

const sampleBattleTables: BattleDetailTables = {
  battle: sampleBattleRecords,
  cells: sampleCells,
  battleResult: sampleBattleResults,
  ownDeck: [
    { uuid: "storybook-own-deck-main", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, ship_ids: ["storybook-own-ships-main"] },
    { uuid: "storybook-own-deck-escort", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, ship_ids: ["storybook-own-ships-escort"] },
  ],
  ownShip: sampleOwnShips,
  ownSlotItem: sampleOwnSlotItems,
  enemyDeck: sampleEnemyDecks,
  enemyShip: sampleEnemyShips,
  enemySlotItem: [],
  midnightHougekiLists: [],
  midnightHougekis: [],
  openingTaisenLists: [],
  openingTaisens: [],
  hougekiLists: [
    { uuid: "storybook-hougeki-list-001", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 0, hougeki: "storybook-hougeki-001" },
    { uuid: "storybook-hougeki-list-002", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 1, hougeki: "storybook-hougeki-002" },
  ],
  hougekis: [
    {
      uuid: "storybook-hougeki-001",
      env_uuid: STORYBOOK_SAMPLE_SORTIE_ID,
      index: 0,
      at: 0,
      at_eflag: 0,
      df: [0],
      damage: [13],
      cl: [2],
      si: [16],
      f_now_hps: [48, 62, 24, 21, 20, 35],
      e_now_hps: [7, 13, 30],
    },
    {
      uuid: "storybook-hougeki-002",
      env_uuid: STORYBOOK_SAMPLE_SORTIE_ID,
      index: 0,
      at: 1,
      at_eflag: 1,
      df: [0],
      damage: [9],
      cl: [2],
      si: [2],
      f_now_hps: [58, 68, 27, 25, 24, 30],
      e_now_hps: [12, 24, 27],
    },
  ],
  openingAirattackLists: [
    { uuid: "storybook-airattack-list-001", env_uuid: STORYBOOK_SAMPLE_SORTIE_ID, index: 0, opening_air_attack: "storybook-airattack-001" },
  ],
  openingAirattacks: [
    {
      uuid: "storybook-airattack-001",
      env_uuid: STORYBOOK_SAMPLE_SORTIE_ID,
      index: 0,
      f_damages: [0, 0],
      e_damages: [7, 0],
      f_rai_flag: [0, 0],
      e_rai_flag: [1, 0],
      f_bak_flag: [0, 0],
      e_bak_flag: [0, 0],
      f_now_hps: [20, 28],
      e_now_hps: [28, 18],
      air_superiority: 2,
    },
  ],
  openingRaigeki: [],
  closingRaigeki: [],
  airbaseAssault: [],
  airbaseAirattackLists: [],
  airbaseAirattacks: [],
  carrierbaseAssault: [],
  supportHourai: [],
  supportAirattack: [],
  nightSupportHourai: [],
  nightSupportAirattack: [],
  friendlySupportHouraiLists: [],
  friendlySupportHourai: [],
  destructionBattle: [],
};

export type StorybookBattleScenario =
  | "air-operations"
  | "night-battle"
  | "all-phases";

function asStorybookRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function withStorybookShipBanners(
  payload: BattleDetailPayload,
): BattleDetailPayload {
  for (const fleet of [
    payload.derived?.friendly_fleet,
    payload.derived?.enemy_fleet,
  ]) {
    for (const ship of fleet ?? []) {
      const shipId = Number(
        ship["shipId"] ?? ship["ship_id"] ?? ship["mst_ship_id"],
      );
      if (Number.isSafeInteger(shipId) && shipId > 0) {
        ship["bannerUrl"] =
          `${STORYBOOK_PROJECT_API_ORIGIN}/api/asset-sync/ship-banner/${shipId}`;
      }
    }
  }
  return payload;
}

const phaseScenarioTemplates: Record<
  StorybookBattleScenario,
  {
    battle: Record<string, unknown>;
    friendlyShipIds: number[];
    enemyShipIds: number[];
  }
> = {
  "air-operations": {
    friendlyShipIds: [83, 78, 144, 145, 13, 20],
    enemyShipIds: [1501, 1502, 1505, 1509, 1511, 1530],
    battle: {
      uuid: "storybook-air-operations-battle",
      env_uuid: "storybook-air-operations",
      index: 0,
      timestamp: Date.UTC(2026, 1, 13, 9, 10),
      cell_id: 2,
      maparea_id: 6,
      mapinfo_no: 4,
      f_formation: 11,
      e_formation: 1,
      formation: [11, 1],
      f_nowhps: [70, 74, 52, 45, 27, 36],
      e_nowhps: [15, 18, 37, 48, 90, 13],
      battle_order: [
        { AirBaseAssult: 0 },
        { CarrierBaseAssault: 0 },
        { AirBaseAirAttack: 0 },
        { AirBaseAirAttack: 1 },
        { OpeningAirAttack: 0 },
        { SupportAttack: 0 },
        { OpeningTaisen: 0 },
        { OpeningRaigeki: 0 },
        { Hougeki: 0 },
        { Hougeki: 1 },
        { ClosingRaigeki: 0 },
      ],
      air_base_assault: {
        squadron_plane: [16],
        airbase_base_nos: [1],
        air_superiority: 2,
        e_damages: [0, 0, 8, 0, 0, 0],
        f_damages: [0, 0, 0, 0, 0, 0],
        f_now_hps: [70, 74, 52, 45, 27, 36],
        e_now_hps: [15, 18, 37, 48, 90, 13],
      },
      carrier_base_assault: {
        squadron_plane: [24],
        air_superiority: 1,
        e_damages: [0, 5, 0, 0, 0, 0],
        f_damages: [0, 0, 0, 0, 0, 0],
        f_now_hps: [70, 74, 52, 45, 27, 36],
        e_now_hps: [15, 18, 37, 48, 90, 13],
      },
      air_base_air_attacks: [
        {
          squadron_plane: [16],
          airbase_base_no: 1,
          air_superiority: 2,
          e_damages: [0, 0, 0, 11, 0, 0],
          f_damages: [0, 0, 0, 0, 0, 0],
          f_now_hps: [70, 74, 52, 45, 27, 36],
          e_now_hps: [15, 18, 37, 48, 90, 13],
        },
        {
          squadron_plane: [57],
          airbase_base_no: 2,
          air_superiority: 1,
          e_damages: [0, 0, 0, 0, 17, 0],
          f_damages: [0, 0, 0, 0, 0, 0],
          f_now_hps: [70, 74, 52, 45, 27, 36],
          e_now_hps: [15, 18, 37, 48, 90, 13],
        },
      ],
      opening_air_attack: {
        air_superiority: 2,
        e_damages: [0, 0, 9, 0, 0, 0],
        f_damages: [0, 0, 0, 6, 0, 0],
        f_rai_flag: [0, 0, 0, 1, 0, 0],
        e_rai_flag: [0, 0, 1, 0, 0, 0],
        f_bak_flag: [0, 0, 0, 0, 0, 0],
        e_bak_flag: [0, 0, 0, 0, 0, 0],
        f_plane_from: [0],
        e_plane_from: [1],
        f_now_hps: [70, 74, 52, 45, 27, 36],
        e_now_hps: [15, 18, 37, 48, 90, 13],
      },
      support_attack: {
        support_hourai: {
          damage: [0, 12, 0, 0, 15, 0],
          now_hps: [15, 18, 37, 48, 90, 13],
          cl_list: [0, 2, 0, 0, 1, 0],
          ship_id: [0, 78, 0, 0, 83, 0],
        },
      },
      opening_taisen: [
        {
          at: 3,
          at_eflag: 0,
          df: [5],
          damage: [11],
          cl: [2],
          si: [46],
          f_now_hps: [70, 74, 52, 45, 27, 36],
          e_now_hps: [15, 18, 37, 48, 90, 13],
        },
      ],
      opening_raigeki: {
        frai: [1],
        erai: [4],
        edam: [8, 0, 0, 0, 0, 0],
        fdam: [0, 0, 0, 6, 0, 0],
        ecl_list: [2, 0, 0, 0, 0, 0],
        fcl_list: [0, 0, 0, 2, 0, 0],
        f_now_hps: [70, 74, 52, 45, 27, 36],
        e_now_hps: [15, 18, 37, 48, 90, 13],
      },
      hougeki: [
        {
          at: 1,
          at_eflag: 0,
          df: [2],
          damage: [17],
          cl: [2],
          si: [2],
          f_now_hps: [70, 74, 52, 45, 27, 36],
          e_now_hps: [15, 18, 37, 48, 90, 13],
        },
        {
          at: 3,
          at_eflag: 1,
          df: [2],
          damage: [18],
          cl: [1],
          si: [],
          f_now_hps: [70, 74, 52, 45, 27, 36],
          e_now_hps: [15, 18, 37, 48, 90, 13],
        },
      ],
      closing_raigeki: {
        frai: [0, 2],
        erai: [2],
        edam: [0, 0, 14, 0, 0, 0],
        fdam: [0, 0, 8, 0, 0, 0],
        ecl_list: [0, 0, 2, 0, 0, 0],
        fcl_list: [0, 0, 2, 0, 0, 0],
        f_now_hps: [70, 74, 52, 45, 27, 36],
        e_now_hps: [15, 18, 37, 48, 90, 13],
      },
    },
  },
  "night-battle": {
    friendlyShipIds: [84, 79, 9, 12, 16, 17],
    enemyShipIds: [1501, 1502, 1505, 1530, 1511, 1512],
    battle: {
      uuid: "storybook-night-battle",
      env_uuid: "storybook-night-sortie",
      index: 0,
      timestamp: Date.UTC(2026, 1, 13, 22, 40),
      cell_id: 3,
      maparea_id: 6,
      mapinfo_no: 4,
      f_formation: 11,
      e_formation: 1,
      formation: [11, 1],
      f_nowhps: [84, 74, 25, 26, 24, 30],
      e_nowhps: [14, 18, 30, 12, 82, 80],
      midnight_f_nowhps: [84, 74, 25, 26, 24, 30],
      midnight_e_nowhps: [14, 18, 30, 12, 82, 80],
      battle_order: [
        { OpeningTaisen: 0 },
        { OpeningRaigeki: 0 },
        { Hougeki: 0 },
        { FriendlyForceAttack: 0 },
        { NightSupportAttack: 0 },
        { MidnightHougeki: 0 },
      ],
      opening_taisen: [
        {
          at: 4,
          at_eflag: 0,
          df: [3],
          damage: [18],
          cl: [2],
          si: [46],
          f_now_hps: [84, 74, 25, 26, 24, 30],
          e_now_hps: [14, 18, 30, 12, 82, 80],
        },
      ],
      opening_raigeki: {
        frai: [3],
        erai: [3],
        edam: [0, 0, 12, 0, 0, 0],
        fdam: [0, 0, 9, 0, 0, 0],
        ecl_list: [0, 0, 2, 0, 0, 0],
        fcl_list: [0, 0, 2, 0, 0, 0],
        f_now_hps: [84, 74, 25, 26, 24, 30],
        e_now_hps: [14, 18, 30, 12, 82, 80],
      },
      hougeki: [
        {
          at: 1,
          at_eflag: 0,
          df: [4],
          damage: [23],
          cl: [2],
          si: [2],
          f_now_hps: [84, 74, 25, 26, 24, 30],
          e_now_hps: [14, 18, 30, 12, 82, 80],
        },
      ],
      friendly_force_attack: {
        fleet_info: {
          ship_id: [144, 145, 20],
          now_hps: [52, 45, 36],
          max_hps: [58, 49, 39],
        },
        support_hourai: {
          hougeki: [
            {
              at: 0,
              at_eflag: 0,
              df: [5],
              damage: [26],
              cl: [2],
              si: [58],
              f_now_hps: [84, 74, 25, 26, 24, 30],
              e_now_hps: [14, 18, 30, 12, 82, 80],
            },
          ],
        },
      },
      night_support_attack: {
        hourai: {
          damage: [0, 0, 0, 0, 16, 0],
          now_hps: [14, 18, 30, 12, 82, 80],
          cl_list: [0, 0, 0, 0, 2, 0],
          ship_id: [0, 0, 0, 0, 78, 0],
        },
      },
      midnight_hougeki: [
        {
          at: 2,
          at_eflag: 0,
          df: [1],
          damage: [31],
          cl: [2],
          si: [15],
          f_now_hps: [84, 74, 25, 26, 24, 30],
          e_now_hps: [14, 18, 30, 12, 82, 80],
        },
      ],
    },
  },
  "all-phases": {
    friendlyShipIds: [83, 78, 144, 145, 13, 20],
    enemyShipIds: [1501, 1502, 1505, 1509, 1511, 1530],
    battle: {
      uuid: "storybook-all-phases-battle",
      env_uuid: "storybook-all-phases",
      index: 0,
      timestamp: Date.UTC(2026, 1, 13, 12, 0),
      cell_id: 2,
      maparea_id: 6,
      mapinfo_no: 4,
      f_formation: 11,
      e_formation: 1,
      formation: [11, 1],
      f_nowhps: [70, 74, 52, 45, 27, 36],
      e_nowhps: [15, 18, 37, 48, 90, 13],
      midnight_f_nowhps: [70, 74, 34, 39, 27, 36],
      midnight_e_nowhps: [7, 13, 14, 37, 58, 2],
      midnight_touchplane: [25, -1],
      midnight_flare_pos: [3, -1],
      battle_order: [
        { AirBaseAssult: 0 },
        { CarrierBaseAssault: 0 },
        { AirBaseAirAttack: 0 },
        { AirBaseAirAttack: 1 },
        { OpeningAirAttack: 0 },
        { SupportAttack: 0 },
        { OpeningTaisen: 0 },
        { OpeningRaigeki: 0 },
        { Hougeki: 0 },
        { Hougeki: 1 },
        { ClosingRaigeki: 0 },
        { FriendlyForceAttack: 0 },
        { NightSupportAttack: 0 },
        { MidnightHougeki: 0 },
      ],
      air_base_assault: {
        squadron_plane: [16, 24],
        airbase_base_nos: [1],
        air_superiority: 2,
        f_sprite_fly_count: 4,
        e_sprite_fly_count: 0,
        f_sprite_crash_count: 0,
        e_sprite_crash_count: 0,
        f_sprite_damage_count: 1,
        e_sprite_damage_count: 0,
        f_sprite_non_normal_count: 1,
        e_sprite_non_normal_count: 0,
        e_damages: [0, 0, 8, 0, 0, 0],
        f_damages: [0, 0, 0, 0, 0, 0],
        f_now_hps: [70, 74, 52, 45, 27, 36],
        e_now_hps: [15, 18, 37, 48, 90, 13],
      },
      carrier_base_assault: {
        squadron_plane: [24],
        air_superiority: 1,
        f_plane_from: [0],
        f_sprite_fly_count: 3,
        e_sprite_fly_count: 0,
        f_sprite_crash_count: 0,
        e_sprite_crash_count: 0,
        f_sprite_damage_count: 0,
        e_sprite_damage_count: 0,
        f_sprite_non_normal_count: 0,
        e_sprite_non_normal_count: 0,
        e_damages: [0, 5, 0, 0, 0, 0],
        f_damages: [0, 0, 0, 0, 0, 0],
        f_now_hps: [70, 74, 52, 45, 27, 36],
        e_now_hps: [15, 18, 37, 48, 90, 13],
      },
      air_base_air_attacks: [
        {
          squadron_plane: [16, 24, 57, 25],
          airbase_base_no: 1,
          air_superiority: 2,
          f_touch_plane: 25,
          e_touch_plane: -1,
          f_sprite_fly_count: 8,
          e_sprite_fly_count: 6,
          f_sprite_crash_count: 1,
          e_sprite_crash_count: 2,
          f_sprite_damage_count: 2,
          e_sprite_damage_count: 1,
          f_sprite_non_normal_count: 3,
          e_sprite_non_normal_count: 3,
          e_damages: [0, 0, 0, 11, 0, 0],
          f_damages: [0, 0, 0, 0, 0, 0],
          f_now_hps: [70, 74, 52, 45, 27, 36],
          e_now_hps: [15, 18, 37, 48, 90, 13],
        },
        {
          squadron_plane: [57, 24, 16, 16],
          airbase_base_no: 2,
          air_superiority: 1,
          f_sprite_fly_count: 8,
          e_sprite_fly_count: 4,
          f_sprite_crash_count: 0,
          e_sprite_crash_count: 2,
          f_sprite_damage_count: 1,
          e_sprite_damage_count: 1,
          f_sprite_non_normal_count: 1,
          e_sprite_non_normal_count: 3,
          e_damages: [0, 0, 0, 0, 17, 0],
          f_damages: [0, 0, 0, 0, 0, 0],
          f_now_hps: [70, 74, 52, 45, 27, 36],
          e_now_hps: [15, 18, 37, 48, 90, 13],
        },
      ],
      opening_air_attack: {
        air_superiority: 2,
        f_touch_plane: 25,
        e_touch_plane: -1,
        airfire_idx: 3,
        airfire_use_item: [2, 2, 27],
        f_sprite_fly_count: 6,
        e_sprite_fly_count: 10,
        f_sprite_crash_count: 1,
        e_sprite_crash_count: 4,
        f_sprite_damage_count: 1,
        e_sprite_damage_count: 2,
        f_sprite_non_normal_count: 2,
        e_sprite_non_normal_count: 6,
        e_damages: [0, 0, 9, 0, 0, 0],
        f_damages: [0, 0, 0, 6, 0, 0],
        f_rai_flag: [0, 0, 0, 1, 0, 0],
        e_rai_flag: [0, 0, 1, 0, 0, 0],
        f_bak_flag: [0, 0, 0, 0, 0, 0],
        e_bak_flag: [0, 0, 0, 0, 0, 0],
        f_plane_from: [0],
        e_plane_from: [1],
        f_now_hps: [70, 74, 52, 45, 27, 36],
        e_now_hps: [15, 18, 37, 48, 90, 13],
      },
      support_attack: {
        support_hourai: {
          damage: [0, 12, 0, 0, 15, 0],
          now_hps: [15, 18, 37, 48, 90, 13],
          cl_list: [0, 2, 0, 0, 1, 0],
          ship_id: [0, 78, 0, 0, 83, 0],
        },
      },
      opening_taisen: [
        {
          at: 3,
          at_eflag: 0,
          df: [5],
          damage: [11],
          cl: [2],
          si: [46, 45],
          f_now_hps: [70, 74, 52, 45, 27, 36],
          e_now_hps: [15, 18, 37, 48, 90, 13],
        },
      ],
      opening_raigeki: {
        frai: [1],
        erai: [4],
        edam: [8, 0, 0, 0, 0, 0],
        fdam: [0, 0, 0, 6, 0, 0],
        ecl_list: [2, 0, 0, 0, 0, 0],
        fcl_list: [0, 0, 0, 2, 0, 0],
        f_now_hps: [70, 74, 52, 45, 27, 36],
        e_now_hps: [15, 18, 37, 48, 90, 13],
      },
      hougeki: [
        {
          at: 1,
          at_eflag: 0,
          df: [2],
          damage: [17],
          cl: [2],
          si: [2, 25, 28],
          f_now_hps: [70, 74, 52, 45, 27, 36],
          e_now_hps: [15, 18, 37, 48, 90, 13],
        },
        {
          at: 3,
          at_eflag: 1,
          df: [2],
          damage: [18],
          cl: [1],
          si: [],
          f_now_hps: [70, 74, 52, 45, 27, 36],
          e_now_hps: [15, 18, 37, 48, 90, 13],
        },
      ],
      closing_raigeki: {
        frai: [0, 2],
        erai: [2],
        edam: [0, 0, 14, 0, 0, 0],
        fdam: [0, 0, 8, 0, 0, 0],
        ecl_list: [0, 0, 2, 0, 0, 0],
        fcl_list: [0, 0, 2, 0, 0, 0],
        f_now_hps: [70, 74, 52, 45, 27, 36],
        e_now_hps: [15, 18, 37, 48, 90, 13],
      },
      friendly_force_attack: {
        fleet_info: {
          ship_id: [144, 145, 20],
          now_hps: [52, 45, 36],
          max_hps: [58, 49, 39],
        },
        support_hourai: {
          flare_pos: [0, -1],
          hougeki: [
            {
              at: 0,
              at_eflag: 0,
              df: [4],
              damage: [26],
              cl: [2],
              si: [58, 58, 28],
              f_now_hps: [70, 74, 34, 39, 27, 36],
              e_now_hps: [7, 13, 14, 37, 58, 2],
            },
          ],
        },
      },
      night_support_attack: {
        hourai: {
          damage: [0, 0, 0, 0, 16, 0],
          now_hps: [7, 13, 14, 37, 58, 2],
          cl_list: [0, 0, 0, 0, 2, 0],
          ship_id: [0, 0, 0, 0, 78, 0],
        },
      },
      midnight_hougeki: [
        {
          at: 2,
          at_eflag: 0,
          df: [4],
          damage: [31],
          cl: [2],
          si: [15, 15, 27],
          f_now_hps: [70, 74, 34, 39, 27, 36],
          e_now_hps: [7, 13, 14, 37, 58, 2],
        },
      ],
    },
  },
};

const sampleFleetSlots = [
  ...STORYBOOK_SAMPLE_FLEET.fleet1,
  ...STORYBOOK_SAMPLE_FLEET.fleet2,
];

const enemyMaxHpById: Record<number, number> = {
  1501: 15,
  1502: 18,
  1505: 37,
  1509: 48,
  1511: 90,
  1512: 85,
  1530: 13,
};

function createPhaseScenarioTables(
  envUuid: string,
  template: (typeof phaseScenarioTemplates)[StorybookBattleScenario],
): BattleDetailTables {
  const battle: Record<string, unknown> = {
    ...template.battle,
    env_uuid: envUuid,
    e_deck_id: `${envUuid}-enemy-deck`,
  };
  const ownShipGroup = `${envUuid}-own-ships`;
  const enemyShipGroup = `${envUuid}-enemy-ships`;
  const friendlyHps = Array.isArray(battle["f_nowhps"])
    ? battle["f_nowhps"].map(Number)
    : [];
  const enemyHps = Array.isArray(battle["e_nowhps"])
    ? battle["e_nowhps"].map(Number)
    : [];
  const ownShip: Record<string, unknown>[] = [];
  const ownSlotItem: Record<string, unknown>[] = [];
  for (const [index, shipId] of template.friendlyShipIds.entries()) {
    const masterShip = STORYBOOK_SAMPLE_SHIPS.find((ship) => ship.id === shipId);
    if (!masterShip) throw new Error(`Unknown Storybook ship ${shipId}.`);
    const slotGroup = `${envUuid}-slot-${index}`;
    ownShip.push({
      uuid: ownShipGroup,
      env_uuid: envUuid,
      index,
      mst_ship_id: shipId,
      nowhp: friendlyHps[index] ?? masterShip.taik?.[1] ?? 30,
      maxhp: masterShip.taik?.[1] ?? 30,
      lv: 99,
      slot: slotGroup,
    });
    const loadout = sampleFleetSlots.find((slot) => slot.shipId === shipId);
    for (const [slotIndex, itemId] of (loadout?.equipIds ?? []).entries()) {
      if (itemId === null) continue;
      ownSlotItem.push({
        uuid: slotGroup,
        env_uuid: envUuid,
        index: slotIndex,
        mst_slotitem_id: itemId,
        level: loadout?.equipImprovement[slotIndex] ?? 0,
      });
    }
  }
  const enemyShip = template.enemyShipIds.map((shipId, index) => {
    const maxhp = enemyMaxHpById[shipId];
    if (maxhp === undefined) throw new Error(`Unknown Storybook enemy ship ${shipId}.`);
    return {
      uuid: enemyShipGroup,
      env_uuid: envUuid,
      index,
      mst_ship_id: shipId,
      nowhp: enemyHps[index] ?? maxhp,
      maxhp,
    };
  });
  const openingTaisenLists: Record<string, unknown>[] = [];
  const openingTaisens: Record<string, unknown>[] = [];
  const midnightHougekiLists: Record<string, unknown>[] = [];
  const midnightHougekis: Record<string, unknown>[] = [];
  const hougekiLists: Record<string, unknown>[] = [];
  const hougekis: Record<string, unknown>[] = [];
  const openingAirattackLists: Record<string, unknown>[] = [];
  const openingAirattacks: Record<string, unknown>[] = [];
  const openingRaigeki: Record<string, unknown>[] = [];
  const closingRaigeki: Record<string, unknown>[] = [];
  const airbaseAssault: Record<string, unknown>[] = [];
  const airbaseAirattackLists: Record<string, unknown>[] = [];
  const airbaseAirattacks: Record<string, unknown>[] = [];
  const carrierbaseAssault: Record<string, unknown>[] = [];
  const supportHourai: Record<string, unknown>[] = [];
  const nightSupportHourai: Record<string, unknown>[] = [];
  const friendlySupportHouraiLists: Record<string, unknown>[] = [];
  const friendlySupportHourai: Record<string, unknown>[] = [];

  const asRecord = asStorybookRecord;
  const asRecords = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value)
      ? value.flatMap((item) => {
          const record = asRecord(item);
          return record ? [record] : [];
        })
      : asRecord(value)
        ? [asRecord(value)!]
        : [];
  const linkDetails = (
    field: string,
    listRows: Record<string, unknown>[],
    detailRows: Record<string, unknown>[],
    listField: string,
    includeRoundIndex = false,
  ) => {
    const records = asRecords(battle[field]);
    if (records.length === 0) return;
    const listUuid = `${envUuid}-${field}-list`;
    const detailUuid = `${envUuid}-${field}-details`;
    battle[field] = listUuid;
    listRows.push({
      uuid: listUuid,
      env_uuid: envUuid,
      index: 0,
      [listField]: detailUuid,
    });
    for (const [index, record] of records.entries()) {
      detailRows.push({
        ...record,
        uuid: detailUuid,
        env_uuid: envUuid,
        index,
        ...(includeRoundIndex ? { index_1: index } : {}),
      });
    }
  };
  const linkDirectRecord = (
    field: string,
    rows: Record<string, unknown>[],
  ) => {
    const record = asRecord(battle[field]);
    if (!record) return;
    const uuid = `${envUuid}-${field}`;
    battle[field] = uuid;
    rows.push({ ...record, uuid, env_uuid: envUuid, index: 0 });
  };

  linkDetails(
    "opening_taisen",
    openingTaisenLists,
    openingTaisens,
    "opening_taisen",
  );
  linkDetails(
    "midnight_hougeki",
    midnightHougekiLists,
    midnightHougekis,
    "midnight_hougeki",
  );
  linkDetails("hougeki", hougekiLists, hougekis, "hougeki", true);
  linkDetails(
    "opening_air_attack",
    openingAirattackLists,
    openingAirattacks,
    "opening_air_attack",
  );
  linkDirectRecord("opening_raigeki", openingRaigeki);
  linkDirectRecord("closing_raigeki", closingRaigeki);
  linkDirectRecord("air_base_assault", airbaseAssault);
  linkDirectRecord("carrier_base_assault", carrierbaseAssault);

  const airbaseAttackRecords = asRecords(battle["air_base_air_attacks"]);
  if (airbaseAttackRecords.length > 0) {
    const listUuid = `${envUuid}-air-base-air-attacks-list`;
    battle["air_base_air_attacks"] = listUuid;
    airbaseAirattackLists.push({
      uuid: listUuid,
      env_uuid: envUuid,
      index: 0,
      air_base_air_attack: airbaseAttackRecords.map((_, index) =>
        `${envUuid}-air-base-air-attack-${index}`,
      ),
    });
    for (const [index, record] of airbaseAttackRecords.entries()) {
      airbaseAirattacks.push({
        ...record,
        uuid: `${envUuid}-air-base-air-attack-${index}`,
        env_uuid: envUuid,
        index,
      });
    }
  }

  const supportAttack = asRecord(battle["support_attack"]);
  const supportHouraiRecord = asRecord(supportAttack?.["support_hourai"]);
  if (supportHouraiRecord) {
    const uuid = `${envUuid}-support-hourai`;
    battle["support_hourai"] = uuid;
    supportHourai.push({
      ...supportHouraiRecord,
      uuid,
      env_uuid: envUuid,
      index: 0,
    });
  }
  const nightSupportAttack = asRecord(battle["night_support_attack"]);
  const nightSupportRecord = asRecord(nightSupportAttack?.["hourai"]);
  if (nightSupportRecord) {
    const uuid = `${envUuid}-night-support-hourai`;
    battle["night_support_hourai"] = uuid;
    nightSupportHourai.push({
      ...nightSupportRecord,
      uuid,
      env_uuid: envUuid,
      index: 0,
    });
  }

  const friendlyForceAttack = asRecord(battle["friendly_force_attack"]);
  const friendlySupportRecord = asRecord(
    friendlyForceAttack?.["support_hourai"],
  );
  if (friendlySupportRecord) {
    const listUuid = `${envUuid}-friendly-support-hourai-list`;
    const detailUuid = `${envUuid}-friendly-support-hourai`;
    battle["friendly_force_attack"] = listUuid;
    friendlySupportHouraiLists.push({
      uuid: listUuid,
      env_uuid: envUuid,
      index: 0,
      friendly_support_hourai: detailUuid,
    });
    friendlySupportHourai.push({
      ...friendlySupportRecord,
      uuid: detailUuid,
      env_uuid: envUuid,
      index: 0,
    });
  }

  return {
    ...sampleBattleTables,
    battle: [battle],
    cells: [
      {
        uuid: `${envUuid}-cell`,
        env_uuid: envUuid,
        battles: String(battle["uuid"]),
        maparea_id: Number(battle["maparea_id"]),
        mapinfo_no: Number(battle["mapinfo_no"]),
        cell_index: [1, Number(battle["cell_id"])],
        battle_index: [0],
      },
    ],
    battleResult: [],
    ownDeck: [
      {
        uuid: `${envUuid}-own-deck`,
        env_uuid: envUuid,
        ship_ids: [ownShipGroup],
      },
    ],
    ownShip,
    ownSlotItem,
    enemyDeck: [
      {
        uuid: `${envUuid}-enemy-deck`,
        env_uuid: envUuid,
        ship_ids: [enemyShipGroup],
      },
    ],
    enemyShip,
    enemySlotItem: [],
    openingTaisenLists,
    openingTaisens,
    midnightHougekiLists,
    midnightHougekis,
    hougekiLists,
    hougekis,
    openingAirattackLists,
    openingAirattacks,
    openingRaigeki,
    closingRaigeki,
    airbaseAssault,
    airbaseAirattackLists,
    airbaseAirattacks,
    carrierbaseAssault,
    supportHourai,
    nightSupportHourai,
    friendlySupportHouraiLists,
    friendlySupportHourai,
  };
}

export function getStorybookBattleScenario(
  scenario: StorybookBattleScenario,
) {
  const template = phaseScenarioTemplates[scenario];
  const envUuid = String(template.battle["env_uuid"] ?? `storybook-${scenario}`);
  const result = resolveBattleDetail({
    periodTag: STORYBOOK_SAMPLE_PERIOD.period_tag,
    tableVersion: STORYBOOK_SAMPLE_PERIOD.table_version,
    envUuid,
    battleIndex: 0,
    masterShips: STORYBOOK_SAMPLE_BATTLE_SHIPS,
    masterSlotItems: STORYBOOK_SAMPLE_SLOT_ITEMS,
    tables: createPhaseScenarioTables(envUuid, template),
  });
  if (!result?.payload.battle || result.unresolvedReferences > 0) {
    throw new Error(`Storybook ${scenario} battle fixture could not be resolved.`);
  }
  const payload = withStorybookShipBanners(result.payload);
  const friendlyForceAttack = asStorybookRecord(
    payload.battle?.["friendly_force_attack"],
  );
  const fleetInfo = asStorybookRecord(
    asStorybookRecord(template.battle["friendly_force_attack"])?.["fleet_info"],
  );
  if (friendlyForceAttack && fleetInfo) {
    friendlyForceAttack["fleet_info"] = fleetInfo;
  }
  return payload;
}

export function getStorybookBattleOverview(
  periodTag = STORYBOOK_SAMPLE_PERIOD.period_tag,
  tableVersion: string | null = STORYBOOK_SAMPLE_PERIOD.table_version,
) {
  const payload = buildBattleOverviewPayload({
    periodTag,
    tableVersion,
    battles: sampleBattleRecords,
    cells: sampleCells,
    battleResults: sampleBattleResults,
    mstShips: STORYBOOK_SAMPLE_BATTLE_SHIPS,
    enemyDecks: sampleEnemyDecks,
    enemyShips: sampleEnemyShips,
  });
  return {
    ...payload,
    enemy_decks: sampleEnemyDecks,
    enemy_ships: sampleEnemyShips,
  };
}

export function getStorybookBattleDrops(
  periodTag = STORYBOOK_SAMPLE_PERIOD.period_tag,
  tableVersion: string | null = STORYBOOK_SAMPLE_PERIOD.table_version,
) {
  return buildBattleDropsPayload({
    periodTag,
    tableVersion,
    battles: sampleBattleRecords,
    cells: sampleCells,
    battleResults: sampleBattleResults,
    mstShips: STORYBOOK_SAMPLE_SHIPS,
  });
}

export function getStorybookBattleDetail(
  envUuid = STORYBOOK_SAMPLE_SORTIE_ID,
  battleIndex = 0,
  periodTag = STORYBOOK_SAMPLE_PERIOD.period_tag,
  tableVersion: string | null = STORYBOOK_SAMPLE_PERIOD.table_version,
) {
  const payload = resolveBattleDetail({
    periodTag,
    tableVersion,
    envUuid,
    battleIndex,
    masterShips: STORYBOOK_SAMPLE_BATTLE_SHIPS,
    masterSlotItems: STORYBOOK_SAMPLE_SLOT_ITEMS,
    tables: sampleBattleTables,
  })?.payload ?? null;
  return payload ? withStorybookShipBanners(payload) : null;
}

export function getStorybookRecords(table: string): Record<string, unknown>[] {
  const recordsByTable: Record<string, Record<string, unknown>[]> = {
    battle: sampleBattleRecords,
    cells: sampleCells,
    battle_result: sampleBattleResults,
    enemy_deck: sampleEnemyDecks,
    enemy_ship: sampleEnemyShips,
    own_ship: sampleOwnShips,
    mst_ship: STORYBOOK_SAMPLE_BATTLE_SHIPS,
    mst_slotitem: STORYBOOK_SAMPLE_SLOT_ITEMS,
  };
  return recordsByTable[table] ?? [];
}

export interface StorybookPageApiResponse {
  status: number;
  body: unknown;
}

function isPageDataEndpoint(pathname: string): boolean {
  return [
    "/api/api-keys",
    "/api/battle-data/",
    "/api/fleet/",
    "/api/master-data/json",
    "/api/ship-growth/",
  ].some((prefix) => pathname.startsWith(prefix));
}

export function getStorybookPageApiResponse(
  pathname: string,
  searchParams: URLSearchParams,
  method: string,
  scenario: PageMockScenario,
): StorybookPageApiResponse | null {
  if (scenario === "error" && isPageDataEndpoint(pathname)) {
    const body = pathname.startsWith("/api/ship-growth/")
      ? { ok: false, error: "Storybook mock request failed." }
      : { success: false, error: "Storybook mock request failed." };
    return { status: 503, body };
  }

  const isEmpty = scenario === "empty";
  const ships = isEmpty ? [] : STORYBOOK_SAMPLE_SHIPS;
  const slotItems = isEmpty ? [] : STORYBOOK_SAMPLE_SLOT_ITEMS;
  const metadata = {
    period_tag: STORYBOOK_SAMPLE_PERIOD.period_tag,
    period_revision: 1,
    table_version: STORYBOOK_SAMPLE_PERIOD.table_version,
  };

  if (pathname === "/api/master-data/json") {
    const tableName = searchParams.get("table_name");
    const recordsByTable: Record<string, Record<string, unknown>[]> = {
      mst_ship: ships,
      mst_slotitem: slotItems,
      mst_map_area: [{ id: 1, name: "鎮守府海域" }],
      mst_map_info: [{ maparea_id: 1, no: 1, name: "鎮守府正面海域" }],
    };
    return {
      status: 200,
      body: {
        ...metadata,
        records: tableName ? recordsByTable[tableName] ?? [] : ships,
      },
    };
  }

  if (pathname === "/api/ship-growth/summary") {
    return {
      status: 200,
      body: {
        ok: true,
        periods: isEmpty ? [] : STORYBOOK_SAMPLE_PERIODS,
        cumulative_available: !isEmpty,
        archive_object_count: isEmpty ? 0 : STORYBOOK_SAMPLE_PERIODS.length,
      },
    };
  }

  if (pathname === "/api/ship-growth/exp") {
    return {
      status: 200,
      body: {
        ok: true,
        exp: isEmpty
          ? []
          : [
              { lv: 1, exp_current: 0 },
              { lv: 10, exp_current: 5_000 },
              { lv: 25, exp_current: 60_000 },
              { lv: 50, exp_current: 300_000 },
              { lv: 99, exp_current: 1_000_000 },
            ],
      },
    };
  }

  if (
    pathname === "/api/ship-growth/bounds" ||
    pathname === "/api/ship-growth/cumulative"
  ) {
    const masterId = Number(searchParams.get("master_id")) || 1;
    return {
      status: 200,
      body: {
        ok: true,
        bounds: isEmpty ? [] : growthBounds(masterId),
        caps: isEmpty ? [] : growthCaps(masterId),
      },
    };
  }

  if (pathname === "/api/ship-growth/all-periods") {
    const masterId = Number(searchParams.get("master_id")) || 1;
    return {
      status: 200,
      body: {
        ok: true,
        entries: isEmpty
          ? []
          : STORYBOOK_SAMPLE_PERIODS.map((period, index) => ({
              ...period,
              bounds: growthBounds(masterId, index),
              caps: growthCaps(masterId, index),
            })),
      },
    };
  }

  if (pathname === "/api/api-keys") {
    if (method === "POST") {
      return {
        status: 200,
        body: { success: true, api_key: { key: "storybook-sample-api-key" } },
      };
    }
    return {
      status: 200,
      body: {
        success: true,
        api_keys: isEmpty
          ? []
          : [
              {
                id: 1,
                key_masked: "fusou_••••••••••••sample",
                is_active: true,
                created_at: "2026-02-13T08:30:00.000Z",
              },
            ],
      },
    };
  }

  if (pathname === "/api/api-keys/devices") {
    return {
      status: 200,
      body: {
        success: true,
        devices: isEmpty
          ? []
          : [
              {
                id: 1,
                device_name: "Storybook Desktop",
                client_id_masked: "client_••••sample",
                created_at: "2026-02-12T10:00:00.000Z",
                last_used_at: "2026-02-13T08:30:00.000Z",
              },
            ],
      },
    };
  }

  if (pathname === "/api/api-keys/usage") {
    return {
      status: 200,
      body: { success: true, usage: { remaining: isEmpty ? 1000 : 742 } },
    };
  }

  if (pathname === "/api/fleet/snapshots/list") {
    return {
      status: 200,
      body: {
        ok: true,
        tags: isEmpty
          ? []
          : [
              {
                tag: "storybook-sample-fleet",
                uploaded: "2026-02-13T08:30:00.000Z",
                size: 2,
              },
            ],
      },
    };
  }

  if (pathname.startsWith("/api/fleet/snapshot/")) {
    return {
      status: 200,
      body:
        method === "DELETE"
          ? { ok: true }
          : { ok: true, snapshot: STORYBOOK_SAMPLE_FLEET },
    };
  }

  if (pathname === "/api/battle-data/global/summary") {
    return {
      status: 200,
      body: { periods: isEmpty ? [] : STORYBOOK_SAMPLE_PERIODS },
    };
  }

  if (pathname === "/api/battle-data/global/overview") {
    return {
      status: 200,
      body: isEmpty
        ? {
            success: true,
            ...metadata,
            battles: [],
            cells: [],
            enemy_decks: [],
            enemy_ships: [],
          }
        : getStorybookBattleOverview(),
    };
  }

  if (pathname === "/api/battle-data/global/drops") {
    return {
      status: 200,
      body: isEmpty
        ? { success: true, ...metadata, battles: [], mst_ships: [] }
        : getStorybookBattleDrops(),
    };
  }

  if (pathname === "/api/battle-data/global/records") {
    const records = isEmpty
      ? []
      : getStorybookRecords(searchParams.get("table") ?? "");
    return {
      status: 200,
      body: { success: true, records, count: records.length },
    };
  }

  if (pathname === "/api/battle-data/detail") {
    const envUuid = searchParams.get("env_uuid") ?? STORYBOOK_SAMPLE_SORTIE_ID;
    const battleIndex = Number(searchParams.get("battle_index") ?? 0);
    const detail = isEmpty
      ? null
      : getStorybookBattleDetail(
          envUuid,
          battleIndex,
          searchParams.get("period_tag") ?? STORYBOOK_SAMPLE_PERIOD.period_tag,
          searchParams.get("table_version") ?? STORYBOOK_SAMPLE_PERIOD.table_version,
        );
    if (!isEmpty && !detail) {
      return {
        status: 404,
        body: { success: false, error: "Storybook battle detail not found." },
      };
    }
    return {
      status: 200,
      body: isEmpty
        ? { success: true, battle: null }
        : detail,
    };
  }

  if (pathname === "/api/battle-data/detail-env") {
    const envUuid = searchParams.get("env_uuid") ?? STORYBOOK_SAMPLE_SORTIE_ID;
    const details = [0, 1].flatMap((battleIndex) => {
      const detail = getStorybookBattleDetail(
        envUuid,
        battleIndex,
        searchParams.get("period_tag") ?? STORYBOOK_SAMPLE_PERIOD.period_tag,
        searchParams.get("table_version") ?? STORYBOOK_SAMPLE_PERIOD.table_version,
      );
      return detail ? [[battleIndex, detail] as const] : [];
    });
    if (!isEmpty && details.length === 0) {
      return {
        status: 404,
        body: { success: false, error: "Storybook sortie details not found." },
      };
    }
    return {
      status: 200,
      body: {
        success: true,
        env_uuid: envUuid,
        period_tag: STORYBOOK_SAMPLE_PERIOD.period_tag,
        table_version: STORYBOOK_SAMPLE_PERIOD.table_version,
        battles: isEmpty ? {} : Object.fromEntries(details),
      },
    };
  }

  return null;
}
