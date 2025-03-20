import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { SimpleShipNameComponent } from './simple_ship_name';
import { Battle } from '../interface/battle';
import { useDeckPorts, useShips } from '../utility/provider';
import { SimpleHpBar } from './simple_hp_bar';

interface ButtleSummaryProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

interface FleetInfo {
    f_main_ship_id: number[],
    f_main_nowhps: number[],
    f_main_maxhps: number[],
    f_main_damages: number[],
    f_escort_ship_id: number[],
    f_escort_nowhps: number[],
    f_escort_maxhps: number[],
    f_escort_damages: number[],
    e_main_ship_id: number[],
    e_main_nowhps: number[],
    e_main_maxhps: number[],
    e_main_damages: number[],
    e_main_prams: number[][],
    e_main_slot: number[][],
    e_escort_ship_id: number[],
    e_escort_nowhps: number[],
    e_escort_maxhps: number[],
    e_escort_damages: number[],
    e_escrot_params: number[][],
    e_escort_slot: number[][],
    friend_ship_id: number[],
    friend_nowhps: number[],
    friend_maxhps: number[],
    friend_damages: number[],
    friend_params: number[][],
    friend_slot: number[][],
}

function select_min(a: number[] | null, b: number[] | null): number[] {
    if (a == null) {
        if (b == null) return [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1];
        return b;
    };
    if (b == null) return a;

    let ret = [];
    for (let i = 0; i < a.length; i++) {
        ret.push(Math.min(a[i], b[i]));
    }
    if (!(ret.every((v, i) => v == a[i]) || ret.every((v, i) => v == b[i]))) {
        ret.map((_v, i) => {
            ret[i] = -1;
        });
    }
    return ret;
}

export function BattleSummaryComponent({deck_ship_id, battle_selected}: ButtleSummaryProps) {

    const [deck_ports, ] = useDeckPorts();
    const [ships, ] = useShips();
    
    const show_summary = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        return true;
    });

    const fleet_info = createMemo<FleetInfo>(() => {
        if (battle_selected() == undefined) return {
            f_main_ship_id: [],
            f_main_nowhps: [],
            f_main_maxhps: [],
            f_main_damages: [],
            f_escort_ship_id: [],
            f_escort_nowhps: [],
            f_escort_maxhps: [],
            f_escort_damages: [],
            e_main_ship_id: [],
            e_main_nowhps: [],
            e_main_maxhps: [],
            e_main_damages: [],
            e_main_prams: [[]],
            e_main_slot: [[]],
            e_escort_ship_id: [],
            e_escort_nowhps: [],
            e_escort_maxhps: [],
            e_escort_damages: [],
            e_escrot_params: [[]],
            e_escort_slot: [[]],
            friend_ship_id: [],
            friend_nowhps: [],
            friend_maxhps: [],
            friend_damages: [],
            friend_params: [[]],
            friend_slot: [[]],
        };

        // let f_now_hps: number[] = select_min(battle_selected().f_nowhps!, battle_selected().midngiht_f_nowhps!).map((v, i) => v - battle_selected().f_total_damages![i]).map((v) => Math.max(v, 0));
        // let e_now_hps: number[] = select_min(battle_selected().e_nowhps!, battle_selected().midngiht_e_nowhps!).map((v, i) => v - battle_selected().e_total_damages![i]).map((v) => Math.max(v, 0));

        let day_f_now_hps: number[] | null = battle_selected().f_nowhps !== null ? battle_selected().f_nowhps!.map((v, i) => v - battle_selected().f_total_damages![i]).map((v) => Math.max(v, 0)) : null;
        let day_e_now_hps: number[] | null = battle_selected().e_nowhps !== null ? battle_selected().e_nowhps!.map((v, i) => v - battle_selected().e_total_damages![i]).map((v) => Math.max(v, 0)) : null;
        let midnight_f_now_hps: number[] | null = battle_selected().midngiht_f_nowhps !== null ? battle_selected().midngiht_f_nowhps!.map((v, i) => v - battle_selected().midnight_f_total_damages![i]).map((v) => Math.max(v, 0)): null;
        let midnight_e_now_hps: number[] | null = battle_selected().midngiht_e_nowhps !== null ? battle_selected().midngiht_e_nowhps!.map((v, i) => v - battle_selected().midnight_e_total_damages![i]).map((v) => Math.max(v, 0)) : null;

        let f_now_hps: number[] = select_min(day_f_now_hps, midnight_f_now_hps);
        let e_now_hps: number[] = select_min(day_e_now_hps, midnight_e_now_hps);

        let f_main_ship_id: number[] = deck_ship_id[battle_selected().deck_id!].filter((ship_id) => ship_id != -1);
        let f_main_nowhps: number[] = f_now_hps!.slice(0, f_main_ship_id.length);
        let f_main_maxhps: number[] = deck_ship_id[battle_selected().deck_id!].slice(0, f_main_ship_id.length).map((ship_id) => ships.ships[ship_id].maxhp);
        let f_main_damages: number[] = (battle_selected().f_total_damages ?? [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]).slice(0, f_main_ship_id.length);

        let f_escort_ship_id: number[] = [];
        let f_escort_nowhps: number[] = [];
        let f_escort_maxhps: number[] = [];
        let f_escort_damages: number[] = [];

        let e_main_ship_id: number[] = battle_selected().enemy_ship_id.slice(0, 6);
        let e_main_nowhps: number[] = e_now_hps.slice(0, 6);
        let e_main_maxhps: number[] = (battle_selected().e_hp_max ?? []).slice(0, 6);
        let e_main_damages: number[] = (battle_selected().e_total_damages ?? [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]).slice(0, 6);
        let e_main_prams: number[][] = (battle_selected().e_params ?? []).slice(0, 6);
        let e_main_slot: number[][] = (battle_selected().e_slot ?? []).slice(0, 6);

        let e_escort_ship_id: number[] = battle_selected().enemy_ship_id.slice(6, 12);
        let e_escort_nowhps: number[] = e_now_hps.slice(6, 12);
        let e_escort_maxhps: number[] = (battle_selected().e_hp_max ?? []).slice(6, 12);
        let e_escort_damages: number[] = (battle_selected().e_total_damages ?? [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]).slice(6, 12);
        let e_escrot_params: number[][] = (battle_selected().e_params ?? []).slice(6, 12);
        let e_escort_slot: number[][] = (battle_selected().e_slot ?? []).slice(6, 12);

        let friend_ship_id: number[] = battle_selected().friendly_force_attack?.fleet_info.ship_id ?? [];
        let friend_nowhps: number[] = battle_selected().friendly_force_attack?.fleet_info.now_hps ?? [];
        let friend_maxhps: number[] = battle_selected().friendly_force_attack?.fleet_info.now_hps ?? [];
        let friend_damages: number[] = battle_selected().friend_total_damages ?? [];
        let friend_params: number[][] = battle_selected().friendly_force_attack?.fleet_info.params ?? [];
        let friend_slot: number[][] = battle_selected().friendly_force_attack?.fleet_info.slot ?? [];

        if (deck_ports.combined_flag) {
            f_escort_ship_id = deck_ship_id[battle_selected().deck_id ?? 1].slice(0, 6);
            f_main_nowhps = f_now_hps.slice(0, 6);
            f_main_maxhps = deck_ship_id[battle_selected().deck_id!].map((ship_id) => ships.ships[ship_id].maxhp).slice(0, 6);
            f_main_damages = (battle_selected().f_total_damages ?? [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]).slice(0, 6);
            f_escort_ship_id = deck_ship_id[battle_selected().deck_id!].slice(6, 12);
            f_escort_nowhps = f_now_hps.slice(6, 12);
            f_escort_maxhps = deck_ship_id[battle_selected().deck_id!].map((ship_id) => ships.ships[ship_id].maxhp).slice(6, 12);
            f_escort_damages = (battle_selected().f_total_damages ?? [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]).slice(6, 12);
        }

        return {
            f_main_ship_id: f_main_ship_id,
            f_main_nowhps: f_main_nowhps,
            f_main_maxhps: f_main_maxhps,
            f_main_damages: f_main_damages,
            f_escort_ship_id: f_escort_ship_id,
            f_escort_nowhps: f_escort_nowhps,
            f_escort_maxhps: f_escort_maxhps,
            f_escort_damages: f_escort_damages,
            e_main_ship_id: e_main_ship_id,
            e_main_nowhps: e_main_nowhps,
            e_main_maxhps: e_main_maxhps,
            e_main_damages: e_main_damages,
            e_main_prams: e_main_prams,
            e_main_slot: e_main_slot,
            e_escort_ship_id: e_escort_ship_id,
            e_escort_nowhps: e_escort_nowhps,
            e_escort_maxhps: e_escort_maxhps,
            e_escort_damages: e_escort_damages,
            e_escrot_params: e_escrot_params,
            e_escort_slot: e_escort_slot,
            friend_ship_id: friend_ship_id,
            friend_nowhps: friend_nowhps,
            friend_maxhps: friend_maxhps,
            friend_damages: friend_damages,
            friend_params: friend_params,
            friend_slot: friend_slot,
        };
        // return {
        //     f_main_ship_id: [],
        //     f_main_nowhps: [],
        //     f_main_maxhps: [],
        //     f_main_damages: [],
        //     f_escort_ship_id: [],
        //     f_escort_nowhps: [],
        //     f_escort_maxhps: [],
        //     f_escort_damages: [],
        //     e_main_ship_id: [],
        //     e_main_nowhps: [],
        //     e_main_maxhps: [],
        //     e_main_damages: [],
        //     e_main_prams: [[]],
        //     e_main_slot: [[]],
        //     e_escort_ship_id: [],
        //     e_escort_nowhps: [],
        //     e_escort_maxhps: [],
        //     e_escort_damages: [],
        //     e_escrot_params: [[]],
        //     e_escort_slot: [[]],
        //     friend_ship_id: [],
        //     friend_nowhps: [],
        //     friend_maxhps: [],
        //     friend_damages: [],
        //     friend_params: [[]],
        //     friend_slot: [[]],
        // };
    });

    return (
        <Show when={show_summary()}>
            <li>
                <details open={true}>
                    <summary>
                        Summary
                    </summary>
                    <ul class="pl-0">
                        <table class="table table-xs">
                            <thead>
                                <tr>
                                    <th>Own Main</th>
                                    <th>HP</th>
                                    <th>damage</th>
                                    <th>Enemy Main</th>
                                    <th>HP</th>
                                    <th>damage</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={[0, 1, 2, 3, 4, 5, 6].slice(0, Math.max(fleet_info().f_main_ship_id.length, fleet_info().e_main_ship_id.length))}>
                                    {(idx) => 
                                        <tr class="table_hover table_active rounded">
                                            <Show when={fleet_info().f_main_ship_id.length > idx} fallback={<><td><div class="h-5"></div></td><td></td><td></td></>}>
                                                {/* <td>{idx}</td><td></td><td></td> */}
                                                <td>
                                                    <ShipNameComponent ship_id={fleet_info().f_main_ship_id[idx]}></ShipNameComponent>
                                                </td>
                                                <td>
                                                    <div class="flex-none">
                                                        <SimpleHpBar v_now={() => fleet_info().f_main_nowhps[idx]} v_max={() => fleet_info().f_main_maxhps[idx]}></SimpleHpBar>
                                                    </div>
                                                </td>
                                                <td>
                                                    {fleet_info().f_main_damages[idx]}
                                                </td>
                                            </Show>
                                            <Show when={fleet_info().e_main_ship_id.length > idx} fallback={<><td><div class="h-5"></div></td><td></td><td></td></>}>
                                                <td>
                                                    <SimpleShipNameComponent ship_id={fleet_info().e_main_ship_id[idx]} ship_param={fleet_info().e_main_prams[idx]} ship_slot={fleet_info().e_main_slot[idx]} ship_max_hp={fleet_info().e_main_maxhps[idx]}></SimpleShipNameComponent>
                                                </td>
                                                <td>
                                                    <div class="flex-none">
                                                        <SimpleHpBar v_now={() => fleet_info().e_main_nowhps[idx]} v_max={() => fleet_info().e_main_maxhps[idx]}></SimpleHpBar>
                                                    </div>
                                                </td>
                                                <td>
                                                    {fleet_info().e_main_damages[idx]}
                                                </td>
                                            </Show>
                                        </tr>
                                    }
                                </For>
                                {/* <Show when={fleet_info().e_escort_ship_id.length > 0 || fleet_info().f_escort_ship_id.length > 0}> */}
                                    <For each={[0, 1, 2, 3, 4, 5].slice(0, Math.max(fleet_info().f_escort_ship_id.length, fleet_info().e_escort_ship_id.length))}>
                                        {(idx) => 
                                            <tr class="table_hover table_active rounded">
                                                <Show when={fleet_info().f_escort_ship_id.length > idx} fallback={<><td></td><td></td><td></td></>}>
                                                    <td>
                                                        <ShipNameComponent ship_id={fleet_info().f_escort_ship_id[idx]}></ShipNameComponent>
                                                    </td>
                                                    <td>
                                                        <div class="flex-none">
                                                            <SimpleHpBar v_now={() => fleet_info().f_escort_nowhps[idx]} v_max={() => fleet_info().f_escort_maxhps[idx]}></SimpleHpBar>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {fleet_info().f_escort_damages[idx]}
                                                    </td>
                                                </Show>
                                                <Show when={fleet_info().e_escort_ship_id.length > idx} fallback={<><td></td><td></td><td></td></>}>
                                                    <td>
                                                        <SimpleShipNameComponent ship_id={fleet_info().e_escort_ship_id[idx]} ship_param={fleet_info().e_escrot_params[idx]} ship_slot={fleet_info().e_escort_slot[idx]} ship_max_hp={fleet_info().e_escort_maxhps[idx]}></SimpleShipNameComponent>
                                                    </td>
                                                    <td>
                                                        <div class="flex-none">
                                                            <SimpleHpBar v_now={() => fleet_info().e_escort_nowhps[idx]} v_max={() => fleet_info().e_escort_maxhps[idx]}></SimpleHpBar>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {fleet_info().e_escort_damages[idx]}
                                                    </td>
                                                </Show>
                                            </tr>
                                        }
                                    </For>
                                {/* </Show> */}
                                <Show when={battle_selected().friendly_force_attack != null}>
                                    <For each={[0, 1, 2, 3, 4, 5]}>
                                        {(idx) =>
                                            <tr class="table_hover table_active rounded">
                                                <Show when={fleet_info().friend_ship_id.length > idx} fallback={<><td></td><td></td><td></td></>}>
                                                    <td>
                                                        <SimpleShipNameComponent ship_id={fleet_info().friend_ship_id[idx]} ship_param={fleet_info().friend_params[idx]} ship_slot={fleet_info().friend_slot[idx]} ship_max_hp={fleet_info().friend_maxhps[idx]} display={true}></SimpleShipNameComponent>
                                                    </td>
                                                    <td>
                                                        <div class="flex-none">
                                                            <SimpleHpBar v_now={() => fleet_info().friend_nowhps[idx]} v_max={() => fleet_info().friend_maxhps[idx]}></SimpleHpBar>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {fleet_info().friend_damages[idx]}
                                                    </td>
                                                    <td></td>
                                                    <td></td>
                                                    <td></td>
                                                </Show>
                                            </tr>
                                        }
                                    </For>
                                </Show>
                            </tbody>
                        </table>
                    </ul>
                </details>
            </li>
        </Show>
    );
}