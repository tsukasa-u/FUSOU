import {
  useMstSlotItemEquipTypes,
  useMstSlotItems,
  useSlotItems,
} from "../../utility/provider.tsx";

import type { JSX } from "solid-js";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import { createStore } from "solid-js/store";

import IconUpArrow from "../../icons/up_arrow.tsx";
import IconDownArrow from "../../icons/down_arrow.tsx";

import { VList } from "virtua/solid";
import { get_data_set_equip } from "../../utility/get_data_set.tsx";
import {
  scroll_fn,
  scroll_parent_fn,
  drag_scroll_fn,
} from "../../utility/scroll.tsx";

import "../../css/divider.css";
import "shared-ui";

const table_width = "1240px";

export function EquipmentListComponent() {
  const [slot_items] = useSlotItems();
  const [mst_slot_items] = useMstSlotItems();
  const [mst_slot_items_equip_types] = useMstSlotItemEquipTypes();

  const equip_properties = [
    "Level",
    "Firepower",
    "Torpedo",
    "Anti-Air",
    "Bomb",
    "Armor",
    "Evasion",
    "Anti-Submarine",
    "Reconnaissance",
    "Proficiency",
    "Anti-Bomber",
    "Interception",
    "Distance",
  ];
  const equip_properties_abbreviation = [
    "Lv",
    "Fire",
    "Tor",
    "AA",
    "Bomb",
    "Arm",
    "Eva",
    "ASW",
    "Rec",
    "Prof",
    "AB",
    "Int",
    "Dis",
  ];
  const store_equip_data_set = createMemo(() => {
    return get_data_set_equip(
      Object.keys(slot_items.slot_items).map((id) => Number(id))
    );
  });

  const [check_equip_types, set_check_equip_types] = createStore<{
    [key: string]: boolean;
  }>({});
  createEffect(() => {
    if (
      Object.keys(mst_slot_items_equip_types.mst_slotitem_equip_types).length ==
      0
    )
      return;
    const _check_equip_types: { [key: string]: boolean } = {};
    Object.values(mst_slot_items_equip_types.mst_slotitem_equip_types).forEach(
      (mst_slotitem_equip_types) => {
        if (mst_slotitem_equip_types)
          _check_equip_types[mst_slotitem_equip_types.name] = true;
      }
    );
    set_check_equip_types(_check_equip_types);
  });

  const [check_name, set_check_name] = createStore<{ [key: number]: boolean }>(
    {}
  );
  createEffect(() => {
    const check_name: { [key: number]: boolean } = {};
    Object.entries(slot_items.slot_items).forEach(([slot_item_id]) => {
      check_name[Number(slot_item_id)] = true;
    });
    set_check_name(check_name);
  });

  const [search_name, set_search_name] = createSignal("");

  const [check_equip_property, set_check_equip_property] = createStore<{
    [key: string]: boolean;
  }>(
    (() => {
      const check_equip_property: { [key: string]: boolean } = {};
      check_equip_property["Equip Type"] = true;
      equip_properties.forEach((property) => {
        check_equip_property[property] = true;
      });
      return check_equip_property;
    })()
  );

  const [set_order, set_set_order] = createSignal(false);
  const [set_sort, set_set_sort] = createSignal("Default");

  const [set_categorize, set_set_categorize] = createSignal(false);
  const [set_equip_type, set_set_equip_type] = createSignal(
    (() => {
      const equip_type_name = Object.values(
        mst_slot_items_equip_types.mst_slotitem_equip_types
      )[0]?.name;
      return equip_type_name ? equip_type_name : "小口径主砲";
    })()
  );

  const additional_sort_fn = (a: number, b: number, _a: number, _b: number) => {
    const tmp = a - b;
    if (tmp != 0) return tmp;
    return _a - _b;
  };

  const sort_fn = (a: string | number, b: string | number) => {
    const a_equip = slot_items.slot_items[Number(a)];
    const b_equip = slot_items.slot_items[Number(b)];
    if (a_equip == undefined || b_equip == undefined) return 0;
    const a_mst_equip = mst_slot_items.mst_slot_items[a_equip.slotitem_id];
    const b_mst_equip = mst_slot_items.mst_slot_items[b_equip.slotitem_id];
    if (a_mst_equip == undefined || b_mst_equip == undefined) return 0;
    if (set_sort() == "Default")
      return additional_sort_fn(
        a_mst_equip.sortno,
        b_mst_equip.sortno,
        a_mst_equip.sortno,
        b_mst_equip.sortno
      );
    if (set_sort() == "Level")
      return additional_sort_fn(
        a_equip.level,
        b_equip.level,
        a_mst_equip.sortno,
        b_mst_equip.sortno
      );
    if (set_sort() == "Firepower")
      return additional_sort_fn(
        a_mst_equip.houg,
        b_mst_equip.houg,
        a_mst_equip.sortno,
        b_mst_equip.sortno
      );
    if (set_sort() == "Torpedo")
      return additional_sort_fn(
        a_mst_equip.raig,
        b_mst_equip.raig,
        a_mst_equip.sortno,
        b_mst_equip.sortno
      );
    if (set_sort() == "Anti-Air")
      return additional_sort_fn(
        a_mst_equip.tyku,
        b_mst_equip.tyku,
        a_mst_equip.sortno,
        b_mst_equip.sortno
      );
    if (set_sort() == "Armor")
      return additional_sort_fn(
        a_mst_equip.souk,
        b_mst_equip.souk,
        a_mst_equip.sortno,
        b_mst_equip.sortno
      );
    if (set_sort() == "Evasion")
      return additional_sort_fn(
        a_mst_equip.houk,
        b_mst_equip.houk,
        a_mst_equip.sortno,
        b_mst_equip.sortno
      );
    if (set_sort() == "Anti-Submarine")
      return additional_sort_fn(
        a_mst_equip.tais,
        b_mst_equip.tais,
        a_mst_equip.sortno,
        b_mst_equip.sortno
      );
    if (set_sort() == "Reconnaissance")
      return additional_sort_fn(
        a_mst_equip.saku,
        b_mst_equip.saku,
        a_mst_equip.sortno,
        b_mst_equip.sortno
      );
    if (set_sort() == "Proficiency")
      return additional_sort_fn(
        a_equip.alv ?? 0,
        b_equip.alv ?? 0,
        a_mst_equip.sortno,
        b_mst_equip.sortno
      );
    if (set_sort() == "Bomb")
      return additional_sort_fn(
        a_mst_equip.baku,
        b_mst_equip.baku,
        a_mst_equip.sortno,
        b_mst_equip.sortno
      );
    return 0;
  };

  const sorted_equip_keys = createMemo(() => {
    let keys = Object.keys(slot_items.slot_items);
    keys = keys.sort(sort_fn);
    if (!set_order()) keys = keys.reverse();
    return keys;
  });

  const categorized_equips_keys = createMemo(() => {
    const categorized_equips_keys: { [key: string]: number[] } = {};
    if (Object.keys(mst_slot_items.mst_slot_items).length == 0)
      return categorized_equips_keys;
    if (
      Object.keys(mst_slot_items_equip_types.mst_slotitem_equip_types).length ==
      0
    )
      return categorized_equips_keys;

    Object.values(mst_slot_items_equip_types.mst_slotitem_equip_types).forEach(
      (equip_types) => {
        if (equip_types) categorized_equips_keys[equip_types.name] = [];
      }
    );
    Object.entries(slot_items.slot_items).forEach(([equip_id, slot_item]) => {
      if (slot_item) {
        const mst_slot_item =
          mst_slot_items.mst_slot_items[slot_item.slotitem_id];
        if (mst_slot_item) {
          // which index is true?
          const equip_type =
            mst_slot_items_equip_types.mst_slotitem_equip_types[
              mst_slot_item.type[2]
            ];
          if (equip_type) {
            categorized_equips_keys[equip_type.name].push(Number(equip_id));
          }
        }
      }
    });

    Object.values(mst_slot_items_equip_types.mst_slotitem_equip_types).forEach(
      (equip_types) => {
        if (equip_types) {
          categorized_equips_keys[equip_types.name] =
            categorized_equips_keys[equip_types.name].sort(sort_fn);
          if (!set_order())
            categorized_equips_keys[equip_types.name] =
              categorized_equips_keys[equip_types.name].reverse();
        }
      }
    );

    return categorized_equips_keys;
  });

  const [range_props, set_range_props] = createStore<{
    [key: string]: {
      min: number;
      max: number;
      eq: number;
      range: boolean;
      abbreviation: string;
      reset: boolean;
    };
  }>(
    (() => {
      const range_props: {
        [key: string]: {
          min: number;
          max: number;
          eq: number;
          range: boolean;
          abbreviation: string;
          reset: boolean;
        };
      } = {};
      const params = equip_properties;
      const abbreviations = equip_properties_abbreviation;
      params.forEach((param, index) => {
        range_props[param] = {
          min: 0,
          max: 0,
          eq: 0,
          range: true,
          abbreviation: abbreviations[index],
          reset: true,
        };
      });
      return range_props;
    })()
  );

  const filtered_equips = createMemo<{ [key: number]: boolean }>(() => {
    const ret: { [key: number]: boolean } = {};

    if (Object.keys(mst_slot_items.mst_slot_items).length == 0) return ret;
    if (
      Object.keys(mst_slot_items_equip_types.mst_slotitem_equip_types).length ==
      0
    )
      return ret;
    if (Object.keys(slot_items.slot_items).length == 0) return ret;
    if (Object.keys(check_equip_types).length == 0) return ret;

    const check_range = (param: string, value: number) => {
      if (range_props[param].reset == true) return true;
      if (range_props[param].range) {
        if (
          Number.isInteger(range_props[param].min) &&
          range_props[param].min != 0
        ) {
          if (value < range_props[param].min) return false;
        }
        if (
          Number.isInteger(range_props[param].max) &&
          range_props[param].max != 0
        ) {
          if (value > range_props[param].max) return false;
        }
      } else {
        if (!Number.isInteger(range_props[param].eq)) return false;
        if (value != range_props[param].eq) return false;
      }
      return true;
    };

    (set_order()
      ? Object.keys(slot_items.slot_items)
      : Object.keys(slot_items.slot_items).reverse()
    ).forEach((equip_id) => {
      ret[Number(equip_id)] = (() => {
        const data_set = store_equip_data_set()[Number(equip_id)];
        const slot_item = data_set.slot_item;
        const mst_slot_item = data_set.mst_slot_item;
        if (slot_item && mst_slot_item) {
          {
            const mst_slot_items_equip_type =
              mst_slot_items_equip_types.mst_slotitem_equip_types[
                mst_slot_item.type[2]
              ];
            if (mst_slot_items_equip_type) {
              // which index is true?
              if (!check_equip_types[mst_slot_items_equip_type.name])
                return false;
            }
          }
          if (!check_name[Number(equip_id)]) return false;
          if (!check_range("Level", slot_item.level)) return false;
          if (!check_range("Firepower", mst_slot_item.houg)) return false;
          if (!check_range("Torpedo", mst_slot_item.raig)) return false;
          if (!check_range("Anti-Air", mst_slot_item.tyku)) return false;
          if (!check_range("Armor", mst_slot_item.taik)) return false;
          if (!check_range("Evasion", mst_slot_item.houm)) return false;
          if (!check_range("Anti-Submarine", mst_slot_item.tais)) return false;
          if (!check_range("Reconnaissance", mst_slot_item.saku)) return false;
          if (!check_range("Proficiency", slot_item.alv ?? 0)) return false;
          if (!check_range("Bomb", mst_slot_item.baku)) return false;
        }
        return true;
      })();
    });
    return ret;
  });

  const set_range_window = () => {
    const set_range_element: { [key: string]: JSX.Element } = {};
    const params = [
      "Level",
      "Firepower",
      "Torpedo",
      "Anti-Air",
      "Bomb",
      "Armor",
      "Evasion",
      "Anti-Submarine",
      "Reconnaissance",
      "Proficiency",
      "Anti-Bomber",
      "Interception",
      "Distance",
    ];
    params.forEach((param) => {
      set_range_element[param] = (
        <>
          <div>
            <div class="indicator">
              <Show
                when={(() => {
                  let ret = false;
                  if (range_props[param].reset) return false;
                  if (range_props[param].range) {
                    if (
                      Number.isInteger(range_props[param].min) &&
                      range_props[param].min != 0
                    )
                      ret = true;
                    if (
                      Number.isInteger(range_props[param].max) &&
                      range_props[param].max != 0
                    )
                      ret = true;
                  } else {
                    if (Number.isInteger(range_props[param].eq)) ret = true;
                  }
                  return ret;
                })()}
              >
                <span class="indicator-item badge badge-secondary badge-xs -mx-2">
                  filtered
                </span>
              </Show>
              <div
                class="btn btn-xs btn-ghost -mx-2"
                onClick={() =>
                  (
                    document.getElementById(
                      `equipment_modal_${param}`
                    ) as HTMLDialogElement
                  ).showModal()
                }
              >
                {param}
              </div>
            </div>
          </div>
          <dialog id={`equipment_modal_${param}`} class="modal modal-top">
            <div class="modal-box border-1 border-base-300 text-base-content rounded-md mx-auto w-72">
              <div class="form-control">
                <label class="label cursor-pointer relative">
                  <input
                    type="radio"
                    name="radio-Level"
                    class="radio radio-sm"
                    checked={
                      range_props[param].range && !range_props[param].reset
                    }
                    onClick={() => {
                      set_range_props(param, "reset", false);
                      set_range_props(param, "range", true);
                    }}
                  />
                  <span class="label-text text-sm">
                    <input
                      type="text"
                      placeholder="Min"
                      class="input input-sm input-bordered w-14"
                      onInput={(e) => {
                        set_range_props(param, "min", Number(e.target.value));
                      }}
                    />{" "}
                    &#8804; {range_props[param].abbreviation} &#8804;{" "}
                    <input
                      type="text"
                      placeholder="Max"
                      class="input input-sm input-bordered w-14"
                      onInput={(e) => {
                        set_range_props(param, "max", Number(e.target.value));
                      }}
                    />
                    <Show when={!Number.isInteger(range_props[param].max)}>
                      <div class="label absolute -bottom-4 right-0">
                        <span class="label-text-alt text-error">
                          Input Number
                        </span>
                      </div>
                    </Show>
                    <Show when={!Number.isInteger(range_props[param].min)}>
                      <div class="label absolute -bottom-4 right-[116px]">
                        <span class="label-text-alt text-error">
                          Input Number
                        </span>
                      </div>
                    </Show>
                  </span>
                </label>
              </div>
              <div class="divider my-0.5">OR</div>
              <div class="form-control">
                <label class="label cursor-pointer relative">
                  <input
                    type="radio"
                    name="radio-Level"
                    class="radio radio-sm"
                    checked={
                      !range_props[param].range && !range_props[param].reset
                    }
                    onClick={() => {
                      set_range_props(param, "reset", false);
                      set_range_props(param, "range", false);
                    }}
                  />
                  <span class="label-text text-sm">
                    {range_props[param].abbreviation} ={" "}
                    <input
                      type="text"
                      placeholder="Eq"
                      class="input input-sm input-bordered w-32"
                      onInput={(e) => {
                        set_range_props(param, "eq", Number(e.target.value));
                      }}
                    />
                    <Show when={!Number.isInteger(range_props[param].eq)}>
                      <div class="label absolute -bottom-4 right-0">
                        <span class="label-text-alt text-error">
                          Input Number
                        </span>
                      </div>
                    </Show>
                  </span>
                </label>
              </div>
              <div class="flex justify-end">
                <button
                  class="btn btn-ghost btn-xs -mb-4"
                  onClick={() => {
                    set_range_props(param, "reset", true);
                  }}
                >
                  reset filter
                </button>
              </div>
            </div>
            <form method="dialog" class="modal-backdrop">
              <button>close</button>
            </form>
          </dialog>
        </>
      );
    });
    return set_range_element;
  };

  const sort_window = () => {
    return (
      <>
        <div>
          <div class="indicator">
            <span class="indicator-item badge badge-secondary badge-xs -mx-2 max-w-16 truncate flex justify-start">
              <Switch fallback="">
                <Match when={set_order()}>▲</Match>
                <Match when={!set_order()}>▼</Match>
              </Switch>
              {set_sort()}
            </span>
            <div
              class="btn btn-xs btn-ghost -mx-1"
              onClick={() =>
                (
                  document.getElementById(
                    "equipment_modal_sort"
                  ) as HTMLDialogElement
                ).showModal()
              }
            >
              No
            </div>
          </div>
        </div>
        <dialog id="equipment_modal_sort" class="modal modal-top">
          <div class="modal-box border-1 border-base-300 text-base-content rounded-md mx-auto w-72">
            <table class="table table-sm ">
              <tbody>
                <tr class="flex" style={{ "border-bottom-width": "0px" }}>
                  <td class="flex-1">order</td>
                  <td class="flex-none h-6">
                    <label class="swap swap-rotate">
                      <input
                        type="checkbox"
                        onClick={(e) => set_set_order(e.currentTarget.checked)}
                      />
                      <div class="swap-on flex flex-nowrap items-center">
                        <IconUpArrow class="h-6 w-6" />
                        <div class="label-text text-xs">ASC</div>
                      </div>
                      <div class="swap-off flex flex-nowrap items-center">
                        <IconDownArrow class="h-6 w-6" />
                        <div class="label-text text-xs">DESC</div>
                      </div>
                    </label>
                  </td>
                </tr>
                <tr
                  class="flex items-center"
                  style={{ "border-bottom-width": "0px" }}
                >
                  <td class="flex-1">sort parameters</td>
                  <td class="flex-none">
                    <select
                      class="select select-bordered select-sm w-28"
                      onChange={(e) => set_set_sort(e.target.value)}
                    >
                      <option>Default</option>
                      <For each={equip_properties}>
                        {(property) => <option>{property}</option>}
                      </For>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <form method="dialog" class="modal-backdrop">
            <button>close</button>
          </form>
        </dialog>
      </>
    );
  };

  const search_name_window = () => {
    return (
      <>
        <div>
          <div class="indicator">
            <Show
              when={
                Object.values(check_name).findIndex((value) => !value) != -1
              }
            >
              <span class="indicator-item badge badge-secondary badge-xs -mx-2">
                filtered
              </span>
            </Show>
            <div
              class="btn btn-xs btn-ghost -mx-2"
              onClick={() =>
                (
                  document.getElementById(
                    "equipment_modal_search_name"
                  ) as HTMLDialogElement
                ).showModal()
              }
            >
              Equip Name
            </div>
          </div>
        </div>
        <dialog id="equipment_modal_search_name" class="modal modal-top">
          <div class="modal-box border-1 border-base-300 text-base-content rounded-md mx-auto w-72">
            <label class="input input-sm input-bordered flex items-center gap-2">
              <input
                type="text"
                class="grow"
                placeholder="Search Name"
                onChange={(e) => {
                  set_search_name(e.target.value);
                  cal_search_name(e.target.value);
                }}
              />
              <div
                class="btn btn-ghost btn-sm -mr-3"
                onClick={() => {
                  cal_search_name(search_name());
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  class="h-4 w-4 opacity-70"
                >
                  <path
                    fill-rule="evenodd"
                    d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
            </label>
          </div>
          <form method="dialog" class="modal-backdrop">
            <button>close</button>
          </form>
        </dialog>
      </>
    );
  };

  const set_equip_type_window = () => {
    return (
      <>
        <div>
          <div class="indicator">
            <Show
              when={
                Object.values(check_equip_types).findIndex((value) => !value) !=
                -1
              }
            >
              <span class="indicator-item badge badge-secondary badge-xs -mx-2">
                filtered
              </span>
            </Show>
            <div
              class="btn btn-xs btn-ghost -mx-2"
              onClick={() =>
                (
                  document.getElementById(
                    "equipment_modal_type"
                  ) as HTMLDialogElement
                ).showModal()
              }
            >
              Equip Type
            </div>
          </div>
        </div>
        <dialog id="equipment_modal_type" class="modal modal-top">
          <div class="absolute w-full top-2 right-4 z-[3]">
            <div class="w-72 mx-auto flex justify-end">
              <button
                class="btn btn-sm btn-outline bg-base-100"
                onClick={() => {
                  const _check_equip_types: { [key: string]: boolean } = {};
                  if (
                    Object.values(check_equip_types).findIndex(
                      (value) => value
                    ) != -1
                  ) {
                    Object.keys(check_equip_types).forEach((key) => {
                      _check_equip_types[key] = false;
                    });
                    set_check_equip_types(_check_equip_types);
                  } else {
                    Object.keys(check_equip_types).forEach((key) => {
                      _check_equip_types[key] = true;
                    });
                    set_check_equip_types(_check_equip_types);
                  }
                }}
              >
                {Object.values(check_equip_types).findIndex((value) => value) !=
                -1
                  ? "filter all"
                  : "show all"}
              </button>
            </div>
          </div>
          <ul class="modal-box mx-auto w-72 menu menu-xs rounded-md grid overflow-y-scroll flex border-1 pt-[40px]">
            <For each={Object.keys(check_equip_types)}>
              {(equip_type_name) => (
                <Show
                  when={categorized_equips_keys()[equip_type_name].length != 0}
                >
                  <li
                    class="flex-col w-full"
                    onClick={() => {
                      const _check_equip_types = { ...check_equip_types };
                      _check_equip_types[equip_type_name] =
                        !check_equip_types[equip_type_name];
                      set_check_equip_types(_check_equip_types);
                    }}
                  >
                    <a>
                      <div class="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={
                            (check_equip_types[equip_type_name] &&
                              !set_categorize()) ||
                            (set_equip_type() == equip_type_name &&
                              set_categorize())
                          }
                          disabled={set_categorize()}
                          class="checkbox checkbox-sm"
                        />
                        {equip_type_name}
                      </div>
                    </a>
                  </li>
                </Show>
              )}
            </For>
          </ul>
          <form method="dialog" class="modal-backdrop">
            <button>close</button>
          </form>
        </dialog>
      </>
    );
  };

  const table_line_element = (equip_id: number, index: number) => {
    const data_set = store_equip_data_set()[equip_id];
    const slot_item = data_set.slot_item;
    const mst_slot_item = data_set.mst_slot_item;
    const mst_slot_items_equip_type = mst_slot_item
      ? mst_slot_items_equip_types.mst_slotitem_equip_types[
          mst_slot_item.type[2]
        ]
      : undefined;
    return (
      <tr class="flex table_hover rounded bg-base-100">
        <th class="px-0 w-10 flex bg-base-100 z-[1] self-center">
          <span class="flex-1" />
          {index + 1}
          <div class="w-[10px]" />
        </th>
        <td class="w-48 overflow-hidden">
          {/* <EquimentComponent slot_id={Number(equip_id)} name_flag={true} /> */}
          <component-equipment-modal
            size="xs"
            name_flag={true}
            mst_slot_item={mst_slot_item}
            slot_item={slot_item}
            empty_flag={false}
            ex_flag={false}
            hide_onslot={true}
          />
        </td>
        <Show when={check_equip_property["Equip Type"]}>
          {/* which index is ture? */}
          <td class="w-[96px] content-center">
            {mst_slot_items_equip_type?.name}
          </td>
        </Show>
        <Show when={check_equip_property["Level"]}>
          <td class="w-12 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {slot_item?.level}
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Firepower"]}>
          <td class="w-[72px] content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_slot_item?.houg}
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Torpedo"]}>
          <td class="w-16 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_slot_item?.raig}
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Anti-Air"]}>
          <td class="w-16 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_slot_item?.tyku}
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Armor"]}>
          <td class="w-14 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_slot_item?.taik}
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Evasion"]}>
          <td class="w-16 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_slot_item?.houm}
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Anti-Submarine"]}>
          <td class="w-24 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_slot_item?.tais}
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Reconnaissance"]}>
          <td class="w-24 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_slot_item?.saku}
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Proficiency"]}>
          <td class="w-20 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {/* {proficiency_selector(slot_item?.alv ?? 0)} */}
              <icon-plane-proficiency size="xs" level={slot_item?.alv ?? 0} />
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Bomb"]}>
          <td class="w-12 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_slot_item?.baku}
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Anti-Bomber"]}>
          <td class="w-20 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_slot_item?.taibaku}
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Interception"]}>
          <td class="w-20 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_slot_item?.geigeki}
            </div>
          </td>
        </Show>
        <Show when={check_equip_property["Distance"]}>
          <td class="w-12 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_slot_item?.distance}
            </div>
          </td>
        </Show>
      </tr>
    );
  };
  const table_header = () => {
    return (
      <thead>
        <tr class="flex mt-1">
          <th class="w-10 flex bg-base-100 z-[3]">{sort_window()}</th>
          <th class="w-48">{search_name_window()}</th>
          <Show when={check_equip_property["Equip Type"]}>
            <th class="w-[96px]">{set_equip_type_window()}</th>
          </Show>
          <Show when={check_equip_property["Level"]}>
            <th class="w-12 flex">
              <span class="flex-1" />
              {set_range_window()["Level"]}
            </th>
          </Show>
          <Show when={check_equip_property["Firepower"]}>
            <th class="w-[72px] flex">
              <span class="flex-1" />
              {set_range_window()["Firepower"]}
            </th>
          </Show>
          <Show when={check_equip_property["Torpedo"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window()["Torpedo"]}
            </th>
          </Show>
          <Show when={check_equip_property["Anti-Air"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window()["Anti-Air"]}
            </th>
          </Show>
          <Show when={check_equip_property["Armor"]}>
            <th class="w-14 flex">
              <span class="flex-1" />
              {set_range_window()["Armor"]}
            </th>
          </Show>
          <Show when={check_equip_property["Evasion"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window()["Evasion"]}
            </th>
          </Show>
          <Show when={check_equip_property["Anti-Submarine"]}>
            <th class="w-24 flex">
              <span class="flex-1" />
              {set_range_window()["Anti-Submarine"]}
            </th>
          </Show>
          <Show when={check_equip_property["Reconnaissance"]}>
            <th class="w-24 flex">
              <span class="flex-1" />
              {set_range_window()["Reconnaissance"]}
            </th>
          </Show>
          <Show when={check_equip_property["Proficiency"]}>
            <th class="w-20 flex">
              <span class="flex-1" />
              {/* {set_discrete_range_window_image()["Proficiency"]} */}
              {set_range_window()["Proficiency"]}
            </th>
          </Show>
          <Show when={check_equip_property["Bomb"]}>
            <th class="w-12 flex">
              <span class="flex-1" />
              {set_range_window()["Bomb"]}
            </th>
          </Show>
          <Show when={check_equip_property["Anti-Bomber"]}>
            <th class="w-20 flex">
              <span class="flex-1" />
              {set_range_window()["Anti-Bomber"]}
            </th>
          </Show>
          <Show when={check_equip_property["Interception"]}>
            <th class="w-20 flex">
              <span class="flex-1" />
              {set_range_window()["Interception"]}
            </th>
          </Show>
          <Show when={check_equip_property["Distance"]}>
            <th class="w-12 flex">
              <span class="flex-1" />
              {set_range_window()["Distance"]}
            </th>
          </Show>
        </tr>
      </thead>
    );
  };

  const table_element_none_categorized = (equip_ids: (number | string)[]) => {
    // const _equip_count = Object.keys(filtered_equips()).filter(
    //   (value) => value
    // ).length;
    const table_element = equip_ids
      .map((equip_id, index) => [
        Number(equip_id),
        filtered_equips()[Number(equip_id)] ?? false,
        index,
      ])
      .filter(([, flag]) => flag as boolean);
    return (
      <table class={`table table-xs max-w-[${table_width}]`}>
        <tbody>
          {/* <VList
            data={equip_ids}
            style={{
              height: "calc(100dvh - 126px)",
              width: table_width,
            }}
            class="overflow-x-hidden"
          >
            {(equip_id, index) => (
              <Show when={filtered_equips()[Number(equip_id)] ?? false}>
                {table_line_element(Number(equip_id), index())}
              </Show>
            )}
          </VList> */}
          <VList
            data={table_element}
            style={{
              height: "calc(100dvh - 126px)",
              width: table_width,
            }}
            class="overflow-x-hidden"
          >
            {([equip_id, , index]) => (
              <Show when={filtered_equips()[Number(equip_id)] ?? false}>
                {table_line_element(Number(equip_id), Number(index))}
              </Show>
            )}
          </VList>
        </tbody>
      </table>
    );
  };

  const table_element_categorized = (equip_ids: (number | string)[]) => {
    return (
      <table class={`table table-xs max-w-[${table_width}]`}>
        <tbody>
          <VList
            data={equip_ids}
            style={{
              height: "calc(100dvh - 159px)",
              width: table_width,
            }}
            class="overflow-x-hidden"
          >
            {(equip_id, index) => (
              <>{table_line_element(Number(equip_id), index())}</>
            )}
          </VList>
        </tbody>
      </table>
    );
  };

  const cal_search_name = (search_name: string) => {
    const tmp_name: { [key: number]: boolean } = {};
    const slot_items_length = Object.keys(slot_items.slot_items).length;
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    Object.entries(slot_items.slot_items).forEach(
      ([equip_id, slotitem], index) => {
        (async () => {
          await sleep(10);
          if (slotitem) {
            const mst_slot_item =
              mst_slot_items.mst_slot_items[slotitem.slotitem_id];
            if (mst_slot_item) {
              if (mst_slot_item.name.indexOf(search_name) != -1) {
                tmp_name[Number(equip_id)] = true;
              } else {
                tmp_name[Number(equip_id)] = false;
              }
              if (index == slot_items_length - 1) {
                set_check_name(tmp_name);
              }
            }
          }
        })();
      }
    );
  };

  const select_properties_window = () => {
    return (
      <>
        <button
          class="btn btn-xs btn-ghost"
          onClick={() =>
            (
              document.getElementById(
                "equipment_modal_select_properties"
              ) as HTMLDialogElement
            ).showModal()
          }
        >
          select properties
        </button>
        <dialog id="equipment_modal_select_properties" class="modal modal-top">
          <ul class="modal-box mx-auto w-72 menu menu-xs rounded-md grid overflow-y-scroll flex border-1 pt-[40px]">
            <For each={Object.keys(check_equip_property)}>
              {(prop) => (
                <li
                  class="flex-col w-full"
                  onClick={() => {
                    set_check_equip_property(prop, !check_equip_property[prop]);
                  }}
                >
                  <a>
                    <div class="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={check_equip_property[prop]}
                        class="checkbox checkbox-sm"
                      />
                      {prop}
                    </div>
                  </a>
                </li>
              )}
            </For>
          </ul>
          <form method="dialog" class="modal-backdrop">
            <button>close</button>
          </form>
        </dialog>
      </>
    );
  };

  let parentScrollElement!: HTMLDivElement;

  return (
    <>
      <div class="bg-base-100 z-[4]">
        <div class="h-2" />
        <div class="px-2 py-1 text-xs flex flex-wrap items-center">
          <div class="px-4 flex-none text-sm w-60">
            Equipment Specification Table
          </div>
          <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
          <div class="flex flex-nowrap items-center">
            {select_properties_window()}
            <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
            <div class="form-control">
              <label class="label cursor-pointer h-4">
                <input
                  type="checkbox"
                  checked={set_categorize()}
                  class="checkbox checkbox-sm"
                  onClick={(e) => set_set_categorize(e.currentTarget.checked)}
                />
                <span class="label-text text-xs btn btn-xs btn-ghost">
                  categorized
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>
      <Switch>
        <Match when={set_categorize()}>
          <div
            class={`overflow-x-auto max-w-[${table_width}]`}
            ref={(el) => {
              scroll_fn(el);
              drag_scroll_fn(el);
            }}
            style={{ "scrollbar-width": "none" }}
          >
            <div class="tabs tabs-border tabs-sm min-w-max">
              <For each={Object.keys(categorized_equips_keys())}>
                {(equip_type_name) => (
                  <Show
                    when={
                      categorized_equips_keys()[equip_type_name].length != 0
                    }
                  >
                    <>
                      <input
                        type="radio"
                        name="ship_specification_table_tab"
                        class="tab"
                        aria-label={equip_type_name}
                        onClick={() => set_set_equip_type(equip_type_name)}
                        checked={set_equip_type() == equip_type_name}
                      />
                    </>
                  </Show>
                )}
              </For>
            </div>
          </div>

          <div
            class={`overflow-x-auto max-w-[${table_width}] border-t-1 border-base-300`}
            style={{
              "scrollbar-gutter": "stable",
              "overflow-x": "scroll",
              "user-select": "none",
            }}
            ref={parentScrollElement}
          >
            <div
              ref={(el) => {
                scroll_parent_fn(el, parentScrollElement);
                drag_scroll_fn(parentScrollElement);
              }}
            >
              <table class={`table table-xs max-w-[${table_width}]`}>
                {table_header()}
              </table>
            </div>
            {table_element_categorized(
              categorized_equips_keys()[set_equip_type()]
            )}
          </div>
        </Match>
        <Match when={!set_categorize()}>
          <div
            class={`overflow-x-auto max-w-[${table_width}]`}
            style={{
              "scrollbar-gutter": "stable",
              "overflow-x": "scroll",
              "user-select": "none",
            }}
            ref={parentScrollElement}
          >
            <div
              ref={(el) => {
                scroll_parent_fn(el, parentScrollElement);
                drag_scroll_fn(parentScrollElement);
              }}
            >
              <table class={`table table-xs max-w-[${table_width}]`}>
                {table_header()}
              </table>
            </div>
            {table_element_none_categorized(sorted_equip_keys())}
          </div>
        </Match>
      </Switch>
    </>
  );
}
