/** @jsxImportSource solid-js */
import { StorybookSimulatorModalPreview } from "../../../../storybook-fixtures";
import {
  ShareSettingsModal,
} from "../../../../../components/features/simulator/solid/ShareSettingsModal";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/ShareSettingsModal",
  component: ShareSettingsModal,
  tags: ["autodocs"],
};

export const Default = {
  render: () => (
    <StorybookSimulatorModalPreview
      dialogId="share-settings-modal"
      includeInventorySnapshot
    >
      <ShareSettingsModal />
    </StorybookSimulatorModalPreview>
  ),
};
