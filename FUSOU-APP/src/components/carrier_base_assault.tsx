import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { SimpleShipNameComponent } from './simple_ship_name';
import { Battle } from '../interface/battle';
import { MstEquipmentComponent } from './mst_equipment';
import IconShield from '../icons/shield';
import { EquimentComponent } from './equipment';
import { useSlotItems } from '../utility/provider';

interface AirDamageProps {
    battle_selected: () => Battle;
}

export function CarrierBaseAssaultComponent({battle_selected}: AirDamageProps) {

    const [slotitems, ] = useSlotItems();

    const show_air_attack = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().deck_id == null) return false;
        if (battle_selected().carrier_base_assault! == null) return false;
        if (battle_selected().carrier_base_assault!.f_damage.plane_from == null && battle_selected().carrier_base_assault!.e_damage.plane_from == null) return false;
        return true;
    });

    const show_damage = createMemo<boolean[][]>(() => {
        let show_damage: boolean[][] = [
            [false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false],
        ];
        if (battle_selected().carrier_base_assault! == null) return show_damage;
        if (battle_selected().carrier_base_assault!.e_damage.bak_flag) {
            battle_selected()!.carrier_base_assault!.e_damage!.bak_flag!.forEach((flag, idx) => {
                show_damage[0][idx] ||= flag == 1;
            });
        }
        if (battle_selected().carrier_base_assault!.e_damage.rai_flag) {
            battle_selected()!.carrier_base_assault!.e_damage!.rai_flag!.forEach((flag, idx) => {
                show_damage[0][idx] ||= flag == 1;
            });
        }
        if (battle_selected().carrier_base_assault!.f_damage.bak_flag) {
            battle_selected()!.carrier_base_assault!.f_damage!.bak_flag!.forEach((flag, idx) => {
                show_damage[1][idx] ||= flag == 1;
            });
        }
        if (battle_selected().carrier_base_assault!.f_damage.rai_flag) {
            battle_selected()!.carrier_base_assault!.f_damage!.rai_flag!.forEach((flag, idx) => {
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
                        Carrier Base Assault
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
                                <Show when={(battle_selected().carrier_base_assault!.f_damage!.plane_from ?? []).length > 0}>
                                    <tr class="table_hover table_active rounded">
                                        <td>
                                            <div class="flex flex-col">
                                                <For each={battle_selected().air_base_assault!.squadron_plane}>
                                                    {(plane, idx) => (
                                                        <>
                                                            <Show when={idx() > 0}>
                                                                <div class="h-px"></div>
                                                            </Show>
                                                            {/* <EquimentComponent slot_id={plane} name_flag={true}></EquimentComponent> */}
                                                        </>
                                                    )}
                                                </For>
                                            </div>
                                        </td>
                                        <td>
                                            <For each={battle_selected().carrier_base_assault!.e_damage.damages}>
                                                {(_, idx) => (
                                                    <>
                                                        <Show when={show_damage()[0][idx()]}>
                                                            <Show when={idx() > 0}>
                                                                <div class="h-px"></div>
                                                            </Show>
                                                            <div class="flex flex-nowrap">
                                                                <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[idx()]} ship_slot={battle_selected().e_slot![idx()]} ship_param={battle_selected().e_params![idx()]} ship_max_hp={battle_selected().e_hp_max![idx()]}></SimpleShipNameComponent>
                                                                <Show when={battle_selected().carrier_base_assault!.e_damage.protect_flag?.some(flag => flag == true)}>
                                                                    <IconShield class="h-4 w-4"></IconShield>
                                                                </Show>
                                                            </div>
                                                        </Show>
                                                    </>
                                                )}
                                            </For>
                                        </td>
                                        <td >
                                            <For each={battle_selected().carrier_base_assault!.e_damage.damages}>
                                                {(dmg, dmg_index) => (
                                                    <>
                                                        <Show when={show_damage()[0][dmg_index()]}>
                                                            <Show when={dmg_index() > 0}>
                                                                <div class="h-[4px]"></div>
                                                            </Show>
                                                            <div class={
                                                                (() => {
                                                                    let cl_flag = battle_selected().carrier_base_assault!.e_damage!.cl![dmg_index()] ?? 0;
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
                    </ul>
                </details>
            </li>
        </Show>
    );
}