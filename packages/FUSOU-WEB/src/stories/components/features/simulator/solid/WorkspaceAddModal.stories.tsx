/** @jsxImportSource solid-js */
import { StorybookSimulatorModalPreview } from "../../../../storybook-fixtures";
import {
  WorkspaceAddModal,
  workspaceEditTarget,
  workspaceModalMode,
} from "../../../../../components/features/simulator/solid/WorkspaceAddModal";

const [, setWorkspaceTarget] = workspaceEditTarget;
const [, setWorkspaceMode] = workspaceModalMode;

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/WorkspaceAddModal",
  component: WorkspaceAddModal,
  tags: ["autodocs"],
};

export const Default = {
  render: () => (
    <StorybookSimulatorModalPreview
      dialogId="workspace-add-modal"
      prepare={() => {
        setWorkspaceTarget(null);
        setWorkspaceMode("saveCurrent");
      }}
    >
      <WorkspaceAddModal />
    </StorybookSimulatorModalPreview>
  ),
};

export const AddSharedDeck = {
  render: () => (
    <StorybookSimulatorModalPreview
      dialogId="workspace-add-modal"
      prepare={() => {
        setWorkspaceTarget(null);
        setWorkspaceMode("addUrl");
      }}
    >
      <WorkspaceAddModal />
    </StorybookSimulatorModalPreview>
  ),
};
