import type { JSX } from "solid-js";
import { createContext, useContext, createEffect, onCleanup } from "solid-js";
import type { Part, SetStoreFunction } from "solid-js/store";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { safeTauriInvoke, safeTauriListen } from "./tauri";
import { APP_EVENTS } from "./app_events";
import type { QuestCacheState } from "./quest_cache";
import {
  applyQuestEventToState,
  createEmptyQuestCacheState,
  mergeQuestState,
} from "./quest_cache";

import type { DeckPorts, Materials, Ship, Ships } from "@ipc-bindings/port";
import type { QuestEvent, Quests } from "@ipc-bindings/quest";
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
  MstUseItemMetas,
  MstUseItems,
} from "@ipc-bindings/get_data";
import {
  default_mst_equip_exslot_ships,
  default_mst_equip_ships,
  default_mst_ships,
  default_mst_slot_items,
  default_mst_slotitem_equip_types,
  default_mst_stypes,
  default_mst_useitem_metas,
  default_mst_useitems,
} from "@ipc-bindings/default_state/get_data";

import type { PayItems, SlotItems, UseItems } from "@ipc-bindings/require_info";
import {
  default_payitems,
  default_slotitems,
  default_useitems,
} from "@ipc-bindings/default_state/require_info";

import type { Cell, Cells } from "@ipc-bindings/cells";
import { default_cells } from "@ipc-bindings/default_state/cells";

import type { AirBases } from "@ipc-bindings/map_info";
import { default_air_bases } from "@ipc-bindings/default_state/map_info";

import type { Battle } from "@ipc-bindings/battle";

export const ShipsContext =
  createContext<(Ships | SetStoreFunction<Ships>)[]>();

export function ShipsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<Ships>(default_ships);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten_set = safeTauriListen<Ships>(
      APP_EVENTS.SetKcsShips,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsShips);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_ships");
      },
    );
    const unlisten_add = safeTauriListen<Ships>(
      APP_EVENTS.AddKcsShips,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.AddKcsShips);
        Object.entries(event.payload.ships).forEach(([key1, value1]) => {
          if (value1) {
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
          }
        });
      },
    );
    onCleanup(() => {
      unlisten_set();
      unlisten_add();
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
  const [data, setData] = createStore<MstShips>(default_mst_ships);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<MstShips>(
      APP_EVENTS.SetKcsMstShips,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsMstShips);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_mst_ships");
      },
    );
    onCleanup(unlisten);
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
  const [data, setData] = createStore<SlotItems>(default_slotitems);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<SlotItems>(
      APP_EVENTS.SetKcsSlotItems,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsSlotItems);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_slot_items");
      },
    );
    onCleanup(unlisten);
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
  const [data, setData] = createStore<MstSlotItems>(default_mst_slot_items);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<MstSlotItems>(
      APP_EVENTS.SetKcsMstSlotItems,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsMstSlotItems);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_mst_slot_items");
      },
    );
    onCleanup(unlisten);
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
    default_mst_equip_exslot_ships,
  );
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<MstEquipExslotShips>(
      APP_EVENTS.SetKcsMstEquipExslotShips,
      (event) => {
        if (import.meta.env.DEV)
          console.log(APP_EVENTS.SetKcsMstEquipExslotShips);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_mst_equip_exslot_ships");
      },
    );
    onCleanup(unlisten);
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
    default_mst_slotitem_equip_types,
  );
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<MstSlotItemEquipTypes>(
      APP_EVENTS.SetKcsMstSlotItemEquipTypes,
      (event) => {
        if (import.meta.env.DEV)
          console.log(APP_EVENTS.SetKcsMstSlotItemEquipTypes);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_mst_slotitem_equip_types");
      },
    );
    onCleanup(unlisten);
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
    SetStoreFunction<MstSlotItemEquipTypes>,
  ];
}

const MstEquipShipsContext =
  createContext<(MstEquipShips | SetStoreFunction<MstEquipShips>)[]>();

export function MstEquipShipsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<MstEquipShips>(default_mst_equip_ships);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<MstEquipShips>(
      APP_EVENTS.SetKcsMstEquipShips,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsMstEquipShips);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_mst_equip_ships");
      },
    );
    onCleanup(unlisten);
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
  const [data, setData] = createStore<MstStypes>(default_mst_stypes);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<MstStypes>(
      APP_EVENTS.SetKcsMstStypes,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsMstStypes);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_mst_stypes");
      },
    );
    onCleanup(unlisten);
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

export const MstUseItemsContext =
  createContext<(MstUseItems | SetStoreFunction<MstUseItems>)[]>();

export function MstUseItemsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<MstUseItems>(default_mst_useitems);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<MstUseItems>(
      APP_EVENTS.SetKcsMstUseItems,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsMstUseItems);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_mst_useitems");
      },
    );
    onCleanup(unlisten);
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

export const MstUseItemMetasContext =
  createContext<(MstUseItemMetas | SetStoreFunction<MstUseItemMetas>)[]>();

export function MstUseItemMetasProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<MstUseItemMetas>(
    default_mst_useitem_metas,
  );
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<MstUseItemMetas>(
      APP_EVENTS.SetKcsMstUseItemMetas,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsMstUseItemMetas);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_mst_useitem_metas");
      },
    );
    onCleanup(unlisten);
  });

  return (
    <MstUseItemMetasContext.Provider value={setter}>
      {props.children}
    </MstUseItemMetasContext.Provider>
  );
}

export function useMstUseItemMetas() {
  const context = useContext(MstUseItemMetasContext);
  if (!context) {
    throw new Error("useMstUseItemMetas: cannot find a MstUseItemMetasContext");
  }
  return context as [MstUseItemMetas, SetStoreFunction<MstUseItemMetas>];
}

export const UseItemsContext =
  createContext<(UseItems | SetStoreFunction<UseItems>)[]>();

export function UseItemsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<UseItems>(default_useitems);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<UseItems>(
      APP_EVENTS.SetKcsUseItems,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsUseItems);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_use_items");
      },
    );
    onCleanup(unlisten);
  });

  return (
    <UseItemsContext.Provider value={setter}>
      {props.children}
    </UseItemsContext.Provider>
  );
}

export function useUseItems() {
  const context = useContext(UseItemsContext);
  if (!context) {
    throw new Error("useUseItems: cannot find a UseItemsContext");
  }
  return context as [UseItems, SetStoreFunction<UseItems>];
}

export const PayItemsContext =
  createContext<(PayItems | SetStoreFunction<PayItems>)[]>();

export function PayItemsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<PayItems>(default_payitems);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<PayItems>(
      APP_EVENTS.SetKcsPayItems,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsPayItems);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_pay_items");
      },
    );
    onCleanup(unlisten);
  });

  return (
    <PayItemsContext.Provider value={setter}>
      {props.children}
    </PayItemsContext.Provider>
  );
}

export function usePayItems() {
  const context = useContext(PayItemsContext);
  if (!context) {
    throw new Error("usePayItems: cannot find a PayItemsContext");
  }
  return context as [PayItems, SetStoreFunction<PayItems>];
}

export const MaterialsContext =
  createContext<(Materials | SetStoreFunction<Materials>)[]>();

export function MaterialsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<Materials>(default_materials);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten_data_set = safeTauriListen<Materials>(
      APP_EVENTS.SetKcsMaterials,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsMaterials);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_materials");
      },
    );
    const unlisten_data_add = safeTauriListen<Materials>(
      APP_EVENTS.AddKcsMaterials,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.AddKcsMaterials);
        Object.entries(event.payload).forEach(([key, value]) => {
          if (value !== null) {
            setData(key as Part<Materials, keyof Materials>, value);
          }
        });
      },
    );

    onCleanup(() => {
      unlisten_data_set();
      unlisten_data_add();
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

export const QuestsContext =
  createContext<(QuestCacheState | SetStoreFunction<QuestCacheState>)[]>();

export function QuestsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<QuestCacheState>(
    createEmptyQuestCacheState(),
  );
  const setter = [data, setData];

  createEffect(() => {
    const unlistenSet = safeTauriListen<Quests>(
      APP_EVENTS.SetKcsQuests,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsQuests);
        setData(reconcile(mergeQuestState(unwrap(data), event.payload)));
      },
      () => {
        void safeTauriInvoke("get_quests");
      },
    );
    const unlistenEvent = safeTauriListen<QuestEvent>(
      APP_EVENTS.AddKcsQuestEvent,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.AddKcsQuestEvent);
        setData(reconcile(applyQuestEventToState(unwrap(data), event.payload)));
      },
    );
    onCleanup(() => {
      unlistenSet();
      unlistenEvent();
    });
  });

  return (
    <QuestsContext.Provider value={setter}>
      {props.children}
    </QuestsContext.Provider>
  );
}

export function useQuests() {
  const context = useContext(QuestsContext);
  if (!context) {
    throw new Error("useQuests: cannot find a QuestsContext");
  }
  return context as [QuestCacheState, SetStoreFunction<QuestCacheState>];
}

export const DeckPortsContext =
  createContext<(DeckPorts | SetStoreFunction<DeckPorts>)[]>();

export function DeckPortsProvider(props: { children: JSX.Element }) {
  const [data, setData] = createStore<DeckPorts>(default_deck_ports);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<DeckPorts>(
      APP_EVENTS.SetKcsDeckPorts,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsDeckPorts);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_deck_ports");
      },
    );
    onCleanup(unlisten);
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
    JSON.parse(JSON.stringify(default_deck_ports)),
  );
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<DeckPorts>(
      APP_EVENTS.SetKcsDeckBattles,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsDeckBattles);
        setData(event.payload);
        if (import.meta.env.DEV) console.log(event.payload);
      },
    );
    onCleanup(unlisten);
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
    JSON.parse(JSON.stringify(default_cells)),
  );
  const setter = [data, setData];

  createEffect(() => {
    const unlisten_cells = safeTauriListen<Cells>(
      APP_EVENTS.SetKcsCells,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsCells);
        setData(event.payload);
      },
    );

    const unlisten_add_cell = safeTauriListen<Cell>(
      APP_EVENTS.AddKcsCell,
      // eslint-disable-next-line solid/reactivity
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.AddKcsCell);
        setData("cells", event.payload.no, event.payload);
        setData("cell_index", data.cell_index.length, event.payload.no);
      },
    );
    const unlisten_battle = safeTauriListen<Battle>(
      APP_EVENTS.AddKcsBattle,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.AddKcsBattle);
        setData("battles", event.payload.cell_id, event.payload);
      },
    );

    onCleanup(() => {
      unlisten_cells();
      unlisten_add_cell();
      unlisten_battle();
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
  const [data, setData] = createStore<AirBases>(default_air_bases);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<AirBases>(
      APP_EVENTS.SetKcsAirBasesPorts,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsAirBasesPorts);
        setData(reconcile(event.payload));
      },
      () => {
        void safeTauriInvoke("get_air_bases_ports");
      },
    );
    onCleanup(unlisten);
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
    JSON.parse(JSON.stringify(default_air_bases)),
  );
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<AirBases>(
      APP_EVENTS.SetKcsAirBasesBattles,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetKcsAirBasesBattles);
        setData(event.payload);
        if (import.meta.env.DEV) console.log(event.payload);
      },
    );
    onCleanup(unlisten);
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

type DebugApiContextType = string[][];

export const DebugApiContext =
  createContext<
    (DebugApiContextType | SetStoreFunction<DebugApiContextType>)[]
  >();

export function DebugApiProvider(props: { children: JSX.Element }) {
  const store_data: DebugApiContextType = [[], []];
  const [data, setData] = createStore(store_data);
  const setter = [data, setData];

  createEffect(() => {
    const unlisten = safeTauriListen<string[][]>(
      APP_EVENTS.SetDebugApiReadDir,
      (event) => {
        if (import.meta.env.DEV) console.log(APP_EVENTS.SetDebugApiReadDir);
        setData(event.payload);
      },
    );
    onCleanup(unlisten);
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
