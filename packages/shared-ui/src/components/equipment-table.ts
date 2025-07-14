import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../global.css?inline";

import { default_slotitem, type SlotItem } from "../interface/require_info";
import { default_mst_slot_item, type MstSlotitem } from "../interface/get_data";

export interface ComponentEquipmentTableProps {
  mst_slot_item: MstSlotitem;
  slot_item: SlotItem;
}

const signed_number = (number: number): string =>
  number != 0 ? (number >= 0 ? "+" + String(number) : String(number)) : "";

@customElement("component-equipment-table")
export class ComponentEquipmentTable extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  slot_item: SlotItem = default_slotitem;

  @property({ type: Object })
  mst_slot_item: MstSlotitem = default_mst_slot_item;

  render() {
    return html`
      <div class="flex justify-start">
        <h3 class="font-bold text-base pl-3 truncate">
          ${this.mst_slot_item.name ?? "Unknown"}
        </h3>
        <div class="place-self-end pb pl-4 text-sm text-accent">
          ${signed_number(this.slot_item.level ?? 0)}
        </div>
      </div>
      <div class="pt-2">
        <table class="table table-sm">
          <caption class="truncate pb-2">
            Equipment Status
          </caption>
          <tbody>
            <tr class="flex border-b-1 hover:border-accent">
              <th class="truncate flex-1 w-2">Firepower</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.houg ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Torpedo</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.raig ?? 0)}
              </td>
            </tr>
            <tr class="flex border-b-1 hover:border-accent">
              <th class="truncate flex-1 w-2">Bomb</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.baku ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Anti-Air</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.tyku ?? 0)}
              </td>
            </tr>
            <tr class="flex border-b-1 hover:border-accent">
              <th class="truncate flex-1 w-2">Anti-Submarine</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.tais ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Reconnaissance</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.saku ?? 0)}
              </td>
            </tr>
            <tr class="flex border-b-1 hover:border-accent">
              <th class="truncate flex-1 w-2">Accuracy</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.houm ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Evasion</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.houk ?? 0)}
              </td>
            </tr>
            <tr class="flex border-b-1 hover:border-accent">
              <th class="truncate flex-1 w-2">Armor</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.souk ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Anti-Bomber</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.taibaku ?? 0)}
              </td>
            </tr>
            <tr class="flex border-b-1 hover:border-accent">
              <th class="truncate flex-1 w-2">Interception</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.geigeki ?? 0)}
              </td>
              <th class="truncate flex-1 w-2">Distance</th>
              <td class="flex-none w-12">
                ${signed_number(this.mst_slot_item.distance ?? 0)}
              </td>
            </tr>
            <tr></tr>
          </tbody>
        </table>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-equipment-table": ComponentEquipmentTable;
  }
}

export const ComponentEquipmentTableBasic = (
  args: ComponentEquipmentTableProps
) => {
  return html`<component-equipment-table
    .slot_item=${args.slot_item}
    .mst_slot_item=${args.mst_slot_item}
  ></component-equipment-table>`;
};
