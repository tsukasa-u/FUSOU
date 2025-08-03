import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import type { SlotItem } from "@ipc-bindings/require_info";
import { default_slotitem } from "@ipc-bindings/default_state/require_info";

import type { MstSlotItem } from "@ipc-bindings/get_data";
import { default_mst_slot_item } from "@ipc-bindings/default_state/get_data";

import "../../icons/error";

export interface ComponentEquipmentTableProps {
  mst_slot_item?: MstSlotItem;
  slot_item?: SlotItem;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

const class_size = {
  xs: {
    name_text: "text-md",
    level_text: "text-sm",
    caption_text: "text-sm",
    table: "table-xs",
  },
  sm: {
    name_text: "text-lg",
    level_text: "text-md",
    caption_text: "text-md",
    table: "table-sm",
  },
  md: {
    name_text: "text-xl",
    level_text: "text-lg",
    caption_text: "text-lg",
    table: "table-md",
  },
  lg: {
    name_text: "text-2xl",
    level_text: "text-xl",
    caption_text: "text-xl",
    table: "table-lg",
  },
  xl: {
    name_text: "text-3xl",
    level_text: "text-2xl",
    caption_text: "text-2xl",
    table: "table-xl",
  },
};

const signed_number = (number: number): string =>
  number != 0 ? (number >= 0 ? "+" + String(number) : String(number)) : "";

@customElement("component-equipment-table")
export class ComponentEquipmentTable extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  slot_item?: SlotItem = default_slotitem;

  @property({ type: Object })
  mst_slot_item?: MstSlotItem = default_mst_slot_item;

  @property({ type: String })
  size: keyof typeof class_size = "sm";

  render() {
    return this.mst_slot_item && this.slot_item
      ? html`
      <div class="flex justify-start cursor-default">
        <h3 class=${[
          "font-bold pl-3 truncate",
          class_size[this.size].name_text,
        ].join(" ")}>
          ${this.mst_slot_item.name ?? "Unknown"}
        </h3>
        <div class=${["place-self-end pl-4 text-accent", class_size[this.size].level_text].join(" ")}>
          ${signed_number(this.slot_item.level ?? 0)}
        </div>
      </div>
      <div class="pt-2 cursor-default">
        <table class=${["table", class_size[this.size].table].join(" ")}>
          <caption class=${["truncate pb-2", class_size[this.size].caption_text].join(" ")}>
            Equipment Status
          </caption>
          <tbody>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Firepower</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.houg ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Torpedo</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.raig ?? 0)}
              </td>
            </tr>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Bomb</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.baku ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Anti-Air</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.tyku ?? 0)}
              </td>
            </tr>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Anti-Submarine</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.tais ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Reconnaissance</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.saku ?? 0)}
              </td>
            </tr>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Accuracy</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.houm ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Evasion</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.houk ?? 0)}
              </td>
            </tr>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Armor</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.souk ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Anti-Bomber</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.taibaku ?? 0)}
              </td>
            </tr>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Interception</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.geigeki ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Distance</th>
              <td class="flex-none w-12 flex justify-end pr-4">
                ${signed_number(this.mst_slot_item.distance ?? 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`
      : html`
          <div class="outline-error outline-2 rounded bg-error-content">
            <icon-error size=${"full"}></icon-error>
          </div>
        `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-equipment-table": ComponentEquipmentTable;
  }
}
