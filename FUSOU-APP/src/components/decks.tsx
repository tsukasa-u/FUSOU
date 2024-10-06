import { DeckComponent } from './deck';
import { useDeckPorts } from '../utility/provider';
import { For } from 'solid-js';

import "../css/divider.css";

export function DecksComponent() {


    const [decks, ] =  useDeckPorts();

    return (
        <>
            <li>
                <details open>
                    <summary>
                        Fleets
                    </summary>
                    <ul class="pl-0">
                        <For each={Object.entries(decks.deck_ports)} fallback={<div>Loading Fleet Data ...</div>}>
                            {(item) => <>{<DeckComponent deck_id={Number(item[0])}></DeckComponent>}</>}
                        </For>
                    </ul>
                </details>
            </li>
        </>
    );
}