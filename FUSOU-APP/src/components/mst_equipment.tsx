import { IconEquipment } from '../icons/equipment.tsx';

import { IconXMark } from '../icons/X-mark.tsx';
import { useMstSlotItems } from '../utility/provider.tsx';

import "../css/modal.css";
import { createSignal, Show } from 'solid-js';

interface EquipmentProps {
    equip_id: number;
    name_flag?: boolean;
    compact?: boolean;
    show_param?: boolean;
}

const show_modal = (slot_id: number) => {
    const dialogElement = document.getElementById("deck_equipment_modal_"+slot_id) as HTMLDialogElement | null
    dialogElement?.showModal()
}

export function MstEquipmentComponent({equip_id, name_flag, compact, show_param}: EquipmentProps) {

    const [mst_slot_items, ] = useMstSlotItems();
    const [show_dialog, set_show_dialog] = createSignal(false);
    
    const signed_number = (number: number): string => number != 0 ? (number >= 0 ? "+"+String(number) : String(number)) : "";

    return <>
        <div class="flex flex-nowarp w-full" onClick={()=> {set_show_dialog(true); show_modal(equip_id);}} >
            <IconEquipment class="h-5 w-5 -mt-0.5" category_number={mst_slot_items.mst_slot_items[equip_id]._type[1]} icon_number={mst_slot_items.mst_slot_items[equip_id]._type[3]}></IconEquipment>
            {(compact ?? true) ? <></>: (name_flag ? <div class="pl-3 truncate">{mst_slot_items.mst_slot_items[equip_id].name ?? "Unknown"}</div> : <div class="pl-3 truncate">Unknown</div>)}
            {/* <div class="pl-3 truncate">Unknown</div> */}
        </div>
        
        <Show when={show_dialog()}>
            <dialog id={"deck_equipment_modal_"+equip_id} class="modal">
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
                        <h3 class="font-bold text-base pl-3 truncate">{(name_flag ?? false) ? (mst_slot_items.mst_slot_items[equip_id].name ?? "Unknown") : "Unknown"}</h3>
                    </div>
                    <div class="pt-2">
                        <table class="table table-sm">
                            <caption class="truncate">Equipment Status</caption>
                            <tbody>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Firepower</th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].houg ?? 0) : "unknown"}</td>
                                    <th class="truncate flex-1 w-2">Torpedo </th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].raig ?? 0) : "unknown"}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Bomb</th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].baku ?? 0) : "unknown"}</td>
                                    <th class="truncate flex-1 w-2">Anti-Air</th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].tyku ?? 0) : "unknown"}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Anti-Submarine</th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].tais ?? 0) : "unknown"}</td>
                                    <th class="truncate flex-1 w-2">Reconnaissance</th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].saku ?? 0) : "unknown"}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Accuracy</th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].houm ?? 0) : "unknown"}</td>
                                    <th class="truncate flex-1 w-2">Evasion</th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].houk ?? 0) : "unknown"}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Armor</th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].souk ?? 0) : "unknown"}</td>
                                    <th class="truncate flex-1 w-2">Anti-Bomber</th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].taibaku ?? 0) : "unknown"}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Interception</th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].geigeki ?? 0) : "unknown"}</td>
                                    <th class="truncate flex-1 w-2">Distance</th>
                                    <td class="flex-none w-24">{(equip_id != 0 && (show_param ?? false)) ? signed_number(mst_slot_items.mst_slot_items[equip_id].distance ?? 0) : "unknown"}</td>
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