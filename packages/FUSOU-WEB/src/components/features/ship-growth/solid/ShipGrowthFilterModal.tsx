/** @jsxImportSource solid-js */
import { FusouModal } from "@/components/common/solid/FusouModal";
import { For, Show } from "solid-js";
import type { PeriodSummary } from "./ShipGrowthPanel";
import { periodLabel } from "./ShipGrowthPanel";

export interface StypeGroup {
  name: string;
  stypes: number[];
}

export const SHIP_TYPE_GROUPS: StypeGroup[] = [
  { name: "駆逐艦", stypes: [2] },
  { name: "軽巡・雷巡・練巡", stypes: [3, 4, 21] },
  { name: "重巡・航巡", stypes: [5, 6] },
  { name: "戦艦系", stypes: [8, 9, 10, 12] },
  { name: "空母系", stypes: [7, 11, 18] },
  { name: "潜水艦系", stypes: [13, 14] },
  { name: "海防艦", stypes: [1] },
  { name: "水上機母艦・補給・補助", stypes: [15, 16, 17, 19, 20, 22] },
];

export interface ShipGrowthFilterModalProps {
  ref: (element: HTMLDialogElement) => void;
  periods: () => PeriodSummary[];
  selectedPeriodIndex: () => number;
  loadingPeriods: () => boolean;
  onPeriodChange: (index: number) => void;
  selectedStypes: () => number[];
  onStypesChange: (stypes: number[]) => void;
  onReset: () => void;
}

export default function ShipGrowthFilterModal(props: ShipGrowthFilterModalProps) {
  const isGroupSelected = (group: StypeGroup) => {
    const selected = props.selectedStypes();
    if (selected.length === 0) return true;
    return group.stypes.some((st) => selected.includes(st));
  };

  const toggleGroup = (group: StypeGroup) => {
    const current = props.selectedStypes();
    const allStypes = SHIP_TYPE_GROUPS.flatMap((g) => g.stypes);
    
    const baseSelected = current.length === 0 ? allStypes : [...current];
    const isSelected = group.stypes.some((st) => baseSelected.includes(st));

    let next: number[];
    if (isSelected) {
      next = baseSelected.filter((st) => !group.stypes.includes(st));
    } else {
      next = [...new Set([...baseSelected, ...group.stypes])];
    }

    if (next.length === allStypes.length) {
      props.onStypesChange([]);
    } else {
      props.onStypesChange(next);
    }
  };

  const selectAll = () => {
    props.onStypesChange([]);
  };

  const clearAll = () => {
    props.onStypesChange([-1]);
  };

  return (
    <FusouModal
      ref={props.ref}
      title="パラメータ推移フィルター"
      description="表示する期間および艦種を設定します。"
      maxWidth="md"
      actions={
        <div class="flex items-center justify-between w-full">
          <button
            type="button"
            class="fusou-btn-ghost btn-sm text-xs"
            onClick={props.onReset}
          >
            初期状態に戻す
          </button>
          <form method="dialog">
            <button type="submit" class="fusou-btn-primary btn-sm">
              閉じる
            </button>
          </form>
        </div>
      }
    >
      <div class="space-y-4">
        {/* 1. 期間セクション */}
        <div class="space-y-1.5 pb-3 border-b border-base-200">
          <label for="ship-growth-filter-period" class="text-xs font-semibold text-base-content/70">
            期間
          </label>
          <select
            id="ship-growth-filter-period"
            class="select select-bordered select-sm w-full"
            value={props.selectedPeriodIndex().toString()}
            onChange={(e) => props.onPeriodChange(Number(e.currentTarget.value))}
            disabled={props.loadingPeriods() || props.periods().length === 0}
          >
            <Show when={props.loadingPeriods()}>
              <option value={props.selectedPeriodIndex().toString()}>読込中...</option>
            </Show>
            <For each={props.periods()}>
              {(period, index) => (
                <option value={index().toString()}>{periodLabel(period)}</option>
              )}
            </For>
          </select>
        </div>

        {/* 2. 艦種グループセクション */}
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-base-content/70">艦種グループ</span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="fusou-btn-secondary btn-xs text-[11px]"
                onClick={selectAll}
              >
                すべて選択
              </button>
              <button
                type="button"
                class="fusou-btn-ghost btn-xs text-[11px]"
                onClick={clearAll}
              >
                すべて解除
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <For each={SHIP_TYPE_GROUPS}>
              {(group) => {
                const checked = () => isGroupSelected(group);
                return (
                  <label class="flex items-center gap-2.5 p-2 rounded-lg border border-base-300 bg-base-100 hover:bg-base-200/50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm checkbox-primary"
                      checked={checked()}
                      onChange={() => toggleGroup(group)}
                    />
                    <span class="text-xs font-medium text-base-content/90 select-none">
                      {group.name}
                    </span>
                  </label>
                );
              }}
            </For>
          </div>
        </div>
      </div>
    </FusouModal>
  );
}
