import { createStorybookDashboardState } from "../../../../storybook-fixtures";
import BattleStatsPanel from "../../../../../components/features/stats/solid/BattleStatsPanel";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/stats/solid/BattleStatsPanel",
  component: BattleStatsPanel,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "dashboardState": createStorybookDashboardState()
  },
};
