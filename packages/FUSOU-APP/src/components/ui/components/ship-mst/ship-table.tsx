import { Show } from "solid-js";
import type { Component } from "solid-js";

import { default_mst_ship } from "@ipc-bindings/default_state/get_data";
import type { MstShip } from "@ipc-bindings/get_data";

import { IconError } from "../../icons/error";

export interface ComponentShipMstTableProps {
  mst_ship?: MstShip;
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

export const ComponentShipMstTable: Component<ComponentShipMstTableProps> = (props) => {
  const mst_ship = () => props.mst_ship ?? default_mst_ship;
  const size = () => props.size ?? "sm";

  const maxEq = () => {
    const ship = mst_ship();
    return ship?.maxeq
      ? ship.maxeq.reduce((a, b) => a + b, 0)
      : 0;
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
          <div
            class={["place-self-end pl-4", class_size[size()].level_text].join(
              " ",
            )}
          >
            Lv. {1}
          </div>
        </div>
        <div class="pt-2">
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
                  {mst_ship()?.taik?.[0] ?? "-"}
                </td>
                <th class="truncate flex-1 w-2">Firepower</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {mst_ship().houg?.[0] ?? "-"}
                </td>
              </tr>
              <tr class="flex rounded">
                <th class="truncate flex-1 w-2">Armor</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {mst_ship().souk?.[0] ?? "-"}
                </td>
                <th class="truncate flex-1 w-2">Torpedo</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {mst_ship().raig?.[0] ?? "-"}
                </td>
              </tr>
              <tr class="flex rounded">
                <th class="truncate flex-1 w-2">Evasion</th>
                <td class="flex-none w-12 flex justify-end pr-4">{"-"}</td>
                <th class="truncate flex-1 w-2">Anti-Air</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {mst_ship().tyku?.[0] ?? "-"}
                </td>
              </tr>
              <tr class="flex rounded">
                <th class="truncate flex-1 w-2">Aircraft installed</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {maxEq() ? (maxEq() > 0 ? maxEq() : "") : "-"}
                </td>
                <th class="truncate flex-1 w-2">Anti-Submarine</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {mst_ship().tais?.[0] ?? "-"}
                </td>
              </tr>
              <tr class="flex rounded">
                <th class="truncate flex-1 w-2">Speed</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {speed_list[mst_ship().soku ?? "-"] ?? "-"}
                </td>
                <th class="truncate flex-1 w-2">Reconnaissance</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {mst_ship().tyku?.[0] ?? "-"}
                </td>
              </tr>
              <tr class="flex rounded">
                <th class="truncate flex-1 w-2">Range</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {mst_ship().leng ? range_list[mst_ship().leng ?? 0] : "-"}
                </td>
                <th class="truncate flex-1 w-2">Luck</th>
                <td class="flex-none w-12 flex justify-end pr-4">
                  {mst_ship().luck?.[0] ?? "-"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Show>
  );
};
