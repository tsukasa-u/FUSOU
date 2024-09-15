import { Slot, component$, useStylesScoped$, useTask$ } from '@builder.io/qwik';

import { DeckPorts } from "./interface/port.tsx";

interface ExpeditionProps {
    deckPort: DeckPorts;
}
 
export const Expedition = component$<ExpeditionProps>(({ deckPort }) => {
    
    const fleet_name: {[key:number]:string} = {
        1: "First Fleet",
        2: "Second Fleet",
        3: "Third Fleet",
        4: "Fourth Fleet",
    }

    useStylesScoped$(`
        div::before, div::after {
        //   background-color: red;
          width: 1px;
        }
    `);

    useTask$(() => {
        const interval = setInterval(() => {
            const now_date = Math.floor(Date.now());
            deckPort.deck_ports.forEach((_, key) => {
                if (deckPort.deck_ports[key].mission.complete_time < now_date) {
                    deckPort.deck_ports[key].mission.counter = 0;
                } else {
                    deckPort.deck_ports[key].mission.counter = deckPort.deck_ports[key].mission.complete_time - now_date;
                }
            });
        }, 1000);
        return () => clearInterval(interval);
    });
    
    return (
        <>
            <li>
                <details open>
                    <summary>
                        <Slot name="icon_expedition" />
                        Expedition
                    </summary>
                    <ul class="pl-0">
                        { deckPort.deck_ports.map((_, key) => (
                            <li class="h-6">
                                <a class="justify-start gap-0">
                                    <div class="pl-2 pr-0.5 truncate flex-1 min-w-12">
                                        <div class="w-24">
                                            { fleet_name[deckPort.deck_ports[key].id] ?? "Unknown" }
                                        </div>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                    <div class="w-auto">
                                        <span class="countdown font-mono text-2xs">
                                            <span style={{"--value":Math.floor(deckPort.deck_ports[key].mission.counter/3600)}}></span>:
                                            <span style={{"--value":Math.floor(deckPort.deck_ports[key].mission.counter/60)%60}}></span>:
                                            <span style={{"--value":Math.floor(deckPort.deck_ports[key].mission.counter)%60}}></span>
                                        </span>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                    <div>
                                        {deckPort.deck_ports[key].mission.mission_id == 0 ? "Anchorage" : (deckPort.deck_ports[key].mission.counter == 0 ? "Complete" : "expedition")}
                                    </div>
                                </a>
                            </li>
                        )) }
                    </ul>
                </details>
            </li>
        </>
    );
});