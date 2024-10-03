import { component$, useComputed$, Signal, useStylesScoped$, useContext } from '@builder.io/qwik';

import { MstSlotitem, MstSlotitems } from './interface/get_data';
import { SlotItem, SlotItems } from './interface/require_info';

import { IconEquipment } from './icons/equipment.tsx';

import { HiXMarkOutline } from '@qwikest/icons/heroicons';
import { global_mst_slot_items_context_id, global_slot_items_context_id } from '../app.tsx';

interface EquipmentProps {
    slot_id: number;
    ex_flag: boolean;
    name_flag: boolean;
}

const show_modal = (slot_id: number) => {
    const dialogElement = document.getElementById("deck_equipment_modal_"+slot_id) as HTMLDialogElement | null
    dialogElement?.showModal()
}

export const Equiment = component$(({slot_id, ex_flag, name_flag}: EquipmentProps) => {

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

    const _mst_slot_items = useContext(global_mst_slot_items_context_id);
    const _slot_items = useContext(global_slot_items_context_id);

    const slot_item: Signal<SlotItem> = useComputed$(() => {
        return _slot_items.slot_items[slot_id];
    });

    const mst_slot_item: Signal<MstSlotitem> = useComputed$(() => {
        return _mst_slot_items.mst_slot_items[_slot_items.slot_items[slot_id]?.slotitem_id];
    });

    return <>
        <div class="flex flex-nowarp" onClick$={()=> show_modal(slot_id)} >
            <div class="indicator">
                {/* <span class="indicator-item badge badge-sm badge-outline">
                    {slot_item.value.level > 0 ? slot_item.value.level : "" }
                </span> */}
                <span class="indicator-item">
                    { slot_item.value?.level ?? 0 > 0 ? 
                    <div class="badge badge-xs badge-ghost w-2 rounded grid place-content-center">
                        { slot_item.value.level === 10 ? "★" : slot_item.value.level }
                    </div> : "" }
                </span>
                <IconEquipment class="h-5 w-5" category_number={_mst_slot_items.mst_slot_items[_slot_items.slot_items[slot_id]?.slotitem_id]?._type[1]} icon_number={_mst_slot_items.mst_slot_items[_slot_items.slot_items[slot_id]?.slotitem_id]?._type[3]}></IconEquipment>
            </div>
            {
                !(ex_flag ?? false) ? <div class="flex-none">
                    <div class="grid h-2.5 w-4 place-content-center text-xs text-accent">
                        {slot_item.value?.alv ?? 0 > 0 ? slot_item.value?.alv ?? 0 : ""}
                    </div>
                    <div class="grid h-2.5 w-4 place-content-center text-xs">
                        {/* {slot_item.value?.alv ?? 0} */}
                    </div>
                </div> : <></>
            }
            {
                (name_flag ?? false) ? <div class="pl-3 pt-0.5">
                    <div class="truncate">{mst_slot_item.value?.name ?? "Unknown"}</div>
                </div> : <></>
            }
        </div>
        <dialog id={"deck_equipment_modal_"+slot_id} class="modal">
            <div class="modal-box bg-base-100 modal-box-width">
                <form method="dialog">
                    <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">
                        <HiXMarkOutline class="h-6 w-6" />
                    </button>
                </form>
                <div class="flex justify-start">
                    <h3 class="font-bold text-base pl-3 truncate">{mst_slot_item.value?.name ?? "Unknown"}</h3>
                    <div class="place-self-end pb pl-4 text-sm text-accent">{slot_item.value?.level ?? 0 > 0 ? "+"+slot_item.value?.level : ""}</div>
                </div>
                <div class="pt-2">
                    <table class="table table-sm">
                        <caption class="truncate">Equipment Status</caption>
                        <tbody>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Firepower</th>
                                <td class="flex-none w-12">{mst_slot_item.value?.houg ?? 0 > 0 ? "+"+mst_slot_item.value.houg : ""}</td>
                                <th class="truncate flex-1 w-2">Torpedo </th>
                                <td class="flex-none w-12">{mst_slot_item.value?.raig ?? 0 > 0 ? "+"+mst_slot_item.value.raig : ""}</td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Bomb</th>
                                <td class="flex-none w-12">{mst_slot_item.value?.baku ?? 0 > 0 ? "+"+mst_slot_item.value.baku : ""}</td>
                                <th class="truncate flex-1 w-2">Anti-Air</th>
                                <td class="flex-none w-12">{mst_slot_item.value?.tyku ?? 0 > 0 ? "+"+mst_slot_item.value.tyku :  ""}</td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Anti-Submarine</th>
                                <td class="flex-none w-12">{mst_slot_item.value?.tais ?? 0 > 0 ? "+"+mst_slot_item.value.tais : ""}</td>
                                <th class="truncate flex-1 w-2">Reconnaissance</th>
                                <td class="flex-none w-12">{mst_slot_item.value?.saku ?? 0 > 0 ? "+"+mst_slot_item.value.saku : ""}</td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Accuracy</th>
                                <td class="flex-none w-12">{mst_slot_item.value?.houm ?? 0 > 0 ? "+"+mst_slot_item.value.houm : ""}</td>
                                <th class="truncate flex-1 w-2">Evasion</th>
                                <td class="flex-none w-12">{mst_slot_item.value?.houk ?? 0 > 0 ? "+"+mst_slot_item.value.houk : ""}</td>
                            </tr>
                            <tr class="flex">
                                <th class="truncate flex-1 w-2">Armor</th>
                                <td class="flex-none w-12">{mst_slot_item.value?.taik ?? 0 > 0 ? "+"+mst_slot_item.value.taik : ""}</td>
                                <th class="truncate flex-1 w-2"></th>
                                <td class="flex-none w-12"></td>
                            </tr>
                            {/* <tr class="flex">
                                <th class="truncate flex-1 w-2">Range</th>
                                <td class="flex-none w-12">{mst_slot_item.value?.leng ?? 0 > 0 ? "+"+mst_slot_item.value.leng : ""}</td>
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
});