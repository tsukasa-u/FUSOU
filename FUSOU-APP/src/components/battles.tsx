import { useBattle, useDeckPorts, useMstShips, useShips } from '../utility/provider';
import { ShipNameComponent } from './ship_name';

import { createMemo, For } from 'solid-js';

import "../css/divider.css";

export function BattlesComponent() {

    const [battles, ] = useBattle();
    const [ships, ] = useShips();
    const [mst_ships, ] = useMstShips();
    const [deck_ports, ] = useDeckPorts();

    const deck_ship_id = createMemo<{[key: number]: number[]}>(() => {
        let deck_ship_id: {[key: number]: number[]} = {};
        for ( let j of Object.keys(deck_ports.deck_ports) ) {
            for ( let i of Object.keys(deck_ports.deck_ports[Number(j)].ship) ) {
                if (deck_ship_id[Number(j)] ?? -1 > 0) {
                    deck_ship_id[Number(j)].push(deck_ports.deck_ports[Number(j)].ship[Number(i)]);
                }
            }
            deck_ship_id[Number(j)] = deck_ports.deck_ports[Number(j)].ship;
        }
        return deck_ship_id;
    });

    return (
        <>
            <li>
                <details open={true}>
                    <summary>
                        Battles
                    </summary>
                    <ul class="pl-0">
                        
                        <li>
                            <details open={true}>
                                <summary>
                                    Opening Anti-submarine
                                </summary>
                                <ul class="pl-0">
                                    <table class="table table-xs">
                                        <thead>
                                            <tr>
                                                <th>From</th>
                                                <th>To</th>
                                                <th>Attack</th>
                                                <th>Type</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <For each={battles.opening_taisen.at_list}>
                                                {(at, index) => (
                                                    <tr>
                                                        <td><ShipNameComponent ship_id={deck_ship_id()[1][at]}></ShipNameComponent></td>
                                                        <td>{battles.opening_taisen.df_list[index()]}</td>
                                                        <td>{battles.opening_taisen.damage[index()]}</td>
                                                        <td>{battles.opening_taisen.at_type[index()]}</td>
                                                    </tr>
                                                )}
                                            </For>
                                            {/* <tr>
                                                <td>Cy Ganderton</td>
                                                <td>Quality  </td>
                                                <td>Blue</td>
                                            </tr>
                                            <tr>
                                                <td>Hart Hagerty</td>
                                                <td>Desktop  </td>
                                                <td>Purple</td>
                                            </tr>
                                            <tr>
                                                <td>Brice Swyre</td>
                                                <td>Tax </td>
                                                <td>Red</td>
                                            </tr> */}
                                        </tbody>
                                    </table>
                                    {/* <p>{ship_name()[1]}</p> */}
                                    {/* <p>
                                        {battles.opening_taisen.damage}
                                    </p>
                                    <p>
                                        {battles.opening_taisen.at_list}
                                    </p>
                                    <p>
                                        {battles.opening_taisen.at_type}
                                    </p>
                                    <p>
                                        {battles.opening_taisen.at_eflag}
                                    </p>
                                    <p>
                                        {battles.opening_taisen.df_list}
                                    </p>
                                    <p>
                                        {battles.opening_taisen.si_list}
                                    </p>
                                    <p>
                                        {battles.opening_taisen.cl_list}
                                    </p> */}
                                </ul>
                            </details>
                        </li>
                    </ul>
                </details>
            </li>
        </>
    );
}