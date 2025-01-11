import { FuelBulletColorBarComponent } from './fuel_bullet_color_bar.tsx';
import { HpColorBarComponent } from './hp_color_bar.tsx';

import { IconCautionFill } from '../icons/caution_fill.tsx';
import { IconKira1 } from '../icons/kira1.tsx';
import { IconKira2 } from '../icons/kira2.tsx';
import { IconKira3 } from '../icons/kira3.tsx';

import { IconChevronRightS } from '../icons/chevron_right_s.tsx';

import { EquimentComponent } from './equipment.tsx';
import { ShipNameComponent } from './ship_name.tsx';
import { useDeckPorts, useMstShips, useShips } from '../utility/provider.tsx';
import { createMemo, createSignal, For, JSX, Show } from "solid-js";
// import { globalmst_ships_context_id, global_ship_context_id } from '../app.tsx';

import "../css/divider.css";

let moreSiganMap: {[key: number]: boolean} = {};
let fleetOpenSignalMap: {[key: number]: boolean} = {
    1: true,
    2: false,
    3: false,
    4: false,
};

interface DeckPortProps {
    deck_id: number;
    fleet_name?: string;
}
 
export function DeckComponent({deck_id, fleet_name}: DeckPortProps) {

    const [mst_ships, ] = useMstShips();
    const [ships, ] = useShips();
    const [_deck_ports, ] = useDeckPorts();

    const cond_state = createMemo<JSX.Element[]>(() => {
        // const cond_list: JSX.Element[] = [
        //     <IconKira3 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira3>,
        //     <IconKira2 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira2>,
        //     <IconKira1 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira1>,
        //     <></>,
        //     <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>,
        //     <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>,
        //     <IconCautionFill class="h-4 w-4 fill-orange-500 stroke-2"></IconCautionFill>,
        //     <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2"></IconCautionFill>,
        // ];
        const set_cond_state = (cond: number): JSX.Element => {
            let cond_state: JSX.Element = <></>;
            if (cond >= 71)      cond_state = <IconKira3 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira3>;
            else if (cond >= 58) cond_state = <IconKira2 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira2>;
            else if (cond >= 50) cond_state = <IconKira1 class="h-4 w-4 fill-yellow-500 stroke-2"></IconKira1>;
            else if (cond == 49) cond_state = <></>;
            else if (cond >= 40) cond_state = <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>;
            else if (cond >= 30) cond_state = <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>;
            else if (cond >= 20) cond_state = <IconCautionFill class="h-4 w-4 fill-orange-500 stroke-2"></IconCautionFill>;
            else if (cond >=  0) cond_state = <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2"></IconCautionFill>;
            return cond_state;
        };

        let states: JSX.Element[] = [];
        _deck_ports.deck_ports[deck_id].ship?.forEach((shipId) => {
            states.push(set_cond_state(ships.ships[shipId]?.cond ?? 0));
        });
        return states;
    });

    const hp_state = createMemo<JSX.Element[]>(() => {
        // const hp_list: JSX.Element[] = [
        //     <></>,
        //     <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>,
        //     <IconCautionFill class="h-4 w-4 fill-orange-500 stroke-2"></IconCautionFill>,
        //     <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2"></IconCautionFill>,
        //     <></>,
        // ];

        const set_hp_state = (nowhp: number, maxhp: number): JSX.Element => {
            let hp_state: JSX.Element = <></>;
            if (nowhp > 0.75*maxhp)      hp_state = <></>;
            else if (nowhp > 0.5 *maxhp) hp_state = <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>;
            else if (nowhp > 0.25*maxhp) hp_state = <IconCautionFill class="h-4 w-4 fill-orange-500 stroke-2"></IconCautionFill>;
            else if (nowhp > 0)          hp_state = <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2"></IconCautionFill>;
            return hp_state;
        }

        let states: JSX.Element[] = [];
        _deck_ports.deck_ports[deck_id].ship?.forEach((shipId) => {
            states.push(set_hp_state(ships.ships[shipId]?.nowhp ?? 0, ships.ships[shipId]?.maxhp ?? 0));
        });

        return states;
    });

    const fuel_bullet_state = createMemo<JSX.Element[]>(() => {
        // const fuel_bullet_list: JSX.Element[] = [
        //     <></>,
        //     <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>,
        //     <IconCautionFill class="h-4 w-4 fill-orange-500 stroke-2"></IconCautionFill>,
        //     <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2"></IconCautionFill>,
        // ];

        const set_fuel_bullet_state = (nowfuel: number, maxfuel: number, nowbullet: number, maxbullet: number): JSX.Element => {
            let fuel_bullet_state: JSX.Element = <></>;
            if (nowfuel == maxfuel &&  nowbullet  == maxbullet)            fuel_bullet_state = <></>;
            else if (9*nowfuel >= 7*maxfuel && 9*nowbullet >= 7*maxbullet) fuel_bullet_state = <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2"></IconCautionFill>;
            else if (9*nowfuel >= 3*maxfuel && 9*nowbullet >= 3*maxbullet) fuel_bullet_state = <IconCautionFill class="h-4 w-4 fill-orange-500 stroke-2"></IconCautionFill>;
            else if (nowfuel >= 0 && nowbullet >= 0)                       fuel_bullet_state = <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2"></IconCautionFill>;
            return fuel_bullet_state;
        }

        let states: JSX.Element[] = [];
        _deck_ports.deck_ports[deck_id].ship?.forEach((shipId) => {
            states.push(set_fuel_bullet_state(ships.ships[shipId]?.bull ?? 0, mst_ships.mst_ships[ships.ships[shipId]?.ship_id ?? 0]?.bull_max ?? 0, ships.ships[shipId]?.fuel ?? 0, mst_ships.mst_ships[ships.ships[shipId]?.ship_id ?? 0]?.fuel_max ?? 0));
        });

        return states;
    });

    if (moreSiganMap[deck_id] == undefined) {
        moreSiganMap[deck_id] = false;
    }
    const [moreSignal, setMoreSignal] = createSignal<boolean>(moreSiganMap[deck_id]);

    if (fleetOpenSignalMap[deck_id] == undefined) {
        fleetOpenSignalMap[deck_id] = false;
    }

    return (
        <>
            <li>
                <details open={fleetOpenSignalMap[deck_id]}>
                    <summary class="flex" onClick={() => {fleetOpenSignalMap[deck_id]=!fleetOpenSignalMap[deck_id];}}>
                        <div class="w-20 flex-none">
                            { fleet_name ?? "Unknown" }
                        </div>
                        <div class="w-4 flex-none -mx-4"><IconChevronRightS class="h-4 w-4" /></div>
                        <div class="pl-4">{_deck_ports.deck_ports[deck_id].name ?? ""}</div>
                        <span class="flex-auto"></span>
                        <div class="form-control flex-none">
                            <label class="label cursor-pointer h-4">
                                <span class="label-text mb-1.5 pr-2 h-4">more</span>
                                <input type="checkbox" onClick={() => { moreSiganMap[deck_id] = !moreSignal(); setMoreSignal(!moreSignal()); }}  class="toggle toggle-xs h-4  border-gray-400 [--tglbg:theme(colors.gray.200)] checked:border-blue-200 checked:bg-blue-300 checked:[--tglbg:theme(colors.blue.100)] rounded-sm" checked={moreSignal()}/>
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
                                                            { ships.ships[shipId]?.cond ?? 0 }
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
                                                                <div>{ ships.ships[shipId]?.nowhp ?? 0 }</div>
                                                                <div>/</div>
                                                                <div>{ ships.ships[shipId]?.maxhp ?? 0 }</div>
                                                            </div>
                                                        </div>
                                                        <div class="grid h-2.5 w-12 place-content-center">
                                                            <HpColorBarComponent class="w-12 h-1" v_now={() => (ships.ships[shipId]?.nowhp ?? 0)} v_max={() => (ships.ships[shipId]?.maxhp ?? 0)} />
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
                                                            <FuelBulletColorBarComponent class="w-6 h-1" v_now={() => (ships.ships[shipId]?.fuel ?? 0)} v_max={() => (mst_ships.mst_ships[ships.ships[shipId]?.ship_id ?? 0]?.fuel_max ?? 0)} />
                                                        </div>
                                                        <div class="grid h-2.5 w-6 place-content-center">
                                                            <FuelBulletColorBarComponent class="w-6 h-1" v_now={() => (ships.ships[shipId]?.bull ?? 0)} v_max={() => (mst_ships.mst_ships[ships.ships[shipId]?.ship_id ?? 0]?.bull_max ?? 0)} />
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="divider divider-horizontal mr-0 ml-0"></div>
                                            </div>
                                            <Show when={moreSignal()}>
                                                <div class="flex">
                                                    <div class="grid grid-cols-5 gap-2 content-center w-52">
                                                        { ships.ships[shipId]?.slot?.map((slotId, slotId_index) => (
                                                            <Show when={slotId > 0}>
                                                                <div class="text-base flex justify-center">
                                                                    <EquimentComponent slot_id={slotId} ex_flag={false} name_flag={false} onslot={ships.ships[shipId]?.onsolot[slotId_index]}/>
                                                                </div>
                                                            </Show>
                                                        )) }
                                                    </div>
                                                    <span class="w-2"></span>
                                                    <div class="divider divider-horizontal mr-0 ml-0 basis-0 h-auto"></div>
                                                    <span class="w-2"></span>
                                                    <div class="content-center">
                                                        <div class="text-base flex justify-center w-8">
                                                            <Show when={ships.ships[shipId]?.slot_ex > 0}>
                                                                <EquimentComponent slot_id={ships.ships[shipId]?.slot_ex} ex_flag={true} name_flag={false} />
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