import { useMstShips, useMstSlotItems, useMstStypes, useShips, useSlotItems } from '../utility/provider.tsx';

import "../css/divider.css";
import { createEffect, createMemo, createSignal, For, JSX, Match, Show, Switch } from 'solid-js';
import IconChevronRight from '../icons/chevron_right.tsx';
import { ShipNameComponent } from './ship_name.tsx';
import { createStore } from 'solid-js/store';

import "./../css/table_hover.css";
import "./../css/table_active.css";
import IconUpArrow from '../icons/up_arrow.tsx';
import IconDownArrow from '../icons/down_arrow.tsx';
import { EquimentComponent } from './equipment.tsx';

export function EquipmentListComponent() {
    
    const [ships, ] =  useShips();
    const [mst_ships, ] = useMstShips();
    const [mst_stypes, ] = useMstStypes();
    const [slot_items, ] = useSlotItems();
    const [mst_slot_items, ] = useMstSlotItems();
    
    // const speed_list = ["", "", "", "", "", "Slow", "", "", "", "", "Fast", "", "", "", "", "Fast+", "", "", "", "", "Fastest"];
    // const range_list = ["", "Short", "Medium", "Long", "Very Long"];
    // const ship_properties = ["Level", "Durability", "Firepower", "Torpedo", "Anti-Air", "Speed", "Armor", "Evasion", "Anti-Submarine", "Luck", "Aircraft installed", "Reconnaissance", "Range"];

    // const [check_stype, set_check_stype] = createStore<{[key: string]: boolean}>({});
    // createEffect(() => {
    //     let check_stype: {[key: string]: boolean} = {};
    //     Object.entries(mst_stypes.mst_stypes).forEach(([_, stype]) => {
    //         check_stype[stype.name] = true;
    //     });
    //     set_check_stype(check_stype);
    // });

    // const [check_name, set_check_name] = createStore<{[key: number]: boolean}>({});
    // createEffect(() => {
    //     let check_name: {[key: number]: boolean} = {};
    //     Object.entries(ships.ships).forEach(([ship_id, _]) => {
    //         check_name[Number(ship_id)] = true;
    //     });
    //     set_check_name(check_name);
    // });

    // const [check_ship_propaty, set_check_ship_propaty] = createStore<{[key: string]: boolean}>((
    //     () => {
    //         let check_ship_propaty: {[key: string]: boolean} = {};
    //         check_ship_propaty["Ship Type"] = true;
    //         ship_properties.forEach((propaty) => {
    //             check_ship_propaty[propaty] = true;
    //         });
    //         return check_ship_propaty;
    //     }
    // )());

    const [set_order, set_set_order] = createSignal(false);
    const [set_sort, set_set_sort] = createSignal("New");

    const sort_fn = (a: string, b: string) => {
        if (set_sort() == "New") return 0;
        let a_ship = ships.ships[Number(a)];
        let b_ship = ships.ships[Number(b)];
        // if (set_sort() == "Level") return a_ship.lv - b_ship.lv;
        // if (set_sort() == "Durability") return a_ship.maxhp - b_ship.maxhp;
        // if (set_sort() == "Firepower") return a_ship.karyoku[0] - b_ship.karyoku[0];
        // if (set_sort() == "Torpedo") return a_ship.raisou[0] - b_ship.raisou[0];
        // if (set_sort() == "Anti-Air") return a_ship.taiku[0] - b_ship.taiku[0];
        // if (set_sort() == "Speed") return a_ship.soku - b_ship.soku;
        // if (set_sort() == "Armor") return a_ship.soukou[0] - b_ship.soukou[0];
        // if (set_sort() == "Evasion") return a_ship.kaihi[0] - b_ship.kaihi[0];
        // if (set_sort() == "Anti-Submarine") return a_ship.taisen[0] - b_ship.taisen[0];
        // if (set_sort() == "Luck") return a_ship.lucky[0] - b_ship.lucky[0];
        // if (set_sort() == "Aircraft installed") return mst_ships.mst_ships[a_ship.ship_id]?.maxeq.reduce((a, b) => a + b, 0) - mst_ships.mst_ships[b_ship.ship_id]?.maxeq.reduce((a, b) => a + b, 0);
        // if (set_sort() == "Reconnaissance") return a_ship.sakuteki[0] - b_ship.sakuteki[0];
        // if (set_sort() == "Range") return a_ship.leng - b_ship.leng;
        return 0;
    }

    const sorted_slot_item_keys = createMemo(() => {
        let keys = Object.keys(slot_items.slot_items);
        if (set_order()) keys = keys.reverse();
        keys = keys.sort(sort_fn);
        console.log(keys);
        return keys;
    });

    // const [range_props, set_range_props] = createStore<{[key: string]: {min: number, max: number, eq: number, range: boolean, abbreviation: string}}>((
    //     () => {
    //         let range_props: {[key: string]: {min: number, max: number, eq: number, range: boolean, abbreviation: string}} = {};
    //         let params = ship_properties;
    //         let abbreviations = ["Lv", "Dur", "Fire", "Tor", "AA", "Spd", "Arm", "Eva", "ASW", "Lck", "ACI", "Rec", "Rng"];
    //         params.forEach((param, index) => {
    //             range_props[param] = {min: 0, max: 0, eq: 0, range: true, abbreviation: abbreviations[index]};
    //         });
    //         return range_props;
    //     }
    // )());

    // const filtered_ships = createMemo<{[key: number]:boolean}>(() => {

    //     const check_range = (param: string, value: number) => {
    //         if (range_props[param].range) {
    //             if (Number.isInteger(range_props[param].min) && range_props[param].min != 0){
    //                 if (value < range_props[param].min) return false;
    //             }
    //             if (Number.isInteger(range_props[param].max) && range_props[param].max != 0){
    //                 if (value > range_props[param].max) return false;
    //             }
    //         } else {
    //             if (!Number.isInteger(range_props[param].eq)) return false;
    //             if (value != range_props[param].eq) return false;
    //         }
    //         return true;
    //     };

    //     let ret: {[key: number]: boolean} = {};
    //     (set_order() ? Object.keys(ships.ships) : Object.keys(ships.ships).reverse()).forEach((ship_id) => {
    //         ret[Number(ship_id)] = (() => {
    //             if (!check_stype[mst_stypes.mst_stypes[mst_ships.mst_ships[ships.ships[Number(ship_id)].ship_id].stype].name]) return false;
    //             if (!check_name[Number(ship_id)]) return false;
    //             if (!check_range("Level", ships.ships[Number(ship_id)].lv)) return false;
    //             if (!check_range("Durability", ships.ships[Number(ship_id)].maxhp)) return false;
    //             if (!check_range("Firepower", ships.ships[Number(ship_id)].karyoku[0])) return false;
    //             if (!check_range("Torpedo", ships.ships[Number(ship_id)].raisou[0])) return false;
    //             if (!check_range("Anti-Air", ships.ships[Number(ship_id)].taiku[0])) return false;
    //             if (!check_range("Speed", ships.ships[Number(ship_id)].soku)) return false;
    //             if (!check_range("Armor", ships.ships[Number(ship_id)].soukou[0])) return false;
    //             if (!check_range("Evasion", ships.ships[Number(ship_id)].kaihi[0])) return false;
    //             if (!check_range("Anti-Submarine", ships.ships[Number(ship_id)].taisen[0])) return false;
    //             if (!check_range("Luck", ships.ships[Number(ship_id)].lucky[0])) return false;
    //             if (!check_range("Aircraft installed", ships.ships[Number(ship_id)].slotnum)) return false;
    //             if (!check_range("Reconnaissance", ships.ships[Number(ship_id)].sakuteki[0])) return false;
    //             if (!check_range("Range", ships.ships[Number(ship_id)].leng)) return false;
    //         return true;
    //         })();
    //     });
    //     return ret;
    // });

    // const set_range_window = createMemo(() => {
    //     let set_range_element: {[key: string]: JSX.Element} = {};
    //     let params = ["Level", "Durability", "Firepower", "Torpedo", "Anti-Air", "Armor", "Evasion", "Anti-Submarine", "Luck", "Aircraft installed", "Reconnaissance"];
    //     params.forEach((param) => {

    //         set_range_element[param] = (
    //             <div class="dropdown dropdown-end">
    //                 <div class="indicator">
    //                     <Show when={(
    //                         () => {
    //                             let ret = false;
    //                             if (range_props[param].range) {
    //                                 if (Number.isInteger(range_props[param].min) && range_props[param].min != 0) ret = true;
    //                                 if (Number.isInteger(range_props[param].max) && range_props[param].max != 0) ret = true;
    //                             } else {
    //                                 if (Number.isInteger(range_props[param].eq)) ret = true;
    //                             }
    //                             return ret;
    //                         }
    //                     )()}>
    //                         <span class="indicator-item badge badge-secondary badge-xs -mx-2">filtered</span>
    //                     </Show>
    //                     <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">{param}</div>
    //                 </div>
    //                 <div tabindex="0" class="dropdown-content card card-compact bg-base-100 z-[1] w-64 shadow rounded-md">
    //                     <div class="card-body">
    //                         <div class="form-control">
    //                             <label class="label cursor-pointer relative">
    //                                 <input type="radio" name="radio-Level" class="radio radio-sm" checked={range_props[param].range} onClick={() => set_range_props(param, "range", true)} />
    //                                 <span class="label-text text-sm">
    //                                     <input type="text" placeholder="Min" class="input input-sm input-bordered w-14" onInput={(e) => set_range_props(param, "min", Number(e.target.value))}/> &#8804; {range_props[param].abbreviation} &#8804; <input type="text" placeholder="Max" class="input input-sm input-bordered w-14" onInput={(e) => set_range_props(param, "max", Number(e.target.value))}/>
    //                                     <Show when={!Number.isInteger(range_props[param].max)}>
    //                                         <div class="label absolute -bottom-4 right-0">
    //                                             <span class="label-text-alt text-error">Input Number</span>
    //                                         </div>
    //                                     </Show>
    //                                     <Show when={!Number.isInteger(range_props[param].min)}>
    //                                         <div class="label absolute -bottom-4 right-[116px]">
    //                                             <span class="label-text-alt text-error">Input Number</span>
    //                                         </div>
    //                                     </Show>
    //                                 </span>
    //                             </label>
    //                         </div>
    //                         <div class="divider my-0.5">OR</div>
    //                         <div class="form-control">
    //                             <label class="label cursor-pointer relative">
    //                                 <input type="radio" name="radio-Level" class="radio radio-sm" checked={!range_props[param].range} onClick={() => set_range_props(param, "range", false)} />
    //                                 <span class="label-text text-sm">
    //                                     {range_props[param].abbreviation} = <input type="text" placeholder="Eq" class="input input-sm input-bordered w-32" onInput={(e) => set_range_props(param, "eq", Number(e.target.value))}/>
    //                                     <Show when={!Number.isInteger(range_props[param].eq)}>
    //                                         <div class="label absolute -bottom-4 right-0">
    //                                             <span class="label-text-alt text-error">Input Number</span>
    //                                         </div>
    //                                     </Show>
    //                                 </span>
    //                             </label>
    //                         </div>
    //                     </div>
    //                 </div>
    //             </div>
    //         );
    //     });
    //     return set_range_element;
    // });

    
    // const set_discrete_range_window = createMemo(() => {
    //     let set_range_element: {[key: string]: JSX.Element} = {};
    //     let params = ["Speed", "Range"];
    //     let params_option = [
    //         ["None", "Slow", "Fast", "Fast+", "Fastest"],
    //         ["None", "Short", "Medium", "Long", "Very Long"]
    //     ];
    //     let param_converter = [
    //         ["None", "", "", "", "", "Slow", "", "", "", "", "Fast", "", "", "", "", "Fast+", "", "", "", "", "Fastest"],
    //         ["None", "Short", "Medium", "Long", "Very Long"]
    //     ]
    //     params.forEach((param, param_index) => {
    //         set_range_element[param] = (
    //             <div class="dropdown dropdown-end">
    //                 <div class="indicator">
    //                     <Show when={(
    //                         () => {
    //                             let ret = false;
    //                             if (range_props[param].range) {
    //                                 if (Number.isInteger(range_props[param].min) && range_props[param].min != 0) ret = true;
    //                                 if (Number.isInteger(range_props[param].max) && range_props[param].max != 0) ret = true;
    //                             } else {
    //                                 if (Number.isInteger(range_props[param].eq)) ret = true;
    //                             }
    //                             return ret;
    //                         }
    //                     )()}>
    //                         <span class="indicator-item badge badge-secondary badge-xs -mx-2">filtered</span>
    //                     </Show>
    //                     <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">{param}</div>
    //                 </div>
    //                 <div tabindex="0" class="dropdown-content card card-compact bg-base-100 z-[1] w-80 shadow rounded-md">
    //                     <div class="card-body">
    //                         <div class="form-control">
    //                             <label class="label cursor-pointer relative">
    //                                 <input type="radio" name="radio-Level" class="radio radio-sm" checked={range_props[param].range} onClick={() => set_range_props(param, "range", true)} />
    //                                 <span class="label-text text-sm">
    //                                     <select class="select select-bordered select-sm w-24 mx-2" onChange={(e) => set_range_props(param, "min", param_converter[param_index].findIndex((param_select) => param_select == e.target.value))}>
    //                                         <For each={params_option[param_index]}>
    //                                             {(param_select) => 
    //                                                 <>
    //                                                     <option>{param_select}</option>
    //                                                 </>
    //                                             }
    //                                         </For>
    //                                     </select>
    //                                     &#8804; {range_props[param].abbreviation} &#8804;
    //                                     <select class="select select-bordered select-sm w-24 mx-2" onChange={(e) => set_range_props(param, "max", param_converter[param_index].findIndex((param_select) => param_select == e.target.value))}>
    //                                         <For each={params_option[param_index]}>
    //                                             {(param_select) => 
    //                                                 <>
    //                                                     <option>{param_select}</option>
    //                                                 </>
    //                                             }
    //                                         </For>
    //                                     </select>
    //                                 </span>
    //                             </label>
    //                         </div>
    //                         <div class="divider my-0.5">OR</div>
    //                         <div class="form-control">
    //                             <label class="label cursor-pointer relative">
    //                                 <input type="radio" name="radio-Level" class="radio radio-sm" checked={!range_props[param].range} onClick={() => set_range_props(param, "range", false)} />
    //                                 <span class="label-text text-sm">
    //                                     {range_props[param].abbreviation} = 
    //                                     <select class="select select-bordered select-sm w-52" onChange={(e) => set_range_props(param, "eq", param_converter[param_index].findIndex((param_select) => param_select == e.target.value))}>
    //                                         <For each={params_option[param_index]}>
    //                                             {(param_select) => 
    //                                                 <>
    //                                                     <option>{param_select}</option>
    //                                                 </>
    //                                             }
    //                                         </For>
    //                                     </select>
    //                                 </span>
    //                             </label>
    //                         </div>
    //                     </div>
    //                 </div>
    //             </div>
    //         );
    //     });
    //     return set_range_element;
    // });

    return (
        <>
            {/* <div class="h-px"></div>
            <div class="px-2 py-1 text-xs flex flex-nowrap items-center">
                Ship Specification Table
                <IconChevronRight class="h-4 w-4 mx-2" />
                <details class="dropdown">
                    <summary class="btn btn-xs btn-ghost">select properties</summary>
                    <ul tabindex="0" class="dropdown-content menu menu-xs bg-base-100 rounded-md z-[1]  shadow flex">
                        <For each={Object.keys(check_ship_propaty)}>
                            {(prop) => (
                                <li class="flex-col w-32">
                                    <a>
                                        <div class="form-control">
                                            <label class="label cursor-pointer py-0">
                                                <input type="checkbox" checked={check_ship_propaty[prop]} class="checkbox checkbox-sm" onClick={() => {set_check_ship_propaty(prop, !check_ship_propaty[prop])}} />
                                                <span class="label-text text-xs pl-2">
                                                    {prop}
                                                </span>
                                            </label>
                                        </div>
                                    </a>
                                </li>
                            )}
                        </For>
                    </ul>
                </details>
            </div> */}
            {/* <div class="h-2"></div> */}
            <table class="table table-xs">
                {/* <thead>
                    <tr class="flex"> */}
                        {/* <th class="w-10 flex">
                            <div class="dropdown">
                                <div class="indicator">
                                    <span class="indicator-item badge badge-secondary badge-xs -mx-2 max-w-16 truncate flex justify-start">
                                        <Switch fallback="">
                                            <Match when={set_order()}>▲</Match>
                                            <Match when={!set_order()}>▼</Match>
                                        </Switch>
                                        {set_sort()}
                                    </span>
                                    <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">No</div>
                                </div>
                                <div tabindex="0" class="dropdown-content card card-compact bg-base-100 z-[1] w-72 shadow rounded-md">
                                    <div class="card-body ">
                                        <table class="table table-sm">
                                            <tbody>
                                                <tr class="flex" style={"border-bottom-width: 0px"}>
                                                    <td class="flex-1">order</td>
                                                    <td class="flex-none h-6">
                                                        <label class="swap swap-rotate">
                                                            <input type="checkbox" onClick={(e) => set_set_order(e.currentTarget.checked)}/>
                                                            <div class="swap-on flex flex-nowrap items-center">
                                                                <IconUpArrow class="h-6 w-6"></IconUpArrow>
                                                                <div class="label-text text-xs">ASC</div>
                                                            </div>
                                                            <div class="swap-off flex flex-nowrap items-center">
                                                                <IconDownArrow class="h-6 w-6"></IconDownArrow>
                                                                <div class="label-text text-xs">DESC</div>
                                                            </div>
                                                        </label>
                                                    </td>
                                                </tr>
                                                <tr class="flex items-center" style={"border-bottom-width: 0px"}>
                                                    <td class="flex-1">sort parameters</td>
                                                    <td class="flex-none">
                                                        <select class="select select-bordered select-sm w-28" onChange={(e) => set_set_sort(e.target.value)}>
                                                            <option>New</option>
                                                            <For each={ship_properties}>
                                                                {(propaty) => (
                                                                    <option>{propaty}</option>
                                                                )}
                                                            </For>
                                                        </select>
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </th>
                        <th class="w-32">
                            <div class="dropdown">
                                <div class="indicator">
                                    <Show when={Object.values(check_name).findIndex((value) => !value) != -1}>
                                        <span class="indicator-item badge badge-secondary badge-xs -mx-2">filtered</span>
                                    </Show>
                                    <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">Ship Name</div>
                                </div>
                                <div tabindex="0" class="dropdown-content card card-compact bg-base-100 z-[1] w-72 shadow rounded-md">
                                    <div class="card-body ">
                                        <label class="input input-sm input-bordered flex items-center gap-2">
                                            <input type="text" class="grow" placeholder="Search Name" onChange={(e) => {
                                                let search_name = e.target.value;
                                                Object.entries(ships.ships).forEach(([ship_id, ship]) => {
                                                    if (mst_ships.mst_ships[ship.ship_id].name.indexOf(search_name) != -1) {
                                                        set_check_name(Number(ship_id), true);
                                                    } else {
                                                        set_check_name(Number(ship_id), false);
                                                    }
                                                });
                                            }}/>
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 16 16"
                                                fill="currentColor"
                                                class="h-4 w-4 opacity-70">
                                                <path
                                                fill-rule="evenodd"
                                                d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
                                                clip-rule="evenodd" />
                                            </svg>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </th>
                        <Show when={check_ship_propaty["Ship Type"]}>
                            <th class="w-[88px]">
                                <div class="dropdown">
                                    <div class="indicator">
                                        <Show when={Object.values(check_stype).findIndex((value) => !value) != -1}>
                                            <span class="indicator-item badge badge-secondary badge-xs -mx-2">filtered</span>
                                        </Show>
                                        <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">Ship Type</div>
                                    </div>
                                    <ul tabindex="0" class="dropdown-content menu menu-xs bg-base-100 rounded-md z-[1]  shadow max-h-64 overflow-x-scroll flex">
                                        <For each={Object.keys(check_stype)}>
                                            {(stype_name) => (
                                                <li class="flex-col w-32">
                                                    <a>
                                                        <div class="form-control">
                                                            <label class="label cursor-pointer py-0">
                                                                <input type="checkbox" checked={check_stype[stype_name]} class="checkbox checkbox-sm" onClick={() => {set_check_stype(stype_name, !check_stype[stype_name])}} />
                                                                <span class="label-text text-xs pl-2">
                                                                    {stype_name}
                                                                </span>
                                                            </label>
                                                        </div>
                                                    </a>
                                                </li>
                                            )}
                                        </For>
                                    </ul>
                                </div>
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Level"]}>
                            <th class="w-12 flex">
                                <span class="flex-1"></span>
                                {set_range_window()["Level"]}
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Durability"]}>
                            <th class="w-[72px] flex">
                                <span class="flex-1"></span>
                                {set_range_window()["Durability"]}
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Firepower"]}>
                            <th class="w-[72px] flex">
                                <span class="flex-1"></span>
                                {set_range_window()["Firepower"]}
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Torpedo"]}>
                            <th class="w-16 flex">
                                <span class="flex-1"></span>
                                {set_range_window()["Torpedo"]}
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Anti-Air"]}>
                            <th class="w-16 flex">
                                <span class="flex-1"></span>
                                {set_range_window()["Anti-Air"]}
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Speed"]}>
                            <th class="w-14">{set_discrete_range_window()["Speed"]}</th>
                        </Show>
                        <Show when={check_ship_propaty["Armor"]}>
                            <th class="w-14 flex">
                                <span class="flex-1"></span>
                                {set_range_window()["Armor"]}
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Evasion"]}>
                            <th class="w-16 flex">
                                <span class="flex-1"></span>
                                {set_range_window()["Evasion"]}
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Anti-Submarine"]}>
                            <th class="w-24 flex">
                                <span class="flex-1"></span>
                                {set_range_window()["Anti-Submarine"]}
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Luck"]}>
                            <th class="w-12 flex">
                                <span class="flex-1"></span>
                                {set_range_window()["Luck"]}
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Aircraft installed"]}>
                            <th class="w-28 flex">
                                <span class="flex-1"></span>
                                {set_range_window()["Aircraft installed"]}
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Reconnaissance"]}>
                            <th class="w-24 flex">
                                <span class="flex-1"></span>
                                {set_range_window()["Reconnaissance"]}
                            </th>
                        </Show>
                        <Show when={check_ship_propaty["Range"]}>
                            <th class="w-16">{set_discrete_range_window()["Range"]}</th>
                        </Show> */}
                    {/* </tr>
                </thead> */}
                <tbody>
                    <For each={sorted_slot_item_keys()}>
                        {(slot_item_id, index) => (
                            // <Show when={filtered_ships()[Number(ship_id)] ?? false}>
                                <tr class="flex table_hover table_active rounded">
                                    <th class="w-10 flex">
                                        <span class="flex-1"></span>
                                        {index() + 1}
                                    </th>
                                    <td class="w-48 overflow-hidden">
                                        <EquimentComponent slot_id={Number(slot_item_id)} ex_flag={false} name_flag={true} />
                                    </td>
                                    {/* <Show when={check_ship_propaty["Ship Type"]}>
                                        <td class="w-[88px]">{mst_stypes.mst_stypes[mst_ships.mst_ships[ships.ships[Number(ship_id)].ship_id].stype].name}</td>
                                    </Show>
                                    <Show when={check_ship_propaty["Level"]}>
                                        <td class="w-12">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].lv}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_propaty["Durability"]}>
                                        <td class="w-[72px]">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].maxhp}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_propaty["Firepower"]}>
                                        <td class="w-[72px]">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].karyoku[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_propaty["Torpedo"]}>
                                        <td class="w-16">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].raisou[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_propaty["Anti-Air"]}>
                                        <td class="w-16">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].taiku[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_propaty["Speed"]}>
                                        <td class="w-14">
                                            <div class="w-6 flex justify-self-center">
                                                {speed_list[ships.ships[Number(ship_id)].soku]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_propaty["Armor"]}>
                                        <td class="w-14">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].soukou[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_propaty["Evasion"]}>
                                        <td class="w-16">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].kaihi[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_propaty["Anti-Submarine"]}>
                                        <td class="w-24">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].taisen[0]}
                                            </div>
                                        </td>   
                                    </Show>
                                    <Show when={check_ship_propaty["Luck"]}>
                                        <td class="w-12">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].lucky[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_propaty["Aircraft installed"]}>
                                        <td class="w-28">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_ships.mst_ships[ships.ships[Number(ship_id)]?.ship_id]?.maxeq.reduce((a, b) => a + b, 0)}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_propaty["Reconnaissance"]}>
                                        <td class="w-24">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].sakuteki[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_propaty["Range"]}>
                                        <td class="w-16">
                                            <div class="w-16 flex justify-self-center">
                                                {range_list[ships.ships[Number(ship_id)].leng]}
                                            </div>
                                        </td>
                                    </Show> */}
                                </tr>
                            // </Show>
                        )}
                    </For>
                </tbody>
            </table>
        </>
    );
};