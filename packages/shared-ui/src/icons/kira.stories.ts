import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconKiraProps } from "./kira";
import "./kira";

import { html } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const IconKiraBasic = (args: IconKiraProps) => {
  return html`<icon-kira
    kira_type=${args.kira_type}
    size=${ifDefined(args.size)}
  ></icon-kira>`;
};

const IconKiraCatalog = () => {
  return html`<div class="grid gap-4">
    <div class="flex">
      <h1 class="w-20">kira_type:1</h1>
      <icon-kira kira_type=${1} size=${"sm"}></icon-kira>
    </div>
    <div class="flex">
      <h1 class="w-20">kira_type:2</h1>
      <icon-kira kira_type=${2} size=${"sm"}></icon-kira>
    </div>
    <div class="flex">
      <h1 class="w-20">kira_type:3</h1>
      <icon-kira kira_type=${3} size=${"sm"}></icon-kira>
    </div>
  </div>`;
};

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
