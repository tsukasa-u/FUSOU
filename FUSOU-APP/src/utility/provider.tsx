import {
  createContext,
  useContext,
  JSX,
  createEffect,
  onCleanup,
} from "solid-js";
import { createStore, Part, SetStoreFunction } from "solid-js/store";
import {
  DeckPorts,
  Materials,
  Ship,
  Ships,
  global_deck_ports,
  global_materials,
  global_ships,
} from "../interface/port";
import {
  MstEquipExslotShips,
  MstEquipShips,
  MstShips,
  MstSlotItemEquipTypes,
  MstSlotitems,
  MstStypes,
  MstUseItems,
  global_mst_equip_exslot_ships,
  global_mst_equip_ships,
  global_mst_ships,
  global_mst_slot_items,
  global_mst_slotitem_equip_types,
  global_mst_stypes,
  global_mst_useitems,
} from "../interface/get_data";
import { SlotItems, global_slotitems } from "../interface/require_info";
import { Battle } from "../interface/battle";
import { Cell, Cells, global_cells } from "../interface/cells";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { AirBases, global_air_bases } from "../interface/map_info";
import { supabase } from "./supabase";
// import { invoke } from "@tauri-apps/api/core";

// eslint-disable-next-line no-unused-vars
const ShipsContext = createContext<(Ships | { set(data: Ships): void })[]>();

export function ShipsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore(global_ships);
  const setter = [
    data,
    {
      set(data: Ships) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data_set: UnlistenFn;
    let unlisten_data_add: UnlistenFn;
    (async () => {
      unlisten_data_set = await listen<Ships>("set-kcs-ships", (event) => {
        setData(event.payload);
      });
      unlisten_data_add = await listen<Ships>("add-kcs-ships", (event) => {
        Object.entries(event.payload.ships).forEach(([key1, value1]) => {
          Object.entries(value1).forEach(([key2, value2]) => {
            if (value2 !== null) {
              setData(
                "ships",
                Number(key1),
                key2 as Part<Ship, keyof Ship>,
                value2,
              );
            }
          });
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
  // eslint-disable-next-line no-unused-vars
  return context as [Ships, (value: Ships) => void];
}

const MstShipsContext =
  // eslint-disable-next-line no-unused-vars
  createContext<(MstShips | { set(data: MstShips): void })[]>();

export function MstShipsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore(global_mst_ships);
  const setter = [
    data,
    {
      set(data: MstShips) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstShips>("set-kcs-mst-ships", (event) => {
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
  // eslint-disable-next-line no-unused-vars
  return context as [MstShips, (value: MstShips) => void];
}

const SlotItemsContext =
  // eslint-disable-next-line no-unused-vars
  createContext<(SlotItems | { set(data: SlotItems): void })[]>();

export function SlotItemsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore(global_slotitems);
  const setter = [
    data,
    {
      set(data: SlotItems) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<SlotItems>("set-kcs-slot-items", (event) => {
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
  // eslint-disable-next-line no-unused-vars
  return context as [SlotItems, (value: SlotItems) => void];
}

const MstSlotItemsContext =
  // eslint-disable-next-line no-unused-vars
  createContext<(MstSlotitems | { set(data: MstSlotitems): void })[]>();

export function MstSlotItemsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore(global_mst_slot_items);
  const setter = [
    data,
    {
      set(data: MstSlotitems) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstSlotitems>(
        "set-kcs-mst-slot-items",
        (event) => {
          setData(event.payload);
        },
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
  // eslint-disable-next-line no-unused-vars
  return context as [MstSlotitems, (value: MstSlotitems) => void];
}

const MstEquipExslotShipsContext = createContext<
  // eslint-disable-next-line no-unused-vars
  (MstEquipExslotShips | { set(data: MstEquipExslotShips): void })[]
>();

export function MstEquipExslotShipsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore(global_mst_equip_exslot_ships);
  const setter = [
    data,
    {
      set(data: MstEquipExslotShips) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstEquipExslotShips>(
        "set-kcs-mst-equip-exslot-ships",
        (event) => {
          setData(event.payload);
        },
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
      "useMstEquipExslotShips: cannot find a MstEquipExslotShipsContext",
    );
  }
  // eslint-disable-next-line no-unused-vars
  return context as [MstEquipExslotShips, (value: MstEquipExslotShips) => void];
}

const MstSlotItemEquipTypesContext = createContext<
  // eslint-disable-next-line no-unused-vars
  (MstSlotItemEquipTypes | { set(data: MstSlotItemEquipTypes): void })[]
>();

export function MstSlotItemEquipTypesProvider(props: {
  children: JSX.Element;
}) {
  const [data, setData] = createStore(global_mst_slotitem_equip_types);
  const setter = [
    data,
    {
      set(data: MstSlotItemEquipTypes) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstSlotItemEquipTypes>(
        "set-kcs-mst-slot-item-equip-types",
        (event) => {
          setData(event.payload);
        },
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
      "useMstSlotItemEquipTypes: cannot find a MstSlotItemEquipTypesContext",
    );
  }

  return context as [
    MstSlotItemEquipTypes,
    // eslint-disable-next-line no-unused-vars
    (data: MstSlotItemEquipTypes) => void,
  ];
}

const MstEquipShipsContext =
  // eslint-disable-next-line no-unused-vars
  createContext<(MstEquipShips | { set(data: MstEquipShips): void })[]>();

export function MstEquipShipsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore(global_mst_equip_ships);
  const setter = [
    data,
    {
      set(data: MstEquipShips) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstEquipShips>(
        "set-kcs-mst-equip-ships",
        (event) => {
          setData(event.payload);
        },
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
  // eslint-disable-next-line no-unused-vars
  return context as [MstEquipShips, (value: MstEquipShips) => void];
}

const MstStypesContext =
  // eslint-disable-next-line no-unused-vars
  createContext<(MstStypes | { set(data: MstStypes): void })[]>();

export function MstStypesProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore(global_mst_stypes);
  const setter = [
    data,
    {
      set(data: MstStypes) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstStypes>("set-kcs-mst-stypes", (event) => {
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
  // eslint-disable-next-line no-unused-vars
  return context as [MstStypes, (value: MstStypes) => void];
}

const MstUseItemsContext =
  // eslint-disable-next-line no-unused-vars
  createContext<(MstUseItems | { set(data: MstUseItems): void })[]>();

export function MstUseItemsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore(global_mst_useitems);
  const setter = [
    data,
    {
      set(data: MstUseItems) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<MstUseItems>(
        "set-kcs-mst-use-items",
        (event) => {
          setData(event.payload);
        },
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
  // eslint-disable-next-line no-unused-vars
  return context as [MstUseItems, (value: MstUseItems) => void];
}

const MaterialsContext =
  // eslint-disable-next-line no-unused-vars
  createContext<(Materials | { set(data: Materials): void })[]>();

export function MaterialsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<Materials>(global_materials);
  const setter = [
    data,
    {
      set(data: Materials) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data_set: UnlistenFn;
    let unlisten_data_add: UnlistenFn;
    (async () => {
      unlisten_data_set = await listen<Materials>(
        "set-kcs-materials",
        (event) => {
          setData(event.payload);
        },
      );
      unlisten_data_add = await listen<Materials>(
        "add-kcs-materials",
        (event) => {
          Object.entries(event.payload).forEach(([key, value]) => {
            if (value !== null) {
              setData(key as Part<Materials, keyof Materials>, value);
            }
          });
        },
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
  // eslint-disable-next-line no-unused-vars
  return context as [Materials, (value: Materials) => void];
}

const DeckPortsContext =
  // eslint-disable-next-line no-unused-vars
  createContext<(DeckPorts | { set(data: DeckPorts): void })[]>();

export function DeckPortsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore(global_deck_ports);
  const setter = [
    data,
    {
      set(data: DeckPorts) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<DeckPorts>("set-kcs-deck-ports", (event) => {
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
  // eslint-disable-next-line no-unused-vars
  return context as [DeckPorts, (value: DeckPorts) => void];
}

// eslint-disable-next-line no-unused-vars
const CellsContext = createContext<(Cells | { set(data: Cells): void })[]>();

export function CellsContextProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore(global_cells);
  const setter = [
    data,
    {
      set(data: Cells) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data_set_cells: UnlistenFn;
    let unlisten_data_add_cell: UnlistenFn;
    let unlisten_data_add_battle: UnlistenFn;
    (async () => {
      unlisten_data_set_cells = await listen<Cells>(
        "set-kcs-cells",
        (event) => {
          setData(event.payload);
        },
      );
      // eslint-disable-next-line solid/reactivity
      unlisten_data_add_cell = await listen<Cell>("add-kcs-cell", (event) => {
        setData("cells", event.payload.no, event.payload);
        setData("cell_index", data.cell_index.length, event.payload.no);
      });
      unlisten_data_add_battle = await listen<Battle>(
        "add-kcs-battle",
        // eslint-disable-next-line solid/reactivity
        (event) => {
          if (
            Object.prototype.hasOwnProperty.call(
              data.battles,
              event.payload.cell_id,
            )
          ) {
            Object.entries(event.payload).forEach(([key, value]) => {
              if (value !== null && typeof value === "object") {
                setData(
                  "battles",
                  event.payload.cell_id,
                  key as Part<Battle, keyof Battle>,
                  value,
                );
              }
            });
          } else {
            setData("battles", event.payload.cell_id, event.payload);
          }
        },
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
  // eslint-disable-next-line no-unused-vars
  return context as [Cells, (value: Cells) => void];
}

const AirBasesContext =
  // eslint-disable-next-line no-unused-vars
  createContext<(AirBases | { set(data: AirBases): void })[]>();

export function AirBasesProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore(global_air_bases);
  const setter = [
    data,
    {
      set(data: AirBases) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<AirBases>("set-kcs-air-bases", (event) => {
        setData(event.payload);
      });
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <AirBasesContext.Provider value={setter}>
      {props.children}
    </AirBasesContext.Provider>
  );
}

export function useAirBases() {
  const context = useContext(AirBasesContext);
  if (!context) {
    throw new Error("useAirBases: cannot find a AirBasesContext");
  }
  // eslint-disable-next-line no-unused-vars
  return context as [AirBases, (value: AirBases) => void];
}
//-----

type AuthContextType = {
  accessToken: string | null;
  refreshToken: string | null;
}
const AuthContext =
  // eslint-disable-next-line no-unused-vars
  createContext<(AuthContextType | SetStoreFunction<AuthContextType>)[]>();

export function AuthProvider(props: { children: JSX.Element }) {
  let store_data: AuthContextType = {
    accessToken: null,
    refreshToken: null,
  };
  const [data, setData] = createStore(store_data);
  const setter = [
    data,
    setData
  ];

  
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
      unlisten_data = await listen<string[]>(
        "set-supabase-tokens",
        (event) => {
          setData({
            accessToken: event.payload[0],
            refreshToken: event.payload[1],
          });
        },
      );
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <AuthContext.Provider value={setter}>
      {props.children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth: cannot find a AuthContext");
  }
  // eslint-disable-next-line no-unused-vars
  return context as [AuthContextType, SetStoreFunction<AuthContextType>];
}


//-----

const DebugApiContext =
  // eslint-disable-next-line no-unused-vars
  createContext<(string[][] | { set(data: string[][]): void })[]>();

export function DebugApiProvider(props: { children: JSX.Element }) {
  let store_data: string[][] = [[], []];
  const [data, setData] = createStore(store_data);
  const setter = [
    data,
    {
      set(data: string[][]) {
        setData(data);
      },
    },
  ];

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      unlisten_data = await listen<string[][]>(
        "set-debug-api-read-dir",
        (event) => {
          setData(event.payload);
        },
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
  // eslint-disable-next-line no-unused-vars
  return context as [string[][], (value: string[][]) => void];
}
