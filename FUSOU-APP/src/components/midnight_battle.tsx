import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { SimpleShipNameComponent } from './simple_ship_name';
import { Battle } from '../interface/battle';
import { MstEquipmentComponent } from './mst_equipment';
import IconShield from '../icons/shield';
import { SimpleHpBar } from './simple_hp_bar';
import { useShips } from '../utility/provider';

interface MidnightShellingProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

export function MidnightShellingComponent({deck_ship_id, battle_selected}: MidnightShellingProps) {

    const [ships,] = useShips();
    
    const show_shelling = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().deck_id == null) return false;
        if (battle_selected().midnight_hougeki == null) return false;
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
                        <div class="pl-2 text-xs flex felx-nowarp">
                        touch : <span class="w-1"></span>
                            <div class="w-6 flex justify-center">
                                <Show when={battle_selected().midngiht_touchplane![0] > 0} fallback={<div>_</div>}>
                                    <MstEquipmentComponent equip_id={battle_selected().midngiht_touchplane![0]} name_flag={true} compact={true} show_param={true}></MstEquipmentComponent>
                                </Show>
                            </div>
                            <div class="w-6 flex justify-center">
                                <Show when={battle_selected().midngiht_touchplane![1] > 0} fallback={<div>_</div>}>
                                    <MstEquipmentComponent equip_id={battle_selected().midngiht_touchplane![1]} name_flag={true} compact={true} show_param={true}></MstEquipmentComponent>
                                </Show>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0"></div>
                            Flare : <span class="w-1"></span>
                            <Show when={battle_selected().midnight_flare_pos != null} fallback={<div><div class="w-24">_</div><div class="w-3">/</div><div class="w-24">_</div></div>}>
                                <div class="w-24 flex justify-center">
                                    <Show when={battle_selected().midnight_flare_pos![0] != -1} fallback={<div>_</div>}>
                                        <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][battle_selected().midnight_flare_pos![0]]}></ShipNameComponent>
                                    </Show>
                                </div>
                                <div class="w-3">/</div>
                                <div class="w-24 flex justify-center">
                                    <Show when={battle_selected().midnight_flare_pos![1] != -1} fallback={<div>_</div>}>
                                        <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[battle_selected().midnight_flare_pos![1]]} ship_param={battle_selected().e_params![battle_selected().midnight_flare_pos![1]]} ship_slot={battle_selected().e_slot![battle_selected().midnight_flare_pos![1]]} ship_max_hp={battle_selected().e_hp_max![battle_selected().midnight_flare_pos![1]]} ></SimpleShipNameComponent>
                                    </Show>
                                </div>
                            </Show>
                        </div>
                        <table class="table table-xs">
                            <thead>
                                <tr>
                                    <th>From</th>
                                    <th>HP</th>
                                    <th>To</th>
                                    <th>HP</th>
                                    <th>Attack</th>
                                    <th>CI</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Show when={battle_selected().midnight_hougeki?.at_list != null}>
                                    <For each={battle_selected().midnight_hougeki?.at_list}>
                                        {(at, at_index) => (
                                            <tr class="table_hover table_active rounded">
                                                <td>
                                                    <Show when={battle_selected().midnight_hougeki?.at_eflag![at_index()]==0} fallback={
                                                        <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[at]} ship_param={battle_selected().e_params![at]} ship_slot={battle_selected().e_slot![at]} ship_max_hp={battle_selected().e_hp_max![at]} ></SimpleShipNameComponent>
                                                    }>
                                                        <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][at]}></ShipNameComponent>
                                                    </Show>
                                                </td>
                                                <td>
                                                    <Show when={battle_selected().midnight_hougeki?.at_eflag![at_index()]==0} fallback={
                                                        <SimpleHpBar v_now={() => battle_selected().midnight_hougeki!.e_now_hps![at_index()][at]} v_max={() => battle_selected().e_hp_max![at]}></SimpleHpBar>
                                                    }>
                                                        <SimpleHpBar v_now={() => battle_selected().midnight_hougeki!.f_now_hps![at_index()][at]} v_max={() => ships.ships[deck_ship_id[battle_selected().deck_id!][at]].maxhp}></SimpleHpBar>
                                                    </Show>
                                                </td>
                                                <td>
                                                    <div class="flex flex-col">
                                                        <For each={battle_selected().midnight_hougeki?.df_list![at_index()]}>
                                                            {(df, df_index) => (
                                                                <div class="flex flex-nowrap">
                                                                    <Show when={battle_selected().midnight_hougeki?.at_eflag![at_index()]==1 && df != -1} fallback={
                                                                        <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[df]} ship_param={battle_selected().e_params![df]} ship_slot={battle_selected().e_slot![df]} ship_max_hp={battle_selected().e_hp_max![df]}></SimpleShipNameComponent>
                                                                    }>
                                                                        <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][df]}></ShipNameComponent>
                                                                    </Show>
                                                                    <Show when={battle_selected().midnight_hougeki?.protect_flag![at_index()][df_index()] == true}>
                                                                        <IconShield class="h-5 w-5"></IconShield>
                                                                    </Show>
                                                                </div>
                                                            )}
                                                        </For>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div class="flex flex-col">
                                                        <For each={battle_selected().midnight_hougeki?.df_list![at_index()]}>
                                                            {(df) => (
                                                                <div class="flex flex-nowrap">
                                                                <Show when={battle_selected().midnight_hougeki?.at_eflag![at_index()]==1} fallback={
                                                                    <SimpleHpBar v_now={() => battle_selected().midnight_hougeki!.e_now_hps![at_index()][df]} v_max={() => battle_selected().e_hp_max![at]}></SimpleHpBar>
                                                                }>
                                                                    <SimpleHpBar v_now={() => battle_selected().midnight_hougeki!.f_now_hps![at_index()][df]} v_max={() => ships.ships[deck_ship_id[battle_selected().deck_id!][df]].maxhp}></SimpleHpBar>
                                                                </Show>
                                                                </div>
                                                            )}
                                                        </For>
                                                    </div>
                                                </td>
                                                <td >
                                                    <div class="flex flex-col">
                                                        <For each={battle_selected().midnight_hougeki?.damage![at_index()]}>
                                                            {(dmg, dmg_index) => (
                                                                <Show when={dmg != -1}>
                                                                    <div class={
                                                                        (() => {
                                                                            let cl_flag = battle_selected().midnight_hougeki?.cl_list![at_index()][dmg_index()];
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
                                                    <div class={battle_selected().midnight_hougeki?.df_list![at_index()].length == 1 ? "flex flex-nowrap" : "flex flex-col"}>
                                                        <Show when={battle_selected().midnight_hougeki?.si_list![at_index()] != null}>
                                                            <For each={battle_selected().midnight_hougeki?.si_list![at_index()]}>
                                                                {(si) => (
                                                                    <Show when={si != null}>
                                                                        <MstEquipmentComponent equip_id={si ?? 0} name_flag={true} compact={true} show_param={battle_selected().midnight_hougeki?.at_eflag![at_index()] == 0}></MstEquipmentComponent>
                                                                    </Show>
                                                                )}
                                                            </For>
                                                        </Show>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </For>
                                </Show>
                            </tbody>
                        </table>
                    </ul>
                </details>
            </li>
        </Show>
    );
}