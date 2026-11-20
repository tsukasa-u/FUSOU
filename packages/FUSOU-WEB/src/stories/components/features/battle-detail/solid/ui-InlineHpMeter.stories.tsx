import { InlineHpMeter } from "../../../../../components/features/battle-detail/solid/ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/ui/InlineHpMeter",
  component: InlineHpMeter,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "current": 1,
    "max": 1
  },
};
