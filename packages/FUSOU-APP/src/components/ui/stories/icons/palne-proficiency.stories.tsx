import { IconPlaneProficiencyProps } from "ui";
import { IconPlaneProficiency } from "ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";



const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const IconPlaneProficiencyBasic = (args: IconPlaneProficiencyProps) => {
  return (<IconPlaneProficiency
    level={args.level}
    size={args.size}
  ></IconPlaneProficiency>);
};

const IconPlaneProficiencyCatalog = () => {
  const level_list = [1, 2, 3, 4, 5, 6, 7];
  return (<div class="grid gap-4">
    {level_list.map(
      (level) =>
        ( <div class="flex">
          <h1 class="w-20">${level}</h1>
          <IconPlaneProficiency
            level={level}
            size={"sm"}
          ></IconPlaneProficiency>
        </div>)
    )}
  </div>
  );
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
          summary: size_list.join("|"),
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
