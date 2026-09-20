/** @jsxImportSource solid-js */
import { STYPE_NAMES, STYPE_SHORT, SPEED_NAMES } from "@/features/simulator/constants";

export interface ShipTypeBadgeProps {
  stype: number | string | undefined | null;
  short?: boolean;
  size?: "xs" | "sm" | "md";
  variant?: "outline" | "neutral" | "ghost";
  class?: string;
}

export function ShipTypeBadge(props: ShipTypeBadgeProps) {
  const stypeNum = () => (typeof props.stype === "number" ? props.stype : Number(props.stype));
  const label = () => {
    const num = stypeNum();
    if (!Number.isFinite(num) || num <= 0) return "不明";
    if (props.short) {
      return STYPE_SHORT[num] ?? STYPE_NAMES[num] ?? `艦種${num}`;
    }
    return STYPE_NAMES[num] ?? `艦種${num}`;
  };

  const sizeClass = () => {
    switch (props.size) {
      case "xs":
        return "badge-xs";
      case "md":
        return "";
      case "sm":
      default:
        return "badge-sm";
    }
  };

  const variantClass = () => {
    switch (props.variant) {
      case "neutral":
        return "badge-neutral";
      case "ghost":
        return "badge-ghost";
      case "outline":
      default:
        return "badge-outline";
    }
  };

  return (
    <span
      class={`badge ${variantClass()} ${sizeClass()} font-medium whitespace-nowrap ${props.class ?? ""}`.trim()}
      title={typeof props.stype === "number" ? STYPE_NAMES[props.stype] : undefined}
    >
      {label()}
    </span>
  );
}

export function SpeedBadge(props: { speed: number | undefined | null; size?: "xs" | "sm"; class?: string }) {
  const label = () => {
    if (props.speed == null) return "-";
    return SPEED_NAMES[props.speed] ?? `${props.speed}`;
  };
  return (
    <span
      class={`badge badge-outline ${props.size === "xs" ? "badge-xs" : "badge-sm"} font-medium whitespace-nowrap ${props.class ?? ""}`.trim()}
    >
      {label()}
    </span>
  );
}

export default ShipTypeBadge;
