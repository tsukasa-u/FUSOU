import {
  useMstShips,
  useMstStypes,
  useShips,
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

import "../../css/divider.css";
import "shared-ui";

import IconUpArrow from "../../icons/up_arrow.tsx";
import IconDownArrow from "../../icons/down_arrow.tsx";

import { VList } from "virtua/solid";
import { get_data_set_ship } from "../../utility/get_data_set.tsx";
import {
  scroll_fn,
  scroll_parent_fn,
  drag_scroll_fn,
} from "../../utility/scroll.tsx";
const table_width = "1200px";

export function ShipListComponent() {
  const [ships] = useShips();
  const [mst_ships] = useMstShips();
  const [mst_stypes] = useMstStypes();

  const speed_list = [
    "",
    "",
    "",
    "",
    "",
    "Slow",
    "",
    "",
    "",
    "",
    "Fast",
    "",
    "",
    "",
    "",
    "Fast+",
    "",
    "",
    "",
    "",
    "Fastest",
  ];
  const range_list = ["", "Short", "Medium", "Long", "Very Long"];
  const ship_properties = [
    "Level",
    "Durability",
    "Firepower",
    "Torpedo",
    "Anti-Air",
    "Speed",
    "Armor",
    "Evasion",
    "Anti-Submarine",
    "Luck",
    "Aircraft installed",
    "Reconnaissance",
    "Range",
  ];

  const store_ship_data_set = createMemo(() => {
    return get_data_set_ship(Object.keys(ships.ships).map((id) => Number(id)));
  });

  const [check_stype, set_check_stype] = createStore<{
    [key: string]: boolean;
  }>({});
  createEffect(() => {
    const check_stype: { [key: string]: boolean } = {};
    Object.entries(mst_stypes.mst_stypes).forEach(([, stype]) => {
      check_stype[stype!.name] = true;
    });
    set_check_stype(check_stype);
  });

  const [check_name, set_check_name] = createStore<{ [key: number]: boolean }>(
    {}
  );
  createEffect(() => {
    const check_name: { [key: number]: boolean } = {};
    Object.entries(ships.ships).forEach(([ship_id]) => {
      check_name[Number(ship_id)] = true;
    });
    set_check_name(check_name);
  });

  const [search_name, set_search_name] = createSignal("");

  const [check_ship_property, set_check_ship_property] = createStore<{
    [key: string]: boolean;
  }>(
    (() => {
      const check_ship_property: { [key: string]: boolean } = {};
      check_ship_property["Ship Type"] = true;
      ship_properties.forEach((property) => {
        check_ship_property[property] = true;
      });
      return check_ship_property;
    })()
  );

  const [set_order, set_set_order] = createSignal(false);
  const [set_sort, set_set_sort] = createSignal("Default");

  const [set_categorize, set_set_categorize] = createSignal(false);
  const [set_stype, set_set_stype] = createSignal(
    (() => {
      const stype_name = Object.values(mst_stypes.mst_stypes)[0]?.name;
      return stype_name ? stype_name : "海防艦";
    })()
  );

  const sort_fn = (a: string | number, b: string | number) => {
    if (set_sort() == "Default") return 0;
    const a_ship = ships.ships[Number(a)];
    const b_ship = ships.ships[Number(b)];
    if (a_ship && b_ship) {
      if (set_sort() == "Level") {
        if (a_ship.lv && b_ship.lv) return a_ship.lv - b_ship.lv;
      } else if (set_sort() == "Durability") {
        if (a_ship.maxhp && b_ship.maxhp) return a_ship.maxhp - b_ship.maxhp;
      } else if (set_sort() == "Firepower") {
        if (
          a_ship.karyoku &&
          a_ship.karyoku[0] &&
          b_ship.karyoku &&
          b_ship.karyoku[0]
        )
          return a_ship.karyoku[0] - b_ship.karyoku[0];
      } else if (set_sort() == "Torpedo") {
        if (
          a_ship.raisou &&
          a_ship.raisou[0] &&
          b_ship.raisou &&
          b_ship.raisou[0]
        )
          return a_ship.raisou[0] - b_ship.raisou[0];
      } else if (set_sort() == "Anti-Air") {
        if (a_ship.taiku && a_ship.taiku[0] && b_ship.taiku && b_ship.taiku[0])
          return a_ship.taiku[0] - b_ship.taiku[0];
      } else if (set_sort() == "Speed") {
        if (a_ship.soku && b_ship.soku) return a_ship.soku - b_ship.soku;
      } else if (set_sort() == "Armor") {
        if (
          a_ship.soukou &&
          a_ship.soukou[0] &&
          b_ship.soukou &&
          b_ship.soukou[0]
        )
          return a_ship.soukou[0] - b_ship.soukou[0];
      } else if (set_sort() == "Evasion") {
        if (a_ship.kaihi && a_ship.kaihi[0] && b_ship.kaihi && b_ship.kaihi[0])
          return a_ship.kaihi[0] - b_ship.kaihi[0];
      } else if (set_sort() == "Anti-Submarine") {
        if (
          a_ship.taisen &&
          a_ship.taisen[0] &&
          b_ship.taisen &&
          b_ship.taisen[0]
        )
          return a_ship.taisen[0] - b_ship.taisen[0];
      } else if (set_sort() == "Luck") {
        if (a_ship.lucky && a_ship.lucky[0] && b_ship.lucky && b_ship.lucky[0])
          return a_ship.lucky[0] - b_ship.lucky[0];
      } else if (set_sort() == "Aircraft installed") {
        if (a_ship.ship_id && b_ship.ship_id) {
          const a_mst_ship = mst_ships.mst_ships[a_ship.ship_id];
          const b_mst_ship = mst_ships.mst_ships[b_ship.ship_id];
          if (
            a_mst_ship &&
            a_mst_ship.maxeq &&
            b_mst_ship &&
            b_mst_ship.maxeq
          ) {
            return (
              a_mst_ship.maxeq.reduce((a, b) => a + b, 0) -
              b_mst_ship.maxeq.reduce((a, b) => a + b, 0)
            );
          }
        }
      } else if (set_sort() == "Reconnaissance") {
        if (
          a_ship.sakuteki &&
          a_ship.sakuteki[0] &&
          b_ship.sakuteki &&
          b_ship.sakuteki[0]
        )
          return a_ship.sakuteki[0] - b_ship.sakuteki[0];
      } else if (set_sort() == "Range") {
        if (a_ship.leng && b_ship.leng) return a_ship.leng - b_ship.leng;
      }
    }
    return 0;
  };

  const sorted_ship_keys = createMemo<string[]>(() => {
    const keys = Object.keys(ships.ships);
    const sorted_keys = keys.sort(sort_fn);
    if (!set_order()) return sorted_keys.reverse();
    else return sorted_keys;
  });

  const categorized_ships_keys = createMemo(() => {
    const categorized_ships_keys: { [key: string]: number[] } = {};
    Object.entries(mst_stypes.mst_stypes).forEach(([, stype]) => {
      if (stype) categorized_ships_keys[stype.name] = [];
    });

    Object.values(store_ship_data_set()).forEach((data_set) => {
      const ship = data_set.ship;
      const mst_ship = data_set.mst_ship;
      if (mst_ship && ship) {
        const mst_stype = mst_stypes.mst_stypes[mst_ship.stype];
        if (mst_stype) categorized_ships_keys[mst_stype.name].push(ship.id);
      }
    });

    Object.values(mst_stypes.mst_stypes).forEach((stype) => {
      categorized_ships_keys[stype!.name] =
        categorized_ships_keys[stype!.name].sort(sort_fn);
      if (!set_order())
        categorized_ships_keys[stype!.name] =
          categorized_ships_keys[stype!.name].reverse();
    });
    return categorized_ships_keys;
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
      const params = ship_properties;
      const abbreviations = [
        "Lv",
        "Dur",
        "Fire",
        "Tor",
        "AA",
        "Spd",
        "Arm",
        "Eva",
        "ASW",
        "Lck",
        "ACI",
        "Rec",
        "Rng",
      ];
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

  const filtered_ships = createMemo<{ [key: number]: boolean }>(() => {
    const check_range = (param: string, value: number | number[] | null) => {
      if (range_props[param].reset == true) return true;
      if (value) {
        const value_0 = typeof value == "number" ? value : value[0];
        if (range_props[param].range) {
          if (
            Number.isInteger(range_props[param].min) &&
            range_props[param].min != 0
          ) {
            if (value_0 < range_props[param].min) return false;
          }
          if (
            Number.isInteger(range_props[param].max) &&
            range_props[param].max != 0
          ) {
            if (value_0 > range_props[param].max) return false;
          }
        } else {
          if (!Number.isInteger(range_props[param].eq)) return false;
          if (value_0 != range_props[param].eq) return false;
        }
      }
      return true;
    };

    const ret: { [key: number]: boolean } = {};
    (set_order()
      ? Object.keys(ships.ships)
      : Object.keys(ships.ships).reverse()
    ).forEach((ship_id) => {
      ret[Number(ship_id)] = (() => {
        const data_set = store_ship_data_set()[Number(ship_id)];
        const ship = data_set.ship;
        const mst_ship = data_set.mst_ship;
        if (ship) {
          if (mst_ship) {
            const mst_stype = mst_stypes.mst_stypes[mst_ship.stype];
            if (mst_stype) {
              if (!check_stype[mst_stype.name]) return false;
            }
          }
          if (!check_name[Number(ship_id)]) return false;
          if (!check_range("Level", ship.lv)) return false;
          if (!check_range("Durability", ship.maxhp)) return false;
          if (!check_range("Firepower", ship.karyoku)) return false;
          if (!check_range("Torpedo", ship.raisou)) return false;
          if (!check_range("Anti-Air", ship.taiku)) return false;
          if (!check_range("Speed", ship.soku)) return false;
          if (!check_range("Armor", ship.soukou)) return false;
          if (!check_range("Evasion", ship.kaihi)) return false;
          if (!check_range("Anti-Submarine", ship.taisen)) return false;
          if (!check_range("Luck", ship.lucky)) return false;
          if (!check_range("Aircraft installed", ship.slotnum)) return false;
          if (!check_range("Reconnaissance", ship.sakuteki)) return false;
          if (!check_range("Range", ship.leng)) return false;
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
      "Durability",
      "Firepower",
      "Torpedo",
      "Anti-Air",
      "Armor",
      "Evasion",
      "Anti-Submarine",
      "Luck",
      "Aircraft installed",
      "Reconnaissance",
    ];
    params.forEach((param) => {
      set_range_element[param] = (
        <div class="dropdown dropdown-end">
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
            <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">
              {param}
            </div>
          </div>
          <div
            tabindex="0"
            class="dropdown-content z-[2] card card-compact bg-base-100 z-[1] w-64"
          >
            <div class="card-body border-1 border-base-300 text-base-content rounded-md">
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
          </div>
        </div>
      );
    });
    return set_range_element;
  };

  const set_discrete_range_window = () => {
    const set_range_element: { [key: string]: JSX.Element } = {};
    const params = ["Speed", "Range"];
    const params_option = [
      ["None", "Slow", "Fast", "Fast+", "Fastest"],
      ["None", "Short", "Medium", "Long", "Very Long"],
    ];
    const param_converter = [
      [
        "None",
        "",
        "",
        "",
        "",
        "Slow",
        "",
        "",
        "",
        "",
        "Fast",
        "",
        "",
        "",
        "",
        "Fast+",
        "",
        "",
        "",
        "",
        "Fastest",
      ],
      ["None", "Short", "Medium", "Long", "Very Long"],
    ];
    params.forEach((param, param_index) => {
      set_range_element[param] = (
        <div class="dropdown dropdown-end">
          <div class="indicator">
            <Show
              when={(() => {
                let ret = false;
                if (range_props[param].reset) return ret;
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
            <div tabindex="0" role="button" class="btn btn-xs btn-ghost -mx-2">
              {param}
            </div>
          </div>
          <div
            tabindex="0"
            class="dropdown-content z-[2] card card-compact bg-base-100 z-[1] w-90 rounded-md"
          >
            <div class="card-body border-1 border-base-300 text-base-content rounded-md">
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
                    <select
                      class="select select-bordered select-sm w-24 mx-2"
                      onChange={(e) => {
                        set_range_props(
                          param,
                          "min",
                          param_converter[param_index].findIndex(
                            (param_select) => param_select == e.target.value
                          )
                        );
                      }}
                    >
                      <For each={params_option[param_index]}>
                        {(param_select) => (
                          <>
                            <option>{param_select}</option>
                          </>
                        )}
                      </For>
                    </select>
                    &#8804; {range_props[param].abbreviation} &#8804;
                    <select
                      class="select select-bordered select-sm w-24 mx-2"
                      onChange={(e) => {
                        set_range_props(
                          param,
                          "max",
                          param_converter[param_index].findIndex(
                            (param_select) => param_select == e.target.value
                          )
                        );
                      }}
                    >
                      <For each={params_option[param_index]}>
                        {(param_select) => (
                          <>
                            <option>{param_select}</option>
                          </>
                        )}
                      </For>
                    </select>
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
                    {range_props[param].abbreviation} =
                    <select
                      class="select select-bordered select-sm w-58"
                      onChange={(e) =>
                        set_range_props(
                          param,
                          "eq",
                          param_converter[param_index].findIndex(
                            (param_select) => param_select == e.target.value
                          )
                        )
                      }
                    >
                      <For each={params_option[param_index]}>
                        {(param_select) => (
                          <>
                            <option>{param_select}</option>
                          </>
                        )}
                      </For>
                    </select>
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
          </div>
        </div>
      );
    });
    return set_range_element;
  };

  const table_line_element = (ship_id: number, index: number) => {
    const data_set = store_ship_data_set()[ship_id];
    const ship = data_set.ship;
    const mst_ship = data_set.mst_ship;
    const slot_item_map = data_set.slot_items;
    const mst_slot_item_map = data_set.mst_slot_items;
    const mst_stype = mst_ship
      ? mst_stypes.mst_stypes[mst_ship.stype]
      : undefined;
    return (
      <tr class="flex table_hover rounded bg-base-100">
        <th class="px-0 w-10 flex bg-base-100 z-[1] self-center">
          <span class="flex-1" />
          {index + 1}
          <div class="w-[10px]" />
        </th>
        <td class="w-32 overflow-hidden">
          {/* <ShipNameComponent ship_id={Number(ship_id)} /> */}
          <component-ship-modal
            mst_ship={mst_ship}
            ship={ship}
            name_flag={true}
            size="xs"
            color=""
            mst_slot_items={mst_slot_item_map}
            slot_items={slot_item_map}
          />
        </td>
        <Show when={check_ship_property["Ship Type"]}>
          <td class="w-[88px] content-center">{mst_stype?.name}</td>
        </Show>
        <Show when={check_ship_property["Level"]}>
          <td class="w-12 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {ship?.lv}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Durability"]}>
          <td class="w-[72px] content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {ship?.maxhp}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Firepower"]}>
          <td class="w-[72px] content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {ship?.karyoku ? ship.karyoku[0] : undefined}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Torpedo"]}>
          <td class="w-16 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {ship?.raisou ? ship.raisou[0] : undefined}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Anti-Air"]}>
          <td class="w-16 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {ship?.taiku ? ship.taiku[0] : undefined}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Speed"]}>
          <td class="w-14 content-center">
            <div class="w-6 flex justify-self-center">
              {ship?.soku ? speed_list[ship.soku] : undefined}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Armor"]}>
          <td class="w-14 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {ship?.soukou ? ship.soukou[0] : undefined}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Evasion"]}>
          <td class="w-16 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {ship?.kaihi ? ship.kaihi[0] : undefined}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Anti-Submarine"]}>
          <td class="w-24 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {ship?.taisen ? ship.taisen[0] : undefined}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Luck"]}>
          <td class="w-12 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {ship?.lucky ? ship.lucky[0] : undefined}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Aircraft installed"]}>
          <td class="w-28 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {mst_ship?.maxeq
                ? mst_ship.maxeq.reduce((a, b) => a + b, 0)
                : undefined}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Reconnaissance"]}>
          <td class="w-24 content-center">
            <div class="w-6 flex justify-self-center">
              <span class="flex-1" />
              {ship?.sakuteki ? ship.sakuteki[0] : undefined}
            </div>
          </td>
        </Show>
        <Show when={check_ship_property["Range"]}>
          <td class="w-20 content-center">
            <div class="w-14 flex justify-self-center">
              {ship?.leng ? range_list[ship.leng] : undefined}
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
          <th class="w-10 flex bg-base-100 z-[3]">
            <div class="dropdown" style={{ "z-index": "3" }}>
              <div class="indicator">
                <span class="indicator-item badge badge-secondary badge-xs -mx-2 max-w-16 truncate flex justify-start">
                  <Switch fallback="">
                    <Match when={set_order()}>▲</Match>
                    <Match when={!set_order()}>▼</Match>
                  </Switch>
                  {set_sort()}
                </span>
                <div
                  tabindex="0"
                  role="button"
                  class="btn btn-xs btn-ghost -mx-1"
                >
                  No
                </div>
              </div>
              <div
                tabindex="0"
                class="dropdown-content z-[2] card card-compact bg-base-100 w-72 rounded-md"
              >
                <div class="card-body border-1 border-base-300 text-base-content rounded-md">
                  <table class="table table-sm">
                    <tbody>
                      <tr class="flex" style={{ "border-bottom-width": "0px" }}>
                        <td class="flex-1">order</td>
                        <td class="flex-none h-6">
                          <label class="swap swap-rotate">
                            <input
                              type="checkbox"
                              onClick={(e) =>
                                set_set_order(e.currentTarget.checked)
                              }
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
                            <For each={ship_properties}>
                              {(property) => <option>{property}</option>}
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
                  tabindex="0"
                  role="button"
                  class="btn btn-xs btn-ghost -mx-2"
                >
                  Ship Name
                </div>
              </div>
              <div
                tabindex="0"
                class="dropdown-content z-[2] card card-compact bg-base-100 z-[1] w-72 rounded-md"
              >
                <div class="card-body border-1 border-base-300 text-base-content rounded-md">
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
              </div>
            </div>
          </th>
          <Show when={check_ship_property["Ship Type"]}>
            <th class="w-[88px]">
              <div class="dropdown">
                <div class="indicator">
                  <Show
                    when={
                      Object.values(check_stype).findIndex((value) => !value) !=
                      -1
                    }
                  >
                    <span class="indicator-item badge badge-secondary badge-xs -mx-2">
                      filtered
                    </span>
                  </Show>
                  <div
                    tabindex="0"
                    role="button"
                    class="btn btn-xs btn-ghost -mx-2"
                  >
                    Ship Type
                  </div>
                </div>
                <ul
                  tabindex="0"
                  class="dropdown-content z-[2] menu menu-xs bg-base-100 rounded-md grid h-100 overflow-y-scroll flex border-1 border-base-300 text-base-content"
                >
                  <For each={Object.keys(check_stype)}>
                    {(stype_name) => (
                      <Show
                        when={categorized_ships_keys()[stype_name].length != 0}
                      >
                        <li class="flex-col w-32">
                          <a>
                            <div class="form-control">
                              <label class="label cursor-pointer py-0">
                                <input
                                  type="checkbox"
                                  checked={
                                    check_stype[stype_name] ||
                                    (set_stype() == stype_name &&
                                      set_categorize())
                                  }
                                  class="checkbox checkbox-sm"
                                  onClick={() => {
                                    set_check_stype(
                                      stype_name,
                                      !check_stype[stype_name]
                                    );
                                  }}
                                />
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
              <span class="flex-1" />
              {set_range_window()["Level"]}
            </th>
          </Show>
          <Show when={check_ship_property["Durability"]}>
            <th class="w-[72px] flex">
              <span class="flex-1" />
              {set_range_window()["Durability"]}
            </th>
          </Show>
          <Show when={check_ship_property["Firepower"]}>
            <th class="w-[72px] flex">
              <span class="flex-1" />
              {set_range_window()["Firepower"]}
            </th>
          </Show>
          <Show when={check_ship_property["Torpedo"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window()["Torpedo"]}
            </th>
          </Show>
          <Show when={check_ship_property["Anti-Air"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window()["Anti-Air"]}
            </th>
          </Show>
          <Show when={check_ship_property["Speed"]}>
            <th class="w-14">{set_discrete_range_window()["Speed"]}</th>
          </Show>
          <Show when={check_ship_property["Armor"]}>
            <th class="w-14 flex">
              <span class="flex-1" />
              {set_range_window()["Armor"]}
            </th>
          </Show>
          <Show when={check_ship_property["Evasion"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window()["Evasion"]}
            </th>
          </Show>
          <Show when={check_ship_property["Anti-Submarine"]}>
            <th class="w-24 flex">
              <span class="flex-1" />
              {set_range_window()["Anti-Submarine"]}
            </th>
          </Show>
          <Show when={check_ship_property["Luck"]}>
            <th class="w-12 flex">
              <span class="flex-1" />
              {set_range_window()["Luck"]}
            </th>
          </Show>
          <Show when={check_ship_property["Aircraft installed"]}>
            <th class="w-28 flex">
              <span class="flex-1" />
              {set_range_window()["Aircraft installed"]}
            </th>
          </Show>
          <Show when={check_ship_property["Reconnaissance"]}>
            <th class="w-24 flex">
              <span class="flex-1" />
              {set_range_window()["Reconnaissance"]}
            </th>
          </Show>
          <Show when={check_ship_property["Range"]}>
            <th class="w-20">{set_discrete_range_window()["Range"]}</th>
          </Show>
        </tr>
      </thead>
    );
  };

  const table_element_categorized = (ship_ids: (number | string)[]) => {
    return (
      <table class={`table table-xs max-w-[${table_width}]`}>
        <tbody>
          <VList
            data={ship_ids}
            style={{
              height: "calc(100dvh - 159px)",
              width: table_width,
            }}
            class="overflow-x-hidden"
          >
            {(ship_id, index) => (
              <>{table_line_element(Number(ship_id), index())}</>
            )}
          </VList>
        </tbody>
      </table>
    );
  };

  const table_element_none_categorized = (ship_ids: (number | string)[]) => {
    return (
      <table class={`table table-xs max-w-[${table_width}]`}>
        <tbody>
          <VList
            data={ship_ids}
            style={{
              height: "calc(100dvh - 126px)",
              width: table_width,
            }}
            class="overflow-x-hidden"
          >
            {(ship_id, index) => (
              <Show when={filtered_ships()[Number(ship_id)] ?? false}>
                {table_line_element(Number(ship_id), index())}
              </Show>
            )}
          </VList>
        </tbody>
      </table>
    );
  };

  const cal_search_name = (search_name: string) => {
    const tmp_name: { [key: number]: boolean } = {};
    const ships_length = Object.keys(ships.ships).length;
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    Object.entries(ships.ships).forEach(([ship_id, ship], index) => {
      (async () => {
        if (ship?.ship_id) {
          await sleep(10);
          const mst_ship = mst_ships.mst_ships[ship.ship_id];
          if (mst_ship) {
            if (mst_ship.name.indexOf(search_name) != -1) {
              tmp_name[Number(ship_id)] = true;
            } else {
              tmp_name[Number(ship_id)] = false;
            }
            if (index == ships_length - 1) {
              set_check_name(tmp_name);
            }
          }
        }
      })();
    });
  };

  let parentScrollElement!: HTMLDivElement;

  return (
    <>
      <div class="bg-base-100 z-[4]">
        <div class="h-2" />
        <div class="px-2 py-1 text-xs flex flex-wrap items-center">
          <div class="px-4 flex-none text-sm w-56">
            Ship Specification Table
          </div>
          <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
          <div class="flex flex-nowrap items-center">
            <details class="dropdown">
              <summary class="btn btn-xs btn-ghost text-nowrap">
                select properties
              </summary>
              <ul
                tabindex="0"
                class="dropdown-content z-[2] menu menu-xs bg-base-100 rounded-md flex border-1 border-base-300"
              >
                <For each={Object.keys(check_ship_property)}>
                  {(prop) => (
                    <li class="flex-col w-32">
                      <a>
                        <div class="form-control">
                          <label class="label cursor-pointer py-0">
                            <input
                              type="checkbox"
                              checked={check_ship_property[prop]}
                              class="checkbox checkbox-sm"
                              onClick={() => {
                                set_check_ship_property(
                                  prop,
                                  !check_ship_property[prop]
                                );
                              }}
                            />
                            <span class="label-text text-xs pl-2">{prop}</span>
                          </label>
                        </div>
                      </a>
                    </li>
                  )}
                </For>
              </ul>
            </details>
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
              <For each={Object.keys(categorized_ships_keys())}>
                {(stype_name) => (
                  <Show when={categorized_ships_keys()[stype_name].length != 0}>
                    <>
                      <input
                        type="radio"
                        name="ship_specification_table_tab"
                        class="tab"
                        aria-label={stype_name}
                        onClick={() => set_set_stype(stype_name)}
                        checked={set_stype() == stype_name}
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
            {table_element_categorized(categorized_ships_keys()[set_stype()])}
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
            {table_element_none_categorized(sorted_ship_keys())}
          </div>
        </Match>
      </Switch>
    </>
  );
}
