import type { Component } from "solid-js";

export interface MenuFilterBarProps {
  value: string;
  onInput: (value: string) => void;
  placeholder: string;
  filteredCount: number;
  totalCount: number;
}

/**
 * Shared search filter bar rendered at the top of DaisyUI `.menu` operation tabs.
 */
export const MenuFilterBar: Component<MenuFilterBarProps> = (props) => {
  return (
    <li class="py-1 w-150 max-w-full">
      <div class="px-2 py-1 flex items-center justify-between gap-2 w-full hover:bg-transparent! active:bg-transparent! cursor-default">
        <input
          type="search"
          aria-label={props.placeholder}
          class="input input-xs input-bordered min-w-0 flex-1 max-w-60"
          placeholder={props.placeholder}
          value={props.value}
          onInput={(e) => props.onInput(e.currentTarget.value)}
        />
        <span class="text-xs text-base-content/60 tabular-nums shrink-0">
          {props.filteredCount} / {props.totalCount}
        </span>
      </div>
    </li>
  );
};
