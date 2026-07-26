import { Component, Show } from "solid-js";

import type { SlotItem } from "@ipc-bindings/require_info";
import type { MstSlotItem } from "@ipc-bindings/get_data";

import { IconEquipment } from "../../icons/equipment";
import { IconPlaneProficiency } from "../../icons/plane-proficiency";
import { IconError } from "../../icons/error";

export interface ComponentEquipmentProps {
  mst_slot_item?: MstSlotItem;
  slot_item?: SlotItem;
  compact?: boolean;
  name_flag?: boolean;
  attr_onslot?: number;
  hide_onslot?: boolean;
  ex_flag?: boolean;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  empty_flag?: boolean;
  class?: string;
  classList?: any;
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

export const ComponentEquipment: Component<ComponentEquipmentProps> = (props) => {
  const show_onslot = (mst_slot_item: MstSlotItem) => {
    const type = mst_slot_item.type[1];
    return (
      !props.hide_onslot &&
      (type == 5 ||
        type == 7 ||
        type == 16 ||
        type == 33 ||
        type == 36 ||
        type == 38 ||
        type == 39 ||
        type == 40 ||
        type == 43 ||
        type == 44)
    );
  };

  const proficiencyOnslotTemplete = () => {
    if (props.slot_item && props.mst_slot_item) {
      if (props.compact) {
        return null;
      } else if (props.empty_flag) {
        return <div class="w-4"></div>;
      } else {
        return (
          <>
            <div
              class={[
                "grid w-4 place-content-center",
                class_size[props.size].proficiency_onslot_h,
              ].join(" ")}
            >
              <IconPlaneProficiency
                class={class_size[props.size].proficiency_onslot_h}
                size="full"
                level={props.slot_item.alv ?? 0}
              />
            </div>
            <div
              class={[
                "grid w-4 place-content-center cursor-inherit",
                class_size[props.size].proficiency_onslot_h,
                class_size[props.size].onslot_text,
              ].join(" ")}
            >
              {show_onslot(props.mst_slot_item) ? props.attr_onslot : ""}
            </div>
          </>
        );
      }
    } else {
      if (!props.compact) return <div class="w-4"></div>;
      else return null;
    }
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
        {props.mst_slot_item.name ?? "Unknown"}
      </div>
    ) : null;
  };

  const levelTemplate = () => {
    return props.slot_item && (props.slot_item.level ?? 0 > 0) && !props.empty_flag ? (
      <div
        class={[
          "badge badge-ghost w-0 rounded-full grid place-content-center text-accent",
          class_size[props.size].badge_size,
        ].join(" ")}
      >
        {props.slot_item.level === 10 ? "★" : props.slot_item.level}
      </div>
    ) : null;
  };

  if ((props.mst_slot_item && props.slot_item) || props.empty_flag) {
    const category_number = props.mst_slot_item ? props.mst_slot_item.type[1] : 0;
    const icon_number = props.mst_slot_item ? props.mst_slot_item.type[3] : 0;

    return (
      <div class="flex flex-nowarp w-full">
        <div class="indicator">
          <span class="indicator-item">{levelTemplate()}</span>
          <IconEquipment
            category_number={category_number}
            icon_number={icon_number}
            size={props.size}
            empty_flag={props.empty_flag}
          />
        </div>

        {!props.ex_flag ? (
          <>
            <div
              class={[
                "flex-none",
                class_size[props.size].proficiency_onslot_pl,
                class_size[props.size].proficiency_onslot_mt,
              ].join(" ")}
            >
              {proficiencyOnslotTemplete()}
            </div>
            {nameTemplete()}
          </>
        ) : null}
      </div>
    );
  } else {
    return (
      <div class="flex flex-nowarp w-full">
        <div class="outline-error outline-2 rounded bg-error-content">
          <IconError size={props.size} ratio={1} />
        </div>
        {!props.ex_flag ? (
          <>
            <div
              class={[
                "flex-none",
                class_size[props.size].proficiency_onslot_pl,
                class_size[props.size].proficiency_onslot_mt,
              ].join(" ")}
            >
              {proficiencyOnslotTemplete()}
            </div>
            {nameTemplete()}
          </>
        ) : null}
      </div>
    );
  }
};
