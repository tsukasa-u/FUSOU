import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';

interface AntiSubmarineProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

export function OpeningAntiSubmarineComponent({deck_ship_id, battle_selected}: AntiSubmarineProps) {
    
    const show_anti_submarine = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().deck_id == null) return false;
        if (battle_selected().opening_taisen == null) return false;
        return true;
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
                                </tr>
                            </thead>
                            <tbody>
                                <For each={battle_selected().opening_taisen.at_list}>
                                    {(at, at_index) => (
                                        <tr class="table_hover table_active rounded">
                                            <td>
                                                <Show when={battle_selected().opening_taisen.at_eflag[at_index()]==0} fallback={
                                                    <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[at]} ship_slot={battle_selected().e_slot![at]} ship_param={battle_selected().e_params![at]} ship_max_hp={battle_selected().e_hp_max![at]} display={false}></EnemyNameComponent>
                                                }>
                                                    <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][at]}></ShipNameComponent>
                                                </Show>
                                            </td>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={battle_selected().opening_taisen.df_list[at_index()]}>
                                                        {(df, _) => (
                                                            <Show when={battle_selected().opening_taisen.at_eflag[at_index()]==1} fallback={
                                                                <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[df]} ship_slot={battle_selected().e_slot![df]} ship_param={battle_selected().e_params![df]} ship_max_hp={battle_selected().e_hp_max![df]} display={false}></EnemyNameComponent>
                                                            }>
                                                                <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][df]}></ShipNameComponent>
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
                                                                    let cl_flag = battle_selected().opening_taisen.cl_list[at_index()][dmg_index()];
                                                                    if (cl_flag==0 || dmg==0) {
                                                                        return "text-red-500";
                                                                    } else if (cl_flag==2) {
                                                                        return "text-yellow-500";
                                                                    }
                                                                })()
                                                            }>{dmg}</div>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
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