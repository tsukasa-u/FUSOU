import { createStorybookBattleViewArgs, createStorybookShipMap, createStorybookSlotItemMap } from "../../../../storybook-fixtures";
import BattleTimelineView from "../../../../../components/features/battle-detail/solid/BattleTimelineView";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/BattleTimelineView",
  component: BattleTimelineView,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "battle": createStorybookBattleViewArgs().battle,
    "mstSlotItemById": createStorybookSlotItemMap(),
    "fleets": createStorybookBattleViewArgs().fleets,
    "mstShipById": createStorybookShipMap(),
    "showPhaseSeparators": false
  },
};

export const AirOperations = {
  args: {
    ...createStorybookBattleViewArgs("air-operations"),
    showPhaseSeparators: true,
  },
};

export const NightBattle = {
  args: {
    ...createStorybookBattleViewArgs("night-battle"),
    showPhaseSeparators: true,
  },
};

export const AllPhases = {
  args: {
    ...createStorybookBattleViewArgs("all-phases"),
    showPhaseSeparators: true,
  },
};
