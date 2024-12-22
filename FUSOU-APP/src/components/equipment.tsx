import { IconEquipment } from '../icons/equipment.tsx';

import { IconXMark } from '../icons/X-mark.tsx';
import { useMstSlotItems, useSlotItems } from '../utility/provider.tsx';

import "../css/modal.css";
import { createMemo } from 'solid-js';

interface EquipmentProps {
    slot_id: number;
    ex_flag: boolean;
    name_flag: boolean;
    onslot?: number;
}

const show_modal = (slot_id: number) => {
    const dialogElement = document.getElementById("deck_equipment_modal_"+slot_id) as HTMLDialogElement | null
    dialogElement?.showModal()
}

export function EquimentComponent({slot_id, ex_flag, name_flag, onslot}: EquipmentProps) {

    const [_mst_slot_items, ] = useMstSlotItems();
    const [_slot_items, ] = useSlotItems();

    const slot_item = createMemo(() => {
        return _slot_items.slot_items[slot_id];
    });

    const mst_slot_item = createMemo(() => {
        return _mst_slot_items.mst_slot_items[_slot_items.slot_items[slot_id]?.slotitem_id];
    });

    const show_onslot = createMemo(() => {
        let type = _mst_slot_items.mst_slot_items[_slot_items.slot_items[slot_id]?.slotitem_id]._type[1];
        return type == 5 || type == 7 || type == 16 || type == 33 || type == 36 || type == 38 || type == 39 || type == 40 || type == 43 || type == 44;
    });

    return <>
        <div class="flex flex-nowarp" onClick={()=> show_modal(slot_id)} >
            <div class="indicator">
                {/* <span class="indicator-item badge badge-sm badge-outline">
                    {slot_item().level > 0 ? slot_item().level : "" }
                </span> */}
                <span class="indicator-item">
                    { slot_item()?.level ?? 0 > 0 ? 
                    <div class="badge badge-xs badge-ghost w-2 rounded grid place-content-center">
                        { slot_item().level === 10 ? "★" : slot_item().level }
                    </div> : "" }
                </span>
                <IconEquipment class="h-5 w-5" category_number={_mst_slot_items.mst_slot_items[_slot_items.slot_items[slot_id]?.slotitem_id]?._type[1]} icon_number={_mst_slot_items.mst_slot_items[_slot_items.slot_items[slot_id]?.slotitem_id]?._type[3]}></IconEquipment>
            </div>
            {
                !(ex_flag ?? false) ? <div class="flex-none">
                    <div class="grid h-2.5 w-4 place-content-center text-xs text-accent">
                        {slot_item()?.alv ?? 0 > 0 ? slot_item()?.alv ?? 0 : ""}
                    </div>
                    <div class="grid h-2.5 w-4 place-content-center text-xs">
                        {/* {slot_item()?.alv ?? 0} */}
                        {show_onslot() ? onslot : ""}
                    </div>
                </div> : <></>
            }
            {
                (name_flag ?? false) ? <div class="pl-3 pt-0.5">
                    <div class="truncate">{mst_slot_item()?.name ?? "Unknown"}</div>
                </div> : <></>
            }
        </div>
        <dialog id={"deck_equipment_modal_"+slot_id} class="modal">
            <div class="modal-box bg-base-100 modal-box-width">
                <form method="dialog">
                    <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">
                        <IconXMark class="h-6 w-6" />
                    </button>
                </form>
                <div class="flex justify-start">
                    <h3 class="font-bold text-base pl-3 truncate">{mst_slot_item()?.name ?? "Unknown"}</h3>
                    <div class="place-self-end pb pl-4 text-sm text-accent">{slot_item()?.level ?? 0 > 0 ? "+"+slot_item()?.level : ""}</div>
                </div>
                <div class="pt-2">
                    <table class="table table-sm">
                        <caption class="truncate">Equipment Status</caption>
                        <tbody>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Firepower</th>
                                <td class="flex-none w-12">{mst_slot_item()?.houg ?? 0 > 0 ? "+"+mst_slot_item().houg : ""}</td>
                                <th class="truncate flex-1 w-2">Torpedo </th>
                                <td class="flex-none w-12">{mst_slot_item()?.raig ?? 0 > 0 ? "+"+mst_slot_item().raig : ""}</td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Bomb</th>
                                <td class="flex-none w-12">{mst_slot_item()?.baku ?? 0 > 0 ? "+"+mst_slot_item().baku : ""}</td>
                                <th class="truncate flex-1 w-2">Anti-Air</th>
                                <td class="flex-none w-12">{mst_slot_item()?.tyku ?? 0 > 0 ? "+"+mst_slot_item().tyku :  ""}</td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Anti-Submarine</th>
                                <td class="flex-none w-12">{mst_slot_item()?.tais ?? 0 > 0 ? "+"+mst_slot_item().tais : ""}</td>
                                <th class="truncate flex-1 w-2">Reconnaissance</th>
                                <td class="flex-none w-12">{mst_slot_item()?.saku ?? 0 > 0 ? "+"+mst_slot_item().saku : ""}</td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Accuracy</th>
                                <td class="flex-none w-12">{mst_slot_item()?.houm ?? 0 > 0 ? "+"+mst_slot_item().houm : ""}</td>
                                <th class="truncate flex-1 w-2">Evasion</th>
                                <td class="flex-none w-12">{mst_slot_item()?.houk ?? 0 > 0 ? "+"+mst_slot_item().houk : ""}</td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Armor</th>
                                <td class="flex-none w-12">{mst_slot_item()?.taik ?? 0 > 0 ? "+"+mst_slot_item().taik : ""}</td>
                                <th class="truncate flex-1 w-2"></th>
                                <td class="flex-none w-12"></td>
                            </tr>
                            {/* <tr class="flex">
                                <th class="truncate flex-1 w-2">Range</th>
                                <td class="flex-none w-12">{mst_slot_item()?.leng ?? 0 > 0 ? "+"+mst_slot_item().leng : ""}</td>
                                <th class="truncate flex-1 w-2"></th>
                                <td class="flex-none w-12"></td>
                            </tr> */}
                        </tbody>
                    </table>
                </div>
            </div>
            <form method="dialog" class="modal-backdrop">
                <button>close</button>
            </form>
        </dialog>
    </>;
}