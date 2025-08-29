import { html, LitElement, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import type { SlotItem } from "@ipc-bindings/require_info";
// import { default_slotitem } from "@ipc-bindings/default_state/require_info";

import type { MstSlotItem } from "@ipc-bindings/get_data";
// import { default_mst_slot_item } from "@ipc-bindings/default_state/get_data";

import "../../icons/equipment";
import "../../icons/plane-proficiency";
import "../../icons/error";

export interface ComponentEquipmentProps {
  mst_slot_item?: MstSlotItem;
  slot_item?: SlotItem;
  compact?: boolean;
  name_flag?: boolean;
  "attr:onslot"?: number;
  ex_flag?: boolean;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  empty_flag?: boolean;
}

const class_size = {
  xs: {
    onslot_text: "text-xs",
    name_text: "text-md",
    name_h: "h-6",
    proficiency_onslot_h: "h-[10px]",
    proficiency_onslot_mt: "mt-0.5",
    proficiency_onslot_pl: "pl-1.5",
    badge_size: "badge-xs",
  },
  sm: {
    onslot_text: "text-sm",
    name_text: "text-lg",
    name_h: "h-[27px]",
    proficiency_onslot_h: "h-[11.5px]",
    proficiency_onslot_mt: "mt-0.5",
    proficiency_onslot_pl: "pl-2",
    badge_size: "badge-sm",
  },
  md: {
    onslot_text: "text-md",
    name_text: "text-xl",
    name_h: "h-[30px]",
    proficiency_onslot_h: "h-[13px]",
    proficiency_onslot_mt: "mt-0.5",
    proficiency_onslot_pl: "pl-2.5",
    badge_size: "badge-md",
  },
  lg: {
    onslot_text: "text-lg",
    name_text: "text-2xl",
    name_h: "h-[35px]",
    proficiency_onslot_h: "h-[15.5px]",
    proficiency_onslot_mt: "mt-0.5",
    proficiency_onslot_pl: "pl-3",
    badge_size: "badge-lg",
  },
  xl: {
    onslot_text: "text-xl",
    name_text: "text-3xl",
    name_h: "h-11",
    proficiency_onslot_h: "h-5",
    proficiency_onslot_mt: "mt-0.5",
    proficiency_onslot_pl: "pl-4",
    badge_size: "badge-xl",
  },
};

const show_onslot = (mst_slot_item: MstSlotItem) => {
  const type = mst_slot_item.type[1];
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
  slot_item?: SlotItem = undefined;

  @property({ type: Object })
  mst_slot_item?: MstSlotItem = undefined;

  @property({ type: Boolean })
  compact: boolean = false;

  @property({ type: Number })
  "attr:onslot": number = 0;

  @property({ type: Boolean })
  name_flag: boolean = false;

  @property({ type: String })
  size: keyof typeof class_size = "xs";

  @property({ type: Boolean })
  empty_flag = false;

  @property({ type: Boolean })
  ex_flag = false;

  proficiencyOnslotTemplete() {
    if (this.slot_item && this.mst_slot_item) {
      if (this.compact) {
        return html``;
      } else if (this.empty_flag) {
        return html`<div class="w-4"></div>`;
      } else {
        return html`<div
            class=${[
              "grid w-4 place-content-center",
              class_size[this.size].proficiency_onslot_h,
            ].join(" ")}
          >
            <icon-plane-proficiency
              class=${class_size[this.size].proficiency_onslot_h}
              size="full"
              level=${this.slot_item.alv ?? 0}
            ></icon-plane-proficiency>
          </div>
          <div
            class=${[
              "grid w-4 place-content-center cursor-inherit",
              class_size[this.size].proficiency_onslot_h,
              class_size[this.size].onslot_text,
            ].join(" ")}
          >
            ${show_onslot(this.mst_slot_item) ? this["attr:onslot"] : ""}
          </div>`;
      }
    } else {
      if (!this.compact) return html`<div class="w-4"></div>`;
      else return html``;
    }
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
          ${this.mst_slot_item.name ?? "Unknown"}
        </div>`
      : html``;
  }

  levelTemplate() {
    return this.slot_item && (this.slot_item.level ?? 0 > 0) && !this.empty_flag
      ? html` <div
          class=${[
            "badge badge-ghost w-0 rounded-full grid place-content-center text-accent",
            class_size[this.size].badge_size,
          ].join(" ")}
        >
          ${this.slot_item.level === 10 ? "★" : this.slot_item.level}
        </div>`
      : html``;
  }

  render() {
    if ((this.mst_slot_item && this.slot_item) || this.empty_flag) {
      const category_number = this.mst_slot_item
        ? this.mst_slot_item.type[1]
        : 0;
      const icon_number = this.mst_slot_item ? this.mst_slot_item.type[3] : 0;

      return html`
        <div class="flex flex-nowarp w-full">
          <div class="indicator">
            <span class="indicator-item"> ${this.levelTemplate()} </span>
            <icon-equipment
              category_number=${category_number}
              icon_number=${icon_number}
              size=${this.size}
              ?empty_flag=${this.empty_flag}
            ></icon-equipment>
          </div>

          ${!this.ex_flag
            ? html`<div
                  class=${[
                    "flex-none",
                    class_size[this.size].proficiency_onslot_pl,
                    class_size[this.size].proficiency_onslot_mt,
                  ].join(" ")}
                >
                  ${this.proficiencyOnslotTemplete()}
                </div>
                ${this.nameTemplete()}`
            : html``}
        </div>
      `;
    } else {
      return html` <div class="flex flex-nowarp w-full">
        <div class="outline-error outline-2 rounded bg-error-content">
          <icon-error size=${this.size}></icon-error>
        </div>
        ${!this.ex_flag
          ? html`<div
                class=${[
                  "flex-none",
                  class_size[this.size].proficiency_onslot_pl,
                  class_size[this.size].proficiency_onslot_mt,
                ].join(" ")}
              >
                ${this.proficiencyOnslotTemplete()}
              </div>
              ${this.nameTemplete()}`
          : html``}
      </div>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "component-equipment": ComponentEquipment;
  }
}
