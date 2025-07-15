import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import { default_slotitem, type SlotItem } from "../../interface/require_info";
import {
  default_mst_slot_item,
  type MstSlotitem,
} from "../../interface/get_data";
import { ifDefined } from "lit/directives/if-defined.js";

import "../../icons/equipment";
import "../../icons/plane-proficiency";

export interface ComponentEquipmentProps {
  mst_slot_item: MstSlotitem;
  slot_item: SlotItem;
  ex_flag?: boolean;
  name_flag?: boolean;
  onslot?: number;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  empty_flag?: boolean;
}

const class_size = {
  xs: {
    onslot_text: "text-xs",
    name_text: "text-md",
    proficiency_onslot_h: "h-2.5",
    proficiency_onslot_mt: "mt-px",
    proficiency_onslot_pl: "pl-1.5",
    badge_size: "badge-xs",
  },
  sm: {
    onslot_text: "text-sm",
    name_text: "text-lg",
    proficiency_onslot_h: "h-[11px]",
    proficiency_onslot_mt: "mt-1",
    proficiency_onslot_pl: "pl-2",
    badge_size: "badge-sm",
  },
  md: {
    onslot_text: "text-md",
    name_text: "text-xl",
    proficiency_onslot_h: "h-3",
    proficiency_onslot_mt: "mt-1.5",
    proficiency_onslot_pl: "pl-2.5",
    badge_size: "badge-md",
  },
  lg: {
    onslot_text: "text-lg",
    name_text: "text-2xl",
    proficiency_onslot_h: "h-4",
    proficiency_onslot_mt: "mt-1.5",
    proficiency_onslot_pl: "pl-3",
    badge_size: "badge-lg",
  },
  xl: {
    onslot_text: "text-xl",
    name_text: "text-3xl",
    proficiency_onslot_h: "h-5.5",
    proficiency_onslot_mt: "mt-1.5",
    proficiency_onslot_pl: "pl-4",
    badge_size: "badge-xl",
  },
};

const show_onslot = (mst_slot_item: MstSlotitem) => {
  let type = mst_slot_item.type[1];
  return (
    type == 5 ||
    type == 7 ||
    type == 16 ||
    type == 33 ||
    type == 36 ||
    type == 38 ||
    type == 39 ||
    type == 40 ||
    type == 43 ||
    type == 44
  );
};

@customElement("component-equipment")
export class ComponentEquipment extends LitElement {
  static styles = [unsafeCSS(globalStyles)];

  @property({ type: Object })
  slot_item: SlotItem = default_slotitem;

  @property({ type: Object })
  mst_slot_item: MstSlotitem = default_mst_slot_item;

  @property({ type: Boolean })
  ex_flag: boolean = false;

  @property({ type: Number })
  onslot: number = 0;

  @property({ type: Boolean })
  name_flag: boolean = false;

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  @property({ type: Boolean })
  empty_flag = false;

  render() {
    let category_number = this.mst_slot_item.type[1];
    let icon_number = this.mst_slot_item.type[3];
    let level =
      (this.slot_item.level ?? 0 > 0) && !this.empty_flag
        ? html` <div
            class=${[
              "badge badge-ghost w-0 rounded-full grid place-content-center text-accent",
              class_size[this.size].badge_size,
            ].join(" ")}
          >
            ${this.slot_item.level === 10 ? "★" : this.slot_item.level}
          </div>`
        : html``;
    let proficiency_onslot = html`
      <div
        class=${[
          "flex-none",
          class_size[this.size].proficiency_onslot_pl,
          class_size[this.size].proficiency_onslot_mt,
        ].join(" ")}
      >
        ${!(this.ex_flag ?? false) && !this.empty_flag
          ? html`<div
                class=${[
                  "grid w-4 place-content-center",
                  class_size[this.size].proficiency_onslot_h,
                ].join(" ")}
              >
                <icon-plane-proficiency
                  class=${class_size[this.size].proficiency_onslot_h}
                  size="full"
                  level=${ifDefined(this.slot_item.alv)}
                ></icon-plane-proficiency>
              </div>
              <div
                class=${[
                  "grid w-4 place-content-center cursor-inherit",
                  class_size[this.size].proficiency_onslot_h,
                  class_size[this.size].onslot_text,
                ].join(" ")}
              >
                ${show_onslot(this.mst_slot_item) ? this.onslot : ""}
              </div>`
          : html`<div class="w-4"></div>`}
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
            ${this.mst_slot_item.name ?? "Unknown"}
          </div>`
        : html``;
    return html`
      <div class="flex flex-nowarp w-full">
        <div class="indicator">
          <span class="indicator-item"> ${level} </span>
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
    "component-equipment": ComponentEquipment;
  }
}

export const ComponentEquipmentBasic = (args: ComponentEquipmentProps) => {
  return html`<component-equipment
    .slot_item=${args.slot_item}
    .mst_slot_item=${args.mst_slot_item}
    ?ex_flag=${args.ex_flag}
    ?name_flag=${args.name_flag}
    onslot=${ifDefined(args.onslot)}
    size=${args.size}
    ?empty_flag=${args.empty_flag}
  ></component-equipment>`;
};
