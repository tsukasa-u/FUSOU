import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { ComponentEquipmentMstProps } from "./equipment-mst";
import "./equipment-mst";
import { default_mst_slot_item } from "@ipc-bindings/default_state/get_data";
import { html } from "lit";

const size_list = ["xs", "sm", "md", "lg", "xl"];

const ComponentEquipmentMstBasic = (args: ComponentEquipmentMstProps) => {
  return html`<component-equipment-mst
    .mst_slot_item=${args.mst_slot_item}
    ?name_flag=${args.name_flag}
    ?show_name=${args.show_name}
    size=${args.size}
    ?empty_flag=${args.empty_flag}
    ?compact=${args.compact}
  ></component-equipment-mst>`;
};
const meta = {
  title: "FUSOU/components/equipment-mst/component-equipment-mst",
  tags: ["autodocs"],
} satisfies Meta<ComponentEquipmentMstProps>;

export default meta;
type Story = StoryObj<ComponentEquipmentMstProps>;

export const basic: Story = {
  render: (args: ComponentEquipmentMstProps) =>
    ComponentEquipmentMstBasic(args),
  name: "Basic",
  argTypes: {
    name_flag: { control: "boolean" },
    show_name: { control: "boolean" },
    compact: { control: "boolean" },
    size: {
      control: { type: "select" },
      options: size_list,
      table: {
        defaultValue: { summary: "xs" },
        type: {
          summary: size_list.join("\|"),
        },
      },
    },
    empty_flag: { control: "boolean" },
    mst_slot_item: { control: "select", options: [undefined] },
  },
  args: {
    name_flag: false,
    show_name: true,
    size: "xs",
    empty_flag: false,
    compact: false,
    mst_slot_item: {
      ...default_mst_slot_item,
      id: 156,
      sortno: 156,
      name: "\u96f6\u622652\u578b\u7532(\u4ed8\u5ca9\u672c\u5c0f\u968a)",
      type: [3, 5, 6, 6, 12],
      taik: 0,
      souk: 0,
      houg: 0,
      raig: 0,
      soku: 0,
      baku: 0,
      tyku: 11,
      tais: 0,
      atap: 0,
      houm: 1,
      raim: 0,
      houk: 3,
      raik: 0,
      bakk: 0,
      saku: 1,
      sakb: 0,
      luck: 0,
      leng: 0,
      cost: 5,
      distance: 6,
      rare: 4,
      broken: [1, 2, 0, 4],
      usebull: "0",
    },
  },
};
