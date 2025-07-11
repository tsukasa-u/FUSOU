import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../global.css?inline";
import { ifDefined } from "lit/directives/if-defined.js";

export interface ComponentColorBarProps {
  v_now: number;
  v_max: number;
  size?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
  quantize?: number;
}

const class_size = {
  xs: "h-1",
  sm: "h-[6px]",
  md: "h-2",
  lg: "h-[10px]",
  xl: "h-3",
  none: "",
};

const calc_value = (v_now: number, v_max: number, quantize?: number) => {
  if (quantize && quantize > 0) {
    let quantuzed_v_now = v_now - (v_now % (v_max / quantize));
    return v_max != 0 ? (quantuzed_v_now * 100) / v_max : 0;
  } else {
    return v_max != 0 ? (v_now * 100) / v_max : 0;
  }
};

const get_color_class = (v_now: number, v_max: number) => {
  if (v_now == v_max) {
    return "bg-green-500";
  } else if (v_now > 0.75 * v_max) {
    return "bg-lime-500";
  } else if (v_now > 0.5 * v_max) {
    return "bg-yellow-500";
  } else if (v_now > 0.25 * v_max) {
    return "bg-orange-500";
  } else {
    return "bg-red-500";
  }
};

@customElement("component-color-bar")
export class ComponentColorBar extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Number })
  v_max = 0;

  @property({ type: Number })
  v_now = 0;

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  @property({ type: Number })
  quantize?: number = undefined;

  render() {
    let value = calc_value(this.v_now, this.v_max);
    let primary_color = get_color_class(this.v_now, this.v_max);
    return html`<progress
      class=${[
        "progress",
        `[&::-webkit-progress-value]:${primary_color}`,
        `[&::-moz-progress-bar]:${primary_color}`,
        class_size[this.size],
      ].join(" ")}
      max="100"
      .value=${value}
    ></progress>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-color-bar": ComponentColorBar;
  }
}

export const ComponentColorBarBasic = (args: ComponentColorBarProps) => {
  return html`<component-color-bar
    v_now=${args.v_now}
    v_max=${args.v_max}
    size=${ifDefined(args.size)}
    quantize=${ifDefined(args.quantize)}
  ></component-color-bar>`;
};
