/** @jsxImportSource solid-js */
import type { JSX } from "solid-js";

export function SimulatorEmptyShipSlot(props: {
  fleetIndex: 1 | 2 | 3 | 4;
  idx: number;
  onSelect: () => void;
}): JSX.Element {
  return (
    <div
      class="group w-full max-w-md mx-auto border-2 border-dashed border-base-300/50 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all min-h-[88px]"
      title={`第${props.fleetIndex}艦隊 ${props.idx + 1}番艦: クリックして艦を配置`}
      onClick={props.onSelect}
    >
      <span class="text-[10px] font-bold text-base-content/20">
        {props.idx + 1}
      </span>
      <div class="text-2xl leading-none text-base-content/15 group-hover:text-primary/50 transition-colors">
        +
      </div>
      <span class="text-[10px] text-base-content/20 group-hover:text-primary/40 transition-colors">
        艦を配置
      </span>
    </div>
  );
}
