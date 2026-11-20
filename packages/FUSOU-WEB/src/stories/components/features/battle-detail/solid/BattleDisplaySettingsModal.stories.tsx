import { previewStorybookDialogContents } from "../../../../storybook-fixtures";
import { fn } from "storybook/test";
import BattleDisplaySettingsModal from "../../../../../components/features/battle-detail/solid/BattleDisplaySettingsModal";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/BattleDisplaySettingsModal",
  component: BattleDisplaySettingsModal,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "ref": previewStorybookDialogContents,
    "showPhaseSeparators": () => (true),
    "setShowPhaseSeparators": fn()
  },
};
