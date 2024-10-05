import { createMemo, JSX } from "solid-js";

interface ColorBarProps {
    v_now: number;
    v_max: number;
}

export function HpColorBarComponent({v_now, v_max, ...props}: ColorBarProps & JSX.HTMLAttributes<HTMLProgressElement>) {
    const progress_color_state = createMemo(() => {
        let props_expand = { ...props, value: v_max != 0 ? (v_now ?? 0) * 100 / (v_max ?? -1) : 0, max: 100 };
        console.log(props.class);
        const progress_color_list: JSX.Element[] = [
            <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-black      [&::-moz-progress-bar]:bg-black"     }></progress>,
            <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-red-500    [&::-moz-progress-bar]:bg-red-500"   }></progress>,
            <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-orange-500 [&::-moz-progress-bar]:bg-orange-500"}></progress>,
            <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-yellow-500 [&::-moz-progress-bar]:bg-yellow-500"}></progress>,
            <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-lime-500   [&::-moz-progress-bar]:bg-lime-500"  }></progress>,
            <progress {...props_expand} class={(props.class != undefined ? props.class : "")+" progress [&::-webkit-progress-value]:bg-green-500  [&::-moz-progress-bar]:bg-green-500" }></progress>,
        ];
        
        let color: JSX.Element = <></>;
        if (v_now == v_max) color = progress_color_list[5];
        else if (v_now > 0.75*v_max) color = progress_color_list[4];
        else if (v_now > 0.5*v_max) color = progress_color_list[3];
        else if (v_now > 0.25*v_max) color = progress_color_list[2];
        else color = progress_color_list[1];
        return color;
    });

    return <>
        { progress_color_state }
    </>;
}