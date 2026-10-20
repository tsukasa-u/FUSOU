/** @jsxImportSource solid-js */
import { FusouModal } from "@/components/common/solid/FusouModal";
import { For } from "solid-js";
import { SHIP_TYPE_GROUPS, type StypeGroup } from "@/components/features/ship-growth/solid/ShipGrowthFilterModal";

export interface SimulatorFilterSettings {
  includeShips: boolean;
  includeEquips: boolean;
  includeWorkspaces: boolean;
  selectedStypes: number[];
}

export interface SimulatorFilterModalProps {
  ref: (element: HTMLDialogElement) => void;
  settings: () => SimulatorFilterSettings;
  onSettingsChange: (settings: SimulatorFilterSettings) => void;
  onReset: () => void;
}

export default function SimulatorFilterModal(props: SimulatorFilterModalProps) {
  const current = () => props.settings();

  const toggleCategory = (key: "includeShips" | "includeEquips" | "includeWorkspaces") => {
    props.onSettingsChange({
      ...current(),
      [key]: !current()[key],
    });
  };

  const isGroupSelected = (group: StypeGroup) => {
    const selected = current().selectedStypes;
    if (selected.length === 0) return true;
    return group.stypes.some((st) => selected.includes(st));
  };

  const toggleStypeGroup = (group: StypeGroup) => {
    const selected = current().selectedStypes;
    const allStypes = SHIP_TYPE_GROUPS.flatMap((g) => g.stypes);
    const baseSelected = selected.length === 0 ? allStypes : [...selected];
    const isSelected = group.stypes.some((st) => baseSelected.includes(st));

    let next: number[];
    if (isSelected) {
      next = baseSelected.filter((st) => !group.stypes.includes(st));
    } else {
      next = [...new Set([...baseSelected, ...group.stypes])];
    }

    if (next.length === allStypes.length) {
      props.onSettingsChange({ ...current(), selectedStypes: [] });
    } else {
      props.onSettingsChange({ ...current(), selectedStypes: next });
    }
  };

  const selectAllStypes = () => {
    props.onSettingsChange({ ...current(), selectedStypes: [] });
  };

  const clearAllStypes = () => {
    props.onSettingsChange({ ...current(), selectedStypes: [-1] });
  };

  return (
    <FusouModal
      ref={props.ref}
      title="シミュレータ検索フィルター"
      description="横断検索の対象データや艦種を絞り込みます。"
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
        {/* 1. Target Data Categories */}
        <div class="space-y-2">
          <h4 class="text-xs font-semibold text-base-content/80">検索対象データ</h4>
          <div class="grid grid-cols-3 gap-2">
            <label class="flex items-center gap-2 p-2 rounded-lg border border-base-300 bg-base-100 hover:bg-base-200/50 cursor-pointer transition-colors text-xs">
              <input
                type="checkbox"
                class="checkbox checkbox-xs checkbox-primary"
                checked={current().includeShips}
                onChange={() => toggleCategory("includeShips")}
              />
              <span class="font-medium">艦</span>
            </label>
            <label class="flex items-center gap-2 p-2 rounded-lg border border-base-300 bg-base-100 hover:bg-base-200/50 cursor-pointer transition-colors text-xs">
              <input
                type="checkbox"
                class="checkbox checkbox-xs checkbox-primary"
                checked={current().includeEquips}
                onChange={() => toggleCategory("includeEquips")}
              />
              <span class="font-medium">装備</span>
            </label>
            <label class="flex items-center gap-2 p-2 rounded-lg border border-base-300 bg-base-100 hover:bg-base-200/50 cursor-pointer transition-colors text-xs">
              <input
                type="checkbox"
                class="checkbox checkbox-xs checkbox-primary"
                checked={current().includeWorkspaces}
                onChange={() => toggleCategory("includeWorkspaces")}
              />
              <span class="font-medium">保存編成</span>
            </label>
          </div>
        </div>

        {/* 2. Ship Type Filter (only relevant when includeShips is active) */}
        <div class={`space-y-2 pt-2 border-t border-base-300/60 ${!current().includeShips ? "opacity-40 pointer-events-none" : ""}`}>
          <div class="flex items-center justify-between">
            <h4 class="text-xs font-semibold text-base-content/80">艦種絞り込み</h4>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="fusou-btn-secondary btn-xs text-[11px]"
                onClick={selectAllStypes}
              >
                すべて選択
              </button>
              <button
                type="button"
                class="fusou-btn-ghost btn-xs text-[11px]"
                onClick={clearAllStypes}
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
                  <label class="flex items-center gap-2 p-2 rounded-lg border border-base-300 bg-base-100 hover:bg-base-200/50 cursor-pointer transition-colors text-xs">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-xs checkbox-primary"
                      checked={checked()}
                      onChange={() => toggleStypeGroup(group)}
                    />
                    <span class="font-medium truncate">{group.name}</span>
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
