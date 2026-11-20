/** @jsxImportSource solid-js */
import { createSignal, onMount, Show } from "solid-js";
import { SimulatorFleetTab } from "../../../../../components/features/simulator/solid/SimulatorFleetTab";
import {
  initializeStorybookSimulator,
  type StorybookSimulatorVariant,
} from "../../../../storybook-fixtures";

function StorybookSimulatorFleet(props: { variant: StorybookSimulatorVariant }) {
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal("");

  onMount(() => {
    void initializeStorybookSimulator(props.variant).then(
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
      <SimulatorFleetTab />
    </Show>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorFleetTab",
  component: StorybookSimulatorFleet,
  argTypes: {
    variant: {
      control: "select",
      options: ["combined", "normal", "airbase", "strike"],
    },
  },
  tags: ["autodocs"],
};

export const CombinedFleet = {
  args: {},
};

export const NormalFleet = {
  args: { variant: "normal" },
};

export const AirbaseOperations = {
  args: { variant: "airbase" },
};

export const StrikeForce = {
  args: { variant: "strike" },
};
