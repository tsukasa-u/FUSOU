/** @jsxImportSource solid-js */
import { StorybookSimulatorModalPreview } from "../../../../storybook-fixtures";
import {
  LoadFleetModal,
} from "../../../../../components/features/simulator/solid/LoadFleetModal";

function LoadFleetModalPreview(props: { authenticated: boolean }) {
  return (
    <StorybookSimulatorModalPreview
      dialogId="load-fleet-modal"
      prepare={() => {
        window.__fusouIsAuthenticated = props.authenticated;
      }}
    >
      <LoadFleetModal />
    </StorybookSimulatorModalPreview>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/LoadFleetModal",
  component: LoadFleetModal,
  tags: ["autodocs"],
};

export const Default = {
  render: () => <LoadFleetModalPreview authenticated={true} />,
};

export const AuthenticationRequired = {
  render: () => <LoadFleetModalPreview authenticated={false} />,
};
