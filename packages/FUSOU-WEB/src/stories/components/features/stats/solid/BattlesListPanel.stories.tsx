import { createStorybookDashboardState } from "../../../../storybook-fixtures";
import BattlesListPanel from "../../../../../components/features/stats/solid/BattlesListPanel";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/stats/solid/BattlesListPanel",
  component: BattlesListPanel,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "dashboardState": createStorybookDashboardState()
  },
};
