import { Show, type JSX } from "solid-js";
import { EmptyValue } from "ui";

interface AirStateProps {
  air_state: number | null | undefined;
  fallback?: JSX.Element;
}

const AIR_STATE_DISPLAY: Partial<
  Record<number, { label: string; class: string }>
> = {
  0: { label: "Air Supremacy", class: "text-lime-500" },
  1: { label: "Air Superiority", class: "text-lime-500" },
  2: { label: "Air Parity", class: "text-yellow-500" },
  3: { label: "Air Denial", class: "text-orange-500" },
  4: { label: "Air Incapability", class: "text-red-500" },
};

export function AirStateComponent(props: AirStateProps): JSX.Element {
  const air_state = () => AIR_STATE_DISPLAY[props.air_state ?? -1];

  return (
    <div class="inline-flex items-center shrink-0">
      <span>Air State :</span>
      <span class="w-1" />
      <div class="w-28 shrink-0 truncate">
        <Show
          when={air_state()}
          fallback={
            props.fallback ?? (
              <EmptyValue size="xs" align="left" widthClass="w-full" />
            )
          }
        >
          <span class={air_state()?.class}>{air_state()?.label}</span>
        </Show>
      </div>
    </div>
  );
}
