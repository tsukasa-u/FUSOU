/** @jsxImportSource solid-js */
import { StorybookSimulatorModalPreview } from "../../../../storybook-fixtures";
import {
  DisplaySettingsModal,
} from "../../../../../components/features/simulator/solid/SimulatorModals";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorModals/DisplaySettingsModal",
  component: DisplaySettingsModal,
  tags: ["autodocs"],
};

export const Default = {
  render: () => (
    <StorybookSimulatorModalPreview dialogId="display-settings-modal">
      <DisplaySettingsModal />
    </StorybookSimulatorModalPreview>
  ),
};
