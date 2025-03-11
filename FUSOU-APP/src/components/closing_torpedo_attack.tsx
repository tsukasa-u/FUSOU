import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { SimpleShipNameComponent } from './simple_ship_name';
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

export function ClosingTorpedoAttackComponent({deck_ship_id, battle_selected}: TorpedoSubmarineProps) {
    
    const show_torpedo_attack = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().deck_id == null) return false;
        if (battle_selected().closing_raigeki == null) return false;
        if (battle_selected().closing_raigeki.frai.findIndex((val) => val != null) == -1 && battle_selected().closing_raigeki.erai.findIndex((val) => val != null) == -1) return false;
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
        if (battle_selected().closing_raigeki == null) return torpedo_damage;

        battle_selected().closing_raigeki.frai.forEach((frai, i) => {
            if (frai != -1) {
                if (torpedo_damage.frai.list.includes(frai)) {
                    torpedo_damage.frai.dict[frai].ships.push(i);
                } else {
                    torpedo_damage.frai.list.push(frai);
                    torpedo_damage.frai.dict[frai] = {
                        dmg: battle_selected().closing_raigeki.edam[frai],
                        ships: [i],
                        cl : battle_selected().closing_raigeki.ecl[frai],
                    };
                }
            }
        });
        battle_selected().closing_raigeki.erai.forEach((erai, i) => {
            if (erai != -1) {
                if (torpedo_damage.erai.list.includes(erai)) {
                    torpedo_damage.erai.dict[erai].ships.push(i);
                } else {
                    torpedo_damage.erai.list.push(erai);
                    torpedo_damage.erai.dict[erai] = {
                        dmg: battle_selected().closing_raigeki.fdam[erai],
                        ships: [i],
                        cl: battle_selected().closing_raigeki.fcl[erai], 
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
                        Closing Torpedo Attack
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
                                        <tr class="table_hover table_active rounded">
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={torpedo_damage().frai.dict[frai].ships}>
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
                                                    <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[frai]} ship_max_hp={battle_selected().e_hp_max![frai]} ship_param={battle_selected().e_params![frai]} ship_slot={battle_selected().e_slot![frai]}></SimpleShipNameComponent>
                                                    <Show when={battle_selected().closing_raigeki.e_protect_flag.some(flag => flag == true)}>
                                                        <IconShield class="h-5 w-5"></IconShield>
                                                    </Show>
                                                </div>
                                            </td>
                                            <td >
                                                <div class={
                                                    (() => {
                                                        let cl_flag = torpedo_damage().frai.dict[frai].cl;
                                                        if (cl_flag==0 || torpedo_damage().frai.dict[frai].dmg == 0) {
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
                                        <tr class="table_hover table_active rounded">
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={torpedo_damage().erai.dict[erai].ships}>
                                                        {(ship_id, _) => (
                                                            <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[ship_id]} ship_max_hp={battle_selected().e_hp_max![ship_id]} ship_param={battle_selected().e_params![ship_id]} ship_slot={battle_selected().e_slot![ship_id]}></SimpleShipNameComponent>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <div class="flex flex-nowrap">
                                                    <ShipNameComponent ship_id={deck_ship_id[battle_selected().deck_id!][erai]}></ShipNameComponent>
                                                    <Show when={battle_selected().closing_raigeki.f_protect_flag.some(flag => flag == true)}>
                                                        <IconShield class="h-5 w-5"></IconShield>
                                                    </Show>
                                                </div>
                                            </td>
                                            <td >
                                                <div class={
                                                    (() => {
                                                        let cl_flag = torpedo_damage().erai.dict[erai].cl;
                                                        if (cl_flag==0 || torpedo_damage().erai.dict[erai].dmg == 0) {
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