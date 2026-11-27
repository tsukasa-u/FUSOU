import BattleFleetFormation, {
  type AirBaseFormation,
} from "../../../../../components/features/battle-detail/solid/BattleFleetFormation";
import type {
  MstSlotItemRecord,
  ShipInfo,
} from "../../../../../features/battles/types";
import { bannerUrl } from "../../../../../features/simulator/equip-calc";

const MST_SLOTITEM_BY_ID = new Map<number, MstSlotItemRecord>([
  [168, { id: 168, name: "九六式陸攻", type: [0, 0, 47, 37] }],
  [170, { id: 170, name: "一式陸攻(野中隊)", type: [0, 0, 47, 37] }],
  [176, { id: 176, name: "三式戦 飛燕", type: [0, 0, 48, 44] }],
  [180, { id: 180, name: "一式陸攻 二二型甲", type: [0, 0, 47, 37] }],
  [219, { id: 219, name: "一式戦 隼II型(64戦隊)", type: [0, 0, 48, 44] }],
  [138, { id: 138, name: "二式大艇", type: [0, 0, 41, 33] }],
  [54, { id: 54, name: "彩雲", type: [0, 0, 9, 9] }],
]);

function makeShip(
  shipId: number,
  name: string,
  level: number | null,
  nowhp: number,
  maxhp: number,
  stats: [number, number, number, number],
  equipments: Array<{ name: string; iconType: number; level?: number | null }>,
  escaped = false,
): ShipInfo {
  return {
    shipId,
    name,
    level,
    nowhp,
    maxhp,
    karyoku: stats[0],
    raisou: stats[1],
    taiku: stats[2],
    soukou: stats[3],
    bannerUrl: bannerUrl(shipId, { f: "auto" }),
    equipments: equipments.map((e, i) => ({
      name: e.name,
      iconType: e.iconType,
      level: e.level ?? null,
      slotItemId: 1000 + i,
    })),
    ...(escaped ? { escaped: true } : {}),
  };
}

const FRIENDLY_MAIN: ShipInfo[] = [
  makeShip(591, "金剛改二丙", 155, 82, 82, [138, 42, 84, 94], [
    { name: "35.6cm連装砲改三", iconType: 3, level: 6 },
    { name: "一式徹甲弾改", iconType: 13, level: 7 },
    { name: "零式水上観測機", iconType: 10, level: 6 },
  ]),
  makeShip(954, "榛名改二乙", 148, 58, 84, [132, 0, 96, 92], [
    { name: "試製35.6cm三連装砲", iconType: 3, level: 6 },
    { name: "一式徹甲弾改", iconType: 13, level: 6 },
    { name: "紫雲", iconType: 10 },
  ]),
  makeShip(152, "霧島改二", 142, 82, 82, [144, 0, 78, 92], [
    { name: "41cm三連装砲改二", iconType: 3, level: 6 },
    { name: "一式徹甲弾改", iconType: 13, level: 6 },
    { name: "零式水上偵察機11型乙", iconType: 10, level: 4 },
  ]),
  makeShip(466, "瑞鶴改二", 146, 38, 84, [72, 0, 96, 84], [
    { name: "天山一二型(村田隊)", iconType: 8 },
    { name: "烈風改(三五二空/熟練)", iconType: 6 },
    { name: "彩雲(東カロリン空)", iconType: 9 },
  ]),
  makeShip(623, "夕張改二特", 146, 11, 47, [83, 108, 89, 69], [
    { name: "14cm連装砲改", iconType: 2, level: 6 },
    { name: "甲標的 甲型", iconType: 5 },
    { name: "精鋭水雷戦隊 司令部", iconType: 28 },
  ]),
  makeShip(968, "初月改二", 138, 10, 44, [85, 92, 152, 65], [
    { name: "10cm連装高角砲改+高射装置改", iconType: 16, level: 4 },
    { name: "21号対空電探改二", iconType: 11, level: 4 },
  ], true),
];

const FRIENDLY_ESCORT: ShipInfo[] = [
  makeShip(668, "矢矧改二乙", 146, 56, 58, [92, 118, 94, 76], [
    { name: "15.2cm連装砲改二", iconType: 2, level: 9 },
    { name: "甲標的 丙型", iconType: 5, level: 4 },
    { name: "九八式水上偵察機(夜偵)", iconType: 50, level: 10 },
  ]),
  makeShip(656, "雪風改二", 136, 34, 40, [85, 116, 107, 60], [
    { name: "61cm五連装(酸素)魚雷", iconType: 5, level: 9 },
    { name: "照明弾", iconType: 27 },
  ]),
  makeShip(961, "時雨改三", 132, 39, 39, [87, 112, 119, 60], [
    { name: "61cm四連装(酸素)魚雷後期型", iconType: 5, level: 10 },
    { name: "水雷戦隊 熟練見張員", iconType: 32, level: 8 },
  ]),
  makeShip(543, "長波改二", 131, 18, 38, [88, 110, 72, 56], [
    { name: "12.7cm連装砲D型改二", iconType: 1, level: 6 },
    { name: "61cm五連装(酸素)魚雷", iconType: 5, level: 6 },
  ]),
  makeShip(144, "夕立改二", 131, 36, 36, [84, 98, 82, 53], [
    { name: "12.7cm連装砲B型改四", iconType: 16 },
    { name: "13号対空電探改", iconType: 11 },
  ]),
  makeShip(50, "島風改", 124, 36, 36, [66, 99, 62, 59], [
    { name: "四式水中聴音機", iconType: 18, level: 6 },
    { name: "三式爆雷投射機", iconType: 17, level: 4 },
  ], true),
];

const ENEMY_MAIN: ShipInfo[] = [
  makeShip(1530, "重巡棲姫", 1, 390, 390, [185, 108, 92, 196], [
    { name: "8inch長射程連装砲", iconType: 2 },
    { name: "高速深海魚雷", iconType: 5 },
    { name: "深海棲艦偵察機", iconType: 10 },
  ]),
  makeShip(1543, "戦艦タ級flagship", 1, 90, 90, [108, 0, 70, 96], [
    { name: "16inch三連装砲", iconType: 3 },
    { name: "水上レーダ― Mark.II", iconType: 11 },
  ]),
  makeShip(1543, "戦艦タ級flagship", 1, 90, 90, [108, 0, 70, 96], [
    { name: "16inch三連装砲", iconType: 3 },
    { name: "深海棲艦偵察機", iconType: 10 },
  ]),
  makeShip(1558, "輸送ワ級flagship", 1, 130, 130, [55, 0, 40, 65], [
    { name: "6inch連装速射砲", iconType: 2 },
    { name: "5inch単装高射砲", iconType: 16 },
  ]),
  makeShip(1591, "軽巡ツ級elite", 1, 66, 66, [68, 88, 104, 64], [
    { name: "5inch連装両用莢砲", iconType: 16 },
    { name: "深海ソナー Mk.II", iconType: 18 },
  ]),
  makeShip(1591, "軽巡ツ級", 1, 48, 48, [58, 84, 88, 55], [
    { name: "5inch連装両用莢砲", iconType: 16 },
    { name: "深海棲艦偵察機", iconType: 10 },
  ]),
];

const ENEMY_ESCORT: ShipInfo[] = [
  makeShip(1591, "軽巡ツ級elite", 1, 66, 66, [68, 88, 104, 64], [
    { name: "5inch連装両用莢砲", iconType: 16 },
    { name: "高速深海魚雷", iconType: 5 },
  ]),
  makeShip(1558, "輸送ワ級", 1, 130, 130, [55, 0, 40, 65], [
    { name: "6inch連装速射砲", iconType: 2 },
  ]),
  makeShip(1578, "駆逐ニ級後期型", 1, 40, 40, [48, 84, 38, 33], [
    { name: "5inch連装砲", iconType: 1 },
    { name: "高速深海魚雷", iconType: 5 },
  ]),
  makeShip(1578, "駆逐ニ級後期型", 1, 40, 40, [48, 84, 38, 33], [
    { name: "5inch連装砲", iconType: 1 },
    { name: "高速深海魚雷", iconType: 5 },
  ]),
  makeShip(1578, "駆逐ニ級後期型", 1, 40, 40, [48, 84, 38, 33], [
    { name: "5inch連装砲", iconType: 1 },
    { name: "高速深海魚雷", iconType: 5 },
  ]),
  makeShip(1578, "駆逐ニ級後期型", 1, 40, 40, [48, 84, 38, 33], [
    { name: "5inch連装砲", iconType: 1 },
    { name: "高速深海魚雷", iconType: 5 },
  ]),
];

const SUPPORT_FLEET: ShipInfo[] = [
  makeShip(591, "金剛改二丙", 134, 82, 82, [138, 42, 84, 94], [
    { name: "試製35.6cm三連装砲", iconType: 3 },
    { name: "32号対水上電探", iconType: 11 },
  ]),
  makeShip(954, "榛名改二乙", 129, 84, 84, [132, 0, 96, 92], [
    { name: "41cm三連装砲改二", iconType: 3 },
    { name: "32号対水上電探", iconType: 11 },
  ]),
  makeShip(152, "霧島改二", 130, 82, 82, [144, 0, 78, 92], [
    { name: "41cm連装砲", iconType: 3 },
    { name: "32号対水上電探", iconType: 11 },
  ]),
  makeShip(466, "瑞鶴改二", 126, 84, 84, [64, 0, 74, 68], [
    { name: "彗星一二型甲", iconType: 7 },
    { name: "32号対水上電探", iconType: 11 },
  ]),
  makeShip(195, "綾波改二", 122, 32, 32, [78, 98, 62, 52], [
    { name: "12.7cm連装砲C型改二", iconType: 1 },
    { name: "22号対水上電探改四", iconType: 11 },
  ]),
  makeShip(145, "時雨改二", 125, 31, 31, [76, 96, 78, 51], [
    { name: "12.7cm連装砲B型改二", iconType: 1 },
    { name: "22号対水上電探改四", iconType: 11 },
  ]),
];

const FRIENDLY_FORCE: ShipInfo[] = [
  makeShip(668, "矢矧改二乙", 99, 58, 58, [92, 118, 94, 76], [
    { name: "15.2cm連装砲改二", iconType: 2 },
    { name: "照明弾", iconType: 27 },
  ]),
  makeShip(623, "夕張改二特", 99, 47, 47, [83, 108, 89, 69], [
    { name: "14cm連装砲改", iconType: 2 },
    { name: "61cm五連装(酸素)魚雷", iconType: 5 },
  ]),
  makeShip(656, "雪風改二", 99, 40, 40, [85, 116, 107, 60], [
    { name: "61cm五連装(酸素)魚雷", iconType: 5 },
    { name: "照明弾", iconType: 27 },
  ]),
  makeShip(961, "時雨改三", 99, 39, 39, [87, 112, 119, 60], [
    { name: "61cm四連装(酸素)魚雷後期型", iconType: 5 },
    { name: "熟練見張員", iconType: 32 },
  ]),
  makeShip(543, "長波改二", 99, 38, 38, [88, 110, 72, 56], [
    { name: "12.7cm連装砲D型改二", iconType: 1 },
    { name: "61cm五連装(酸素)魚雷", iconType: 5 },
  ]),
  makeShip(195, "綾波改二", 99, 32, 32, [78, 98, 62, 52], [
    { name: "61cm五連装(酸素)魚雷", iconType: 5 },
    { name: "水雷戦隊 熟練見張員", iconType: 32 },
  ]),
];

const AIRBASES: AirBaseFormation[] = [
  { baseNo: 1, slotItemIds: [219, 170, 180, 168], actionLabel: "出撃", range: 7 },
  { baseNo: 2, slotItemIds: [138, 170, 180, 168], actionLabel: "出撃", range: 8 },
  { baseNo: 3, slotItemIds: [176, 176, 176, 54], actionLabel: "防空", range: 4 },
];

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/BattleFleetFormation",
  component: BattleFleetFormation,
  tags: ["autodocs"],
};

export const SingleFleetFull = {
  args: {
    friendlyShips: FRIENDLY_MAIN,
    enemyShips: ENEMY_MAIN,
    supportShips: SUPPORT_FLEET,
    friendlyForceShips: FRIENDLY_FORCE,
    airBaseFormations: AIRBASES,
    mstSlotItemById: MST_SLOTITEM_BY_ID,
  },
};

export const CombinedFleetFull = {
  args: {
    friendlyShips: [...FRIENDLY_MAIN, ...FRIENDLY_ESCORT],
    enemyShips: [...ENEMY_MAIN, ...ENEMY_ESCORT],
    supportShips: SUPPORT_FLEET,
    friendlyForceShips: FRIENDLY_FORCE,
    airBaseFormations: AIRBASES,
    mstSlotItemById: MST_SLOTITEM_BY_ID,
  },
};

export const StandardNoAux = {
  args: {
    friendlyShips: FRIENDLY_MAIN,
    enemyShips: ENEMY_MAIN,
    mstSlotItemById: MST_SLOTITEM_BY_ID,
  },
};
