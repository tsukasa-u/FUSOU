import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconFleetNumberProps } from "./fleet-number";
import "./fleet-number";

import { html } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const IconFleetNumberBasic = (args: IconFleetNumberProps) => {
  return html`<icon-fleet-number
    e_flag=${args.e_flag}
    ?combined_flag=${args.combined_flag}
    ship_number=${args.ship_number}
    fleet_number=${args.fleet_number}
    size=${ifDefined(args.size)}
  ></icon-fleet-number>`;
};

const IconFleetNumberCatalog = () => {
  return html`<div class="grid grid-cols-5 w-100 gap-4">
    ${html`<div class="grid gap-4">
      ${[1, 2, 3, 4, 5, 6].map(
        (ship_number) => html`
          <icon-fleet-number
            e_flag=${0}
            ?combined_flag=${false}
            ship_number=${ship_number}
            fleet_number=${1}
            size="xs"
          ></icon-fleet-number>
        `
      )}
      ${[7, 8, 9, 10, 11, 12].map((_) => html`<div class=${"h-6"}></div>`)}
    </div> `}
    ${html`<div class="grid gap-4">
      ${[1, 2, 3, 4, 5, 6].map(
        (ship_number) => html`
          <icon-fleet-number
            e_flag=${1}
            ?combined_flag=${false}
            ship_number=${ship_number}
            fleet_number=${1}
            size="xs"
          ></icon-fleet-number>
        `
      )}
      ${[7, 8, 9, 10, 11, 12].map((_) => html`<div class=${"h-6"}></div>`)}
    </div> `}
    ${html`<div class="grid gap-4">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(
        (ship_number) => html`
          <icon-fleet-number
            e_flag=${0}
            ?combined_flag=${true}
            ship_number=${ship_number}
            fleet_number=${1}
            size="xs"
          ></icon-fleet-number>
        `
      )}
    </div> `}
    ${html`<div class="grid gap-4">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(
        (ship_number) => html`
          <icon-fleet-number
            e_flag=${1}
            ?combined_flag=${true}
            ship_number=${ship_number}
            fleet_number=${1}
            size="xs"
          ></icon-fleet-number>
        `
      )}
    </div> `}
    ${html`<div class="grid gap-4">
      ${[1, 2, 3, 4, 5, 6, 7].map(
        (ship_number) => html`
          <icon-fleet-number
            e_flag=${0}
            ?combined_flag=${false}
            ship_number=${ship_number}
            fleet_number=${1}
            size="xs"
          ></icon-fleet-number>
        `
      )}
      ${[8, 9, 10, 11, 12].map((_) => html`<div class=${"h-6"}></div>`)}
    </div> `}
  </div>`;
};

const meta = {
  title: "FUSOU/icons/icon-fleet-number",
  tags: ["autodocs"],
} satisfies Meta<IconFleetNumberProps>;

export default meta;
type Story = StoryObj<IconFleetNumberProps>;

export const basic: Story = {
  render: (args: IconFleetNumberProps) => IconFleetNumberBasic(args),
  name: "Basic",
  argTypes: {
    combined_flag: {
      control: { type: "select" },
      options: [true, false, undefined],
    },
    ship_number: {
      control: { type: "select" },
      options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    },
    fleet_number: {
      control: { type: "select" },
      options: [1, 2, 3, 4],
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
    size: "full",
    combined_flag: undefined,
    fleet_number: 1,
    ship_number: 1,
  },
};

export const catalog: Story = {
  render: () => IconFleetNumberCatalog(),
  name: "Catalog",
  argTypes: {
    combined_flag: {
      control: { disable: true },
    },
    fleet_number: {
      control: { disable: true },
    },
    ship_number: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};
