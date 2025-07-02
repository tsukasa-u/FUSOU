import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeCSS } from "lit";
import globalStyles from "../global.css?inline";
import get_data from "../data/S@api_start2@getData.json";
import require_info from "../data/S@api_get_member@require_info.json";
import common_icon_weapon from "../data/common_icon_weapon.json";
import common_icon_weapon_png from "../data/common_icon_weapon.png";

export interface EquipmentProps {
  icon_number: number;
  category_number: number;
  size: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
}

// 1 "小口径主砲"
// 2 "中口径主砲"
// 3 "大口径主砲"
// 4 "副砲"
// 5 "魚雷"
// 6 "艦上戦闘機"
// 7 "艦上爆撃機"
// 8 "艦上攻撃機"
// 9 "艦上偵察機"
// 10 "水上偵察機"
// 11 "水上爆撃機"
// 12 "小型電探"
// 13 "大型電探"
// 14 "ソナー"
// 15 "爆雷"
// 16 "追加装甲"
// 17 "機関部強化"
// 18 "対空強化弾"
// 19 "対艦強化弾"
// 20 "VT信管"
// 21 "対空機銃"
// 22 "特殊潜航艇"
// 23 "応急修理要員"
// 24 "上陸用舟艇"
// 25 "オートジャイロ"
// 26 "対潜哨戒機"
// 27 "追加装甲(中型)"
// 28 "追加装甲(大型)"
// 29 "探照灯"
// 30 "簡易輸送部材"
// 31 "艦艇修理施設"
// 32 "潜水艦魚雷"
// 33 "照明弾"
// 34 "司令部施設"
// 35 "航空要員"
// 36 "高射装置"
// 37 "対地装備"
// 38 "大口径主砲（II）"
// 39 "水上艦要員"
// 40 "大型ソナー"
// 41 "大型飛行艇"
// 42 "大型探照灯"
// 43 "戦闘糧食"
// 44 "補給物資"
// 45 "水上戦闘機"
// 46 "特型内火艇"
// 47 "陸上攻撃機"
// 48 "局地戦闘機"
// 49 "陸上偵察機"
// 50 "輸送機材"
// 51 "潜水艦装備"
// 52 "陸戦部隊"
// 53 "大型陸上機"
// 54 "水上艦装備"
// 56 "噴式戦闘機"
// 57 "噴式戦闘爆撃機"
// 58 "噴式攻撃機"
// 59 "噴式偵察機"
// 93 "大型電探（II）"
// 94 "艦上偵察機（II）"
// 95 "副砲（II）"

const icon_list: { [key: number]: string[] } = {
  0: ["#FFFFFF", "#FFFFFF"], //  Undefined
  1: ["#CC3D3D", "#CC3D3D"], //  small-Range Primary Armament
  2: ["#CC3D3D", "#CC3D3D"], //  medium-Range Primary Armament
  3: ["#CC3D3D", "#CC3D3D"], //  large-Range Primary Armament
  4: ["#FFEA00", "#FFEA00"], //  Secondary Armament
  5: ["#5887AB", "#FFEA00"], //  Torpedo
  6: ["#39B74E", "#60C06F"], //  carrier-based fighter
  7: ["#39B74E", "#FF726F"], //  carrier-based dive bomber
  8: ["#39B74E", "#68C1FD"], //  carrier-based torpedo bomber
  9: ["#39B74E", "#FFD500"], //  carrier-based reconnaissance
  10: ["#8FCC98", "#8FCC98"], //  seaplane
  11: ["#DE9437", "#DE9437"], //  radar
  12: ["#46B158", "#46B158"], //  AA shell
  13: ["#D15B5B", "#D15B5B"], //  AP shell
  14: ["#FFFFFF", "#000000"], //  Damage control
  15: ["#66CC77", "#66CC77"], //  AA gun
  16: ["#66CC77", "#66CC77"], //  High-angle gun
  17: ["#7FCCD8", "#7FCCD8"], //  Depth Charge
  18: ["#7FCCD8", "#7FCCD8"], //  Sonar
  19: ["#FFC44C", "#FFC44C"], //  Engine Upgrades
  20: ["#9AA55D", "#9AA55D"], //  Landing Craft
  21: ["#65CA76", "#65CA76"], //  Autogyro
  22: ["#7FCCD8", "#7FCCD8"], //  AntiSubmarine Patrol
  23: ["#997EAE", "#997EAE"], //  Extension Armor
  24: ["#E76B19", "#E76B19"], //  Searchlight
  25: ["#A3A3A3", "#A3A3A3"], //  Supply
  26: ["#B09D7F", "#B09D7F"], //  Machine Tools
  27: ["#FF9A00", "#FF9A00"], //  Flare
  28: ["#CDB1FD", "#CDB1FD"], //  Fleet Command
  29: ["#CDA269", "#CDA269"], //  Maintenance Team
  30: ["#899A4D", "#899A4D"], //  AA Director
  31: ["#FF3637", "#FF3637"], //  Rocket Artillery
  32: ["#BFEB9F", "#BFEB9F"], //  Picket Crew
  33: ["#8FCC98", "#8FCC98"], //  Flying Boat
  34: ["#FFFFFF", "#000000"], //  Ration
  35: ["#61C59E", "#61C59E"], //  Supply
  36: ["#9AA55C", "#9AA55C"], //  Amphibious Vehicle
  37: ["#39B74E", "#38B012"], //  Land Attacker
  38: ["#39B74E", "#87D296"], //  local fighter
  39: ["#48B38F", "#EEB60D"], //  Jet Fight Bomber Keiun
  40: ["#48B38F", "#EEB60D"], //  Jet Fight Bomber Kikka
  41: ["#438358", "#438358"], //  Transport Materials
  42: ["#9FBCE3", "#9FBCE3"], //  Submarine Equipment
  43: ["#8BC595", "#8BC595"], //  Seaplane Fighter
  44: ["#39B74E", "#9CF5AD"], //  Army Fighter
  45: ["#39B74E", "#7976A0"], //  Night Fighter
  46: ["#39B74E", "#7976A0"], //  Night Attacker
  47: ["#39B74E", "#5263BC"], //  Land anti-submarine patrol
  48: ["#000000", "#000000"], //  Unknown
  49: ["#2E8E06", "#3A9F22"], //  Unknown
  50: ["#000000", "#000000"], //  Unknown
  51: ["#000000", "#000000"], //  Unknown
  52: ["#000000", "#000000"], //  Unknown
  53: ["#000000", "#000000"], //  Unknown
  54: ["#000000", "#000000"], //  Unknown
  55: ["#000000", "#000000"], //  Unknown
  56: ["#000000", "#000000"], //  Unknown
  57: ["#000000", "#000000"], //  Unknown
};

const category_list: { [key: number]: string } = {
  0: "  ", //  Undefined
  1: "PA", //  Primary Armament
  2: "SA", //  Secondary Armament
  3: "TO", //  Torpedo
  4: "MS", //  Midget Submarine
  5: "CA", //  Carrier-Based Aircraft
  6: "AA", //  AA Gun
  7: "RE", //  Reconnaissance
  8: "RA", //  Radar
  9: "UP", //  Upgrades
  10: "SO", //  Sonar
  14: "LC", //  Landing Craft
  15: "AG", //  Autogyro
  16: "AS", //  AntiSubmarine Patrol
  17: "EA", //  Extension Armor
  18: "SL", //  Searchlight
  19: "SU", //  Supply
  20: "MT", //  Machine Tools
  21: "FL", //  Flare
  22: "FC", //  Fleet Command
  23: "MT", //  Maintenance Team
  24: "AA", //  AA Director
  25: "AP", //  AP Shell
  26: "RA", //  Rocket Artillery
  27: "PC", //  Picket Crew
  28: "AA", //  AA Shell
  29: "AA", //  AA Rocket
  30: "DC", //  Damage Control
  31: "EU", //  Engine Upgrades
  32: "DC", //  Depth Charge
  33: "FB", //  Flying Boat
  34: "RA", //  Ration
  35: "SU", //  Supply
  36: "MS", //  Multi-purpose Seaplane
  37: "AV", //  Amphibious Vehicle
  38: "LA", //  Land Attacker
  39: "IN", //  Interceptor
  40: "JB", //  Jet Fighting Bomber
  41: "TM", //  Transport Materials
  42: "SE", //  Submarine Equipment
  43: "MS", //  Multi-purpose Seaplane
  44: "HE", //  Helicopter
  45: "DD", //  DD Tank
  46: "HB", //  Heavy Bomber
  47: "UN", //  Unknown
  48: "UN", //  Unknown
};

const class_size = {
  xs: "size-6",
  sm: "size-8",
  md: "size-12",
  lg: "size-20",
  xl: "size-36",
  full: "size-full",
  none: "",
};

const primary_color = (icon_number: number) => icon_list[icon_number ?? 0][0];
const secondary_color = (icon_number: number) => icon_list[icon_number ?? 0][1];

@customElement("equipment-icon")
export class Equipment extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Number })
  icon_number = 0;

  @property({ type: Number })
  category_number = 0;

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  render() {
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
      style=${this.style}
    >
      <text
        font-family="monospace,sans-serif"
        font-weight="400"
        font-size="96"
        transform="translate(25 104)"
      >
        ${category_list[this.category_number]}
      </text>
      <path
        d="M9 32C9 19.85 18.85 10 31 10L119 10C131.15 10 141 19.85 141 32L141 120C141 132.15 131.15 142 119 142L31 142C18.85 142 9 132.15 9 120Z"
        stroke="currentColor"
        stroke-width="4"
        stroke-linejoin="round"
        stroke-miterlimit="10"
        fill="none"
        fill-rule="evenodd"
      />
      <path
        d="M28 124 76 124"
        stroke=${primary_color(this.icon_number)}
        stroke-width="16"
        stroke-miterlimit="8"
        fill="none"
        fill-rule="evenodd"
      />
      <path
        d="M76 124 124 124"
        stroke=${secondary_color(this.icon_number)}
        stroke-width="16"
        stroke-miterlimit="8"
        fill="none"
        fill-rule="evenodd"
      />
    </svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "equipment-icon": Equipment;
  }
}

export const EquipmentBasic = (args: EquipmentProps) => {
  return html`<equipment-icon
    icon_number=${args.icon_number}
    category_number=${args.category_number}
    size=${args.size}
  ></equipment-icon>`;
};

export const EquipmentCatalog = () => {
  const category_icon_number = [
    ...new Set(
      get_data.api_data.api_mst_slotitem.map((x) =>
        String([x.api_type[1], x.api_type[3]])
      )
    ),
  ].map((s) => s.split(",").map((x) => Number(x)));

  return html`<div class="grid grid-cols-10 w-100 gap-4">
    ${category_icon_number.map(
      ([category_number, icon_number]) =>
        html`<equipment-icon
          icon_number=${icon_number}
          category_number=${category_number}
          size=${"xs"}
        ></equipment-icon>`
    )}
  </div>`;
};

export const EquipmentCatalogDetail = () => {
  const category_icon_number = [
    ...new Set(
      get_data.api_data.api_mst_slotitem.map((x) =>
        String([x.api_type[2], x.api_type[3]])
      )
    ),
  ].map((s) => s.split(",").map((x) => Number(x)));

  const category = get_data.api_data.api_mst_slotitem_equiptype;
  // console.log(category);

  const icon_frame = common_icon_weapon.frames;

  return html`<div class="grid gap-4">
    ${category_icon_number.map(([category_number, icon_number]) => {
      try {
        let frame = icon_frame[`common_icon_weapon_id_${icon_number}`].frame;
        return html`<div class="flex h-12 items-center">
          <equipment-icon
            icon_number=${icon_number}
            category_number=${category_number}
            size=${"md"}
            class="w-20 h-full"
          ></equipment-icon>
          <div class="w-20 h-full">
            <div
              class="h-full"
              style=${`overflow: hidden;
                background-repeat: no-repeat;
                width: ${frame.w}px;
                hieght: ${frame.h}px;
                background-position: top -${frame.x}px left -${frame.y}px;
                background-image: url('${common_icon_weapon_png}');`}
            ></div>
          </div>
          <div class="w-40">
            ${category.find((element) => element.api_id == category_number)!
              .api_name ?? "Unknown"}
          </div>
          <div class="w-60">
            ${get_data.api_data.api_mst_slotitem.find(
              (element) =>
                element.api_type[2] == category_number &&
                element.api_type[3] == icon_number
            )!.api_name ?? "Unknown"}
          </div>
        </div>`;
      } catch (e) {
        return html`<div class="flex h-12 items-center">
          <equipment-icon
            icon_number=${icon_number}
            category_number=${category_number}
            size=${"md"}
            class="w-20 h-full"
          ></equipment-icon>
          <div class="w-40">no keys</div>
          <div class="w-60">
            ${get_data.api_data.api_mst_slotitem.find(
              (element) =>
                element.api_type[2] == category_number &&
                element.api_type[3] == icon_number
            )!.api_name ?? "Unknown"}
          </div>
        </div>`;
      }
    })}
  </div>`;
};
