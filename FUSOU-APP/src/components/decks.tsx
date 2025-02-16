import { DeckComponent } from './deck';
import { useDeckPorts } from '../utility/provider';
import { createEffect, For } from 'solid-js';

import "../css/divider.css";

export function DecksComponent() {

    const fleet_name: {[key:number]: string} = {
        1: "First Fleet",
        2: "Second Fleet",
        3: "Third Fleet",
        4: "Fourth Fleet",
    }

    const [decks, ] =  useDeckPorts();

    createEffect(() => {
        console.log(decks.combined_flag);
    });

    return (
        <>
            <li>
                <details open={true}>
                    <summary>
                        Fleets
                    </summary>
                    <ul class="pl-0">
                        <For each={Object.entries(decks.deck_ports)} fallback={<div class="text-xs py-2">Loading Fleet Data ...</div>}>
                            {(item) => <><DeckComponent deck_id={Number(item[0])} fleet_name={fleet_name[Number(item[0])]}></DeckComponent></>}
                        </For>
                    </ul>
                </details>
            </li>
        </>
    );
}