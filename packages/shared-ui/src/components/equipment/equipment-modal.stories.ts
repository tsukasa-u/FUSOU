import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { ComponentEquipmentModalProps } from "./equipment-modal";
import "./equipment-modal";
import { default_slotitem } from "@ipc-bindings/default_state/require_info";
import { default_mst_slot_item } from "@ipc-bindings/default_state/get_data";
import { html } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";

const size_list = ["xs", "sm", "md", "lg", "xl"];

const ComponentEquipmentModalBasic = (args: ComponentEquipmentModalProps) => {
  return html`<component-equipment-modal
    .slot_item=${args.slot_item}
    .mst_slot_item=${args.mst_slot_item}
    ?ex_flag=${args.ex_flag}
    ?name_flag=${args.name_flag}
    onslot=${ifDefined(args["attr:onslot"])}
    size=${args.size}
    ?empty_flag=${args.empty_flag}
  ></component-equipment-modal>`;
};

const meta = {
  title: "FUSOU/components/equipment/component-equipment-modal",
  tags: ["autodocs"],
} satisfies Meta<ComponentEquipmentModalProps>;

export default meta;
type Story = StoryObj<ComponentEquipmentModalProps>;

export const basic: Story = {
  render: (args: ComponentEquipmentModalProps) =>
    ComponentEquipmentModalBasic(args),
  name: "Basic",
  argTypes: {
    name_flag: { control: "boolean" },
    ex_flag: { control: "boolean" },
    "attr:onslot": { control: { type: "range", min: 0, max: 30, step: 1 } },
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
    slot_item: { control: "select", options: [undefined] },
    mst_slot_item: { control: "select", options: [undefined] },
  },
  args: {
    name_flag: false,
    ex_flag: false,
    "attr:onslot": 0,
    size: "xs",
    empty_flag: false,
    slot_item: {
      ...default_slotitem,
      slotitem_id: 267,
      locked: 0,
      level: 6,
      alv: 6,
    },
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
