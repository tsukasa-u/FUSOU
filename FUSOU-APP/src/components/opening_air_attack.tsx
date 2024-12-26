import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';

interface AirDamageProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

interface AirDamage {
    plane_from: number[];
    touch_plane: number;
    loss_plane1: number;
    loss_plane2: number;
    damages: number[];
    cl: number[];
    sp: number[][];
    rai_flag: number[];
    bak_flag: number[];
}

interface AirFire {
    use_items: number[];
    ship_id: number;
}

interface AirDamages {
    air_superiority: number;
    air_fire: AirFire;
    f_damage: AirDamage;
    e_damage: AirDamage;
}

export function OpeningAirAttackComponent({deck_ship_id, battle_selected}: AirDamageProps) {
    const show_air_attack = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().opening_air_attack == null) return false;
        if (battle_selected().opening_air_attack.f_damage == null) return false;
        if (battle_selected().opening_air_attack.e_damage == null) return false;
        console.log(battle_selected().opening_air_attack);
        return true;
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
                                                {(plane_flag, idx) => (
                                                    <>
                                                        <Show when={plane_flag != -1}>
                                                            <Show when={idx() > 0}>
                                                                <div class="h-px"></div>
                                                            </Show>
                                                            <ShipNameComponent ship_id={deck_ship_id[1][idx()]}></ShipNameComponent>
                                                        </Show>
                                                    </>
                                                )}
                                            </For>
                                        </div>
                                    </td>
                                    <td>
                                        <For each={battle_selected().opening_air_attack.e_damage.damages}>
                                            {(dmg, idx) => (
                                                <>
                                                    <Show when={battle_selected().opening_air_attack.e_damage.bak_flag[idx()] || battle_selected().opening_air_attack.e_damage.rai_flag[idx()]}>
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
                                                    <Show when={battle_selected().opening_air_attack.e_damage.bak_flag[idx()] || battle_selected().opening_air_attack.e_damage.rai_flag[idx()]}>
                                                        <Show when={idx() > 0}>
                                                            <div class="h-[4px]"></div>
                                                        </Show>
                                                        <div class={
                                                            (() => {
                                                                let cl_flag = battle_selected().opening_air_attack.f_damage.cl[idx()];
                                                                if (cl_flag==1) {
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
                                            {(dmg, idx) => (
                                                <>
                                                    <Show when={battle_selected().opening_air_attack.f_damage.bak_flag[idx()] || battle_selected().opening_air_attack.f_damage.rai_flag[idx()]}>
                                                        <Show when={idx() > 0}>
                                                            <div class="h-px"></div>
                                                        </Show>
                                                        <ShipNameComponent ship_id={deck_ship_id[1][idx()]}></ShipNameComponent>
                                                    </Show>
                                                </>
                                            )}
                                        </For>
                                    </td>
                                    <td>
                                        <For each={battle_selected().opening_air_attack.f_damage.damages}>
                                            {(dmg, idx) => (
                                                <>
                                                    <Show when={battle_selected().opening_air_attack.f_damage.bak_flag[idx()] || battle_selected().opening_air_attack.f_damage.rai_flag[idx()]}>
                                                        <div class={
                                                            (() => {
                                                                let cl_flag = battle_selected().opening_air_attack.e_damage.cl[idx()];
                                                                if (cl_flag==2) {
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
                            </tbody>
                        </table>
                    </ul>
                </details>
            </li>
        </Show>
    );
}