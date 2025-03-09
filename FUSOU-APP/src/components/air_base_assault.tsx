import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';
import { EquimentComponent } from './equipment';
import { useAirBases, useSlotItems } from '../utility/provider';
import IconShield from '../icons/shield';

interface AirDamageProps {
    area_id: number;
    battle_selected: () => Battle;
}

export function AirBaseAssaultComponent({area_id, battle_selected}: AirDamageProps) {
    
    const [air_bases, ] =  useAirBases();
    const [slotitems, ] = useSlotItems();

    const show_air_attack = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().air_base_assault == null) return false;
        return true;
    });
    
    const show_damage = createMemo<boolean[][]>(() => {
        let show_damage: boolean[][] = [
            [false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false],
        ];
        if (battle_selected().air_base_assault == null) return show_damage;
        if (battle_selected().air_base_assault!.e_damage.bak_flag) {
            battle_selected()!.air_base_assault!.e_damage!.bak_flag!.forEach((flag, idx) => {
                show_damage[0][idx] ||= flag == 1;
            });
        }
        if (battle_selected().air_base_assault!.e_damage.rai_flag) {
            battle_selected()!.air_base_assault!.e_damage!.rai_flag!.forEach((flag, idx) => {
                show_damage[0][idx] ||= flag == 1;
            });
        }
        if (battle_selected().air_base_assault!.f_damage.bak_flag) {
            battle_selected()!.air_base_assault!.f_damage!.bak_flag!.forEach((flag, idx) => {
                show_damage[1][idx] ||= flag == 1;
            });
        }
        if (battle_selected().air_base_assault!.f_damage.rai_flag) {
            battle_selected()!.air_base_assault!.f_damage!.rai_flag!.forEach((flag, idx) => {
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
                        Air Base Assault
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
                                <tr>
                                    <td>
                                        <div class="flex flex-col">
                                            <For each={battle_selected().air_base_assault!.squadron_plane}>
                                                {(plane, idx) => (
                                                    <>
                                                        <Show when={idx() > 0}>
                                                            <div class="h-px"></div>
                                                        </Show>
                                                        <EquimentComponent slot_id={slotitems.slot_items[plane].id} name_flag={true}></EquimentComponent>
                                                    </>
                                                )}
                                            </For>
                                        </div>
                                    </td>
                                    <td>
                                        <div class="flex flex-col">
                                            <For each={battle_selected().air_base_assault!.e_damage.damages ?? []}>
                                                {(_, idx) => (
                                                    <>
                                                        <Show when={show_damage()[0][idx()]}>
                                                            <Show when={idx() > 0}>
                                                                <div class="h-px"></div>
                                                            </Show>
                                                            <div class="flex flex-nowrap">
                                                                <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[idx()]} ship_max_hp={battle_selected().e_hp_max![idx()]} ship_param={battle_selected().e_params![idx()]} ship_slot={battle_selected().e_slot![idx()]}></EnemyNameComponent>
                                                                <Show when={battle_selected().air_base_assault!.e_damage.protect_flag?.some(flag => flag == true)}>
                                                                    <IconShield class="h-4 w-4"></IconShield>
                                                                </Show>
                                                            </div>
                                                        </Show>
                                                    </>
                                                )}
                                            </For>
                                        </div>
                                    </td>
                                    <td >
                                        <div class="flex flex-col">
                                            <For each={battle_selected().air_base_assault!.e_damage.damages ?? []}>
                                                {(dmg, idx) => (
                                                    <>
                                                        <Show when={show_damage()[0][idx()]}>
                                                            <Show when={idx() > 0}>
                                                                <div class="h-[4px]"></div>
                                                            </Show>
                                                            <div class={
                                                                (() => {
                                                                    let cl_flag = battle_selected().air_base_assault!.e_damage.cl![idx()];
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
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </ul>
                </details>
            </li>
        </Show>
    );
}