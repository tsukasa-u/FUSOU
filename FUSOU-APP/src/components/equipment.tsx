import { IconEquipment } from '../icons/equipment.tsx';

import { IconXMark } from '../icons/X-mark.tsx';
import { useMstSlotItems, useSlotItems } from '../utility/provider.tsx';

import "../css/modal.css";
import { createMemo, createSignal, JSX, Show } from 'solid-js';
import IconPlaneProficiency1 from '../icons/plane_proficiency1.tsx';
import IconPlaneProficiency2 from '../icons/plane_proficiency2.tsx';
import IconPlaneProficiency3 from '../icons/plane_proficiency3.tsx';
import IconPlaneProficiency4 from '../icons/plane_proficiency4.tsx';
import IconPlaneProficiency5 from '../icons/plane_proficiency5.tsx';
import IconPlaneProficiency6 from '../icons/plane_proficiency6.tsx';
import IconPlaneProficiency7 from '../icons/plane_proficiency7.tsx';

interface EquipmentProps {
    slot_id: number;
    ex_flag?: boolean;
    name_flag?: boolean;
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

    const show_onslot = createMemo<Boolean>(() => {
        let type = _mst_slot_items.mst_slot_items[_slot_items.slot_items[slot_id]?.slotitem_id]._type[1];
        return type == 5 || type == 7 || type == 16 || type == 33 || type == 36 || type == 38 || type == 39 || type == 40 || type == 43 || type == 44;
    });

    const proficiency = createMemo<JSX.Element>(() => {
        let proficiency: JSX.Element = <div class="h-2 w-2"></div>;
        if (slot_item()?.alv == 1)      proficiency = <IconPlaneProficiency1 class="h-2 w-2" />;
        else if (slot_item()?.alv == 2) proficiency = <IconPlaneProficiency2 class="h-2 w-2" />;
        else if (slot_item()?.alv == 3) proficiency = <IconPlaneProficiency3 class="h-2 w-2" />;
        else if (slot_item()?.alv == 4) proficiency = <IconPlaneProficiency4 class="h-2 w-2" />;
        else if (slot_item()?.alv == 5) proficiency = <IconPlaneProficiency5 class="h-2 w-2" />;
        else if (slot_item()?.alv == 6) proficiency = <IconPlaneProficiency6 class="h-2 w-2" />;
        else if (slot_item()?.alv == 7) proficiency = <IconPlaneProficiency7 class="h-2 w-2" />;
        return proficiency;
    });
    
    const [show_dialog, set_show_dialog] = createSignal(false);

    const display_tooltip = () => {
        let tooltip_data = {
            "item_id": _slot_items.slot_items[slot_id]?.id,
            "id": mst_slot_item()?.id,
            "type": mst_slot_item()?._type.toString(),
            "taik": mst_slot_item()?.taik,
            "souk": mst_slot_item()?.souk,
            "houg": mst_slot_item()?.houg,
            "raig": mst_slot_item()?.raig,
            "soku": mst_slot_item()?.soku,
            "baku": mst_slot_item()?.baku,
            "tyku": mst_slot_item()?.tyku,
            "tais": mst_slot_item()?.tais,
            "atap": mst_slot_item()?.atap,
            "houm": mst_slot_item()?.houm,
            "raim": mst_slot_item()?.raim,
            "houk": mst_slot_item()?.houk,
            "raik": mst_slot_item()?.raik,
            "bakk": mst_slot_item()?.bakk,
            "saku": mst_slot_item()?.saku,
            "sakb": mst_slot_item()?.sakb,
            "luck": mst_slot_item()?.luck,
            "leng": mst_slot_item()?.leng,
            "rare": mst_slot_item()?.rare,
        }
        let tool_tip_string = Object.entries(tooltip_data).reduce((acc, [key, value]) => {
            return acc + key + ": " + String(value) + ",\n";
        }, "");
        return tool_tip_string;
    }

    const signed_number = (number: number): string => number != 0 ? (number >= 0 ? "+"+String(number) : String(number)) : "";

    return <>
        <div class="flex flex-nowarp w-full" onClick={()=> {set_show_dialog(true); show_modal(slot_id);}} >
            <div class="indicator">
                {/* <span class="indicator-item badge badge-sm badge-outline">
                    {slot_item().level > 0 ? slot_item().level : "" }
                </span> */}
                <span class="indicator-item">
                    { slot_item()?.level ?? 0 > 0 ? 
                    <div class="badge badge-xs badge-ghost w-2 rounded grid place-content-center text-accent">
                        { slot_item().level === 10 ? "★" : slot_item().level }
                    </div> : "" }
                </span>
                <IconEquipment class="h-5 w-5 -mt-0.5" category_number={_mst_slot_items.mst_slot_items[_slot_items.slot_items[slot_id]?.slotitem_id]?._type[1]} icon_number={_mst_slot_items.mst_slot_items[_slot_items.slot_items[slot_id]?.slotitem_id]?._type[3]}></IconEquipment>
            </div>
            {
                !(ex_flag ?? false) ? <div class="flex-none pl-px">
                    <div class="grid h-2.5 w-4 place-content-center text-xs text-accent">
                        { proficiency() }
                    </div>
                    <div class="grid h-2.5 w-4 place-content-center text-xs">
                        {show_onslot() ? onslot : ""}
                    </div>
                </div> : <div class="flex-none pl-px"><div class="w-4"></div></div>
            }
            {
                (name_flag ?? false) ? <div class="pl-3 truncate">{mst_slot_item()?.name ?? "Unknown"}</div>: <></>
            }
        </div>
        
        <Show when={show_dialog()}>
            <dialog id={"deck_equipment_modal_"+slot_id} class="modal">
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
                    <div class="flex justify-start tooltip tooltip-bottom" data-tip={display_tooltip()}>
                    {/* <div class="flex justify-start"> */}
                        <h3 class="font-bold text-base pl-3 truncate">{mst_slot_item()?.name ?? "Unknown"}</h3>
                        <div class="place-self-end pb pl-4 text-sm text-accent">{signed_number(slot_item()?.level ?? 0)}</div>
                    </div>
                    <div class="pt-2">
                        <table class="table table-sm">
                            <caption class="truncate">Equipment Status</caption>
                            <tbody>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Firepower</th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item()?.houg ?? 0)}</td>
                                    <th class="truncate flex-1 w-2">Torpedo </th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item().raig ?? 0)}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Bomb</th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item().baku ?? 0)}</td>
                                    <th class="truncate flex-1 w-2">Anti-Air</th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item().tyku ?? 0)}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Anti-Submarine</th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item().tais ?? 0)}</td>
                                    <th class="truncate flex-1 w-2">Reconnaissance</th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item().saku ?? 0)}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Accuracy</th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item().houm ?? 0)}</td>
                                    <th class="truncate flex-1 w-2">Evasion</th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item().houk ?? 0)}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Armor</th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item().souk ?? 0)}</td>
                                    <th class="truncate flex-1 w-2">Anti-Bomber</th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item().taibaku ?? 0)}</td>
                                </tr>
                                <tr class="flex table_active table_hover rounded">
                                    <th class="truncate flex-1 w-2">Interception</th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item().geigeki ?? 0)}</td>
                                    <th class="truncate flex-1 w-2">Distance</th>
                                    <td class="flex-none w-12">{signed_number(mst_slot_item().distance ?? 0)}</td>
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