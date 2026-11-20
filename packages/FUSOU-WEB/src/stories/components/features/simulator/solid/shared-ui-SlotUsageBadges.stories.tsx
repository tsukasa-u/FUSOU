import { SlotUsageBadges } from "../../../../../components/features/simulator/solid/shared-ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/shared-ui/SlotUsageBadges",
  component: SlotUsageBadges,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "placements": [
      {
        "normal": 2,
        "exslot": 1
      }
    ]
  },
};
