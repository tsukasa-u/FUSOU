import { DeckPort, DeckPorts, Ships } from "../interface/port.ts";
import { MstShips, MstSlotitems } from "../interface/get_data.ts";
import { SlotItems } from "../interface/require_info.ts";

import { FuelBulletColorBarComponent } from './fuel_bullet_color_bar.tsx';
import { HpColorBarComponent } from './hp_color_bar.tsx';

import { IconCautionFill } from '../icons/caution_fill.tsx';
import { IconKira1 } from '../icons/kira1.tsx';
import { IconKira2 } from '../icons/kira2.tsx';
import { IconKira3 } from '../icons/kira3.tsx';

import { EquimentComponent } from './equipment.tsx';
import { ShipNameComponent } from './ship_name.tsx';
import { useDeckPorts, useMstShips, useShips } from '../utility/provider.tsx';
import { createMemo, createSignal, For, JSX, Show } from "solid-js";
// import { global_mst_ships_context_id, global_ship_context_id } from '../app.tsx';

import "../css/divider.css";

interface DeckPortProps {
    deck_id: number;
}
 
export function DeckComponent({deck_id}: DeckPortProps) {

    const fleet_name: {[key:number]:string} = {
        1: "First Fleet",
        2: "Second Fleet",
        3: "Third Fleet",
        4: "Fourth Fleet",
    }

    const [_mst_ships, ] = useMstShips();
    const [_ships, ] = useShips();
    const [_deck_ports, ] = useDeckPorts();

    const cond_state = createMemo<JSX.Element[]>(() => {
        const cond_list: JSX.Element[] = [
            <IconKira3 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira3>,
            <IconKira2 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira2>,
            <IconKira1 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira1>,
            <></>,
            <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-orange-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2"></IconCautionFill>,
        ];
        const set_cond_state = (cond: number): JSX.Element => {
            let cond_state: JSX.Element = <></>;
            if (cond >= 71) cond_state = cond_list[0];
            else if (cond >= 58) cond_state = cond_list[1];
            else if (cond >= 50) cond_state = cond_list[2];
            else if (cond == 49) cond_state = cond_list[3];
            else if (cond >= 40) cond_state = cond_list[4];
            else if (cond >= 30) cond_state = cond_list[5];
            else if (cond >= 20) cond_state = cond_list[6];
            else if (cond >=  0) cond_state = cond_list[7];
            console.log(cond);
            return cond_state;
        };

        let states: JSX.Element[] = [];
        _deck_ports.deck_ports[deck_id].ship?.forEach((shipId) => {
            states.push(set_cond_state(_ships.ships[shipId]?.cond ?? 0));
        });
        return states;
    });

    const hp_state = createMemo<JSX.Element[]>(() => {
        const hp_list: JSX.Element[] = [
            <></>,
            <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-orange-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2"></IconCautionFill>,
            <></>,
        ];

        const set_hp_state = (nowhp: number, maxhp: number): JSX.Element => {
            let hp_state: JSX.Element = <></>;
            if (nowhp > 0.75*maxhp) hp_state = hp_list[0];
            else if (nowhp > 0.5*maxhp) hp_state = hp_list[1];
            else if (nowhp > 0.25*maxhp) hp_state = hp_list[2];
            else if (nowhp > 0) hp_state = hp_list[3];
            else hp_state = hp_list[4];
            return hp_state;
        }

        let states: JSX.Element[] = [];
        _deck_ports.deck_ports[deck_id].ship?.forEach((shipId) => {
            states.push(set_hp_state(_ships.ships[shipId]?.nowhp ?? 0, _ships.ships[shipId]?.maxhp ?? 0));
        });

        return states;
    });

    const fuel_bullet_state = createMemo<JSX.Element[]>(() => {
        const fuel_bullet_list: JSX.Element[] = [
            <></>,
            <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-orange-500 stroke-2"></IconCautionFill>,
            <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2"></IconCautionFill>,
        ];

        const set_fuel_bullet_state = (nowfuel: number, maxfuel: number, nowbullet: number, maxbullet: number): JSX.Element => {
            let fuel_bullet_state: JSX.Element = <></>;
            if (nowfuel == maxfuel &&  nowbullet  == maxbullet) fuel_bullet_state = fuel_bullet_list[0];
            else if (nowfuel > 7/9*maxfuel && nowbullet > 7/9*maxbullet) fuel_bullet_state = fuel_bullet_list[1];
            else if (nowfuel > 3/9*maxfuel || nowbullet > 3/9*maxbullet) fuel_bullet_state = fuel_bullet_list[2];
            else if (nowfuel >= 0 || nowbullet >= 0) fuel_bullet_state = fuel_bullet_list[3];
            else fuel_bullet_state = fuel_bullet_list[4];
            return fuel_bullet_state;
        }

        let states: JSX.Element[] = [];
        _deck_ports.deck_ports[deck_id].ship?.forEach((shipId) => {
            states.push(set_fuel_bullet_state(_ships.ships[shipId]?.bull ?? 0, _mst_ships.mst_ships[_ships.ships[shipId]?.ship_id ?? 0]?.bull_max ?? 0, _ships.ships[shipId]?.fuel ?? 0, _mst_ships.mst_ships[_ships.ships[shipId]?.ship_id ?? 0]?.fuel_max ?? 0));
        });

        return states;
    });

    const [moreSignal, setMoreSignal] = createSignal(false);

    return (
        <>
            <li>
                <details open>
                    <summary>
                        { fleet_name[_deck_ports.deck_ports[deck_id].id] ?? "Unknown" }
                        <span class="justify-end"></span>
                        <div class="form-control">
                            <label class="label cursor-pointer h-4">
                                <span class="label-text mb-1.5 pr-2 h-4">more</span>
                                <input type="checkbox" onClick={() => setMoreSignal(!moreSignal())} class="toggle toggle-xs h-4  border-gray-400 [--tglbg:theme(colors.gray.200)] checked:border-blue-200 checked:bg-blue-300 checked:[--tglbg:theme(colors.blue.100)] rounded-sm" />
                            </label>
                        </div>
                    </summary>
                    <ul class="pl-0">
                        {/* {_deck_ports.deck_ports[deck_id].ship} */}
                        <For each={_deck_ports.deck_ports[deck_id].ship}>
                            {(shipId, idx) => (
                                <Show when={shipId > 0}>
                                    <li class="h-auto">
                                        <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
                                            <div class="justify-start gap-0 flex ">
                                                <div class="pl-2 pr-0.5 truncate flex-1 min-w-12 content-center">
                                                    <div class="w-24 h-max">
                                                        <ShipNameComponent ship_id={shipId}></ShipNameComponent>
                                                    </div>
                                                </div>
                                                <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                                <div class=" flex-none">
                                                    <div class="flex justify-center w-8 indicator">
                                                        <div class="indicator-item indicator-top indicator-end">
                                                            { cond_state()[idx()]}
                                                        </div>
                                                        <div class="badge badge-md border-inherit w-9">
                                                            { _ships.ships[shipId]?.cond ?? 0 }
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                                <div class="indicator">
                                                    <div class="indicator-item indicator-top indicator-end flax space-x-2">
                                                        { hp_state()[idx()] }
                                                    </div>
                                                    <div class=" flex-none">
                                                        <div class="grid h-2.5 w-12 place-content-center">
                                                            <div class="grid grid-flow-col auto-cols-max gap-1">
                                                                <div>{ _ships.ships[shipId]?.nowhp ?? 0 }</div>
                                                                <div>/</div>
                                                                <div>{ _ships.ships[shipId]?.maxhp ?? 0 }</div>
                                                            </div>
                                                        </div>
                                                        <div class="grid h-2.5 w-12 place-content-center">
                                                            <HpColorBarComponent class="w-12 h-1" v_now={_ships.ships[shipId]?.nowhp ?? 0} v_max={_ships.ships[shipId]?.maxhp ?? 0} />
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                                <div class="indicator">
                                                    <div class="flex-none">
                                                        <div class="indicator-item indicator-top indicator-end flax space-x-2">
                                                            { fuel_bullet_state()[idx()] }
                                                        </div>
                                                        <div class="grid h-2.5 w-6 place-content-center">
                                                            <FuelBulletColorBarComponent class="w-6 h-1" v_now={_ships.ships[shipId]?.fuel ?? 0} v_max={_mst_ships.mst_ships[_ships.ships[shipId]?.ship_id ?? 0]?.fuel_max ?? 0} />
                                                        </div>
                                                        <div class="grid h-2.5 w-6 place-content-center">
                                                            <FuelBulletColorBarComponent class="w-6 h-1" v_now={_ships.ships[shipId]?.bull ?? 0} v_max={_mst_ships.mst_ships[_ships.ships[shipId]?.ship_id ?? 0]?.bull_max ?? 0} />
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="divider divider-horizontal mr-0 ml-0"></div>
                                            </div>
                                            <Show when={moreSignal()}>
                                                <div class="flex">
                                                    <div class="grid grid-cols-5 gap-2 content-center w-52">
                                                        { _ships.ships[shipId]?.slot?.map((slotId) => (
                                                            <Show when={slotId > 0}>
                                                                <div class="text-base flex justify-center">
                                                                    <EquimentComponent slot_id={slotId} ex_flag={false} name_flag={false} />
                                                                </div>
                                                            </Show>
                                                        )) }
                                                    </div>
                                                    <span class="w-2"></span>
                                                    <div class="divider divider-horizontal mr-0 ml-0 basis-0 h-auto"></div>
                                                    <span class="w-2"></span>
                                                    <div class="content-center">
                                                        <div class="text-base flex justify-center w-8">
                                                            <Show when={_ships.ships[shipId]?.slot_ex > 0}>
                                                                <EquimentComponent slot_id={_ships.ships[shipId]?.slot_ex} ex_flag={true} name_flag={false} />
                                                            </Show>
                                                        </div>
                                                    </div>
                                                    <span class="w-px"></span>
                                                    <div class="divider divider-horizontal mr-0 ml-0 h-auto"></div>
                                                </div>
                                            </Show>
                                        </a>
                                    </li>
                                </Show>
                            )}
                        </For>
                    </ul>
                </details>
            </li>
        </>
    );
}