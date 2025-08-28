import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { ComponentEquipmentMstTableProps } from "./equipment-mst-table";
import "./equipment-mst-table";
import { default_mst_slot_item } from "@ipc-bindings/default_state/get_data";
import { html } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";

const size_list = ["xs", "sm", "md", "lg", "xl"];

const ComponentEquipmentMstTableBasic = (
  args: ComponentEquipmentMstTableProps
) => {
  return html`<component-equipment-mst-table
    .mst_slot_item=${args.mst_slot_item}
    ?show_param=${args.show_param}
    ?show_name=${args.show_name}
    size=${ifDefined(args.size)}
  ></component-equipment-mst-table>`;
};

const meta = {
  title: "FUSOU/components/equipment-mst/component-equipment-mst-table",
  tags: ["autodocs"],
} satisfies Meta<ComponentEquipmentMstTableProps>;

export default meta;
type Story = StoryObj<ComponentEquipmentMstTableProps>;

export const basic: Story = {
  render: (args: ComponentEquipmentMstTableProps) =>
    ComponentEquipmentMstTableBasic(args),
  name: "Basic",
  argTypes: {
    show_param: { type: "boolean" },
    show_name: { type: "boolean" },
    size: {
      control: { type: "select" },
      options: size_list,
      table: {
        defaultValue: { summary: "sm" },
        type: {
          summary: size_list.join("\|"),
        },
      },
    },
    mst_slot_item: { control: "select", options: [undefined] },
  },
  args: {
    size: "sm",
    show_param: false,
    show_name: false,
    mst_slot_item: {
      ...default_mst_slot_item,
      id: 267,
      sortno: 267,
      name: "12.7cm\u9023\u88c5\u7832D\u578b\u6539\u4e8c",
      type: [1, 1, 1, 1, 0],
      taik: 0,
      souk: 1,
      houg: 3,
      raig: 0,
      soku: 0,
      baku: 0,
      tyku: 4,
      tais: 0,
      atap: 0,
      houm: 2,
      raim: 0,
      houk: 1,
      raik: 0,
      bakk: 0,
      saku: 0,
      sakb: 0,
      luck: 0,
      leng: 1,
      rare: 3,
      broken: [0, 2, 2, 1],
      usebull: "0",
    },
  },
};
