import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { SimpleShipNameComponent } from './simple_ship_name';
import { Battle } from '../interface/battle';
import { EquimentComponent } from './equipment';
import { useAirBases } from '../utility/provider';
import IconShield from '../icons/shield';
import { SimpleHpBar } from './simple_hp_bar';

interface AirDamageProps {
    area_id: number;
    battle_selected: () => Battle;
}

export function AirBaseAirAttackComponent({area_id, battle_selected}: AirDamageProps) {
    
    const [air_bases, ] =  useAirBases();

    const show_air_attack = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().air_base_air_attacks == null) return false;
        return true;
    });
    
    const show_damage = createMemo<boolean[][]>(() => {
        let show_damage: boolean[][] = [];
        if (!show_air_attack()) return show_damage;
        battle_selected().air_base_air_attacks.attacks.forEach((attack, attack_idx) => {
            show_damage.push([false, false, false, false, false, false, false]);
            if (attack.e_damage.bak_flag) {
                attack.e_damage.bak_flag!.forEach((flag, idx) => {
                    show_damage[attack_idx][idx] ||= flag == 1;
                });
            }
            if (attack.e_damage.rai_flag) {
                attack.e_damage.rai_flag!.forEach((flag, idx) => {
                    show_damage[attack_idx][idx] ||= flag == 1;
                });
            }
        });
        return show_damage;
    });

    return (
        <Show when={show_air_attack()}>
            <li>
                <details open={true}>
                    <summary>
                        Air Base Air Attack
                    </summary>
                    <ul class="pl-0">
                        <table class="table table-xs">
                            <thead>
                                <tr>
                                    <th>From</th>
                                    <th>To</th>
                                    <th>HP</th>
                                    <th>Attack</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={battle_selected().air_base_air_attacks.attacks}>
                                    {(attack, attack_idx) => (
                                        <tr class="table_hover table_active rounded">
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={air_bases.bases[(area_id << 16) | attack.base_id].plane_info.filter(palne => palne.slotid != 0)}>
                                                        {(plane, idx) => (
                                                            <>
                                                                <Show when={plane != null}>
                                                                    <Show when={idx() > 0}>
                                                                        <div class="h-px"></div>
                                                                    </Show>
                                                                    <EquimentComponent slot_id={plane.slotid} name_flag={true}></EquimentComponent>
                                                                </Show>
                                                            </>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={attack.e_damage.damages ?? []}>
                                                        {(_, idx) => (
                                                            <>
                                                                <Show when={show_damage()[attack_idx()][idx()]}>
                                                                    <Show when={idx() > 0}>
                                                                        <div class="h-px"></div>
                                                                    </Show>
                                                                    <div class="flex flex-nowrap">
                                                                        <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[idx()]} ship_max_hp={battle_selected().e_hp_max![idx()]} ship_param={battle_selected().e_params![idx()]} ship_slot={battle_selected().e_slot![idx()]}></SimpleShipNameComponent>
                                                                        <Show when={battle_selected().air_base_air_attacks.attacks[attack_idx()].e_damage.protect_flag?.some(flag => flag == true)}>
                                                                            <IconShield class="h-5 w-5"></IconShield>
                                                                        </Show>
                                                                    </div>
                                                                </Show>
                                                            </>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={attack.e_damage.damages ?? []}>
                                                        {(_, idx) => (
                                                            <>
                                                                <Show when={show_damage()[attack_idx()][idx()]}>
                                                                    <SimpleHpBar v_now={() => battle_selected().air_base_air_attacks.attacks[attack_idx()].e_damage.now_hps![idx()]} v_max={() => battle_selected().e_hp_max![idx()]}></SimpleHpBar>
                                                                </Show>
                                                            </>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td >
                                                <div class="flex flex-col">
                                                    <For each={attack.e_damage.damages ?? []}>
                                                        {(dmg, idx) => (
                                                            <>
                                                                <Show when={show_damage()[attack_idx()][idx()]}>
                                                                    <Show when={idx() > 0}>
                                                                        <div class="h-[4px]"></div>
                                                                    </Show>
                                                                    <div class={
                                                                        (() => {
                                                                            let cl_flag = battle_selected().air_base_air_attacks.attacks![attack_idx()].e_damage!.cl![idx()];
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