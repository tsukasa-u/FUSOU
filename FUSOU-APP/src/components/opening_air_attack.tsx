import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';
import { MstEquipmentComponent } from './mst_equipment';

interface AirDamageProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

export function OpeningAirAttackComponent({deck_ship_id, battle_selected}: AirDamageProps) {
    const show_air_attack = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().deck_id == null) return false;
        if (battle_selected().opening_air_attack == null) return false;
        if (battle_selected().opening_air_attack.f_damage.plane_from == null && battle_selected().opening_air_attack.e_damage.plane_from == null) return false;
        console.log(battle_selected().opening_air_attack);
        return true;
    });

    const show_damage = createMemo<boolean[][]>(() => {
        let show_damage: boolean[][] = [
            [false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false],
        ];
        if (battle_selected().opening_air_attack == null) return show_damage;
        if (battle_selected().opening_air_attack.e_damage.bak_flag) {
            battle_selected()!.opening_air_attack!.e_damage!.bak_flag!.forEach((flag, idx) => {
                show_damage[0][idx] ||= flag == 1;
            });
        }
        if (battle_selected().opening_air_attack.e_damage.rai_flag) {
            battle_selected()!.opening_air_attack!.e_damage!.rai_flag!.forEach((flag, idx) => {
                show_damage[0][idx] ||= flag == 1;
            });
        }
        if (battle_selected().opening_air_attack.f_damage.bak_flag) {
            battle_selected()!.opening_air_attack!.f_damage!.bak_flag!.forEach((flag, idx) => {
                show_damage[1][idx] ||= flag == 1;
            });
        }
        if (battle_selected().opening_air_attack.f_damage.rai_flag) {
            battle_selected()!.opening_air_attack!.f_damage!.rai_flag!.forEach((flag, idx) => {
                show_damage[1][idx] ||= flag == 1;
            });
        }
        return show_damage;
    });

    return (
        <Show when={show_air_attack()}>
            <li>
                <details open={true}>
                    <summary>
                        Opening Air Attack
                    </summary>
                    <ul class="pl-0">
                        <div class="pl-2 text-xs flex felx-nowarp">
                            Air State : {(() => {
                                switch (battle_selected().opening_air_attack.air_superiority) {
                                    case 0:
                                        return <div class="text-lime-500 pl-1">Air Supremacy</div>;
                                    case 1:
                                        return <div class="text-lime-500 pl-1">Air Superiority</div>;
                                    // case 2:
                                    //     return <div class="grey-500 pl-1">Air Parity"</div>;
                                    // case 3:
                                    //     return <div class="grey-500 pl-1">Air Denial</div>;
                                    case 4:
                                        return <div class="text-red-500 pl-1">Air Incapability</div>;
                                    default:
                                        return <div class="text-grey-500 pl-1">Unknown</div>;
                                }
                            })()}
                            <div class="divider divider-horizontal mr-0 ml-0"></div>
                            touch : <span class="w-1"></span>
                            <div class="w-6 flex justify-center">
                                <Show when={(battle_selected().opening_air_attack!.f_damage!.touch_plane ?? 0) > 0} fallback={<div>_</div>}>
                                    <MstEquipmentComponent equip_id={battle_selected().opening_air_attack!.f_damage!.touch_plane!} name_flag={true} compact={true} show_param={true}></MstEquipmentComponent>
                                </Show>
                            </div>
                            <div class="w-6 flex justify-center">
                                <Show when={(battle_selected().opening_air_attack!.e_damage!.touch_plane ?? 0) > 0} fallback={<div>_</div>}>
                                {/* {(()=>{console.log(battle_selected().opening_air_attack!.e_damage!.touch_plane ?? 0); return <></>;})()} */}
                                    <MstEquipmentComponent equip_id={battle_selected().opening_air_attack!.e_damage!.touch_plane!} name_flag={true} compact={true} show_param={true}></MstEquipmentComponent>
                                </Show>
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0"></div>
                            CI : <span class="w-1"></span>
                            <div class="flex justify-center">
                                <Show when={battle_selected().opening_air_attack!.air_fire != null} fallback={<div>_</div>}>
                                    {/* {(() => {console.log(deck_ship_id[battle_selected().deck_id!][battle_selected().opening_air_attack!.air_fire!.idx]);return ""})()} */}
                                    <div class="w-24">
                                        <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][battle_selected().opening_air_attack!.air_fire!.idx]} compact={false}></ShipNameComponent>
                                    </div>
                                </Show>
                                <span class="px-1"> </span>
                                <Show when={battle_selected().opening_air_attack!.air_fire != null} fallback={<div>_</div>}>
                                    <For each={battle_selected().opening_air_attack!.air_fire!.use_item}>
                                        {(item_id, idx) => (
                                            <>
                                                <Show when={idx() > 0}>
                                                    <div class="w-1"></div>
                                                </Show>
                                                <MstEquipmentComponent equip_id={item_id} name_flag={true} compact={true} show_param={true}></MstEquipmentComponent>
                                            </>
                                        )}
                                    </For>
                                </Show>
                            </div>
                        </div>
                        <Show when={(battle_selected().opening_air_attack!.f_damage!.plane_from ?? []).length > 0 || (battle_selected().opening_air_attack!.e_damage!.plane_from ?? []).length > 0}>
                            <table class="table table-xs">
                                <thead>
                                    <tr>
                                        <th>From</th>
                                        <th>To</th>
                                        <th>Attack</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <Show when={(battle_selected().opening_air_attack!.f_damage!.plane_from ?? []).length > 0}>
                                        <tr class="table_hover table_active rounded">
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={battle_selected().opening_air_attack.f_damage.plane_from}>
                                                        {(ship_idx, idx) => (
                                                            <>
                                                                <Show when={idx() > 0}>
                                                                    <div class="h-px"></div>
                                                                </Show>
                                                                <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][ship_idx-1]}></ShipNameComponent>
                                                            </>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <For each={battle_selected().opening_air_attack.e_damage.damages}>
                                                    {(_, idx) => (
                                                        <>
                                                            <Show when={show_damage()[0][idx()]}>
                                                                <Show when={idx() > 0}>
                                                                    <div class="h-px"></div>
                                                                </Show>
                                                                    <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[idx()]} ship_slot={battle_selected().e_slot![idx()]} ship_param={battle_selected().e_params![idx()]} ship_max_hp={battle_selected().e_hp_max![idx()]} display={false}></EnemyNameComponent>
                                                            </Show>
                                                        </>
                                                    )}
                                                </For>
                                            </td>
                                            <td >
                                                <For each={battle_selected().opening_air_attack.e_damage.damages}>
                                                    {(dmg, dmg_index) => (
                                                        <>
                                                            <Show when={show_damage()[0][dmg_index()]}>
                                                                <Show when={dmg_index() > 0}>
                                                                    <div class="h-[4px]"></div>
                                                                </Show>
                                                                <div class={
                                                                    (() => {
                                                                        let cl_flag = battle_selected().opening_air_attack!.e_damage!.cl![dmg_index()] ?? 0;
                                                                        if (cl_flag==0 || dmg==0) {
                                                                            return "text-red-500";
                                                                        } else if (cl_flag==2) {
                                                                            return "text-yellow-500";
                                                                        }
                                                                    })()
                                                                }>{dmg}</div>
                                                            </Show>
                                                        </>
                                                    )}
                                                </For>
                                            </td>
                                        </tr>
                                    </Show>
                                    <Show when={(battle_selected().opening_air_attack!.e_damage!.plane_from ?? []).length > 0}>
                                        <tr class="table_hover table_active rounded">
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={battle_selected().opening_air_attack.e_damage.plane_from}>
                                                        {(plane_flag, idx) => (
                                                            <>
                                                                <Show when={plane_flag != -1}>
                                                                    <Show when={idx() > 0}>
                                                                        <div class="h-px"></div>
                                                                    </Show>
                                                                    <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[idx()]} ship_slot={battle_selected().e_slot![idx()]} ship_param={battle_selected().e_params![idx()]} ship_max_hp={battle_selected().e_hp_max![idx()]} display={false}></EnemyNameComponent>
                                                                </Show>
                                                            </>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <For each={battle_selected().opening_air_attack.f_damage.damages}>
                                                    {(_, idx) => (
                                                        <>
                                                            <Show when={show_damage()[1][idx()]}>
                                                                <Show when={idx() > 0}>
                                                                    <div class="h-px"></div>
                                                                </Show>
                                                                <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][idx()]}></ShipNameComponent>
                                                            </Show>
                                                        </>
                                                    )}
                                                </For>
                                            </td>
                                            <td>
                                                <For each={battle_selected().opening_air_attack.f_damage.damages}>
                                                    {(dmg, dmg_index) => (
                                                        <>
                                                            <Show when={show_damage()[1][dmg_index()]}>
                                                                <Show when={dmg_index() > 0}>
                                                                    <div class="h-[4px]"></div>
                                                                </Show>
                                                                <div class={
                                                                    (() => {
                                                                        let cl_flag = battle_selected().opening_air_attack!.f_damage!.cl![dmg_index()] ?? 0;
                                                                        if (cl_flag==0 || dmg==0) {
                                                                            return "text-red-500";
                                                                        } else if (cl_flag==2) {
                                                                            return "text-yellow-500";
                                                                        }
                                                                    })()
                                                                }>{dmg}</div>
                                                            </Show>
                                                        </>
                                                    )}
                                                </For>
                                            </td>
                                        </tr>
                                    </Show>
                                </tbody>
                            </table>
                        </Show>
                    </ul>
                </details>
            </li>
        </Show>
    );
}