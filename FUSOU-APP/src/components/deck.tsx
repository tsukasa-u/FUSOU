import { Slot, component$, useStylesScoped$, useTask$ } from '@builder.io/qwik';

import { DeckPort, Ship } from "./interface/port.tsx";

interface DeckPortProps {
    deckPort: DeckPort;
    ships: { [key: number]: Ship };
}
 
export const Deck = component$<DeckPortProps>(({ deckPort, ships }) => {

    const fleet_name: {[key:number]:string} = {
        1: "First Fleet",
        2: "Second Fleet",
        3: "Third Fleet",
        4: "Fourth Fleet",
    }

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
                        <Slot name="icon_fleet" />
                        { fleet_name[deckPort.id] ?? "Unknown" }
                        <div class="form-control">
                            <label class="label cursor-pointer h-4 justify-end">
                                <span class="label-text mb-1.5 pr-2 h-4">more</span>
                                <input type="checkbox" class="toggle toggle-xs h-4  border-gray-400 [--tglbg:theme(colors.gray.200)] checked:border-blue-200 checked:bg-blue-300 checked:[--tglbg:theme(colors.blue.100)] rounded-sm" defaultChecked />
                            </label>
                        </div>
                    </summary>
                    <ul class="pl-0">
                        {deckPort.ship?.map((shipId) => (
                            <li class="h-6">
                                <a class="justify-start gap-0">
                                    <Slot name="icon_ship" />
                                    <div class="pl-2 pr-0.5 truncate flex-1 min-w-12">
                                        <div class="w-24">
                                        { shipId != 0 ? ships[shipId].ship_name ?? "Unknown" : "----" }
                                        </div>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                    <div class=" flex-none">
                                        <div class="flex justify-center w-8">
                                            <div class="badge badge-md bg-yellow-300 rounded-full border-inherit w-9">
                                                { ships[shipId].cond ?? 0 }
                                            </div>
                                        </div>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                    <div class=" flex-none">
                                        <div class="grid h-2.5 w-12 place-content-center">
                                            <div class="grid grid-flow-col auto-cols-max gap-1">
                                                <div>{ ships[shipId].nowhp ?? 0 }</div>
                                                <div>/</div>
                                                <div>{ ships[shipId].maxhp ?? 0 }</div>
                                            </div>
                                        </div>
                                        <div class="grid h-2.5 w-12 place-content-center">
                                            <progress class="progress progress-success w-12 h-1" value={(ships[shipId].nowhp ?? 0)*100/((ships[shipId].maxhp ?? 0) + 1e-3) } max="100"></progress>
                                        </div>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                    <div class=" flex-none">
                                        <div class="grid h-2.5 w-6 place-content-center">
                                            <progress class="progress progress-success w-6 h-1" value={(ships[shipId].fuel ?? 0)*100/((ships[shipId].max_fuel ?? 0) + 1e-3)} max="100"></progress>
                                        </div>
                                        <div class="grid h-2.5 w-6 place-content-center">
                                            <progress class="progress progress-success w-6 h-1" value={(ships[shipId].bull ?? 0)*100/((ships[shipId].max_bull ?? 0) + 1e-3)} max="100"></progress>
                                        </div>
                                    </div>
                                </a>
                            </li>
                        ))}
                    </ul>
                </details>
            </li>
        </>
    );
});