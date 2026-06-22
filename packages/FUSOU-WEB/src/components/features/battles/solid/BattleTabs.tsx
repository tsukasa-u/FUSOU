/** @jsxImportSource solid-js */
import { For } from "solid-js";

type TabId = "list" | "detail" | "map-flow" | "stats" | "drops";

type Props = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  disabled?: boolean;
};

export default function BattleTabs(props: Props) {
  const tabs: { id: TabId; label: string }[] = [
    { id: "list", label: "一覧" },
    { id: "detail", label: "詳細" },
    { id: "map-flow", label: "マップ進行" },
    { id: "stats", label: "統計" },
    { id: "drops", label: "ドロップ" },
  ];

  return (
    <>
      <style>
        {`
          .hide-scroll::-webkit-scrollbar {
            display: none;
          }
        `}
      </style>
      <div
        class="flex gap-1 mb-5 border-b border-base-300/60 overflow-x-auto hide-scroll"
        style={{ "scrollbar-width": "none", "-ms-overflow-style": "none" }}
      >
        <For each={tabs}>
        {(tab) => {
          const isActive = props.activeTab === tab.id;
          return (
            <button
              classList={{
                "px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap": true,
                "border-primary text-primary": props.activeTab === tab.id,
                "border-transparent text-base-content/60 hover:text-base-content hover:border-base-300": props.activeTab !== tab.id,
              }}
              onClick={() => {
                if (!props.disabled) {
                  props.onTabChange(tab.id);
                }
              }}
              disabled={props.disabled}
            >
              {tab.label}
            </button>
          );
        }}
      </For>
    </div>
    </>
  );
}
