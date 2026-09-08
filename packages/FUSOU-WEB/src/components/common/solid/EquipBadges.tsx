/** @jsxImportSource solid-js */
import { Show } from "solid-js";

const PROF_SYMBOLS: Record<number, string> = {
  1: "|",
  2: "||",
  3: "|||",
  4: "\\",
  5: "\\\\",
  6: "\\\\\\",
  7: ">>",
};

export interface AircraftProficiencyBadgeProps {
  alv: number | undefined | null;
  class?: string;
}

export function AircraftProficiencyBadge(props: AircraftProficiencyBadgeProps) {
  const alvNum = () => Number(props.alv || 0);
  const symbol = () => PROF_SYMBOLS[alvNum()] ?? ">>";

  const colorClass = () => {
    const a = alvNum();
    if (a <= 0) return "hidden";
    if (a <= 3) return "text-info font-bold";
    if (a <= 6) return "text-warning font-bold";
    return "text-accent font-bold";
  };

  return (
    <Show when={alvNum() > 0}>
      <span
        class={`font-mono text-xs tabular-nums ${colorClass()} ${props.class ?? ""}`.trim()}
        title={`艦載機熟練度 ${alvNum()}`}
      >
        {symbol()}
      </span>
    </Show>
  );
}

export interface EquipLevelBadgeProps {
  level: number | undefined | null;
  class?: string;
}

export function EquipLevelBadge(props: EquipLevelBadgeProps) {
  const lv = () => Number(props.level || 0);
  const text = () => (lv() >= 10 ? "★max" : `★+${lv()}`);

  return (
    <Show when={lv() > 0}>
      <span
        class={`font-mono text-xs text-primary font-bold tabular-nums ${props.class ?? ""}`.trim()}
        title={`改修値 ${lv()}`}
      >
        {text()}
      </span>
    </Show>
  );
}
