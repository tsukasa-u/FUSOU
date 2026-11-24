import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { ComponentTimer } from "../../../components/timer";
import type { TimerDisplayMode } from "../../../../../utility/timer";
import {
  nextTimerDisplayMode,
  timerDisplayModeLabel,
} from "../../../../../utility/timer";

const FIXED_NOW_MS = new Date(2026, 10, 21, 13, 11, 15).getTime();

const meta: Meta = {
  title: "UI/Components/Timer",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj;

export const AllStatesAndModes: Story = {
  render: () => {
    const [mode, setMode] = createSignal<TimerDisplayMode>("both");
    const cycle = () => setMode((prev) => nextTimerDisplayMode(prev));

    return (
      <div class="flex flex-col gap-4 p-4 text-xs bg-base-100 text-base-content">
        <div class="flex items-center gap-2">
          <span class="text-base-content/60">Active Display Mode:</span>
          <button
            type="button"
            class="btn btn-xs btn-outline"
            onClick={cycle}
          >
            {timerDisplayModeLabel(mode())}
          </button>
          <span class="text-[11px] text-base-content/50">
            (Click any timer pill to cycle)
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="flex items-center gap-3">
            <span class="w-28 text-base-content/60">Running (1h 23m)</span>
            <ComponentTimer
              completeTimeMs={FIXED_NOW_MS + (1 * 3600 + 23 * 60 + 45) * 1000}
              nowMs={FIXED_NOW_MS}
              displayMode={mode()}
              onToggleDisplayMode={cycle}
            />
          </div>
          <div class="flex items-center gap-3">
            <span class="w-28 text-base-content/60">Soon (&lt;= 1m)</span>
            <ComponentTimer
              completeTimeMs={FIXED_NOW_MS + 42 * 1000}
              nowMs={FIXED_NOW_MS}
              displayMode={mode()}
              onToggleDisplayMode={cycle}
            />
          </div>
          <div class="flex items-center gap-3">
            <span class="w-28 text-base-content/60">Complete</span>
            <ComponentTimer
              completeTimeMs={FIXED_NOW_MS - 15 * 1000}
              nowMs={FIXED_NOW_MS}
              displayMode={mode()}
              onToggleDisplayMode={cycle}
            />
          </div>
          <div class="flex items-center gap-3">
            <span class="w-28 text-base-content/60">Recalled (Expedition)</span>
            <ComponentTimer
              completeTimeMs={FIXED_NOW_MS + 14 * 60 * 1000}
              nowMs={FIXED_NOW_MS}
              status="recalled"
              displayMode={mode()}
              onToggleDisplayMode={cycle}
            />
          </div>
          <div class="flex items-center gap-3">
            <span class="w-28 text-base-content/60">Next-Day Finish</span>
            <ComponentTimer
              completeTimeMs={FIXED_NOW_MS + 14 * 3600 * 1000}
              nowMs={FIXED_NOW_MS}
              displayMode={mode()}
              onToggleDisplayMode={cycle}
            />
          </div>
          <div class="flex items-center gap-3">
            <span class="w-28 text-base-content/60">Idle / Locked</span>
            <ComponentTimer
              completeTimeMs={null}
              nowMs={FIXED_NOW_MS}
              status="idle"
            />
          </div>
        </div>
      </div>
    );
  },
};
