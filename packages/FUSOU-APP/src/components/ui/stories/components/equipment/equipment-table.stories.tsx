import { ComponentEquipmentTableProps } from "ui";
import { ComponentEquipmentTable } from "ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { default_slotitem } from "@ipc-bindings/default_state/require_info";
import { default_mst_slot_item } from "@ipc-bindings/default_state/get_data";

const size_list = ["xs", "sm", "md", "lg", "xl"];

const ComponentEquipmentTableBasic = (args: ComponentEquipmentTableProps) => {
  return (<ComponentEquipmentTable
    slot_item={args.slot_item}
    mst_slot_item={args.mst_slot_item}
    size={args.size}
  ></ComponentEquipmentTable>);
};

const meta = {
  title: "FUSOU/components/equipment/component-equipment-table",
  tags: ["autodocs"],
} satisfies Meta<ComponentEquipmentTableProps>;

export default meta;
type Story = StoryObj<ComponentEquipmentTableProps>;

export const basic: Story = {
  render: (args: ComponentEquipmentTableProps) =>
    ComponentEquipmentTableBasic(args),
  name: "Basic",
  argTypes: {
    size: {
      control: { type: "select" },
      options: size_list,
      table: {
        defaultValue: { summary: "sm" },
        type: {
          summary: size_list.join("|"),
        },
      },
    },
    slot_item: { control: "select", options: [undefined] },
    mst_slot_item: { control: "select", options: [undefined] },
  },
  args: {
    size: "sm",
    slot_item: {
      ...default_slotitem,
      slotitem_id: 267,
      locked: 0,
      level: 6,
    },
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
