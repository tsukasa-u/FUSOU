import { createMemo, JSX } from "solid-js";

interface ColorBarProps {
    v_now: () => number;
    v_max: () => number;
}

export function FuelBulletColorBarComponent({v_now, v_max, ...props}: ColorBarProps  & JSX.HTMLAttributes<HTMLProgressElement>) {
    const progress_color_state = createMemo(() => {
        let props_expand = { ...props, value: v_max() != 0 ? (v_now() ?? 0) * 100 / (v_max() ?? -1) : 0, max: 100 };
        const progress_color_list: JSX.Element[] = [
            <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-black      [&::-moz-progress-bar]:bg-black"     }></progress>,
            <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-red-500    [&::-moz-progress-bar]:bg-red-500"   }></progress>,
            <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-orange-500 [&::-moz-progress-bar]:bg-orange-500"}></progress>,
            <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-yellow-500 [&::-moz-progress-bar]:bg-yellow-500"}></progress>,
            <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-green-500  [&::-moz-progress-bar]:bg-green-500" }></progress>,
        ];

        let color: JSX.Element = <></>;
        if (v_now() == v_max()) color = progress_color_list[4];
        else if (9*v_now() >= 7*v_max()) color = progress_color_list[3];
        else if (9*v_now() >= 3*v_max()) color = progress_color_list[2];
        else if (v_now() >= 0) color = progress_color_list[1];
        return color;
    });

    return <>
        { progress_color_state }
    </>;
};