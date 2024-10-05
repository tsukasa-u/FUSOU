import { DeckComponent } from './deck';
import { DeckPorts, Ships } from '../interface/port';
import { MstShips, MstSlotitems } from '../interface/get_data';
import { SlotItems } from '../interface/require_info';
import { MstShipsProvider, ShipsProvider, useDeckPorts } from '../utility/provider';
import { createComponent, createMemo, For, Index } from 'solid-js';


export function DecksComponent() {

    // useStylesScoped$(`
    //     div::before, div::after {
    //       width: 1px;
    //     }
    // `);


    const [decks, ] =  useDeckPorts();
    
    const deck_ports_length = createMemo(() => {
        return Object.entries(decks.deck_ports).length;
    });

    const deck_memo = createMemo(() => {
        console.log(decks.deck_ports);
        return(
            <For each={Object.entries(decks.deck_ports)} fallback={<div>Loading Fleet Data ...</div>}>
                {/* {(item) => <div>{item[0]}</div>} */}
                {(item) => <div>{<DeckComponent deck_id={Number(item[0])}></DeckComponent>}</div>}
            </For>
        );
    });

    return (
        <>
            <li>
                <details open>
                    <summary onClick={() => console.log(decks.deck_ports)}>
                        Fleets
                        {deck_ports_length()}
                    </summary>
                    <ul class="pl-0">
                        {deck_ports_length() > 0 ?
                        <>
                            {deck_memo()}
                        </>
                            : <div>Loading Fleet Data ...</div>
                        }
                            {/* <For each={Object.entries(decks.deck_ports)} fallback={<div>Loading Fleet Data ...</div>}>
                                {(item) => <>{<DeckComponent deck_id={Number(item[0])}></DeckComponent>}</>}
                            </For> */}
                    </ul>
                </details>
            </li>
        </>
    );
}