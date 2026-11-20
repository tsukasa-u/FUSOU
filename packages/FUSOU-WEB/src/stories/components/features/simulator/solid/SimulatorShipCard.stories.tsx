/** @jsxImportSource solid-js */
import { createSignal, onMount, Show } from "solid-js";
import { SimulatorShipCard } from "../../../../../components/features/simulator/solid/SimulatorShipCard";
import {
  initializeStorybookSimulator,
} from "../../../../storybook-fixtures";

type StorybookShipCardProps = {
  fleetIndex: 1 | 2 | 3 | 4;
  idx: number;
};

function StorybookShipCard(props: StorybookShipCardProps) {
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal("");

  onMount(() => {
    void initializeStorybookSimulator("normal", "sample").then(
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
      <SimulatorShipCard fleetIndex={props.fleetIndex} idx={props.idx} />
    </Show>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorShipCard",
  component: StorybookShipCard,
  argTypes: {
    fleetIndex: {
      control: "select",
      options: [1, 2, 3, 4],
    },
    idx: {
      control: { type: "range", min: 0, max: 5, step: 1 },
    },
  },
  tags: ["autodocs"],
};

export const Akagi = {
  args: { fleetIndex: 1, idx: 0 },
};

export const Kongou = {
  args: { fleetIndex: 1, idx: 1 },
};

export const Yudachi = {
  args: { fleetIndex: 1, idx: 2 },
};
