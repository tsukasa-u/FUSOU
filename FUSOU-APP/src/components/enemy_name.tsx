import { IconXMark } from '../icons/X-mark.tsx';
import { EquimentComponent } from './equipment.tsx';

import '../css/modal.css';
import { useMstShips, useShips } from '../utility/provider.tsx';
import { createMemo, For, Show } from 'solid-js';
import IconShip from '../icons/ship.tsx';

interface ShipNameProps {
    ship_id: number;
}
   
const show_modal = (ship_id: number) => {
    const dialogElement = document.getElementById("deck_ship_name_modal_"+ship_id) as HTMLDialogElement | null
    dialogElement?.showModal()
}

export function EnemyNameComponent({ship_id}: ShipNameProps) {

    const [_mst_ships, ] = useMstShips();

    const mst_ship = createMemo(() => {
        console.log(Date.now(), ship_id, _mst_ships.mst_ships[ship_id]);
        return _mst_ships.mst_ships[ship_id];
    });

    // const slot_item_list: Signal<SlotItem[]> = useComputed$(() => {
    //     let slot = _ships.ships[ship_id]?.slot;
    //     if (slot === undefined) return [];
    //     return slot.map((slot_id) => {
    //         return slot_items.slot_items[slot_id];
    //     });
    // });

    // const mst_slot_item_list: Signal<MstSlotitem[]> = useComputed$(() => {
    //     let slot = _ships.ships[ship_id]?.slot;
    //     if (slot === undefined) return [];
    //     return slot.map((slot_id) => {
    //         return mst_slot_items.mst_slot_items[slot_items.slot_items[slot_id]?.slotitem_id];
    //     });
    // });

    return <>
        <div class="flex flex-nowarp" onClick={()=> show_modal(ship_id)}>
            <IconShip class="h-5 -mt-0.5 pr-2" ship_stype={mst_ship().stype ?? 0} color={mst_ship().yomi}/>
            {mst_ship()?.name ?? "Unknown"}
        </div>
        <dialog id={"deck_ship_name_modal_"+ship_id} class="modal">
            <div class="modal-box bg-base-100 modal-box-width">
                <form method="dialog">
                    <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">
                        <IconXMark class="h-6 w-6" />
                    </button>
                </form>
                <div class="flex justify-start">
                    <h3 class="font-bold text-base pl-2 truncate">{mst_ship()?.name ?? "Unknown"}</h3>
                </div>
                <div class="pt-2">
                    {/* <table class="table table-xs">
                        <caption class="truncate">Equipment</caption>
                        <tbody>
                            <For each={ship()?.slot} fallback={<></>}>
                                {(slot_ele, index) => {
                                    return <>
                                        <tr class="flex">
                                            <th class="flex-none w-4">S{index()+1}</th>
                                            <td class="flex-none w-12 pl-4">
                                                <Show when={slot_ele > 0}>
                                                    <EquimentComponent slot_id={slot_ele} ex_flag={true} name_flag={true}></EquimentComponent>
                                                </Show>
                                            </td>
                                        </tr>
                                    </>
                                }}
                            </For>
                            <tr class="flex">
                                <th class="flex-none w-2">SE</th>
                                <td class="flex-none w-12 pl-4">
                                    <Show when={ship()?.slot_ex > 0}>
                                        <EquimentComponent slot_id={ship()?.slot_ex} ex_flag={true} name_flag={true}></EquimentComponent>
                                    </Show>
                                </td>
                            </tr>
                        </tbody>
                    </table> */}
                </div>
            </div>
            <form method="dialog" class="modal-backdrop">
                <button>close</button>
            </form>
        </dialog>
    </>;
}