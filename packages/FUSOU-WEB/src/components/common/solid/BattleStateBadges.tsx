/** @jsxImportSource solid-js */
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
  const num = () => (typeof props.state === "number" ? props.state : Number(props.state));
  const label = () => {
    const n = num();
    if (Number.isFinite(n) && AIR_STATE_NAMES[n]) return AIR_STATE_NAMES[n];
    return typeof props.state === "string" ? props.state : "制空不明";
  };

  const colorClass = () => {
    const l = label();
    if (l === "制空権確保") return "badge-success";
    if (l === "航空優勢") return "badge-info";
    if (l === "航空拮抗") return "badge-warning";
    if (l === "航空劣勢") return "badge-warning badge-outline";
    if (l === "制空権喪失") return "badge-error";
    return "badge-ghost";
  };

  return (
    <span
      class={`badge ${colorClass()} ${props.size === "xs" ? "badge-xs" : "badge-sm"} font-medium whitespace-nowrap ${props.class ?? ""}`.trim()}
    >
      {label()}
    </span>
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
