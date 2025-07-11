import { css, html, LitElement, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeCSS } from "lit";
import globalStyles from "../global.css?inline";
import fontStyles from "../font.css?inline";
import get_data from "../data/S@api_start2@getData.json";
// import require_info from "../data/S@api_get_member@require_info.json";
import common_itemicons from "../data/common_itemicons.json";
import common_itemicons_png from "../data/common_itemicons.png";
import { ifDefined } from "lit/directives/if-defined.js";

export interface IconMaterialProps {
  item_number: number;
  size?: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
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
  9: ["UN", 0], //  undifined
  10: ["A2", 1], //  家具箱（小）
  11: ["B2", 1], //  家具箱（中）
  12: ["C2", 1], //  家具箱（大）
  13: ["UN", 0], //  undifined
  14: ["UN", 0], //  undifined
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
  30: ["UN", 0], //  undifined
  31: ["A0", 4], //  燃料
  32: ["B0", 4], //  弾薬
  33: ["C0", 4], //  鋼材
  34: ["D0", 4], //  ボーキサイト
  35: ["UN", 0], //  undifined
  36: ["UN", 0], //  undifined
  37: ["UN", 0], //  undifined
  38: ["UN", 0], //  undifined
  39: ["UN", 0], //  undifined
  40: ["UN", 0], //  undifined
  41: ["UN", 0], //  undifined
  42: ["UN", 0], //  undifined
  43: ["UN", 0], //  undifined
  44: ["E0", 5], //  家具コイン
  45: ["UN", 0], //  undifined
  46: ["UN", 0], //  undifined
  47: ["UN", 0], //  undifined
  48: ["UN", 0], //  undifined
  49: ["D3", 1], //  ドック開放キー
  50: ["E3", 1], //  応急修理要員
  51: ["F3", 1], //  応急修理女神
  52: ["F2", 1], //  特注家具職人
  53: ["D3", 3], //  母港拡張
  54: ["D2", 1], //  給糧艦「間宮」
  55: ["A1", 1], //  書類一式＆指輪
  56: ["F1", 1], //  艦娘からのチョコ
  57: ["B1", 1], //  勲章
  58: ["E2", 1], //  改装設計図
  59: ["D1", 1], //  給糧艦「伊良湖」
  60: ["E1", 1], //  プレゼント箱
  61: ["G1", 1], //  甲種勲章
  62: ["LT", 1], //  菱餅
  63: ["G2", 1], //  司令部要員
  64: ["H2", 1], //  補強増設
  65: ["B4", 1], //  試製カタパルト
  66: ["E4", 1], //  戦闘糧食
  67: ["F4", 1], //  洋上補給
  68: ["LT", 1], //  秋刀魚
  69: ["D4", 1], //  秋刀魚の缶詰
  70: ["A4", 1], //  熟練搭乗員
  71: ["C4", 1], //  ネ式エンジン
  72: ["LT", 1], //  お飾り材料
  73: ["G4", 1], //  設営隊
  74: ["H1", 1], //  新型航空機設計図
  75: ["A2", 2], //  新型砲熕兵装資材
  76: ["A3", 2], //  戦闘糧食(特別なおにぎり)
  77: ["B2", 2], //  新型航空兵装資材
  78: ["C1", 2], //  戦闘詳報
  79: ["UC", 6], //  海峡章
  80: ["LT", 2], //  Xmas Select Gift Box
  81: ["UC", 6], //  捷号章
  82: ["UC", 6], //  捷号章
  83: ["UC", 6], //  捷号章
  84: ["UC", 6], //  捷号章
  85: ["LT", 2], //  お米
  86: ["LT", 2], //  梅干し
  87: ["LT", 2], //  海苔
  88: ["LT", 2], //  お茶
  89: ["LT", 2], //  鳳翔さん鳳翔食券
  90: ["LT", 2], //  節分の豆
  91: ["B3", 2], //  緊急修理資材
  92: ["C2", 2], //  新型噴進装備開発資材
  93: ["LT", 1], //  鰯
  94: ["C3", 2], //  新型兵装資材
  95: ["H4", 1], //  潜水艦補給物資
  96: ["LT", 2], //  南瓜
  97: ["LT", 1], //  てるてる坊主
  98: ["A4", 2], //  海色リボン
  99: ["B4", 2], //  白たすき
  100: ["D2", 2], //  海外艦最新技術
  101: ["D1", 2], //  夜間熟練搭乗員
  102: ["D4", 2], //
};

const class_size = {
  xs: "h-6",
  sm: "h-8",
  md: "h-12",
  lg: "h-20",
  xl: "h-36",
  full: "h-full",
  none: "",
};

const get_primary_color = (item_number: number) => {
  return icon_list[item_list[item_number ?? 0][1]][0];
};

const get_name = (item_number: number) => {
  return item_list[item_number ?? 0][0];
};

const bg_slash = [0, 1, 2, 3, 4, 5, 6, 7].map(
  (i) => svg`
    <path
      d="M${i * 12 + 28 + 3} 132 ${i * 12 + 34 + 3} 116"
      stroke="#303030"
      stroke-width="0.5"
      fill="none"
      fill-rule="evenodd"
    ></path>
  `
);

@customElement("icon-material")
export class IconMaterial extends LitElement {
  static styles = [
    css`
      .roboto-mono-500 {
        font-family: "Roboto Mono", monospace;
        font-optical-sizing: auto;
        font-weight: 500;
        font-style: normal;
      }
    `,
    unsafeCSS(globalStyles),
    unsafeCSS(fontStyles),
  ];

  @property({ type: Number })
  item_number = 0;

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  render() {
    let name = get_name(this.item_number);
    let primary_color = get_primary_color(this.item_number);

    return html` <svg
      fill="currentColor"
      stroke-width="1.5"
      stroke="currentColor"
      viewBox="0 0 151 151"
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      overflow="hidden"
      class=${[
        "text-base-content",
        "fill-base-content",
        class_size[this.size],
      ].join(" ")}
    >
      <text
        class="roboto-mono-500"
        font-size="96"
        textLength="96"
        lengthAdjust="spacingAndGlyphs"
        transform="translate(28 104)"
      >
        ${name}
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
        stroke="${primary_color}"
        stroke-width="16"
        stroke-miterlimit="8"
        fill="none"
        fill-rule="evenodd"
      />
      ${bg_slash}
    </svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "icon-material": IconMaterial;
  }
}

export const IconMaterialBasic = (args: IconMaterialProps) => {
  return html`<icon-material
    item_number=${args.item_number}
    size=${ifDefined(args.size)}
  ></icon-material>`;
};

export const IconMaterialCatalog = () => {
  return html`<div class="grid grid-cols-10 w-100 gap-4">
    ${Object.keys(item_list).map(
      (item_number) =>
        html`<icon-material
          item_number=${Number(item_number)}
          size=${"xs"}
        ></icon-material>`
    )}
  </div>`;
};

export const IconMaterialCatalogDetail = () => {
  console.log(get_data.api_data.api_mst_useitem);

  const itemicon_id_name = get_data.api_data.api_mst_useitem.map((icon) => [
    icon.api_id,
    icon.api_name,
  ]);

  const itemicons_frames = common_itemicons.frames;

  const bg_scale = 0.6;

  return html`<div class="grid gap-4">
    ${itemicon_id_name.map(([id, name]) => {
      try {
        let itemicons_frame = (itemicons_frames as any)[
          `common_itemicons_id_${id}`
        ].frame;
        return html`<div class="flex h-12 items-center">
          <h1 class="w-20">${id}</h1>
          <icon-material
            item_number=${Number(id)}
            size=${"md"}
            class="w-20 h-full"
          ></icon-material>
          <div class="w-20 h-full">
            <div
              class="h-full"
              style=${`overflow: hidden;
              background-size: ${635 * bg_scale}px, ${635 * bg_scale}px;
              width: ${itemicons_frame.w * bg_scale}px;
              hieght: ${itemicons_frame.h * bg_scale}px;
              background-position: top -${itemicons_frame.y * bg_scale}px left -${itemicons_frame.x * bg_scale}px;
                background-image: url('${common_itemicons_png}');`}
            ></div>
          </div>
          <div class="w-40">${name}</div>
        </div>`;
      } catch (e) {
        return html`<div class="flex h-12 items-center">
          <h1 class="w-20">${id}</h1>
          <icon-material
            item_number=${Number(id)}
            size=${"md"}
            class="w-20 h-full"
          ></icon-material>
          <div class="w-20">no keys</div>
          <div class="w-40">${name}</div>
        </div>`;
      }
    })}
  </div>`;
};
