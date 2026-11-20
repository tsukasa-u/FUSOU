import { createStorybookDashboardState } from "../../../../storybook-fixtures";
import BattleDropsPanel from "../../../../../components/features/drops/solid/BattleDropsPanel";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/drops/solid/BattleDropsPanel",
  component: BattleDropsPanel,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "dashboardState": createStorybookDashboardState()
  },
};
