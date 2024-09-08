import { Slot, component$, useStylesScoped$, useTask$ } from '@builder.io/qwik';
import { emit, listen } from '@tauri-apps/api/event'

import { Deck } from './deck';
import { DeckPort, Ship } from './interface/port';

interface DecksProps {
    decks: DeckPort[];
    ships: { [key: number]: Ship };
}


export const Decks = component$<DecksProps>(({ decks, ships }) => {
    

    useTask$(({ track, cleanup }) => {
        let unlisten: any;
        async function f() {
          unlisten = await listen('kcs-decks', event => {
            let payload = event.payload as DecksProps;
            console.log('kcs-decks', payload);
          });
        }
        f();
        cleanup(() => {
            if (unlisten) {
                unlisten();
            }
        });
    });

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
                    <Deck deckPort={ decks[0] } ships={ ships }>
                        <Slot name="icon_fleet1" />
                    </Deck>
                    <Deck deckPort={ decks[1] } ships={ ships }>
                        <Slot name="icon_fleet2" />
                    </Deck>
                    <Deck deckPort={ decks[2] } ships={ ships }>
                        <Slot name="icon_fleet3" />
                    </Deck>
                    <Deck deckPort={ decks[3]} ships={ ships }>
                        <Slot name="icon_fleet4" />
                    </Deck>
                    </ul>
                </details>
            </li>
        </>
    );
});