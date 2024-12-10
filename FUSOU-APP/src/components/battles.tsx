import { useBattles, useCells, useDeckPorts, useMstShips, useShips } from '../utility/provider';
import { ShipNameComponent } from './ship_name';

import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';

import "../css/divider.css";
import { JSX } from 'solid-js/h/jsx-runtime';
import IconChevronRight from '../icons/chevron_right';
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';

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

    const show_anti_submarine = createMemo<boolean>(() => {
        console.log(cells.cells);
        if (battles.cells.length == 0) return false;
        if (battles.cells.find((cell) => cell == cells.cell_index[cell_index_selected()]) == undefined) return false;
        return battles.battles[cells.cell_index[cell_index_selected()]].opening_taisen != null;
    });

    const battle_selected = createMemo<Battle>(() => {
        console.log(battles.battles[battles.cells[cell_index_selected()]]);
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
                        {/* <div class="join round-xs rounded-none pl-2 flex flex-row"> */}
                        
                        {/* <li> */}
                            {/* <details open={true}> */}
                                {/* <summary> */}
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
                        {/* </summary> */}
                        {/* </details> */}
                        {/* </li> */}
                    </ul>
                    <Show when={battles.cells.length > 0}>
                        <ul class="pl-0">
                            {/* <Show when={battles.battles[cells.cell_index[cell_index_selected()]].opening_taisen != null}> */}
                            <Show when={show_anti_submarine()}>
                                <li>
                                    <details open={true}>
                                        <summary>
                                            Opening Anti-submarine
                                        </summary>
                                        <ul class="pl-0">
                                            <table class="table table-xs">
                                                <thead>
                                                    <tr>
                                                        <th>From</th>
                                                        <th>To</th>
                                                        <th>Attack</th>
                                                        <th>Type</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <For each={battle_selected().opening_taisen.at_list}>
                                                        {(at, at_index) => (
                                                            <tr>
                                                                <td>
                                                                    <Show when={battle_selected().opening_taisen.at_eflag[at_index()]==0} fallback={
                                                                        <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[at]}></EnemyNameComponent>
                                                                    }>
                                                                        <ShipNameComponent ship_id={deck_ship_id()[1][at]}></ShipNameComponent>
                                                                    </Show>
                                                                </td>
                                                                <td>
                                                                    <div class="flex flex-col">
                                                                        <For each={battle_selected().opening_taisen.df_list[at_index()]}>
                                                                            {(df, df_index) => (
                                                                                <Show when={battle_selected().opening_taisen.at_eflag[at_index()]==1} fallback={
                                                                                    <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[df]}></EnemyNameComponent>
                                                                                }>
                                                                                    <ShipNameComponent ship_id={deck_ship_id()[1][df]}></ShipNameComponent>
                                                                                </Show>
                                                                            )}
                                                                        </For>
                                                                    </div>
                                                                </td>
                                                                <td >
                                                                    <div class="flex flex-col">
                                                                        <For each={battle_selected().opening_taisen.damage[at_index()]}>
                                                                            {(dmg, admg_index) => (
                                                                                <div>{dmg}</div>
                                                                            )}
                                                                        </For>
                                                                    </div>
                                                                </td>
                                                                <td>{battle_selected().opening_taisen.at_type[at_index()]}</td>
                                                            </tr>
                                                        )}
                                                    </For>
                                                </tbody>
                                            </table>
                                        </ul>
                                    </details>
                                </li>
                            </Show>
                        </ul>
                    </Show>
                </details>
            </li>
        </>
    );
}