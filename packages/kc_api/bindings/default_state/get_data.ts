import type {
  MstShip,
  MstShips,
  MstSlotItem,
  MstSlotItems,
  MstEquipExslotShips,
  MstSlotItemEquipTypes,
  MstEquipShips,
  MstStypes,
  MstUseItems,
} from "../get_data.ts";

export const default_mst_ship: MstShip = {
  id: 0,
  sortno: 0,
  sort_id: 0,
  name: "Unknown",
  yomi: "あんのうん",
  stype: 0,
  ctype: 0,
  afterlv: 0,
  aftershipid: "",
  taik: [0, 0],
  souk: [0, 0],
  houg: [0, 0],
  raig: [0, 0],
  tyku: [0, 0],
  luck: [0, 0],
  soku: 0,
  leng: 0,
  slot_num: 0,
  maxeq: [0, 0, 0, 0, 0],
  buildtime: 0,
  broken: [0, 0, 0, 0],
  powup: [0, 0, 0, 0],
  backs: 0,
  getmes: "",
  afterfuel: 0,
  afterbull: 0,
  fuel_max: 0,
  bull_max: 0,
  voicef: 0,
  tais: [0, 0],
};

export const default_mst_ships: MstShips = {
  mst_ships: {},
};

export const default_mst_slot_item: MstSlotItem = {
  id: 0,
  sortno: 0,
  name: "Unknown",
  type: [0, 0, 0, 0, 0],
  taik: 0,
  souk: 0,
  houg: 0,
  raig: 0,
  soku: 0,
  baku: 0,
  tyku: 0,
  tais: 0,
  atap: 0,
  houm: 0,
  raim: 0,
  houk: 0,
  raik: 0,
  bakk: 0,
  saku: 0,
  sakb: 0,
  luck: 0,
  leng: 0,
  rare: 0,
  taibaku: 0,
  geigeki: 0,
  broken: [0, 0, 0, 0],
  usebull: "",
  version: null,
  cost: null,
  distance: null,
};
export const default_mst_slot_items: MstSlotItems = {
  mst_slot_items: {},
};

export const default_mst_equip_exslot_ships: MstEquipExslotShips = {
  mst_equip_ships: {},
};

export const default_mst_slotitem_equip_types: MstSlotItemEquipTypes = {
  mst_slotitem_equip_types: {},
};

export const default_mst_equip_ships: MstEquipShips = {
  mst_equip_ships: {},
};

export const default_mst_stypes: MstStypes = {
  mst_stypes: {},
};

export const default_mst_useitems: MstUseItems = {
  mst_use_items: {},
};
