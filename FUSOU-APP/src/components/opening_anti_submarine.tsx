import { useBattles, useCells } from '../utility/provider';
import { ShipNameComponent } from './ship_name';

import { Accessor, createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';

interface AntiSubmarineProps {
    deck_ship_id: Accessor<{ [key: number]: number[] }>;
    battle_selected: Accessor<Battle>;
    cell_index_selected: Accessor<number>;
}

export function OpeningAntiSubmarineComponent({deck_ship_id, battle_selected, cell_index_selected}: AntiSubmarineProps) {

    const [battles, ] = useBattles();
    const [cells, ] = useCells();
    
    const show_anti_submarine = createMemo<boolean>(() => {
        if (battles.cells.length == 0) return false;
        if (battles.cells.find((cell) => cell == cells.cell_index[cell_index_selected()]) == undefined) return false;
        return battles.battles[cells.cell_index[cell_index_selected()]].opening_taisen != null;
    });


    return (
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
                                                        {(dmg, dmg_index) => (
                                                            <div class={
                                                                (() => {
                                                                    console.log(battle_selected().opening_taisen.cl_list);
                                                                    if (battle_selected().opening_taisen.cl_list[at_index()][dmg_index()]==0) {
                                                                        return "text-red-500";
                                                                    } else if (battle_selected().opening_taisen.cl_list[at_index()][dmg_index()]==1) {
                                                                        return "text-yellow-500";
                                                                    } else if (battle_selected().opening_taisen.cl_list[at_index()][dmg_index()]==2) {
                                                                        return "text-yellow-500";
                                                                    }
                                                                })()
                                                            }>{dmg}</div>
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
    );
}