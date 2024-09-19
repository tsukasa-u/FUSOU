import { Slot, component$, useComputed$, useStylesScoped$, JSXOutput, useSignal } from '@builder.io/qwik';

import { DeckPort, Ships } from "./interface/port.ts";
import { MstShips } from "./interface/get_data.ts";

import { ColorBar } from './color_bar.tsx';

import { IconCautionFill } from './icons/caution_fill.tsx';
import { IconKira1 } from './icons/kira1.tsx';
import { IconKira2 } from './icons/kira2.tsx';
import { IconKira3 } from './icons/kira3.tsx';

import { Bs1Square, Bs2Square, Bs3Square, Bs4Square, Bs5Square, Bs0Square } from "@qwikest/icons/bootstrap";

interface DeckPortProps {
    deckPort: DeckPort;
    ships: Ships;
    mst_ships: MstShips;
}
 
export const Deck = component$<DeckPortProps>(({ deckPort, ships, mst_ships }) => {

    const fleet_name: {[key:number]:string} = {
        1: "First Fleet",
        2: "Second Fleet",
        3: "Third Fleet",
        4: "Fourth Fleet",
    }

    useStylesScoped$(`
        .divider-horizontal:before {
            height: 100%;
            width: 1px;
        }
        .divider-horizontal:after {
            height: 100%;
            width: 1px;
        }
    `);

    const cond_state = useComputed$(() => {
        const cond_list: JSXOutput[] = [
            <IconKira3 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira3>,
            <IconKira2 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira2>,
            <IconKira1 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira1>,
            <></>,
            <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-orange-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2"></IconCautionFill>,
        ];
        const set_cond_state = (cond: number): JSXOutput => {
            let cond_state: JSXOutput = <></>;
            if (cond >= 71) cond_state = cond_list[0];
            else if (cond >= 58) cond_state = cond_list[1];
            else if (cond >= 50) cond_state = cond_list[2];
            else if (cond == 49) cond_state = cond_list[3];
            else if (cond >= 40) cond_state = cond_list[4];
            else if (cond >= 30) cond_state = cond_list[5];
            else if (cond >= 20) cond_state = cond_list[6];
            else if (cond >=  0) cond_state = cond_list[7];
            return cond_state;
        };

        let states: JSXOutput[] = [];
        deckPort.ship?.forEach((shipId) => {
            states.push(set_cond_state(ships.ships[shipId]?.cond ?? 0));
        });
        return states;
    });

    const hp_state = useComputed$(() => {
        const hp_list: JSXOutput[] = [
            <></>,
            <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-orange-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2"></IconCautionFill>,
        ];

        const set_hp_state = (nowhp: number, maxhp: number): JSXOutput => {
            let hp_state: JSXOutput = <></>;
            if (nowhp > 0.75*maxhp) hp_state = hp_list[0];
            else if (nowhp > 0.5*maxhp) hp_state = hp_list[1];
            else if (nowhp > 0.25*maxhp) hp_state = hp_list[2];
            else if (nowhp > 0) hp_state = hp_list[3];
            return hp_state;
        }

        let states: JSXOutput[] = [];
        deckPort.ship?.forEach((shipId) => {
            states.push(set_hp_state(ships.ships[shipId]?.nowhp ?? 0, ships.ships[shipId]?.maxhp ?? 0));
        });

        return states;
    });

    const moreSignal = useSignal(false);

    return (
        <>
            <li>
                <details open>
                    <summary>
                        <Slot name="icon_fleet" />
                        { fleet_name[deckPort.id] ?? "Unknown" }
                        <span class="justify-end"></span>
                        <div class="form-control">
                            <label class="label cursor-pointer h-4">
                                <span class="label-text mb-1.5 pr-2 h-4">more</span>
                                <input type="checkbox" onClick$={() => moreSignal.value = !moreSignal.value} class="toggle toggle-xs h-4  border-gray-400 [--tglbg:theme(colors.gray.200)] checked:border-blue-200 checked:bg-blue-300 checked:[--tglbg:theme(colors.blue.100)] rounded-sm" />
                            </label>
                        </div>
                    </summary>
                    <ul class="pl-0">
                        {deckPort.ship?.map((shipId, idx) => (
                            <>
                                { shipId > 0 
                                    ? <>
                                        <li class="h-auto">
                                            <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
                                                <div class="justify-start gap-0 flex flex-nowrap">
                                                    <Slot name="icon_ship" />
                                                    <div class="pl-2 pr-0.5 truncate flex-1 min-w-12 content-center">
                                                        <div class="w-24 h-max">
                                                            { mst_ships.mst_ships[ships.ships[shipId].ship_id]?.name ?? "Unknown" }
                                                        </div>
                                                    </div>
                                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                                    <div class=" flex-none">
                                                        <div class="flex justify-center w-8 indicator">
                                                            <div class="indicator-item indicator-top indicator-end">
                                                                { cond_state.value[idx] }
                                                            </div>
                                                            <div class="badge badge-md border-inherit w-9">
                                                                { ships.ships[shipId]?.cond ?? 0 }
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                                    <div class="indicator">
                                                        <div class="indicator-item indicator-top indicator-end flax space-x-2">
                                                            <div></div>
                                                            { hp_state.value[idx] }
                                                        </div>
                                                        <div class=" flex-none">
                                                            <div class="grid h-2.5 w-12 place-content-center">
                                                                <div class="grid grid-flow-col auto-cols-max gap-1">
                                                                    <div>{ ships.ships[shipId]?.nowhp ?? 0 }</div>
                                                                    <div>/</div>
                                                                    <div>{ ships.ships[shipId]?.maxhp ?? 0 }</div>
                                                                </div>
                                                            </div>
                                                            <div class="grid h-2.5 w-12 place-content-center">
                                                                <ColorBar class="w-12 h-1" v_now={ships.ships[shipId]?.nowhp ?? 0} v_max={ships.ships[shipId]?.maxhp ?? 0} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                                    <div class=" flex-none">
                                                        <div class="grid h-2.5 w-6 place-content-center">
                                                            <ColorBar class="w-6 h-1" v_now={ships.ships[shipId]?.fuel ?? 0} v_max={mst_ships.mst_ships[ships.ships[shipId].ship_id]?.fuel_max ?? 0} />
                                                        </div>
                                                        <div class="grid h-2.5 w-6 place-content-center">
                                                            <ColorBar class="w-6 h-1" v_now={ships.ships[shipId]?.bull ?? 0} v_max={mst_ships.mst_ships[ships.ships[shipId].ship_id]?.bull_max ?? 0} />
                                                        </div>
                                                    </div>
                                                    <div class="divider divider-horizontal mr-0 ml-0"></div>
                                                </div>
                                                { !moreSignal.value 
                                                ? <></> 
                                                : <div class="justify-start gap-0 flex flex-nowrap">
                                                    <div class="grid grid-cols-5 gap-2 content-center w-52 left-1">
                                                        <div class="text-base flex justify-center">
                                                            <Bs1Square></Bs1Square>
                                                        </div>
                                                        <div class="text-base flex justify-center">
                                                            <Bs2Square></Bs2Square>
                                                        </div>
                                                        <div class="text-base flex justify-center">
                                                            <Bs3Square></Bs3Square>
                                                        </div>
                                                        <div class="text-base flex justify-center">
                                                            <Bs4Square></Bs4Square>
                                                        </div>
                                                        <div class="text-base flex justify-center">
                                                            <Bs5Square></Bs5Square>
                                                        </div>
                                                    </div>
                                                    <div class="divider divider-horizontal mr-0 ml-0"></div>
                                                    <div class="content-center">
                                                        <div class="text-base flex justify-center w-8">
                                                            <Bs0Square></Bs0Square>
                                                        </div>
                                                    </div>
                                                    <span class="w-0.5"></span>
                                                    <div class="divider divider-horizontal mr-0 ml-0 h-5"></div>
                                                </div> }
                                            </a>
                                        </li>
                                    </> 
                                    : <></> 
                                }
                            </>
                        ))}
                    </ul>
                </details>
            </li>
        </>
    );
});