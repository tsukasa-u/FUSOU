/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import {
  SearchFilterBarBase,
  SuggestionGroup,
  SuggestionItemButton,
} from "@/components/common/solid/SearchFilterBarBase";
import type { BattleRecord, MstShipRecord } from "../../map-flow/solid/battle-map-flow/types";
import { battleResultOf } from "../../map-flow/solid/battle-map-flow/recordParsers";
import { alphaCellLabel } from "../../map-flow/solid/battle-map-flow/dataUtils";

export interface BattleSearchFilterBarProps {
  searchQuery: () => string;
  onSearchChange: (query: string) => void;
  activeFilterCount: number;
  onOpenFilterModal: () => void;
  class?: string | undefined;
  mapOptions?: () => string[];
  battleRecords?: () => BattleRecord[];
  mstShips?: () => MstShipRecord[];
}

const VICTORY_RANKS = [
  { rank: "S", label: "S勝利" },
  { rank: "A", label: "A勝利" },
  { rank: "B", label: "B勝利" },
  { rank: "C", label: "C敗北" },
  { rank: "D", label: "D敗北" },
];

/**
 * Single unified Search & Filter Bar component for Battle Data.
 * Integrates text search input with predictive candidates (maps, drop ships, cells, ranks)
 * using the shared SearchFilterBarBase layout.
 */
export function BattleSearchFilterBar(props: BattleSearchFilterBarProps): JSX.Element {
  const [isOpen, setIsOpen] = createSignal(false);
  let searchInputRef: HTMLInputElement | undefined;

  const query = () => props.searchQuery().trim().toLowerCase();

  // 1. Matched Maps
  const matchedMaps = createMemo(() => {
    const q = query();
    if (!q || !props.mapOptions) return [];
    return props.mapOptions().filter((m) => m.toLowerCase().includes(q)).slice(0, 5);
  });

  // 2. Matched Ships (Drop ships & Master ships)
  const matchedShips = createMemo(() => {
    const q = query();
    if (!q) return [];

    const mstShipMap = new Map<number, string>();
    if (props.mstShips) {
      for (const ship of props.mstShips()) {
        mstShipMap.set(ship.id, ship.name);
      }
    }

    const droppedShips = new Set<string>();
    if (props.battleRecords) {
      for (const b of props.battleRecords()) {
        const res = battleResultOf(b);
        if (res?.drop_ship_name) {
          droppedShips.add(res.drop_ship_name.trim());
        } else if (res?.drop_ship_id && mstShipMap.has(res.drop_ship_id)) {
          droppedShips.add(mstShipMap.get(res.drop_ship_id)!);
        }
      }
    }

    const items: Array<{ name: string; isDrop: boolean }> = [];
    const seen = new Set<string>();

    for (const name of droppedShips) {
      if (name.toLowerCase().includes(q)) {
        items.push({ name, isDrop: true });
        seen.add(name);
        if (items.length >= 5) break;
      }
    }

    if (items.length < 6 && props.mstShips) {
      for (const ship of props.mstShips()) {
        if (!seen.has(ship.name) && (ship.name.toLowerCase().includes(q) || String(ship.id) === q)) {
          items.push({ name: ship.name, isDrop: false });
          seen.add(ship.name);
          if (items.length >= 6) break;
        }
      }
    }

    return items;
  });

  // 3. Matched Cells
  const matchedCells = createMemo(() => {
    const q = query();
    if (!q || !props.battleRecords) return [];
    const rawQ = q.replace(/^マス\s*/, "").trim();
    const cells = new Set<string>();
    for (const b of props.battleRecords()) {
      const cellId = Number(b.cell_id ?? NaN);
      if (!Number.isFinite(cellId) || cellId <= 0) continue;
      const label = alphaCellLabel(cellId);
      if (
        label.toLowerCase().includes(rawQ) ||
        `マス ${label}`.toLowerCase().includes(q) ||
        `マス${label}`.toLowerCase().includes(q)
      ) {
        cells.add(label);
        if (cells.size >= 6) break;
      }
    }
    return Array.from(cells).sort();
  });

  // 4. Matched Ranks
  const matchedRanks = createMemo(() => {
    const q = query();
    if (!q) return [];
    return VICTORY_RANKS.filter(
      (r) =>
        r.rank.toLowerCase() === q ||
        r.label.toLowerCase().includes(q) ||
        `${r.rank}勝利`.toLowerCase().includes(q),
    );
  });

  const hasAnySuggestions = () =>
    matchedMaps().length > 0 ||
    matchedShips().length > 0 ||
    matchedCells().length > 0 ||
    matchedRanks().length > 0;

  const handleSelectSuggestion = (val: string) => {
    props.onSearchChange(val);
    setIsOpen(false);
    searchInputRef?.focus();
  };

  return (
    <SearchFilterBarBase
      searchQuery={props.searchQuery}
      onSearchChange={props.onSearchChange}
      placeholder="検索 (海域・艦名・マス)..."
      ariaLabel="戦闘データ検索"
      activeFilterCount={props.activeFilterCount}
      onOpenFilterModal={props.onOpenFilterModal}
      filterButtonId="battle-filter-settings-btn"
      filterButtonTitle="フィルター設定 (期間・日付・海域・勝敗)"
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      class={props.class}
      inputRef={(el) => {
        searchInputRef = el;
      }}
    >
      <Show when={!hasAnySuggestions()}>
        <div class="py-4 text-center text-xs text-base-content/50">
          該当する候補が見つかりません
        </div>
      </Show>

      {/* 1. Maps Category */}
      <Show when={matchedMaps().length > 0}>
        <SuggestionGroup title="海域" count={matchedMaps().length}>
          <For each={matchedMaps()}>
            {(map) => (
              <SuggestionItemButton
                title={map}
                badge="海域"
                onClick={() => handleSelectSuggestion(map)}
              />
            )}
          </For>
        </SuggestionGroup>
      </Show>

      {/* 2. Ships Category */}
      <Show when={matchedShips().length > 0}>
        <SuggestionGroup
          title="ドロップ艦・艦名"
          count={matchedShips().length}
          hasTopBorder={matchedMaps().length > 0}
        >
          <For each={matchedShips()}>
            {(item) => (
              <SuggestionItemButton
                title={item.name}
                badge={item.isDrop ? "ドロップ艦" : "艦"}
                badgeClass={item.isDrop ? "badge-primary" : "badge-ghost"}
                onClick={() => handleSelectSuggestion(item.name)}
              />
            )}
          </For>
        </SuggestionGroup>
      </Show>

      {/* 3. Cells Category */}
      <Show when={matchedCells().length > 0}>
        <SuggestionGroup
          title="マス"
          count={matchedCells().length}
          hasTopBorder={matchedMaps().length > 0 || matchedShips().length > 0}
        >
          <For each={matchedCells()}>
            {(cell) => (
              <SuggestionItemButton
                title={`マス: ${cell}`}
                badge="マス"
                onClick={() => handleSelectSuggestion(cell)}
              />
            )}
          </For>
        </SuggestionGroup>
      </Show>

      {/* 4. Ranks Category */}
      <Show when={matchedRanks().length > 0}>
        <SuggestionGroup
          title="勝敗結果"
          count={matchedRanks().length}
          hasTopBorder={
            matchedMaps().length > 0 ||
            matchedShips().length > 0 ||
            matchedCells().length > 0
          }
        >
          <For each={matchedRanks()}>
            {(r) => (
              <SuggestionItemButton
                title={r.label}
                badge="勝敗"
                onClick={() => handleSelectSuggestion(r.rank)}
              />
            )}
          </For>
        </SuggestionGroup>
      </Show>
    </SearchFilterBarBase>
  );
}

export default BattleSearchFilterBar;
