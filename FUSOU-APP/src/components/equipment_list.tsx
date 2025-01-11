import { useMstShips, useMstSlotItemEquipTypes, useMstSlotItems, useMstStypes, useShips, useSlotItems } from '../utility/provider.tsx';

import "../css/divider.css";
import { createEffect, createMemo, createSignal, For, JSX, Match, Show, Switch } from 'solid-js';
import IconChevronRightS from '../icons/chevron_right_s.tsx';
import { ShipNameComponent } from './ship_name.tsx';
import { createStore } from 'solid-js/store';

import "./../css/table_hover.css";
import "./../css/table_active.css";
import "./../css/menu_hover.css";
import "./../css/menu_active.css";
import IconUpArrow from '../icons/up_arrow.tsx';
import IconDownArrow from '../icons/down_arrow.tsx';
import { EquimentComponent } from './equipment.tsx';
import IconChevronLeft from '../icons/chevron_left.tsx';
import IconChevronDoubleLeft from '../icons/chevron_double_left.tsx';
import IconChevronRight from '../icons/chevron_right.tsx';
import IconChevronDoubleRight from '../icons/chevron_double_right.tsx';
import IconPlaneProficiency7 from '../icons/plane_proficiency7.tsx';
import IconPlaneProficiency6 from '../icons/plane_proficiency6.tsx';
import IconPlaneProficiency5 from '../icons/plane_proficiency5.tsx';
import IconPlaneProficiency4 from '../icons/plane_proficiency4.tsx';
import IconPlaneProficiency3 from '../icons/plane_proficiency3.tsx';
import IconPlaneProficiency2 from '../icons/plane_proficiency2.tsx';
import IconPlaneProficiency1 from '../icons/plane_proficiency1.tsx';

export function EquipmentListComponent() {
    
    // const [ships, ] =  useShips();
    // const [mst_ships, ] = useMstShips();
    // const [mst_stypes, ] = useMstStypes();
    const [slot_items, ] = useSlotItems();
    const [mst_slot_items, ] = useMstSlotItems();
    const [mst_slot_items_equip_types] = useMstSlotItemEquipTypes();
    
    // const speed_list = ["", "", "", "", "", "Slow", "", "", "", "", "Fast", "", "", "", "", "Fast+", "", "", "", "", "Fastest"];
    // const range_list = ["", "Short", "Medium", "Long", "Very Long"];
    const equip_properties = ["Level", "Firepower", "Torpedo", "Anti-Air", "Bomb", "Armor", "Evasion", "Anti-Submarine", "Reconnaissance", "Proficiency", "Anti-Bomber", "Interception", "Distance"];
    const equip_properties_abbreviation = ["Lv", "Fire", "Tor", "AA", "Bomb", "Arm", "Eva", "ASW", "Rec", "Prof", "AB", "Int", "Dis"];

    const [check_equip_types, set_check_equip_types] = createStore<{[key: string]: boolean}>({});
    createEffect(() => {
        if (Object.keys(mst_slot_items_equip_types.mst_slotitem_equip_types).length == 0) return;
        let _check_equip_types: {[key: string]: boolean} = {};
        Object.entries(mst_slot_items_equip_types.mst_slotitem_equip_types).forEach(([_, mst_slotitem_equip_types]) => {
            _check_equip_types[mst_slotitem_equip_types.name] = true;
        });
        set_check_equip_types(_check_equip_types);
    });

    const [check_name, set_check_name] = createStore<{[key: number]: boolean}>({});
    createEffect(() => {
        let check_name: {[key: number]: boolean} = {};
        Object.entries(slot_items.slot_items).forEach(([slot_item_id, _]) => {
            check_name[Number(slot_item_id)] = true;
        });
        set_check_name(check_name);
    });

    const [search_name, set_search_name] = createSignal("");

    const [check_equip_property, set_check_equip_property] = createStore<{[key: string]: boolean}>((
        () => {
            let check_equip_property: {[key: string]: boolean} = {};
            check_equip_property["Equip Type"] = true;
            equip_properties.forEach((property) => {
                check_equip_property[property] = true;
            });
            return check_equip_property;
        }
    )());

    const [set_order, set_set_order] = createSignal(true);
    const [set_sort, set_set_sort] = createSignal("Default");

    const [set_categorize, set_set_categorize] = createSignal(false);

    const [progress_value, set_progress_value] = createSignal(0);

    const additional_sort_fn = (a: number, b: number, _a: number, _b: number) => {
        let tmp = a - b;
        if (tmp != 0) return tmp;
        return _a - _b;
    }

    const sort_fn = (a: string | number, b: string | number) => {
        let a_equip = slot_items.slot_items[Number(a)];
        let b_equip = slot_items.slot_items[Number(b)];
        if (a_equip == undefined || b_equip == undefined) return 0;
        let a_mst_equip = mst_slot_items.mst_slot_items[a_equip.slotitem_id];
        let b_mst_equip = mst_slot_items.mst_slot_items[b_equip.slotitem_id];
        if (a_mst_equip == undefined || b_mst_equip == undefined) return 0;
        if (set_sort() == "Default") return additional_sort_fn(a_mst_equip.sortno, b_mst_equip.sortno, a_mst_equip.sortno, b_mst_equip.sortno);
        if (set_sort() == "Level") return additional_sort_fn(a_equip.level, b_equip.level, a_mst_equip.sortno, b_mst_equip.sortno);
        if (set_sort() == "Firepower") return additional_sort_fn(a_mst_equip.houg, b_mst_equip.houg, a_mst_equip.sortno, b_mst_equip.sortno);
        if (set_sort() == "Torpedo") return additional_sort_fn(a_mst_equip.raig, b_mst_equip.raig, a_mst_equip.sortno, b_mst_equip.sortno);
        if (set_sort() == "Anti-Air") return additional_sort_fn(a_mst_equip.tyku, b_mst_equip.tyku, a_mst_equip.sortno, b_mst_equip.sortno);
        if (set_sort() == "Armor") return additional_sort_fn(a_mst_equip.souk, b_mst_equip.souk, a_mst_equip.sortno, b_mst_equip.sortno);
        if (set_sort() == "Evasion") return additional_sort_fn(a_mst_equip.houk, b_mst_equip.houk, a_mst_equip.sortno, b_mst_equip.sortno);
        if (set_sort() == "Anti-Submarine") return additional_sort_fn(a_mst_equip.tais, b_mst_equip.tais, a_mst_equip.sortno, b_mst_equip.sortno);
        if (set_sort() == "Reconnaissance") return additional_sort_fn(a_mst_equip.saku, b_mst_equip.saku, a_mst_equip.sortno, b_mst_equip.sortno);
        if (set_sort() == "Proficiency") return additional_sort_fn(a_equip.alv ?? 0, b_equip.alv ?? 0, a_mst_equip.sortno, b_mst_equip.sortno);
        if (set_sort() == "Bomb") return additional_sort_fn(a_mst_equip.baku, b_mst_equip.baku, a_mst_equip.sortno, b_mst_equip.sortno);
        return 0;
    }

    const sorted_equip_keys = createMemo(() => {
        let keys = Object.keys(slot_items.slot_items);
        keys = keys.sort(sort_fn);
        if (!set_order()) keys = keys.reverse();
        return keys;
    });

    const categorized_equips_keys = createMemo(() => {
        let categorized_equips_keys: {[key: string]: number[]} = {};
        if (Object.keys(mst_slot_items.mst_slot_items).length == 0) return categorized_equips_keys;
        if (Object.keys(mst_slot_items_equip_types.mst_slotitem_equip_types).length == 0) return categorized_equips_keys;

        Object.entries(mst_slot_items_equip_types.mst_slotitem_equip_types).forEach(([_, equip_types]) => {
            categorized_equips_keys[equip_types.name] = [];
        });
        Object.entries(slot_items.slot_items).forEach(([equip_id, slot_item]) => {
            // which index is true?
            let equip_type = mst_slot_items_equip_types.mst_slotitem_equip_types[mst_slot_items.mst_slot_items[slot_item.slotitem_id]._type[2]].name;
            categorized_equips_keys[equip_type].push(Number(equip_id));
        });
        
        Object.entries(mst_slot_items_equip_types.mst_slotitem_equip_types).forEach(([_, equip_types]) => {
            categorized_equips_keys[equip_types.name] = categorized_equips_keys[equip_types.name].sort(sort_fn);
            if (!set_order()) categorized_equips_keys[equip_types.name] = categorized_equips_keys[equip_types.name].reverse();
        });

        return categorized_equips_keys;
    });

    const [range_props, set_range_props] = createStore<{[key: string]: {min: number, max: number, eq: number, range: boolean, abbreviation: string}}>((
        () => {
            let range_props: {[key: string]: {min: number, max: number, eq: number, range: boolean, abbreviation: string}} = {};
            let params = equip_properties;
            let abbreviations = equip_properties_abbreviation;
            params.forEach((param, index) => {
                range_props[param] = {min: 0, max: 0, eq: 0, range: true, abbreviation: abbreviations[index]};
            });
            return range_props;
        }
    )());

    const filtered_equips = createMemo<{[key: number]:boolean}>(() => {
        let ret: {[key: number]: boolean} = {};
        
        if (Object.keys(mst_slot_items.mst_slot_items).length == 0) return ret;
        if (Object.keys(mst_slot_items_equip_types.mst_slotitem_equip_types).length == 0) return ret;
        if (Object.keys(slot_items.slot_items).length == 0) return ret;
        if (Object.keys(check_equip_types).length == 0) return ret;

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

        
        (set_order() ? Object.keys(slot_items.slot_items) : Object.keys(slot_items.slot_items).reverse()).forEach((equip_id) => {
            ret[Number(equip_id)] = (() => {
                // which index is true?
                if (!check_equip_types[mst_slot_items_equip_types.mst_slotitem_equip_types[mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id]._type[2]].name]) return false;
                if (!check_name[Number(equip_id)]) return false;
                if (!check_range("Level", slot_items.slot_items[Number(equip_id)].level)) return false;
                if (!check_range("Firepower", mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].houg)) return false;
                if (!check_range("Torpedo", mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].raig)) return false;
                if (!check_range("Anti-Air", mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].tyku)) return false;
                if (!check_range("Armor", mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].taik)) return false;
                if (!check_range("Evasion", mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].houm)) return false;
                if (!check_range("Anti-Submarine", mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].tais)) return false;
                if (!check_range("Reconnaissance", mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].saku)) return false;
                if (!check_range("Proficiency", slot_items.slot_items[Number(equip_id)].alv ?? 0)) return false;
                if (!check_range("Bomb", mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].baku)) return false;
            return true;
            })();
        });
        return ret;
    });

    const set_range_window = createMemo(() => {
        let set_range_element: {[key: string]: JSX.Element} = {};
        let params = ["Level", "Firepower", "Torpedo", "Anti-Air", "Bomb", "Armor", "Evasion", "Anti-Submarine", "Reconnaissance", "Proficiency", "Anti-Bomber", "Interception", "Distance"];
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
    const proficiency_selector = (alv: number) => {
        return (
            <Switch fallback={<></>}>
                <Match when={alv == 7}>
                    <IconPlaneProficiency7 class="h-5" />
                </Match>
                <Match when={alv == 6}>
                    <IconPlaneProficiency6 class="h-5" />
                </Match>
                <Match when={alv == 5}>
                    <IconPlaneProficiency5 class="h-5" />
                </Match>
                <Match when={alv == 4}>
                    <IconPlaneProficiency4 class="h-5" />
                </Match>
                <Match when={alv == 3}>
                    <IconPlaneProficiency3 class="h-5" />
                </Match>
                <Match when={alv == 2}>
                    <IconPlaneProficiency2 class="h-5" />
                </Match>
                <Match when={alv == 1}>
                    <IconPlaneProficiency1 class="h-5" />
                </Match>
            </Switch>
        );
    }
    
    // const set_discrete_range_window_image = createMemo(() => {
    //     let set_range_element: {[key: string]: JSX.Element} = {};
    //     let params = ["Proficiency"];
    //     let params_option = [
    //         ["None", "1", "2", "3", "4", "5", "6", "7"]
    //     ];
    //     let param_image_converter = [
    //         [ "None", "|", "||", "|||", "/", "//", "///", ">>"]
    //     ]
    //     let param_converter = [
    //         [ "None", "|", "||", "|||", "/", "//", "///", ">>"]
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
    //                 <div tabindex="0" class="dropdown-content z-[2] card card-compact bg-base-100 z-[1] w-80 shadow rounded-md">
    //                     <div class="card-body">
    //                         <div class="form-control">
    //                             <label class="label cursor-pointer relative">
    //                                 <input type="radio" name="radio-Level" class="radio radio-sm" checked={range_props[param].range} onClick={() => set_range_props(param, "range", true)} />
    //                                 <span class="label-text text-sm">
    //                                     <select class="select select-bordered select-sm w-24 mx-2" onChange={(e) => set_range_props(param, "min", param_converter[param_index].findIndex((param_select) => param_select == e.target.value))}>
    //                                         <For each={params_option[param_index]}>
    //                                             {(param_select, selected_index) => 
    //                                                 <>
    //                                                     <option>
    //                                                         {param_image_converter[param_index][selected_index()]}
    //                                                     </option>
    //                                                 </>
    //                                             }
    //                                         </For>
    //                                     </select>
    //                                     &#8804; {range_props[param].abbreviation} &#8804;
    //                                     <select class="select select-bordered select-sm w-24 mx-2" onChange={(e) => set_range_props(param, "max", param_converter[param_index].findIndex((param_select) => param_select == e.target.value))}>
    //                                         <For each={params_option[param_index]}>
    //                                             {(param_select, selected_index) => 
    //                                                 <>
    //                                                     <option>
    //                                                         {param_image_converter[param_index][selected_index()]}
    //                                                     </option>
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
    //                                     <select class="select select-bordered select-sm w-52" onChange={(e) => {
    //                                         // set_range_props(param, "eq", param_converter[param_index].findIndex((param_select) => param_select == e.target.value));
    //                                         console.log(e.target.value);
    //                                         }}>
    //                                         <For each={params_option[param_index]}>
    //                                             {(param_select, selected_index) => 
    //                                                 <>
    //                                                     <option>
    //                                                         {param_image_converter[param_index][selected_index()]}
    //                                                     </option>
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
        let pages = Math.ceil(Object.keys(filtered_equips()).length / Number(pagination.selected));
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

    const table_element = (equip_ids: (number | string)[]) => {
        return (
            <table class="table table-xs not_menu">
                <tbody>
                    <For each={equip_ids}>
                        {(equip_id, index) => (
                            <Show when={(filtered_equips()[Number(equip_id)] ?? false) && show_pagination(index())}>
                                <tr class="flex table_hover table_active rounded ml-10 -pl-10">
                                    <th class="w-10 flex bg-base-200 z-[1] -ml-10" style={"position: sticky; left: 0;"}>
                                        <span class="flex-1"></span>
                                        {index() + 1}
                                    </th>
                                    <td class="w-48 overflow-hidden">
                                        <EquimentComponent slot_id={Number(equip_id)} name_flag={true} />
                                    </td>
                                    <Show when={check_equip_property["Equip Type"]}>
                                        {/* which index is ture? */}
                                        <td class="w-[96px]">{mst_slot_items_equip_types.mst_slotitem_equip_types[mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id]._type[2]].name}</td>
                                    </Show>
                                    <Show when={check_equip_property["Level"]}>
                                        <td class="w-12">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {slot_items.slot_items[Number(equip_id)].level}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_equip_property["Firepower"]}>
                                        <td class="w-[72px]">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].houg}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_equip_property["Torpedo"]}>
                                        <td class="w-16">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].raig}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_equip_property["Anti-Air"]}>
                                        <td class="w-16">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].tyku}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_equip_property["Armor"]}>
                                        <td class="w-14">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].taik}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_equip_property["Evasion"]}>
                                        <td class="w-16">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].houm}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_equip_property["Anti-Submarine"]}>
                                        <td class="w-24">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].tais}
                                            </div>
                                        </td>   
                                    </Show>
                                    <Show when={check_equip_property["Reconnaissance"]}>
                                        <td class="w-24">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].saku}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_equip_property["Proficiency"]}>
                                        <td class="w-20">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {proficiency_selector(slot_items.slot_items[Number(equip_id)].alv ?? 0)}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_equip_property["Bomb"]}>
                                        <td class="w-12">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].baku}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_equip_property["Anti-Bomber"]}>
                                        <td class="w-20">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].taibaku}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_equip_property["Interception"]}>
                                        <td class="w-20">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].geigeki}
                                            </div>
                                        </td>
                                    </Show>
                                    <Show when={check_equip_property["Distance"]}>
                                        <td class="w-12">
                                            <div class="w-6 flex justify-self-center">
                                                <span class="flex-1"></span>
                                                {mst_slot_items.mst_slot_items[slot_items.slot_items[Number(equip_id)].slotitem_id].distance ?? 0}
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

    const cal_search_name = (search_name: string) => {
        let tmp_name: {[key: number]: boolean} = {};
        let slot_items_length_100 = Object.keys(slot_items.slot_items).length/100;
        let slot_items_length = Object.keys(slot_items.slot_items).length;
        let sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
        Object.entries(slot_items.slot_items).forEach(([equip_id, slotitem], index) => {
            (async () => {
                await sleep(10);
                let mst_slot_item = mst_slot_items.mst_slot_items[slotitem.slotitem_id];
                if (mst_slot_item.name.indexOf(search_name) != -1) {
                    tmp_name[Number(equip_id)] =  true;
                } else {
                    tmp_name[Number(equip_id)] =  false;
                }
                set_progress_value(index/slot_items_length_100);
                if (index == slot_items_length - 1) {
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
                        <div class="truncate">Equipment Specification Table</div>
                        <IconChevronRightS class="h-4 w-4 mx-2" />
                        <details class="dropdown">
                            <summary class="btn btn-xs btn-ghost">select properties</summary>
                            <ul tabindex="0" class="dropdown-content z-[2] menu menu-xs bg-base-100 rounded-md  shadow flex">
                                <For each={Object.keys(check_equip_property)}>
                                    {(prop) => (
                                        <li class="flex-col w-32">
                                            <a>
                                                <div class="form-control">
                                                    <label class="label cursor-pointer py-0">
                                                        <input type="checkbox" checked={check_equip_property[prop]} class="checkbox checkbox-sm" onClick={() => {set_check_equip_property(prop, !check_equip_property[prop])}} />
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
                            <For each={[...Array(Math.floor(default_disply_pages/2))].map((_, i) => i - Math.floor(default_disply_pages/2))}>
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
                                                                <For each={equip_properties}>
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
                            <th class="w-48">
                                <div class="dropdown">
                                    <div class="indicator">
                                        <Show when={Object.values(check_name).findIndex((value) => !value) != -1}>
                                            <span class="indicator-item badge badge-secondary badge-xs -mx-2">filtered</span>
                                        </Show>
                                        <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">Equip Name</div>
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
                            <Show when={check_equip_property["Equip Type"]}>
                                <th class="w-[96px]">
                                    <div class="dropdown">
                                        <div class="indicator">
                                            <Show when={Object.values(check_equip_types).findIndex((value) => !value) != -1}>
                                                <span class="indicator-item badge badge-secondary badge-xs -mx-2">filtered</span>
                                            </Show>
                                            <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">Equip Type</div>
                                        </div>
                                        <ul tabindex="0" class="dropdown-content z-[2] menu menu-xs bg-base-100 rounded-md z-[1]  shadow max-h-64 overflow-x-scroll flex">
                                            {/* <For each={Object.keys(mst_slot_items_equip_types.mst_slotitem_equip_types)}> */}
                                            <For each={Object.keys(check_equip_types)}>
                                                {(equip_type_name) => (
                                                    <Show when={categorized_equips_keys()[equip_type_name].length != 0}>
                                                        <li class="flex-col w-32">
                                                            <a>
                                                                <div class="form-control">
                                                                    <label class="label cursor-pointer py-0">
                                                                        <input type="checkbox" checked={check_equip_types[equip_type_name]} class="checkbox checkbox-sm" onClick={() => {set_check_equip_types(equip_type_name, !check_equip_types[equip_type_name])}} />
                                                                        <span class="label-text text-xs pl-2">
                                                                            {equip_type_name}
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
                            <Show when={check_equip_property["Level"]}>
                                <th class="w-12 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Level"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Firepower"]}>
                                <th class="w-[72px] flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Firepower"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Torpedo"]}>
                                <th class="w-16 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Torpedo"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Anti-Air"]}>
                                <th class="w-16 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Anti-Air"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Armor"]}>
                                <th class="w-14 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Armor"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Evasion"]}>
                                <th class="w-16 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Evasion"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Anti-Submarine"]}>
                                <th class="w-24 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Anti-Submarine"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Reconnaissance"]}>
                                <th class="w-24 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Reconnaissance"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Proficiency"]}>
                                <th class="w-20 flex">
                                    <span class="flex-1"></span>
                                    {/* {set_discrete_range_window_image()["Proficiency"]} */}
                                    {set_range_window()["Proficiency"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Bomb"]}>
                                <th class="w-12 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Bomb"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Anti-Bomber"]}>
                                <th class="w-20 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Anti-Bomber"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Interception"]}>
                                <th class="w-20 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Interception"]}
                                </th>
                            </Show>
                            <Show when={check_equip_property["Distance"]}>
                                <th class="w-12 flex">
                                    <span class="flex-1"></span>
                                    {set_range_window()["Distance"]}
                                </th>
                            </Show>
                        </tr>
                    </thead>
                </table>
            </div>
            <Switch>
                <Match when={set_categorize()}>
                    <For each={Object.keys(categorized_equips_keys())}>
                        {(equip_type_name, equip_type_name_index) => (
                            <Show when={check_equip_types[equip_type_name] && categorized_equips_keys()[equip_type_name].length != 0}>
                                <ul class="menu bg-base-200 menu-sm p-0">
                                    <li>
                                        <details >
                                            <summary class="ml-10 relative">
                                                <div class="w-10 h-6 z-[3] bg-base-200 -ml-[52px] px-0" style={"position: sticky; left: 0;"}></div>
                                                Category. {equip_type_name_index()+1} : {equip_type_name}
                                            </summary>
                                            <ul class="pl-0 ml-0">
                                                <li>
                                                    {table_element(categorized_equips_keys()[equip_type_name])}
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
                    {table_element(sorted_equip_keys())}
                </Match>
            </Switch>
        </>
    );
};