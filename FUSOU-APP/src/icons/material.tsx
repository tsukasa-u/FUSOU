import { createMemo, JSX } from "solid-js";

interface MaterialProps {
  item_number: number;
}

const icon_list: { [key: number]: string[] } = {
  0: ["#FFFFFF"], //  Undefined
  1: ["#684329"], //  owned items
  2: ["#595959"], //  expand items
  3: ["#1E1E1E"], //  parchased items
  4: ["#CCCC00"], //  display only front
  5: ["#00CCCC"], //  display only furniture store
  6: ["#CC00CC"], //  display only infomation
};

const item_list: { [key: number]: [string, number] } = {
  0: ["  ", 0], //  undifined
  1: ["A3", 1], //  高速修復材
  2: ["B3", 1], //  高速建造材
  3: ["C3", 1], //  開発資材
  4: ["C1", 1], //  改修資材
  5: ["UN", 0], //  undifined
  6: ["UN", 0], //  undifined
  7: ["UN", 0], //  undifined
  8: ["UN", 0], //  undifined
  9: ["A2", 1], //  家具箱（小）
  10: ["B2", 1], //  家具箱（中）
  14: ["C2", 1], //  家具箱（大）
  15: ["UN", 0], //  undifined
  16: ["UN", 0], //  undifined
  17: ["UN", 0], //  undifined
  18: ["UN", 0], //  undifined
  19: ["UN", 0], //  undifined
  20: ["UN", 0], //  undifined
  21: ["UN", 0], //  undifined
  22: ["UN", 0], //  undifined
  23: ["UN", 0], //  undifined
  24: ["UN", 0], //  undifined
  25: ["UN", 0], //  undifined
  26: ["UN", 0], //  undifined
  27: ["UN", 0], //  undifined
  28: ["UN", 0], //  undifined
  29: ["UN", 0], //  undifined
  30: ["A0", 4], //  燃料
  31: ["B0", 4], //  弾薬
  32: ["C0", 4], //  鋼材
  33: ["D0", 4], //  ボーキサイト
  34: ["UN", 0], //  undifined
  35: ["UN", 0], //  undifined
  36: ["UN", 0], //  undifined
  37: ["UN", 0], //  undifined
  38: ["UN", 0], //  undifined
  39: ["UN", 0], //  undifined
  40: ["UN", 0], //  undifined
  41: ["UN", 0], //  undifined
  42: ["UN", 0], //  undifined
  43: ["E0", 5], //  家具コイン
  44: ["UN", 0], //  undifined
  45: ["UN", 0], //  undifined
  46: ["UN", 0], //  undifined
  47: ["UN", 0], //  undifined
  48: ["D3", 1], //  ドック開放キー
  49: ["E3", 1], //  応急修理要員
  50: ["F3", 1], //  応急修理女神
  51: ["F2", 1], //  特注家具職人
  52: ["D3", 3], //  母港拡張
  53: ["D2", 1], //  給糧艦「間宮」
  54: ["A1", 2], //  書類一式＆指輪
  55: ["F1", 1], //  艦娘からのチョコ
  56: ["B1", 1], //  勲章
  57: ["E2", 1], //  改装設計図
  58: ["D1", 1], //  給糧艦「伊良湖」
  59: ["E1", 1], //  プレゼント箱
  60: ["G1", 1], //  甲種勲章
  61: ["LT", 1], //  菱餅
  62: ["G2", 1], //  司令部要員
  63: ["H2", 1], //  補強増設
  64: ["B4", 1], //  試製カタパルト
  65: ["E4", 1], //  戦闘糧食
  66: ["F4", 1], //  洋上補給
  67: ["LT", 1], //  秋刀魚
  68: ["D4", 1], //  秋刀魚の缶詰
  69: ["A4", 1], //  熟練搭乗員
  70: ["C4", 1], //  ネ式エンジン
  71: ["LT", 1], //  お飾り材料
  72: ["G4", 1], //  設営隊
  73: ["H1", 1], //  新型航空機設計図
  74: ["A2", 2], //  新型砲熕兵装資材
  75: ["A3", 2], //  戦闘糧食(特別なおにぎり)
  76: ["B2", 2], //  新型航空兵装資材
  77: ["C1", 2], //  戦闘詳報
  78: ["UC", 0], //  海峡章
  79: ["LT", 2], //  Xmas Select Gift Box
  80: ["UC", 6], //  捷号章
  81: ["UC", 6], //  捷号章
  82: ["UC", 6], //  捷号章
  83: ["UC", 6], //  捷号章
  84: ["LT", 2], //  お米
  85: ["LT", 2], //  梅干し
  86: ["LT", 2], //  海苔
  87: ["LT", 2], //  お茶
  88: ["LT", 2], //  鳳翔さん鳳翔食券
  89: ["LT", 2], //  節分の豆
  90: ["B3", 2], //  緊急修理資材
  91: ["C2", 2], //  新型噴進装備開発資材
  92: ["LT", 1], //  鰯
  93: ["C3", 0], //  新型兵装資材
  94: ["H4", 0], //  潜水艦補給物資
  95: ["LT", 2], //  南瓜
  96: ["LT", 1], //  てるてる坊主
  97: ["A4", 2], //  海色リボン
  98: ["B4", 2], //  白たすき
  99: ["D2", 2], //  海外艦最新技術
  100: ["D1", 2], //  夜間熟練搭乗員
};

export function IconMaterial(
  props: JSX.HTMLAttributes<SVGSVGElement> & MaterialProps,
) {
  // let primary_color: string =
  //   icon_list[item_list[props.item_number ?? 0][1]][0];
  const primary_color = createMemo(() => {
    return icon_list[item_list[props.item_number ?? 0][1]][0];
  });

  return (
    <svg
      fill="currentColor"
      stroke-width="1.5"
      stroke="currentColor"
      viewBox="0 0 151 151"
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      overflow="hidden"
      {...props}
    >
      <text
        font-family="monospace,sans-serif"
        font-weight="400"
        font-size="96"
        transform="translate(25 104)"
      >
        {item_list[props.item_number ?? 0][0]}
      </text>
      <path
        d="M9 32C9 19.85 18.85 10 31 10L119 10C131.15 10 141 19.85 141 32L141 120C141 132.15 131.15 142 119 142L31 142C18.85 142 9 132.15 9 120Z"
        stroke="#000000"
        stroke-width="4"
        stroke-linejoin="round"
        stroke-miterlimit="10"
        fill="none"
        fill-rule="evenodd"
      />
      <path
        d="M28 124 124 124"
        stroke={primary_color()}
        stroke-width="16"
        stroke-miterlimit="8"
        fill="none"
        fill-rule="evenodd"
      />
    </svg>
  );
}
export default IconMaterial;
