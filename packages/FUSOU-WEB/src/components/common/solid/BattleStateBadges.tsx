/** @jsxImportSource solid-js */
import { Show } from "solid-js";
import {
  AIR_SUPERIORITY_NAMES as AIR_STATE_NAMES,
  FORMATION_NAMES,
} from "@/features/battles/constants";

export interface AirStateBadgeProps {
  state: number | string | undefined | null;
  size?: "xs" | "sm";
  class?: string;
}

export function AirStateBadge(props: AirStateBadgeProps) {
  const num = () =>
    typeof props.state === "number" ? props.state : Number(props.state);
  const label = () => {
    const n = num();
    if (Number.isFinite(n)) return AIR_STATE_NAMES[n] ?? null;
    return typeof props.state === "string" && props.state.trim().length > 0
      ? props.state
      : null;
  };

  const colorClass = () => {
    const l = label();
    if (l === "制空権確保") return "badge-success";
    if (l === "航空優勢") return "badge-info";
    if (l === "制空権喪失") return "badge-error";
    return "badge-ghost";
  };

  return (
    <Show when={label()}>
      {(text) => (
        <span
          class={`badge ${colorClass()} ${props.size === "xs" ? "badge-xs" : "badge-sm"} font-medium whitespace-nowrap ${props.class ?? ""}`.trim()}
        >
          {text()}
        </span>
      )}
    </Show>
  );
}

export interface FormationBadgeProps {
  formation: number | string | undefined | null;
  size?: "xs" | "sm";
  class?: string;
}

export function FormationBadge(props: FormationBadgeProps) {
  const num = () => (typeof props.formation === "number" ? props.formation : Number(props.formation));
  const label = () => {
    const n = num();
    if (Number.isFinite(n) && FORMATION_NAMES[n]) return FORMATION_NAMES[n];
    return typeof props.formation === "string" ? props.formation : "陣形不明";
  };

  return (
    <span
      class={`badge badge-outline ${props.size === "xs" ? "badge-xs" : "badge-sm"} font-medium whitespace-nowrap ${props.class ?? ""}`.trim()}
    >
      {label()}
    </span>
  );
}
