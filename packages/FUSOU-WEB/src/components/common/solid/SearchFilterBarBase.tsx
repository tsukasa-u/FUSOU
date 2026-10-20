/** @jsxImportSource solid-js */
import { onMount, onCleanup, Show, type JSX } from "solid-js";
import { IconFilter } from "@/components/common/solid/icons/CommonIcons";

export interface SearchFilterBarBaseProps {
  searchQuery: () => string;
  onSearchChange: (query: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  activeFilterCount: number;
  onOpenFilterModal: () => void;
  filterButtonId?: string;
  filterButtonTitle?: string;
  isOpen: () => boolean;
  onOpenChange: (open: boolean) => void;
  class?: string | undefined;
  children?: JSX.Element;
  containerRef?: (el: HTMLDivElement) => void;
  inputRef?: (el: HTMLInputElement) => void;
}

/**
 * Unified Search & Filter Bar Base Component.
 * Integrates borderless search input, clear button, keyboard shortcuts (/ and Esc),
 * built-in filter modal trigger button, and suggestion popover dropdown container.
 */
export function SearchFilterBarBase(props: SearchFilterBarBaseProps): JSX.Element {
  let internalContainerRef!: HTMLDivElement;
  let internalInputRef!: HTMLInputElement;

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName || "")
      ) {
        e.preventDefault();
        internalInputRef?.focus();
        internalInputRef?.select();
        props.onOpenChange(true);
      } else if (e.key === "Escape") {
        props.onOpenChange(false);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (internalContainerRef && !internalContainerRef.contains(e.target as Node)) {
        props.onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    });
  });

  return (
    <div
      ref={(el) => {
        internalContainerRef = el;
        props.containerRef?.(el);
      }}
      class={`relative flex items-center h-8 rounded-md border border-base-300 bg-base-100 hover:border-primary focus-within:border-primary transition-colors w-full md:w-auto max-w-full min-w-0 mb-1.5 sm:mb-1 ${props.class ?? ""}`.trim()}
      role="search"
      aria-label={props.ariaLabel ?? "検索・フィルター"}
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

      {/* 2. Borderless Search Input */}
      <input
        ref={(el) => {
          internalInputRef = el;
          props.inputRef?.(el);
        }}
        type="search"
        value={props.searchQuery()}
        onInput={(e) => {
          props.onSearchChange(e.currentTarget.value);
          props.onOpenChange(true);
        }}
        onFocus={() => {
          if (props.searchQuery().trim()) props.onOpenChange(true);
        }}
        placeholder={props.placeholder ?? "検索..."}
        class="bg-transparent border-none outline-none focus:outline-none focus:ring-0 ring-0 shadow-none focus:shadow-none text-xs flex-1 min-w-[80px] md:w-48 lg:w-56 text-base-content placeholder:text-base-content/40 py-1 pl-1 [appearance:textfield] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
        aria-label={props.ariaLabel ?? "検索入力"}
      />

      {/* 3. Search Clear Button */}
      <Show when={props.searchQuery()}>
        <button
          type="button"
          onClick={() => {
            props.onSearchChange("");
            props.onOpenChange(false);
            internalInputRef?.focus();
          }}
          class="size-4 mr-1.5 rounded hover:bg-base-200 flex items-center justify-center text-base-content/40 hover:text-base-content text-[11px] cursor-pointer shrink-0"
          title="検索文字をクリア"
          aria-label="検索文字をクリア"
        >
          ✕
        </button>
      </Show>

      {/* 4. Shortcut badge (Desktop only) */}
      <Show when={!props.searchQuery()}>
        <kbd class="text-[10px] font-mono bg-base-200 border border-base-300 rounded px-1 mr-1.5 text-base-content/40 pointer-events-none hidden sm:inline-block select-none shrink-0">
          /
        </kbd>
      </Show>

      {/* 5. Internal Divider */}
      <div class="h-4 w-px bg-base-300 mx-0.5 select-none shrink-0" />

      {/* 6. Built-in Filter Trigger Button */}
      <button
        id={props.filterButtonId}
        type="button"
        onClick={props.onOpenFilterModal}
        class="inline-flex items-center gap-1 px-2.5 h-full text-xs text-base-content/70 hover:text-primary hover:bg-primary/10 focus-visible:text-primary focus-visible:bg-primary/10 focus-visible:outline-none rounded-r-md transition-colors cursor-pointer select-none group shrink-0 outline-none"
        classList={{
          "text-primary font-medium bg-primary/10": props.activeFilterCount > 0,
        }}
        title={props.filterButtonTitle ?? "フィルター設定"}
        aria-label={props.filterButtonTitle ?? "詳細フィルター設定"}
      >
        <IconFilter
          class={`size-3.5 transition-colors shrink-0 group-hover:text-primary group-focus-visible:text-primary ${props.activeFilterCount > 0 ? "text-primary" : "text-base-content/50"}`}
        />
        <span class="text-xs group-hover:text-primary group-focus-visible:text-primary transition-colors font-normal">
          フィルター
        </span>
        <Show when={props.activeFilterCount > 0}>
          <span class="badge badge-primary badge-xs px-1 font-bold">
            {props.activeFilterCount}
          </span>
        </Show>
      </button>

      {/* 7. Dropdown Popover */}
      <Show when={props.isOpen() && props.searchQuery().trim().length > 0}>
        <div class="absolute top-full right-0 md:left-0 md:right-auto mt-1 w-80 sm:w-96 max-h-96 overflow-y-auto bg-base-100 border border-base-300 rounded-xl shadow-2xl z-50 p-2 space-y-3">
          {props.children}
        </div>
      </Show>
    </div>
  );
}

/**
 * Reusable Group Header for search suggestions
 */
export function SuggestionGroup(props: {
  title: string;
  count?: number;
  hint?: string;
  hasTopBorder?: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class={props.hasTopBorder ? "pt-2 border-t border-base-200" : ""}>
      <div class="px-2 py-1 text-[11px] font-bold text-base-content/50 uppercase tracking-wider flex items-center justify-between">
        <span>
          {props.title}
          <Show when={props.count != null}> ({props.count})</Show>
        </span>
        <span class="text-[10px] font-normal lowercase">{props.hint ?? "クリックで選択"}</span>
      </div>
      <div class="space-y-0.5">{props.children}</div>
    </div>
  );
}

/**
 * Reusable Suggestion Item Button
 */
export function SuggestionItemButton(props: {
  onClick: () => void;
  title: string;
  badge?: string | undefined;
  badgeClass?: string | undefined;
  meta?: string | undefined;
  subTitle?: string | undefined;
}): JSX.Element {
  return (
    <button
      type="button"
      class="w-full text-left px-2 py-1.5 rounded-lg hover:bg-base-200 flex items-center justify-between gap-2 group transition-colors cursor-pointer"
      onClick={props.onClick}
    >
      <div class="min-w-0 flex items-center gap-2">
        <span class="font-medium text-xs text-base-content/90 group-hover:text-primary truncate">
          {props.title}
        </span>
        <Show when={props.badge}>
          <span
            class={`badge badge-xs shrink-0 text-[10px] ${
              props.badgeClass ?? "badge-ghost"
            }`}
          >
            {props.badge}
          </span>
        </Show>
      </div>
      <Show when={props.meta}>
        <span class="text-[10px] font-mono text-base-content/40 shrink-0">
          {props.meta}
        </span>
      </Show>
    </button>
  );
}

export default SearchFilterBarBase;
