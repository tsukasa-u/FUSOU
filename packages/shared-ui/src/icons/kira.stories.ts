import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconKiraProps } from "./kira";
import { IconKiraBasic, IconKiraCatalog } from "./kira";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const meta = {
  title: "FUSOU/icons/icon-kira",
  tags: ["autodocs"],
} satisfies Meta<IconKiraProps>;

export default meta;
type Story = StoryObj<IconKiraProps>;

export const basic: Story = {
  render: (args: IconKiraProps) => IconKiraBasic(args),
  name: "Basic",
  argTypes: {
    kira_type: {
      control: { type: "select" },
      options: [1, 2, 3],
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
    kira_type: 1,
    size: "full",
  },
};

export const catalog: Story = {
  render: () => IconKiraCatalog(),
  name: "Catalog",
  argTypes: {
    kira_type: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};
