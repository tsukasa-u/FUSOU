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

export function OpeningTorpedoAttackComponent({deck_ship_id, battle_selected}: TorpedoSubmarineProps) {
    
    const show_torpedo_attack = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().deck_id == null) return false;
        if (battle_selected().opening_raigeki == null) return false;
        if (battle_selected().opening_raigeki.frai_list_items.findIndex((val) => val != null) == -1 && battle_selected().opening_raigeki.erai_list_items.findIndex((val) => val != null) == -1) return false;
        return true;
    });

    const opening_torpedo_damage = createMemo<TorpedoDamages>(() => {
        let opening_torpedo_damage: TorpedoDamages = {
            frai: {
                list: [],
                dict: {},
            },
            erai: {
                list: [],
                dict: {},
            },
        };
        if (battle_selected().opening_raigeki == null) return opening_torpedo_damage;
        
        battle_selected().opening_raigeki.frai_list_items.forEach((frai_list, i) => {
            if (frai_list != null) {
                frai_list.forEach((frai, j) => {
                    if (opening_torpedo_damage.frai.list.includes(frai)) {
                        opening_torpedo_damage.frai.dict[frai].dmg += battle_selected().opening_raigeki.fydam_list_items[i][j];
                        opening_torpedo_damage.frai.dict[frai].ships.push(i);
                        // How to detect critical?
                        if (battle_selected().opening_raigeki.fcl_list_items[i][j] > opening_torpedo_damage.frai.dict[frai].cl) {
                            opening_torpedo_damage.frai.dict[frai].cl = battle_selected().opening_raigeki.fcl_list_items[i][j];
                        }
                    } else {
                        opening_torpedo_damage.frai.list.push(frai);
                        opening_torpedo_damage.frai.dict[frai] = {
                            dmg: battle_selected().opening_raigeki.fydam_list_items[i][j],
                            ships: [i],
                            // How to detect critical?
                            cl : battle_selected().opening_raigeki.fcl_list_items[i][j],
                        };
                    }
                });
            }
        });
        battle_selected().opening_raigeki.erai_list_items.forEach((erai_list, i) => {
            if (erai_list != null) {
                erai_list.forEach((erai, j) => {
                    if (opening_torpedo_damage.erai.list.includes(erai)) {
                        opening_torpedo_damage.erai.dict[erai].dmg += battle_selected().opening_raigeki.eydam_list_items[i][j];
                        opening_torpedo_damage.erai.dict[erai].ships.push(i);
                        // How to detect critical?
                        if (battle_selected().opening_raigeki.ecl_list_items[i][j] > opening_torpedo_damage.erai.dict[erai].cl) {
                            opening_torpedo_damage.erai.dict[erai].cl = battle_selected().opening_raigeki.ecl_list_items[i][j];
                        }
                    } else {
                        opening_torpedo_damage.erai.list.push(erai);
                        opening_torpedo_damage.erai.dict[erai] = {
                            dmg: battle_selected().opening_raigeki.eydam_list_items[i][j],
                            ships: [i],
                            // How to detect critical?
                            cl: battle_selected().opening_raigeki.ecl_list_items[i][j], 
                        };
                    }
                });
            }
        });
        return opening_torpedo_damage;
    });

    return (
        <Show when={show_torpedo_attack()}>
            <li>
                <details open={true}>
                    <summary>
                        Opening Torpedo Attack
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
                                <For each={opening_torpedo_damage().frai.list}>
                                    {(frai, _) => (
                                        <tr>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={opening_torpedo_damage().frai.dict[frai].ships}>
                                                        {(ship_id, ship_id_index) => (
                                                            <>
                                                                <Show when={ship_id_index() > 0}>
                                                                    <div class="h-px"></div>
                                                                </Show>
                                                                <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][ship_id]}></ShipNameComponent>
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
                                                        let cl_flag = opening_torpedo_damage().frai.dict[frai].cl;
                                                        if (cl_flag==0) {
                                                            return "text-red-500";
                                                        } else if (cl_flag==2) {
                                                            return "text-yellow-500";
                                                        }
                                                    })()
                                                }>{opening_torpedo_damage().frai.dict[frai].dmg}</div>
                                            </td>
                                        </tr>
                                    )}
                                </For>
                                <For each={opening_torpedo_damage().erai.list}>
                                    {(erai, _) => (
                                        <tr>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={opening_torpedo_damage().erai.dict[erai].ships}>
                                                        {(ship_id, _) => (
                                                            <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[ship_id]}></EnemyNameComponent>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][erai]}></ShipNameComponent>
                                            </td>
                                            <td >
                                                <div class={
                                                    (() => {
                                                        let cl_flag = opening_torpedo_damage().erai.dict[erai].cl;
                                                        if (cl_flag==0) {
                                                            return "text-red-500";
                                                        } else if (cl_flag==2) {
                                                            return "text-yellow-500";
                                                        }
                                                    })()
                                                }>{opening_torpedo_damage().erai.dict[erai].dmg}</div>
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