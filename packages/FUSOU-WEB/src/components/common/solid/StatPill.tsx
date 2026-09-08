/** @jsxImportSource solid-js */
import { Show, type JSX } from "solid-js";

export interface StatPillProps {
  label: string;
  value: number | null | undefined;
  tone: "fire" | "torpedo" | "aa" | "armor";
  showLabel?: boolean;
  hideLabelOnTiny?: boolean;
  class?: string;
}

export function StatPill(props: StatPillProps): JSX.Element {
  const toneClass = () => {
    switch (props.tone) {
      case "fire":
        return "border-error/30 bg-error/10 text-error";
      case "torpedo":
        return "border-info/30 bg-info/10 text-info";
      case "aa":
        return "border-warning/35 bg-warning/10 text-warning";
      case "armor":
        return "border-base-300 bg-base-300/40 text-base-content/85";
    }
  };

  const displayValue = () => {
    if (props.value == null || props.value === 0) return null;
    return props.value;
  };

  return (
    <Show when={displayValue() != null}>
      <span
        class={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[10px] leading-none border ${toneClass()} ${props.class ?? ""}`.trim()}
      >
        <Show when={props.showLabel ?? true}>
          <span class={`font-sans opacity-70 ${props.hideLabelOnTiny ? "hidden sm:inline" : ""}`}>
            {props.label}
          </span>
        </Show>
        <span class="font-bold tabular-nums">{displayValue()}</span>
      </span>
    </Show>
  );
}

export default StatPill;
