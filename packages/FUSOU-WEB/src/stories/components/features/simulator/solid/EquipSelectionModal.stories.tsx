/** @jsxImportSource solid-js */
import { StorybookSimulatorModalPreview } from "../../../../storybook-fixtures";
import {
  setEquipModalSideFilter,
  setEquipModalSource,
  setEquipModalTargetForFleet,
} from "../../../../../features/simulator/simulator-mutations";
import {
  EquipSelectionModal,
  setEquipModalTrigger,
} from "../../../../../components/features/simulator/solid/EquipSelectionModal";

function prepareEquipSelection(): void {
  setEquipModalTargetForFleet(1, 0, 0);
  setEquipModalSideFilter("ally");
  setEquipModalSource("snapshot");
  setEquipModalTrigger(1);
}

function EquipSelectionModalPreview() {
  setEquipModalTrigger(0);

  return (
    <StorybookSimulatorModalPreview
      dialogId="equip-select-modal"
      prepare={prepareEquipSelection}
      includeInventorySnapshot
    >
      <EquipSelectionModal />
    </StorybookSimulatorModalPreview>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/EquipSelectionModal",
  component: EquipSelectionModal,
  tags: ["autodocs"],
};

export const Default = {
  render: () => <EquipSelectionModalPreview />,
};
