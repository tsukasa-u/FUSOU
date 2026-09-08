/** @jsxImportSource solid-js */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
} from "solid-js";
import { VList, type VListHandle } from "virtua/solid";
import { STYPE_NAMES, STYPE_SHORT } from "@/features/simulator/constants";
import { groupBy } from "@/features/simulator/display-utils";
import { bannerUrl } from "@/features/simulator/equip-calc";
import { ShipListRow, type ShipListItem } from "@/components/common/solid/ship-list-row";
import { ShipBanner } from "@/components/common/solid/ShipBanner";
import { PickerQuickAccess } from "@/components/features/simulator/solid/picker-quick-access";
import { ItemPickerModal, type FlatPickerItem } from "@/components/features/simulator/solid/item-picker-modal";

export type FlatShipPickerItem =
  | { type: "header"; key: string }
  | { type: "ship"; data: ShipListItem };

export interface ShipCatalogPickerProps {
  /** 艦船リスト */
  ships: ShipListItem[];
  /** 現在選択中の艦ID */
  selectedShipId: number | null;
  /** 艦が選択された際のコールバック */
  onSelectShip: (shipId: number) => void;
  /** 読み込み中フラグ */
  loading?: boolean;
  /** モバイル時のピッカートリガーの表示モード ("sticky" | "floating")、デフォルト "sticky" */
  mobileDisplayMode?: "sticky" | "floating";
  /** コンポーネント内部の要素 ID prefix（デフォルト "ship"） */
  idPrefix?: string;
  /** デスクトップ検索入力の ID */
  desktopSearchId?: string;
  /** モバイル検索入力の ID */
  mobileSearchId?: string;
  /** メインコンテンツ（右カラム / モバイル下部） */
  children: JSX.Element;
  /** メインコンテンツコンテナのクラス（デフォルト "min-w-0 space-y-4"） */
  contentClass?: string;
  /** ShipListRow にステータスラベルを表示するか（デフォルト false） */
  showStatLabels?: boolean;
  /** ShipListRow にステータス数値を表示するか（デフォルト false） */
  showStats?: boolean;
}

export function ShipCatalogPicker(props: ShipCatalogPickerProps): JSX.Element {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [selectedCategory, setSelectedCategory] = createSignal("all");
  const [pickerModalOpen, setPickerModalOpen] = createSignal(false);
  const [desktopActiveQuickAccessId, setDesktopActiveQuickAccessId] =
    createSignal<string | null>(null);

  let shipVListRef: VListHandle | undefined;
  let dialogRef: HTMLDialogElement | undefined;

  const idPrefix = () => props.idPrefix ?? "ship";
  const displayMode = () => props.mobileDisplayMode ?? "sticky";

  createEffect(() => {
    if (pickerModalOpen()) {
      dialogRef?.showModal();
    } else {
      dialogRef?.close();
    }
  });

  const selectedShip = createMemo(() => {
    const id = props.selectedShipId;
    if (id == null) return null;
    return props.ships.find((ship) => ship.id === id) ?? null;
  });

  const selectedShipSummary = createMemo(() => {
    const ship = selectedShip();
    return ship ? ship.name : "艦を選択";
  });

  const shipCategories = createMemo(() => {
    const set = new Set<string>();
    for (const ship of props.ships) {
      set.add(
        ship.stype != null
          ? (STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`)
          : "その他",
      );
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  });

  const filteredShips = createMemo(() => {
    const cat = selectedCategory();
    const q = searchQuery().trim().toLowerCase();
    return props.ships.filter((ship) => {
      const category =
        ship.stype != null
          ? (STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`)
          : "その他";
      if (cat !== "all" && category !== cat) return false;
      if (!q) return true;
      return (
        ship.name.toLowerCase().includes(q) || String(ship.id).includes(q)
      );
    });
  });

  const groupedShips = createMemo(() => {
    return groupBy(
      filteredShips(),
      (ship) =>
        ship.stype != null
          ? (STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`)
          : "その他",
    ).sort((a, b) => {
      const aStype = a.items[0]?.stype ?? 0;
      const bStype = b.items[0]?.stype ?? 0;
      if (aStype !== bStype) return aStype - bStype;
      return a.key.localeCompare(b.key, "ja");
    });
  });

  const quickAccessItems = createMemo(() => {
    return groupedShips().map((group) => {
      const stype = group.items[0]?.stype ?? 0;
      return {
        key: group.key,
        label: STYPE_SHORT[stype] ?? group.key,
      };
    });
  });

  const flatShips = createMemo((): FlatShipPickerItem[] => {
    const flat: FlatShipPickerItem[] = [];
    for (const group of groupedShips()) {
      flat.push({ type: "header", key: group.key });
      for (const ship of group.items) {
        flat.push({ type: "ship", data: ship });
      }
    }
    return flat;
  });

  const scrollDesktopToCategory = (categoryKey: string) => {
    const targetIndex = flatShips().findIndex(
      (item) => item.type === "header" && item.key === categoryKey,
    );
    if (targetIndex >= 0 && shipVListRef) {
      setDesktopActiveQuickAccessId(categoryKey);
      shipVListRef.scrollToIndex(targetIndex, { align: "start" });
    }
  };

  const updateDesktopQuickAccessByScroll = () => {
    const entries = quickAccessItems();
    if (entries.length === 0) {
      setDesktopActiveQuickAccessId(null);
      return;
    }
    if (!shipVListRef || typeof shipVListRef.findStartIndex !== "function") {
      setDesktopActiveQuickAccessId(entries[0]?.key ?? null);
      return;
    }

    const startIdx = Number(shipVListRef.findStartIndex() ?? 0);
    let activeKey: string | null = null;
    const shipRows = flatShips();
    for (let i = Math.min(startIdx, shipRows.length - 1); i >= 0; i--) {
      const item = shipRows[i];
      if (item?.type === "header") {
        activeKey = item.key;
        break;
      }
    }
    if (!activeKey) {
      const fallback = shipRows.find((item) => item.type === "header");
      activeKey =
        fallback && fallback.type === "header"
          ? fallback.key
          : (entries[0]?.key ?? null);
    }
    setDesktopActiveQuickAccessId(activeKey ?? null);
  };

  createEffect(() => {
    flatShips();
    quickAccessItems();
    requestAnimationFrame(() => updateDesktopQuickAccessByScroll());
  });

  let hasScrolledInitialShip = false;
  createEffect(() => {
    const id = props.selectedShipId;
    if (id != null && shipVListRef && !hasScrolledInitialShip) {
      const idx = flatShips().findIndex(
        (r) => r.type === "ship" && r.data.id === id,
      );
      if (idx >= 0) {
        hasScrolledInitialShip = true;
        shipVListRef.scrollToIndex(idx, { align: "center" });
      }
    }
  });

  return (
    <section class="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4 items-start">
      {/* 1. デスクトップ Sticky Aside */}
      <aside class="hidden xl:flex rounded-xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden flex-col xl:sticky xl:top-20 xl:h-[calc(100vh-5.5rem)]">
        <div class="p-3 border-b border-base-200 bg-base-50/50 space-y-2">
          <select
            class="select select-bordered select-sm w-full"
            aria-label="艦種フィルター"
            value={selectedCategory()}
            onChange={(event) =>
              setSelectedCategory(event.currentTarget.value)
            }
          >
            <option value="all">すべての艦種</option>
            <For each={shipCategories()}>
              {(category) => <option value={category}>{category}</option>}
            </For>
          </select>
          <input
            id={props.desktopSearchId ?? `${idPrefix()}-search-input`}
            class="input input-bordered input-sm w-full"
            aria-label="艦名検索"
            placeholder="艦名 / ID で検索"
            value={searchQuery()}
            onInput={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </div>
        <div class="flex flex-1 min-h-0 overflow-hidden">
          <PickerQuickAccess
            entries={quickAccessItems().map((entry) => ({
              id: entry.key,
              label: entry.label,
              onSelect: () => scrollDesktopToCategory(entry.key),
            }))}
            widthClass="w-28"
            activeId={desktopActiveQuickAccessId()}
          />
          <div class="p-2 flex-1 min-h-0">
            <Show when={props.loading}>
              <div class="py-8 text-center text-base-content/60">
                <span class="loading loading-spinner loading-sm" />
              </div>
            </Show>
            <Show when={!props.loading}>
              <VList
                ref={(el) => {
                  shipVListRef = el;
                }}
                data={flatShips()}
                class="h-full overflow-y-auto overflow-x-hidden"
                onScroll={() => updateDesktopQuickAccessByScroll()}
              >
                {(item: FlatShipPickerItem) =>
                  item.type === "header" ? (
                    <div class="mb-2 mt-1 first:mt-0">
                      <h4 class="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-base-content/45 uppercase bg-base-100/95 backdrop-blur-sm z-10">
                        {item.key}
                      </h4>
                    </div>
                  ) : (
                    <div class="mb-0.5">
                      <ShipListRow
                        ship={item.data}
                        active={props.selectedShipId === item.data.id}
                        showStatLabels={props.showStatLabels ?? false}
                        showStats={props.showStats ?? false}
                        onSelect={() => props.onSelectShip(item.data.id)}
                      />
                    </div>
                  )
                }
              </VList>
            </Show>
          </div>
        </div>
      </aside>

      {/* 2. メインコンテンツ + モバイル Sticky トリガー */}
      <div class={props.contentClass ?? "min-w-0 space-y-4"}>
        <div
          class={
            displayMode() === "sticky"
              ? "sticky top-20 z-30 xl:hidden"
              : "fixed bottom-4 left-4 z-40 xl:hidden max-w-[calc(100vw-2rem)]"
          }
        >
          <button
            id={`${idPrefix()}-mobile-picker-btn`}
            class={
              displayMode() === "sticky"
                ? "btn btn-sm btn-outline border-base-300 bg-base-100/95 text-base-content w-full justify-start gap-2 shadow-sm backdrop-blur"
                : "btn btn-sm btn-outline border-base-300 bg-base-100/95 text-base-content justify-start gap-2 shadow-md backdrop-blur"
            }
            type="button"
            onClick={() => setPickerModalOpen(true)}
          >
            <Show
              when={selectedShip()}
              fallback={
                <span class="inline-flex w-16 h-6 items-center justify-center rounded bg-base-200/70 text-[11px] text-base-content/55">
                  No Image
                </span>
              }
            >
              {(ship) => (
                <ShipBanner
                  src={bannerUrl(ship().id, { f: "auto" })}
                  alt={ship().name}
                  class="w-16 h-6 rounded shrink-0"
                />
              )}
            </Show>
            <span class="truncate max-w-[42vw]">{selectedShipSummary()}</span>
            <span
              class="ml-auto shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-primary/15 text-primary"
              aria-hidden="true"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                class="w-3.5 h-3.5"
              >
                <path
                  fill-rule="evenodd"
                  d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                  clip-rule="evenodd"
                />
              </svg>
            </span>
          </button>
        </div>

        {props.children}
      </div>

      {/* 3. モバイル選択モーダル */}
      <ItemPickerModal
        id={`${idPrefix()}-mobile-picker-dialog`}
        dialogRef={(el) => {
          dialogRef = el;
        }}
        title="艦選択"
        currentSummary={selectedShipSummary()}
        category={selectedCategory()}
        onCategoryChange={setSelectedCategory}
        categories={shipCategories()}
        allOptionLabel="すべての艦種"
        searchId={props.mobileSearchId ?? `${idPrefix()}-search-input-mobile`}
        searchAriaLabel="艦名検索"
        searchPlaceholder="艦名 / ID で検索"
        searchValue={searchQuery()}
        onSearchInput={setSearchQuery}
        flatItems={flatShips() as FlatPickerItem<ShipListItem>[]}
        quickAccessItems={quickAccessItems()}
        onClose={() => setPickerModalOpen(false)}
        renderRow={(ship) => (
          <ShipListRow
            ship={ship}
            active={props.selectedShipId === ship.id}
            showStatLabels={props.showStatLabels ?? false}
            showStats={props.showStats ?? false}
            onSelect={() => {
              props.onSelectShip(ship.id);
              setPickerModalOpen(false);
            }}
          />
        )}
      />
    </section>
  );
}
