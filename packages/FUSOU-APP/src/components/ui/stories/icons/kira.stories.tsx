import { IconKiraProps } from "ui";
import { IconKira } from "ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";



const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const IconKiraBasic = (args: IconKiraProps) => {
  return (<IconKira
    kira_type={args.kira_type}
    size={args.size}
  ></IconKira>);
};

const IconKiraCatalog = () => {
  return (<div class="grid gap-4">
    <div class="flex">
      <h1 class="w-20">kira_type:1</h1>
      <IconKira kira_type={1} size={"sm"}></IconKira>
    </div>
    <div class="flex">
      <h1 class="w-20">kira_type:2</h1>
      <IconKira kira_type={2} size={"sm"}></IconKira>
    </div>
    <div class="flex">
      <h1 class="w-20">kira_type:3</h1>
      <IconKira kira_type={3} size={"sm"}></IconKira>
    </div>
  </div>
  );
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
          summary: size_list.join("|"),
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
