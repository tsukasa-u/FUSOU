import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { ComponentColorBarProps } from "./color-bar";
import { ComponentColorBarBasic, ComponentColorBarCatalog } from "./color-bar";

const size_list = ["none", "xs", "sm", "md", "lg", "xl"];

const meta = {
  title: "FUSOU/components/component-color-bar",
  tags: ["autodocs"],
} satisfies Meta<ComponentColorBarProps>;

export default meta;
type Story = StoryObj<ComponentColorBarProps>;

export const basic: Story = {
  render: (args: ComponentColorBarProps) => ComponentColorBarBasic(args),
  name: "Basic",
  argTypes: {
    v_now: {
      control: { type: "range", max: 100, min: 0 },
    },
    v_max: {
      control: { disable: true },
    },
    quantize: {
      control: { type: "range", max: 10, min: 0 },
      table: {
        defaultValue: { summary: "undefined" },
        type: {
          summary: ["undefined", "number"].join("\|"),
        },
      },
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
    v_now: 70,
    v_max: 100,
    quantize: undefined,
    size: "xs",
  },
};

export const catalog: Story = {
  render: () => ComponentColorBarCatalog(),
  name: "Catalog",
  argTypes: {
    v_now: {
      control: { disable: true },
    },
    v_max: {
      control: { disable: true },
    },
    quantize: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};
