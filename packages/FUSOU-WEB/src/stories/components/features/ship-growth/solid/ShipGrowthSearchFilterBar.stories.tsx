import { fn } from "storybook/test";
import { ShipGrowthSearchFilterBar } from "../../../../../components/features/ship-growth/solid/ShipGrowthSearchFilterBar";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/ship-growth/solid/ShipGrowthSearchFilterBar",
  component: ShipGrowthSearchFilterBar,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "searchQuery": () => (""),
    "onSearchChange": fn(),
    "activeFilterCount": 0,
    "onOpenFilterModal": fn()
  },
};
