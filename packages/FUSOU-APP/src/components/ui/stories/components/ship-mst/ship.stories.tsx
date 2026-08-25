import { ComponentShipMstProps, ComponentShipMst } from "ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const size_list = ["xs", "sm", "md", "lg", "xl"];

const ComponentShipMstBasic = (args: ComponentShipMstProps) => {
  return (<ComponentShipMst
    mst_ship={args.mst_ship}
    color={args.color}
    size={args.size}
    name_flag={args.name_flag}
    empty_flag={args.empty_flag}
  ></ComponentShipMst>);
};

const meta = {
  title: "FUSOU/components/ship-mst/component-ship-mst",
  tags: ["autodocs"],
} satisfies Meta<ComponentShipMstProps>;

export default meta;
type Story = StoryObj<ComponentShipMstProps>;

export const basic: Story = {
  render: (args: ComponentShipMstProps) => ComponentShipMstBasic(args),
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
    name_flag: {
      control: { type: "boolean" },
    },
    empty_flag: {
      control: { type: "boolean" },
    },
    mst_ship: { control: "select", options: [undefined] },
  },
  args: {
    size: "sm",
    name_flag: false,
    empty_flag: false,
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
