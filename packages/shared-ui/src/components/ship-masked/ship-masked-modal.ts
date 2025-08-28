import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";

import globalStyles from "../../global.css?inline";

import type { MstShip, MstSlotItems } from "@ipc-bindings/get_data";
import {
  default_mst_ship,
  default_mst_slot_items,
} from "@ipc-bindings/default_state/get_data";

import "../ship/ship";
import "./ship-masked-table";

export interface ComponentShipMaskedModalProps {
  mst_ship?: MstShip;
  mst_slot_items?: MstSlotItems;
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
  mst_ship?: MstShip = default_mst_ship;

  @property({ type: Object })
  mst_slot_items?: MstSlotItems = default_mst_slot_items;

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

  @state()
  show_dialog = false;

  private async open_modal() {
    this.show_dialog = true;
    await this.updateComplete;
    const dialogElement = this.dialogRef.value!;
    dialogElement?.showModal();
  }
  
  private close_modal(e: Event) {
    e.preventDefault();
    this.show_dialog = false;
  }

  dialogTemplete() {
    return html`<dialog ${ref(this.dialogRef)} class="modal">
      <div class="modal-box materials overflow-x-hidden">
        <form method="dialog">
          <button
            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
            @click="${this.close_modal}"
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
      <form method="dialog" class="modal-backdrop" @click="${this.close_modal}">
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
          ${this.show_dialog ? this.dialogTemplete() : html``}`
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
