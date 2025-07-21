import { css, html, LitElement, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeCSS } from "lit";
import globalStyles from "../global.css?inline";
import fontStyles from "../font.css?inline";

export interface IconEquipmentProps {
  icon_number: number;
  category_number: number;
  size?: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
  empty_flag?: boolean;
}

const icon_list: { [key: number]: string[] } = {
  0: ["#FFFFFF", "#FFFFFF"], //  Undefined
  1: ["#CC3D3D", "#CC3D3D"], //  Small Caliber Main Guns
  2: ["#CC3D3D", "#CC3D3D"], //  Medium Caliber Main Guns
  3: ["#CC3D3D", "#CC3D3D"], //  Large Caliber Main Guns
  4: ["#FFEA00", "#FFEA00"], //  Secondary Guns
  5: ["#5887AB", "#5887AB"], //  Torpedo
  6: ["#39B74E", "#60C06F"], //  carrier-based fighter
  7: ["#39B74E", "#FF726F"], //  carrier-based dive bomber
  8: ["#39B74E", "#68C1FD"], //  carrier-based torpedo bomber
  9: ["#39B74E", "#FFD500"], //  carrier-based reconnaissance
  10: ["#8FCC98", "#8FCC98"], //  seaplane
  11: ["#DE9437", "#DE9437"], //  radar
  12: ["#C9260B", "#C9260B"], //  AA shell
  13: ["#FFFFFF", "#FFFFFF"], //  AP shell
  14: ["#FFFFFF", "#FFFFFF"], //  Damage control
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
  34: ["#FFFFFF", "#FFFFFF"], //  Ration
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
  48: ["#39B74E", "#3FAC0E"], //  Land Attacker
  49: ["#2E8E06", "#3A9F22"], //  Heavy Bomber
  50: ["#8FCC99", "#8580B4"], //  Reconnaissance
  51: ["#90CD99", "#8480AD"], //  Multi-purpos Seaplane
  52: ["#9F8A2A", "#9F8A2A"], //  Army Units
  53: ["#000000", "#000000"], //  Unknown
  54: ["#7B7B7B", "#7B7B7B"], //  Smoke Generator
  55: ["#9B9B9B", "#9B9B9B"], //  Barrage Balloon
  56: ["#39B74E", "#3FAB14"], //  Interceptor
  57: ["#39B74E", "#76BA31"], //  Interceptor
  58: ["#39B74E", "#8F89C3"], //  Carrier-based Aircraft
  59: ["#47B48F", "#E3E3E3"], //  All Flying Wing Jet Bomber
  60: ["#000000", "#000000"], //  Unknown
  61: ["#000000", "#000000"], //  Unknown
  62: ["#000000", "#000000"], //  Unknown
  63: ["#000000", "#000000"], //  Unknown
  64: ["#000000", "#000000"], //  Unknown
  65: ["#000000", "#000000"], //  Unknown
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
  11: "UN", //  Unkown
  12: "UN", //  Unkown
  13: "UN", //  Unkown
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
  36: "FS", //  Fighter Seaplane
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
  47: "AB", //  Armed Boat
  48: "AU", //  Army Units
  49: "SG", //  Smoke Generator
  50: "BB", //  Barrage Ballon
  51: "AB", //  All Flying Wing Jet Bomber
  52: "UN", //  Unkown
  53: "UN", //  Unkown
  54: "UN", //  Unkown
  55: "UN", //  Unkown
  56: "UN", //  Unkown
  57: "UN", //  Unkown
  58: "UN", //  Unkown
  59: "UN", //  Unkown
};

const class_size = {
  xs: "h-6",
  sm: "h-[27px]",
  md: "h-[30px]",
  lg: "h-[35px]",
  xl: "h-11",
  full: "h-full",
  none: "",
};

const primary_color = (icon_number: number) => icon_list[icon_number ?? 0][0];
const secondary_color = (icon_number: number) => icon_list[icon_number ?? 0][1];

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

@customElement("icon-equipment")
export class IconEquipment extends LitElement {
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
  icon_number = 0;

  @property({ type: Number })
  category_number = 0;

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  @property({ type: Boolean })
  empty_flag = false;

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
        "cursor-inherit",
        class_size[this.size],
      ].join(" ")}
    >
      ${!this.empty_flag
        ? svg`<text
        class="roboto-mono-500"
        font-size="96"
        textLength="96"
        lengthAdjust="spacingAndGlyphs"
        transform="translate(28 104)"
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
        d="M27.5 124 124.5 124"
        stroke="#303030"
        stroke-width="17"
        stroke-miterlimit="9"
        fill="none"
        fill-rule="evenodd"
      />
      <path
        d="M28.0 124.0 76.2 124.0Z"
        stroke=${primary_color(this.icon_number)}
        stroke-width="16"
      />
      <path
        d="M76.0 124.0 124.0 124.0Z"
        stroke=${secondary_color(this.icon_number)}
        stroke-width="16"
      />
      ${bg_slash}`
        : svg``}
    </svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "icon-equipment": IconEquipment;
  }
}
