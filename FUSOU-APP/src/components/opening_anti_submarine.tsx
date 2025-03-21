import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { SimpleShipNameComponent } from './simple_ship_name';
import { Battle } from '../interface/battle';
import IconShield from '../icons/shield';
import { SimpleHpBar } from './simple_hp_bar';
import { useDeckPorts, useShips } from '../utility/provider';
import IconFleetNumber from '../icons/fleet_number';

interface AntiSubmarineProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

export function OpeningAntiSubmarineComponent({deck_ship_id, battle_selected}: AntiSubmarineProps) {
    
    const [ships, ] = useShips();
    const [deck_ports, ] = useDeckPorts();
    
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
                                    <th>HP</th>
                                    <th>To</th>
                                    <th>HP</th>
                                    <th>Attack</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={battle_selected().opening_taisen.at_list}>
                                    {(at, at_index) => (
                                        <tr class="table_hover table_active rounded">
                                            <td>
                                                <div class="flex flex-nowarp">
                                                    <Show when={battle_selected().opening_taisen.at_eflag[at_index()]==0} fallback={
                                                        <>
                                                            <IconFleetNumber class="h-6 -mt-1 pr-1" e_flag={1} fleet_number={1} ship_number={at+1} combined_flag={battle_selected().enemy_ship_id.length == 12}></IconFleetNumber>
                                                            <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[at]} ship_slot={battle_selected().e_slot![at]} ship_param={battle_selected().e_params![at]} ship_max_hp={battle_selected().e_hp_max![at]} display={false}></SimpleShipNameComponent>
                                                        </>
                                                    }>
                                                        <>
                                                        <IconFleetNumber class="h-6 -mt-1 pr-1" e_flag={0} fleet_number={1} ship_number={at+1} combined_flag={deck_ports.combined_flag == 1}></IconFleetNumber>
                                                            <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][at]}></ShipNameComponent>
                                                        </>
                                                    </Show>
                                                </div>
                                            </td>
                                            <td>
                                                <Show when={battle_selected().opening_taisen.at_eflag[at_index()]==0} fallback={
                                                    <SimpleHpBar v_now={() => battle_selected().opening_taisen.e_now_hps[at_index()][at]} v_max={() => battle_selected().e_hp_max![at]}></SimpleHpBar>
                                                }>
                                                    <SimpleHpBar v_now={() => battle_selected().opening_taisen.f_now_hps[at_index()][at]} v_max={() => ships.ships[deck_ship_id[battle_selected().deck_id!][at]].maxhp}></SimpleHpBar>
                                                </Show>
                                            </td>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={battle_selected().opening_taisen.df_list[at_index()]}>
                                                        {(df, df_index) => (
                                                            <div class="flex flex-nowarp">
                                                                <Show when={battle_selected().opening_taisen.at_eflag[at_index()]==1} fallback={
                                                                    <>
                                                                        <IconFleetNumber class="h-6 -mt-1 pr-1" e_flag={1} fleet_number={1} ship_number={df+1} combined_flag={battle_selected().enemy_ship_id.length == 12}></IconFleetNumber>
                                                                        <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[df]} ship_slot={battle_selected().e_slot![df]} ship_param={battle_selected().e_params![df]} ship_max_hp={battle_selected().e_hp_max![df]} display={true}></SimpleShipNameComponent>
                                                                    </>
                                                                }>
                                                                    <>
                                                                        <IconFleetNumber class="h-6 -mt-1 pr-1" e_flag={0} fleet_number={1} ship_number={df+1} combined_flag={deck_ports.combined_flag == 1}></IconFleetNumber>
                                                                        <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][df]}></ShipNameComponent>
                                                                    </>
                                                                </Show>
                                                                <Show when={battle_selected().opening_taisen.protect_flag[at_index()][df_index()] == true}>
                                                                    <IconShield class="h-5 w-5"></IconShield>
                                                                </Show>
                                                            </div>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={battle_selected().opening_taisen.df_list[at_index()]}>
                                                        {(df) => (
                                                            <div class="flex flex-nowarp">
                                                                <Show when={battle_selected().opening_taisen.at_eflag[at_index()]==1} fallback={
                                                                    <SimpleHpBar v_now={() => battle_selected().opening_taisen.e_now_hps[at_index()][df]} v_max={() => battle_selected().e_hp_max![df]}></SimpleHpBar>
                                                                }>
                                                                    <SimpleHpBar v_now={() => battle_selected().opening_taisen.f_now_hps[at_index()][df]} v_max={() => ships.ships[deck_ship_id[battle_selected().deck_id!][df]].maxhp}></SimpleHpBar>
                                                                </Show>
                                                            </div>
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