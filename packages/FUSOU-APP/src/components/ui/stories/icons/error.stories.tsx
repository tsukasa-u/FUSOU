import { IconErrorProps } from "ui";
import { IconError } from "ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";


import { ifDefined } from "lit-html/directives/if-defined.js";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const IconErrorBasic = (args: IconErrorProps) => {
  return (<IconError
    size={args.size}
    ratio={args.ratio}
  ></IconError>);
};

const meta = {
  title: "FUSOU/icons/icon-error",
  tags: ["autodocs"],
} satisfies Meta<IconErrorProps>;

export default meta;
type Story = StoryObj<IconErrorProps>;

export const basic: Story = {
  render: (args: IconErrorProps) => IconErrorBasic(args),
  name: "Basic",
  argTypes: {
    ratio: {
      control: "select",
      options: [1.0, 1.5],
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
  args: {},
};
