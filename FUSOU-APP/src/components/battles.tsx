import { useBattles, useCells, useDeckPorts, useMstShips, useShips } from '../utility/provider';
import { ShipNameComponent } from './ship_name';

import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';

import "../css/divider.css";
import { JSX } from 'solid-js/h/jsx-runtime';
import IconChevronRight from '../icons/chevron_right';
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';
import { OpeningAntiSubmarineComponent } from './opening_anti_submarine';
import { OpeningTorpedoSubmarineComponent } from './opening_torpedo_attack';

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
        return battles.battles[battles.cells[cell_index_selected()]];
    });

    createEffect(() => {
        set_cell_index_selected(cells.cell_index.length-1);
    });

    return (
        <>
            <li>
                <details open={true}>
                    <summary class="flex">
                        Battles
                        <IconChevronRight class="h-4 w-4" />
                        <Show when={battles.cells.length > 0}>
                            <div>Map : {cells.maparea_id}-{cells.mapinfo_no}</div>
                            <div class="divider divider-horizontal mr-0 ml-0"></div>
                            <div>Boss Cell : {cells.bosscell_no}</div>
                        </Show>
                        <span class="flex-auto"></span>
                    </summary>
                    <ul class="pl-2">
                        <div class="flex flex-row">
                            <div class="h-4 mt-px pt-px">cells</div>
                            <IconChevronRight class="h-4 w-4 m-1 " />
                            <For each={cells.cell_index}>
                                {(cell_index, index) => (
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
                    <Show when={battles.cells.length > 0}>
                        <ul class="pl-0">
                            <OpeningAntiSubmarineComponent deck_ship_id={deck_ship_id} battle_selected={battle_selected} cell_index_selected={cell_index_selected}></OpeningAntiSubmarineComponent>
                            {/* <OpeningTorpedoSubmarineComponent deck_ship_id={deck_ship_id} battle_selected={battle_selected} cell_index_selected={cell_index_selected}></OpeningTorpedoSubmarineComponent> */}
                        </ul>
                    </Show>
                </details>
            </li>
        </>
    );
}