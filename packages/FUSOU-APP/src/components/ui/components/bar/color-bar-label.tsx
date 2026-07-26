import { Component } from "solid-js";
import { ComponentColorBar } from "./color-bar";

export interface ComponentColorBarLabelProps {
  v_now: number;
  v_max: number;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  quantize?: number;
  class?: string;
  classList?: any;
}

const class_size = {
  xs: {
    label_text: "text-xs",
    label_h: "h-[10px]",
    label_mt: "mt-0.5",
    box_h: "h-6",
    box_py: "py-0.5",
  },
  sm: {
    label_text: "text-sm",
    label_h: "h-[11.5px]",
    label_mt: "mt-0.5",
    box_h: "h-[27px]",
    box_py: "py-0.5",
  },
  md: {
    label_text: "text-md",
    label_h: "h-[13px]",
    label_mt: "mt-0.5",
    box_h: "h-[30px]",
    box_py: "py-0.5",
  },
  lg: {
    label_text: "text-lg",
    label_h: "h-[15.5px]",
    label_mt: "mt-0.5",
    box_h: "h-[35px]",
    box_py: "py-0.5",
  },
  xl: {
    label_text: "text-xl",
    label_h: "h-5",
    label_mt: "mt-0.5",
    box_h: "h-11",
    box_py: "py-0.5",
  },
};

export const ComponentColorBarLabel: Component<ComponentColorBarLabelProps> = (props) => {
  const size = () => props.size ?? "xs";
  return (
    <div
      class={[
        "w-full",
        class_size[size()].box_py,
        class_size[size()].box_h,
      ].join(" ")}
    >
      <div
        class={[
          "grid place-content-center cursor-inherit mx-auto",
          class_size[size()].label_h,
          class_size[size()].label_text,
        ].join(" ")}
      >
        <div class=" flex flex-nowrap">
          <div class="w-[2em] text-center">{props.v_now}</div>
          /
          <div class="w-[2em] text-center">{props.v_max}</div>
        </div>
      </div>
      <div
        class={[
          "flex place-items-center w-full",
          class_size[size()].label_h,
        ].join(" ")}
      >
        <ComponentColorBar
          v_now={props.v_now}
          v_max={props.v_max}
          size={size()}
          quantize={props.quantize}
        />
      </div>
    </div>
  );
};
