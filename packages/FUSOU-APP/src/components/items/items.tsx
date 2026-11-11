import { For, Show, createMemo, createSignal } from "solid-js";
import { EmptyValue, IconMaterial, MenuFilterBar } from "ui";
import {
  useMstUseItemMetas,
  useMstUseItems,
  usePayItems,
  useUseItems,
} from "../../utility/provider.tsx";
import type { ItemViewEntry } from "../../utility/item_shelves.ts";
import { buildItemShelves } from "../../utility/item_shelves.ts";

export function ItemsComponent() {
  const [useItems] = useUseItems();
  const [payItems] = usePayItems();
  const [mstUseItems] = useMstUseItems();
  const [mstUseItemMetas] = useMstUseItemMetas();
  const [query, setQuery] = createSignal("");

  const shelves = createMemo(() =>
    buildItemShelves({
      useItems,
      payItems,
      mstUseItems,
      mstUseItemMetas,
    }),
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

  const rawTotalCount = createMemo(
    () =>
      shelves().normal.length +
      shelves().special.length +
      shelves().purchased.length,
  );

  const filteredTotalCount = createMemo(
    () =>
      normalItems().length + specialItems().length + purchasedItems().length,
  );

  const hasLoaded = createMemo(
    () =>
      Object.keys(useItems.use_items).length > 0 ||
      Object.keys(payItems.pay_items).length > 0 ||
      Object.keys(mstUseItemMetas.mst_use_item_metas).length > 0,
  );

  const renderItemRow = (item: ItemViewEntry) => (
    <li class="text-xs py-1 w-full">
      <div class="px-2 flex items-start gap-2.5 w-full">
        <div class="shrink-0 pt-0.5">
          <IconMaterial item_number={item.iconNumber} size="xs" />
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

  const renderShelf = (title: string, items: () => ItemViewEntry[]) => (
    <li class="w-150 max-w-full min-w-0">
      <details open class="min-w-0 w-full">
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
  );

  return (
    <li class="w-full min-w-0">
      <details open class="min-w-0 w-full">
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

            {renderShelf("Normal Items", normalItems)}
            {renderShelf("Special Items", specialItems)}
            {renderShelf("Purchased Items", purchasedItems)}
          </Show>
        </ul>
      </details>
    </li>
  );
}
