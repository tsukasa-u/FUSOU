import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { SimpleShipNameComponent } from './simple_ship_name';
import { Battle } from '../interface/battle';
import { MstEquipmentComponent } from './mst_equipment';
import IconShield from '../icons/shield';

interface FriendlyForceAttackProps {
    battle_selected: () => Battle;
}

export function FriendlyForceAttackComponent({battle_selected}: FriendlyForceAttackProps) {
    
    const show_shelling = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().friendly_force_attack == null) return false;
        if (battle_selected().friendly_force_attack!.fleet_info == null) return false;
        if (battle_selected().friendly_force_attack!.support_hourai == null) return false;
        battle_selected().friendly_force_attack!.support_hourai!.hougeki
        return true;
    });

    return (
        <Show when={show_shelling()}>
            <li>
                <details open={true}>
                    <summary>
                        Friendly Force Attack
                    </summary>
                    <ul class="pl-0">
                        <div class="pl-2 text-xs flex felx-nowarp">
                            Flare : <span class="w-1"></span>
                            <Show when={battle_selected().friendly_force_attack!.support_hourai!.flare_pos != null} fallback={<div><div class="w-24">_</div><div class="w-3">/</div><div class="w-24">_</div></div>}>
                                <div class="w-24 flex justify-center">
                                    <Show when={battle_selected().friendly_force_attack!.support_hourai!.flare_pos![0] != -1} fallback={<div>_</div>}>
                                        <SimpleShipNameComponent ship_id={battle_selected().friendly_force_attack!.fleet_info.ship_id[battle_selected().friendly_force_attack!.support_hourai!.flare_pos![0]]} ship_param={battle_selected().friendly_force_attack!.fleet_info.params[battle_selected().friendly_force_attack!.support_hourai!.flare_pos![0]]} ship_slot={battle_selected().friendly_force_attack!.fleet_info.slot[battle_selected().friendly_force_attack!.support_hourai!.flare_pos![0]]} ship_max_hp={battle_selected().friendly_force_attack!.fleet_info.now_hps[battle_selected().friendly_force_attack!.support_hourai!.flare_pos![0]]}></SimpleShipNameComponent>
                                        {/* <ShipNameComponent ship_id={battle_selected().friendly_force_attack!.fleet_info.ship_id[battle_selected().friendly_force_attack!.support_hourai!.flare_pos![0]]}></ShipNameComponent> */}
                                    </Show>
                                </div>
                                <div class="w-3">/</div>
                                <div class="w-24 flex justify-center">
                                    <Show when={battle_selected().friendly_force_attack!.support_hourai!.flare_pos![1] != -1} fallback={<div>_</div>}>
                                        <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[battle_selected().friendly_force_attack!.support_hourai!.flare_pos![1]]} ship_param={battle_selected().e_params![battle_selected().friendly_force_attack!.support_hourai!.flare_pos![1]]} ship_slot={battle_selected().e_slot![battle_selected().friendly_force_attack!.support_hourai!.flare_pos![1]]} ship_max_hp={battle_selected().e_hp_max![battle_selected().friendly_force_attack!.support_hourai!.flare_pos![1]]} ></SimpleShipNameComponent>
                                    </Show>
                                </div>
                            </Show>
                        </div>
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
                                <Show when={battle_selected().friendly_force_attack!.support_hourai!.hougeki!.at_list != null}>
                                    <For each={battle_selected().friendly_force_attack!.support_hourai!.hougeki!.at_list}>
                                        {(at, at_index) => (
                                            <tr>
                                                <td>
                                                    <Show when={battle_selected().friendly_force_attack!.support_hourai!.hougeki!.at_eflag![at_index()]==0} fallback={
                                                        <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[at]} ship_param={battle_selected().e_params![at]} ship_slot={battle_selected().e_slot![at]} ship_max_hp={battle_selected().e_hp_max![at]} ></SimpleShipNameComponent>
                                                    }>
                                                        {/* <ShipNameComponent ship_id={battle_selected().friendly_force_attack!.fleet_info!.ship_id[at]}></ShipNameComponent> */}
                                                        <SimpleShipNameComponent ship_id={battle_selected().friendly_force_attack!.fleet_info.ship_id[at]} ship_param={battle_selected().friendly_force_attack!.fleet_info.params[at]} ship_slot={battle_selected().friendly_force_attack!.fleet_info.slot[at]} ship_max_hp={battle_selected().friendly_force_attack!.fleet_info.now_hps[at]}></SimpleShipNameComponent>
                                                    </Show>
                                                </td>
                                                <td>
                                                    <div class="flex flex-col">
                                                        <For each={battle_selected().friendly_force_attack!.support_hourai!.hougeki!.df_list![at_index()]}>
                                                            {(df, df_index) => (
                                                                <div class="flex flex-nowrap">
                                                                    <Show when={battle_selected().friendly_force_attack!.support_hourai!.hougeki!.at_eflag![at_index()]==1 && df != -1} fallback={
                                                                        <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[df]} ship_param={battle_selected().e_params![df]} ship_slot={battle_selected().e_slot![df]} ship_max_hp={battle_selected().e_hp_max![df]}></SimpleShipNameComponent>
                                                                    }>
                                                                        {/* <ShipNameComponent ship_id={battle_selected().friendly_force_attack!.fleet_info!.ship_id[df]}></ShipNameComponent> */}
                                                                        <SimpleShipNameComponent ship_id={battle_selected().friendly_force_attack!.fleet_info.ship_id[df]} ship_param={battle_selected().friendly_force_attack!.fleet_info.params[df]} ship_slot={battle_selected().friendly_force_attack!.fleet_info.slot[df]} ship_max_hp={battle_selected().friendly_force_attack!.fleet_info.now_hps[df]}></SimpleShipNameComponent>
                                                                    </Show>
                                                                    <Show when={battle_selected().friendly_force_attack!.support_hourai!.hougeki!.protect_flag![at_index()][df_index()] == true}>
                                                                        <IconShield class="h-5 w-5"></IconShield>
                                                                    </Show>
                                                                </div>
                                                            )}
                                                        </For>
                                                    </div>
                                                </td>
                                                <td >
                                                    <div class="flex flex-col">
                                                        <For each={battle_selected().friendly_force_attack!.support_hourai!.hougeki!.damage![at_index()]}>
                                                            {(dmg, dmg_index) => (
                                                                <Show when={dmg != -1}>
                                                                    <div class={
                                                                        (() => {
                                                                            let cl_flag = battle_selected().friendly_force_attack!.support_hourai!.hougeki!.cl_list![at_index()][dmg_index()];
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
                                                    <div class={battle_selected().friendly_force_attack!.support_hourai!.hougeki!.df_list![at_index()].length == 1 ? "flex flex-nowrap" : "flex flex-col"}>
                                                        <Show when={battle_selected().friendly_force_attack!.support_hourai!.hougeki!.si_list![at_index()] != null}>
                                                            <For each={battle_selected().friendly_force_attack!.support_hourai!.hougeki!.si_list![at_index()]}>
                                                                {(si) => (
                                                                    <Show when={si != null}>
                                                                        <MstEquipmentComponent equip_id={si ?? 0} name_flag={true} compact={true} show_param={battle_selected().friendly_force_attack!.support_hourai!.hougeki?.at_eflag![at_index()] == 0}></MstEquipmentComponent>
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