import type { MstSlotItem, MstSlotItems } from "@ipc-bindings/get_data";
import type { DataSetShip} from "./get_data_set";
import { get_data_set_ship } from "./get_data_set";
import {
  useCells,
  useDeckPorts,
  useMstSlotItems,
  useSlotItems,
} from "./provider";
import type { Battle } from "@ipc-bindings/battle";

export const calc_critical = (
  dmg: number,
  cl_flag: number | undefined
): string => {
  if (cl_flag == 0 || dmg == 0) {
    return "text-red-500";
  } else if (cl_flag == 2) {
    return "text-yellow-500";
  } else {
    return "";
  }
};

export const get_slot_item = (id: number) => {
  const [slot_items] = useSlotItems();
  const mst_slot_item_id = slot_items.slot_items[id]?.slotitem_id;
  return mst_slot_item_id ? get_mst_slot_item(mst_slot_item_id) : undefined;
};

export const get_mst_slot_item = (id: number) => {
  const [mst_slot_items] = useMstSlotItems();
  return mst_slot_items.mst_slot_items[id];
};

export const get_mst_slot_items_list = (
  mst_slot_item_ids: number[][]
): MstSlotItems[] => {
  const [mst_slot_items] = useMstSlotItems();

  return mst_slot_item_ids.map((ids) => {
    return {
      mst_slot_items: ids
        .map((id) => mst_slot_items.mst_slot_items[id])
        .reduce(
          (dict, slot_item) => (
            slot_item ? (dict[slot_item.id] = slot_item) : dict, dict
          ),
          {} as { [x: number]: MstSlotItem | undefined }
        ),
    } as MstSlotItems;
  });
};

export type DeckShipIds = { [key: number]: number[] };
export const get_deck_ship_id = (): DeckShipIds => {
  const [deck_ports] = useDeckPorts();
  const deck_ship_id: DeckShipIds = {};
  Object.entries(deck_ports.deck_ports).forEach(([deck_id, deck]) => {
    deck_ship_id[Number(deck_id)] = [];
    deck?.ship?.forEach((ship_id) => {
      deck_ship_id[Number(deck_id)].push(ship_id);
    });
  });
  return deck_ship_id;
};

export const get_store_data_set_deck_ship = (): DataSetShip => {
  const ship_id_flatten = Object.values(get_deck_ship_id()).flat();
  return get_data_set_ship(ship_id_flatten);
};

export const get_battle_selected = (index: number): Battle | undefined => {
  const [cells] = useCells();
  return cells.battles[cells.cell_index[index]];
};
