/** @jsxImportSource solid-js */
import { For, Show, type JSX } from "solid-js";

export type TabItem<T extends string = string> = {
  id: T;
  label: string;
  icon?: JSX.Element | undefined;
  badge?: string | number | undefined;
};

export type FusouTabsProps<T extends string = string> = {
  tabs: readonly TabItem<T>[] | TabItem<T>[];
  activeTab: T;
  onTabChange: (id: T) => void;
  disabled?: boolean | undefined;
  class?: string | undefined;
  tabIdPrefix?: string | undefined;
  ariaLabel?: string | undefined;
};

export function FusouTabs<T extends string = string>(props: FusouTabsProps<T>): JSX.Element {
  return (
    <div
      class={`fusou-tabs shrink-0 ${props.class ?? ""}`}
      role="tablist"
      aria-label={props.ariaLabel ?? "タブナビゲーション"}
    >
      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => props.activeTab === tab.id;
          const elementId = () => (props.tabIdPrefix ? `${props.tabIdPrefix}-${tab.id}` : undefined);

          return (
            <button
              id={elementId()}
              role="tab"
              type="button"
              aria-selected={isActive()}
              tabIndex={isActive() ? 0 : -1}
              classList={{
                "fusou-tab": true,
                "fusou-tab-active": isActive(),
                "fusou-tab-inactive": !isActive(),
                "opacity-50 cursor-not-allowed": Boolean(props.disabled),
              }}
              onClick={() => {
                if (!props.disabled) {
                  props.onTabChange(tab.id);
                }
              }}
              disabled={props.disabled}
            >
              <span class="inline-flex items-center gap-1.5">
                <Show when={tab.icon}>{tab.icon}</Show>
                <span>{tab.label}</span>
                <Show when={tab.badge !== undefined && tab.badge !== null && tab.badge !== ""}>
                  <span class="ml-1 px-1.5 py-0.2 text-[11px] rounded-full bg-base-300 text-base-content/80 font-normal">
                    {tab.badge}
                  </span>
                </Show>
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

export default FusouTabs;
