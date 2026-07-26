import { Component, Show } from "solid-js";

import type { MstSlotItem } from "@ipc-bindings/get_data";
import { default_mst_slot_item } from "@ipc-bindings/default_state/get_data";

import { IconEquipment } from "../../icons/equipment";
import { IconPlaneProficiency } from "../../icons/plane-proficiency";
import { IconError } from "../../icons/error";

export interface ComponentEquipmentMstProps {
  mst_slot_item?: MstSlotItem;
  name_flag?: boolean;
  compact?: boolean;
  show_param?: boolean;
  show_name?: boolean;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  empty_flag?: boolean;
  class?: string;
  classList?: any;
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

export const ComponentEquipmentMst: Component<ComponentEquipmentMstProps> = (props) => {
  const mst_slot_item = () => props.mst_slot_item ?? default_mst_slot_item;

  const proficiencyOnslotTemplete = () => {
    return (
      <div
        class={[
          "flex-none",
          class_size[props.size].proficiency_onslot_pl,
          class_size[props.size].proficiency_onslot_mt,
        ].join(" ")}
      >
        {props.compact ? null : <div class="w-4"></div>}
      </div>
    );
  };

  const nameTemplete = () => {
    return props.mst_slot_item && props.name_flag && !props.empty_flag ? (
      <div
        class={[
          "pl-3 truncate content-center cursor-inherit",
          class_size[props.size].name_text,
          class_size[props.size].name_h,
        ].join(" ")}
      >
        {props.show_name ? (props.mst_slot_item.name ?? "Unknown") : "Unknown"}
      </div>
    ) : null;
  };

  if (props.mst_slot_item || props.empty_flag) {
    const category_number = props.mst_slot_item ? props.mst_slot_item.type[1] : 0;
    const icon_number = props.mst_slot_item ? props.mst_slot_item.type[3] : 0;
    return (
      <div class="flex flex-nowarp w-full">
        <div>
          <IconEquipment
            category_number={category_number}
            icon_number={icon_number}
            size={props.size}
            empty_flag={props.empty_flag}
          />
        </div>
        {proficiencyOnslotTemplete()} {nameTemplete()}
      </div>
    );
  } else {
    return (
      <div class="flex flex-nowarp w-full">
        <div class="outline-error outline-2 rounded bg-error-content">
          <IconError size={props.size} ratio={1} />
        </div>
        {proficiencyOnslotTemplete()} {nameTemplete()}
      </div>
    );
  }
};
