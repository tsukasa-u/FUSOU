import type { JSX } from "solid-js";
import { createContext, useContext, createEffect, onCleanup } from "solid-js";
import type { Part, SetStoreFunction } from "solid-js/store";
import { createStore } from "solid-js/store";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";

import type { DeckPorts, Materials, Ship, Ships } from "@ipc-bindings/port";
import {
  default_deck_ports,
  default_materials,
  default_ships,
} from "@ipc-bindings/default_state/port";

import type {
  MstEquipExslotShips,
  MstEquipShips,
  MstShips,
  MstSlotItemEquipTypes,
  MstSlotItems,
  MstStypes,
  MstUseItems,
} from "@ipc-bindings/get_data";
import {
  default_mst_equip_exslot_ships,
  default_mst_equip_ships,
  default_mst_ships,
  default_mst_slot_items,
  default_mst_slotitem_equip_types,
  default_mst_stypes,
  default_mst_useitems,
} from "@ipc-bindings/default_state/get_data";

import type { SlotItems } from "@ipc-bindings/require_info";
import { default_slotitems } from "@ipc-bindings/default_state/require_info";

import type { Cell, Cells } from "@ipc-bindings/cells";
import { default_cells } from "@ipc-bindings/default_state/cells";

import type { AirBases } from "@ipc-bindings/map_info";
import { default_air_bases } from "@ipc-bindings/default_state/map_info";

import type { Battle } from "@ipc-bindings/battle";

export const ShipsContext =
  createContext<(Ships | SetStoreFunction<Ships>)[]>();

export function ShipsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<Ships>(
    JSON.parse(JSON.stringify(default_ships))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data_set: UnlistenFn;
    let unlisten_data_add: UnlistenFn;
    (async () => {
      unlisten_data_set = await listen<Ships>("set-kcs-ships", (event) => {
        if (import.meta.env.DEV) console.log("set-kcs-ships");
        setData(event.payload);
      });
      unlisten_data_add = await listen<Ships>("add-kcs-ships", (event) => {
        if (import.meta.env.DEV) console.log("add-kcs-ships");
        Object.entries(event.payload.ships).forEach(([key1, value1]) => {
          if (value1) {
            Object.entries(value1).forEach(([key2, value2]) => {
              if (value2 !== null) {
                setData(
                  "ships",
                  Number(key1),
                  key2 as Part<Ship, keyof Ship>,
                  value2
                );
              }
            });
          }
        });
      });
    })();

    onCleanup(() => {
      if (unlisten_data_set) unlisten_data_set();
      if (unlisten_data_add) unlisten_data_add();
    });
  });

  return (
    <ShipsContext.Provider value={setter}>
      {props.children}
    </ShipsContext.Provider>
  );
}

export function useShips() {
  const context = useContext(ShipsContext);
  if (!context) {
    throw new Error("useShips: cannot find a ShipsContext");
  }
  return context as [Ships, SetStoreFunction<Ships>];
}

export const MstShipsContext =
  createContext<(MstShips | SetStoreFunction<MstShips>)[]>();

export function MstShipsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<MstShips>(
    JSON.parse(JSON.stringify(default_mst_ships))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstShips>("set-kcs-mst-ships", (event) => {
        if (import.meta.env.DEV) console.log("set-kcs-mst-ships");
        setData(event.payload);
      });
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <MstShipsContext.Provider value={setter}>
      {props.children}
    </MstShipsContext.Provider>
  );
}

export function useMstShips() {
  const context = useContext(MstShipsContext);
  if (!context) {
    throw new Error("useContext: cannot find a MstShipsContext");
  }
  return context as [MstShips, SetStoreFunction<MstShips>];
}

export const SlotItemsContext =
  createContext<(SlotItems | SetStoreFunction<SlotItems>)[]>();

export function SlotItemsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<SlotItems>(
    JSON.parse(JSON.stringify(default_slotitems))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<SlotItems>("set-kcs-slot-items", (event) => {
        if (import.meta.env.DEV) console.log("set-kcs-slot-items");
        setData(event.payload);
      });
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <SlotItemsContext.Provider value={setter}>
      {props.children}
    </SlotItemsContext.Provider>
  );
}

export function useSlotItems() {
  const context = useContext(SlotItemsContext);
  if (!context) {
    throw new Error("useSlotItems: cannot find a SlotItemsContext");
  }
  return context as [SlotItems, SetStoreFunction<SlotItems>];
}

export const MstSlotItemsContext =
  createContext<(MstSlotItems | SetStoreFunction<MstSlotItems>)[]>();

export function MstSlotItemsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<MstSlotItems>(
    JSON.parse(JSON.stringify(default_mst_slot_items))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstSlotItems>(
        "set-kcs-mst-slot-items",
        (event) => {
          if (import.meta.env.DEV) console.log("set-kcs-mst-slot-items");
          setData(event.payload);
        }
      );
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <MstSlotItemsContext.Provider value={setter}>
      {props.children}
    </MstSlotItemsContext.Provider>
  );
}

export function useMstSlotItems() {
  const context = useContext(MstSlotItemsContext);
  if (!context) {
    throw new Error("useMstSlotItems: cannot find a MstSlotItemsContext");
  }
  return context as [MstSlotItems, SetStoreFunction<MstSlotItems>];
}

const MstEquipExslotShipsContext =
  createContext<
    (MstEquipExslotShips | SetStoreFunction<MstEquipExslotShips>)[]
  >();

export function MstEquipExslotShipsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<MstEquipExslotShips>(
    JSON.parse(JSON.stringify(default_mst_equip_exslot_ships))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstEquipExslotShips>(
        "set-kcs-mst-equip-exslot-ships",
        (event) => {
          if (import.meta.env.DEV)
            console.log("set-kcs-mst-equip-exslot-ships");
          setData(event.payload);
        }
      );
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <MstEquipExslotShipsContext.Provider value={setter}>
      {props.children}
    </MstEquipExslotShipsContext.Provider>
  );
}

export function useMstEquipExslotShips() {
  const context = useContext(MstEquipExslotShipsContext);
  if (!context) {
    throw new Error(
      "useMstEquipExslotShips: cannot find a MstEquipExslotShipsContext"
    );
  }
  return context as [
    MstEquipExslotShips,
    SetStoreFunction<MstEquipExslotShips>,
  ];
}

export const MstSlotItemEquipTypesContext =
  createContext<
    (MstSlotItemEquipTypes | SetStoreFunction<MstSlotItemEquipTypes>)[]
  >();

export function MstSlotItemEquipTypesProvider(props: {
  children: JSX.Element;
}) {
  const [data, setData] = createStore<MstSlotItemEquipTypes>(
    JSON.parse(JSON.stringify(default_mst_slotitem_equip_types))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstSlotItemEquipTypes>(
        "set-kcs-mst-slot-item-equip-types",
        (event) => {
          if (import.meta.env.DEV)
            console.log("set-kcs-mst-slot-item-equip-types");
          setData(event.payload);
        }
      );
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <MstSlotItemEquipTypesContext.Provider value={setter}>
      {props.children}
    </MstSlotItemEquipTypesContext.Provider>
  );
}

export function useMstSlotItemEquipTypes() {
  const context = useContext(MstSlotItemEquipTypesContext);
  if (!context) {
    throw new Error(
      "useMstSlotItemEquipTypes: cannot find a MstSlotItemEquipTypesContext"
    );
  }

  return context as [
    MstSlotItemEquipTypes,
    SetStoreFunction<MstSlotItemEquipTypes>,
  ];
}

const MstEquipShipsContext =
  createContext<(MstEquipShips | SetStoreFunction<MstEquipShips>)[]>();

export function MstEquipShipsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<MstEquipShips>(
    JSON.parse(JSON.stringify(default_mst_equip_ships))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstEquipShips>(
        "set-kcs-mst-equip-ships",
        (event) => {
          if (import.meta.env.DEV) console.log("set-kcs-mst-equip-ships");
          setData(event.payload);
        }
      );
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <MstEquipShipsContext.Provider value={setter}>
      {props.children}
    </MstEquipShipsContext.Provider>
  );
}

export function useMstEquipShips() {
  const context = useContext(MstEquipShipsContext);
  if (!context) {
    throw new Error("useMstEquipShips: cannot find a MstEquipShipsContext");
  }
  return context as [MstEquipShips, SetStoreFunction<MstEquipShips>];
}

export const MstStypesContext =
  createContext<(MstStypes | SetStoreFunction<MstStypes>)[]>();

export function MstStypesProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<MstStypes>(
    JSON.parse(JSON.stringify(default_mst_stypes))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstStypes>("set-kcs-mst-stypes", (event) => {
        if (import.meta.env.DEV) console.log("set-kcs-mst-stypes");
        setData(event.payload);
      });
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <MstStypesContext.Provider value={setter}>
      {props.children}
    </MstStypesContext.Provider>
  );
}

export function useMstStypes() {
  const context = useContext(MstStypesContext);
  if (!context) {
    throw new Error("useMstStypes: cannot find a MstStypesContext");
  }
  return context as [MstStypes, SetStoreFunction<MstStypes>];
}

const MstUseItemsContext =
  createContext<(MstUseItems | SetStoreFunction<MstUseItems>)[]>();

export function MstUseItemsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<MstUseItems>(
    JSON.parse(JSON.stringify(default_mst_useitems))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstUseItems>(
        "set-kcs-mst-use-items",
        (event) => {
          if (import.meta.env.DEV) console.log("set-kcs-mst-use-items");
          setData(event.payload);
        }
      );
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <MstUseItemsContext.Provider value={setter}>
      {props.children}
    </MstUseItemsContext.Provider>
  );
}

export function useMstUseItems() {
  const context = useContext(MstUseItemsContext);
  if (!context) {
    throw new Error("useMstUseItems: cannot find a MstUseItemsContext");
  }
  return context as [MstUseItems, SetStoreFunction<MstUseItems>];
}

export const MaterialsContext =
  createContext<(Materials | SetStoreFunction<Materials>)[]>();

export function MaterialsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<Materials>(default_materials);
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data_set: UnlistenFn;
    let unlisten_data_add: UnlistenFn;
    (async () => {
      unlisten_data_set = await listen<Materials>(
        "set-kcs-materials",
        (event) => {
          if (import.meta.env.DEV) console.log("set-kcs-materials");
          setData(event.payload);
        }
      );
      unlisten_data_add = await listen<Materials>(
        "add-kcs-materials",
        (event) => {
          if (import.meta.env.DEV) console.log("add-kcs-materials");
          Object.entries(event.payload).forEach(([key, value]) => {
            if (value !== null) {
              setData(key as Part<Materials, keyof Materials>, value);
            }
          });
        }
      );
    })();

    onCleanup(() => {
      if (unlisten_data_set) unlisten_data_set();
      if (unlisten_data_add) unlisten_data_add();
    });
  });

  return (
    <MaterialsContext.Provider value={setter}>
      {props.children}
    </MaterialsContext.Provider>
  );
}

export function useMaterials() {
  const context = useContext(MaterialsContext);
  if (!context) {
    throw new Error("useMaterials: cannot find a MaterialsContext");
  }
  return context as [Materials, SetStoreFunction<Materials>];
}

export const DeckPortsContext =
  createContext<(DeckPorts | SetStoreFunction<DeckPorts>)[]>();

export function DeckPortsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<DeckPorts>(
    JSON.parse(JSON.stringify(default_deck_ports))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<DeckPorts>("set-kcs-deck-ports", (event) => {
        if (import.meta.env.DEV) console.log("set-kcs-deck-ports");
        setData(event.payload);
      });
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <DeckPortsContext.Provider value={setter}>
      {props.children}
    </DeckPortsContext.Provider>
  );
}

export function useDeckPorts() {
  const context = useContext(DeckPortsContext);
  if (!context) {
    throw new Error("useDeckPorts: cannot find a DeckPortsContext");
  }
  return context as [DeckPorts, SetStoreFunction<DeckPorts>];
}

export const DeckBattlesContext =
  createContext<(DeckPorts | SetStoreFunction<DeckPorts>)[]>();

export function DeckBattlesProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<DeckPorts>(
    JSON.parse(JSON.stringify(default_deck_ports))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<DeckPorts>(
        "set-kcs-deck-battles",
        (event) => {
          if (import.meta.env.DEV) console.log("set-kcs-deck-battles");
          setData(event.payload);
          if (import.meta.env.DEV) console.log(event.payload);
        }
      );
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <DeckBattlesContext.Provider value={setter}>
      {props.children}
    </DeckBattlesContext.Provider>
  );
}

export function useDeckBattles() {
  const context = useContext(DeckBattlesContext);
  if (!context) {
    throw new Error("useDeckBattles: cannot find a DeckBattlesContext");
  }
  return context as [DeckPorts, SetStoreFunction<DeckPorts>];
}

export const CellsContext =
  createContext<(Cells | SetStoreFunction<Cells>)[]>();

export function CellsContextProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<Cells>(
    JSON.parse(JSON.stringify(default_cells))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data_set_cells: UnlistenFn;
    let unlisten_data_add_cell: UnlistenFn;
    let unlisten_data_add_battle: UnlistenFn;
    (async () => {
      unlisten_data_set_cells = await listen<Cells>(
        "set-kcs-cells",
        (event) => {
          if (import.meta.env.DEV) console.log("set-kcs-cells");
          setData(event.payload);
        }
      );
      // eslint-disable-next-line solid/reactivity
      unlisten_data_add_cell = await listen<Cell>("add-kcs-cell", (event) => {
        if (import.meta.env.DEV) console.log("add-kcs-cell");
        setData("cells", event.payload.no, event.payload);
        setData("cell_index", data.cell_index.length, event.payload.no);
      });
      unlisten_data_add_battle = await listen<Battle>(
        "add-kcs-battle",
        // eslint-disable-next-line solid/reactivity
        (event) => {
          if (import.meta.env.DEV) console.log("add-kcs-battle");
          if (
            Object.prototype.hasOwnProperty.call(
              data.battles,
              event.payload.cell_id
            )
          ) {
            Object.entries(event.payload).forEach(([key, value]) => {
              if (value !== null && typeof value === "object") {
                setData(
                  "battles",
                  event.payload.cell_id,
                  key as Part<Battle, keyof Battle>,
                  value
                );
              }
            });
          } else {
            setData("battles", event.payload.cell_id, event.payload);
          }
        }
      );
    })();

    onCleanup(() => {
      if (unlisten_data_set_cells) unlisten_data_set_cells();
      if (unlisten_data_add_cell) unlisten_data_add_cell();
      if (unlisten_data_add_battle) unlisten_data_add_battle();
    });
  });

  return (
    <CellsContext.Provider value={setter}>
      {props.children}
    </CellsContext.Provider>
  );
}

export function useCells() {
  const context = useContext(CellsContext);
  if (!context) {
    throw new Error("useBattle: cannot find a CellsContext");
  }
  return context as [Cells, SetStoreFunction<Cells>];
}

export const AirBasesPortsContext =
  createContext<(AirBases | SetStoreFunction<AirBases>)[]>();

export function AirBasesPortsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<AirBases>(
    JSON.parse(JSON.stringify(default_air_bases))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<AirBases>(
        "set-kcs-air-bases-ports",
        (event) => {
          if (import.meta.env.DEV) console.log("set-kcs-air-bases-ports");
          setData(event.payload);
        }
      );
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <AirBasesPortsContext.Provider value={setter}>
      {props.children}
    </AirBasesPortsContext.Provider>
  );
}

export function useAirBasesPorts() {
  const context = useContext(AirBasesPortsContext);
  if (!context) {
    throw new Error("useAirBasesPorts: cannot find a AirBasesPortsContext");
  }
  return context as [AirBases, SetStoreFunction<AirBases>];
}

export const AirBasesBattlesContext =
  createContext<(AirBases | SetStoreFunction<AirBases>)[]>();

export function AirBasesBattlesProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<AirBases>(
    JSON.parse(JSON.stringify(default_air_bases))
  );
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<AirBases>(
        "set-kcs-air-bases-battles",
        (event) => {
          if (import.meta.env.DEV) console.log("set-kcs-air-bases-battles");
          setData(event.payload);
          if (import.meta.env.DEV) console.log(event.payload);
        }
      );
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <AirBasesBattlesContext.Provider value={setter}>
      {props.children}
    </AirBasesBattlesContext.Provider>
  );
}

export function useAirBasesBattles() {
  const context = useContext(AirBasesBattlesContext);
  if (!context) {
    throw new Error("useAirBasesBattles: cannot find a AirBasesBattlesContext");
  }
  return context as [AirBases, SetStoreFunction<AirBases>];
}

//-----

type AuthContextType = {
  accessToken: string | null;
  refreshToken: string | null;
};
const AuthContext =
  createContext<(AuthContextType | SetStoreFunction<AuthContextType>)[]>();

export function AuthProvider(props: { children: JSX.Element }) {
  const store_data: AuthContextType = {
    accessToken: null,
    refreshToken: null,
  };
  const [data, setData] = createStore(store_data);
  const setter = [data, setData];

  // createEffect(() => {
  //   supabase.auth.getSession().then(({ data }) => {
  //     if (data.session !== null) {
  //       setData("accessToken", data.session.access_token);
  //       setData("userName", data.session.user.user_metadata.full_name);
  //       setData("userImage", data.session.user.user_metadata.avatar_url);
  //       setData("userMail", data.session.user.email!);
  //       setData("noAuth", false);
  //       setData("logined", true);
  //     } else {
  //       setData("logined", false);
  //       setData("accessToken", null);
  //       setData("userName", null);
  //       setData("userImage", null);
  //     }
  //   }
  //   );
  // });

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<string[]>("set-supabase-tokens", (event) => {
        if (import.meta.env.DEV) console.log("set-supabase-tokens");
        setData({
          accessToken: event.payload[0],
          refreshToken: event.payload[1],
        });
      });
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <AuthContext.Provider value={setter}>{props.children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth: cannot find a AuthContext");
  }

  return context as [AuthContextType, SetStoreFunction<AuthContextType>];
}

//-----

type DebugApiContextType = string[][];

const DebugApiContext =
  createContext<
    (DebugApiContextType | SetStoreFunction<DebugApiContextType>)[]
  >();

export function DebugApiProvider(props: { children: JSX.Element }) {
  const store_data: DebugApiContextType = [[], []];
  const [data, setData] = createStore(store_data);
  const setter = [data, setData];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<string[][]>(
        "set-debug-api-read-dir",
        (event) => {
          if (import.meta.env.DEV) console.log("set-debug-api-read-dir");
          setData(event.payload);
        }
      );
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <DebugApiContext.Provider value={setter}>
      {props.children}
    </DebugApiContext.Provider>
  );
}

export function useDebugApi() {
  const context = useContext(DebugApiContext);
  if (!context) {
    throw new Error("useDebugApi: cannot find a DebugApiContext");
  }
  return context as [
    DebugApiContextType,
    SetStoreFunction<DebugApiContextType>,
  ];
}
