import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { ComponentColorBarLabelProps } from "./color-bar-label";
import {
  ComponentColorBarLabelBasic,
  ComponentColorBarLabelCatalog,
} from "./color-bar-label";

const size_list = ["xs", "sm", "md", "lg", "xl"];

const meta = {
  title: "FUSOU/components/bar/component-color-bar-label",
  tags: ["autodocs"],
} satisfies Meta<ComponentColorBarLabelProps>;

export default meta;
type Story = StoryObj<ComponentColorBarLabelProps>;

export const basic: Story = {
  render: (args: ComponentColorBarLabelProps) =>
    ComponentColorBarLabelBasic(args),
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
  render: () => ComponentColorBarLabelCatalog(),
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
