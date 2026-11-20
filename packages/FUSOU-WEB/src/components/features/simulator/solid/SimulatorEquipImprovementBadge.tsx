/** @jsxImportSource solid-js */
import { createMemo, type JSX } from "solid-js";

export interface SimulatorEquipImprovementBadgeProps {
  level: number;
  hovered?: boolean;
  onCycle?: () => void;
}

export function SimulatorEquipImprovementBadge(
  props: SimulatorEquipImprovementBadgeProps,
): JSX.Element {
  const isMax = () => props.level >= 10;
  const isVisible = () => props.level > 0 || props.hovered;

  const styleClass = createMemo(() => {
    if (props.level <= 0) {
      return "text-base-content/60 bg-base-100/95 border-dashed border-base-300 hover:text-teal-300 hover:border-teal-400/70 hover:bg-teal-500/15 shadow-2xs";
    }
    if (isMax()) {
      return "text-teal-300 bg-base-100/90 border-teal-400/60 hover:bg-teal-500/25 hover:border-teal-300 font-extrabold shadow-2xs";
    }
    return "text-teal-400 bg-base-100/90 border-teal-500/40 hover:bg-teal-500/25 hover:border-teal-400 shadow-2xs";
  });

  const displayText = () => {
    if (props.level <= 0) return "★0";
    if (isMax()) return "MAX";
    return `★${props.level}`;
  };

  const textScaleStyle = createMemo((): JSX.CSSProperties => {
    if (isMax()) {
      return {
        display: "inline-block",
        transform: "scaleX(0.9)",
        "transform-origin": "center center",
        "letter-spacing": "-0.02em",
      };
    }
    return { display: "inline-block" };
  });

  return (
    <span
      class="shrink-0"
      onClick={(event) => {
        event.stopPropagation();
        props.onCycle?.();
      }}
    >
      <span
        class={`shrink-0 cursor-pointer select-none text-[10px] leading-none font-mono font-bold inline-flex items-center justify-center w-7 h-4 px-0.5 rounded border transition-all duration-150 ${styleClass()} ${
          isVisible() ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
        }`}
        title={
          props.level === 0
            ? "改修値: ★0 (クリックで★1へ)"
            : isMax()
              ? "改修値: MAX (クリックで★0へ)"
              : `改修値: ★${props.level} (クリックで${props.level + 1 === 10 ? "MAX" : `★${props.level + 1}`}へ)`
        }
      >
        <span style={textScaleStyle()}>{displayText()}</span>
      </span>
    </span>
  );
}
