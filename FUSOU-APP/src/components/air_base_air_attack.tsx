import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';
import { EquimentComponent } from './equipment';
import { useAirBases } from '../utility/provider';

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
                                    <th>Attack</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={battle_selected().air_base_air_attacks.attacks}>
                                    {(attack, attack_idx) => (
                                        <tr>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={air_bases.bases[(area_id << 16) | attack.base_id].plane_info}>
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
                                                <For each={attack.e_damage.damages ?? []}>
                                                    {(_, idx) => (
                                                        <>
                                                            <Show when={show_damage()[attack_idx()][idx()]}>
                                                                <Show when={idx() > 0}>
                                                                    <div class="h-px"></div>
                                                                </Show>
                                                                <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[idx()]}></EnemyNameComponent>
                                                            </Show>
                                                        </>
                                                    )}
                                                </For>
                                            </td>
                                            <td >
                                                <For each={attack.e_damage.damages ?? []}>
                                                    {(dmg, idx) => (
                                                        <>
                                                            <Show when={show_damage()[attack_idx()][idx()]}>
                                                                <Show when={idx() > 0}>
                                                                    <div class="h-[4px]"></div>
                                                                </Show>
                                                                <div>{dmg}</div>
                                                            </Show>
                                                        </>
                                                    )}
                                                </For>
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