import { ShipNameComponent } from './ship_name';

import { createMemo, For, Match, Show, Switch } from 'solid-js';

import "../css/divider.css";
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';
import { MstEquipmentComponent } from './mst_equipment';
import { EquimentComponent } from './equipment';

interface AntiSubmarineProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

export function MidnightShellingComponent({deck_ship_id, battle_selected}: AntiSubmarineProps) {
    
    const show_shelling = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().deck_id == null) return false;
        if (battle_selected().midnight_hougeki == null) return false;
        console.log(battle_selected());
        return true;
    });

    const display_tooltip = () => {
        let tooltip_data = {
            "sp_list": battle_selected()?.midnight_hougeki?.sp_list,
            "si_list": battle_selected()?.midnight_hougeki?.si_list,
            "at_eflag": battle_selected()?.midnight_hougeki?.at_eflag,
        }
        let tool_tip_string = Object.entries(tooltip_data).reduce((acc, [key, value]) => {
            return acc + key + ": " + String(value) + ",\n";
        }, "");
        return tool_tip_string;
    }

    return (
        <Show when={show_shelling()}>
            <li>
                <details open={true}>
                    <summary class="tooltip tooltip-right" data-tip={display_tooltip()}>
                        Midnight Shelling
                    </summary>
                    <ul class="pl-0">
                        <table class="table table-xs">
                            <thead>
                                <tr>
                                    <th>From</th>
                                    <th>To</th>
                                    <th>Attack</th>
                                    <th>CI</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={battle_selected().midnight_hougeki?.at_list}>
                                    {(at, at_index) => (
                                        <tr>
                                            <td>
                                                <Show when={battle_selected().midnight_hougeki?.at_eflag[at_index()]==0} fallback={
                                                    <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[at]} ship_param={battle_selected().e_params![at]} ship_slot={battle_selected().e_slot![at]} ship_max_hp={battle_selected().e_hp_max![at]} diplay={false}></EnemyNameComponent>
                                                }>
                                                    <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][at]}></ShipNameComponent>
                                                </Show>
                                            </td>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={battle_selected().midnight_hougeki?.df_list[at_index()]}>
                                                        {(df, _) => (
                                                            <Show when={battle_selected().midnight_hougeki?.at_eflag[at_index()]==1 && df != -1} fallback={
                                                                <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[df]} ship_param={battle_selected().e_params![df]} ship_slot={battle_selected().e_slot![df]} ship_max_hp={battle_selected().e_hp_max![df]} diplay={false}></EnemyNameComponent>
                                                            }>
                                                                <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][df]}></ShipNameComponent>
                                                            </Show>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td >
                                                <div class="flex flex-col">
                                                    <For each={battle_selected().midnight_hougeki?.damage[at_index()]}>
                                                        {(dmg, dmg_index) => (
                                                            <Show when={dmg != -1}>
                                                                <div class={
                                                                    (() => {
                                                                        let cl_flag = battle_selected().midnight_hougeki?.cl_list[at_index()][dmg_index()];
                                                                        if (cl_flag==0 || dmg == 0) {
                                                                            return "text-red-500";
                                                                        } else if (cl_flag==2) {
                                                                            return "text-yellow-500";
                                                                        }
                                                                    })()
                                                                }>{dmg}</div>
                                                            </Show>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <div class={battle_selected().midnight_hougeki?.df_list[at_index()].length == 1 ? "flex flex-nowrap" : "flex flex-col"}>
                                                    <Show when={battle_selected().midnight_hougeki?.si_list[at_index()] != null}>
                                                        <For each={battle_selected().midnight_hougeki?.si_list[at_index()]}>
                                                            {(si) => (
                                                                <Show when={si != null}>
                                                                    <MstEquipmentComponent equip_id={si ?? 0} name_flag={true} compact={true} show_param={battle_selected().midnight_hougeki?.at_eflag[at_index()] == 0}></MstEquipmentComponent>
                                                                </Show>
                                                            )}
                                                        </For>
                                                    </Show>
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