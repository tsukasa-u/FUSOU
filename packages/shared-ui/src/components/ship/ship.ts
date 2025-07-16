import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import globalStyles from "../../global.css?inline";

import { default_ship, type Ship } from "../../interface/port";
import { default_mst_ship, type MstShip } from "../../interface/get_data";

import "../../icons/ship";
import "../../icons/plane-proficiency";

export interface ComponentShipProps {
  mst_ship: MstShip;
  ship: Ship;
  color?: string;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  compact?: boolean;
}

const class_size = {
  xs: {
    name_text: "text-md",
  },
  sm: {
    name_text: "text-lg",
  },
  md: {
    name_text: "text-xl",
  },
  lg: {
    name_text: "text-2xl",
  },
  xl: {
    name_text: "text-3xl",
  },
};

@customElement("component-ship")
export class ComponentShip extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  ship: Ship = default_ship;

  @property({ type: Object })
  mst_ship: MstShip = default_mst_ship;

  @property({ type: String })
  color = "";

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  @property({ type: Boolean })
  compact = false;

  nameTemplete() {
    return (this.compact ?? false)
      ? html``
      : html`<div
          class=${[
            "pl-3 truncate content-center cursor-inherit",
            class_size[this.size].name_text,
          ].join(" ")}
        >
          ${this.mst_ship.name ?? "Unknown"}
        </div>`;
  }

  render() {
    return html`
      <div class="flex flex-nowarp w-full">
        <div>
          <icon-ship
            ship_stype=${this.mst_ship.stype}
            color=${""}
            size=${this.size}
          ></icon-ship>
        </div>
        ${this.nameTemplete()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-ship": ComponentShip;
  }
}

export const ComponentShipBasic = (args: ComponentShipProps) => {
  return html`<component-ship
    .ship=${args.ship}
    .mst_ship=${args.mst_ship}
    color=${ifDefined(args.color)}
    size=${args.size}
    ?compact=${args.compact}
  ></component-ship>`;
};
