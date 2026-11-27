import { createStorybookBattleViewArgs } from "../../../../storybook-fixtures";
import BattlePhaseView from "../../../../../components/features/battle-detail/solid/BattlePhaseView";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/BattlePhaseView",
  component: BattlePhaseView,
  tags: ["autodocs"],
};

export const Default = {
  args: createStorybookBattleViewArgs("route"),
};

export const AirOperations = {
  args: createStorybookBattleViewArgs("air-operations"),
};

export const NightBattle = {
  args: createStorybookBattleViewArgs("night-battle"),
};

export const AllPhases = {
  args: createStorybookBattleViewArgs("all-phases"),
};
