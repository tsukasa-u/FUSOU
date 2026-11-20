/** @jsxImportSource solid-js */
import { createSignal, onMount, Show } from "solid-js";
import { initializeStorybookSimulator } from "../../../../storybook-fixtures";
import { SimulatorTabManager } from "../../../../../components/features/simulator/solid/SimulatorTabManager";

function StorybookSimulatorTabManager(props: { initialTab: string }) {
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal("");

  onMount(() => {
    const workspace = props.initialTab === "workspace" ? "sample" : "empty";
    void initializeStorybookSimulator(
      "combined",
      workspace,
    ).then(
      () => setReady(true),
      (reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : String(reason),
        ),
    );
  });

  return (
    <Show
      when={ready()}
      fallback={
        error() ? (
          <div role="alert" class="alert alert-error">
            Simulator fixture failed to initialize: {error()}
          </div>
        ) : (
          <div role="status" class="loading loading-spinner loading-md">
            Loading simulator fixture...
          </div>
        )
      }
    >
      <SimulatorTabManager initialTab={props.initialTab} />
    </Show>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorTabManager",
  component: StorybookSimulatorTabManager,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "initialTab": "Storybook initialTab"
  },
};

export const Workspace = {
  args: {
    initialTab: "workspace",
  },
};

export const ShipDetails = {
  args: {
    initialTab: "ship",
  },
};

export const EquipmentDetails = {
  args: {
    initialTab: "equip",
  },
};
