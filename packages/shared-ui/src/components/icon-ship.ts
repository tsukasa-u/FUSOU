import { html, LitElement, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeCSS } from "lit";
import globalStyles from "../global.css?inline";
import { ifDefined } from "lit/directives/if-defined.js";
import get_data from "../data/S@api_start2@getData.json";
import require_info from "../data/S@api_get_member@require_info.json";

export interface IconShipProps {
  ship_stype: number;
  color?: string;
  size?: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
}

const icon_list: { [key: string]: string } = {
  undifined: "#FFFFFF", //  Undefined
  "": "#CCCCCC",
  "-": "#CCCCCC",
  elite: "#FF4500", //  Elite
  flagship: "#FFD700", //  Flagship
};

const name_list: { [key: number]: string } = {
  0: "UN", //    Undefined
  1: "DE", //    Escort
  2: "DD", //		Destroyer
  3: "CL", //	  Light Cruiser
  4: "CLT", //    Torpedo Cruiser
  5: "CA", //	  Heavy Cruiser
  6: "CAV", //    Aircraft Cruiser
  7: "CVL", //    Light Aircraft Carrier
  8: "BB", //	  Battleship
  9: "BB", //	  Battleship
  10: "BBV", //    Aviation Battleship
  11: "CV", //    Aircraft Carrier
  12: "BB", //    Super Dreadnoughts
  13: "SS", //    Submarine
  14: "SSV", //    Aircraft Carrying Submarine
  15: "AO", //    Fleet Oiler
  16: "AV", //    Seaplane Carrier
  17: "LHA", //    Amphibious Assault Ship
  18: "CVB", //    Aircraft Carrier
  19: "AR", //    Repair Ship
  20: "AS", //    Submarine Tender
  21: "CT", //    Training Cruiser
  22: "AO", //    Fleet Oiler
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

const bg_slash = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(
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

const get_secondary_color = (color_prop: string) => {
  let color = icon_list[color_prop ?? ""];
  if (color == undefined) {
    color = "#CCCCCC";
  }
  return color;
};

@customElement("icon-ship")
export class IconShip extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Number })
  ship_stype = 0;

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  @property({ type: String })
  color = "";

  render() {
    const name = name_list[this.ship_stype ?? 0];

    const primary_color: string = icon_list[""];
    const secondary_color = get_secondary_color(this.color);

    return html` <svg
      fill="currentColor"
      stroke-width="1.5"
      stroke="currentColor"
      viewBox="0 0 199 151"
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
        font-size="92"
        transform="translate(${25 - (name.length - 3) * 24} 104)"
      >
        ${name}
      </text>
      <path
        d="m 9 32 C 9 19.85 18.85 10 31 10 L 167 10 C 179.15 10 189 19.85 189 32 l 0 88 C 189 132.15 179.15 142 167 142 L 31 142 C 18.85 142 9 132.15 9 120 Z"
        stroke="#000000"
        stroke-width="4"
        stroke-linejoin="round"
        stroke-miterlimit="10"
        fill="none"
        fill-rule="evenodd"
      />
      <path
        d="M28 124 100.2 124"
        stroke=${primary_color}
        stroke-width="16"
        stroke-miterlimit="8"
        fill="none"
        fill-rule="evenodd"
      />
      <path
        d="M100 124 172 124"
        stroke=${secondary_color}
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
    "icon-ship": IconShip;
  }
}

export const IconShipBasic = (args: IconShipProps) => {
  return html`<icon-ship
    ship_stype=${args.ship_stype}
    color=${ifDefined(args.color)}
    size=${ifDefined(args.size)}
  ></icon-ship>`;
};

export const IconShipCatalog = () => {
  //   console.log(get_data.api_data.api_mst_ship);
  const category_type_number = [
    ...new Set(
      get_data.api_data.api_mst_ship.map((x) =>
        String([x.api_stype, x.apt_ctype])
      )
    ),
  ].map((s) => s.split(",").map((x) => Number(x)));

  return html`<div class="grid grid-cols-6 w-100 gap-4">
    ${category_type_number.map(
      ([stype, ctype]) =>
        html`<div class="grid gap-4">
          <icon-ship ship_stype=${stype} color=${""} size=${"xs"}></icon-ship>
          <icon-ship
            ship_stype=${stype}
            color=${"elite"}
            size=${"xs"}
          ></icon-ship>
          <icon-ship
            ship_stype=${stype}
            color=${"flagship"}
            size=${"xs"}
          ></icon-ship>
        </div>`
    )}
  </div>`;
};
