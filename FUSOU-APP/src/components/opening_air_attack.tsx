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
        return true;
    });

    const opening_air_attack = createMemo<AirDamages>(() => {
        let opening_air_attack: AirDamages = {
            air_fire: {
                use_items: [],
                ship_id: -1,
            },
            air_superiority: 0,
            f_damage: {
                plane_from: [],
                touch_plane: 0,
                loss_plane1: 0,
                loss_plane2: 0,
                damages: [],
                cl: [],
                sp: [],
                rai_flag: [],
                bak_flag: [],
            },
            e_damage: {
                plane_from: [],
                touch_plane: 0,
                loss_plane1: 0,
                loss_plane2: 0,
                damages: [],
                cl: [],
                sp: [],
                rai_flag: [],
                bak_flag: [],
            },
        };
        if (battle_selected().opening_air_attack == null) return opening_air_attack;
        
        battle_selected().opening_air_attack.f_damage.damages.forEach((damage, index) => {
            opening_air_attack.f_damage.damages.push(damage);
            opening_air_attack.f_damage.cl.push(battle_selected().opening_air_attack.f_damage.cl[index]);
            opening_air_attack.f_damage.sp.push(battle_selected().opening_air_attack.f_damage.sp[index]);
        });
        battle_selected().opening_air_attack.e_damage.damages.forEach((damage, index) => {
            opening_air_attack.e_damage.damages.push(damage);
            opening_air_attack.e_damage.cl.push(battle_selected().opening_air_attack.e_damage.cl[index]);
            opening_air_attack.e_damage.sp.push(battle_selected().opening_air_attack.e_damage.sp[index]);
        });
        opening_air_attack.air_superiority = battle_selected().opening_air_attack.air_superiority;
        opening_air_attack.air_fire = battle_selected().opening_air_attack.air_fire;

        return opening_air_attack;
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
                                            <For each={opening_air_attack().f_damage.plane_from}>
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
                                        <For each={opening_air_attack().e_damage.damages}>
                                            {(dmg, idx) => (
                                                <>
                                                    <Show when={opening_air_attack().e_damage.bak_flag[idx()] || opening_air_attack().e_damage.rai_flag[idx()]}>
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
                                        <For each={opening_air_attack().e_damage.damages}>
                                            {(dmg, idx) => (
                                                <>
                                                    <div class={
                                                        (() => {
                                                            let cl_flag = opening_air_attack().f_damage.cl[idx()];
                                                            if (cl_flag==0) {
                                                                return "text-red-500";
                                                            } else if (cl_flag==2) {
                                                                return "text-yellow-500";
                                                            }
                                                        })()
                                                    }>{dmg}</div>
                                                </>
                                            )}
                                        </For>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <div class="flex flex-col">
                                            <For each={opening_air_attack().e_damage.plane_from}>
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
                                        <For each={opening_air_attack().f_damage.damages}>
                                            {(dmg, idx) => (
                                                <>
                                                    <Show when={opening_air_attack().f_damage.bak_flag[idx()] || opening_air_attack().f_damage.rai_flag[idx()]}>
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
                                        <For each={opening_air_attack().f_damage.damages}>
                                            {(dmg, idx) => (
                                                <>
                                                    <div class={
                                                        (() => {
                                                            let cl_flag = opening_air_attack().e_damage.cl[idx()];
                                                            if (cl_flag==0) {
                                                                return "text-red-500";
                                                            } else if (cl_flag==2) {
                                                                return "text-yellow-500";
                                                            }
                                                        })()
                                                    }>{dmg}</div>
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