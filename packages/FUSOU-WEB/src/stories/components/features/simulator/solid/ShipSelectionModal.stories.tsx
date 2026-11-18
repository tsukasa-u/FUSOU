/** @jsxImportSource solid-js */
import { StorybookSimulatorModalPreview } from "../../../../storybook-fixtures";
import {
  setShipModalSideFilter,
  setShipModalSource,
  setShipModalTargetForFleet,
} from "../../../../../features/simulator/simulator-mutations";
import {
  setShipModalTrigger,
  ShipSelectionModal,
} from "../../../../../components/features/simulator/solid/ShipSelectionModal";

function prepareShipSelection(): void {
  setShipModalTargetForFleet(1, 0);
  setShipModalSideFilter("ally");
  setShipModalSource("snapshot");
  setShipModalTrigger(1);
}

function ShipSelectionModalPreview() {
  setShipModalTrigger(0);

  return (
    <StorybookSimulatorModalPreview
      dialogId="ship-select-modal"
      prepare={prepareShipSelection}
      includeInventorySnapshot
    >
      <ShipSelectionModal />
    </StorybookSimulatorModalPreview>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/ShipSelectionModal",
  component: ShipSelectionModal,
  tags: ["autodocs"],
};

export const Default = {
  render: () => <ShipSelectionModalPreview />,
};
