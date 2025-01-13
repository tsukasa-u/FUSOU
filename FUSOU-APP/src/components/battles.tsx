import { /*useBattles,*/ useCells, useDeckPorts, /*useMstShips, useShips*/ } from '../utility/provider';
import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';

import "../css/divider.css";
import IconChevronRightS from '../icons/chevron_right_s';
import { Battle } from '../interface/battle';
import { OpeningAntiSubmarineComponent } from './opening_anti_submarine';
import { OpeningTorpedoAttackComponent } from './opening_torpedo_attack';
import { ClosingTorpedoAttackComponent } from './closing_torpedo_attack';
import { ShellingComponent } from './shelling';
import { OpeningAirAttackComponent } from './opening_air_attack';
import { AirBaseAirAttackComponent } from './air_base_air_attack';
import { MidnightShellingComponent } from './midnight_battle';
import { SupportAttackComponent } from './support_attack';

export function BattlesComponent() {

    // const [battles, ] = useBattles();
    // const [ships, ] = useShips();
    // const [mst_ships, ] = useMstShips();
    const [deck_ports, ] = useDeckPorts();
    const [cells, ] = useCells();

    const [cell_index_selected, set_cell_index_selected] = createSignal<number>(0);

    const deck_ship_id = createMemo<{[key: number]: number[]}>(() => {
        let deck_ship_id: {[key: number]: number[]} = {};
        for ( let j of Object.keys(deck_ports.deck_ports) ) {
            for ( let i of Object.keys(deck_ports.deck_ports[Number(j)].ship) ) {
                if (deck_ship_id[Number(j)] ?? -1 > 0) {
                    deck_ship_id[Number(j)].push(deck_ports.deck_ports[Number(j)].ship[Number(i)]);
                }
            }
            deck_ship_id[Number(j)] = deck_ports.deck_ports[Number(j)].ship;
        }
        return deck_ship_id;
    });

    const battle_selected = createMemo<Battle>(() => {
        return cells.battles[cells.cell_index[cell_index_selected()]];
    });
    
    createEffect(() => {
        set_cell_index_selected(cells.cell_index.length > 0 ? cells.cell_index.length - 1 : 0)
    });

    const show_battle = createMemo<boolean>(() => {
        if (Object.keys(cells.battles).length == 0) return false;
        if (Object.keys(cells.battles).find((cell) => Number(cell) == cells.cell_index[cell_index_selected()]) == undefined) return false;
        console.log(cells.battles[cells.cell_index[cell_index_selected()]]);
        return true;
    });

    const show_cell = createMemo<boolean>(() => {
        return cells.cell_index.length > 0;
    });

    return (
        <>
            <li>
                <details open={true}>
                    <summary class="flex">
                        Battles
                        <IconChevronRightS class="h-4 w-4" />
                        {/* <Show when={show_battle()}> */}
                            <div>Map : {cells.maparea_id}-{cells.mapinfo_no}</div>
                            <div class="divider divider-horizontal mr-0 ml-0"></div>
                            <div>Boss Cell : {cells.bosscell_no}</div>
                        {/* </Show> */}
                        <span class="flex-auto"></span>
                    </summary>
                    <Show when={show_cell()} fallback={<div class="text-xs pl-4 py-1">No Cell Data ...</div>}>
                        <ul class="pl-2">
                            <div class="flex flex-row">
                                <div class="h-4 mt-px pt-px">cells</div>
                                <IconChevronRightS class="h-4 w-4 m-1 " />
                                <For each={cells.cell_index}>
                                    {(_, index) => (
                                        <>
                                            <Show when={index() > 0}>
                                                <div class="divider divider-horizontal mr-0 ml-0 w-px"></div>
                                            </Show>
                                            <button class={`${cell_index_selected()==index() ? 'btn-active' : ''} btn btn-xs btn-square rounded-none`} style="box-shadow:none" onclick={() => {set_cell_index_selected(index())}}>{cells.cell_index[index()]}</button>
                                        </>
                                    )}
                                </For>
                            </div>
                            <Show when={show_battle()}>
                                <div class="flex felx-nowrap text-xs py-0.5 tooltip tooltip-right" data-tip={battle_selected().reconnaissance}>
                                    Search : <span class="w-1"></span>
                                    <Switch fallback={<div>_</div>}>
                                        <Match when={battle_selected().reconnaissance![0] == 1}>
                                            <div class="text-lime-500">Enemy in sight; Accuracy & Evacuation Up</div>
                                        </Match>
                                        <Match when={battle_selected().reconnaissance![0] == 2}>
                                            <div class="text-lime-500">Enemy in sight; Accuracy & Evacuation Up</div>
                                        </Match>
                                        <Match when={battle_selected().reconnaissance![0] == 3}>
                                            <div class="text-red-500">No Enemy in Sight; Some reconnaissance planes not returned; Anti-Air & Evacuation Down</div>
                                        </Match>
                                        <Match when={battle_selected().reconnaissance![0] == 4}>
                                            <div class="text-red-500">No Enemy in Sight; Anti-Air & Evacuation Down</div>
                                        </Match>
                                        <Match when={battle_selected().reconnaissance![0] == 5}>
                                            <div class="text-lime-500">Find Enemy; Accuracy & Evacuation Up</div>
                                        </Match>
                                        <Match when={battle_selected().reconnaissance![0] == 6}>
                                            <div></div>
                                        </Match>
                                    </Switch>
                                </div>
                                <div class="flex felx-nowrap text-xs py-0.5 tooltip tooltip-right" data-tip={battle_selected().formation}>
                                    Formation : <span class="w-1"></span>
                                    <For each={battle_selected().formation?.slice(0, 2)}>
                                        {(formation, index) => (
                                            <>
                                                <Switch fallback={<div>_</div>}>
                                                    <Match when={formation == 1}>
                                                        <div class={index()==0 ? "text-lime-500" : "text-red-500"}>Line Ahead</div>
                                                    </Match>
                                                    <Match when={formation == 2}>
                                                        <div class={index()==0 ? "text-lime-500" : "text-red-500"}>Double Line</div>
                                                    </Match>
                                                    <Match when={formation == 3}>
                                                        <div class={index()==0 ? "text-lime-500" : "text-red-500"}>Diamond</div>
                                                    </Match>
                                                    <Match when={formation == 4}>
                                                        <div class={index()==0 ? "text-lime-500" : "text-red-500"}>Echelon</div>
                                                    </Match>
                                                    <Match when={formation == 5}>
                                                        <div class={index()==0 ? "text-lime-500" : "text-red-500"}>Line Abreast</div>
                                                    </Match>
                                                    <Match when={formation == 6}>
                                                        <div class={index()==0 ? "text-lime-500" : "text-red-500"}>Vanguard</div>
                                                    </Match>
                                                </Switch>
                                                <Show when={index() == 0}>
                                                    <span class="w-4">/</span>
                                                </Show>
                                            </>
                                        )}
                                    </For>
                                    <div class="divider divider-horizontal mr-0 ml-0"></div>
                                    {/* <span class="w-4"></span> */}
                                    Form : <span class="w-1"></span>
                                    <Switch fallback={<div>_</div>}>
                                        <Match when={battle_selected().formation![2] == 3}>
                                            <div class="text-lime-500">Crossing the T (Advantage)</div>
                                        </Match>
                                        <Match when={battle_selected().formation![2] == 1}>
                                            <div class="">Parallel</div>
                                        </Match>
                                        <Match when={battle_selected().formation![2] == 2}>
                                            <div class="">Head-on Engagement</div>
                                        </Match>
                                        <Match when={battle_selected().formation![2] == 4}>
                                            <div class="text-red-500">Crossing the T (Disadvantage)</div>
                                        </Match>
                                    </Switch>
                                </div>
                            </Show>
                        </ul>
                        <Show when={show_battle()} fallback={<div class="text-xs pl-4 py-1">No Battle Data ...</div>}>
                            <ul class="pl-0">
                                <AirBaseAirAttackComponent area_id={cells.maparea_id} battle_selected={battle_selected} />
                                <OpeningAirAttackComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <SupportAttackComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <OpeningAntiSubmarineComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <OpeningTorpedoAttackComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <ShellingComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <ClosingTorpedoAttackComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <MidnightShellingComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                            </ul>
                        </Show>
                    </Show>
                </details>
            </li>
        </>
    );
}