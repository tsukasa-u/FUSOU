import { StatPill } from "../../../../components/common/solid/StatPill";

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/StatPill",
  component: StatPill,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "label": "Storybook label",
    "value": 1,
    "tone": "fire"
  },
};
