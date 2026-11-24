import { For, Show, createMemo, createSignal } from "solid-js";
import { ComponentItemModal, EmptyValue, MenuFilterBar } from "ui";
import {
  useMaterials,
  useMstUseItemMetas,
  useMstUseItems,
  usePayItems,
  useSlotItems,
  useUseItems,
} from "../../utility/provider.tsx";
import type { ItemViewEntry } from "../../utility/item_shelves.ts";
import {
  buildOwnedItemNumbers,
  buildItemShelves,
  buildUseItemNameMap,
} from "../../utility/item_shelves.ts";
import {
  createConfigDisclosure,
  useUiConfig,
} from "../../utility/ui_config.ts";

export function ItemsComponent() {
  const uiConfig = useUiConfig();
  const [isItemsOpen, onToggleItems] = createConfigDisclosure(
    () => uiConfig.items.open_items,
  );
  const [isNormalOpen, onToggleNormal] = createConfigDisclosure(
    () => uiConfig.items.open_normal,
  );
  const [isSpecialOpen, onToggleSpecial] = createConfigDisclosure(
    () => uiConfig.items.open_special,
  );
  const [isPurchasedOpen, onTogglePurchased] = createConfigDisclosure(
    () => uiConfig.items.open_purchased,
  );
  const [isFurnitureOpen, onToggleFurniture] = createConfigDisclosure(
    () => uiConfig.items.open_furniture,
  );
  const [useItems] = useUseItems();
  const [payItems] = usePayItems();
  const [materials] = useMaterials();
  const [slotItems] = useSlotItems();
  const [mstUseItems] = useMstUseItems();
  const [mstUseItemMetas] = useMstUseItemMetas();
  const [query, setQuery] = createSignal("");

  const shelves = createMemo(() =>
    buildItemShelves({
      useItems,
      payItems,
      mstUseItems,
      mstUseItemMetas,
      materials,
      slotItems,
      furnitureCoin: materials.furniture_coin,
    }),
  );
  const itemNames = createMemo(() =>
    buildUseItemNameMap(mstUseItems, mstUseItemMetas),
  );
  const ownedUseItemIds = createMemo(() =>
    buildOwnedItemNumbers(
      useItems,
      materials,
      shelves().furniture.map((item) => item.id),
      slotItems,
    ),
  );

  const normalizedQuery = createMemo(() => query().trim().toLowerCase());

  const filterList = (items: ItemViewEntry[]): ItemViewEntry[] => {
    const q = normalizedQuery();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        String(item.id).includes(q),
    );
  };

  const normalItems = createMemo(() => filterList(shelves().normal));
  const specialItems = createMemo(() => filterList(shelves().special));
  const purchasedItems = createMemo(() => filterList(shelves().purchased));
  const furnitureItems = createMemo(() => filterList(shelves().furniture));
  const purchasedPayItems = createMemo(() =>
    shelves()
      .purchased.filter((item) => item.isPayItem)
      .map(({ id, name }) => ({ id, name })),
  );

  const rawTotalCount = createMemo(
    () =>
      shelves().normal.length +
      shelves().special.length +
      shelves().purchased.length +
      shelves().furniture.length,
  );

  const filteredTotalCount = createMemo(
    () =>
      normalItems().length +
      specialItems().length +
      purchasedItems().length +
      furnitureItems().length,
  );

  const hasLoaded = createMemo(
    () =>
      Object.keys(useItems.use_items).length > 0 ||
      Object.keys(payItems.pay_items).length > 0 ||
      Object.keys(materials.materials).length > 0 ||
      Object.keys(slotItems.slot_items).length > 0 ||
      Object.keys(mstUseItemMetas.mst_use_item_metas).length > 0 ||
      typeof materials.furniture_coin === "number",
  );

  const renderItemRow = (item: ItemViewEntry) => (
    <li class="text-xs py-1 w-full">
      <div class="px-2 flex items-start gap-2.5 w-full">
        <div class="shrink-0 pt-0.5">
          <ComponentItemModal
            item_number={item.iconNumber}
            name={item.name}
            description={item.description}
            descriptionIsNormalized={true}
            itemNames={itemNames()}
            payItemId={item.isPayItem ? item.id : undefined}
            additionalPurchasedPayItems={purchasedPayItems()}
            count={item.count}
            ownedUseItemIds={ownedUseItemIds()}
            size="xs"
          />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="truncate font-medium">{item.name}</span>
              <Show when={item.usable}>
                <span class="badge badge-xs badge-accent shrink-0">Usable</span>
              </Show>
              <Show when={item.isPayItem && item.price > 0}>
                <span class="badge badge-xs badge-ghost border-base-300 tabular-nums shrink-0">
                  {item.price} pt
                </span>
              </Show>
            </div>
            <span class="tabular-nums font-medium shrink-0 text-right w-14">
              x{item.count}
            </span>
          </div>
          <Show
            when={item.description.length > 0}
            fallback={<EmptyValue size="xs" align="left" />}
          >
            <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">
              {item.description}
            </div>
          </Show>
        </div>
      </div>
    </li>
  );

  const renderShelf = (
    title: string,
    items: () => ItemViewEntry[],
    visible: () => boolean,
    isOpen: () => boolean,
    onToggle: (e: Event & { currentTarget: HTMLDetailsElement }) => void,
  ) => (
    <Show when={visible()}>
      <li class="w-150 max-w-full min-w-0">
        <details open={isOpen()} onToggle={onToggle} class="min-w-0 w-full">
          <summary class="text-xs font-semibold text-base-content/80">
            {title} ({items().length})
          </summary>
          <ul class="pl-0">
            <For
              each={items()}
              fallback={
                <li class="text-xs px-4 py-1 text-base-content/50">
                  No items in this shelf
                </li>
              }
            >
              {(item) => renderItemRow(item)}
            </For>
          </ul>
        </details>
      </li>
    </Show>
  );

  return (
    <Show when={uiConfig.items.show_items}>
      <li class="w-full min-w-0">
        <details
          open={isItemsOpen()}
          onToggle={onToggleItems}
          class="min-w-0 w-full"
        >
          <summary>Items</summary>
          <ul class="pl-0 max-w-[960px]">
            <Show
              when={hasLoaded()}
              fallback={<li class="text-xs py-2">Loading Item Data ...</li>}
            >
              <MenuFilterBar
                value={query()}
                onInput={setQuery}
                placeholder="Filter items..."
                filteredCount={filteredTotalCount()}
                totalCount={rawTotalCount()}
              />

              {renderShelf(
                "Normal Items",
                normalItems,
                () => uiConfig.items.show_normal,
                isNormalOpen,
                onToggleNormal,
              )}
              {renderShelf(
                "Special Items",
                specialItems,
                () => uiConfig.items.show_special,
                isSpecialOpen,
                onToggleSpecial,
              )}
              {renderShelf(
                "Purchased Items",
                purchasedItems,
                () => uiConfig.items.show_purchased,
                isPurchasedOpen,
                onTogglePurchased,
              )}
              {renderShelf(
                "Furniture Store",
                furnitureItems,
                () => uiConfig.items.show_furniture,
                isFurnitureOpen,
                onToggleFurniture,
              )}
            </Show>
          </ul>
        </details>
      </li>
    </Show>
  );
}
