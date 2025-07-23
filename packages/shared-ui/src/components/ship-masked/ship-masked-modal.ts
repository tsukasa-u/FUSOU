import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";

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

import "../ship/ship";
import "./ship-masked-table";

export interface ComponentShipMaskedModalProps {
  mst_ship: MstShip;
  ship: Ship;
  mst_slot_items: MstSlotitems;
  slot_items: SlotItems;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  color?: string;
  name_flag?: boolean;
  empty_flag?: boolean;
  ship_param: number[];
  ship_slot: number[];
  ship_max_hp: number;
}

@customElement("component-ship-masked-modal")
export class ComponentShipMaskedModal extends LitElement {
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
  color = "";

  @property({ type: Boolean })
  name_flag = false;

  @property({ type: String })
  size: "xs" | "sm" | "md" | "lg" | "xl" = "xs";

  @property({ type: Boolean })
  empty_flag = false;

  @property({ type: Array })
  ship_param: number[] = [0, 0, 0, 0];

  @property({ type: Array })
  ship_slot: number[] = [0, 0, 0, 0, 0];

  @property({ type: Number })
  ship_max_hp: number = 0;

  @state()
  dialogRef: Ref<HTMLDialogElement> = createRef();

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
        <component-ship-masked-table
          .mst_ship=${this.mst_ship}
          .mst_slot_items=${this.mst_slot_items}
          ship_max_hp=${this.ship_max_hp}
          .ship_param=${this.ship_param}
          .ship_slot=${this.ship_slot}
        ></component-ship-masked-table>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>`;
  }

  render() {
    return !this.empty_flag
      ? html` <div class="w-full cursor-pointer" @click="${this.open_modal}">
            <component-ship
              .mst_ship=${this.mst_ship}
              size=${this.size}
              color=${this.color}
              ?name_flag=${this.name_flag}
            ></component-ship>
          </div>
          ${this.dialogTemplete()}`
      : html`<div class="w-full cursor-default">
          <component-ship
            size=${this.size}
            ?empty_flag=${this.empty_flag}
            ?name_flag=${false}
          ></component-ship>
        </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-ship-masked-modal": ComponentShipMaskedModal;
  }
}
