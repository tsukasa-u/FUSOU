import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";
import { ifDefined } from "lit/directives/if-defined.js";

import "./color-bar";

export interface ComponentColorBarLabelProps {
  v_now: number;
  v_max: number;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  quantize?: number;
}

const class_size = {
  xs: {
    label_text: "text-xs",
    label_h: "h-[10px]",
    label_mt: "mt-0.5",
    box_h: "h-6",
    box_py: "py-0.5",
  },
  sm: {
    label_text: "text-sm",
    label_h: "h-[11.5px]",
    label_mt: "mt-0.5",
    box_h: "h-[27px]",
    box_py: "py-0.5",
  },
  md: {
    label_text: "text-md",
    label_h: "h-[13px]",
    label_mt: "mt-0.5",
    box_h: "h-[30px]",
    box_py: "py-0.5",
  },
  lg: {
    label_text: "text-lg",
    label_h: "h-[15.5px]",
    label_mt: "mt-0.5",
    box_h: "h-[35px]",
    box_py: "py-0.5",
  },
  xl: {
    label_text: "text-xl",
    label_h: "h-5",
    label_mt: "mt-0.5",
    box_h: "h-11",
    box_py: "py-0.5",
  },
};

@customElement("component-color-bar-label")
export class ComponentColorBarLabel extends LitElement {
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
    return html` <div
      class=${[
        "w-full",
        class_size[this.size].box_py,
        class_size[this.size].box_h,
      ].join(" ")}
    >
      <div
        class=${[
          "grid place-content-center cursor-inherit mx-auto",
          class_size[this.size].label_h,
          class_size[this.size].label_text,
        ].join(" ")}
      >
        <div class=" flex flex-nowrap">
          <div class="w-[3em] text-center">${this.v_now}</div>
          /
          <div class="w-[3em] text-center">${this.v_max}</div>
        </div>
      </div>
      <div
        class=${[
          "flex place-items-center w-full",
          class_size[this.size].label_h,
        ].join(" ")}
      >
        <component-color-bar
          class=${["w-full"].join(" ")}
          v_now=${this.v_now}
          v_max=${this.v_max}
          size=${this.size}
          quantize=${ifDefined(this.quantize)}
        ></component-color-bar>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-color-bar-label": ComponentColorBarLabel;
  }
}

export const ComponentColorBarLabelBasic = (
  args: ComponentColorBarLabelProps
) => {
  return html`<component-color-bar-label
    v_now=${args.v_now}
    v_max=${args.v_max}
    size=${ifDefined(args.size)}
    quantize=${ifDefined(args.quantize)}
  ></component-color-bar-label>`;
};

export const ComponentColorBarLabelCatalog = () => {
  const value_map = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  return html`<div class="grid gap-4">
    ${value_map.map(
      (v_now) =>
        html`<div class="grid">
          <div class="flex">
            <div class="w-30">${v_now}%</div>
            <component-color-bar-label
              class="w-full"
              v_now=${v_now}
              v_max=${100}
              size=${"xs"}
            ></component-color-bar-label>
          </div>
          <div class="flex">
            <div class="w-30">5-quantized</div>
            <component-color-bar-label
              class="w-full"
              v_now=${v_now}
              v_max=${100}
              size=${"xs"}
              quantize=${5}
            ></component-color-bar-label>
          </div>
        </div>`
    )}
  </div>`;
};
