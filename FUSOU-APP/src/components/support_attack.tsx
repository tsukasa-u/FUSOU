import { ShipNameComponent } from './ship_name';

import { createMemo, For, Show } from 'solid-js';

import "../css/divider.css";
import { EnemyNameComponent } from './enemy_name';
import { Battle } from '../interface/battle';

interface AirDamageProps {
    deck_ship_id: { [key: number]: number[] };
    battle_selected: () => Battle;
}

export function SupportAttackComponent({deck_ship_id, battle_selected}: AirDamageProps) {
    const show_hourai = createMemo<boolean>(() => {
        if (battle_selected() == undefined) return false;
        if (battle_selected().deck_id == null) return false;
        if (battle_selected().support_attack == null) return false;
        return true;
    });

    return (
        <Show when={show_hourai()}>
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
                                    <th>To</th>
                                    <th>Attack</th>
                                </tr>
                            </thead>
                            <tbody>
                                <Show when={battle_selected().support_attack!.support_hourai !== null}>
                                    <tr>
                                        <td>
                                            <div class="flex flex-col">
                                                <For each={deck_ship_id[battle_selected()!.support_attack!.support_hourai!.deck_id ?? battle_selected()!.support_attack!.support_hourai!.ship_id]}>
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
                                            <For each={battle_selected().enemy_ship_id}>
                                                {(ship_id, idx) => (
                                                    <>
                                                        <Show when={idx() > 0}>
                                                            <div class="h-px"></div>
                                                        </Show>
                                                        <EnemyNameComponent ship_id={ship_id}></EnemyNameComponent>
                                                    </>
                                                )}
                                            </For>
                                        </td>
                                        <td >
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
                            </tbody>
                        </table>
                    </ul>
                </details>
            </li>
        </Show>
    );
}