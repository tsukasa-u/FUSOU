import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconCautionFillProps } from "../../icons/caution-fill";
import "../../icons/caution-fill";

import { ifDefined } from "lit/directives/if-defined.js";
import { html } from "lit";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];
const caution_level = ["low", "middle", "high"];

const IconCautionFillBasic = (args: IconCautionFillProps) => {
  return html`<icon-caution-fill
    level=${args.level}
    size=${ifDefined(args.size)}
  ></icon-caution-fill>`;
};

const IconCautionFillCatalog = () => {
  return html`<div class="grid gap-4">
    <div class="flex">
      <h1 class="w-20">high</h1>
      <icon-caution-fill level=${"high"} size=${"sm"}></icon-caution-fill>
    </div>
    <div class="flex">
      <h1 class="w-20">middle</h1>
      <icon-caution-fill level=${"middle"} size=${"sm"}></icon-caution-fill>
    </div>
    <div class="flex">
      <h1 class="w-20">low</h1>
      <icon-caution-fill level=${"low"} size=${"sm"}></icon-caution-fill>
    </div>
  </div>`;
};

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
          summary: caution_level.join("|"),
        },
      },
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
