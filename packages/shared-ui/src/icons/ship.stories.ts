import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconShipProps } from "./ship";
import "./ship";

import { ifDefined } from "lit/directives/if-defined.js";
import { html } from "lit";

import get_data from "@fusou-testdata-shared-ui/data/S@api_start2@getData.json";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const IconShipBasic = (args: IconShipProps) => {
  return html`<icon-ship
    ship_stype=${args.ship_stype}
    color=${ifDefined(args.color)}
    size=${ifDefined(args.size)}
    ?empty_flag=${args.empty_flag}
  ></icon-ship>`;
};

const IconShipCatalog = () => {
  //   console.log(get_data.api_data.api_mst_ship);
  const category_type_number = [
    ...new Set(
      get_data.api_data.api_mst_ship.map((x) =>
        String([x.api_stype, x.apt_ctype])
      )
    ),
  ].map((s) => s.split(",").map((x) => Number(x)));

  return html`<div class="grid grid-cols-6 w-100 gap-4">
    ${category_type_number.map(
      ([stype, _ctype]) =>
        html`<div class="grid gap-4">
          <icon-ship ship_stype=${stype} color=${""} size=${"xs"}></icon-ship>
          <icon-ship
            ship_stype=${stype}
            color=${"elite"}
            size=${"xs"}
          ></icon-ship>
          <icon-ship
            ship_stype=${stype}
            color=${"flagship"}
            size=${"xs"}
          ></icon-ship>
        </div>`
    )}
  </div>`;
};

const meta = {
  title: "FUSOU/icons/icon-ship",
  tags: ["autodocs"],
} satisfies Meta<IconShipProps>;

export default meta;
type Story = StoryObj<IconShipProps>;

export const basic: Story = {
  render: (args: IconShipProps) => IconShipBasic(args),
  name: "Basic",
  argTypes: {
    ship_stype: {
      control: { type: "select" },
      options: [1, 2, 3, 4, 5],
    },
    color: {
      control: { type: "select" },
      options: [undefined, "", "-", "elite", "flagship"],
    },
    empty_flag: {
      control: "boolean",
    },
    size: {
      control: { type: "select" },
      options: size_list,
      table: {
        defaultValue: { summary: "xs" },
        type: {
          summary: size_list.join("|"),
        },
      },
    },
  },
  args: {
    size: "full",
    ship_stype: 1,
    color: "",
    empty_flag: false,
  },
};

export const catalog: Story = {
  render: () => IconShipCatalog(),
  name: "Catalog",
  argTypes: {
    ship_stype: {
      control: { disable: true },
    },
    color: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};
