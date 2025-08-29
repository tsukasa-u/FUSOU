import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { ComponentColorBarLabelProps } from "./color-bar-label";
import "./color-bar-label";

import { html } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";

const size_list = ["xs", "sm", "md", "lg", "xl"];

const ComponentColorBarLabelBasic = (args: ComponentColorBarLabelProps) => {
  return html`<component-color-bar-label
    v_now=${args.v_now}
    v_max=${args.v_max}
    size=${ifDefined(args.size)}
    quantize=${ifDefined(args.quantize)}
  ></component-color-bar-label>`;
};

const ComponentColorBarLabelCatalog = () => {
  const value_map = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  return html`<div class="grid gap-4">
    ${value_map.map(
      (v_now) =>
        html`<div class="grid">
          <div class="flex">
            <div class="w-30">${v_now}%</div>
            <component-color-bar-label
              class="w-full"
              v_now=${v_now}
              v_max=${100}
              size=${"xs"}
            ></component-color-bar-label>
          </div>
          <div class="flex">
            <div class="w-30">5-quantized</div>
            <component-color-bar-label
              class="w-full"
              v_now=${v_now}
              v_max=${100}
              size=${"xs"}
              quantize=${5}
            ></component-color-bar-label>
          </div>
        </div>`,
    )}
  </div>`;
};

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
