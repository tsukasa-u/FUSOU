import { previewStorybookDialogContents } from "../../../../storybook-fixtures";
import { fn } from "storybook/test";
import ShipGrowthFilterModal from "../../../../../components/features/ship-growth/solid/ShipGrowthFilterModal";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/ship-growth/solid/ShipGrowthFilterModal",
  component: ShipGrowthFilterModal,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "ref": previewStorybookDialogContents,
    "periods": () => ([{"period_tag":"2026-02-13","table_version":"0.7.0"},{"period_tag":"2026-01-15","table_version":"0.6.1"}]),
    "selectedPeriodIndex": () => (0),
    "loadingPeriods": () => (false),
    "onPeriodChange": fn(),
    "selectedStypes": () => ([]),
    "onStypesChange": fn(),
    "onReset": fn()
  },
};
