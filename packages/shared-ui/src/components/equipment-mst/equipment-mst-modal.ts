import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import type { MstSlotItem } from "@ipc-bindings/get_data";
import { default_mst_slot_item } from "@ipc-bindings/default_state/get_data";

import "./equipment-mst";
import "./equipment-mst-table";
import { createRef, ref, type Ref } from "lit/directives/ref.js";

export interface ComponentEquipmentMstModalProps {
  mst_slot_item?: MstSlotItem;
  name_flag?: boolean;
  show_name?: boolean;
  show_param?: boolean;
  compact?: boolean;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  empty_flag?: boolean;
}

@customElement("component-equipment-mst-modal")
export class ComponentEquipmentMstModal extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  mst_slot_item?: MstSlotItem = default_mst_slot_item;

  @property({ type: Boolean })
  comapct: boolean = false;

  @property({ type: Boolean })
  name_flag: boolean = false;

  @property({ type: Boolean })
  show_name: boolean = false;

  @property({ type: Boolean })
  show_param: boolean = false;

  @property({ type: String })
  size: "xs" | "sm" | "md" | "lg" | "xl" = "xs";

  @property({ type: Boolean })
  empty_flag = false;

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
      <div class="modal-box materialsmodal-box-width">
        <form method="dialog">
          <button
            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
            @click="${this.close_modal}"
          >
            <!-- <IconXMark class="h-6 w-6" /> -->
            X
          </button>
        </form>
        <component-equipment-mst-table
          .mst_slot_item=${this.mst_slot_item}
          ?show_param=${this.show_param}
          ?show_name=${this.show_name}
        ></component-equipment-mst-table>
      </div>
      <form method="dialog" class="modal-backdrop" @click="${this.close_modal}">
        <button>close</button>
      </form>
    </dialog>`;
  }

  render() {
    return !this.empty_flag
      ? html`
          <div class="w-full cursor-pointer" @click="${this.open_modal}">
            <component-equipment-mst
              .mst_slot_item=${this.mst_slot_item}
              size=${this.size}
              ?name_flag=${this.name_flag}
              ?compact=${this.comapct}
              ?empty_flag=${this.empty_flag}
              ?show_name=${this.show_name}
            ></component-equipment-mst>
          </div>
          ${this.show_dialog ? this.dialogTemplete() : html``}
        `
      : html`<div class="w-full cursor-default">
          <component-equipment-mst
            size=${this.size}
            ?empty_flag=${this.empty_flag}
            .mst_slot_item=${this.mst_slot_item}
            ?compact=${this.comapct}
            ?name_flag=${false}
          ></component-equipment-mst>
        </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-equipment-mst-modal": ComponentEquipmentMstModal;
  }
}
