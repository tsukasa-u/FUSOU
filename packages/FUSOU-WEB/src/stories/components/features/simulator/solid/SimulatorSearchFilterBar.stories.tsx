import { fn } from "storybook/test";
import { SimulatorSearchFilterBar } from "../../../../../components/features/simulator/solid/SimulatorSearchFilterBar";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorSearchFilterBar",
  component: SimulatorSearchFilterBar,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "settings": () => ({"includeShips":true,"includeEquips":true,"includeWorkspaces":false,"selectedStypes":[]}),
    "onOpenFilterModal": fn(),
    "onSelectShip": fn(),
    "onSelectEquip": fn(),
    "onSelectWorkspace": fn(),
    "searchQuery": () => (""),
    "activeFilterCount": 1
  },
};
