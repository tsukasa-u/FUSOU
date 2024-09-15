import { Slot, component$, useComputed$, useStylesScoped$, useTask$ } from '@builder.io/qwik';

import { Deck } from './deck';
import { DeckPorts, Ships } from './interface/port';
import { MstShips } from './interface/get_data';

interface DecksProps {
    decks: DeckPorts;
    ships: Ships;
    mst_ships: MstShips;
}


export const Decks = component$<DecksProps>(({ decks, ships, mst_ships }) => {

    useStylesScoped$(`
        div::before, div::after {
          width: 1px;
        }
    `);
    
    return (
        <>
            <li>
                <details open>
                    <summary>
                        <Slot name="icon_fleets" />
                        Fleets
                    </summary>
                    <ul class="pl-0">
                        {/* { Object.values(decks.deck_ports).map((deck, idx) => (
                            <Deck deckPorts={ decks } ships={ ships } mst_ships={ mst_ships } idx={idx+1}>
                                <Slot name={`icon_fleet${idx}`} />
                            </Deck>
                        ))} */}
                        {/* { Object.entries(decks.deck_ports).map(([key, deck]) => (
                            // <>{deck.ship}</>
                            // <>{decks.deck_ports[Number(key)].ship}</>
                            <>
                                <>{deck.ship}</>
                                <Deck deckPort={ deck } ships={ ships } mst_ships={ mst_ships }>
                                    <Slot name={`icon_fleet${key}`} />
                                </Deck>
                            </>
                            // <Deck deckPorts={ decks } ships={ ships } mst_ships={ mst_ships } idx={Number(key)}>
                            //     <Slot name={`icon_fleet${key}`} />
                            // </Deck>
                        )) } */}
                        <Deck deckPort={ decks.deck_ports[1] } ships={ ships } mst_ships={ mst_ships }>
                            <Slot name="icon_fleet1" />
                        </Deck>
                        <Deck deckPort={ decks.deck_ports[2] } ships={ ships } mst_ships={ mst_ships }>
                            <Slot name="icon_fleet2" />
                        </Deck>
                        <Deck deckPort={ decks.deck_ports[3] } ships={ ships } mst_ships={ mst_ships }>
                            <Slot name="icon_fleet3" />
                        </Deck>
                        <Deck deckPort={ decks.deck_ports[4]} ships={ ships } mst_ships={ mst_ships }>
                            <Slot name="icon_fleet4" />
                        </Deck>
                    </ul>
                </details>
            </li>
        </>
    );
});