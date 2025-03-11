import { IconXMark } from '../icons/X-mark.tsx';

import '../css/modal.css';
import { useMstShips } from '../utility/provider.tsx';
import { createMemo, createSignal, For, Show } from 'solid-js';
import IconShip from '../icons/ship.tsx';
import { MstEquipmentComponent } from './mst_equipment.tsx';

interface ShipNameProps {
    ship_id: number;
    ship_param: number[] | null;
    ship_slot: number[] | null;
    ship_max_hp: number;
    display?: boolean | null;
}
   
const show_modal = (ship_id: number) => {
    const dialogElement = document.getElementById("deck_ship_name_modal_"+ship_id) as HTMLDialogElement | null
    dialogElement?.showModal()
}

export function SimpleShipNameComponent({ship_id, ship_param, ship_slot, ship_max_hp, display}: ShipNameProps) {

    if (display === false) {
        // need to replace the currect code
        // this is a dummy code for pass the build
        return <></>;
    }

    const [_mst_ships, ] = useMstShips();

    const mst_ship = createMemo(() => {
        return _mst_ships.mst_ships[ship_id];
    });

    const [show_dialog, set_show_dialog] = createSignal(false);

    return <>
        <div class="flex flex-nowarp w-full" onClick={()=> {set_show_dialog(true); show_modal(ship_id);}}>
            <div>
                <IconShip class="h-5 -mt-0.5 pr-2" ship_stype={mst_ship().stype ?? 0} color={mst_ship().yomi}/>
            </div>
            <div class="truncate">
                {mst_ship()?.name ?? "Unknown"}
            </div>
        </div>
        <Show when={show_dialog()}>
            <dialog id={"deck_ship_name_modal_"+ship_id} class="modal">
                <div class="modal-box bg-base-100 modal-box-width">
                    <form method="dialog">
                        <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onClick={() => {
                            let sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                            (async () => {
                                await sleep(10);
                                set_show_dialog(false);
                            })();
                        }}>
                            <IconXMark class="h-6 w-6" />
                        </button>
                    </form>
                    <div class="flex justify-start">
                        <h3 class="font-bold text-base pl-2 truncate">{mst_ship()?.name ?? "Unknown"}</h3>
                    </div>
                    <div class="pt-2">
                        <table class="table table-xs">
                            <caption class="truncate">Equipment</caption>
                            <tbody>
                                <For each={ship_slot} fallback={<></>}>
                                    {(slot_ele, index) => {
                                        return <>
                                            <tr class="flex table_active table_hover rounded rounded items-center w-full">
                                                <th class="flex-none w-4">S{index()+1}</th>
                                                <td class="flex-none w-12 pl-4 h-7 mt-1 w-full">
                                                    <Show when={slot_ele > 0}>
                                                        <MstEquipmentComponent equip_id={slot_ele} name_flag={false} compact={false}></MstEquipmentComponent>
                                                    </Show>
                                                </td>
                                            </tr>
                                        </>
                                    }}
                                </For>
                            </tbody>
                        </table>
                        <div class="h-2"></div>
                        <table class="table table-xs">
                            <caption class="truncate">Ship Status</caption>
                            <tbody>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Durability</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">{ship_max_hp ?? ""}</td>
                                    <th class="truncate flex-1 w-2">Fire Power</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">{ship_param !== null ? ship_param![0] ?? 0 : ""}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Armor</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">{ship_param !== null ? ship_param![3] ?? 0 : ""}</td>
                                    <th class="truncate flex-1 w-2">Torpedo</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">{ship_param !== null ? ship_param![1] ?? 0 : ""}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Evasion</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                                    <th class="truncate flex-1 w-2">Anti-Air</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">{ship_param !== null ? ship_param![2] ?? 0 : ""}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Aircraft installed</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                                    <th class="truncate flex-1 w-2">Anti-Submarine</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Speed</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                                    <th class="truncate flex-1 w-2">Reconnaissance</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Range</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                                    <th class="truncate flex-1 w-2">Luck</th>
                                    <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <form method="dialog" class="modal-backdrop">
                    <button onClick={() => {
                        let sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                        (async () => {
                            await sleep(10);
                            set_show_dialog(false);
                        })();
                    }}>close</button>
                </form>
            </dialog>
        </Show>
    </>;
}