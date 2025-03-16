import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { SimpleShipNameComponent } from './simple_ship_name';
import { Battle } from '../interface/battle';
import IconShield from '../icons/shield';
import { SimpleHpBar } from './simple_hp_bar';
import { useShips } from '../utility/provider';

interface AntiSubmarineProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

export function ShellingComponent({deck_ship_id, battle_selected}: AntiSubmarineProps) {

    const[ships, ] = useShips();
    
    const show_shelling = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().deck_id == null) return false;
        if (battle_selected().hougeki == null) return false;
        return true;
    });

    return (
        <Show when={show_shelling()}>
            <li>
                <details open={true}>
                    <summary>
                        Shelling
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
                                <For each={battle_selected().hougeki}>
                                    {(hougeki, _hougeki_index) => (
                                        <Show when={hougeki != null}>
                                            <For each={hougeki.at_list}>
                                                {(at, at_index) => (
                                                    <tr class="table_hover table_active rounded">
                                                        <td>
                                                            <Show when={hougeki.at_eflag[at_index()]==0} fallback={
                                                                <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[at]} ship_max_hp={battle_selected().e_hp_max![at]} ship_param={battle_selected().e_params![at]} ship_slot={battle_selected().e_slot![at]}></SimpleShipNameComponent>
                                                            }>
                                                                <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][at]}></ShipNameComponent>
                                                            </Show>
                                                        </td>
                                                        <td>
                                                            <Show when={hougeki.at_eflag[at_index()]==0} fallback={
                                                                <SimpleHpBar v_now={() => hougeki.e_now_hps[at_index()][at]} v_max={() => battle_selected().e_hp_max![at]}></SimpleHpBar>
                                                            }>
                                                                <SimpleHpBar v_now={() => hougeki.f_now_hps[at_index()][at]} v_max={() => ships.ships[deck_ship_id[battle_selected().deck_id!][at]].maxhp}></SimpleHpBar>
                                                            </Show>
                                                        </td>
                                                        <td>
                                                            <div class="flex flex-col">
                                                                <For each={hougeki.df_list[at_index()]}>
                                                                    {(df, df_index) => (
                                                                        <div class="flex flex-nowarp">
                                                                            <Show when={hougeki.at_eflag[at_index()]==1} fallback={
                                                                                <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[df]} ship_max_hp={battle_selected().e_hp_max![df]} ship_param={battle_selected().e_params![df]} ship_slot={battle_selected().e_slot![df]}></SimpleShipNameComponent>
                                                                            }>
                                                                                <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][df]}></ShipNameComponent>
                                                                            </Show>
                                                                            <Show when={hougeki.protect_flag![at_index()][df_index()] == true}>
                                                                                <IconShield class="h-5 w-5"></IconShield>
                                                                            </Show>
                                                                        </div>
                                                                    )}
                                                                </For>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <div class="flex flex-col">
                                                                <For each={hougeki.df_list[at_index()]}>
                                                                    {(df) => (
                                                                        <div class="flex flex-nowarp">
                                                                            <Show when={hougeki.at_eflag[at_index()]==1} fallback={
                                                                                <SimpleHpBar v_now={() => hougeki.e_now_hps[at_index()][df]} v_max={() => battle_selected().e_hp_max![df]}></SimpleHpBar>
                                                                            }>
                                                                                <SimpleHpBar v_now={() => hougeki.f_now_hps[at_index()][df]} v_max={() => ships.ships[deck_ship_id[battle_selected().deck_id!][df]].maxhp}></SimpleHpBar>
                                                                            </Show>
                                                                        </div>
                                                                    )}
                                                                </For>
                                                            </div>
                                                        </td>
                                                        <td >
                                                            <div class="flex flex-col">
                                                                <For each={hougeki.damage[at_index()]}>
                                                                    {(dmg, dmg_index) => (
                                                                        <div class={
                                                                            (() => {
                                                                                let cl_flag = hougeki.cl_list[at_index()][dmg_index()];
                                                                                if (cl_flag==0 || dmg == 0) {
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
                                        </Show>
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