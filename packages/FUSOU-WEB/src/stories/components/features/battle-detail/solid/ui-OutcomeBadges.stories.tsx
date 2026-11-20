import { OutcomeBadges } from "../../../../../components/features/battle-detail/solid/ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/ui/OutcomeBadges",
  component: OutcomeBadges,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "damage": 1,
    "crit": false,
    "protect": false,
    "sunk": false,
    "afterState": "Storybook afterState"
  },
};
