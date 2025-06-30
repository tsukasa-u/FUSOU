import type { Meta, StoryObj } from "@storybook/web-components-vite";

import { fn } from "storybook/test";

import type { EquipmentProps } from "./equip";
import { Equipment, EquipmentWrap } from "./equip";
import { html } from "lit";

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories
const meta = {
  title: "FUSOU/EQUIP",
  tags: ["autodocs"],
  render: (args) => EquipmentWrap(args),
  argTypes: {
    icon_number: {
      control: { type: "select" },
      options: [1, 2, 3],
    },
    category_number: {
      control: { type: "select" },
      options: [1, 2, 3],
    },
    size: {
      control: { type: "range" },
    },
  },
  args: { onClick: fn() },
} satisfies Meta<EquipmentProps>;

export default meta;
type Story = StoryObj<EquipmentProps>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    size: 1,
  },
};

export const Secondary: Story = {
  args: {
    size: 1,
  },
};

export const Large: Story = {
  args: {
    size: 1,
  },
};

export const Small: Story = {
  args: {
    size: 3,
  },
};
