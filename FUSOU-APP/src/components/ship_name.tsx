import { component$, useComputed$, Signal, useStylesScoped$ } from '@builder.io/qwik';

import { Ship, Ships } from './interface/port.ts';
import { MstShip, MstShips } from './interface/get_data';

import { HiXMarkOutline } from '@qwikest/icons/heroicons';

interface ShipNameProps {
    mst_ships: MstShips;
    ships: Ships;
    ship_id: number;
}

interface SpEffectItem {
    soukou: number;
    raisou: number;
    karyoku: number;
    kaihi: number;
}

export const ShipName = component$(({mst_ships, ships, ship_id}: ShipNameProps) => {

    useStylesScoped$(`
        .modal:not(dialog:not(.modal-open)), .modal::backdrop {
            background-color: #0001;
            animation: modal-pop 0.2s ease-out;
        }
        .modal:not(dialog:not(.modal-open)), .modal::backdrop {
            background-color: #0001;
            animation: modal-pop 0.2s ease-out;
        }
        .modal-box-width {
            width: calc(100vw - 3em);
        }
    `);

    const ship: Signal<Ship> = useComputed$(() => {
        return ships.ships[ship_id];
    });

    const mst_ship: Signal<MstShip> = useComputed$(() => {
        return mst_ships.mst_ships[ships.ships[ship_id]?.ship_id];
    });

    const max_eq: Signal<number> = useComputed$(() => {
        return mst_ships.mst_ships[ships.ships[ship_id]?.ship_id]?.maxeq.reduce((a, b) => a + b, 0);
    });

    const sp_effect_item: Signal<SpEffectItem> = useComputed$(() => {
        let parameter_map: SpEffectItem = {
            soukou: 0,
            raisou: 0,
            karyoku: 0,
            kaihi: 0
        };
        if (ships.ships[ship_id] === undefined) return parameter_map;
        if (ships.ships[ship_id].sp_effect_items === undefined) return parameter_map;
        if (ships.ships[ship_id].sp_effect_items === null) return parameter_map;

        for (const i of [1, 2]) {
            let sp_effect_item = ships.ships[ship_id].sp_effect_items.items[i];
            if (sp_effect_item) {
                parameter_map.soukou += sp_effect_item.souk ?? 0;
                parameter_map.raisou += sp_effect_item.raig ?? 0;
                parameter_map.karyoku += sp_effect_item.houg ?? 0;
                parameter_map.kaihi += sp_effect_item.kaih ?? 0;
            }
        }

        return parameter_map;
    });

    return <>
        <div class="flex flex-nowarp" onClick$={()=> { document.getElementById("deck_ship_name_modal_"+ship_id).showModal() }}>
            {mst_ship.value?.name ?? "Unknown"}
        </div>
        <dialog id={"deck_ship_name_modal_"+ship_id} class="modal">
            <div class="modal-box bg-base-100 modal-box-width">
                <form method="dialog">
                    <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">
                        <HiXMarkOutline class="h-6 w-6" />
                    </button>
                </form>
                <h3 class="font-bold text-base pl-3 truncate">{mst_ship.value?.name ?? "Unknown"}</h3>
                <div class="">
                    <table class="table table-sm">
                        <caption class="truncate">Ship Status</caption>
                        <tbody>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Durability</th>
                                <td class="flex-none w-12 flex justify-end pr-4">{ship.value?.maxhp ?? 0 }</td>
                                <th class="truncate flex-1 w-2">Firepower</th>
                                <td class="flex-none w-12 flex justify-end pr-4">
                                    <div class="indicator">
                                        <span class="indicator-item indicator-bottom text-accent text-xs">
                                            {sp_effect_item.value?.karyoku > 0 ? "+"+sp_effect_item.value?.karyoku : ""}
                                        </span>
                                        {ship.value?.karyoku[0] ?? 0 }
                                    </div>
                                </td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Armor</th>
                                <td class="flex-none w-12 flex justify-end pr-4">
                                    <div class="indicator">
                                        <span class="indicator-item indicator-bottom text-accent text-xs">
                                            {sp_effect_item.value?.soukou > 0 ? "+"+sp_effect_item.value?.soukou : ""}
                                        </span>
                                        {ship.value?.soukou[0] ?? 0 }
                                    </div>
                                </td>
                                <th class="truncate flex-1 w-2">Torpedo</th>
                                <td class="flex-none w-12 flex justify-end pr-4">
                                    <div class="indicator">
                                        <span class="indicator-item indicator-bottom text-accent text-xs">
                                            {sp_effect_item.value?.raisou > 0 ? "+"+sp_effect_item.value?.raisou : ""}
                                        </span>
                                        {ship.value?.raisou[0] ?? 0 }
                                    </div>
                                </td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Evasion</th>
                                <td class="flex-none w-12 flex justify-end pr-4">
                                    <div class="indicator">
                                        <span class="indicator-item indicator-bottom text-accent text-xs">
                                            {sp_effect_item.value?.kaihi > 0 ? "+"+sp_effect_item.value?.kaihi : ""}
                                        </span>
                                        {ship.value?.kaihi[0] ?? 0 }
                                    </div>
                                </td>
                                <th class="truncate flex-1 w-2">Anti-Air</th>
                                <td class="flex-none w-12 flex justify-end pr-4">{ship.value?.taiku[0] ?? 0 }</td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Aircraft installed</th>
                                <td class="flex-none w-12 flex justify-end pr-4">{max_eq ?? 0 > 0}</td>
                                <th class="truncate flex-1 w-2">Anti-Submarine</th>
                                <td class="flex-none w-12 flex justify-end pr-4">{ship.value?.taisen[0] ?? 0 }</td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Speed</th>
                                <td class="flex-none w-12 flex justify-end pr-4">{ship.value?.soku ?? 0}</td>
                                <th class="truncate flex-1 w-2">Reconnaissance</th>
                                <td class="flex-none w-12 flex justify-end pr-4">{ship.value?.sakuteki[0] ?? 0 }</td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Range</th>
                                <td class="flex-none w-12 flex justify-end pr-4">{ship.value?.leng ?? 0 }</td>
                                <th class="truncate flex-1 w-2">Luck</th>
                                <td class="flex-none w-12 flex justify-end pr-4">{ship.value?.lucky[0] ?? 0 }</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <form method="dialog" class="modal-backdrop">
                <button>close</button>
            </form>
        </dialog>
    </>;
});