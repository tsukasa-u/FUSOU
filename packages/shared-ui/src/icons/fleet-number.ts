import { css, html, LitElement, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeCSS } from "lit";
import globalStyles from "../global.css?inline";
import fontStyles from "../font.css?inline";
import { ifDefined } from "lit/directives/if-defined.js";

export interface IconFleetNumberProps {
  e_flag: number;
  fleet_number: number;
  ship_number: number;
  combined_flag?: boolean;
  size?: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
}

const class_size = {
  xs: "h-6",
  sm: "h-7.5",
  md: "h-9",
  lg: "h-11",
  xl: "h-14",
  full: "h-full",
  none: "",
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

const get_primary_color = (e_flag: number) => {
  if (e_flag == 0) {
    return "#2D9C45";
  } else if (e_flag == 1) {
    return "#FF100C";
  }
};

const get_fleet_ship_number = (
  fleet_number: number,
  ship_number: number,
  combined_flag?: boolean
): [number, number] => {
  if (combined_flag == true && ship_number > 6) {
    return [fleet_number + 1, ship_number - 6];
  } else {
    return [fleet_number, ship_number];
  }
};

@customElement("icon-fleet-number")
export class IconFleetNumber extends LitElement {
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

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  @property({ type: Number })
  e_flag: number = 0;

  @property({ type: Number })
  fleet_number: number = 0;

  @property({ type: Number })
  ship_number: number = 0;

  @property({ type: Boolean })
  combined_flag = false;

  render() {
    let new_fleet_number,
      new_ship_number = get_fleet_ship_number(
        this.fleet_number,
        this.ship_number,
        this.combined_flag
      );
    let primary_color = get_primary_color(this.e_flag);

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
        ${new_fleet_number} ${new_ship_number}
      </text>
      <path
        d="M28 124 124 124"
        stroke=${primary_color}
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
    "icon-fleet-number": IconFleetNumber;
  }
}

export const IconFleetNumberBasic = (args: IconFleetNumberProps) => {
  return html`<icon-fleet-number
    e_flag=${args.e_flag}
    ?combined_flag=${args.combined_flag}
    ship_number=${args.ship_number}
    fleet_number=${args.fleet_number}
    size=${ifDefined(args.size)}
  ></icon-fleet-number>`;
};

export const IconFleetNumberCatalog = () => {
  return html`<div class="grid grid-cols-5 w-100 gap-4">
    ${html`<div class="grid gap-4">
      ${[1, 2, 3, 4, 5, 6].map(
        (ship_number) => html`
          <icon-fleet-number
            e_flag=${0}
            ?combined_flag=${false}
            ship_number=${ship_number}
            fleet_number=${1}
            size="xs"
          ></icon-fleet-number>
        `
      )}
      ${[7, 8, 9, 10, 11, 12].map(
        (_) => html`<div class=${class_size["xs"]}></div>`
      )}
    </div> `}
    ${html`<div class="grid gap-4">
      ${[1, 2, 3, 4, 5, 6].map(
        (ship_number) => html`
          <icon-fleet-number
            e_flag=${1}
            ?combined_flag=${false}
            ship_number=${ship_number}
            fleet_number=${1}
            size="xs"
          ></icon-fleet-number>
        `
      )}
      ${[7, 8, 9, 10, 11, 12].map(
        (_) => html`<div class=${class_size["xs"]}></div>`
      )}
    </div> `}
    ${html`<div class="grid gap-4">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(
        (ship_number) => html`
          <icon-fleet-number
            e_flag=${0}
            ?combined_flag=${true}
            ship_number=${ship_number}
            fleet_number=${1}
            size="xs"
          ></icon-fleet-number>
        `
      )}
    </div> `}
    ${html`<div class="grid gap-4">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(
        (ship_number) => html`
          <icon-fleet-number
            e_flag=${1}
            ?combined_flag=${true}
            ship_number=${ship_number}
            fleet_number=${1}
            size="xs"
          ></icon-fleet-number>
        `
      )}
    </div> `}
    ${html`<div class="grid gap-4">
      ${[1, 2, 3, 4, 5, 6, 7].map(
        (ship_number) => html`
          <icon-fleet-number
            e_flag=${0}
            ?combined_flag=${false}
            ship_number=${ship_number}
            fleet_number=${1}
            size="xs"
          ></icon-fleet-number>
        `
      )}
      ${[8, 9, 10, 11, 12].map(
        (_) => html`<div class=${class_size["xs"]}></div>`
      )}
    </div> `}
  </div>`;
};
