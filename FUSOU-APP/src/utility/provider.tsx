import { createContext, useContext, JSX, createEffect, onCleanup } from "solid-js";
import { createStore, Part, unwrap } from "solid-js/store";
import { DeckPorts, Materials, Ships, global_deck_ports, global_materials, global_ships } from "../interface/port";
import { MstShips, MstSlotitems, global_mst_ships, global_mst_slot_items } from "../interface/get_data";
import { SlotItems, global_slotitems } from "../interface/require_info";
import { Battle, Battles, global_battle, global_battles } from "../interface/battle";
import { Cell, Cells, global_cells } from "../interface/cells";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { mergeObjects } from "./merge_object";
import { AirBases, global_air_bases } from "../interface/map_info";

const ShipsContext = createContext<(Ships | { set(data: Ships): void; })[]>();

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
        let unlisten_data_set: UnlistenFn;
        // let unlisten_data_add: UnlistenFn;
        (async() => {
            unlisten_data_set = await listen<Ships>('set-kcs-ships', event => {
                setData(event.payload);
            });
            // won't be worked
            // unlisten_data_add = await listen<Ships>('add-kcs-ships', event => {
            //     console.log('add-kcs-ships', event.payload);
            //     let target: Ships =  unwrap(data);
            //     // mergeObjects<Ships>(data, target);
            //     mergeObjects<Ships>(event.payload, target);
            //     setData(target);
            // });
        })();
        
        onCleanup(() => { 
            if (unlisten_data_set) unlisten_data_set();
            // if (unlisten_data_add) unlisten_data_add();
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
        throw new Error("useShips: cannot find a ShipsContext")
    }
    return context as [Ships, (value: Ships) => void];
}

const MstShipsContext = createContext<(MstShips | { set(data: MstShips):void; })[]>();

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
        throw new Error("useContext: cannot find a MstShipsContext")
    }
    return context as [MstShips, (value: MstShips) => void];
}

const SlotItemsContext = createContext<(SlotItems | {set(data: SlotItems): void; })[]>();

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
        throw new Error("useSlotItems: cannot find a SlotItemsContext")
    }
    return context as [SlotItems, (value: SlotItems) => void];
}

const MstSlotItemsContext = createContext<(MstSlotitems | { set(data: MstSlotitems): void; })[]>();

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
    throw new Error("useMstSlotItems: cannot find a MstSlotItemsContext")
  }
  return context as [MstSlotitems, (value: MstSlotitems) => void];
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
        
        onCleanup(() => { 
            if (unlisten_data) unlisten_data();
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
      throw new Error("useMaterials: cannot find a MaterialsContext")
    }
    return context as [Materials, (value: Materials) => void];
}

const DeckPortsContext = createContext<(DeckPorts | { set(data: DeckPorts): void; })[]>();

export function DeckPortsProvider(props: { children: JSX.Element }) {
    const [data, setData] = createStore(global_deck_ports);
    const setter = [
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
      throw new Error("useDeckPorts: cannot find a DeckPortsContext")
    }
    return context as [DeckPorts, (value: DeckPorts) => void];
}

// const BattleContext = createContext<(Battles | { set(data: Battles): void; })[]>();

// export function BattleContextProvider(props: { children: JSX.Element }) {
//     const [data, setData] = createStore(global_battles);
//     const setter = [
//         data,
//         {
//             set(data: Battles) {
//                 setData(data);
//             }
//         }
//     ];

//     createEffect(() => {
//         let unlisten_data_set: UnlistenFn;
//         let unlisten_data_add: UnlistenFn;
//         (async() => {
//             unlisten_data_set = await listen<Battles>('set-kcs-battles', event => {
//               setData(event.payload);
//             });
//             unlisten_data_add = await listen<Battle>('add-kcs-battle', event => {
//                 if (data.cells[data.cells.length - 1] == event.payload.cell_id) {
//                     Object.entries(event.payload).forEach(([key, value]) => {
//                         if ( value !== null && typeof value === 'object' ) {
//                             setData("battles", event.payload.cell_id, key as Part<Battle, keyof Battle>,  value);
//                         }
//                     });
//                 } else {
//                     setData("battles", event.payload.cell_id, event.payload);
//                     // need to change the method? but it works
//                     setData("cells", (cell_index: number[]) => {
//                         cell_index.push(event.payload.cell_id);
//                         let cell_index_copy : number[] = cell_index.slice();
//                         return cell_index_copy;
//                     });
//                 }
//             });
//         })();
        
//         onCleanup(() => { 
//             if (unlisten_data_set) unlisten_data_set();
//             if (unlisten_data_add) unlisten_data_add();
//         });
//     });

//     return (
//         <BattleContext.Provider value={setter}>
//             {props.children}
//         </BattleContext.Provider>
//     );
// }

// export function useBattles() {
//     const context = useContext(BattleContext);
//     if (!context) {
//       throw new Error("useBattle: cannot find a BattleContext")
//     }
//     return context as [Battles, (value: Battles) => void];
// }

const CellsContext = createContext<(Cells | { set(data: Cells): void; })[]>();

export function CellsContextProvider(props: { children: JSX.Element }) {
    const [data, setData] = createStore(global_cells);
    const setter = [
        data,
        {
            set(data: Cells) {
                setData(data);
            }
        }
    ];

    createEffect(() => {
        let unlisten_data_set_cells: UnlistenFn;
        let unlisten_data_add_cell: UnlistenFn;
        let unlisten_data_add_battle: UnlistenFn;
        (async() => {
            unlisten_data_set_cells = await listen<Cells>('set-kcs-cells', event => {
              setData(event.payload);
            });
            unlisten_data_add_cell = await listen<Cell>('add-kcs-cell', event => {
                setData("cells", event.payload.no, event.payload);
                setData("cell_index", data.cell_index.length, event.payload.no);
            });
            unlisten_data_add_battle = await listen<Battle>('add-kcs-battle', event => {
                // console.log('add-kcs-battle', data.cell_index, event.payload);
                if (event.payload.cell_id in Object.keys(data.battles)) {
                // if (data.cell_index[data.cell_index.length - 1] == event.payload.cell_id) {
                    Object.entries(event.payload).forEach(([key, value]) => {
                        if ( value !== null && typeof value === 'object' ) {
                            setData("battles", event.payload.cell_id, key as Part<Battle, keyof Battle>,  value);
                        }
                    });
                } else {
                    setData("battles", event.payload.cell_id, event.payload);
                }
            });
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
      throw new Error("useBattle: cannot find a CellsContext")
    }
    return context as [Cells, (value: Cells) => void];
}

const AirBasesContext = createContext<(AirBases | { set(data: AirBases): void; })[]>();

export function AirBasesProvider(props: { children: JSX.Element }) {
    const [data, setData] = createStore(global_air_bases);
    const setter = [
        data,
        {
            set(data: AirBases) {
                setData(data);
            }
        }
    ];

    createEffect(() => {
        let unlisten_data: UnlistenFn;
        (async() => {
            unlisten_data = await listen<AirBases>('set-kcs-air-bases', event => {
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
      throw new Error("useAirBases: cannot find a AirBasesContext")
    }
    return context as [AirBases, (value: AirBases) => void];
}