import { Component } from "solid-js";

export interface ComponentColorBarProps {
  v_now: number;
  v_max: number;
  size?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
  quantize?: number;
  class?: string;
  classList?: any;
}

const class_size = {
  xs: "h-1",
  sm: "h-[6px]",
  md: "h-2",
  lg: "h-[10px]",
  xl: "h-3",
  none: "",
};

const class_color = {
  green: "text-green-500",
  lime: "text-lime-500",
  yellow: "text-yellow-500",
  orange: "text-orange-500",
  red: "text-red-500",
};

const calc_value = (v_now: number, v_max: number, quantize?: number) => {
  if (quantize && quantize > 0) {
    const quantuzed_v_now = v_now - (v_now % (v_max / quantize));
    return v_max != 0 ? (quantuzed_v_now * 100) / v_max : 0;
  } else {
    return v_max != 0 ? (v_now * 100) / v_max : 0;
  }
};

const get_color = (v_now: number, v_max: number) => {
  if (v_now == v_max) {
    return "green";
  } else if (v_now > 0.75 * v_max) {
    return "lime";
  } else if (v_now > 0.5 * v_max) {
    return "yellow";
  } else if (v_now > 0.25 * v_max) {
    return "orange";
  } else {
    return "red";
  }
};

export const ComponentColorBar: Component<ComponentColorBarProps> = (props) => {
  return (
    <div class="flex items-center w-full">
      <progress
        class={[
          "progress w-full",
          class_color[get_color(props.v_now, props.v_max)],
          class_size[props.size ?? "xs"],
        ].join(" ")}
        max="100"
        value={calc_value(props.v_now, props.v_max, props.quantize)}
      ></progress>
    </div>
  );
};
