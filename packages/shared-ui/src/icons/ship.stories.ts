import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconShipProps } from "./ship";
import { IconShipBasic, IconShipCatalog } from "./ship";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

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
  },
  args: {
    size: "full",
    ship_stype: 1,
    color: "",
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
