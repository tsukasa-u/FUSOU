import { css, html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import {
  default_mst_ship,
  default_mst_slot_items,
} from "@ipc-bindings/default_state/get_data";
import type { MstShip, MstSlotItems } from "@ipc-bindings/get_data";

import type { Ship } from "@ipc-bindings/port";
import { default_ship } from "@ipc-bindings/default_state/port";

import type { SlotItems } from "@ipc-bindings/require_info";
import { default_slotitems } from "@ipc-bindings/default_state/require_info";

import { ifDefined } from "lit/directives/if-defined.js";
import { classMap } from "lit/directives/class-map.js";

import "../equipment/equipment-modal";
import "../../icons/error";

export interface ComponentShipTableProps {
  mst_ship?: MstShip;
  ship?: Ship;
  mst_slot_items?: MstSlotItems;
  slot_items?: SlotItems;
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

@customElement("component-ship-table")
export class ComponentShipTable extends LitElement {
  static styles = [
    css`
      .back_slash_color {
        color: color-mix(in oklch, var(--color-base-content) 5%, #0000);
      }
    `,
    unsafeCSS(globalStyles),
  ];

  @property({ type: Object })
  ship?: Ship = default_ship;

  @property({ type: Object })
  mst_ship?: MstShip = default_mst_ship;

  @property({ type: Object })
  slot_items?: SlotItems = default_slotitems;

  @property({ type: Object })
  mst_slot_items?: MstSlotItems = default_mst_slot_items;

  @property({ type: String })
  size: keyof typeof class_size = "sm";

  equipmentTemplete(slot: number, index: number) {
    const onslot =
      index != -1 && this.mst_ship && this.mst_ship.maxeq
        ? this.mst_ship.maxeq[index]
        : undefined;
    if (slot > 0) {
      const slot_item = this.slot_items
        ? this.slot_items.slot_items[slot]
        : undefined;
      const mst_slot_item =
        slot_item && this.mst_slot_items
          ? this.mst_slot_items.mst_slot_items[slot_item.slotitem_id]
          : undefined;
      return html`<component-equipment-modal
        ?name_flag=${true}
        .slot_item=${slot_item}
        .mst_slot_item=${mst_slot_item}
        attr:onslot=${ifDefined(onslot)}
        size=${this.size}
      ></component-equipment-modal>`;
    } else {
      return html`<component-equipment-modal
        ?empty_flag=${true}
        size=${this.size}
      ></component-equipment-modal>`;
    }
  }

  slotsTemplete() {
    return this.ship && this.ship.slot
      ? this.ship.slot.map((slot, index) => {
          return html`
            <tr
              class="flex rounded rounded items-center w-full ${classMap({
                "back_slash_color bg-[size:16px_16px] bg-top-left bg-[image:repeating-linear-gradient(45deg,currentColor_0,currentColor_0.5px,transparent_0,transparent_50%)]":
                  this.ship && this.ship.slotnum
                    ? this.ship.slotnum <= index
                    : false,
              })}"
            >
              <th class="flex-none w-4">S${index + 1}</th>
              <td class="flex-none w-12 ml-4 py-1 w-full">
                ${this.equipmentTemplete(slot, index)}
              </td>
            </tr>
          `;
        })
      : html``;
  }

  slotExTemplete() {
    return html`
      <tr
        class="flex rounded items-center  
          ${classMap({
          "back_slash_color bg-[size:16px_16px] bg-top-left bg-[image:repeating-linear-gradient(45deg,currentColor_0,currentColor_0.5px,transparent_0,transparent_50%)]":
            this.ship ? this.ship.slot_ex == 0 : false,
        })}"
      >
        <th class="flex-none w-4">SE</th>
        <td class="flex-none w-12 ml-4 py-1 w-full">
          ${this.equipmentTemplete(
            this.ship && this.ship.slot_ex ? this.ship.slot_ex : 0,
            -1
          )}
        </td>
      </tr>
    `;
  }

  maxEq() {
    return this.mst_ship && this.mst_ship.maxeq
      ? this.mst_ship.maxeq.reduce((a, b) => a + b, 0)
      : 0;
  }

  SpEffectItem() {
    const parameter_map = {
      soukou: 0,
      raisou: 0,
      karyoku: 0,
      kaihi: 0,
    };
    if (this.ship) {
      if (!this.ship.sp_effect_items) return parameter_map;
    } else {
      return parameter_map;
    }

    for (const i of [1, 2]) {
      const sp_effect_item = this.ship.sp_effect_items!.items[i];
      if (sp_effect_item) {
        parameter_map.soukou += sp_effect_item.souk ?? 0;
        parameter_map.raisou += sp_effect_item.raig ?? 0;
        parameter_map.karyoku += sp_effect_item.houg ?? 0;
        parameter_map.kaihi += sp_effect_item.kaih ?? 0;
      }
    }

    return parameter_map;
  }

  render() {
    const sp_effect_item = this.SpEffectItem();
    const max_eq = this.maxEq();
    return this.ship && this.mst_ship
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
              Lv. ${this.ship.lv ?? ""}
            </div>
            <div
              class=${[
                "place-self-end pl-2",
                class_size[this.size].level_text,
              ].join(" ")}
            >
              next ${this.ship.exp ? this.ship.exp[1] ?? 0 : ""}
            </div>
          </div>
          <div class="pt-2">
            <table class=${["table", class_size[this.size].table].join(" ")}>
              <caption
                class=${["truncate", class_size[this.size].caption_text].join(
                  " "
                )}
              >
                Slots
              </caption>
              <tbody>
                ${this.slotsTemplete()} ${this.slotExTemplete()}
              </tbody>
            </table>
            <div class="h-2"></div>
            <table class=${["table", class_size[this.size].table].join(" ")}>
              <caption
                class=${["truncate", class_size[this.size].caption_text].join(
                  " "
                )}
              >
                Ship Status
              </caption>
              <tbody>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Durability</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.ship.maxhp ?? 0}
                  </td>
                  <th class="truncate flex-1 w-2">Firepower</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    <div class="indicator">
                      <span
                        class=${[
                          "indicator-item indicator-bottom text-accent",
                          class_size[this.size].accent_text,
                        ].join(" ")}
                      >
                        ${sp_effect_item.karyoku > 0
                          ? `+${sp_effect_item.karyoku}`
                          : ""}
                      </span>
                      ${this.ship.karyoku ? this.ship.karyoku[0] ?? 0 : 0}
                    </div>
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Armor</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    <div class="indicator">
                      <span
                        class=${[
                          "indicator-item indicator-bottom text-accent",
                          class_size[this.size].accent_text,
                        ].join(" ")}
                      >
                        ${sp_effect_item.soukou > 0
                          ? `+${sp_effect_item.soukou}`
                          : ""}
                      </span>
                      ${this.ship.soukou ? this.ship.soukou[0] ?? 0 : 0}
                    </div>
                  </td>
                  <th class="truncate flex-1 w-2">Torpedo</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    <div class="indicator">
                      <span
                        class=${[
                          "indicator-item indicator-bottom text-accent",
                          class_size[this.size].accent_text,
                        ].join(" ")}
                      >
                        ${sp_effect_item.raisou > 0
                          ? `+${sp_effect_item.raisou}`
                          : ""}
                      </span>
                      ${this.ship.raisou ? this.ship.raisou[0] ?? 0 : 0}
                    </div>
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Evasion</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    <div class="indicator">
                      <span
                        class=${[
                          "indicator-item indicator-bottom text-accent",
                          class_size[this.size].accent_text,
                        ].join(" ")}
                      >
                        ${sp_effect_item.kaihi > 0
                          ? `+${sp_effect_item.kaihi}`
                          : ""}
                      </span>
                      ${this.ship.kaihi ? this.ship.kaihi[0] ?? 0 : 0}
                    </div>
                  </td>
                  <th class="truncate flex-1 w-2">Anti-Air</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.ship.taiku ? this.ship.taiku[0] ?? 0 : 0}
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Aircraft installed</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${max_eq ?? 0 > 0}
                  </td>
                  <th class="truncate flex-1 w-2">Anti-Submarine</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.ship.taisen ? this.ship.taisen[0] ?? 0 : 0}
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Speed</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${speed_list[this.ship.soku ?? 0]}
                  </td>
                  <th class="truncate flex-1 w-2">Reconnaissance</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.ship.sakuteki ? this.ship.sakuteki[0] ?? 0 : 0}
                  </td>
                </tr>
                <tr class="flex rounded">
                  <th class="truncate flex-1 w-2">Range</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${range_list[this.ship.leng ?? 0]}
                  </td>
                  <th class="truncate flex-1 w-2">Luck</th>
                  <td class="flex-none w-12 flex justify-end pr-4">
                    ${this.ship.lucky ? this.ship.lucky[0] ?? 0 : 0}
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
    "component-ship-table": ComponentShipTable;
  }
}
