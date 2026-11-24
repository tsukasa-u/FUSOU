import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import type { TimerDisplayMode, TimerStatus } from "../../../../utility/timer";
import {
  formatCompleteDateTimeFull,
  formatCompleteTime,
  formatRemainingTime,
  resolveTimerStatus,
  useSharedNow,
} from "../../../../utility/timer";
import { EmptyValue } from "../empty";

export type TimerSize = "2xs" | "xs" | "sm" | "md";

const sizeClasses: Record<TimerSize, string> = {
  "2xs": "h-[18px] text-[11px] px-1.5 gap-1",
  xs: "h-6 text-xs px-1.5 gap-1",
  sm: "h-[27px] text-xs px-2 gap-1.5",
  md: "h-[30px] text-sm px-2.5 gap-1.5",
};

const defaultWidthClasses: Record<TimerSize, string> = {
  "2xs": "w-[172px]",
  xs: "w-[184px]",
  sm: "w-[196px]",
  md: "w-[216px]",
};

const iconSizeClasses: Record<TimerSize, string> = {
  "2xs": "w-2.5 h-2.5",
  xs: "w-3 h-3",
  sm: "w-3.5 h-3.5",
  md: "w-4 h-4",
};

const statusClasses: Record<TimerStatus, string> = {
  running: "border-base-300 bg-base-200/40 text-base-content",
  soon: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500",
  complete: "border-green-500/40 bg-green-500/10 text-green-500",
  recalled: "border-orange-500/40 bg-orange-500/10 text-orange-500",
  idle: "border-base-300/60 bg-transparent text-base-content/40",
  locked: "border-base-300/60 bg-base-200/30 text-base-content/40",
};

export interface ComponentTimerProps {
  /** Unix epoch completion timestamp in milliseconds. */
  completeTimeMs?: number | null;
  /** Display format: remaining countdown, OS local completion time, or both. */
  displayMode?: TimerDisplayMode;
  /** Optional explicit operational status (e.g. "idle", "locked", "recalled", "complete"). */
  status?: TimerStatus;
  /** Height scale aligned with IconShip / EmptyValue (`2xs` = 18px for summary rows, `xs` = 24px). */
  size?: TimerSize;
  /** Fixed width class applied identically across active, idle, and locked states so layout never shifts. */
  widthClass?: string;
  /** Optional fixed current timestamp (ms) for deterministic Storybook/Catalog snapshots. */
  nowMs?: number;
  /** Allows clicking the timer to invoke `onToggleDisplayMode`. Defaults to true when handler is passed. */
  interactive?: boolean;
  /** Callback triggered when user clicks the timer to cycle display modes. */
  onToggleDisplayMode?: () => void;
  /** Optional override text when status is "complete". */
  completeText?: string;
  /** Optional override text when status is "locked". */
  lockedText?: string;
  /** Optional override text when status is "idle". */
  idleText?: string;
  /** Extra CSS classes. */
  class?: string;
}

export const ComponentTimer: Component<ComponentTimerProps> = (props) => {
  const sharedNow = useSharedNow();
  const currentNowMs = () => props.nowMs ?? sharedNow();
  const size = () => props.size ?? "xs";
  const resolvedWidthClass = () =>
    props.widthClass ?? defaultWidthClasses[size()];
  const displayMode = () => props.displayMode ?? "both";

  const status = createMemo<TimerStatus>(() =>
    resolveTimerStatus(props.completeTimeMs, currentNowMs(), {
      forcedStatus: props.status,
    }),
  );

  const remainingMs = createMemo(() => {
    const target = props.completeTimeMs;
    if (!target || target <= 0) return 0;
    return Math.max(0, target - currentNowMs());
  });

  const remainingText = createMemo(() => {
    if (status() === "complete") {
      return props.completeText ?? "Complete";
    }
    return formatRemainingTime(remainingMs());
  });

  const completeClockText = createMemo(() => {
    const target = props.completeTimeMs;
    if (!target || target <= 0) return "—";
    return formatCompleteTime(target, currentNowMs(), {
      includeSeconds: displayMode() === "complete_at",
    });
  });

  const tooltipText = createMemo(() => {
    const s = status();
    if (s === "locked") return props.lockedText ?? "Locked";
    if (s === "idle") return props.idleText ?? "Idle";
    const target = props.completeTimeMs;
    const remain =
      s === "complete"
        ? (props.completeText ?? "Complete")
        : formatRemainingTime(remainingMs());
    const finish =
      target && target > 0 ? formatCompleteDateTimeFull(target) : "—";
    const toggleHint =
      props.onToggleDisplayMode && props.interactive !== false
        ? " (Click to switch mode)"
        : "";
    return `Remain: ${remain} / Finish: ${finish}${toggleHint}`;
  });

  const isInteractive = () =>
    Boolean(props.onToggleDisplayMode) &&
    props.interactive !== false &&
    status() !== "idle" &&
    status() !== "locked";

  const handleClick = (event: MouseEvent) => {
    if (!isInteractive()) return;
    event.preventDefault();
    event.stopPropagation();
    props.onToggleDisplayMode?.();
  };

  const pillClasses = () =>
    [
      "inline-flex items-center justify-center shrink-0 box-border rounded border font-mono tabular-nums leading-none whitespace-nowrap select-none transition-colors",
      sizeClasses[size()],
      resolvedWidthClass(),
      statusClasses[status()],
      isInteractive()
        ? "cursor-pointer hover:border-primary/60 focus-visible:outline-none focus-visible:border-primary"
        : "cursor-default",
      props.class ?? "",
    ]
      .filter(Boolean)
      .join(" ");

  const renderIcon = () => (
    <Show
      when={status() === "complete"}
      fallback={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class={`${iconSizeClasses[size()]} shrink-0 opacity-80`}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      }
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class={`${iconSizeClasses[size()]} shrink-0`}
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </Show>
  );

  const renderTimeReadout = () => (
    <>
      <Show when={displayMode() === "remaining"}>
        <span>{remainingText()}</span>
      </Show>
      <Show when={displayMode() === "complete_at"}>
        <Show
          when={status() === "complete"}
          fallback={<span>{completeClockText()}</span>}
        >
          <span>{remainingText()}</span>
          <Show when={(props.completeTimeMs ?? 0) > 0}>
            <span class="opacity-50">·</span>
            <span class="opacity-80">{completeClockText()}</span>
          </Show>
        </Show>
      </Show>
      <Show when={displayMode() === "both"}>
        <span>{remainingText()}</span>
        <Show when={(props.completeTimeMs ?? 0) > 0}>
          <span class="opacity-40">·</span>
          <span class="opacity-75">{completeClockText()}</span>
        </Show>
      </Show>
    </>
  );

  return (
    <Show
      when={status() !== "idle" && status() !== "locked"}
      fallback={
        <Show
          when={status() === "locked" && props.lockedText}
          fallback={
            <Show
              when={status() === "idle" && props.idleText}
              fallback={
                <EmptyValue
                  size={size()}
                  widthClass={resolvedWidthClass()}
                  label={status() === "locked" ? "Locked" : "Idle"}
                  class={props.class}
                />
              }
            >
              <span class={pillClasses()} title={tooltipText()}>
                {props.idleText}
              </span>
            </Show>
          }
        >
          <span class={pillClasses()} title={tooltipText()}>
            {props.lockedText}
          </span>
        </Show>
      }
    >
      <Show
        when={isInteractive()}
        fallback={
          <span class={pillClasses()} title={tooltipText()}>
            {renderIcon()}
            {renderTimeReadout()}
          </span>
        }
      >
        <button
          type="button"
          class={pillClasses()}
          title={tooltipText()}
          aria-label={tooltipText()}
          onClick={handleClick}
        >
          {renderIcon()}
          {renderTimeReadout()}
        </button>
      </Show>
    </Show>
  );
};
