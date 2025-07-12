import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconCautionFillProps } from "./caution-fill";
import { IconCautionFillBasic, IconCautionFillCatalog } from "./caution-fill";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];
const caution_level = ["low", "middle", "high"];

const meta = {
  title: "FUSOU/icons/icon-caution-fill",
  tags: ["autodocs"],
} satisfies Meta<IconCautionFillProps>;

export default meta;
type Story = StoryObj<IconCautionFillProps>;

export const basic: Story = {
  render: (args: IconCautionFillProps) => IconCautionFillBasic(args),
  name: "Basic",
  argTypes: {
    level: {
      control: { type: "select" },
      option: caution_level,
      table: {
        defaultValue: { summary: "low" },
        type: {
          summary: caution_level.join("\|"),
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
    level: "middle",
    size: "full",
  },
};

export const catalog: Story = {
  render: () => IconCautionFillCatalog(),
  name: "Catalog",
  argTypes: {
    level: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};
