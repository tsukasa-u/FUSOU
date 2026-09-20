/** @jsxImportSource solid-js */
import { FusouTabs, type TabItem } from "@/components/common/solid/FusouTabs";

export type TabId = "list" | "detail" | "map-flow" | "stats" | "drops";

type Props = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  disabled?: boolean | undefined;
  class?: string | undefined;
};

const BATTLE_TABS: readonly TabItem<TabId>[] = [
  { id: "list", label: "一覧" },
  { id: "detail", label: "詳細" },
  { id: "map-flow", label: "マップ進行" },
  { id: "stats", label: "統計" },
  { id: "drops", label: "ドロップ" },
] as const;

export default function BattleTabs(props: Props) {
  return (
    <FusouTabs<TabId>
      tabs={BATTLE_TABS}
      activeTab={props.activeTab}
      onTabChange={props.onTabChange}
      disabled={props.disabled}
      class={props.class}
      tabIdPrefix="battle-tab"
      ariaLabel="戦闘データカテゴリ切り替え"
    />
  );
}