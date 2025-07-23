import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import {
  default_mst_slot_item,
  type MstSlotitem,
} from "../../interface/get_data";

export interface ComponentEquipmentMstTableProps {
  mst_slot_item: MstSlotitem;
  show_param?: boolean;
  show_name?: boolean;
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

@customElement("component-equipment-mst-table")
export class ComponentEquipmentMstTable extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  mst_slot_item: MstSlotitem = default_mst_slot_item;

  @property({ type: String })
  size: keyof typeof class_size = "sm";

  @property({ type: Boolean })
  show_param = false;

  @property({ type: Boolean })
  show_name = false;

  render() {
    return html` <div class="flex justify-start cursor-default">
        <h3
          class=${[
            "font-bold pl-3 truncate",
            class_size[this.size].name_text,
          ].join(" ")}
        >
          ${this.show_name ? (this.mst_slot_item.name ?? "Unknown") : "Unknown"}
        </h3>
      </div>
      <div class="pt-2 cursor-default">
        <table class=${["table", class_size[this.size].table].join(" ")}>
          <caption
            class=${["truncate pb-2", class_size[this.size].caption_text].join(
              " "
            )}
          >
            Equipment Status
          </caption>
          <tbody>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Firepower</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.houg ?? 0)
                  : "unknown"}
              </td>
              <th class="truncate flex-1 w-2">Torpedo</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.raig ?? 0)
                  : "unknown"}
              </td>
            </tr>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Bomb</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.baku ?? 0)
                  : "unknown"}
              </td>
              <th class="truncate flex-1 w-2">Anti-Air</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.tyku ?? 0)
                  : "unknown"}
              </td>
            </tr>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Anti-Submarine</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.tais ?? 0)
                  : "unknown"}
              </td>
              <th class="truncate flex-1 w-2">Reconnaissance</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.saku ?? 0)
                  : "unknown"}
              </td>
            </tr>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Accuracy</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.houm ?? 0)
                  : "unknown"}
              </td>
              <th class="truncate flex-1 w-2">Evasion</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.houk ?? 0)
                  : "unknown"}
              </td>
            </tr>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Armor</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.souk ?? 0)
                  : "unknown"}
              </td>
              <th class="truncate flex-1 w-2">Anti-Bomber</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.taibaku ?? 0)
                  : "unknown"}
              </td>
            </tr>
            <tr class="flex rounded">
              <th class="truncate flex-1 w-2">Interception</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.geigeki ?? 0)
                  : "unknown"}
              </td>
              <th class="truncate flex-1 w-2">Distance</th>
              <td class="flex-none w-24 flex justify-end pr-4">
                ${(this.show_param ?? false)
                  ? signed_number(this.mst_slot_item.distance ?? 0)
                  : "unknown"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-equipment-mst-table": ComponentEquipmentMstTable;
  }
}
