import { useMstShips, useMstStypes, useShips } from '../utility/provider.tsx';

import "../css/divider.css";
import { createEffect, createMemo, createSignal, For, JSX, Match, Show, Switch } from 'solid-js';
import IconChevronRightS from '../icons/chevron_right_s.tsx';
import { ShipNameComponent } from './ship_name.tsx';
import { createStore } from 'solid-js/store';

import "./../css/table_hover.css";
import "./../css/table_active.css";
import "./../css/menu_hover.css";
import "./../css/menu_active.css";
import "./../css/pagination.css";

import IconUpArrow from '../icons/up_arrow.tsx';
import IconDownArrow from '../icons/down_arrow.tsx';
import IconChevronDoubleLeft from '../icons/chevron_double_left.tsx';
import IconChevronDoubleRight from '../icons/chevron_double_right.tsx';
import { IconChevronLeft } from '../icons/chevron_left.tsx';
import IconChevronRight from '../icons/chevron_right.tsx';

export function ShipListComponent() {
    
    const [ships, ] =  useShips();
    const [mst_ships, ] = useMstShips();
    const [mst_stypes, ] = useMstStypes();
    
    const speed_list = ["", "", "", "", "", "Slow", "", "", "", "", "Fast", "", "", "", "", "Fast+", "", "", "", "", "Fastest"];
    const range_list = ["", "Short", "Medium", "Long", "Very Long"];
    const ship_properties = ["Level", "Durability", "Firepower", "Torpedo", "Anti-Air", "Speed", "Armor", "Evasion", "Anti-Submarine", "Luck", "Aircraft installed", "Reconnaissance", "Range"];

    const [check_stype, set_check_stype] = createStore<{[key: string]: boolean}>({});
    createEffect(() => {
        let check_stype: {[key: string]: boolean} = {};
        Object.entries(mst_stypes.mst_stypes).forEach(([_, stype]) => {
            check_stype[stype.name] = true;
        });
        set_check_stype(check_stype);
    });

    const [check_name, set_check_name] = createStore<{[key: number]: boolean}>({});
    createEffect(() => {
        let check_name: {[key: number]: boolean} = {};
        Object.entries(ships.ships).forEach(([ship_id, _]) => {
            check_name[Number(ship_id)] = true;
        });
        set_check_name(check_name);
    });

    const [search_name, set_search_name] = createSignal("");

    const [check_ship_property, set_check_ship_property] = createStore<{[key: string]: boolean}>((
        () => {
            let check_ship_property: {[key: string]: boolean} = {};
            check_ship_property["Ship Type"] = true;
            ship_properties.forEach((property) => {
                check_ship_property[property] = true;
            });
            return check_ship_property;
        }
    )());

    const [set_order, set_set_order] = createSignal(false);
    const [set_sort, set_set_sort] = createSignal("Default");

    const [set_categorize, set_set_categorize] = createSignal(false);

    const sort_fn = (a: string, b: string) => {
        if (set_sort() == "Default") return 0;
        let a_ship = ships.ships[Number(a)];
        let b_ship = ships.ships[Number(b)];
        if (set_sort() == "Level") return a_ship.lv - b_ship.lv;
        if (set_sort() == "Durability") return a_ship.maxhp - b_ship.maxhp;
        if (set_sort() == "Firepower") return a_ship.karyoku[0] - b_ship.karyoku[0];
        if (set_sort() == "Torpedo") return a_ship.raisou[0] - b_ship.raisou[0];
        if (set_sort() == "Anti-Air") return a_ship.taiku[0] - b_ship.taiku[0];
        if (set_sort() == "Speed") return a_ship.soku - b_ship.soku;
        if (set_sort() == "Armor") return a_ship.soukou[0] - b_ship.soukou[0];
        if (set_sort() == "Evasion") return a_ship.kaihi[0] - b_ship.kaihi[0];
        if (set_sort() == "Anti-Submarine") return a_ship.taisen[0] - b_ship.taisen[0];
        if (set_sort() == "Luck") return a_ship.lucky[0] - b_ship.lucky[0];
        if (set_sort() == "Aircraft installed") return mst_ships.mst_ships[a_ship.ship_id]?.maxeq.reduce((a, b) => a + b, 0) - mst_ships.mst_ships[b_ship.ship_id]?.maxeq.reduce((a, b) => a + b, 0);
        if (set_sort() == "Reconnaissance") return a_ship.sakuteki[0] - b_ship.sakuteki[0];
        if (set_sort() == "Range") return a_ship.leng - b_ship.leng;
        return 0;
    }

    const sorted_ship_keys = createMemo(() => {
        let keys = Object.keys(ships.ships);
        keys = keys.sort(sort_fn);
        if (!set_order()) keys = keys.reverse();
        return keys;
    });

    const categorized_ships_keys = createMemo(() => {
        let categorized_ships_keys: {[key: string]: number[]} = {};
        Object.entries(mst_stypes.mst_stypes).forEach(([_, stype]) => {
            categorized_ships_keys[stype.name] = [];
        });
        Object.entries(ships.ships).forEach(([ship_id, _]) => {
            let stype = mst_stypes.mst_stypes[mst_ships.mst_ships[ships.ships[Number(ship_id)].ship_id].stype].name;
            // if (!categorized_ships_keys[stype]) categorized_ships_keys[stype] = [];
            categorized_ships_keys[stype].push(Number(ship_id));
        });
        return categorized_ships_keys;
    });

    const [range_props, set_range_props] = createStore<{[key: string]: {min: number, max: number, eq: number, range: boolean, abbreviation: string}}>((
        () => {
            let range_props: {[key: string]: {min: number, max: number, eq: number, range: boolean, abbreviation: string}} = {};
            let params = ship_properties;
            let abbreviations = ["Lv", "Dur", "Fire", "Tor", "AA", "Spd", "Arm", "Eva", "ASW", "Lck", "ACI", "Rec", "Rng"];
            params.forEach((param, index) => {
                range_props[param] = {min: 0, max: 0, eq: 0, range: true, abbreviation: abbreviations[index]};
            });
            return range_props;
        }
    )());

    const filtered_ships = createMemo<{[key: number]:boolean}>(() => {

        const check_range = (param: string, value: number) => {
            if (range_props[param].range) {
                if (Number.isInteger(range_props[param].min) && range_props[param].min != 0){
                    if (value < range_props[param].min) return false;
                }
                if (Number.isInteger(range_props[param].max) && range_props[param].max != 0){
                    if (value > range_props[param].max) return false;
                }
            } else {
                if (!Number.isInteger(range_props[param].eq)) return false;
                if (value != range_props[param].eq) return false;
            }
            return true;
        };

        let ret: {[key: number]: boolean} = {};
        (set_order() ? Object.keys(ships.ships) : Object.keys(ships.ships).reverse()).forEach((ship_id) => {
            ret[Number(ship_id)] = (() => {
                if (!check_stype[mst_stypes.mst_stypes[mst_ships.mst_ships[ships.ships[Number(ship_id)].ship_id].stype].name]) return false;
                if (!check_name[Number(ship_id)]) return false;
                if (!check_range("Level", ships.ships[Number(ship_id)].lv)) return false;
                if (!check_range("Durability", ships.ships[Number(ship_id)].maxhp)) return false;
                if (!check_range("Firepower", ships.ships[Number(ship_id)].karyoku[0])) return false;
                if (!check_range("Torpedo", ships.ships[Number(ship_id)].raisou[0])) return false;
                if (!check_range("Anti-Air", ships.ships[Number(ship_id)].taiku[0])) return false;
                if (!check_range("Speed", ships.ships[Number(ship_id)].soku)) return false;
                if (!check_range("Armor", ships.ships[Number(ship_id)].soukou[0])) return false;
                if (!check_range("Evasion", ships.ships[Number(ship_id)].kaihi[0])) return false;
                if (!check_range("Anti-Submarine", ships.ships[Number(ship_id)].taisen[0])) return false;
                if (!check_range("Luck", ships.ships[Number(ship_id)].lucky[0])) return false;
                if (!check_range("Aircraft installed", ships.ships[Number(ship_id)].slotnum)) return false;
                if (!check_range("Reconnaissance", ships.ships[Number(ship_id)].sakuteki[0])) return false;
                if (!check_range("Range", ships.ships[Number(ship_id)].leng)) return false;
            return true;
            })();
        });
        return ret;
    });

    const set_range_window = createMemo(() => {
        let set_range_element: {[key: string]: JSX.Element} = {};
        let params = ["Level", "Durability", "Firepower", "Torpedo", "Anti-Air", "Armor", "Evasion", "Anti-Submarine", "Luck", "Aircraft installed", "Reconnaissance"];
        params.forEach((param) => {

            set_range_element[param] = (
                <div class="dropdown dropdown-end">
                    <div class="indicator">
                        <Show when={(
                            () => {
                                let ret = false;
                                if (range_props[param].range) {
                                    if (Number.isInteger(range_props[param].min) && range_props[param].min != 0) ret = true;
                                    if (Number.isInteger(range_props[param].max) && range_props[param].max != 0) ret = true;
                                } else {
                                    if (Number.isInteger(range_props[param].eq)) ret = true;
                                }
                                return ret;
                            }
                        )()}>
                            <span class="indicator-item badge badge-secondary badge-xs -mx-2">filtered</span>
                        </Show>
                        <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">{param}</div>
                    </div>
                    <div tabindex="0" class="dropdown-content z-[2] card card-compact bg-base-100 z-[1] w-64 shadow rounded-md">
                        <div class="card-body">
                            <div class="form-control">
                                <label class="label cursor-pointer relative">
                                    <input type="radio" name="radio-Level" class="radio radio-sm" checked={range_props[param].range} onClick={() => set_range_props(param, "range", true)} />
                                    <span class="label-text text-sm">
                                        <input type="text" placeholder="Min" class="input input-sm input-bordered w-14" onInput={(e) => set_range_props(param, "min", Number(e.target.value))}/> &#8804; {range_props[param].abbreviation} &#8804; <input type="text" placeholder="Max" class="input input-sm input-bordered w-14" onInput={(e) => set_range_props(param, "max", Number(e.target.value))}/>
                                        <Show when={!Number.isInteger(range_props[param].max)}>
                                            <div class="label absolute -bottom-4 right-0">
                                                <span class="label-text-alt text-error">Input Number</span>
                                            </div>
                                        </Show>
                                        <Show when={!Number.isInteger(range_props[param].min)}>
                                            <div class="label absolute -bottom-4 right-[116px]">
                                                <span class="label-text-alt text-error">Input Number</span>
                                            </div>
                                        </Show>
                                    </span>
                                </label>
                            </div>
                            <div class="divider my-0.5">OR</div>
                            <div class="form-control">
                                <label class="label cursor-pointer relative">
                                    <input type="radio" name="radio-Level" class="radio radio-sm" checked={!range_props[param].range} onClick={() => set_range_props(param, "range", false)} />
                                    <span class="label-text text-sm">
                                        {range_props[param].abbreviation} = <input type="text" placeholder="Eq" class="input input-sm input-bordered w-32" onInput={(e) => set_range_props(param, "eq", Number(e.target.value))}/>
                                        <Show when={!Number.isInteger(range_props[param].eq)}>
                                            <div class="label absolute -bottom-4 right-0">
                                                <span class="label-text-alt text-error">Input Number</span>
                                            </div>
                                        </Show>
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            );
        });
        return set_range_element;
    });

    
    const set_discrete_range_window = createMemo(() => {
        let set_range_element: {[key: string]: JSX.Element} = {};
        let params = ["Speed", "Range"];
        let params_option = [
            ["None", "Slow", "Fast", "Fast+", "Fastest"],
            ["None", "Short", "Medium", "Long", "Very Long"]
        ];
        let param_converter = [
            ["None", "", "", "", "", "Slow", "", "", "", "", "Fast", "", "", "", "", "Fast+", "", "", "", "", "Fastest"],
            ["None", "Short", "Medium", "Long", "Very Long"]
        ]
        params.forEach((param, param_index) => {
            set_range_element[param] = (
                <div class="dropdown dropdown-end">
                    <div class="indicator">
                        <Show when={(
                            () => {
                                let ret = false;
                                if (range_props[param].range) {
                                    if (Number.isInteger(range_props[param].min) && range_props[param].min != 0) ret = true;
                                    if (Number.isInteger(range_props[param].max) && range_props[param].max != 0) ret = true;
                                } else {
                                    if (Number.isInteger(range_props[param].eq)) ret = true;
                                }
                                return ret;
                            }
                        )()}>
                            <span class="indicator-item badge badge-secondary badge-xs -mx-2">filtered</span>
                        </Show>
                        <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">{param}</div>
                    </div>
                    <div tabindex="0" class="dropdown-content z-[2] card card-compact bg-base-100 z-[1] w-80 shadow rounded-md">
                        <div class="card-body">
                            <div class="form-control">
                                <label class="label cursor-pointer relative">
                                    <input type="radio" name="radio-Level" class="radio radio-sm" checked={range_props[param].range} onClick={() => set_range_props(param, "range", true)} />
                                    <span class="label-text text-sm">
                                        <select class="select select-bordered select-sm w-24 mx-2" onChange={(e) => set_range_props(param, "min", param_converter[param_index].findIndex((param_select) => param_select == e.target.value))}>
                                            <For each={params_option[param_index]}>
                                                {(param_select) => 
                                                    <>
                                                        <option>{param_select}</option>
                                                    </>
                                                }
                                            </For>
                                        </select>
                                        &#8804; {range_props[param].abbreviation} &#8804;
                                        <select class="select select-bordered select-sm w-24 mx-2" onChange={(e) => set_range_props(param, "max", param_converter[param_index].findIndex((param_select) => param_select == e.target.value))}>
                                            <For each={params_option[param_index]}>
                                                {(param_select) => 
                                                    <>
                                                        <option>{param_select}</option>
                                                    </>
                                                }
                                            </For>
                                        </select>
                                    </span>
                                </label>
                            </div>
                            <div class="divider my-0.5">OR</div>
                            <div class="form-control">
                                <label class="label cursor-pointer relative">
                                    <input type="radio" name="radio-Level" class="radio radio-sm" checked={!range_props[param].range} onClick={() => set_range_props(param, "range", false)} />
                                    <span class="label-text text-sm">
                                        {range_props[param].abbreviation} = 
                                        <select class="select select-bordered select-sm w-52" onChange={(e) => set_range_props(param, "eq", param_converter[param_index].findIndex((param_select) => param_select == e.target.value))}>
                                            <For each={params_option[param_index]}>
                                                {(param_select) => 
                                                    <>
                                                        <option>{param_select}</option>
                                                    </>
                                                }
                                            </For>
                                        </select>
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            );
        });
        return set_range_element;
    });

    const default_disply_pages = 5;

    const [pagination, set_pagination] = createStore<{selected: string, options: {[key: string]: {pages: number, current_page: number, display_pages: number}}}>({
        selected: "10",
        "options": {
            "10": {"pages": 1, "current_page": 1, display_pages: 1},
            "20": {"pages": 1, "current_page": 1, display_pages: 1},
            "50": {"pages": 1, "current_page": 1, display_pages: 1},
            "100": {"pages": 1, "current_page": 1, display_pages: 1},
            "200": {"pages": 1, "current_page": 1, display_pages: 1},
            "500": {"pages": 1, "current_page": 1, display_pages: 1},
            "All": {"pages": 1, "current_page": 1, display_pages: 1},
        }
    });

    createEffect(() => {
        if (pagination.selected == "All") return;
        let option = pagination.options[pagination.selected];
        let pages = Math.ceil(Object.keys(filtered_ships()).length / Number(pagination.selected));
        let current_page = option.current_page;
        if (current_page > pages) current_page = pages;
        current_page = current_page == 0 ? 1 : current_page;
        let display_pages = Math.min(5, pages);
        display_pages = display_pages == 0 ? 1 : display_pages;
        set_pagination("options", pagination.selected, {pages: pages, current_page: current_page, display_pages: display_pages});
    });

    const show_pagination = (index: number) => {

        if (set_categorize()) return true;

        if (pagination.selected == "All") return true;

        let pages = pagination.options[pagination.selected].pages;
        let current_page = pagination.options[pagination.selected].current_page;
        let display_pages = pagination.options[pagination.selected].display_pages;

        if (index < current_page*Number(pagination.selected) && index >= (current_page-1)*Number(pagination.selected)) return true;

        return false;
    }

    const table_element = (ship_ids: (number | string)[]) => {
        return (
            <table class="table table-xs not_menu">
                <tbody>
                    <For each={ship_ids}>
                        {(ship_id, index) => (
                            <Show when={(filtered_ships()[Number(ship_id)] ?? false) && show_pagination(index())}>
                                <tr class="flex table_hover table_active rounded ml-10 -pl-10">
                                    <th class="w-10 flex bg-base-200 z-[1] -ml-10" style={"position: sticky; left: 0;"}>
                                        <span class="flex-1"></span>
                                        {index() + 1}
                                    </th>
                                    <td class="w-32 overflow-hidden">
                                        <ShipNameComponent ship_id={Number(ship_id)}></ShipNameComponent>
                                    </td>
                                    <Show when={check_ship_property["Ship Type"]}>
                                        <td class="w-[88px]">{mst_stypes.mst_stypes[mst_ships.mst_ships[ships.ships[Number(ship_id)].ship_id].stype].name}</td>
                                    </Show>
                                    <Show when={check_ship_property["Level"]}>
                                        <td class="w-12">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].lv}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_property["Durability"]}>
                                        <td class="w-[72px]">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].maxhp}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_property["Firepower"]}>
                                        <td class="w-[72px]">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].karyoku[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_property["Torpedo"]}>
                                        <td class="w-16">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].raisou[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_property["Anti-Air"]}>
                                        <td class="w-16">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].taiku[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_property["Speed"]}>
                                        <td class="w-14">
                                            <div class="w-6 flex justify-self-center">
                                                {speed_list[ships.ships[Number(ship_id)].soku]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_property["Armor"]}>
                                        <td class="w-14">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].soukou[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_property["Evasion"]}>
                                        <td class="w-16">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].kaihi[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_property["Anti-Submarine"]}>
                                        <td class="w-24">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].taisen[0]}
                                            </div>
                                        </td>   
                                    </Show>
                                    <Show when={check_ship_property["Luck"]}>
                                        <td class="w-12">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].lucky[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_property["Aircraft installed"]}>
                                        <td class="w-28">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_ships.mst_ships[ships.ships[Number(ship_id)]?.ship_id]?.maxeq.reduce((a, b) => a + b, 0)}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_property["Reconnaissance"]}>
                                        <td class="w-24">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {ships.ships[Number(ship_id)].sakuteki[0]}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_ship_property["Range"]}>
                                        <td class="w-16">
                                            <div class="w-16 flex justify-self-center">
                                                {range_list[ships.ships[Number(ship_id)].leng]}
                                            </div>
                                        </td>
                                    </Show>
                                </tr>
                            </Show>
                        )}
                    </For>
                </tbody>
            </table>
        );
    };

    const [progress_value, set_progress_value] = createSignal(0);

    const cal_search_name = (search_name: string) => {
        let tmp_name: {[key: number]: boolean} = {};
        let ships_length_100 = Object.keys(ships.ships).length/100;
        let ships_length = Object.keys(ships.ships).length;
        let sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
        Object.entries(ships.ships).forEach(([ship_id, ship], index) => {
            (async () => {
                await sleep(10);
                let mst_ship = mst_ships.mst_ships[ship.ship_id];
                if (mst_ship.name.indexOf(search_name) != -1) {
                    tmp_name[Number(ship_id)] =  true;
                } else {
                    tmp_name[Number(ship_id)] =  false;
                }
                set_progress_value(index/ships_length_100);
                if (index == ships_length - 1) {
                    set_progress_value(0);
                    set_check_name(tmp_name);
                }
            })();
        });
    }

    return (
        <>
            <div class="bg-base-200 shadow z-[4]" style={"position: sticky; top: 0;"}>
                {/* <div class="h-6"></div> */}
                {/* <div class="h-px"></div> */}
                <div class="h-[2px]"></div>
                <progress class="progress progress-info w-screen rounded-none py-0 h-[4px] bg-base-200 -mb-2" value={String(progress_value())} max="100"  style={"position: sticky; left: 0;"}></progress>
                <div class="px-2 py-1 text-xs flex flex-wrap items-center w-screen">
                    <div class="flex flex-nowrap items-center">
                        <div class="truncate">Ship Specification Table</div>
                        <IconChevronRightS class="h-4 w-4 mx-2" />
                        <details class="dropdown">
                            <summary class="btn btn-xs btn-ghost">select properties</summary>
                            <ul tabindex="0" class="dropdown-content z-[2] menu menu-xs bg-base-100 rounded-md  shadow flex">
                                <For each={Object.keys(check_ship_property)}>
                                    {(prop) => (
                                        <li class="flex-col w-32">
                                            <a>
                                                <div class="form-control">
                                                    <label class="label cursor-pointer py-0">
                                                        <input type="checkbox" checked={check_ship_property[prop]} class="checkbox checkbox-sm" onClick={() => {set_check_ship_property(prop, !check_ship_property[prop])}} />
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
                        <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                        <div class="form-control">
                            <label class="label cursor-pointer h-4">
                                <input type="checkbox" checked={set_categorize()} class="checkbox checkbox-sm" onClick={(e) => set_set_categorize(e.currentTarget.checked)}/>
                                <span class="label-text text-xs btn btn-xs btn-ghost">categorized</span>
                            </label>
                        </div>
                        <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                        <div class="px-2">display</div>
                        <select class="select select-sm select-ghost select-bordered z-[10]" onChange={(e) => set_pagination("selected", e.currentTarget.value)} disabled={set_categorize()}>
                            <For each={Object.keys(pagination.options)}>
                                {(option) => (
                                    <option>{option}</option>
                                )}
                            </For>
                        </select>
                        <div class="px-2">items</div>
                        <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                    </div>
                    <Show when={!set_categorize() && pagination.selected != "All"}>
                        <div class="flex flex-nowrap items-center mt-2 w-full">
                            <span class="flex-1"></span>
                            <button class="btn btn-sm btn-ghost mx-0.5 pagination px-3" onClick={(e) => set_pagination("options", pagination.selected, "current_page", 1)}><IconChevronDoubleLeft class="h-3 -mt-0.5 " /></button>
                            <button class="btn btn-sm btn-ghost mx-0.5 pagination" onClick={(e) => set_pagination("options", pagination.selected, "current_page", pagination.options[pagination.selected].current_page - 1)}><IconChevronLeft class="h-3 -mt-0.5" /></button>
                            <For each={[...Array(Math.floor(default_disply_pages/2))].map((_, i) => i + 1)}>
                                {(index) => (
                                    <Show when={pagination.options[pagination.selected].current_page + index > pagination.options[pagination.selected].pages && pagination.options[pagination.selected].current_page + index - default_disply_pages > 0}>
                                        <button class="btn btn-sm btn-square btn-ghost mx-0.5 pagination" onClick={(e) => set_pagination("options", pagination.selected, "current_page", pagination.options[pagination.selected].current_page + index - default_disply_pages)}>{pagination.options[pagination.selected].current_page + index - default_disply_pages}</button>
                                    </Show>
                                )}
                            </For>
                            <For each={[...Array(default_disply_pages)].map((_, i) => i - Math.floor(default_disply_pages/2))}>
                                {(index) => (
                                    <Show when={0 < index+pagination.options[pagination.selected].current_page && index+pagination.options[pagination.selected].current_page <= pagination.options[pagination.selected].pages}>
                                        <button class={"btn btn-sm btn-square btn-ghost mx-0.5 pagination"+(index==0 ? " btn-active":"")} onClick={(e) => {set_pagination("options", pagination.selected, "current_page", index+pagination.options[pagination.selected].current_page); console.log(pagination)}}>{index+pagination.options[pagination.selected].current_page}</button>
                                    </Show>
                                )}
                            </For>
                            <For each={[...Array(Math.floor(default_disply_pages/2))].map((_, i) => -i - 1)}>
                                {(index) => (
                                    <Show when={pagination.options[pagination.selected].current_page + index <= 0 && pagination.options[pagination.selected].current_page + index + default_disply_pages <= pagination.options[pagination.selected].pages}>
                                        <button class="btn btn-sm btn-square btn-ghost mx-0.5 pagination" onClick={(e) => set_pagination("options", pagination.selected, "current_page", pagination.options[pagination.selected].current_page + index + default_disply_pages)}>{pagination.options[pagination.selected].current_page + index + default_disply_pages}</button>
                                    </Show>
                                )}
                            </For>
                            <button class="btn btn-sm btn-ghost mx-0.5 pagination" onClick={(e) => set_pagination("options", pagination.selected, "current_page", pagination.options[pagination.selected].current_page + 1)}><IconChevronRight class="h-3 -mt-0.5" /></button>
                            <button class="btn btn-sm btn-ghost mx-0.5 pagination" onClick={(e) => set_pagination("options", pagination.selected, "current_page", pagination.options[pagination.selected].pages)}><IconChevronDoubleRight class="h-3 -mt-0.5" /></button>
                            <span class="flex-1"></span>
                        </div>
                    </Show>
                </div>
                {/* <div class="h-2"></div> */}
                <table class="table table-xs">
                    <thead>
                        <tr class="flex">
                            <th class="w-10 flex bg-base-200 z-[3]" style={"position: sticky; left: 0;"}>
                                <div class="h-lvh w-10 shadow absolute left-0 z-[1]"></div>
                                <div class="dropdown" style={"z-index: 3;"}>
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
                                    <div tabindex="0" class="dropdown-content z-[2] card card-compact bg-base-100 w-72 shadow rounded-md">
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
                                                                <option>Default</option>
                                                                <For each={ship_properties}>
                                                                    {(property) => (
                                                                        <option>{property}</option>
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
                                    <div tabindex="0" class="dropdown-content z-[2] card card-compact bg-base-100 z-[1] w-72 shadow rounded-md">
                                        <div class="card-body ">
                                            <label class="input input-sm input-bordered flex items-center gap-2">
                                            <input type="text" class="grow" placeholder="Search Name" onChange={(e) => {
                                                    set_search_name(e.target.value);
                                                    cal_search_name(e.target.value);
                                                }}/>
                                                <div class="btn btn-ghost btn-sm -mr-3" onClick={() => {
                                                    cal_search_name(search_name());
                                                }}>
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
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </th>
                            <Show when={check_ship_property["Ship Type"]}>
                                <th class="w-[88px]">
                                    <div class="dropdown">
                                        <div class="indicator">
                                            <Show when={Object.values(check_stype).findIndex((value) => !value) != -1}>
                                                <span class="indicator-item badge badge-secondary badge-xs -mx-2">filtered</span>
                                            </Show>
                                            <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">Ship Type</div>
                                        </div>
                                        <ul tabindex="0" class="dropdown-content z-[2] menu menu-xs bg-base-100 rounded-md z-[1]  shadow max-h-64 overflow-x-scroll flex">
                                            <For each={Object.keys(check_stype)}>
                                                {(stype_name) => (
                                                    <Show when={categorized_ships_keys()[stype_name].length != 0}>
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
                                                    </Show>
                                                )}
                                            </For>
                                        </ul>
                                    </div>
                                </th>
                            </Show>
                            <Show when={check_ship_property["Level"]}>
                                <th class="w-12 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Level"]}
                                </th>
                            </Show>
                            <Show when={check_ship_property["Durability"]}>
                                <th class="w-[72px] flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Durability"]}
                                </th>
                            </Show>
                            <Show when={check_ship_property["Firepower"]}>
                                <th class="w-[72px] flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Firepower"]}
                                </th>
                            </Show>
                            <Show when={check_ship_property["Torpedo"]}>
                                <th class="w-16 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Torpedo"]}
                                </th>
                            </Show>
                            <Show when={check_ship_property["Anti-Air"]}>
                                <th class="w-16 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Anti-Air"]}
                                </th>
                            </Show>
                            <Show when={check_ship_property["Speed"]}>
                                <th class="w-14">{set_discrete_range_window()["Speed"]}</th>
                            </Show>
                            <Show when={check_ship_property["Armor"]}>
                                <th class="w-14 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Armor"]}
                                </th>
                            </Show>
                            <Show when={check_ship_property["Evasion"]}>
                                <th class="w-16 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Evasion"]}
                                </th>
                            </Show>
                            <Show when={check_ship_property["Anti-Submarine"]}>
                                <th class="w-24 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Anti-Submarine"]}
                                </th>
                            </Show>
                            <Show when={check_ship_property["Luck"]}>
                                <th class="w-12 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Luck"]}
                                </th>
                            </Show>
                            <Show when={check_ship_property["Aircraft installed"]}>
                                <th class="w-28 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Aircraft installed"]}
                                </th>
                            </Show>
                            <Show when={check_ship_property["Reconnaissance"]}>
                                <th class="w-24 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Reconnaissance"]}
                                </th>
                            </Show>
                            <Show when={check_ship_property["Range"]}>
                                <th class="w-16">{set_discrete_range_window()["Range"]}</th>
                            </Show>
                        </tr>
                    </thead>
                </table>
            </div>
            <Switch>
                <Match when={set_categorize()}>
                    <For each={Object.keys(categorized_ships_keys())}>
                        {(stype_name, stype_name_index) => (
                            <Show when={check_stype[stype_name] && categorized_ships_keys()[stype_name].length != 0}>
                                <ul class="menu bg-base-200 menu-sm p-0">
                                    <li>
                                        <details >
                                            <summary class="ml-10 relative">
                                                <div class="w-10 h-6 z-[3] bg-base-200 -ml-[52px] px-0" style={"position: sticky; left: 0;"}></div>
                                                Category. {stype_name_index()+1} : {stype_name}
                                            </summary>
                                            <ul class="pl-0 ml-0">
                                                <li>
                                                    {table_element(categorized_ships_keys()[stype_name])}
                                                </li>
                                            </ul>
                                        </details>
                                    </li>
                                </ul>
                            </Show>
                        )}
                    </For>
                </Match>
                <Match when={!set_categorize()}>
                    {table_element(sorted_ship_keys())}
                </Match>
            </Switch>
        </>
    );
};