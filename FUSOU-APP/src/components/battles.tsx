import { useBattles, useCells, useDeckPorts, useMstShips, useShips } from '../utility/provider';
import { ShipNameComponent } from './ship_name';

import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';

import "../css/divider.css";
import { JSX } from 'solid-js/h/jsx-runtime';
import IconChevronRight from '../icons/chevron_right';

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
        if (battles.cells.length == 0) return false;
        if (battles.cells.find((cell) => cell == cells.cell_index[cell_index_selected()]) == undefined) return false;
        return battles.battles[cells.cell_index[cell_index_selected()]].opening_taisen != null;
    });

    // const cell_index_memo = createMemo<number[]>(() => {
    //     let cell_index: number[] = [];
    //     // console.log(cells.cells);
    //     for ( let i of Object.keys(cells.cells) ) {
    //         cell_index.push(cells.cells[Number(i)].no);
    //     }
    //     // console.log(cells.cell_index);
    //     // console.log(cell_index);
    //     return cell_index;
    // });

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
                                                    <For each={battles.battles[cells.cell_index[cell_index_selected()]].opening_taisen.at_list}>
                                                        {(at, index) => (
                                                            <tr>
                                                                <td><ShipNameComponent ship_id={deck_ship_id()[1][at]}></ShipNameComponent></td>
                                                                <td>{battles.battles[cells.cell_index[cell_index_selected()]].opening_taisen.df_list[index()]}</td>
                                                                <td>{battles.battles[cells.cell_index[cell_index_selected()]].opening_taisen.damage[index()]}</td>
                                                                <td>{battles.battles[cells.cell_index[cell_index_selected()]].opening_taisen.at_type[index()]}</td>
                                                            </tr>
                                                        )}
                                                    </For>
                                                </tbody>
                                            </table>
                                            {/* <p>{ship_name()[1]}</p> */}
                                            {/* <p>
                                                {battles.opening_taisen.damage}
                                            </p>
                                            <p>
                                                {battles.opening_taisen.at_list}
                                            </p>
                                            <p>
                                                {battles.opening_taisen.at_type}
                                            </p>
                                            <p>
                                                {battles.opening_taisen.at_eflag}
                                            </p>
                                            <p>
                                                {battles.opening_taisen.df_list}
                                            </p>
                                            <p>
                                                {battles.opening_taisen.si_list}
                                            </p>
                                            <p>
                                                {battles.opening_taisen.cl_list}
                                            </p> */}
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