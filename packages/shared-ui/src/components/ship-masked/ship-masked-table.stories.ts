import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { ComponentShipMaskedTableProps } from "./ship-masked-table";
import "./ship-masked-table";
import { html } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";

const size_list = ["xs", "sm", "md", "lg", "xl"];

const ComponentShipMaskedTableBasic = (args: ComponentShipMaskedTableProps) => {
  return html`<component-ship-masked-table
    ship_max_hp=${args.ship_max_hp}
    .ship_param=${args.ship_param}
    .ship_slot=${args.ship_slot}
    .mst_slot_items=${args.mst_slot_items}
    .mst_ship=${args.mst_ship}
    size=${ifDefined(args.size)}
  ></component-ship-masked-table>`;
};

const meta = {
  title: "FUSOU/components/ship-masked/component-ship-masked-table",
  tags: ["autodocs"],
} satisfies Meta<ComponentShipMaskedTableProps>;

export default meta;
type Story = StoryObj<ComponentShipMaskedTableProps>;

export const basic: Story = {
  render: (args: ComponentShipMaskedTableProps) =>
    ComponentShipMaskedTableBasic(args),
  name: "Basic",
  argTypes: {
    ship_max_hp: { control: { type: "range", min: 1, max: 100, step: 1 } },
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
  },
  args: {
    size: "sm",
    ship_max_hp: 100,
    ship_param: [95, 102, 76, 107],
    ship_slot: [303, 303, 41, 106],
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
    mst_slot_items: {
      mst_slot_items: {
        303: {
          id: 303,
          sortno: 303,
          name: "Bofors 15.2cm\u9023\u88c5\u7832 Model 1930",
          type: [1, 1, 2, 2, 0],
          taik: 0,
          souk: 0,
          houg: 5,
          raig: 0,
          soku: 0,
          baku: 0,
          tyku: 4,
          tais: 0,
          atap: 0,
          houm: 3,
          raim: 0,
          houk: 1,
          raik: 0,
          bakk: 0,
          saku: 0,
          sakb: 0,
          luck: 0,
          leng: 2,
          rare: 3,
          broken: [0, 2, 3, 1],
          usebull: "0",
          geigeki: 0,
          taibaku: 0,
        },
        41: {
          id: 41,
          sortno: 41,
          name: "\u7532\u6a19\u7684 \u7532\u578b",
          type: [2, 4, 22, 5, 0],
          taik: 0,
          souk: 0,
          houg: 0,
          raig: 12,
          soku: 0,
          baku: 0,
          tyku: 0,
          tais: 0,
          atap: 0,
          houm: 0,
          raim: 0,
          houk: 0,
          raik: 0,
          bakk: 0,
          saku: 0,
          sakb: 0,
          luck: 0,
          leng: 0,
          rare: 1,
          broken: [0, 7, 7, 0],
          usebull: "0",
          version: 2,
          geigeki: 0,
          taibaku: 0,
        },
        106: {
          id: 106,
          sortno: 106,
          name: "13\u53f7\u5bfe\u7a7a\u96fb\u63a2\u6539",
          type: [5, 8, 12, 11, 0],
          taik: 0,
          souk: 0,
          houg: 0,
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
          saku: 4,
          sakb: 0,
          luck: 0,
          leng: 0,
          rare: 3,
          broken: [0, 0, 10, 11],
          usebull: "0",
          version: 2,
          geigeki: 0,
          taibaku: 0,
        },
        129: {
          id: 129,
          sortno: 129,
          name: "\u719f\u7df4\u898b\u5f35\u54e1",
          type: [16, 27, 39, 32, 0],
          taik: 0,
          souk: 0,
          houg: 0,
          raig: 0,
          soku: 0,
          baku: 0,
          tyku: 1,
          tais: 0,
          atap: 0,
          houm: 2,
          raim: 0,
          houk: 3,
          raik: 0,
          bakk: 0,
          saku: 2,
          sakb: 0,
          luck: 0,
          leng: 0,
          rare: 3,
          broken: [1, 0, 0, 0],
          usebull: "0",
          geigeki: 0,
          taibaku: 0,
        },
      },
    },
  },
};
