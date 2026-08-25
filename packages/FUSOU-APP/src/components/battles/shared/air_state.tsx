import { Show, type JSX } from "solid-js";

interface AirStateProps {
  air_state: number | null | undefined;
  fallback?: JSX.Element;
}

const AIR_STATE_DISPLAY: Partial<
  Record<number, { label: string; class: string }>
> = {
  0: { label: "Air Supremacy", class: "text-lime-500 pl-1" },
  1: { label: "Air Superiority", class: "text-lime-500 pl-1" },
  4: { label: "Air Incapability", class: "text-red-500 pl-1" },
};

export function AirStateComponent(props: AirStateProps): JSX.Element {
  const air_state = () => AIR_STATE_DISPLAY[props.air_state ?? -1];

  return (
    <>
      Air State :{" "}
      <Show when={air_state()} fallback={props.fallback ?? <div />}>
        <div class={air_state()?.class}>{air_state()?.label}</div>
      </Show>
    </>
  );
}