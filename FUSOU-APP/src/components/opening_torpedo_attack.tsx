import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';
import IconShield from '../icons/shield';

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
                frai_list.forEach((frai) => {
                    if (opening_torpedo_damage.frai.list.includes(frai)) {
                        opening_torpedo_damage.frai.dict[frai].ships.push(i);
                    } else {
                        opening_torpedo_damage.frai.list.push(frai);
                        opening_torpedo_damage.frai.dict[frai] = {
                            dmg: battle_selected().opening_raigeki.edam[i],
                            ships: [i],
                            cl : battle_selected().opening_raigeki.ecl_list[i],
                        };
                    }
                });
            }
        });
        battle_selected().opening_raigeki.erai_list_items.forEach((erai_list, i) => {
            if (erai_list != null) {
                erai_list.forEach((erai) => {
                    if (opening_torpedo_damage.erai.list.includes(erai)) {
                        opening_torpedo_damage.erai.dict[erai].ships.push(i);
                    } else {
                        opening_torpedo_damage.erai.list.push(erai);
                        opening_torpedo_damage.erai.dict[erai] = {
                            dmg: battle_selected().opening_raigeki.fdam[i],
                            ships: [i],
                            cl: battle_selected().opening_raigeki.fcl_list[i], 
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
                                        <tr class="table_hover table_active rounded">
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
                                                <div class="flex flex-nowrap">
                                                    <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[frai]} ship_max_hp={battle_selected().e_hp_max![frai]} ship_param={battle_selected().e_params![frai]} ship_slot={battle_selected().e_slot![frai]}></EnemyNameComponent>
                                                    <Show when={battle_selected().opening_raigeki.e_protect_flag.some(flag => flag == true)}>
                                                        <IconShield class="h-5 w-5"></IconShield>
                                                    </Show>
                                                </div>
                                            </td>
                                            <td >
                                                <div class={
                                                    (() => {
                                                        let cl_flag = opening_torpedo_damage().frai.dict[frai].cl;
                                                        if (cl_flag==0 || opening_torpedo_damage().frai.dict[frai].dmg == 0) {
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
                                        <tr class="table_hover table_active rounded">
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={opening_torpedo_damage().erai.dict[erai].ships}>
                                                        {(ship_id, _) => (
                                                            <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[ship_id]} ship_max_hp={battle_selected().e_hp_max![ship_id]} ship_param={battle_selected().e_params![ship_id]} ship_slot={battle_selected().e_slot![ship_id]}></EnemyNameComponent>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <div class="flex flex-nowrap">
                                                    <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][erai]}></ShipNameComponent>
                                                    <Show when={battle_selected().opening_raigeki.f_protect_flag.some(flag => flag == true)}>
                                                        <IconShield class="h-5 w-5"></IconShield>
                                                    </Show>
                                                </div>
                                            </td>
                                            <td >
                                                <div class={
                                                    (() => {
                                                        let cl_flag = opening_torpedo_damage().erai.dict[erai].cl;
                                                        if (cl_flag==0 || opening_torpedo_damage().erai.dict[erai].dmg == 0) {
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