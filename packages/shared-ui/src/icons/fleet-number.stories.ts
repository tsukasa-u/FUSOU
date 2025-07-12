import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconFleetNumberProps } from "./fleet-number";
import { IconFleetNumberCatalog, IconFleetNumberBasic } from "./fleet-number";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const meta = {
  title: "FUSOU/icons/icon-fleet-number",
  tags: ["autodocs"],
} satisfies Meta<IconFleetNumberProps>;

export default meta;
type Story = StoryObj<IconFleetNumberProps>;

export const basic: Story = {
  render: (args: IconFleetNumberProps) => IconFleetNumberBasic(args),
  name: "Basic",
  argTypes: {
    combined_flag: {
      control: { type: "select" },
      options: [true, false, undefined],
    },
    ship_number: {
      control: { type: "select" },
      options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    },
    fleet_number: {
      control: { type: "select" },
      options: [1, 2, 3, 4],
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
    combined_flag: undefined,
    fleet_number: 1,
    ship_number: 1,
  },
};

export const catalog: Story = {
  render: () => IconFleetNumberCatalog(),
  name: "Catalog",
  argTypes: {
    combined_flag: {
      control: { disable: true },
    },
    fleet_number: {
      control: { disable: true },
    },
    ship_number: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};
