import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { SimpleShipNameComponent } from './simple_ship_name';
import { Battle } from '../interface/battle';
import IconShield from '../icons/shield';
import { SimpleHpBar } from './simple_hp_bar';
import { useShips } from '../utility/provider';

interface AirDamageProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

export function SupportAttackComponent({deck_ship_id, battle_selected}: AirDamageProps) {

    const [ships,] = useShips();

    const show_support = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().deck_id == null) return false;
        if (battle_selected().support_attack == null) return false;
        return true;
    });


    const show_air_damage = createMemo<boolean[][]>(() => {
        let show_air_damage: boolean[][] = [
            [false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false],
        ];
        if (battle_selected().support_attack == null) return show_air_damage;
        if (battle_selected().support_attack!.support_airatack == null) return show_air_damage;
        if (battle_selected().support_attack!.support_airatack!.e_damage.bak_flag) {
            battle_selected().support_attack!.support_airatack!.e_damage!.bak_flag!.forEach((flag, idx) => {
                show_air_damage[0][idx] ||= flag == 1;
            });
        }
        if (battle_selected().support_attack!.support_airatack!.e_damage.rai_flag) {
            battle_selected()!.support_attack!.support_airatack!!.e_damage!.rai_flag!.forEach((flag, idx) => {
                show_air_damage[0][idx] ||= flag == 1;
            });
        }
        if (battle_selected().support_attack!.support_airatack!.f_damage.bak_flag) {
            battle_selected()!.support_attack!.support_airatack!!.f_damage!.bak_flag!.forEach((flag, idx) => {
                show_air_damage[1][idx] ||= flag == 1;
            });
        }
        if (battle_selected().support_attack!.support_airatack!.f_damage.rai_flag) {
            battle_selected()!.support_attack!.support_airatack!!.f_damage!.rai_flag!.forEach((flag, idx) => {
                show_air_damage[1][idx] ||= flag == 1;
            });
        }
        return show_air_damage;
    });

    return (
        <Show when={show_support()}>
            <li>
                <details open={true}>
                    <summary>
                        Support Attack
                    </summary>
                    <ul class="pl-0">
                        <table class="table table-xs">
                            <thead>
                                <tr>
                                    <th>From</th>
                                    <th>HP</th>
                                    <th>To</th>
                                    <th>HP</th>
                                    <th>Attack</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Show when={battle_selected().support_attack!.support_hourai !== null}>
                                    <tr class="table_hover table_active rounded">
                                        <td>
                                            <div class="flex flex-col">
                                                <For each={deck_ship_id[battle_selected()!.support_attack!.support_hourai!.deck_id] ?? battle_selected()!.support_attack!.support_hourai!.ship_id}>
                                                    {(ship_id, idx) => (
                                                        <>
                                                            <Show when={idx() > 0}>
                                                                <div class="h-px"></div>
                                                            </Show>
                                                            <ShipNameComponent ship_id={ship_id}></ShipNameComponent>
                                                        </>
                                                    )}
                                                </For>
                                            </div>
                                        </td>
                                        <td>
                                            <div class="flex flex-col">
                                                <For each={(deck_ship_id[battle_selected()!.support_attack!.support_hourai!.deck_id] ?? battle_selected()!.support_attack!.support_hourai!.ship_id).filter((ship_id) => ship_id != -1)}>
                                                    {(ship_id) => (
                                                        <>
                                                            <SimpleHpBar v_now={() => ships.ships[ship_id].nowhp} v_max={() => ships.ships[ship_id].maxhp}></SimpleHpBar>
                                                        </>
                                                    )}
                                                </For>
                                            </div>
                                        </td>
                                        <td>
                                            <For each={battle_selected().enemy_ship_id}>
                                                {(ship_id, idx) => (
                                                    <>
                                                        <Show when={idx() > 0}>
                                                            <div class="h-px"></div>
                                                        </Show>
                                                        <div class="flex flex-nowrap">
                                                            <SimpleShipNameComponent ship_id={ship_id} ship_max_hp={battle_selected().e_hp_max![idx()]} ship_param={battle_selected().e_params![idx()]} ship_slot={battle_selected().e_slot![idx()]}></SimpleShipNameComponent>
                                                            <Show when={battle_selected().support_attack!.support_hourai!.protect_flag.some(flag => flag == true)}>
                                                                <IconShield class="h-5 w-5"></IconShield>
                                                            </Show>
                                                        </div>
                                                    </>
                                                )}
                                            </For>
                                        </td>
                                        <td>
                                            <For each={battle_selected().enemy_ship_id}>
                                                {(_, idx) => (
                                                    <>
                                                        <SimpleHpBar v_now={() => battle_selected().support_attack!.support_hourai!.now_hps![idx()]} v_max={() => battle_selected().e_hp_max![idx()]}></SimpleHpBar>
                                                    </>
                                                )}
                                            </For>
                                        </td>
                                        <td>
                                            <For each={battle_selected().enemy_ship_id}>
                                                {(_, idx) => (
                                                    <>
                                                        <Show when={idx() > 0}>
                                                            <div class="h-[4px]"></div>
                                                        </Show>
                                                        <div>{battle_selected().support_attack!.support_hourai!.damage[idx()]}</div>
                                                    </>
                                                )}
                                            </For>
                                        </td>
                                    </tr>
                                </Show>
                                <Show when={battle_selected().support_attack!.support_airatack !== null}>
                                    <Show when={(battle_selected().support_attack!.support_airatack!.f_damage!.plane_from ?? []).length > 0}>
                                        <tr class="table_hover table_active rounded">
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={battle_selected().support_attack!.support_airatack!.f_damage.plane_from}>
                                                        {(ship_idx, idx) => (
                                                            <>
                                                                <Show when={idx() > 0}>
                                                                    <div class="h-px"></div>
                                                                </Show>
                                                                <ShipNameComponent ship_id={deck_ship_id[battle_selected().support_attack!.support_airatack!.deck_id][ship_idx]}></ShipNameComponent>
                                                            </>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <div class="flex flex-col">
                                                    <For each={battle_selected().support_attack!.support_airatack!.f_damage.plane_from}>
                                                        {(ship_idx) => (
                                                            <>
                                                                <SimpleHpBar v_now={() => ships.ships[deck_ship_id[battle_selected().support_attack!.support_airatack!.deck_id][ship_idx]].nowhp} v_max={() => ships.ships[deck_ship_id[battle_selected().support_attack!.support_airatack!.deck_id][ship_idx]].maxhp}></SimpleHpBar>
                                                            </>
                                                        )}
                                                    </For>
                                                </div>
                                            </td>
                                            <td>
                                                <For each={battle_selected().support_attack!.support_airatack!.e_damage.damages}>
                                                    {(_, idx) => (
                                                        <>
                                                            <Show when={show_air_damage()[0][idx()]}>
                                                                <Show when={idx() > 0}>
                                                                    <div class="h-px"></div>
                                                                </Show>
                                                                <div class="flex flex-nowrap">
                                                                    <SimpleShipNameComponent ship_id={battle_selected().enemy_ship_id[idx()]} ship_slot={battle_selected().e_slot![idx()]} ship_param={battle_selected().e_params![idx()]} ship_max_hp={battle_selected().e_hp_max![idx()]}></SimpleShipNameComponent>
                                                                    <Show when={battle_selected().support_attack!.support_airatack!.e_damage.protect_flag?.some(flag => flag == true)}>
                                                                        <IconShield class="h-5 w-5"></IconShield>
                                                                    </Show>
                                                                </div>
                                                            </Show>
                                                        </>
                                                    )}
                                                </For>
                                            </td>
                                            <td>
                                                <For each={battle_selected().support_attack!.support_airatack!.e_damage.damages}>
                                                    {(_, idx) => (
                                                        <>
                                                            <Show when={show_air_damage()[0][idx()]}>
                                                                <SimpleHpBar v_now={() => battle_selected().support_attack!.support_airatack!.e_damage.now_hps[idx()]} v_max={() => battle_selected().e_hp_max![idx()]}></SimpleHpBar>
                                                            </Show>
                                                        </>
                                                    )}
                                                </For>
                                            </td>
                                            <td >
                                                <For each={battle_selected().support_attack!.support_airatack!.e_damage.damages}>
                                                    {(dmg, dmg_index) => (
                                                        <>
                                                            <Show when={show_air_damage()[0][dmg_index()]}>
                                                                <Show when={dmg_index() > 0}>
                                                                    <div class="h-[4px]"></div>
                                                                </Show>
                                                                <div class={
                                                                    (() => {
                                                                        let cl_flag = battle_selected().support_attack!.support_airatack!!.e_damage!.cl![dmg_index()] ?? 0;
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
                                </Show>
                            </tbody>
                        </table>
                    </ul>
                </details>
            </li>
        </Show>
    );
}