import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import {
  default_mst_slot_item,
  type MstSlotitem,
} from "../../interface/get_data";

import "../../icons/equipment";
import "../../icons/plane-proficiency";

export interface ComponentEquipmentMstProps {
  mst_slot_item: MstSlotitem;
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
    proficiency_onslot_mt: "mt-px",
    proficiency_onslot_pl: "pl-1.5",
  },
  sm: {
    name_text: "text-lg",
    proficiency_onslot_mt: "mt-1",
    proficiency_onslot_pl: "pl-2",
  },
  md: {
    name_text: "text-xl",
    proficiency_onslot_mt: "mt-1.5",
    proficiency_onslot_pl: "pl-2.5",
  },
  lg: {
    name_text: "text-2xl",
    proficiency_onslot_mt: "mt-1.5",
    proficiency_onslot_pl: "pl-3",
  },
  xl: {
    name_text: "text-3xl",
    proficiency_onslot_mt: "mt-1.5",
    proficiency_onslot_pl: "pl-4",
  },
};

@customElement("component-equipment-mst")
export class ComponentEquipmentMst extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  mst_slot_item: MstSlotitem = default_mst_slot_item;

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

  render() {
    let category_number = this.mst_slot_item.type[1];
    let icon_number = this.mst_slot_item.type[3];
    let proficiency_onslot = html`
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
    let name =
      (this.name_flag ?? false) && !this.empty_flag
        ? html` <div
            class=${[
              "pl-3 truncate content-center cursor-inherit",
              class_size[this.size].name_text,
            ].join(" ")}
          >
            ${this.show_name
              ? (this.mst_slot_item.name ?? "Unknown")
              : "Unknown"}
          </div>`
        : html``;
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
        ${proficiency_onslot} ${name}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-equipment-mst": ComponentEquipmentMst;
  }
}

export const ComponentEquipmentMstBasic = (
  args: ComponentEquipmentMstProps
) => {
  return html`<component-equipment-mst
    .mst_slot_item=${args.mst_slot_item}
    ?name_flag=${args.name_flag}
    ?show_name=${args.show_name}
    size=${args.size}
    ?empty_flag=${args.empty_flag}
    ?compact=${args.compact}
  ></component-equipment-mst>`;
};
