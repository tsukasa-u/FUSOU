import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeCSS } from "lit";
import globalStyles from "../global.css?inline";
import { ifDefined } from "lit/directives/if-defined.js";

export interface IconCautionFillProps {
  level: "low" | "middle" | "high";
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

const color_list = {
  low: "#FFFF00",
  middle: "#FFCC00",
  high: "#FF0000",
};

const get_primary_color = (level: keyof typeof color_list) => {
  return color_list[level];
};

@customElement("icon-caution-fill")
export class IconCautionFill extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: String })
  level: keyof typeof color_list = "low";

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  render() {
    const primary_color = get_primary_color(this.level);
    return html`<svg
      fill=${primary_color}
      stroke-width="16"
      stroke="currentColor"
      viewBox="-8 -8 528 528"
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      overflow="hidden"
      class=${["stroke-base-content", class_size[this.size]].join(" ")}
    >
      <g>
        <path
          d="M505.095,407.125L300.77,53.208c-9.206-15.944-26.361-25.849-44.774-25.849
		c-18.412,0-35.552,9.905-44.751,25.849L6.905,407.109c-9.206,15.944-9.206,35.746,0,51.69
		c9.206,15.944,26.354,25.842,44.758,25.842h408.674c18.405,0,35.568-9.897,44.759-25.842
		C514.302,442.855,514.302,423.053,505.095,407.125z M256.004,426.437c-17.668,0-32.013-14.33-32.013-32.004
		c0-17.668,14.345-31.997,32.013-31.997c17.667,0,31.997,14.329,31.997,31.997C288.001,412.108,273.671,426.437,256.004,426.437z
		 M275.72,324.011c0,10.89-8.834,19.709-19.716,19.709c-10.898,0-19.717-8.818-19.717-19.709l-12.296-144.724
		c0-17.676,14.345-32.005,32.013-32.005c17.667,0,31.997,14.33,31.997,32.005L275.72,324.011z"
        />
      </g>
    </svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "icon-caution-fill": IconCautionFill;
  }
}

export const IconCautionFillBasic = (args: IconCautionFillProps) => {
  return html`<icon-caution-fill
    level=${args.level}
    size=${ifDefined(args.size)}
  ></icon-caution-fill>`;
};

export const IconCautionFillCatalog = () => {
  return html`<div class="grid gap-4">
    <div class="flex">
      <h1 class="w-20">high</h1>
      <icon-caution-fill level=${"high"} size=${"sm"}></icon-caution-fill>
    </div>
    <div class="flex">
      <h1 class="w-20">middle</h1>
      <icon-caution-fill level=${"middle"} size=${"sm"}></icon-caution-fill>
    </div>
    <div class="flex">
      <h1 class="w-20">low</h1>
      <icon-caution-fill level=${"low"} size=${"sm"}></icon-caution-fill>
    </div>
  </div>`;
};
