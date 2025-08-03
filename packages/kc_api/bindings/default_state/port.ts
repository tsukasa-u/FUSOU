import type { Materials, DeckPorts, NDocks, Ship, Ships, Logs } from "../port";

export const default_materials: Materials = {
  materials: [0, 0, 0, 0, 0, 0, 0, 0],
};

export const default_deck_ports: DeckPorts = {
  deck_ports: {},
  combined_flag: null,
};

export const default_nDock: NDocks = {
  n_docks: [],
};

export const default_ship: Ship = {
  id: 0,
  ship_id: 0,
  lv: 0,
  exp: [0, 0, 0],
  nowhp: 0,
  maxhp: 0,
  soku: 0,
  leng: 0,
  slot: [-1, -1, -1, -1, -1],
  onslot: [0, 0, 0, 0, 0],
  slot_ex: 0,
  fuel: 0,
  bull: 0,
  slotnum: 0,
  cond: 0,
  karyoku: [0, 0],
  raisou: [0, 0],
  taiku: [0, 0],
  soukou: [0, 0],
  kaihi: [0, 0],
  taisen: [0, 0],
  sakuteki: [0, 0],
  lucky: [0, 0],
  sally_area: 0,
  sp_effect_items: {
    items: {
      0: {
        kind: 0,
        raig: 0,
        souk: 0,
        houg: 0,
        kaih: 0,
      },
    },
  },
};

export const default_ships: Ships = {
  ships: {},
};

export const default_logs: Logs = {
  message: [],
};
