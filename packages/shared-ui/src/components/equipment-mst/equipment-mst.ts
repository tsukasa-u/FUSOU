import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import type { MstSlotItem } from "@ipc-bindings/get_data";
import { default_mst_slot_item } from "@ipc-bindings/default_state/get_data";

import "../../icons/equipment";
import "../../icons/plane-proficiency";
import "../../icons/error";

export interface ComponentEquipmentMstProps {
  mst_slot_item?: MstSlotItem;
  name_flag?: boolean;
  compact?: boolean;
  show_param?: boolean;
  show_name?: boolean;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  empty_flag?: boolean;
}

const class_size = {
  xs: {
    name_text: "text-md",
    name_h: "h-6",
    proficiency_onslot_mt: "mt-0.5",
    proficiency_onslot_pl: "pl-1.5",
  },
  sm: {
    name_text: "text-lg",
    name_h: "h-[27px]",
    proficiency_onslot_mt: "mt-0.5",
    proficiency_onslot_pl: "pl-2",
  },
  md: {
    name_text: "text-xl",
    name_h: "h-[30px]",
    proficiency_onslot_mt: "mt-0.5",
    proficiency_onslot_pl: "pl-2.5",
  },
  lg: {
    name_text: "text-2xl",
    name_h: "h-[35px]",
    proficiency_onslot_mt: "mt-0.5",
    proficiency_onslot_pl: "pl-3",
  },
  xl: {
    name_text: "text-3xl",
    name_h: "h-11",
    proficiency_onslot_mt: "mt-0.5",
    proficiency_onslot_pl: "pl-4",
  },
};

@customElement("component-equipment-mst")
export class ComponentEquipmentMst extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  mst_slot_item?: MstSlotItem = default_mst_slot_item;

  @property({ type: Boolean })
  name_flag: boolean = false;

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  @property({ type: Boolean })
  empty_flag = false;

  @property({ type: Boolean })
  compact = false;

  @property({ type: Boolean })
  show_name = false;

  proficiencyOnslotTemplete() {
    return html`
      <div
        class=${[
          "flex-none",
          class_size[this.size].proficiency_onslot_pl,
          class_size[this.size].proficiency_onslot_mt,
        ].join(" ")}
      >
        ${(this.compact ?? false) ? html`` : html`<div class="w-4"></div>`}
      </div>
    `;
  }

  nameTemplete() {
    return this.mst_slot_item && this.name_flag && !this.empty_flag
      ? html` <div
          class=${[
            "pl-3 truncate content-center cursor-inherit",
            class_size[this.size].name_text,
            class_size[this.size].name_h,
          ].join(" ")}
        >
          ${this.show_name ? (this.mst_slot_item.name ?? "Unknown") : "Unknown"}
        </div>`
      : html``;
  }

  render() {
    if (this.mst_slot_item || this.empty_flag) {
      let category_number = this.mst_slot_item ? this.mst_slot_item.type[1] : 0;
      let icon_number = this.mst_slot_item ? this.mst_slot_item.type[3] : 0;
      return html`
        <div class="flex flex-nowarp w-full">
          <div>
            <icon-equipment
              category_number=${category_number}
              icon_number=${icon_number}
              size=${this.size}
              ?empty_flag=${this.empty_flag}
            ></icon-equipment>
          </div>
          ${this.proficiencyOnslotTemplete()} ${this.nameTemplete()}
        </div>
      `;
    } else {
      return html` <div class="flex flex-nowarp w-full">
        <div class="outline-error outline-2 rounded bg-error-content">
          <icon-error size=${this.size}></icon-error>
        </div>
        ${this.proficiencyOnslotTemplete()} ${this.nameTemplete()}
      </div>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-equipment-mst": ComponentEquipmentMst;
  }
}
