import { createContext, useContext, JSX, createEffect, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { DeckPorts, Materials, Ships, global_deck_port, global_materials, global_ships } from "../interface/port";
import { MstShips, MstSlotitems, global_mst_ships, global_mst_slot_items } from "../interface/get_data";
import { SlotItems, global_slotitems } from "../interface/require_info";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

const ShipsContext = createContext();

export function ShipsProvider(props: { children: JSX.Element }) {
    const [data, setData] = createStore(global_ships)
    const setter = [
        data,
        {
            set(data: Ships) {
                setData(data);
            }
        }
    ];

    createEffect(() => {
        console.log('ShipsProvider');
        let unlisten_data: UnlistenFn
        (async() => {
            unlisten_data = await listen<Ships>('set-kcs-ships', event => {
              setData(event.payload);
            });
        })();
        
        onCleanup(() => { unlisten_data(); });
    });

    return (
        <ShipsContext.Provider value={setter}>
            {props.children}
        </ShipsContext.Provider>
    );
}

export function useShips() {
    return useContext(ShipsContext);
}

const MstShipsContext = createContext();

export function MstShipsProvider(props: { children: JSX.Element }) {
    const [data, setData] = createStore(global_mst_ships);
    const setter = [
        data,
        {
            set(data: MstShips) {
                setData(data);
            }
        }
    ];
    
    createEffect(() => {
        let unlisten_data: UnlistenFn;
        (async() => {
            unlisten_data = await listen<MstShips>('set-kcs-mst-ships', event => {
              setData(event.payload);
            });
        })();
        
        onCleanup(() => { unlisten_data(); });
    });

    return (
        <MstShipsContext.Provider value={setter}>
            {props.children}
        </MstShipsContext.Provider>
    );
}

export function useMstShips() {
    return useContext(MstShipsContext);
}

const SlotItemsContext = createContext();

export function SlotItemsProvider(props: { children: JSX.Element }) {
    const [data, setData] = createStore(global_slotitems);
    const setter = [
        data,
        {
            set(data: SlotItems) {
                setData(data);
            }
        }
    ];

    createEffect(() => {
        let unlisten_data: UnlistenFn;
        (async() => {
            unlisten_data = await listen<SlotItems>('set-kcs-slot-items', event => {
              setData(event.payload);
            });
        })();
        
        onCleanup(() => { unlisten_data(); });
    });

    return (
        <SlotItemsContext.Provider value={setter}>
            {props.children}
        </SlotItemsContext.Provider>
    );
}

export function useSlotItems() {
    return useContext(SlotItemsContext);
}

const MstSlotItemsContext = createContext();

export function MstSlotItemsProvider(props: { children: JSX.Element }) {
    const [data, setData] = createStore(global_mst_slot_items);
    const setter = [
        data,
        {
            set(data: MstSlotitems) {
                setData(data);
            }
        }
    ];

    createEffect(() => {
        let unlisten_data: UnlistenFn;
        (async() => {
            unlisten_data = await listen<MstSlotitems>('set-kcs-mst-slot-items', event => {
              setData(event.payload);
            });
        })();
        
        onCleanup(() => { unlisten_data(); });
    });

    return (
        <MstSlotItemsContext.Provider value={setter}>
            {props.children}
        </MstSlotItemsContext.Provider>
    );
}

export function useMstSlotItems() {
  return useContext(MstSlotItemsContext);
}

const MaterialsContext = createContext<(Materials | { set(data: Materials): void; })[]>();

export function MaterialsProvider(props: { children: JSX.Element }) {
    const [data, setData] = createStore<Materials>(global_materials);
    const setter = [
        data,
        {
            set(data: Materials) {
                setData(data);
            }
        }
    ];

    createEffect(() => {
        let unlisten_data: UnlistenFn;
        (async() => {
            unlisten_data = await listen<Materials>('set-kcs-materials', event => {
              setData(event.payload);
            });
        })();
        
        onCleanup(() => { unlisten_data(); });
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
      throw new Error("useCounterContext: cannot find a CounterContext")
    }
    return context;
}

const DeckPortContext = createContext();

export function DeckPortProvider(props: { children: JSX.Element }) {
    const [data, setData] = createStore(global_deck_port);
    const count = [
        data,
        {
            set(data: DeckPorts) {
                setData(data);
            }
        }
    ];

    createEffect(() => {
        let unlisten_data: UnlistenFn;
        (async() => {
            unlisten_data = await listen<DeckPorts>('set-kcs-deck-ports', event => {
              setData(event.payload);
            });
        })();
        
        onCleanup(() => { unlisten_data(); });
    });

    return (
        <DeckPortContext.Provider value={count}>
            {props.children}
        </DeckPortContext.Provider>
    );
}

export function useDeckPort() {
    return useContext(DeckPortContext);
}