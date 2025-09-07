import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import type { MstShip } from "@ipc-bindings/get_data";
import { default_mst_ship } from "@ipc-bindings/default_state/get_data";

import "../../icons/ship";
import "../../icons/plane-proficiency";
import "../../icons/error";

import { error_ratio } from "../../icons/ship";

export interface ComponentShipProps {
  mst_ship?: MstShip;
  color?: string;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  name_flag?: boolean;
  empty_flag?: boolean;
}

const class_size = {
  xs: {
    name_text: "text-md",
    name_h: "h-6",
  },
  sm: {
    name_text: "text-lg",
    name_h: "h-[27px]",
  },
  md: {
    name_text: "text-xl",
    name_h: "h-[30px]",
  },
  lg: {
    name_text: "text-2xl",
    name_h: "h-[35px]",
  },
  xl: {
    name_text: "text-3xl",
    name_h: "h-11",
  },
};

@customElement("component-ship")
export class ComponentShip extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  mst_ship?: MstShip = default_mst_ship;

  @property({ type: String })
  color = "";

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  @property({ type: Boolean })
  name_flag = false;

  @property({ type: Boolean })
  empty_flag = false;

  nameTemplete() {
    return this.mst_ship && this.name_flag && !this.empty_flag
      ? html`<div
          class=${[
            "pl-3 truncate content-center cursor-inherit",
            class_size[this.size].name_text,
            class_size[this.size].name_h,
          ].join(" ")}
        >
          ${this.mst_ship.name ?? "Unknown"}
        </div>`
      : html``;
  }

  render() {
    return this.mst_ship
      ? html`
          <div class="flex flex-nowarp w-full">
            <div>
              <icon-ship
                ship_stype=${this.mst_ship.stype}
                color=${this.color}
                size=${this.size}
                ?empty_flag=${this.empty_flag}
              ></icon-ship>
            </div>
            ${this.nameTemplete()}
          </div>
        `
      : html`<div class="flex flex-nowarp w-full">
          <div class="outline-error outline-2 rounded bg-error-content">
            <icon-error size=${this.size} ratio=${error_ratio}></icon-error>
          </div>
          ${this.nameTemplete()}
        </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-ship": ComponentShip;
  }
}
