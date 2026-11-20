import { ShipIndexBadge } from "../../../../../components/features/battle-detail/solid/ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/ui/ShipIndexBadge",
  component: ShipIndexBadge,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "idx": 1,
    "side": "friend"
  },
};
