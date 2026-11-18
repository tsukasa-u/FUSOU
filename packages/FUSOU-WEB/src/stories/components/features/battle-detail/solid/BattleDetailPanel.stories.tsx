import { createStorybookBattleRepository, STORYBOOK_SAMPLE_PERIOD, STORYBOOK_SAMPLE_SORTIE_ID } from "../../../../storybook-fixtures";
import BattleDetailPanel from "../../../../../components/features/battle-detail/solid/BattleDetailPanel";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/BattleDetailPanel",
  component: BattleDetailPanel,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "battleId": STORYBOOK_SAMPLE_SORTIE_ID,
    "battleIndex": 0,
    "periods": [
      STORYBOOK_SAMPLE_PERIOD
    ],
    "repository": createStorybookBattleRepository()
  },
};
