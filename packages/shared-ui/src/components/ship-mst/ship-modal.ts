import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";

import globalStyles from "../../global.css?inline";

import type { MstShip } from "@ipc-bindings/get_data";
import { default_mst_ship } from "@ipc-bindings/default_state/get_data";

import "./ship";
import "./ship-table";

export interface ComponentShipMstModalProps {
  mst_ship?: MstShip;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  color?: string;
  name_flag?: boolean;
  empty_flag?: boolean;
}

@customElement("component-ship-mst-modal")
export class ComponentShipMstModal extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  mst_ship?: MstShip = default_mst_ship;

  @property({ type: String })
  color = "";

  @property({ type: Boolean })
  name_flag = false;

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
        <component-ship-table .mst_ship=${this.mst_ship}></component-ship-table>
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
    "component-ship-mst-modal": ComponentShipMstModal;
  }
}
