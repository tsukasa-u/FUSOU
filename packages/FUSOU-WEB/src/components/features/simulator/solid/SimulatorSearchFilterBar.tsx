/** @jsxImportSource solid-js */
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
  createEffect,
} from "solid-js";
import {
  SearchFilterBarBase,
  SuggestionGroup,
} from "@/components/common/solid/SearchFilterBarBase";
import {
  getMasterShips,
  getMasterSlotItems,
} from "@/features/simulator/simulator-selectors";
import { useStore } from "@nanostores/solid";
import { workspaceStore } from "@/features/simulator/viewer-workspace";
import { STYPE_NAMES } from "@/features/simulator/constants";
import { equipDisplayTypeName } from "@/features/simulator/display-utils";
import type { SimulatorFilterSettings } from "./SimulatorFilterModal";
import { simulatorSearchQuery } from "@/features/simulator/state";

export interface SimulatorSearchFilterBarProps {
  settings: () => SimulatorFilterSettings;
  onOpenFilterModal: () => void;
  onSelectShip: (shipId: number) => void;
  onSelectEquip: (equipId: number) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  activeTab?: () => string;
  class?: string | undefined;
}

export function SimulatorSearchFilterBar(props: SimulatorSearchFilterBarProps): JSX.Element {
  const [query, setQuery] = createSignal(simulatorSearchQuery.get());
  const [isOpen, setIsOpen] = createSignal(false);
  const workspaces = useStore(workspaceStore);
  let searchInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    simulatorSearchQuery.set(query());
  });

  onMount(() => {
    const unsub = simulatorSearchQuery.subscribe((val) => {
      if (val !== query()) setQuery(val);
    });
    onCleanup(unsub);
  });

  // Calculate active filter count
  const activeFilterCount = createMemo(() => {
    const s = props.settings();
    let count = 0;
    if (!s.includeShips) count++;
    if (!s.includeEquips) count++;
    if (!s.includeWorkspaces) count++;
    if (s.selectedStypes.length > 0) count++;
    return count;
  });

  // Search matches
  const matchedShips = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q || !props.settings().includeShips) return [];
    const all = Object.values(getMasterShips());
    return all.filter((s) => {
      if (!s || !s.name) return false;
      if (s.name.toLowerCase().includes(q)) return true;
      if (String(s.id).includes(q)) return true;
      return false;
    });
  });

  const matchedEquips = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q || !props.settings().includeEquips) return [];
    const all = Object.values(getMasterSlotItems());
    return all.filter((e) => {
      if (!e || !e.name) return false;
      if (e.name.toLowerCase().includes(q)) return true;
      if (String(e.id).includes(q)) return true;
      return false;
    });
  });

  const matchedWorkspaces = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q || !props.settings().includeWorkspaces) return [];
    const list = Object.values(workspaces());
    return list.filter((ws) => {
      if (!ws) return false;
      if (ws.name && ws.name.toLowerCase().includes(q)) return true;
      if (ws.memo && ws.memo.toLowerCase().includes(q)) return true;
      return false;
    });
  });

  const hasAnyResults = () =>
    matchedShips().length > 0 ||
    matchedEquips().length > 0 ||
    matchedWorkspaces().length > 0;

  const handleSelectShip = (id: number) => {
    props.onSelectShip(id);
    setIsOpen(false);
  };

  const handleSelectEquip = (id: number) => {
    props.onSelectEquip(id);
    setIsOpen(false);
  };

  const handleSelectWorkspace = (id: string) => {
    props.onSelectWorkspace(id);
    setIsOpen(false);
  };

  return (
    <SearchFilterBarBase
      searchQuery={query}
      onSearchChange={setQuery}
      placeholder="検索 (艦・装備・保存編成)..."
      ariaLabel="シミュレータ横断検索・フィルター"
      activeFilterCount={activeFilterCount()}
      onOpenFilterModal={props.onOpenFilterModal}
      filterButtonId="sim-header-filter-btn"
      filterButtonTitle="横断検索フィルター設定"
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      class={props.class}
      inputRef={(el) => {
        searchInputRef = el;
      }}
    >
      <Show when={props.activeTab?.() === "ship"}>
        <div class="px-2.5 py-1.5 bg-primary/10 border border-primary/20 rounded-lg text-xs text-primary font-medium flex items-center justify-between">
          <span>艦詳細の装備可能・シナジーを絞り込み中</span>
          <span class="text-[10px] text-primary/70 font-mono">「{query()}」</span>
        </div>
      </Show>
      <Show when={props.activeTab?.() === "equip"}>
        <div class="px-2.5 py-1.5 bg-primary/10 border border-primary/20 rounded-lg text-xs text-primary font-medium flex items-center justify-between">
          <span>装備詳細の対象艦を絞り込み中</span>
          <span class="text-[10px] text-primary/70 font-mono">「{query()}」</span>
        </div>
      </Show>

      <Show when={!hasAnyResults()}>
        <div class="py-6 text-center text-xs text-base-content/50">
          該当するデータが見つかりません
        </div>
      </Show>

      {/* Ships Category */}
      <Show when={matchedShips().length > 0}>
        <SuggestionGroup
          title="艦"
          count={matchedShips().length}
          hint="クリックで詳細を表示"
        >
          <For each={matchedShips().slice(0, 5)}>
            {(ship) => (
              <button
                type="button"
                class="w-full text-left px-2 py-1.5 rounded-lg hover:bg-base-200 flex items-center justify-between gap-2 group transition-colors cursor-pointer"
                onClick={() => handleSelectShip(ship.id)}
              >
                <div class="min-w-0 flex items-center gap-2">
                  <span class="font-medium text-xs text-base-content/90 group-hover:text-primary truncate">
                    {ship.name}
                  </span>
                  <span class="badge badge-ghost badge-xs shrink-0 text-[10px]">
                    {STYPE_NAMES[ship.stype] ?? `Type ${ship.stype}`}
                  </span>
                </div>
                <span class="text-[10px] font-mono text-base-content/40 shrink-0">
                  ID: {ship.id}
                </span>
              </button>
            )}
          </For>
        </SuggestionGroup>
      </Show>

      {/* Equips Category */}
      <Show when={matchedEquips().length > 0}>
        <SuggestionGroup
          title="装備"
          count={matchedEquips().length}
          hint="クリックで詳細を表示"
          hasTopBorder={matchedShips().length > 0}
        >
          <For each={matchedEquips().slice(0, 5)}>
            {(equip) => (
              <button
                type="button"
                class="w-full text-left px-2 py-1.5 rounded-lg hover:bg-base-200 flex items-center justify-between gap-2 group transition-colors cursor-pointer"
                onClick={() => handleSelectEquip(equip.id)}
              >
                <div class="min-w-0 flex items-center gap-2">
                  <span class="font-medium text-xs text-base-content/90 group-hover:text-primary truncate">
                    {equip.name}
                  </span>
                  <Show when={equipDisplayTypeName(equip)}>
                    {(typeName) => (
                      <span class="badge badge-ghost badge-xs shrink-0 text-[10px]">
                        {typeName()}
                      </span>
                    )}
                  </Show>
                </div>
                <span class="text-[10px] font-mono text-base-content/40 shrink-0">
                  ID: {equip.id}
                </span>
              </button>
            )}
          </For>
        </SuggestionGroup>
      </Show>

      {/* Workspaces Category */}
      <Show when={matchedWorkspaces().length > 0}>
        <SuggestionGroup
          title="保存編成"
          count={matchedWorkspaces().length}
          hint="クリックで開く"
          hasTopBorder={matchedShips().length > 0 || matchedEquips().length > 0}
        >
          <For each={matchedWorkspaces().slice(0, 5)}>
            {(ws) => (
              <button
                type="button"
                class="w-full text-left px-2 py-1.5 rounded-lg hover:bg-base-200 flex items-center justify-between gap-2 group transition-colors cursor-pointer"
                onClick={() => handleSelectWorkspace(ws.id)}
              >
                <div class="min-w-0">
                  <div class="font-medium text-xs text-base-content/90 group-hover:text-primary truncate">
                    {ws.name || "名称未設定"}
                  </div>
                  <Show when={ws.memo}>
                    <div class="text-[10px] text-base-content/50 truncate">
                      {ws.memo}
                    </div>
                  </Show>
                </div>
                <span class="badge badge-ghost badge-xs shrink-0 text-[10px]">
                  編成
                </span>
              </button>
            )}
          </For>
        </SuggestionGroup>
      </Show>
    </SearchFilterBarBase>
  );
}

export default SimulatorSearchFilterBar;
