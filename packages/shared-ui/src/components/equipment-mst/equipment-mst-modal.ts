import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import { default_slotitem, type SlotItem } from "../../interface/require_info";
import {
  default_mst_slot_item,
  type MstSlotitem,
} from "../../interface/get_data";
import { ifDefined } from "lit/directives/if-defined.js";

import "./equipment-mst";
import "./equipment-mst-table";
import { createRef, ref } from "lit/directives/ref.js";

export interface ComponentEquipmentMstModalProps {
  mst_slot_item: MstSlotitem;
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
  mst_slot_item: MstSlotitem = default_mst_slot_item;

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
  dialogRef = createRef<HTMLDialogElement>();

  private open_modal() {
    const dialogElement = this.dialogRef.value!;
    dialogElement?.showModal();
  }

  dialogTemplete() {
    return html`<dialog
      id=${`equipment-mst_modal_${this.mst_slot_item.id}`}
      ${ref(this.dialogRef)}
      class="modal"
    >
      <div class="modal-box bg-base-100 modal-box-width">
        <form method="dialog">
          <button
            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
          >
            <!-- <IconXMark class="h-6 w-6" /> -->
            X
          </button>
        </form>
        <component-equipment-mst-table
          .mst_slot_item=${this.mst_slot_item}
          ?show_param=${this.show_param}
        ></component-equipment-mst-table>
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
            <component-equipment-mst
              .mst_slot_item=${this.mst_slot_item}
              size=${this.size}
              ?name_flag=${this.name_flag}
              ?compact=${this.comapct}
              ?empty_flag=${this.empty_flag}
              ?show_name=${this.show_name}
            ></component-equipment-mst>
          </div>
          ${this.dialogTemplete()}
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

export const ComponentEquipmentMstModalBasic = (
  args: ComponentEquipmentMstModalProps
) => {
  return html`<component-equipment-mst-modal
    .mst_slot_item=${args.mst_slot_item}
    ?name_flag=${args.name_flag}
    ?show_name=${args.show_name}
    ?show_param=${args.show_param}
    ?comapct=${args.compact}
    size=${args.size}
    ?empty_flag=${args.empty_flag}
  ></component-equipment-mst-modal>`;
};
