import { MstSlotItem, MstSlotItems } from "@ipc-bindings/get_data";
import { DataSetShip, get_data_set_ship } from "./get_data_set";
import { useCells, useDeckPorts, useMstSlotItems } from "./provider";
import { Battle } from "@ipc-bindings/battle";

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
  let ship_id_flatten = Object.values(get_deck_ship_id()).flat();
  return get_data_set_ship(ship_id_flatten);
};

export const get_battle_selected = (index: number): Battle | undefined => {
  const [cells] = useCells();
  return cells.battles[cells.cell_index[index]];
};
