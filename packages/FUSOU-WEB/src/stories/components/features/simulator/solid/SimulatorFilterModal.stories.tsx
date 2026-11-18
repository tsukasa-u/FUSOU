import { previewStorybookDialogContents } from "../../../../storybook-fixtures";
import { fn } from "storybook/test";
import SimulatorFilterModal from "../../../../../components/features/simulator/solid/SimulatorFilterModal";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorFilterModal",
  component: SimulatorFilterModal,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "ref": previewStorybookDialogContents,
    "settings": () => ({"includeShips":true,"includeEquips":true,"includeWorkspaces":false,"selectedStypes":[]}),
    "onSettingsChange": fn(),
    "onReset": fn()
  },
};
