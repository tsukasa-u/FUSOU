import { fn } from "storybook/test";
import { BattleSearchFilterBar } from "../../../../../components/features/battles/solid/BattleSearchFilterBar";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battles/solid/BattleSearchFilterBar",
  component: BattleSearchFilterBar,
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
