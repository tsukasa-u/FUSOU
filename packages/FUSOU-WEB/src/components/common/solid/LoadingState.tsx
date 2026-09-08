/** @jsxImportSource solid-js */
import { Show } from "solid-js";

export interface LoadingStateProps {
  message?: string;
  size?: "xs" | "sm" | "md" | "lg";
  minHeight?: string;
  class?: string;
}

export function LoadingState(props: LoadingStateProps) {
  const spinnerClass = () => {
    switch (props.size) {
      case "xs":
        return "loading-xs";
      case "sm":
        return "loading-sm";
      case "lg":
        return "loading-lg";
      case "md":
      default:
        return "loading-md";
    }
  };

  return (
    <div
      class={`flex flex-col items-center justify-center text-center p-6 text-base-content/50 ${props.class ?? ""}`.trim()}
      style={{ "min-height": props.minHeight ?? "120px" }}
    >
      <span class={`loading loading-spinner text-primary ${spinnerClass()}`} aria-hidden="true" />
      <Show when={props.message}>
        <p class="text-xs text-base-content/60 mt-2 font-medium">{props.message}</p>
      </Show>
    </div>
  );
}

export default LoadingState;
