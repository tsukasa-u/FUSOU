/** @jsxImportSource solid-js */
import { For } from "solid-js";
import { ShipBanner } from "../../battle-detail/solid/ui";
import { bannerUrl } from "@/features/simulator/equip-calc";

const RARITY_NAMES: Record<number, { label: string; colorClass: string }> = {
  1: { label: "コモン", colorClass: "text-blue-500" },
  2: { label: "コモン", colorClass: "text-sky-500" },
  3: { label: "レア", colorClass: "text-slate-400" },
  4: { label: "Sレア", colorClass: "text-yellow-500 font-medium" },
  5: { label: "ホロ", colorClass: "text-fuchsia-500 font-bold" },
  6: { label: "Sホロ", colorClass: "text-fuchsia-600 font-bold" },
  7: { label: "SSホロ", colorClass: "text-pink-500 font-bold" },
  8: { label: "SSホロ", colorClass: "text-pink-600 font-bold" }
};

export interface DropLocInfo {
  label: string;
  dropRateStr: string;
  ranksStr: string;
  count: number;
  pct: number;
}

export interface ShipDropCardProps {
  shipId: number;
  shipName: string;
  backs: number;
  overallRateLabel: string;
  overallRateStr: string;
  overallCount: number;
  dropLocs: DropLocInfo[];
}

export function ShipDropCard(props: ShipDropCardProps) {
  return (
    <div class="card bg-base-100 shadow-sm border border-base-200 hover:shadow-md transition-shadow text-xs overflow-hidden flex flex-row">
      <div class="flex flex-col items-center w-32 shrink-0 p-2 border-r border-base-200 bg-base-200/20">
        <div class="w-full rounded shadow-sm overflow-hidden mb-2 flex items-center justify-center bg-base-200/50" style="aspect-ratio: 4/1;">
          <ShipBanner
            src={bannerUrl(props.shipId, { f: "auto" })}
            alt={props.shipName}
            class="w-full h-full object-cover"
          />
        </div>
        <span class="font-bold text-center leading-tight mb-1">{props.shipName}</span>
        <span class={`text-[10px] tracking-tighter ${RARITY_NAMES[props.backs || 1]?.colorClass || "text-base-content/60"}`}>
          {RARITY_NAMES[props.backs || 1]?.label || `R${props.backs}`}
        </span>
      </div>
      
      <div class="flex-1 flex flex-col p-2 overflow-hidden">
        <div class="flex flex-col border-b border-base-200 pb-1 mb-2">
          <span class="text-[10px] text-base-content/60 leading-none mb-1">{props.overallRateLabel}</span>
          <div class="flex items-baseline gap-1">
            <span class="font-bold text-emerald-500 dark:text-emerald-400 leading-none">{props.overallRateStr}</span>
            <span class="text-[10px] text-base-content/50 font-mono tracking-tighter">({props.overallCount}回)</span>
          </div>
        </div>
        
        <div class="space-y-1.5 flex-1 overflow-y-auto">
          <div class="h-px p-0 m-0"/>
          <For each={props.dropLocs}>
            {(loc) => (
              <div class="group">
                <div class="flex justify-between items-baseline text-[10px] leading-none mb-1">
                  <span class="font-medium truncate pr-1">
                    {loc.label}
                    <span class="text-base-content/50 ml-1 font-normal">({loc.dropRateStr})</span>
                  </span>
                  <div class="flex items-baseline gap-1 shrink-0">
                    <span class="text-[9px] text-base-content/50 font-mono tracking-tighter">{loc.ranksStr}</span>
                    <span class="font-mono text-base-content/90 ml-1">{loc.count}回</span>
                  </div>
                </div>
                <div class="w-full h-1 bg-base-200 rounded-full overflow-hidden shadow-inner">
                  <div class="h-full bg-emerald-400 transition-all duration-500" style={{ width: `${loc.pct}%` }}></div>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
