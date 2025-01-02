import { useBattles, useCells, useDeckPorts, useMstShips, useShips } from '../utility/provider';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';

import "../css/divider.css";
import IconChevronRight from '../icons/chevron_right';
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

    const [battles, ] = useBattles();
    const [ships, ] = useShips();
    const [mst_ships, ] = useMstShips();
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
        console.log(battles.battles[cells.cell_index[cell_index_selected()]]);
        return battles.battles[cells.cell_index[cell_index_selected()]];
    });
    
    createEffect(() => {
        set_cell_index_selected(cells.cell_index.length > 0 ? cells.cell_index.length - 1 : 0)
    });

    const show_battle = createMemo<boolean>(() => {
        if (battles.cells.length == 0) return false;
        if (battles.cells.find((cell) => cell == cells.cell_index[cell_index_selected()]) == undefined) return false;
        return true;
    });

    return (
        <>
            <li>
                <details open={true}>
                    <summary class="flex">
                        Battles
                        <IconChevronRight class="h-4 w-4" />
                        {/* <Show when={show_battle()}> */}
                            <div>Map : {cells.maparea_id}-{cells.mapinfo_no}</div>
                            <div class="divider divider-horizontal mr-0 ml-0"></div>
                            <div>Boss Cell : {cells.bosscell_no}</div>
                        {/* </Show> */}
                        <span class="flex-auto"></span>
                    </summary>
                    <ul class="pl-2">
                        <div class="flex flex-row">
                            <div class="h-4 mt-px pt-px">cells</div>
                            <IconChevronRight class="h-4 w-4 m-1 " />
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
                    </ul>
                    <Show when={show_battle()}>
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
                </details>
            </li>
        </>
    );
}