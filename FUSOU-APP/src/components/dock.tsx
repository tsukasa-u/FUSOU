import { Slot, component$, useStylesScoped$, useTask$ } from '@builder.io/qwik';

import { NDock, Ship } from "./interface/port.tsx";

interface NDockProps {
    nDock: NDock[];
    ships: { [key: string]: Ship };
}
 
export const Dock = component$<NDockProps>(({ nDock , ships}) => {

    useStylesScoped$(`
        div::before, div::after {
        //   background-color: red;
          width: 1px;
        }
    `);

    useTask$(() => {
        const interval = setInterval(() => {
            const now_date = Math.floor(Date.now());
            nDock.forEach((_, key) => {
                if (nDock[key].complete_time < now_date) {
                    nDock[key].counter = 0;
                } else {
                    nDock[key].counter = nDock[key].complete_time - now_date;
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
                        <Slot name="icon_dock" />
                        Dock
                    </summary>
                    <ul class="pl-0">
                        { nDock.map((_, key) => (
                            <li class="h-6">
                                <a class="justify-start gap-0">
                                    <div class="pl-2 pr-0.5 truncate flex-1 min-w-12">
                                        <div class="w-24">
                                            { nDock[key].ship_id != 0 ? ships[nDock[key].ship_id].ship_name ?? "Unknown" : "----" }
                                        </div>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                    <div class="w-auto">
                                        <span class="countdown font-mono text-2xs">
                                            <span style={{"--value":Math.floor(nDock[key].counter/3600)}}></span>:
                                            <span style={{"--value":Math.floor(nDock[key].counter/60)%60}}></span>:
                                            <span style={{"--value":Math.floor(nDock[key].counter)%60}}></span>
                                        </span>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                    <div>
                                        {nDock[key].ship_id == 0 ? "Empty" : (nDock[key].counter == 0 ? "Complete" : "Building")}
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