import { createStorybookBattleViewArgs } from "../../../../storybook-fixtures";
import { FleetSummary } from "../../../../../components/features/battle-detail/solid/ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/ui/FleetSummary",
  component: FleetSummary,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "ships": createStorybookBattleViewArgs().fleets.friendlyShips,
    "sideLabel": "自艦隊"
  },
};
