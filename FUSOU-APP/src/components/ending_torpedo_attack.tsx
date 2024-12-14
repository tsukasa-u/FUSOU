import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';

interface TorpedoSubmarineProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

interface TorpedoDamage {
    list: number[];
    dict: {[key: number]: {
        dmg: number;
        ships: number[];
        cl: number;
    }};
}

interface TorpedoDamages {
    frai: TorpedoDamage;
    erai: TorpedoDamage;
}

export function EndingTorpedoAttackComponent({deck_ship_id, battle_selected}: TorpedoSubmarineProps) {
    
    const show_torpedo_attack = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().ending_raigeki == null) return false;
        if (battle_selected().ending_raigeki.frai.findIndex((val) => val != null) == -1) return false;
        if (battle_selected().ending_raigeki.erai.findIndex((val) => val != null) == -1) return false;
        return true;
    });

    const torpedo_damage = createMemo<TorpedoDamages>(() => {

        let torpedo_damage: TorpedoDamages = {
            frai: {
                list: [],
                dict: {},
            },
            erai: {
                list: [],
                dict: {},
            },
        };
        if (battle_selected().ending_raigeki == null) return torpedo_damage;

        battle_selected().ending_raigeki.frai.forEach((frai, i) => {
            if (frai != -1) {
                // if (torpedo_damage.hasOwnProperty(frai)) {
                if (torpedo_damage.frai.list.includes(frai)) {
                    torpedo_damage.frai.dict[frai].dmg += battle_selected().ending_raigeki.fydam[i];
                    torpedo_damage.frai.dict[frai].ships.push(i);
                    // How to detect critical?
                    if (battle_selected().ending_raigeki.fcl[i] > torpedo_damage.frai.dict[frai].cl) {
                        torpedo_damage.frai.dict[frai].cl = battle_selected().ending_raigeki.fcl[i];
                    }
                } else {
                    torpedo_damage.frai.list.push(frai);
                    torpedo_damage.frai.dict[frai] = {
                        dmg: battle_selected().ending_raigeki.fydam[i],
                        ships: [i],
                        // How to detect critical?
                        cl : battle_selected().ending_raigeki.fcl[i],
                    };
                }
            }
        });
        battle_selected().ending_raigeki.erai.forEach((erai, i) => {
            if (erai != -1) {
                if (torpedo_damage.erai.list.includes(erai)) {
                    torpedo_damage.erai.dict[erai].dmg += battle_selected().ending_raigeki.eydam[i];
                    torpedo_damage.erai.dict[erai].ships.push(i);
                    // How to detect critical?
                    if (battle_selected().ending_raigeki.ecl[i] > torpedo_damage.erai.dict[erai].cl) {
                        torpedo_damage.erai.dict[erai].cl = battle_selected().ending_raigeki.ecl[i];
                    }
                } else {
                    torpedo_damage.erai.list.push(erai);
                    torpedo_damage.erai.dict[erai] = {
                        dmg: battle_selected().ending_raigeki.eydam[i],
                        ships: [i],
                        // How to detect critical?
                        cl: battle_selected().ending_raigeki.ecl[i], 
                    };
                }
            }
        });

        return torpedo_damage;
    });

    return (
        <Show when={show_torpedo_attack()}>
            <li>
                <details open={true}>
                    <summary>
                        Ending Torpedo Attack
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
                                <For each={torpedo_damage().frai.list}>
                                    {(frai, _) => (
                                        <tr>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={torpedo_damage().frai.dict[frai].ships}>
                                                        {(ship_id, ship_id_index) => (
                                                            <>
                                                                <Show when={ship_id_index() > 0}>
                                                                    <div class="h-px"></div>
                                                                </Show>
                                                                <ShipNameComponent ship_id={deck_ship_id[1][ship_id]}></ShipNameComponent>
                                                            </>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[frai]}></EnemyNameComponent>
                                            </td>
                                            <td >
                                                <div class={
                                                    (() => {
                                                        let cl_flag = torpedo_damage().frai.dict[frai].cl;
                                                        if (cl_flag==0) {
                                                            return "text-red-500";
                                                        } else if (cl_flag==2) {
                                                            return "text-yellow-500";
                                                        }
                                                    })()
                                                }>{torpedo_damage().frai.dict[frai].dmg}</div>
                                            </td>
                                        </tr>
                                    )}
                                </For>
                                <For each={torpedo_damage().erai.list}>
                                    {(erai, _) => (
                                        <tr>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={torpedo_damage().erai.dict[erai].ships}>
                                                        {(ship_id, _) => (
                                                            <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[ship_id]}></EnemyNameComponent>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <ShipNameComponent ship_id={deck_ship_id[1][erai]}></ShipNameComponent>
                                            </td>
                                            <td >
                                                <div class={
                                                    (() => {
                                                        let cl_flag = torpedo_damage().erai.dict[erai].cl;
                                                        if (cl_flag==0) {
                                                            return "text-red-500";
                                                        } else if (cl_flag==2) {
                                                            return "text-yellow-500";
                                                        }
                                                    })()
                                                }>{torpedo_damage().erai.dict[erai].dmg}</div>
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