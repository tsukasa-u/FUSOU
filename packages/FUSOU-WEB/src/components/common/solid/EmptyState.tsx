/** @jsxImportSource solid-js */
import { Show } from "solid-js";

export interface EmptyStateProps {
  message?: string;
  hint?: string;
  description?: string;
  minHeight?: string;
  size?: "compact" | "standard" | "large";
  class?: string;
}

export function EmptyState(props: EmptyStateProps) {
  const sizeClass = () => {
    switch (props.size) {
      case "compact":
        return "py-4 text-xs";
      case "large":
        return "py-16 text-base";
      case "standard":
      default:
        return "py-8 text-sm";
    }
  };

  return (
    <div
      class={`flex flex-col items-center justify-center text-center text-base-content/50 ${sizeClass()} ${props.class ?? ""}`.trim()}
      style={props.minHeight ? { "min-height": props.minHeight } : undefined}
    >
      <p class="font-medium">{props.message ?? "データがありません"}</p>
      <Show when={props.hint || props.description}>
        <p class="text-xs text-base-content/40 mt-1">{props.hint ?? props.description}</p>
      </Show>
    </div>
  );
}

export default EmptyState;
