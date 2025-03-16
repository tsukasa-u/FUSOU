import { createMemo, JSX } from "solid-js";

interface ColorBarProps {
    v_now: () => number;
    v_max: () => number;
}

export function HpColorBarComponent({v_now, v_max, ...props}: ColorBarProps & JSX.HTMLAttributes<HTMLProgressElement>) {
    const progress_color_state = createMemo(() => {
        let props_expand = { ...props, value: v_max() != 0 ? (v_now() ?? 0) * 100 / (v_max() ?? -1) : 0, max: 100 };
        let color: JSX.Element = <></>;
        if (v_now() == v_max())          color = <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-green-500  [&::-moz-progress-bar]:bg-green-500" }></progress>;
        else if (v_now() > 0.75*v_max()) color = <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-lime-500   [&::-moz-progress-bar]:bg-lime-500"  }></progress>;
        else if (v_now() > 0.5*v_max())  color = <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-yellow-500 [&::-moz-progress-bar]:bg-yellow-500"}></progress>;
        else if (v_now() > 0.25*v_max()) color = <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-orange-500 [&::-moz-progress-bar]:bg-orange-500"}></progress>;
        else                         color = <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-red-500    [&::-moz-progress-bar]:bg-red-500"   }></progress>;
        return color;
    });

    return <>
        { progress_color_state }
    </>;
}