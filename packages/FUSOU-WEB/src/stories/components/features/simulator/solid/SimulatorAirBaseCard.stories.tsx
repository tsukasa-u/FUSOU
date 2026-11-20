/** @jsxImportSource solid-js */
import { createSignal, onMount, Show } from "solid-js";
import { SimulatorAirBaseCard } from "../../../../../components/features/simulator/solid/SimulatorAirBaseCard";
import { initializeStorybookSimulator } from "../../../../storybook-fixtures";

function StorybookAirBaseCard(props: { index: number }) {
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal("");

  onMount(() => {
    void initializeStorybookSimulator("airbase", "sample").then(
      () => setReady(true),
      (reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
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
      <div class="w-full max-w-md">
        <SimulatorAirBaseCard index={props.index} />
      </div>
    </Show>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorAirBaseCard",
  component: StorybookAirBaseCard,
  argTypes: {
    index: {
      control: "select",
      options: [0, 1, 2],
    },
  },
  tags: ["autodocs"],
};

export const FirstBase = {
  args: { index: 0 },
};

export const SecondBase = {
  args: { index: 1 },
};

export const ThirdBase = {
  args: { index: 2 },
};
