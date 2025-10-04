import {
  useMstShips,
  useMstStypes,
  useShips,
} from "../../utility/provider.tsx";

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

import { VList } from "virtua/solid";
import { get_data_set_ship } from "../../utility/get_data_set.tsx";
import {
  scroll_fn,
  scroll_parent_fn,
  drag_scroll_fn,
} from "../../utility/scroll.tsx";
import {
  init_range_props,
  search_name_window,
  select_properties_window,
  set_discrete_range_window_list,
  set_range_window_list,
  set_type_window,
  sort_window,
  type RangeProps,
} from "./set_window.tsx";
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

  const ship_properties_abbreviation = [
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

  const [ship_spec_modal, set_ship_spec_modal] = createSignal(false);

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

  const additional_sort_fn = (a: number, b: number, _a: number, _b: number) => {
    const tmp = a - b;
    if (tmp != 0) return tmp;
    return _a - _b;
  };

  const sort_fn = (a: string | number, b: string | number) => {
    const a_ship = ships.ships[Number(a)];
    const b_ship = ships.ships[Number(b)];
    const a_ship_id = a_ship?.ship_id ?? 0;
    const b_ship_id = b_ship?.ship_id ?? 0;
    if (a_ship && b_ship) {
      if (set_sort() == "Default") {
        return additional_sort_fn(a_ship_id, b_ship_id, a_ship_id, b_ship_id);
      } else if (set_sort() == "Level") {
        return additional_sort_fn(
          a_ship.lv ?? 0,
          b_ship.lv ?? 0,
          a_ship_id,
          b_ship_id
        );
      } else if (set_sort() == "Durability") {
        return additional_sort_fn(
          a_ship.maxhp ?? 0,
          b_ship.maxhp ?? 0,
          a_ship_id,
          b_ship_id
        );
      } else if (set_sort() == "Firepower") {
        return additional_sort_fn(
          a_ship.karyoku?.[0] ?? 0,
          b_ship.karyoku?.[0] ?? 0,
          a_ship_id,
          b_ship_id
        );
      } else if (set_sort() == "Torpedo") {
        return additional_sort_fn(
          a_ship.raisou?.[0] ?? 0,
          b_ship.raisou?.[0] ?? 0,
          a_ship_id,
          b_ship_id
        );
      } else if (set_sort() == "Anti-Air") {
        return additional_sort_fn(
          a_ship.taiku?.[0] ?? 0,
          b_ship.taiku?.[0] ?? 0,
          a_ship_id,
          b_ship_id
        );
      } else if (set_sort() == "Speed") {
        return additional_sort_fn(
          a_ship.soku ?? 0,
          b_ship.soku ?? 0,
          a_ship_id,
          b_ship_id
        );
      } else if (set_sort() == "Armor") {
        return additional_sort_fn(
          a_ship.soukou?.[0] ?? 0,
          b_ship.soukou?.[0] ?? 0,
          a_ship_id,
          b_ship_id
        );
      } else if (set_sort() == "Evasion") {
        return additional_sort_fn(
          a_ship.kaihi?.[0] ?? 0,
          b_ship.kaihi?.[0] ?? 0,
          a_ship_id,
          b_ship_id
        );
      } else if (set_sort() == "Anti-Submarine") {
        return additional_sort_fn(
          a_ship.taisen?.[0] ?? 0,
          b_ship.taisen?.[0] ?? 0,
          a_ship_id,
          b_ship_id
        );
      } else if (set_sort() == "Luck") {
        return additional_sort_fn(
          a_ship.lucky?.[0] ?? 0,
          b_ship.lucky?.[0] ?? 0,
          a_ship_id,
          b_ship_id
        );
      } else if (set_sort() == "Aircraft installed") {
        if (a_ship.ship_id && b_ship.ship_id) {
          const a_mst_ship = mst_ships.mst_ships[a_ship.ship_id];
          const b_mst_ship = mst_ships.mst_ships[b_ship.ship_id];
          return additional_sort_fn(
            a_mst_ship?.maxeq?.reduce((a, b) => a + b, 0) ?? 0,
            b_mst_ship?.maxeq?.reduce((a, b) => a + b, 0) ?? 0,
            a_ship_id,
            b_ship_id
          );
        }
      } else if (set_sort() == "Reconnaissance") {
        return additional_sort_fn(
          a_ship.sakuteki?.[0] ?? 0,
          b_ship.sakuteki?.[0] ?? 0,
          a_ship_id,
          b_ship_id
        );
      } else if (set_sort() == "Range") {
        return additional_sort_fn(
          a_ship.leng ?? 0,
          b_ship.leng ?? 0,
          a_ship_id,
          b_ship_id
        );
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

  const [range_props, set_range_props] = createStore<RangeProps>(
    init_range_props(ship_properties, ship_properties_abbreviation)
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

  const set_range_window = (modal_prefix: string) => {
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

    return set_range_window_list(
      modal_prefix,
      params,
      range_props,
      set_range_props,
      set_ship_spec_modal
    );
  };

  const set_discrete_range_window = (modal_prefix: string) => {
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

    return set_discrete_range_window_list(
      modal_prefix,
      params,
      params_option,
      param_converter,
      range_props,
      set_range_props,
      set_ship_spec_modal
    );
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
    const modal_prefix = "ship_spec_modal";
    const sort_window_elements = sort_window(
      ship_properties,
      modal_prefix,
      set_order,
      set_set_order,
      set_sort,
      set_set_sort,
      set_ship_spec_modal
    );
    const search_name_window_element = search_name_window(
      "Ship Name",
      modal_prefix,
      check_name,
      search_name,
      set_search_name,
      cal_search_name,
      set_ship_spec_modal
    );
    const set_ship_type_window_element = set_type_window(
      "Ship Type",
      modal_prefix,
      check_stype,
      set_check_stype,
      set_stype,
      set_categorize,
      set_ship_spec_modal
    );
    const set_range_window_elements = set_range_window(modal_prefix);
    const set_discrete_range_window_elements =
      set_discrete_range_window(modal_prefix);
    return (
      <thead>
        <tr class="flex mt-1">
          <th class="w-10 flex bg-base-100 z-[3]">{sort_window_elements}</th>
          <th class="w-32">{search_name_window_element}</th>
          <Show when={check_ship_property["Ship Type"]}>
            <th class="w-[88px]">{set_ship_type_window_element}</th>
          </Show>
          <Show when={check_ship_property["Level"]}>
            <th class="w-12 flex">
              <span class="flex-1" />
              {set_range_window_elements["Level"]}
            </th>
          </Show>
          <Show when={check_ship_property["Durability"]}>
            <th class="w-[72px] flex">
              <span class="flex-1" />
              {set_range_window_elements["Durability"]}
            </th>
          </Show>
          <Show when={check_ship_property["Firepower"]}>
            <th class="w-[72px] flex">
              <span class="flex-1" />
              {set_range_window_elements["Firepower"]}
            </th>
          </Show>
          <Show when={check_ship_property["Torpedo"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window_elements["Torpedo"]}
            </th>
          </Show>
          <Show when={check_ship_property["Anti-Air"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window_elements["Anti-Air"]}
            </th>
          </Show>
          <Show when={check_ship_property["Speed"]}>
            <th class="w-14">{set_discrete_range_window_elements["Speed"]}</th>
          </Show>
          <Show when={check_ship_property["Armor"]}>
            <th class="w-14 flex">
              <span class="flex-1" />
              {set_range_window_elements["Armor"]}
            </th>
          </Show>
          <Show when={check_ship_property["Evasion"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window_elements["Evasion"]}
            </th>
          </Show>
          <Show when={check_ship_property["Anti-Submarine"]}>
            <th class="w-24 flex">
              <span class="flex-1" />
              {set_range_window_elements["Anti-Submarine"]}
            </th>
          </Show>
          <Show when={check_ship_property["Luck"]}>
            <th class="w-12 flex">
              <span class="flex-1" />
              {set_range_window_elements["Luck"]}
            </th>
          </Show>
          <Show when={check_ship_property["Aircraft installed"]}>
            <th class="w-28 flex">
              <span class="flex-1" />
              {set_range_window_elements["Aircraft installed"]}
            </th>
          </Show>
          <Show when={check_ship_property["Reconnaissance"]}>
            <th class="w-24 flex">
              <span class="flex-1" />
              {set_range_window_elements["Reconnaissance"]}
            </th>
          </Show>
          <Show when={check_ship_property["Range"]}>
            <th class="w-20">{set_discrete_range_window_elements["Range"]}</th>
          </Show>
        </tr>
      </thead>
    );
  };

  const table_element_categorized = (ship_ids: (number | string)[]) => {
    const table_element = ship_ids
      .map((ship_id, index) => [
        Number(ship_id),
        filtered_ships()[Number(ship_id)] ?? false,
        index,
      ])
      .filter(([, flag]) => flag as boolean);
    return (
      <table class={`table table-xs max-w-[${table_width}]`}>
        <tbody>
          {/* <VList
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
          </VList> */}
          <VList
            data={table_element}
            style={{
              height: "calc(100dvh - 159px)",
              width: table_width,
            }}
            class="overflow-x-hidden"
          >
            {([ship_id, , index]) => (
              <>{table_line_element(Number(ship_id), Number(index))}</>
            )}
          </VList>
        </tbody>
      </table>
    );
  };

  const table_element_none_categorized = (ship_ids: (number | string)[]) => {
    const table_element = ship_ids
      .map((ship_id, index) => [
        Number(ship_id),
        filtered_ships()[Number(ship_id)] ?? false,
        index,
      ])
      .filter(([, flag]) => flag as boolean);
    return (
      <table class={`table table-xs max-w-[${table_width}]`}>
        <tbody>
          {/* <VList
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
          </VList> */}
          <VList
            data={table_element}
            style={{
              height: "calc(100dvh - 126px)",
              width: table_width,
            }}
            class="overflow-x-hidden"
          >
            {([ship_id, , index]) => (
              <>{table_line_element(Number(ship_id), Number(index))}</>
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

  const wrap_select_properties_window = () =>
    select_properties_window(
      "ship_spec_modal",
      check_ship_property,
      set_check_ship_property,
      set_ship_spec_modal
    );

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
            {wrap_select_properties_window()}
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
              scroll_fn(el, ship_spec_modal);
              drag_scroll_fn(el, ship_spec_modal);
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
                scroll_parent_fn(el, parentScrollElement, ship_spec_modal);
                drag_scroll_fn(parentScrollElement, ship_spec_modal);
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
                scroll_parent_fn(el, parentScrollElement, ship_spec_modal);
                drag_scroll_fn(parentScrollElement, ship_spec_modal);
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
