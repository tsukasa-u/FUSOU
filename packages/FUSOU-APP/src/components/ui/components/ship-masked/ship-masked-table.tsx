import { Component, For, Show } from "solid-js";

import {
  default_mst_ship,
  default_mst_slot_items,
} from "@ipc-bindings/default_state/get_data";
import type { MstShip, MstSlotItems } from "@ipc-bindings/get_data";

import { ComponentEquipmentMstModal } from "../equipment-mst/equipment-mst-modal";
import { IconError } from "../../icons/error";

export interface ComponentShipMaskedTableProps {
  mst_ship?: MstShip;
  mst_slot_items?: MstSlotItems;
  ship_param: number[];
  ship_slot: number[];
  ship_max_hp: number;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  class?: string;
  classList?: any;
}

const class_size = {
  xs: {
    name_text: "text-md",
    level_text: "text-sm",
    caption_text: "text-sm",
    table: "table-xs",
    accent_text: "text-xs",
  },
  sm: {
    name_text: "text-lg",
    level_text: "text-md",
    caption_text: "text-md",
    table: "table-sm",
    accent_text: "text-sm",
  },
  md: {
    name_text: "text-xl",
    level_text: "text-lg",
    caption_text: "text-lg",
    table: "table-md",
    accent_text: "text-md",
  },
  lg: {
    name_text: "text-2xl",
    level_text: "text-xl",
    caption_text: "text-xl",
    table: "table-lg",
    accent_text: "text-lg",
  },
  xl: {
    name_text: "text-3xl",
    level_text: "text-2xl",
    caption_text: "text-2xl",
    table: "table-xl",
    accent_text: "text-xl",
  },
};

export const ComponentShipMaskedTable: Component<ComponentShipMaskedTableProps> = (props) => {
  const mst_ship = () => props.mst_ship ?? default_mst_ship;
  const mst_slot_items = () => props.mst_slot_items ?? default_mst_slot_items;
  const size = () => props.size ?? "sm";
  const ship_param = () => props.ship_param ?? [0, 0, 0, 0];
  const ship_slot = () => props.ship_slot ?? [0, 0, 0, 0, 0];

  const equipmentTemplete = (slot: number) => {
    if (slot > 0) {
      const mst_slot_item = mst_slot_items()
        ? mst_slot_items().mst_slot_items[slot]
        : undefined;
      return (
        <ComponentEquipmentMstModal
          name_flag={true}
          show_name={false}
          show_param={false}
          mst_slot_item={mst_slot_item}
          compact={false}
          size={size()}
        />
      );
    } else {
      return (
        <ComponentEquipmentMstModal
          empty_flag={true}
          size={size()}
        />
      );
    }
  };

  const slotsTemplete = () => {
    return (
      <For each={ship_slot()}>
        {(slot, index) => {
          return (
            <tr
              class={[
                "flex rounded rounded items-center w-full",
                mst_ship() && mst_ship().slot_num <= index()
                  ? "back_slash_color bg-[size:16px_16px] bg-top-left bg-[image:repeating-linear-gradient(45deg,currentColor_0,currentColor_0.5px,transparent_0,transparent_50%)]"
                  : ""
              ].join(" ")}
            >
              <th class="flex-none w-4">S{index() + 1}</th>
              <td class="flex-none w-12 ml-4 py-1 w-full">
                {equipmentTemplete(slot)}
              </td>
            </tr>
          );
        }}
      </For>
    );
  };

  return (
    <Show
      when={mst_ship()}
      fallback={
        <div class="outline-error outline-2 rounded bg-error-content">
          <IconError size="full" ratio={1} />
        </div>
      }
    >
      <div class="cursor-default">
        <div class="flex justify-start">
          <h3
            class={[
              "font-bold pl-2 truncate",
              class_size[size()].name_text,
            ].join(" ")}
          >
            {mst_ship().name ?? "Unknown"}
          </h3>
        </div>
        <div class="pt-2">
          <table class={["table", class_size[size()].table].join(" ")}>
            <caption
              class={["truncate", class_size[size()].caption_text].join(" ")}
            >
              Slots
            </caption>
            <tbody>
              {slotsTemplete()}
            </tbody>
          </table>
          <div class="h-2"></div>
          <table class={["table", class_size[size()].table].join(" ")}>
            <caption
              class={["truncate", class_size[size()].caption_text].join(" ")}
            >
              Ship Status
            </caption>
            <tbody>
              <tr class="flex rounded">
                <th class="truncate flex-1 w-2">Durability</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {props.ship_max_hp ?? 0}
                </td>
                <th class="truncate flex-1 w-2">Firepower</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {ship_param()[0] ?? 0}
                </td>
              </tr>
              <tr class="flex rounded">
                <th class="truncate flex-1 w-2">Armor</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {ship_param()[3] ?? 0}
                </td>
                <th class="truncate flex-1 w-2">Torpedo</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {ship_param()[1] ?? 0}
                </td>
              </tr>
              <tr class="flex rounded">
                <th class="truncate flex-1 w-2">Evasion</th>
                <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                <th class="truncate flex-1 w-2">Anti-Air</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {ship_param()[2] ?? 0}
                </td>
              </tr>
              <tr class="flex rounded">
                <th class="truncate flex-1 w-2">Aircraft installed</th>
                <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                <th class="truncate flex-1 w-2">Anti-Submarine</th>
                <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
              </tr>
              <tr class="flex rounded">
                <th class="truncate flex-1 w-2">Speed</th>
                <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                <th class="truncate flex-1 w-2">Reconnaissance</th>
                <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
              </tr>
              <tr class="flex rounded">
                <th class="truncate flex-1 w-2">Range</th>
                <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
                <th class="truncate flex-1 w-2">Luck</th>
                <td class="flex-none w-12 flex justify-end pr-4">unknown</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Show>
  );
};
