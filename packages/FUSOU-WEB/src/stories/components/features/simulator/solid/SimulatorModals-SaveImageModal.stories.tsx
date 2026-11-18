/** @jsxImportSource solid-js */
import { StorybookSimulatorModalPreview } from "../../../../storybook-fixtures";
import {
  SaveImageModal,
} from "../../../../../components/features/simulator/solid/SimulatorModals";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorModals/SaveImageModal",
  component: SaveImageModal,
  tags: ["autodocs"],
};

export const Default = {
  render: () => (
    <StorybookSimulatorModalPreview dialogId="save-image-modal">
      <SaveImageModal />
    </StorybookSimulatorModalPreview>
  ),
};
