import { IconXMark } from '../icons/X-mark.tsx';
import { EquimentComponent } from './equipment.tsx';

import '../css/modal.css';
import { useMstShips } from '../utility/provider.tsx';
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
        // console.log(Date.now(), ship_id, _mst_ships.mst_ships[ship_id]);
        return _mst_ships.mst_ships[ship_id];
    });

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
            </div>
            <form method="dialog" class="modal-backdrop">
                <button>close</button>
            </form>
        </dialog>
    </>;
}