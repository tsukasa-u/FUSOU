import { createStorybookBattleViewArgs } from "../../../../storybook-fixtures";
import { ShipRows } from "../../../../../components/features/battle-detail/solid/ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/ui/ShipRows",
  component: ShipRows,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "ships": createStorybookBattleViewArgs().fleets.enemyShips,
    "sideLabel": "敵艦隊"
  },
};
