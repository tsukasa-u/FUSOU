import type { DeckPorts } from "@ipc-bindings/port";

export const deck_port: DeckPorts = {
  deck_ports: {
    "1": {
      id: 1,
      name: "第1艦隊",
      mission: [0, 0, 0, 0],
      ship: [1927, 4299, 1531, 479, 411, 1807],
    },
    "2": {
      id: 2,
      name: "北方鼠輸送作戦遠征艦隊",
      mission: [0, 0, 0, 0],
      ship: [2872, 1, 894, 589, 629, 569],
    },
    "3": {
      id: 3,
      name: "水上機前線輸送遠征艦隊",
      mission: [0, 0, 0, 0],
      ship: [175, 7701, 7547, 4827, 1227, 5773],
    },
    "4": {
      id: 4,
      name: "鼠輸送作戦遠征艦隊",
      mission: [0, 0, 0, 0],
      ship: [927, 13053, 4762, 7535, 3006, 2472],
    },
  },
  combined_flag: null,
};
