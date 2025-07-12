import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
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

const class_color = {
  green: "text-green-500",
  lime: "text-lime-500",
  yellow: "text-yellow-500",
  orange: "text-orange-500",
  red: "text-red-500",
};

const calc_value = (v_now: number, v_max: number, quantize?: number) => {
  if (quantize && quantize > 0) {
    let quantuzed_v_now = v_now - (v_now % (v_max / quantize));
    return v_max != 0 ? (quantuzed_v_now * 100) / v_max : 0;
  } else {
    return v_max != 0 ? (v_now * 100) / v_max : 0;
  }
};

const get_color = (v_now: number, v_max: number) => {
  if (v_now == v_max) {
    return "green";
  } else if (v_now > 0.75 * v_max) {
    return "lime";
  } else if (v_now > 0.5 * v_max) {
    return "yellow";
  } else if (v_now > 0.25 * v_max) {
    return "orange";
  } else {
    return "red";
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

  @state()
  color: keyof typeof class_color = "green";

  render() {
    this.color = get_color(this.v_now, this.v_max);
    let value = calc_value(this.v_now, this.v_max, this.quantize);
    return html`<progress
      class=${["progress", class_color[this.color], class_size[this.size]].join(
        " "
      )}
      max="100"
      value=${value}
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

export const ComponentColorBarCatalog = () => {
  const value_map = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  return html`<div class="grid gap-4">
    ${value_map.map(
      (v_now) =>
        html`<div class="grid">
          <div class="flex">
            <div class="w-30">${v_now}%</div>
            <component-color-bar
              class="w-full"
              v_now=${v_now}
              v_max=${100}
              size=${"xs"}
            ></component-color-bar>
          </div>
          <div class="flex">
            <div class="w-30">8-quantized</div>
            <component-color-bar
              class="w-full"
              v_now=${v_now}
              v_max=${100}
              size=${"xs"}
              quantize=${5}
            ></component-color-bar>
          </div>
        </div>`
    )}
  </div>`;
};
