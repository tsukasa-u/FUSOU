/** @jsxImportSource solid-js */

import { For, type JSX } from "solid-js";

export type PickerQuickAccessEntry = {
  id: string;
  label: string;
  icon?: JSX.Element;
  onSelect: () => void;
};

/**
 * 共通クイックアクセス。
 * 画面サイズを問わず同じ構造を使い、アイコン+ラベルは常に横並びで折り返さない。
 */
export function PickerQuickAccess(props: {
  entries: PickerQuickAccessEntry[];
  widthClass?: string;
  activeId?: string | null;
  class?: string;
}): JSX.Element {
  const wc = () => props.widthClass ?? "w-28";

  return (
    <div
      class={`${wc()} border-r border-base-200 bg-base-200/20 overflow-y-auto hide-scrollbar shrink-0 ${props.class ?? ""}`.trim()}
    >
      <div class="p-1.5 space-y-1">
        <For each={props.entries}>
          {(entry) => (
            <button
              type="button"
              class={`w-full text-left px-2 py-1.5 rounded-md text-[12px] leading-none transition-colors inline-flex items-center gap-2 whitespace-nowrap ${
                props.activeId === entry.id
                  ? "bg-primary/15 text-primary ring-1 ring-primary/35"
                  : "hover:bg-primary/10 active:bg-primary/15 text-base-content/75 hover:text-base-content"
              }`}
              title={entry.label}
              onClick={entry.onSelect}
            >
              <span class="inline-flex items-center justify-center shrink-0 min-w-5 min-h-5">
                {entry.icon}
              </span>
              <span class="truncate whitespace-nowrap">{entry.label}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
