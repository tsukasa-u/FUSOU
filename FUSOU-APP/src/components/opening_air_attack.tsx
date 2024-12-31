import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';

interface AirDamageProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

export function OpeningAirAttackComponent({deck_ship_id, battle_selected}: AirDamageProps) {
    const show_air_attack = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().deck_id == null) return false;
        if (battle_selected().opening_air_attack == null) return false;
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
                                                        <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[idx()]}></EnemyNameComponent>
                                                    </Show>
                                                </>
                                            )}
                                        </For>
                                    </td>
                                    <td >
                                        <For each={battle_selected().opening_air_attack.e_damage.damages}>
                                            {(dmg, idx) => (
                                                <>
                                                    <Show when={show_damage()[0][idx()]}>
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
                                <tr>
                                    <td>
                                        <div class="flex flex-col">
                                            <For each={battle_selected().opening_air_attack.e_damage.plane_from}>
                                                {(plane_flag, idx) => (
                                                    <>
                                                        <Show when={plane_flag != -1}>
                                                            <Show when={idx() > 0}>
                                                                <div class="h-px"></div>
                                                            </Show>
                                                            <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[idx()]}></EnemyNameComponent>
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
                                            {(dmg, idx) => (
                                                <>
                                                    <Show when={show_damage()[1][idx()]}>
                                                        <div>{dmg}</div>
                                                    </Show>
                                                </>
                                            )}
                                        </For>
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