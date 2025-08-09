import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import type { SlotItem } from "@ipc-bindings/require_info";
import { default_slotitem } from "@ipc-bindings/default_state/require_info";

import type { MstSlotItem } from "@ipc-bindings/get_data";
import { default_mst_slot_item } from "@ipc-bindings/default_state/get_data";

import "./equipment";
import "./equipment-table";
import { createRef, ref, type Ref } from "lit/directives/ref.js";

export interface ComponentEquipmentModalProps {
  mst_slot_item?: MstSlotItem;
  slot_item?: SlotItem;
  ex_flag?: boolean;
  name_flag?: boolean;
  "attr:onslot"?: number;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  empty_flag?: boolean;
}

@customElement("component-equipment-modal")
export class ComponentEquipmentModal extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  slot_item?: SlotItem = default_slotitem;

  @property({ type: Object })
  mst_slot_item?: MstSlotItem = default_mst_slot_item;

  @property({ type: Boolean })
  ex_flag: boolean = false;

  @property({ type: Number })
  "attr:onslot": number = 0;

  @property({ type: Boolean })
  name_flag: boolean = false;

  @property({ type: String })
  size: "xs" | "sm" | "md" | "lg" | "xl" = "xs";

  @property({ type: Boolean })
  empty_flag = false;

  @state()
  dialogRef: Ref<HTMLDialogElement> = createRef();

  private open_modal() {
    const dialogElement = this.dialogRef.value!;
    dialogElement?.showModal();
  }

  dialogTemplete() {
    return html`<dialog ${ref(this.dialogRef)} class="modal">
      <div class="modal-box bg-base-100 modal-box-width">
        <form method="dialog">
          <button
            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
          >
            <!-- <IconXMark class="h-6 w-6" /> -->
            X
          </button>
        </form>
        <component-equipment-table
          .slot_item=${this.slot_item}
          .mst_slot_item=${this.mst_slot_item}
        ></component-equipment-table>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>`;
  }

  render() {
    return !this.empty_flag
      ? html`
          <div class="w-full cursor-pointer" @click="${this.open_modal}">
            <component-equipment
              .slot_item=${this.slot_item}
              .mst_slot_item=${this.mst_slot_item}
              size=${this.size}
              ?name_flag=${this.name_flag}
              ?ex_flag=${this.ex_flag}
              attr:onslot=${this["attr:onslot"]}
            ></component-equipment>
          </div>
          ${this.dialogTemplete()}
        `
      : html`<div class="w-full cursor-default">
          <component-equipment
            size=${this.size}
            ?empty_flag=${this.empty_flag}
          ></component-equipment>
        </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-equipment-modal": ComponentEquipmentModal;
  }
}
