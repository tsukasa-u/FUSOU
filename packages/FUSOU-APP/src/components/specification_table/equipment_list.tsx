import {
  useMstSlotItemEquipTypes,
  useMstSlotItems,
  useSlotItems,
} from "../../utility/provider.tsx";

import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  Show,
  Switch,
} from "solid-js";
import { createStore } from "solid-js/store";

import { get_data_set_equip } from "../../utility/get_data_set.tsx";

import "../../css/divider.css";
import "../../css/specification_table.css";
import { ComponentEquipmentModal, IconPlaneProficiency } from "ui";
import { matchesEquipRangeFilters } from "./equipment_filter.ts";
import {
  buildVisibleSpecRows,
  CategoryTabStrip,
  createSpecTableScrollController,
  SpecScrollArrowButton,
  SpecTableHeaderBar,
  SpecTableVirtualList,
  type SpecTableScrollController,
} from "./scroll_controls.tsx";
import type {
  CheckName,
  CheckProps,
  CheckTypes,
  RangeProps,
} from "./set_window.tsx";
import {
  init_range_props,
  search_name_window,
  select_properties_window,
  set_range_window_list,
  set_type_window,
  sort_window,
} from "./set_window.tsx";

const table_width = "1268px";

export function EquipmentListComponent() {
  const [slot_items] = useSlotItems();
  const [mst_slot_items] = useMstSlotItems();
  const [mst_slot_items_equip_types] = useMstSlotItemEquipTypes();

  const equip_properties = [
    "Level",
    "Firepower",
    "Torpedo",
    "Anti-Air",
    "Armor",
    "Evasion",
    "Anti-Submarine",
    "Reconnaissance",
    "Proficiency",
    "Bomb",
    "Anti-Bomber",
    "Interception",
    "Distance",
  ];
  const equip_properties_abbreviation = [
    "Lv",
    "Fire",
    "Tor",
    "AA",
    "Arm",
    "Eva",
    "ASW",
    "Rec",
    "Prof",
    "Bomb",
    "AB",
    "Int",
    "Dis",
  ];

  const [equip_spec_modal, set_equip_spec_modal] = createSignal(false);

  const store_equip_data_set = createMemo(() => {
    return get_data_set_equip(
      Object.keys(slot_items.slot_items).map((id) => Number(id)),
    );
  });

  const [check_equip_types, set_check_equip_types] = createStore<CheckTypes>(
    {},
  );
  createEffect(() => {
    if (
      Object.keys(mst_slot_items_equip_types.mst_slotitem_equip_types).length ==
      0
    )
      return;
    const _check_equip_types: CheckTypes = {};
    Object.values(mst_slot_items_equip_types.mst_slotitem_equip_types).forEach(
      (mst_slotitem_equip_types) => {
        if (mst_slotitem_equip_types)
          _check_equip_types[mst_slotitem_equip_types.name] = true;
      },
    );
    set_check_equip_types(_check_equip_types);
  });

  const [check_name, set_check_name] = createStore<CheckName>({});
  createEffect(() => {
    const check_name: CheckName = {};
    Object.entries(slot_items.slot_items).forEach(([slot_item_id]) => {
      check_name[Number(slot_item_id)] = true;
    });
    set_check_name(check_name);
  });

  const [search_name, set_search_name] = createSignal("");

  const [check_equip_property, set_check_equip_property] =
    createStore<CheckProps>(
      (() => {
        const check_equip_property: CheckProps = {};
        check_equip_property["Equip Type"] = true;
        equip_properties.forEach((property) => {
          check_equip_property[property] = true;
        });
        return check_equip_property;
      })(),
    );

  const [set_order, set_set_order] = createSignal(false);
  const [set_sort, set_set_sort] = createSignal("Default");

  const [set_categorize, set_set_categorize] = createSignal(false);
  const [set_equip_type, set_set_equip_type] = createSignal(
    (() => {
      const equip_type_name = Object.values(
        mst_slot_items_equip_types.mst_slotitem_equip_types,
      )[0]?.name;
      return equip_type_name ? equip_type_name : "小口径主砲";
    })(),
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
        b_mst_equip.sortno,
      );
    if (set_sort() == "Level")
      return additional_sort_fn(
        a_equip.level,
        b_equip.level,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Firepower")
      return additional_sort_fn(
        a_mst_equip.houg,
        b_mst_equip.houg,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Torpedo")
      return additional_sort_fn(
        a_mst_equip.raig,
        b_mst_equip.raig,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Anti-Air")
      return additional_sort_fn(
        a_mst_equip.tyku,
        b_mst_equip.tyku,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Armor")
      return additional_sort_fn(
        a_mst_equip.souk,
        b_mst_equip.souk,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Evasion")
      return additional_sort_fn(
        a_mst_equip.houm,
        b_mst_equip.houm,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Anti-Submarine")
      return additional_sort_fn(
        a_mst_equip.tais,
        b_mst_equip.tais,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Reconnaissance")
      return additional_sort_fn(
        a_mst_equip.saku,
        b_mst_equip.saku,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Proficiency")
      return additional_sort_fn(
        a_equip.alv ?? 0,
        b_equip.alv ?? 0,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Bomb")
      return additional_sort_fn(
        a_mst_equip.baku,
        b_mst_equip.baku,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Anti-Bomber")
      return additional_sort_fn(
        a_mst_equip.taibaku,
        b_mst_equip.taibaku,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Interception")
      return additional_sort_fn(
        a_mst_equip.geigeki,
        b_mst_equip.geigeki,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    if (set_sort() == "Distance")
      return additional_sort_fn(
        a_mst_equip.distance ?? 0,
        b_mst_equip.distance ?? 0,
        a_mst_equip.sortno,
        b_mst_equip.sortno,
      );
    return 0;
  };

  const sorted_equip_keys = createMemo(() => {
    const keys = Object.keys(slot_items.slot_items);
    const sorted_keys = keys.sort(sort_fn);
    if (!set_order()) sorted_keys.reverse();
    return sorted_keys;
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
      },
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
      },
    );

    return categorized_equips_keys;
  });

  const [range_props, set_range_props] = createStore<RangeProps>(
    init_range_props(equip_properties, equip_properties_abbreviation),
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
          if (!matchesEquipRangeFilters(slot_item, mst_slot_item, range_props)) {
            return false;
          }
        }
        return true;
      })();
    });
    return ret;
  });

  const set_range_window = (modal_prefix: string) => {
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

    return set_range_window_list(
      modal_prefix,
      params,
      range_props,
      set_range_props,
      set_equip_spec_modal,
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
        <th class="px-0 w-10 flex items-center rounded-l bg-base-100 z-[2] sticky left-0">
          <span class="flex-1" />
          {index + 1}
          <div class="w-[10px]" />
        </th>
        <td class="w-48 overflow-hidden bg-base-100 sticky left-10 z-[2]">
          {/* <EquimentComponent slot_id={Number(equip_id)} name_flag={true} /> */}
          <ComponentEquipmentModal
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
              {mst_slot_item?.souk}
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
              <IconPlaneProficiency size="xs" level={slot_item?.alv ?? 0} />
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
        <td class="w-9 shrink-0 p-0" aria-hidden="true" />
      </tr>
    );
  };
  const table_header = (controller: SpecTableScrollController) => {
    const modal_prefix = "equipment_spec_modal";
    const sort_window_element = sort_window(
      equip_properties,
      modal_prefix,
      set_order,
      set_set_order,
      set_sort,
      set_set_sort,
      set_equip_spec_modal,
    );
    const search_name_window_element = search_name_window(
      "Equip Name",
      modal_prefix,
      check_name,
      search_name,
      set_search_name,
      cal_search_name,
      set_equip_spec_modal,
    );
    const set_equip_type_window_element = set_type_window(
      "Equip Type",
      modal_prefix,
      check_equip_types,
      set_check_equip_types,
      set_equip_type,
      set_categorize,
      set_equip_spec_modal,
    );
    const set_range_window_elements = set_range_window(modal_prefix);

    return (
      <thead>
        <tr class="flex items-stretch">
          <th class="w-10 flex justify-center bg-base-100 z-[20] sticky left-0">
            {sort_window_element}
          </th>
          <th class="w-48 bg-base-100 z-[15] sticky left-10 flex items-center justify-between gap-1">
            <div class="shrink-0">{search_name_window_element}</div>
            <SpecScrollArrowButton
              direction="left"
              disabled={!controller.canScrollLeft()}
              ariaLabel="Scroll table columns left"
              dataRole="header-left"
              divider="right"
              class="-mr-[5px]"
              onClick={() => controller.scrollBy(-1)}
            />
          </th>
          <Show when={check_equip_property["Equip Type"]}>
            <th class="w-[96px]">{set_equip_type_window_element}</th>
          </Show>
          <Show when={check_equip_property["Level"]}>
            <th class="w-12 flex">
              <span class="flex-1" />
              {set_range_window_elements["Level"]}
            </th>
          </Show>
          <Show when={check_equip_property["Firepower"]}>
            <th class="w-[72px] flex">
              <span class="flex-1" />
              {set_range_window_elements["Firepower"]}
            </th>
          </Show>
          <Show when={check_equip_property["Torpedo"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window_elements["Torpedo"]}
            </th>
          </Show>
          <Show when={check_equip_property["Anti-Air"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window_elements["Anti-Air"]}
            </th>
          </Show>
          <Show when={check_equip_property["Armor"]}>
            <th class="w-14 flex">
              <span class="flex-1" />
              {set_range_window_elements["Armor"]}
            </th>
          </Show>
          <Show when={check_equip_property["Evasion"]}>
            <th class="w-16 flex">
              <span class="flex-1" />
              {set_range_window_elements["Evasion"]}
            </th>
          </Show>
          <Show when={check_equip_property["Anti-Submarine"]}>
            <th class="w-24 flex">
              <span class="flex-1" />
              {set_range_window_elements["Anti-Submarine"]}
            </th>
          </Show>
          <Show when={check_equip_property["Reconnaissance"]}>
            <th class="w-24 flex">
              <span class="flex-1" />
              {set_range_window_elements["Reconnaissance"]}
            </th>
          </Show>
          <Show when={check_equip_property["Proficiency"]}>
            <th class="w-20 flex">
              <span class="flex-1" />
              {/* {set_discrete_range_window_image()["Proficiency"]} */}
              {set_range_window_elements["Proficiency"]}
            </th>
          </Show>
          <Show when={check_equip_property["Bomb"]}>
            <th class="w-12 flex">
              <span class="flex-1" />
              {set_range_window_elements["Bomb"]}
            </th>
          </Show>
          <Show when={check_equip_property["Anti-Bomber"]}>
            <th class="w-20 flex">
              <span class="flex-1" />
              {set_range_window_elements["Anti-Bomber"]}
            </th>
          </Show>
          <Show when={check_equip_property["Interception"]}>
            <th class="w-20 flex">
              <span class="flex-1" />
              {set_range_window_elements["Interception"]}
            </th>
          </Show>
          <Show when={check_equip_property["Distance"]}>
            <th class="w-12 flex">
              <span class="flex-1" />
              {set_range_window_elements["Distance"]}
            </th>
          </Show>
          <th class="w-9 shrink-0 p-0" aria-hidden="true" />
        </tr>
      </thead>
    );
  };

  const categorizedScroll = createSpecTableScrollController(equip_spec_modal);
  const uncategorizedScroll = createSpecTableScrollController(equip_spec_modal);

  const categorized_equip_rows = createMemo(() =>
    buildVisibleSpecRows(
      categorized_equips_keys()[set_equip_type()] ?? [],
      filtered_equips(),
    ),
  );
  const uncategorized_equip_rows = createMemo(() =>
    buildVisibleSpecRows(sorted_equip_keys(), filtered_equips()),
  );

  createEffect(() => {
    Object.values(check_equip_property);
    set_categorize();
    set_equip_type();
    categorized_equip_rows();
    uncategorized_equip_rows();
    categorizedScroll.refreshEdges();
    uncategorizedScroll.refreshEdges();
  });

  const cal_search_name = (search_name: string) => {
    const tmp_name: CheckName = {};
    Object.entries(slot_items.slot_items).forEach(([equip_id, slotitem]) => {
      const mst_slot_item = slotitem
        ? mst_slot_items.mst_slot_items[slotitem.slotitem_id]
        : undefined;
      tmp_name[Number(equip_id)] = mst_slot_item
        ? mst_slot_item.name.indexOf(search_name) !== -1
        : false;
    });
    set_check_name(tmp_name);
  };

  const wrap_select_properties_window = () =>
    select_properties_window(
      "equip_spec_modal",
      check_equip_property,
      set_check_equip_property,
      set_equip_spec_modal,
    );

  return (
    <div class="h-full flex flex-col min-h-0 flex-1">
      <div class="bg-base-100 z-[4] shrink-0">
        <div class="h-2" />
        <div class="px-2 py-1 text-xs flex flex-wrap items-center">
          <div class="px-4 flex-none text-sm w-60">
            Equipment Specification Table
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
          <CategoryTabStrip
            radioName="equip_specification_table_tab"
            categories={() => Object.keys(categorized_equips_keys())}
            hasItems={(equip_type_name) =>
              (categorized_equips_keys()[equip_type_name]?.length ?? 0) != 0
            }
            activeCategory={set_equip_type}
            onSelect={(equip_type_name) => set_set_equip_type(equip_type_name)}
            modalOpen={equip_spec_modal}
          />

          <div class="w-full flex flex-col flex-1 min-h-0 border-t border-base-300">
            <SpecTableHeaderBar
              controller={categorizedScroll}
              tableWidth={table_width}
            >
              {table_header(categorizedScroll)}
            </SpecTableHeaderBar>
            <div
              ref={categorizedScroll.bindVListWrapper}
              class="w-full flex-1 min-h-0"
            >
              <SpecTableVirtualList
                rows={categorized_equip_rows}
                tableWidth={table_width}
                renderRow={table_line_element}
              />
            </div>
          </div>
        </Match>
        <Match when={!set_categorize()}>
          <div class="w-full flex flex-col flex-1 min-h-0">
            <SpecTableHeaderBar
              controller={uncategorizedScroll}
              tableWidth={table_width}
            >
              {table_header(uncategorizedScroll)}
            </SpecTableHeaderBar>
            <div
              ref={uncategorizedScroll.bindVListWrapper}
              class="w-full flex-1 min-h-0"
            >
              <SpecTableVirtualList
                rows={uncategorized_equip_rows}
                tableWidth={table_width}
                renderRow={table_line_element}
              />
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
