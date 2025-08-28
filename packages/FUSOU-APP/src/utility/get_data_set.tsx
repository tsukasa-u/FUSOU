import { Battle } from "@ipc-bindings/battle";
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
import { DestructionBattle } from "@ipc-bindings/cells";

export type DataSetParamShip = {
  e_main_ship_param: number[][];
  e_main_ship_slot: number[][];
  e_main_ship_max_hp: number[];
  e_main_mst_ship: (MstShip | undefined)[];
  e_main_mst_slot_items: (MstSlotItems | undefined)[];
  e_main_color: (string | undefined)[];
  e_escort_ship_param: number[][];
  e_escort_ship_slot: number[][];
  e_escort_ship_max_hp: number[];
  e_escort_mst_ship: (MstShip | undefined)[];
  e_escort_mst_slot_items: (MstSlotItems | undefined)[];
  e_escort_color: (string | undefined)[];
  e_ship_param: number[][];
  e_ship_slot: number[][];
  e_ship_max_hp: number[];
  e_mst_ship: (MstShip | undefined)[];
  e_mst_slot_items: (MstSlotItems | undefined)[];
  e_color: (string | undefined)[];
  e_destruction_ship_param: number[][];
  e_destruction_ship_slot: number[][];
  e_destruction_ship_max_hp: number[];
  e_destruction_mst_ship: (MstShip | undefined)[];
  e_destruction_mst_slot_items: (MstSlotItems | undefined)[];
  e_destruction_color: (string | undefined)[];
  f_friend_ship_param: number[][];
  f_friend_ship_slot: number[][];
  f_friend_ship_max_hp: number[];
  f_friend_mst_ship: (MstShip | undefined)[];
  f_friend_mst_slot_items: (MstSlotItems | undefined)[];
  f_friend_color: (string | undefined)[];
};
export const get_data_set_param_ship = (
  battle: Battle | undefined,
  destruction_battle?: DestructionBattle | null
): DataSetParamShip => {
  if (!battle)
    return {
      e_main_ship_param: [[]],
      e_main_ship_slot: [[]],
      e_main_ship_max_hp: [],
      e_main_mst_ship: [],
      e_main_mst_slot_items: [],
      e_main_color: [],
      e_escort_ship_param: [[]],
      e_escort_ship_slot: [[]],
      e_escort_ship_max_hp: [],
      e_escort_mst_ship: [],
      e_escort_mst_slot_items: [],
      e_escort_color: [],
      e_ship_param: [[]],
      e_ship_slot: [[]],
      e_ship_max_hp: [],
      e_mst_ship: [],
      e_mst_slot_items: [],
      e_color: [],
      e_destruction_ship_param: [[]],
      e_destruction_ship_slot: [[]],
      e_destruction_ship_max_hp: [],
      e_destruction_mst_ship: [],
      e_destruction_mst_slot_items: [],
      e_destruction_color: [],
      f_friend_ship_param: [[]],
      f_friend_ship_slot: [[]],
      f_friend_ship_max_hp: [],
      f_friend_mst_ship: [],
      f_friend_mst_slot_items: [],
      f_friend_color: [],
    };
  const null_list: null[] = Array(12).fill(null);
  const [mst_ships] = useMstShips();
  const [mst_slot_itmes] = useMstSlotItems();

  let e_main_ship_id: (number | null)[] = battle.enemy_ship_id
    ? battle.enemy_ship_id.slice(0, 6)
    : [...null_list];
  let e_main_ship_param: number[][] = (battle.e_params ?? []).slice(0, 6);
  let e_main_ship_slot: number[][] = (battle.e_slot ?? []).slice(0, 6);
  let e_main_ship_max_hp: number[] = (battle.e_hp_max ?? []).slice(0, 6);
  let e_main_mst_ship = e_main_ship_id.map((id) =>
    id ? mst_ships.mst_ships[id] : undefined
  );
  let e_main_mst_slot_items = e_main_ship_slot.map((slots) => {
    return {
      mst_slot_items: slots
        .map((slot) => mst_slot_itmes.mst_slot_items[slot])
        .reduce(
          (dict, slot_item) => (
            slot_item ? (dict[slot_item.id] = slot_item) : dict, dict
          ),
          {} as { [x: number]: MstSlotItem | undefined }
        ),
    } as MstSlotItems;
  });
  let e_main_color: (string | undefined)[] = get_enemy_yomi(e_main_ship_id);

  let e_escort_ship_id: (number | null)[] = battle.enemy_ship_id
    ? battle.enemy_ship_id.slice(6, 12)
    : [...null_list];
  let e_escort_ship_param: number[][] = (battle.e_params ?? []).slice(6, 12);
  let e_escort_ship_slot: number[][] = (battle.e_slot ?? []).slice(6, 12);
  let e_escort_ship_max_hp: number[] = (battle.e_hp_max ?? []).slice(6, 12);
  let e_escort_mst_ship = e_escort_ship_id.map((id) =>
    id ? mst_ships.mst_ships[id] : undefined
  );
  let e_escort_mst_slot_items = e_escort_ship_slot.map((slots) => {
    return {
      mst_slot_items: slots
        .map((slot) => mst_slot_itmes.mst_slot_items[slot])
        .reduce(
          (dict, slot_item) => (
            slot_item ? (dict[slot_item.id] = slot_item) : dict, dict
          ),
          {} as { [x: number]: MstSlotItem | undefined }
        ),
    } as MstSlotItems;
  });
  let e_escort_color: (string | undefined)[] = get_enemy_yomi(e_escort_ship_id);

  let e_destruction_ship_id: (number | null)[] = destruction_battle
    ? destruction_battle.ship_ke
    : [...null_list];
  let e_destruction_ship_param: number[][] = destruction_battle
    ? destruction_battle.ship_ke.map(() => Array(5).fill(-1))
    : [];
  let e_destruction_ship_slot: number[][] = destruction_battle
    ? destruction_battle.e_slot
    : [];
  let e_destruction_ship_max_hp: number[] = destruction_battle
    ? destruction_battle.e_maxhps
    : [];
  let e_destruction_mst_ship = e_destruction_ship_id.map((id) =>
    id ? mst_ships.mst_ships[id] : undefined
  );
  let e_destruction_mst_slot_items = e_destruction_ship_slot.map((slots) => {
    return {
      mst_slot_items: slots
        .map((slot) => mst_slot_itmes.mst_slot_items[slot])
        .reduce(
          (dict, slot_item) => (
            slot_item ? (dict[slot_item.id] = slot_item) : dict, dict
          ),
          {} as { [x: number]: MstSlotItem | undefined }
        ),
    } as MstSlotItems;
  });
  let e_destruction_color: (string | undefined)[] = get_enemy_yomi(
    e_destruction_ship_id
  );

  let f_friend_ship_id: number[] =
    battle.friendly_force_attack?.fleet_info.ship_id ?? [];
  let f_friend_ship_param: number[][] =
    battle.friendly_force_attack?.fleet_info.params ?? [];
  let f_friend_ship_slot: number[][] =
    battle.friendly_force_attack?.fleet_info.slot ?? [];
  let f_friend_ship_max_hp: number[] =
    battle.friendly_force_attack?.fleet_info.now_hps ?? [];
  let f_friend_mst_ship = f_friend_ship_id.map((id) =>
    id ? mst_ships.mst_ships[id] : undefined
  );
  let f_friend_mst_slot_items = f_friend_ship_slot.map((slots) => {
    return {
      mst_slot_items: slots
        .map((slot) => mst_slot_itmes.mst_slot_items[slot])
        .reduce(
          (dict, slot_item) => (
            slot_item ? (dict[slot_item.id] = slot_item) : dict, dict
          ),
          {} as { [x: number]: MstSlotItem | undefined }
        ),
    } as MstSlotItems;
  });
  let f_friend_color = Array(6).fill("");

  let ret: DataSetParamShip = {
    e_main_ship_param: e_main_ship_param,
    e_main_ship_slot: e_main_ship_slot,
    e_main_ship_max_hp: e_main_ship_max_hp,
    e_main_mst_ship: e_main_mst_ship,
    e_main_mst_slot_items: e_main_mst_slot_items,
    e_main_color: e_main_color,
    e_escort_ship_param: e_escort_ship_param,
    e_escort_ship_slot: e_escort_ship_slot,
    e_escort_ship_max_hp: e_escort_ship_max_hp,
    e_escort_mst_ship: e_escort_mst_ship,
    e_escort_mst_slot_items: e_escort_mst_slot_items,
    e_escort_color: e_escort_color,
    e_ship_param: [...e_main_ship_param, ...e_escort_ship_param],
    e_ship_slot: [...e_main_ship_slot, ...e_escort_ship_slot],
    e_ship_max_hp: [...e_main_ship_max_hp, ...e_escort_ship_max_hp],
    e_mst_ship: [...e_main_mst_ship, ...e_escort_mst_ship],
    e_mst_slot_items: [...e_main_mst_slot_items, ...e_escort_mst_slot_items],
    e_color: [...e_main_color, ...e_escort_color],
    e_destruction_ship_param: e_destruction_ship_param,
    e_destruction_ship_slot: e_destruction_ship_slot,
    e_destruction_ship_max_hp: e_destruction_ship_max_hp,
    e_destruction_mst_ship: e_destruction_mst_ship,
    e_destruction_mst_slot_items: e_destruction_mst_slot_items,
    e_destruction_color: e_destruction_color,
    f_friend_ship_param: f_friend_ship_param,
    f_friend_ship_slot: f_friend_ship_slot,
    f_friend_ship_max_hp: f_friend_ship_max_hp,
    f_friend_mst_ship: f_friend_mst_ship,
    f_friend_mst_slot_items: f_friend_mst_slot_items,
    f_friend_color: f_friend_color,
  };
  return ret;
};

const get_enemy_yomi = (
  mst_ship_ids: (number | null)[]
): (string | undefined)[] => {
  const [mst_ships] = useMstShips();
  return mst_ship_ids.map((id) =>
    id ? mst_ships.mst_ships[id]?.yomi : undefined
  );
};

export type DataSetEquip = {
  [key: number]: {
    slot_item: SlotItem | undefined;
    mst_slot_item: MstSlotItem | undefined;
  };
};
export const get_data_set_equip = (equip_ids: number[]) => {
  const [slot_items] = useSlotItems();
  const [mst_slot_items] = useMstSlotItems();
  let ret: DataSetEquip = {};
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

export type DataSetShip = {
  [key: number]: {
    ship: Ship | undefined;
    mst_ship: MstShip | undefined;
    slot_items: SlotItems | undefined;
    mst_slot_items: MstSlotItems | undefined;
  };
};
export const get_data_set_ship = (ship_ids: number[]) => {
  const [ships] = useShips();
  const [mst_ships] = useMstShips();
  const [slot_items] = useSlotItems();
  const [mst_slot_items] = useMstSlotItems();
  let ret: DataSetShip = {};
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
