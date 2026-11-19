/** @jsxImportSource solid-js */
import { createEffect, createSignal } from "solid-js";
import {
  SimulatorBulkStatControl,
  SIMULATOR_NON_EDITABLE_STAT_KEYS,
  type SimulatorStatDef,
} from "../../../../../components/features/simulator/solid/SimulatorBulkStatControl";

type StoryStatKey = "firepower" | "luck" | "speed" | "range";

const STORYBOOK_STATS: Record<StoryStatKey, SimulatorStatDef> = {
  firepower: ["火力", "houg", 63, 89, true],
  luck: ["運", "luck", 12, 49, true],
  speed: ["速力", "soku", 10, 10, false],
  range: ["射程", "leng", 3, 3, false],
};

function StorybookBulkStatControl(props: {
  statKey: StoryStatKey;
  initialValue: number;
  overrideEnabled: boolean;
}) {
  const st = () => STORYBOOK_STATS[props.statKey];
  const [current, setCurrent] = createSignal(props.initialValue);
  createEffect(() => {
    props.statKey;
    setCurrent(props.initialValue);
  });
  const getBounds = () => {
    const stat = st();
    const key = stat[1];
    const base = stat[2] ?? stat[5] ?? 0;
    const lo = ["tais", "kaih", "saku"].includes(key) ? 0 : base;
    if (props.overrideEnabled) return { lo, hi: Infinity };
    const normalHi = stat[3] ?? stat[5] ?? base;
    return {
      lo,
      hi: key === "tais" ? Math.max(normalHi, base + 9) : normalHi,
    };
  };
  const bump = (sign: 1 | -1) => {
    const stat = st();
    const key = stat[1];
    if (
      SIMULATOR_NON_EDITABLE_STAT_KEYS.has(key) &&
      !props.overrideEnabled
    ) {
      return;
    }
    const { lo, hi } = getBounds();
    const step = key === "soku" ? 5 : 1;
    const next = current() + step * sign;
    setCurrent(hi === Infinity ? next : Math.max(lo, Math.min(hi, next)));
  };

  return (
    <div class="w-56">
      <SimulatorBulkStatControl
        st={st()}
        current={current}
        getBounds={getBounds}
        overrideEnabled={() => props.overrideEnabled}
        onValueChange={setCurrent}
        onBump={bump}
      />
    </div>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorBulkStatControl",
  component: StorybookBulkStatControl,
  argTypes: {
    statKey: {
      control: "select",
      options: Object.keys(STORYBOOK_STATS),
    },
    initialValue: { control: "number" },
    overrideEnabled: { control: "boolean" },
  },
  tags: ["autodocs"],
};

export const Firepower = {
  args: { statKey: "firepower", initialValue: 63, overrideEnabled: false },
};

export const LockedSpeed = {
  args: { statKey: "speed", initialValue: 10, overrideEnabled: false },
};

export const OverrideSpeed = {
  args: { statKey: "speed", initialValue: 10, overrideEnabled: true },
};

export const Range = {
  args: { statKey: "range", initialValue: 3, overrideEnabled: true },
};
