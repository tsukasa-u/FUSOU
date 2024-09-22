import { Slot, component$, useStylesScoped$ } from '@builder.io/qwik';

import { Deck } from './deck';
import { DeckGrid } from './deck_grid';
import { DeckPorts, Ships } from './interface/port';
import { MstShips, MstSlotitems } from './interface/get_data';
import { SlotItems } from './interface/require_info';

interface DecksProps {
    decks: DeckPorts;
    ships: Ships;
    mst_ships: MstShips;
    slot_items: SlotItems;
    mst_slot_items: MstSlotitems;
}


export const Decks = component$<DecksProps>(({ decks, ships, mst_ships, slot_items, mst_slot_items }) => {

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
                        { Object.entries(decks.deck_ports).map(([key, deck]) => (
                            <>
                                <Deck deckPort={ deck } ships={ ships } mst_ships={ mst_ships } slot_items={ slot_items } mst_slot_items={ mst_slot_items }>
                                    <Slot name={`icon_fleet${key}`} />
                                </Deck>
                            </>
                        )) }
                        {/* <Deck deckPort={ decks.deck_ports[1] } ships={ ships } mst_ships={ mst_ships }>
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
                        </Deck> */}
                    </ul>
                </details>
            </li>
        </>
    );
});