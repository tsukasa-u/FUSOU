/** @jsxImportSource solid-js */
import { WIN_RANK_BADGES } from "@/features/battles/constants";

export interface VictoryRankBadgeProps {
  rank: string;
  size?: "xs" | "sm" | "md";
  class?: string;
}

export function VictoryRankBadge(props: VictoryRankBadgeProps) {
  const sizeClass = () => {
    switch (props.size) {
      case "xs":
        return "badge-xs text-[10px]";
      case "md":
        return "badge-md text-sm font-bold";
      case "sm":
      default:
        return "badge-sm text-xs font-semibold";
    }
  };

  const badgeColor = () => WIN_RANK_BADGES[props.rank] ?? "badge-ghost";

  return (
    <span class={`badge ${badgeColor()} ${sizeClass()} font-mono ${props.class ?? ""}`.trim()}>
      {props.rank}
    </span>
  );
}

export default VictoryRankBadge;
