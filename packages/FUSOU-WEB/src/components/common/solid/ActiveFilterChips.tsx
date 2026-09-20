/** @jsxImportSource solid-js */
import { For, Show, type JSX } from "solid-js";
import { IconFilter } from "./icons/CommonIcons";

export interface FilterChipItem {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

export interface ActiveFilterChipsProps {
  items: FilterChipItem[];
  onClearAll?: (() => void) | undefined;
  class?: string | undefined;
}

/**
 * Visual indicator and quick-removal chips for active filters.
 * Conforms to DESIGN.MD Section 10 Component rules.
 */
export function ActiveFilterChips(props: ActiveFilterChipsProps): JSX.Element {
  return (
    <Show when={props.items && props.items.length > 0}>
      <div
        class={`flex flex-wrap items-center gap-1.5 text-xs py-1 ${props.class ?? ""}`.trim()}
        role="region"
        aria-label="適用中のフィルター"
      >
        <span class="inline-flex items-center gap-1 text-base-content/60 font-medium select-none pr-0.5">
          <IconFilter class="size-3 text-primary" />
          <span>適用中:</span>
        </span>

        <For each={props.items}>
          {(item) => (
            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-base-200/90 border border-base-300 text-base-content hover:border-primary/40 transition-colors">
              <span class="text-base-content/60 text-[11px]">{item.label}:</span>
              <span class="font-semibold text-primary text-[11px]">{item.value}</span>
              <button
                type="button"
                class="size-3.5 -mr-0.5 rounded hover:bg-base-300 flex items-center justify-center text-base-content/50 hover:text-error transition-colors cursor-pointer text-[10px]"
                title={`${item.label} (${item.value}) フィルターを解除`}
                aria-label={`${item.label} (${item.value}) フィルターを解除`}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onRemove();
                }}
              >
                ✕
              </button>
            </span>
          )}
        </For>

        <Show when={props.onClearAll && props.items.length > 1}>
          <button
            type="button"
            class="text-[11px] text-base-content/50 hover:text-error transition-colors underline underline-offset-2 ml-1 cursor-pointer select-none"
            onClick={props.onClearAll}
          >
            条件をすべてクリア
          </button>
        </Show>
      </div>
    </Show>
  );
}

export default ActiveFilterChips;
