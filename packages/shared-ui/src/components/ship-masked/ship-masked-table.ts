import { css, html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import {
  default_mst_ship,
  default_mst_slot_items,
} from "@ipc-bindings/default_state/get_data.ts";
import type { MstShip, MstSlotItems } from "@ipc-bindings/get_data.ts";
import { classMap } from "lit/directives/class-map.js";

import "../equipment-mst/equipment-mst-modal";
import "../../icons/error";

export interface ComponentShipMaskedTableProps {
  mst_ship?: MstShip;
  mst_slot_items?: MstSlotItems;
  ship_param: number[];
  ship_slot: number[];
  ship_max_hp: number;
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

@customElement("component-ship-masked-table")
export class ComponentShipMaskedTable extends LitElement {
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

  @property({ type: Object })
  mst_slot_items?: MstSlotItems = default_mst_slot_items;

  @property({ type: String })
  size: keyof typeof class_size = "sm";

  @property({ type: Array })
  ship_param: number[] = [0, 0, 0, 0];

  @property({ type: Array })
  ship_slot: number[] = [0, 0, 0, 0, 0];

  @property({ type: Number })
  ship_max_hp: number = 0;

  equipmentTemplete(slot: number) {
    if (slot > 0) {
      const mst_slot_item = this.mst_slot_items
        ? this.mst_slot_items.mst_slot_items[slot]
        : undefined;
      return html`<component-equipment-mst-modal
        ?name_flag=${true}
        ?show_name=${false}
        ?show_param=${false}
        .mst_slot_item=${mst_slot_item}
        ?comapct=${false}
        size=${this.size}
      ></component-equipment-mst-modal>`;
    } else {
      return html`<component-equipment-mst-modal
        ?empty_flag=${true}
        size=${this.size}
      ></component-equipment-mst-modal>`;
    }
  }

  slotsTemplete() {
    return this.ship_slot.map((slot, index) => {
      return html`
        <tr
          class="flex rounded rounded items-center w-full ${classMap({
            "back_slash_color bg-[size:16px_16px] bg-top-left bg-[image:repeating-linear-gradient(45deg,currentColor_0,currentColor_0.5px,transparent_0,transparent_50%)]":
              this.mst_ship ? this.mst_ship.slot_num <= index : false,
          })}"
        >
          <th class="flex-none w-4">S${index + 1}</th>
          <td class="flex-none w-12 ml-4 py-1 w-full">
            ${this.equipmentTemplete(slot)}
          </td>
        </tr>
      `;
    });
  }

  render() {
    return this.mst_ship && this.mst_ship
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
          </div>
          <div class="pt-2">
            <table class=${["table", class_size[this.size].table].join(" ")}>
              <caption
                class=${["truncate", class_size[this.size].caption_text].join(
                  " ",
                )}
              >
                Slots
              </caption>
              <tbody>
                ${this.slotsTemplete()}
              </tbody>
            </table>
            <div class="h-2"></div>
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
                    ${this.ship_max_hp ?? 0}
                  </td>
                  <th class="truncate flex-1 w-2">Firepower</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.ship_param![0] ?? 0}
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Armor</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.ship_param![3] ?? 0}
                  </td>
                  <th class="truncate flex-1 w-2">Torpedo</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.ship_param![1] ?? 0}
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Evasion</th>
                  <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                  <th class="truncate flex-1 w-2">Anti-Air</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.ship_param![2] ?? 0}
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Aircraft installed</th>
                  <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                  <th class="truncate flex-1 w-2">Anti-Submarine</th>
                  <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Speed</th>
                  <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                  <th class="truncate flex-1 w-2">Reconnaissance</th>
                  <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Range</th>
                  <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                  <th class="truncate flex-1 w-2">Luck</th>
                  <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
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
    "component-ship-masked-table": ComponentShipMaskedTable;
  }
}
