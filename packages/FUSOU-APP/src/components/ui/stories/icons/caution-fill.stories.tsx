import { IconCautionFillProps } from "ui";
import { IconCautionFill } from "ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";



const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];
const caution_level = ["low", "middle", "high"];

const IconCautionFillBasic = (args: IconCautionFillProps) => {
  return (<IconCautionFill
    level={args.level}
    size={args.size}
  ></IconCautionFill>);
};

const IconCautionFillCatalog = () => {
  return (<div class="grid gap-4">
    <div class="flex">
      <h1 class="w-20">high</h1>
      <IconCautionFill level={"high"} size={"sm"}></IconCautionFill>
    </div>
    <div class="flex">
      <h1 class="w-20">middle</h1>
      <IconCautionFill level={"middle"} size={"sm"}></IconCautionFill>
    </div>
    <div class="flex">
      <h1 class="w-20">low</h1>
      <IconCautionFill level={"low"} size={"sm"}></IconCautionFill>
    </div>
  </div>
  );
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
