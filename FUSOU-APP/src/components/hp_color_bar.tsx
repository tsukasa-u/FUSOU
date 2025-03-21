import { createMemo, JSX } from "solid-js";

interface ColorBarProps {
  v_now: () => number;
  v_max: () => number;
}

export function HpColorBarComponent(
  props: ColorBarProps & JSX.HTMLAttributes<HTMLProgressElement>,
) {
  const progress_color_state = createMemo(() => {
    let props_expand = {
      ...props,
      value:
        props.v_max() != 0
          ? ((props.v_now() ?? 0) * 100) / (props.v_max() ?? -1)
          : 0,
      max: 100,
    };
    let color: JSX.Element = <></>;
    if (props.v_now() == props.v_max())
      color = (
        <progress
          {...props_expand}
          class={
            (props.class != undefined ? props.class : "") +
            " progress [&::-webkit-progress-value]:bg-green-500  [&::-moz-progress-bar]:bg-green-500"
          }
        />
      );
    else if (props.v_now() > 0.75 * props.v_max())
      color = (
        <progress
          {...props_expand}
          class={
            (props.class != undefined ? props.class : "") +
            " progress [&::-webkit-progress-value]:bg-lime-500   [&::-moz-progress-bar]:bg-lime-500"
          }
        />
      );
    else if (props.v_now() > 0.5 * props.v_max())
      color = (
        <progress
          {...props_expand}
          class={
            (props.class != undefined ? props.class : "") +
            " progress [&::-webkit-progress-value]:bg-yellow-500 [&::-moz-progress-bar]:bg-yellow-500"
          }
        />
      );
    else if (props.v_now() > 0.25 * props.v_max())
      color = (
        <progress
          {...props_expand}
          class={
            (props.class != undefined ? props.class : "") +
            " progress [&::-webkit-progress-value]:bg-orange-500 [&::-moz-progress-bar]:bg-orange-500"
          }
        />
      );
    else
      color = (
        <progress
          {...props_expand}
          class={
            (props.class != undefined ? props.class : "") +
            " progress [&::-webkit-progress-value]:bg-red-500    [&::-moz-progress-bar]:bg-red-500"
          }
        />
      );
    return color;
  });

  return <>{progress_color_state}</>;
}
