import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";

import globalStyles from "../../global.css?inline";

import { default_ship, type Ship } from "../../interface/port";
import {
  default_mst_ship,
  default_mst_slot_items,
  type MstShip,
  type MstSlotitems,
} from "../../interface/get_data";

import {
  default_slotitems,
  type SlotItems,
} from "../../interface/require_info";

import "./ship";
import "./ship-table";

export interface ComponentEquipmentModalProps {
  mst_ship: MstShip;
  ship: Ship;
  mst_slot_items: MstSlotitems;
  slot_items: SlotItems;
  size: "xs" | "sm" | "md" | "lg" | "xl";
}

@customElement("component-ship-modal")
export class ComponentEquipmentModal extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  ship: Ship = default_ship;

  @property({ type: Object })
  mst_ship: MstShip = default_mst_ship;

  @property({ type: Object })
  slot_items: SlotItems = default_slotitems;

  @property({ type: Object })
  mst_slot_items: MstSlotitems = default_mst_slot_items;

  @property({ type: String })
  size: "xs" | "sm" | "md" | "lg" | "xl" = "xs";

  @state()
  dialogRef = createRef<HTMLDialogElement>();

  private open_modal() {
    const dialogElement = this.dialogRef.value!;
    dialogElement?.showModal();
  }

  dialogTemplete() {
    return html`<dialog
      id=${`ship_modal_${this.ship.id}`}
      ${ref(this.dialogRef)}
      class="modal"
    >
      <div class="modal-box bg-base-100  overflow-x-hidden">
        <form method="dialog">
          <button
            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
          >
            <!-- <IconXMark class="h-6 w-6" /> -->
            X
          </button>
        </form>
        <component-ship-table
          .ship=${this.ship}
          .mst_ship=${this.mst_ship}
          .mst_slot_items=${this.mst_slot_items}
          .slot_items=${this.slot_items}
        ></component-ship-table>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>`;
  }

  render() {
    return html`
      <div class="w-full cursor-pointer" @click="${this.open_modal}">
        <component-ship
          .ship=${this.ship}
          .mst_ship=${this.mst_ship}
          size=${this.size}
          color=${""}
          ?compact=${false}
        ></component-ship>
      </div>
      ${this.dialogTemplete()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-ship-modal": ComponentEquipmentModal;
  }
}

export const ComponentEquipmentModalBasic = (
  args: ComponentEquipmentModalProps
) => {
  return html`<component-ship-modal
    .slot_items=${args.slot_items}
    .mst_slot_items=${args.mst_slot_items}
    .ship=${args.ship}
    .mst_ship=${args.mst_ship}
    size=${args.size}
  ></component-ship-modal>`;
};
