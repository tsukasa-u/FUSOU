import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { ComponentShipProps } from "./ship";
import { ComponentShipBasic } from "./ship";

const size_list = ["xs", "sm", "md", "lg", "xl"];

const meta = {
  title: "FUSOU/components/ship/component-ship",
  tags: ["autodocs"],
} satisfies Meta<ComponentShipProps>;

export default meta;
type Story = StoryObj<ComponentShipProps>;

export const basic: Story = {
  render: (args: ComponentShipProps) => ComponentShipBasic(args),
  name: "Basic",
  argTypes: {
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
    name_flag: {
      control: { type: "boolean" },
    },
    empty_flag: {
      control: { type: "boolean" },
    },
  },
  args: {
    size: "sm",
    name_flag: false,
    empty_flag: false,
    ship: {
      id: 4299,
      ship_id: 668,
      lv: 132,
      exp: [1999074, 25926, 69],
      nowhp: 55,
      maxhp: 60,
      soku: 10,
      leng: 2,
      slot: [7355, 7571, 8735, 3006, -1],
      onslot: [1, 1, 2, 2, 0],
      slot_ex: 6865,
      fuel: 10,
      bull: 15,
      slotnum: 4,
      cond: 49,
      karyoku: [95, 81],
      raisou: [102, 88],
      taiku: [107, 88],
      soukou: [76, 74],
      kaihi: [112, 86],
      taisen: [96, 80],
      sakuteki: [84, 60],
      lucky: [22, 89],
      sp_effect_items: {
        items: {
          2: {
            kind: 2,
            houg: 2,
            kaih: 2,
          },
        },
      },
      sally_area: 0,
    },
    mst_ship: {
      id: 668,
      sortno: 468,
      sort_id: 11037,
      name: "\u77e2\u77e7\u6539\u4e8c\u4e59",
      yomi: "\u3084\u306f\u304e",
      stype: 3,
      ctype: 41,
      afterlv: 90,
      aftershipid: "663",
      taik: [53, 68],
      souk: [32, 74],
      houg: [30, 81],
      raig: [24, 88],
      tyku: [36, 88],
      luck: [17, 89],
      soku: 10,
      leng: 2,
      slot_num: 4,
      maxeq: [1, 1, 2, 2, 0],
      buildtime: 60,
      broken: [4, 8, 16, 4],
      powup: [2, 2, 2, 3],
      backs: 8,
      getmes: "<br>",
      afterfuel: 480,
      afterbull: 880,
      fuel_max: 45,
      bull_max: 50,
      voicef: 7,
      tais: [],
    },
  },
};
