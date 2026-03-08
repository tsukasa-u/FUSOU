import { css, html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import { default_mst_ship } from "@ipc-bindings/default_state/get_data";
import type { MstShip } from "@ipc-bindings/get_data";

import "../equipment/equipment-modal";
import "../../icons/error";

export interface ComponentShipMstTableProps {
  mst_ship?: MstShip;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

const class_size = {
  xs: {
    name_text: "text-md",
    level_text: "text-sm",
    caption_text: "text-sm",
    table: "table-xs",
    accent_text: "text-xs",
  },
  sm: {
    name_text: "text-lg",
    level_text: "text-md",
    caption_text: "text-md",
    table: "table-sm",
    accent_text: "text-sm",
  },
  md: {
    name_text: "text-xl",
    level_text: "text-lg",
    caption_text: "text-lg",
    table: "table-md",
    accent_text: "text-md",
  },
  lg: {
    name_text: "text-2xl",
    level_text: "text-xl",
    caption_text: "text-xl",
    table: "table-lg",
    accent_text: "text-lg",
  },
  xl: {
    name_text: "text-3xl",
    level_text: "text-2xl",
    caption_text: "text-2xl",
    table: "table-xl",
    accent_text: "text-xl",
  },
};

const speed_list = [
  "",
  "",
  "",
  "",
  "",
  "Slow",
  "",
  "",
  "",
  "",
  "Fast",
  "",
  "",
  "",
  "",
  "Fast+",
  "",
  "",
  "",
  "",
  "Fastest",
];

const range_list = ["", "Short", "Medium", "Long", "Very Long"];

@customElement("component-ship-mst-table")
export class ComponentShipMstTable extends LitElement {
  static styles = [
    css`
      .back_slash_color {
        color: color-mix(in oklch, var(--color-base-content) 5%, #0000);
      }
    `,
    unsafeCSS(globalStyles),
  ];

  @property({ type: Object })
  mst_ship?: MstShip = default_mst_ship;

  @property({ type: String })
  size: keyof typeof class_size = "sm";

  maxEq() {
    return this.mst_ship && this.mst_ship.maxeq
      ? this.mst_ship.maxeq.reduce((a, b) => a + b, 0)
      : 0;
  }

  render() {
    const max_eq = this.maxEq();
    return this.mst_ship
      ? html`<div class="cursor-default">
          <div class="flex justify-start">
            <h3
              class=${[
                "font-bold pl-2 truncate",
                class_size[this.size].name_text,
              ].join(" ")}
            >
              ${this.mst_ship.name ?? "Unknown"}
            </h3>
            <div
              class=${[
                "place-self-end pl-4",
                class_size[this.size].level_text,
              ].join(" ")}
            >
              Lv. ${1}
            </div>
          </div>
          <div class="pt-2">
            <table class=${["table", class_size[this.size].table].join(" ")}>
              <caption
                class=${["truncate", class_size[this.size].caption_text].join(
                  " ",
                )}
              >
                Ship Status
              </caption>
              <tbody>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Durability</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.mst_ship?.taik?.[0] ?? "-"}
                  </td>
                  <th class="truncate flex-1 w-2">Firepower</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.mst_ship.houg?.[0] ?? "-"}
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Armor</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.mst_ship.souk?.[0] ?? "-"}
                  </td>
                  <th class="truncate flex-1 w-2">Torpedo</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.mst_ship.raig?.[0] ?? "-"}
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Evasion</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${
                      "-"
                      // this.mst_ship.kaihi?.[0] ?? 0
                    }
                  </td>
                  <th class="truncate flex-1 w-2">Anti-Air</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.mst_ship.tyku?.[0] ?? "-"}
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Aircraft installed</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${max_eq ? (max_eq > 0 ? max_eq : "") : "-"}
                  </td>
                  <th class="truncate flex-1 w-2">Anti-Submarine</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.mst_ship.tais?.[0] ?? "-"}
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Speed</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${speed_list[this.mst_ship.soku ?? "-"]}
                  </td>
                  <th class="truncate flex-1 w-2">Reconnaissance</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.mst_ship.tyku?.[0] ?? "-"}
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Range</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.mst_ship.leng ? range_list[this.mst_ship.leng] : "-"}
                  </td>
                  <th class="truncate flex-1 w-2">Luck</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.mst_ship.luck?.[0] ?? "-"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>`
      : html`<div class="outline-error outline-2 rounded bg-error-content">
          <icon-error size=${"full"}></icon-error>
        </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-ship-mst-table": ComponentShipMstTable;
  }
}
