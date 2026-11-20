/** @jsxImportSource solid-js */
import { createMemo, type JSX } from "solid-js";
import { RANGE_NAMES, SPEED_NAMES } from "@/features/simulator/constants";

export type SimulatorStatDef = [
  label: string,
  key: string,
  base: number | null,
  max: number | null,
  isNumeric: boolean,
  fallbackBase?: number | null,
];

export const SIMULATOR_NON_EDITABLE_STAT_KEYS = new Set([
  "maxeq",
  "soku",
  "leng",
]);

export function SimulatorBulkStatControl(props: {
  st: SimulatorStatDef;
  current: () => number;
  getBounds: () => { lo: number; hi: number };
  overrideEnabled: () => boolean;
  onValueChange: (value: number) => void;
  onBump: (sign: 1 | -1) => void;
}): JSX.Element {
  const st = props.st;
  const key = st[1];
  const isNonEditable = SIMULATOR_NON_EDITABLE_STAT_KEYS.has(key);
  const isSpeedStat = key === "soku";
  const isRangeStat = key === "leng";
  const isLabeledStat = isSpeedStat || isRangeStat;
  const bounds = createMemo(() => props.getBounds());
  const minVal = () => bounds().lo;
  const maxVal = () => bounds().hi;
  const isDisabled = () => isNonEditable && !props.overrideEnabled();
  const current = () => props.current();
  const pct = () => {
    const hi = maxVal();
    const lo = minVal();
    const cur = current();
    return hi <= lo || hi === Infinity
      ? 0
      : Math.max(0, Math.min(100, ((cur - lo) / (hi - lo)) * 100));
  };
  const labelMap = isSpeedStat ? SPEED_NAMES : RANGE_NAMES;
  const selectOptions = Object.entries(labelMap)
    .map(([value, label]) => [Number(value), label] as const)
    .sort((a, b) => a[0] - b[0]);

  return (
    <div
      class={`rounded-md border px-2 py-1.5 text-xs ${isDisabled() ? "border-base-200/30 bg-base-200/20 opacity-60" : "border-base-200/70 bg-base-100"}`}
    >
      {isLabeledStat ? (
        <>
          <div class="grid grid-cols-[1.75rem_1fr] items-center gap-2">
            <span class="font-medium text-base-content/70 whitespace-nowrap">
              {st[0]}
            </span>
            <div class="justify-self-end flex items-center justify-end leading-6">
              <div class="w-30 flex items-center justify-end">
                <select
                  class="select select-xs select-bordered h-6 py-0 px-2 w-24 text-xs"
                  value={String(current())}
                  disabled={isDisabled()}
                  onInput={(event) => {
                    if (isDisabled()) return;
                    const next = Number(
                      (event.currentTarget as HTMLSelectElement).value,
                    );
                    if (!Number.isFinite(next)) return;
                    props.onValueChange(next);
                  }}
                >
                  {selectOptions.map(([value, label]) => (
                    <option value={String(value)}>{label}</option>
                  ))}
                  {!selectOptions.some(
                    ([value]) => value === current(),
                  ) && (
                    <option value={String(current())}>
                      {labelMap[current()] ?? "不明"}
                    </option>
                  )}
                </select>
              </div>
            </div>
          </div>
          {isDisabled() && (
            <div class="mt-0.5 text-right text-[9px] text-base-content/40">
              編集不可
            </div>
          )}
        </>
      ) : (
        <div>
          <div class="grid grid-cols-[1.75rem_1fr] items-center gap-2">
            <span class="font-medium text-base-content/70 whitespace-nowrap">
              {st[0]}
            </span>
            <div class="justify-self-end flex items-center justify-end gap-1">
              <div class="w-30 flex items-center justify-end gap-1">
                <button
                  class="btn btn-ghost btn-xs h-5 min-h-0 px-1"
                  onClick={() => props.onBump(-1)}
                  disabled={isDisabled()}
                >
                  -
                </button>
                <input
                  type="number"
                  min={String(minVal())}
                  value={String(current())}
                  class="input input-xs input-bordered w-14 text-center font-mono text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  disabled={isDisabled()}
                  onInput={(event) => {
                    if (isDisabled()) return;
                    const next = Number(
                      (event.currentTarget as HTMLInputElement).value,
                    );
                    if (!Number.isFinite(next)) return;
                    if (props.overrideEnabled()) {
                      props.onValueChange(next);
                    } else {
                      props.onValueChange(
                        Math.max(minVal(), Math.min(maxVal(), next)),
                      );
                    }
                  }}
                />
                <button
                  class="btn btn-ghost btn-xs h-5 min-h-0 px-1"
                  onClick={() => props.onBump(1)}
                  disabled={isDisabled()}
                >
                  +
                </button>
              </div>
            </div>
          </div>
          {isDisabled() && (
            <div class="mt-0.5 text-right text-[9px] text-base-content/40">
              編集不可
            </div>
          )}
        </div>
      )}
      {!isLabeledStat && (
        <div class="mt-1">
          {!isDisabled() ? (
            <>
              <input
                type="range"
                min={String(minVal())}
                max={String(
                  maxVal() === Infinity ? minVal() + 1000 : maxVal(),
                )}
                value={String(
                  Math.min(
                    current(),
                    maxVal() === Infinity ? minVal() + 1000 : maxVal(),
                  ),
                )}
                class="w-full h-1 align-middle cursor-pointer appearance-none rounded-none bg-base-300 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-0 [&::-webkit-slider-thumb]:h-0 [&::-moz-range-thumb]:w-0 [&::-moz-range-thumb]:h-0 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent"
                style={{
                  background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${pct()}%, var(--color-base-300) ${pct()}%, var(--color-base-300) 100%)`,
                }}
                onInput={(event) => {
                  const next = Number(
                    (event.currentTarget as HTMLInputElement).value,
                  );
                  props.onValueChange(next);
                }}
              />
              <div class="mt-0.5 flex items-center justify-between text-[9px] text-base-content/40 font-mono">
                <span>min {minVal()}</span>
                <span>
                  {maxVal() === Infinity
                    ? "max 制限外"
                    : key === "tais"
                      ? `max ${maxVal()}(+9)`
                      : `max ${maxVal()}`}
                </span>
              </div>
            </>
          ) : (
            <div class="text-[9px] text-base-content/40 font-mono">
              編集不可
            </div>
          )}
        </div>
      )}
    </div>
  );
}
