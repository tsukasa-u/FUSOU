import { fn } from "storybook/test";
import BattleTabs from "../../../../../components/features/battles/solid/BattleTabs";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battles/solid/BattleTabs",
  component: BattleTabs,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "activeTab": "list",
    "onTabChange": fn()
  },
};
