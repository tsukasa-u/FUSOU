/** @jsxImportSource solid-js */
import { createSignal, Show } from "solid-js";
import { SimulatorEmptyShipSlot } from "../../../../../components/features/simulator/solid/SimulatorEmptyShipSlot";

function StorybookEmptyShipSlot(props: {
  fleetIndex: 1 | 2 | 3 | 4;
  idx: number;
}) {
  const [selected, setSelected] = createSignal(false);

  return (
    <div class="w-full max-w-md">
      <SimulatorEmptyShipSlot
        fleetIndex={props.fleetIndex}
        idx={props.idx}
        onSelect={() => setSelected(true)}
      />
      <Show when={selected()}>
        <p role="status" class="mt-2 text-sm text-base-content/60">
          艦の選択操作が呼び出されました。
        </p>
      </Show>
    </div>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorEmptyShipSlot",
  component: StorybookEmptyShipSlot,
  argTypes: {
    fleetIndex: {
      control: "select",
      options: [1, 2, 3, 4],
    },
    idx: {
      control: { type: "range", min: 0, max: 6, step: 1 },
    },
  },
  tags: ["autodocs"],
};

export const FirstFleetSlot = {
  args: { fleetIndex: 1, idx: 0 },
};

export const SeventhFleetSlot = {
  args: { fleetIndex: 3, idx: 6 },
};
