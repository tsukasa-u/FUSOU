import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconPlaneProficiencyProps } from "./plane-proficiency";
import {
  IconPlaneProficiencyBasic,
  IconPlaneProficiencyCatalog,
} from "./plane-proficiency";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const meta = {
  title: "FUSOU/icons/icon-plane-proficiency",
  tags: ["autodocs"],
} satisfies Meta<IconPlaneProficiencyProps>;

export default meta;
type Story = StoryObj<IconPlaneProficiencyProps>;

export const basic: Story = {
  render: (args: IconPlaneProficiencyProps) => IconPlaneProficiencyBasic(args),
  name: "Basic",
  argTypes: {
    level: {
      control: { type: "select" },
      options: [1, 2, 3, 4, 5, 6, 7],
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
    level: 1,
    size: "full",
  },
};

export const catalog: Story = {
  render: () => IconPlaneProficiencyCatalog(),
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
