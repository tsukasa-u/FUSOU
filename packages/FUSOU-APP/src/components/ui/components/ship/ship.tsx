import { Component, Show } from "solid-js";

import type { MstShip } from "@ipc-bindings/get_data";
import { default_mst_ship } from "@ipc-bindings/default_state/get_data";

import { IconShip, error_ratio } from "../../icons/ship";
import { IconPlaneProficiency } from "../../icons/plane-proficiency";
import { IconError } from "../../icons/error";

export interface ComponentShipProps {
  mst_ship?: MstShip;
  color?: string;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  name_flag?: boolean;
  empty_flag?: boolean;
  class?: string;
  classList?: any;
}

const class_size = {
  xs: {
    name_text: "text-md",
    name_h: "h-6",
  },
  sm: {
    name_text: "text-lg",
    name_h: "h-[27px]",
  },
  md: {
    name_text: "text-xl",
    name_h: "h-[30px]",
  },
  lg: {
    name_text: "text-2xl",
    name_h: "h-[35px]",
  },
  xl: {
    name_text: "text-3xl",
    name_h: "h-11",
  },
};

export const ComponentShip: Component<ComponentShipProps> = (props) => {
  const mst_ship = () => props.mst_ship ?? default_mst_ship;
  const nameTemplete = () => {
    if (props.mst_ship && props.name_flag && !props.empty_flag) {
      return (
        <div
          class={[
            "pl-3 truncate content-center cursor-inherit",
            class_size[props.size].name_text,
            class_size[props.size].name_h,
          ].join(" ")}
        >
          {mst_ship().name ?? "Unknown"}
        </div>
      );
    }
    return null;
  };

  return (
    <Show
      when={props.mst_ship}
      fallback={
        <div class="flex flex-nowarp w-full">
          <div class="outline-error outline-2 rounded bg-error-content">
            <IconError size={props.size} ratio={error_ratio} />
          </div>
          {nameTemplete()}
        </div>
      }
    >
      <div class="flex flex-nowarp w-full">
        <div>
          <IconShip
            ship_stype={mst_ship().stype}
            color={props.color}
            size={props.size}
            empty_flag={props.empty_flag}
          />
        </div>
        {nameTemplete()}
      </div>
    </Show>
  );
};
