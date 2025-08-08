import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeCSS } from "lit";
import globalStyles from "../global.css?inline";

export interface IconCautionFillProps {
  level: "low" | "middle" | "high";
  size?: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
}

const class_size = {
  xs: "h-6",
  sm: "h-[27px]",
  md: "h-[30px]",
  lg: "h-[35px]",
  xl: "h-11",
  full: "h-full",
  none: "",
};

const color_list = {
  low: "stroke-amber-500 fill-amber-500",
  middle: "stroke-orange-500 fill-orange-500",
  high: "stroke-red-500 fill-red-500",
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
      stroke-width="0"
      stroke="currentColor"
      viewBox="10 40 490 520"
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      overflow="hidden"
      class=${[
        // "stroke-base-content",
        primary_color,
        class_size[this.size],
      ].join(" ")}
    >
      <g>
        <circle
          cx="250"
          cy="280"
          r="200"
          stroke-width="32"
          class="fill-base-100"
        />
        <path
          d="M256.004,426.437c-17.668,0-32.013-14.33-32.013-32.004
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
