/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import {
  SearchFilterBarBase,
  SuggestionGroup,
  SuggestionItemButton,
} from "@/components/common/solid/SearchFilterBarBase";
import { STYPE_NAMES } from "@/features/simulator/constants";

export type ShipGrowthSearchItem = {
  id: number;
  name: string;
  stype: number | null;
};

export interface ShipGrowthSearchFilterBarProps {
  searchQuery: () => string;
  onSearchChange: (query: string) => void;
  activeFilterCount: number;
  onOpenFilterModal: () => void;
  class?: string | undefined;
  ships?: () => ShipGrowthSearchItem[];
  onSelectShip?: (shipId: number) => void;
}

export function ShipGrowthSearchFilterBar(props: ShipGrowthSearchFilterBarProps): JSX.Element {
  const [isOpen, setIsOpen] = createSignal(false);
  let searchInputRef: HTMLInputElement | undefined;

  const query = () => props.searchQuery().trim().toLowerCase();

  const matchedShips = createMemo(() => {
    const q = query();
    if (!q || !props.ships) return [];
    const ships = props.ships();
    const result: ShipGrowthSearchItem[] = [];
    for (const ship of ships) {
      if (
        ship.name.toLowerCase().includes(q) ||
        String(ship.id).includes(q) ||
        (ship.stype != null && (STYPE_NAMES[ship.stype] ?? "").toLowerCase().includes(q))
      ) {
        result.push(ship);
        if (result.length >= 8) break;
      }
    }
    return result;
  });

  const handleSelectShip = (ship: ShipGrowthSearchItem) => {
    if (props.onSelectShip) {
      props.onSelectShip(ship.id);
    }
    props.onSearchChange(ship.name);
    setIsOpen(false);
    searchInputRef?.focus();
  };

  return (
    <SearchFilterBarBase
      searchQuery={props.searchQuery}
      onSearchChange={props.onSearchChange}
      placeholder="検索 (艦名・ID)..."
      ariaLabel="艦名またはIDで検索"
      activeFilterCount={props.activeFilterCount}
      onOpenFilterModal={props.onOpenFilterModal}
      filterButtonId="ship-growth-filter-btn"
      filterButtonTitle="フィルター設定 (期間・艦種)"
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      class={props.class}
      inputRef={(el) => {
        searchInputRef = el;
      }}
    >
      <Show when={matchedShips().length === 0}>
        <div class="py-6 text-center text-xs text-base-content/50">
          該当する艦が見つかりません
        </div>
      </Show>

      <Show when={matchedShips().length > 0}>
        <SuggestionGroup title="艦候補" count={matchedShips().length}>
          <For each={matchedShips()}>
            {(ship) => (
              <SuggestionItemButton
                title={ship.name}
                badge={
                  ship.stype != null
                    ? STYPE_NAMES[ship.stype] ?? `Type ${ship.stype}`
                    : undefined
                }
                meta={`ID: ${ship.id}`}
                onClick={() => handleSelectShip(ship)}
              />
            )}
          </For>
        </SuggestionGroup>
      </Show>
    </SearchFilterBarBase>
  );
}

export default ShipGrowthSearchFilterBar;
