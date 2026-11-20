/** @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { STYPE_NAMES } from "@/features/simulator/constants";
import { ItemPickerModal } from "../../../../../components/features/simulator/solid/item-picker-modal";
import {
  getStorybookPickerSelection,
  renderStorybookPickerRow,
  resetStorybookPickerSelection,
  STORYBOOK_SAMPLE_SHIPS,
  StorybookSimulatorModalPreview,
} from "../../../../storybook-fixtures";

const shipCategories = [
  ...new Set(
    STORYBOOK_SAMPLE_SHIPS.map(
      (ship) => STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`,
    ),
  ),
];

function StorybookItemPickerPreview() {
  const [category, setCategory] = createSignal("all");
  const [search, setSearch] = createSignal("");
  let dialog: HTMLDialogElement | null = null;

  const filteredShips = () => {
    const query = search().trim().toLocaleLowerCase();
    return STORYBOOK_SAMPLE_SHIPS.filter((ship) => {
      const shipCategory = STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`;
      const matchesCategory =
        category() === "all" || shipCategory === category();
      const matchesSearch =
        !query ||
        ship.name.toLocaleLowerCase().includes(query) ||
        String(ship.id).includes(query);
      return matchesCategory && matchesSearch;
    });
  };

  const flatItems = () => {
    const groups = new Map<string, typeof STORYBOOK_SAMPLE_SHIPS>();
    for (const ship of filteredShips()) {
      const shipCategory = STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`;
      const group = groups.get(shipCategory) ?? [];
      group.push(ship);
      groups.set(shipCategory, group);
    }

    return [...groups.entries()].flatMap(([key, ships]) => [
      { type: "header" as const, key },
      ...ships.map((ship) => ({ type: "ship" as const, data: ship })),
    ]);
  };

  const currentSummary = () => {
    const selectedId = getStorybookPickerSelection();
    const selectedShip = STORYBOOK_SAMPLE_SHIPS.find(
      (ship) => ship.id === selectedId,
    );
    return selectedShip
      ? `${selectedShip.name} (ID ${selectedShip.id})`
      : "選択なし";
  };

  return (
    <StorybookSimulatorModalPreview
      dialogId="storybook-item-picker"
      prepare={resetStorybookPickerSelection}
    >
      <ItemPickerModal
        id="storybook-item-picker"
        dialogRef={(element) => {
          dialog = element;
        }}
        title="艦娘選択"
        currentSummary={currentSummary()}
        category={category()}
        onCategoryChange={setCategory}
        categories={shipCategories}
        allOptionLabel="すべての艦種"
        searchId="storybook-ship-search-input"
        searchAriaLabel="艦を検索"
        searchPlaceholder="艦名またはIDで検索"
        searchValue={search()}
        onSearchInput={setSearch}
        flatItems={flatItems()}
        quickAccessItems={shipCategories.map((label) => ({
          key: label,
          label,
        }))}
        onClose={() => dialog?.close()}
        renderRow={renderStorybookPickerRow}
      />
    </StorybookSimulatorModalPreview>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/item-picker-modal",
  component: ItemPickerModal,
  tags: ["autodocs"],
};

export const Default = {
  render: () => <StorybookItemPickerPreview />,
};
