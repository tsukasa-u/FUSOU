import {
  useMstShips,
  useMstSlotItems,
  useShips,
  useSlotItems,
} from "./provider";
import type {
  MstShip,
  MstSlotItem,
  MstSlotItems,
} from "@ipc-bindings/get_data";
import type { Ship } from "@ipc-bindings/port";
import type { SlotItem, SlotItems } from "@ipc-bindings/require_info";

export const get_data_set_equip = (equip_ids: number[]) => {
  const [slot_items] = useSlotItems();
  const [mst_slot_items] = useMstSlotItems();
  let ret: {
    [key: number]: {
      slot_item: SlotItem | undefined;
      mst_slot_item: MstSlotItem | undefined;
    };
  } = {};
  equip_ids.forEach((equip_id) => {
    const slot_item = slot_items.slot_items[equip_id];

    const mst_slot_item_id = slot_item?.slotitem_id;
    const mst_slot_item = mst_slot_item_id
      ? mst_slot_items.mst_slot_items[mst_slot_item_id]
      : undefined;

    ret[equip_id] = {
      slot_item: slot_item,
      mst_slot_item: mst_slot_item,
    };
  });

  return ret;
};

export const get_data_set_ship = (ship_ids: number[]) => {
  const [ships] = useShips();
  const [mst_ships] = useMstShips();
  const [slot_items] = useSlotItems();
  const [mst_slot_items] = useMstSlotItems();
  let ret: {
    [key: number]: {
      ship: Ship | undefined;
      mst_ship: MstShip | undefined;
      slot_items: SlotItems | undefined;
      mst_slot_items: MstSlotItems | undefined;
    };
  } = {};
  ship_ids.forEach((ship_id) => {
    const ship = ships.ships[ship_id];

    const mst_ship_id = ship?.ship_id ?? undefined;
    const mst_ship = mst_ship_id ? mst_ships.mst_ships[mst_ship_id] : undefined;

    const slot_item_ids = ship?.slot ?? undefined;
    const slot_item_id_ex = ship?.slot_ex ?? undefined;
    const slot_item_id_list = slot_item_ids
      ? slot_item_id_ex
        ? [...slot_item_ids, slot_item_id_ex]
        : [...slot_item_ids]
      : undefined;
    const slot_item_list = slot_item_id_list?.map(
      (id) => slot_items.slot_items[id]
    );
    const slot_item_map = slot_item_list?.reduce(
      (dict, slot_item) => (
        slot_item ? (dict[slot_item.id] = slot_item) : dict, dict
      ),
      {} as { [x: number]: SlotItem | undefined }
    );

    const mst_slot_item_list = slot_item_list
      ?.map((slot_item) =>
        slot_item
          ? mst_slot_items.mst_slot_items[slot_item.slotitem_id]
          : undefined
      )
      .filter((slot_item) => slot_item)
      .map((slot_item) => slot_item!);
    const mst_slot_item_map = mst_slot_item_list?.reduce(
      (dict, slot_item) => (
        slot_item ? (dict[slot_item.id] = slot_item) : dict, dict
      ),
      {} as { [x: number]: MstSlotItem | undefined }
    );

    ret[ship_id] = {
      ship: ship,
      mst_ship: mst_ship,
      slot_items: {
        slot_items: slot_item_map,
      } as SlotItems | undefined,
      mst_slot_items: {
        mst_slot_items: mst_slot_item_map,
      } as MstSlotItems | undefined,
    };
  });
  return ret;
};
