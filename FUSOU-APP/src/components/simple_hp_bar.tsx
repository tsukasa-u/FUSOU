import { HpColorBarComponent } from "./hp_color_bar";

interface ColorBarProps {
    v_now: () => number;
    v_max: () => number;
}

export function SimpleHpBar({v_now, v_max}: ColorBarProps) {

    return <>
        <div class="flex-none">
            <div class="grid h-2.5 w-12 place-content-center">
                <div class="grid grid-flow-col auto-cols-max gap-1">
                    <div>{ v_now() }</div>
                    <div>/</div>
                    <div>{ v_max()}</div>
                </div>
            </div>
            <div class="grid h-2.5 w-12 place-content-center">
                <HpColorBarComponent class="w-12 h-1" v_now={v_now} v_max={v_max}></HpColorBarComponent>
            </div>
        </div>
    </>;
}