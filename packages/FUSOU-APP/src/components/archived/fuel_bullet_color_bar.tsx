import type { JSX } from "solid-js";
import { createMemo } from "solid-js";

interface ColorBarProps {
  v_now: () => number;
  v_max: () => number;
}

export function FuelBulletColorBarComponent(
  props: ColorBarProps & JSX.HTMLAttributes<HTMLProgressElement>,
) {
  const progress_color_state = createMemo(() => {
    const props_expand = {
      ...props,
      value:
        props.v_max() != 0
          ? ((props.v_now() ?? 0) * 100) / (props.v_max() ?? -1)
          : 0,
      max: 100,
    };
    const progress_color_list: JSX.Element[] = [
      <progress
        {...props_expand}
        class={
          (props.class != undefined ? props.class : "") +
          " progress [&::-webkit-progress-value]:bg-black      [&::-moz-progress-bar]:bg-black"
        }
      />,
      <progress
        {...props_expand}
        class={
          (props.class != undefined ? props.class : "") +
          " progress [&::-webkit-progress-value]:bg-red-500    [&::-moz-progress-bar]:bg-red-500"
        }
      />,
      <progress
        {...props_expand}
        class={
          (props.class != undefined ? props.class : "") +
          " progress [&::-webkit-progress-value]:bg-orange-500 [&::-moz-progress-bar]:bg-orange-500"
        }
      />,
      <progress
        {...props_expand}
        class={
          (props.class != undefined ? props.class : "") +
          " progress [&::-webkit-progress-value]:bg-yellow-500 [&::-moz-progress-bar]:bg-yellow-500"
        }
      />,
      <progress
        {...props_expand}
        class={
          (props.class != undefined ? props.class : "") +
          " progress [&::-webkit-progress-value]:bg-green-500  [&::-moz-progress-bar]:bg-green-500"
        }
      />,
    ];

    let color: JSX.Element = <></>;
    if (props.v_now() == props.v_max()) color = progress_color_list[4];
    else if (9 * props.v_now() >= 7 * props.v_max())
      color = progress_color_list[3];
    else if (9 * props.v_now() >= 3 * props.v_max())
      color = progress_color_list[2];
    else if (props.v_now() >= 0) color = progress_color_list[1];
    return color;
  });

  return <>{progress_color_state()}</>;
}
