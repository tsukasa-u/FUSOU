import { previewStorybookDialogContents } from "../../../../storybook-fixtures";
import { fn } from "storybook/test";
import BattleFilterSettingsModal from "../../../../../components/features/battles/solid/BattleFilterSettingsModal";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battles/solid/BattleFilterSettingsModal",
  component: BattleFilterSettingsModal,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "ref": previewStorybookDialogContents,
    "periods": () => ([{"period_tag":"2026-02-13","table_version":"0.7.0"},{"period_tag":"2026-01-15","table_version":"0.6.1"}]),
    "selectedPeriodIndex": () => (0),
    "loadingPeriods": () => (false),
    "loading": () => (false),
    "onPeriodChange": fn(),
    "mapOptions": () => (["1-1"]),
    "mapFilter": () => ("1-1"),
    "onMapFilterChange": fn(),
    "resultFilter": () => ("S"),
    "onResultFilterChange": fn(),
    "showMapFilter": true,
    "showResultFilter": true
  },
};
