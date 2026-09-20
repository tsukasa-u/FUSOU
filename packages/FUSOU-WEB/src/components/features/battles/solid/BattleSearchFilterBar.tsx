/** @jsxImportSource solid-js */
import { onMount, onCleanup, Show, type JSX } from "solid-js";
import { IconFilter } from "@/components/common/solid/icons/CommonIcons";

export interface BattleSearchFilterBarProps {
  searchQuery: () => string;
  onSearchChange: (query: string) => void;
  activeFilterCount: number;
  onOpenFilterModal: () => void;
  class?: string | undefined;
}

/**
 * Single unified Search & Filter Bar component.
 * Integrates text search input and detailed filter trigger into one cohesive control.
 * Responsive across mobile and desktop without layout breaks or double borders.
 * Conforms to DESIGN.MD Section 10 Component rules.
 */
export function BattleSearchFilterBar(props: BattleSearchFilterBarProps): JSX.Element {
  let searchInputRef!: HTMLInputElement;

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName || "")
      ) {
        e.preventDefault();
        searchInputRef?.focus();
        searchInputRef?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <div
      class={`flex items-center h-8 rounded-md border border-base-300 bg-base-100 hover:border-base-content/30 focus-within:border-primary focus-within:ring-0 transition-colors w-full md:w-auto max-w-full min-w-0 mb-1.5 sm:mb-1 ${props.class ?? ""}`.trim()}
      role="search"
      aria-label="戦闘データ検索・フィルター"
    >
      {/* 1. Search Icon */}
      <div class="pl-2.5 pr-1 text-base-content/40 flex items-center pointer-events-none select-none shrink-0">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="size-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>

      {/* 2. Borderless Search Input (Fills available width on mobile, no double border) */}
      <input
        ref={searchInputRef}
        type="search"
        value={props.searchQuery()}
        onInput={(e) => props.onSearchChange(e.currentTarget.value)}
        placeholder="検索 (艦名・海域・マス)..."
        class="bg-transparent border-none outline-none focus:outline-none focus:ring-0 ring-0 shadow-none focus:shadow-none text-xs flex-1 min-w-[80px] md:w-48 lg:w-56 text-base-content placeholder:text-base-content/40 py-1 pl-1 [appearance:textfield] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
        aria-label="戦闘データ検索"
      />

      {/* 3. Search Clear Button */}
      <Show when={props.searchQuery()}>
        <button
          type="button"
          onClick={() => {
            props.onSearchChange("");
            searchInputRef?.focus();
          }}
          class="size-4 mr-1.5 rounded hover:bg-base-200 flex items-center justify-center text-base-content/40 hover:text-base-content text-[11px] cursor-pointer shrink-0"
          title="検索文字をクリア"
          aria-label="検索文字をクリア"
        >
          ✕
        </button>
      </Show>

      {/* 4. Shortcut / badge (Desktop only) */}
      <Show when={!props.searchQuery()}>
        <kbd class="text-[10px] font-mono bg-base-200 border border-base-300 rounded px-1 mr-1.5 text-base-content/40 pointer-events-none hidden sm:inline-block select-none shrink-0">
          /
        </kbd>
      </Show>

      {/* 5. Internal Divider */}
      <div class="h-4 w-px bg-base-300 mx-0.5 select-none shrink-0" />

      {/* 6. Built-in Filter Trigger Button */}
      <button
        id="battle-filter-settings-btn"
        type="button"
        onClick={props.onOpenFilterModal}
        class="inline-flex items-center gap-1 px-2.5 h-full text-xs text-base-content/70 hover:text-primary hover:bg-base-200/60 rounded-r-md transition-colors cursor-pointer select-none group shrink-0 outline-none focus:outline-none"
        classList={{
          "text-primary font-medium bg-primary/10": props.activeFilterCount > 0,
        }}
        title="フィルター設定 (海域・勝敗・期間)"
        aria-label="詳細フィルター設定"
      >
        <IconFilter
          class={`size-3.5 transition-colors shrink-0 group-hover:text-primary ${props.activeFilterCount > 0 ? "text-primary" : "text-base-content/50"}`}
        />
        <span class="text-xs group-hover:text-base-content transition-colors font-normal">
          フィルター
        </span>
        <Show when={props.activeFilterCount > 0}>
          <span class="badge badge-primary badge-xs px-1 font-bold">
            {props.activeFilterCount}
          </span>
        </Show>
      </button>
    </div>
  );
}

export default BattleSearchFilterBar;