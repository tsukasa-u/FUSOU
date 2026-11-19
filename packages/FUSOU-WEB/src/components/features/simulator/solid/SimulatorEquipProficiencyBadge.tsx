/** @jsxImportSource solid-js */
import { createMemo, type JSX } from "solid-js";

export interface SimulatorEquipProficiencyBadgeProps {
  level: number;
  hovered?: boolean;
  onCycle?: () => void;
}

export function SimulatorEquipProficiencyBadge(
  props: SimulatorEquipProficiencyBadgeProps,
): JSX.Element {
  const symbols = ["", "|", "||", "|||", "\\", "\\\\", "\\\\\\", ">>"];
  const nextLevel = createMemo(() =>
    props.level >= 7 ? 0 : props.level + 1,
  );
  const nextSymbol = createMemo(() => symbols[nextLevel()]);

  const colorClass = createMemo(() => {
    if (props.level <= 0) {
      return "text-blue-400/80 bg-base-100/95 border-dashed border-blue-400/50 hover:text-blue-300 hover:border-blue-400 hover:bg-blue-500/15 shadow-2xs";
    }
    if (props.level <= 3) {
      return "text-blue-400 bg-base-100/90 border-blue-500/40 hover:bg-blue-500/25 hover:border-blue-400 shadow-2xs";
    }
    if (props.level <= 6) {
      return "text-amber-400 bg-base-100/90 border-amber-500/40 hover:bg-amber-500/25 hover:border-amber-400 shadow-2xs";
    }
    return "text-orange-400 bg-base-100/90 border-orange-500/50 hover:bg-orange-500/25 hover:border-orange-400 font-extrabold shadow-2xs";
  });

  const isVisible = () => props.level > 0 || props.hovered;
  const displayText = () =>
    props.level > 0 ? (symbols[props.level] ?? ">>") : symbols[1];

  const textScaleStyle = createMemo((): JSX.CSSProperties => {
    const text = displayText() ?? "";
    if (text.length >= 3) {
      return {
        display: "inline-block",
        transform: "scaleX(0.72)",
        "transform-origin": "center center",
      };
    }
    if (text.length === 2) {
      return {
        display: "inline-block",
        transform: "scaleX(0.88)",
        "transform-origin": "center center",
      };
    }
    return { display: "inline-block" };
  });

  const tooltipText = () => {
    if (props.level === 0) {
      return `熟練度: なし (クリックで「${symbols[1]}」に設定)`;
    }
    if (props.level >= 7) return "熟練度: Lv.7 (>>) (クリックで解除)";
    return `熟練度: Lv.${props.level} (${symbols[props.level]}) (クリックで「${nextSymbol()}」へ)`;
  };

  return (
    <span
      class="shrink-0"
      onClick={(event) => {
        event.stopPropagation();
        props.onCycle?.();
      }}
    >
      <span
        class={`shrink-0 cursor-pointer select-none text-[10px] leading-none font-mono font-bold inline-flex items-center justify-center w-7 h-4 px-0.5 rounded border transition-all duration-150 ${colorClass()} ${
          isVisible() ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
        }`}
        title={tooltipText()}
      >
        <span style={textScaleStyle()}>{displayText()}</span>
      </span>
    </span>
  );
}
