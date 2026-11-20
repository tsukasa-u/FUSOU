/** @jsxImportSource solid-js */
import { StorybookSimulatorModalPreview } from "../../../../storybook-fixtures";
import {
  DataImportModal,
} from "../../../../../components/features/simulator/solid/DataImportModal";

function DataImportModalPreview(props: { authenticated: boolean }) {
  return (
    <StorybookSimulatorModalPreview
      dialogId="data-import-modal"
      prepare={() => {
        window.__fusouIsAuthenticated = props.authenticated;
      }}
    >
      <DataImportModal />
    </StorybookSimulatorModalPreview>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/DataImportModal",
  component: DataImportModal,
  tags: ["autodocs"],
};

export const Default = {
  render: () => <DataImportModalPreview authenticated={true} />,
};

export const AuthenticationRequired = {
  render: () => <DataImportModalPreview authenticated={false} />,
};
