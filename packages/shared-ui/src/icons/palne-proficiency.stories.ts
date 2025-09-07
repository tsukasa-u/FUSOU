import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconPlaneProficiencyProps } from "./plane-proficiency";
import "./plane-proficiency";

import { ifDefined } from "lit/directives/if-defined.js";
import { html } from "lit";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const IconPlaneProficiencyBasic = (args: IconPlaneProficiencyProps) => {
  return html`<icon-plane-proficiency
    level=${args.level}
    size=${ifDefined(args.size)}
  ></icon-plane-proficiency>`;
};

const IconPlaneProficiencyCatalog = () => {
  const level_list = [1, 2, 3, 4, 5, 6, 7];
  return html`<div class="grid gap-4">
    ${level_list.map(
      (level) =>
        html` <div class="flex">
          <h1 class="w-20">${level}</h1>
          <icon-plane-proficiency
            level=${level}
            size=${"sm"}
          ></icon-plane-proficiency>
        </div>`,
    )}
  </div>`;
};

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
