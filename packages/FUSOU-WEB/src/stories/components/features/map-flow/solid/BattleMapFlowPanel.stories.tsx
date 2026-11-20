import { createStorybookDashboardState } from "../../../../storybook-fixtures";
import BattleMapFlowPanel from "../../../../../components/features/map-flow/solid/BattleMapFlowPanel";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/map-flow/solid/BattleMapFlowPanel",
  component: BattleMapFlowPanel,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "dashboardState": createStorybookDashboardState()
  },
};
