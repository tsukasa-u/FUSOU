import type { Materials } from "@ipc-bindings/port";
import type { MstUseItemMetas, MstUseItems } from "@ipc-bindings/get_data";
import type { PayItems, SlotItems, UseItems } from "@ipc-bindings/require_info";
import {
  item_list,
  material_icon_name_by_number,
  material_icon_number_by_index,
} from "../components/ui/icons/material_data";

export type ItemShelfKind = "normal" | "special" | "purchased" | "furniture";

export type ItemViewEntry = {
  key: string;
  id: number;
  shelf: ItemShelfKind;
  iconNumber: number;
  name: string;
  description: string;
  count: number;
  usable: boolean;
  price: number;
  category: number;
  usetype: number;
  isPayItem: boolean;
};

export type ItemShelvesData = {
  normal: ItemViewEntry[];
  special: ItemViewEntry[];
  purchased: ItemViewEntry[];
  furniture: ItemViewEntry[];
};

const RESOURCE_MATERIAL_IDS = new Set([31, 32, 33, 34]);
const OWNED_MATERIAL_ITEM_IDS = new Set([1, 2, 3, 4]);
const PURCHASED_USEITEM_IDS = new Set([53]);
const FURNITURE_COIN_USEITEM_ID = 44;
const FURNITURE_STORE_USEITEM_IDS = new Set([FURNITURE_COIN_USEITEM_ID]);
const SLOTITEM_BACKED_USEITEMS: Readonly<Record<number, number>> = {
  50: 42,
  51: 43,
  66: 145,
  67: 146,
  69: 150,
  76: 241,
};

const ITEM_NOTE_LINE_PREFIX = /^(?:※|[(\uFF08]\s*(?:※|発動)|[・-]\s)/u;

function joinWrappedItemSegment(prev: string, next: string): string {
  // Keep a single word space when KanColle master data wraps ASCII words across <br>.
  if (/[A-Za-z0-9]$/u.test(prev) && /^[A-Za-z0-9]/u.test(next)) {
    return `${prev} ${next}`;
  }
  return `${prev}${next}`;
}

export function normalizeItemDescription(raw: string): string {
  const segments = raw
    .split(/<br\s*\/?>|\r?\n/gi)
    .map((part) => part.replace(/^[\s\u3000]+|[\s\u3000]+$/gu, ""))
    .filter((part) => part.length > 0);

  if (segments.length === 0) return "";

  const lines: string[] = [];
  for (const segment of segments) {
    if (lines.length === 0 || ITEM_NOTE_LINE_PREFIX.test(segment)) {
      lines.push(segment);
    } else {
      const lastIndex = lines.length - 1;
      lines[lastIndex] = joinWrappedItemSegment(lines[lastIndex], segment);
    }
  }

  return lines.join("\n");
}

function joinUseItemDescription(lines: readonly string[] | undefined): string {
  if (!lines || lines.length === 0) return "";
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const line of lines) {
    const normalized = normalizeItemDescription(line);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    parts.push(normalized);
  }
  return parts.join("\n");
}

function resolveUseItemIconNumber(useItemId: number): number {
  return item_list[useItemId] ? useItemId : 0;
}

function resolvePayItemIconNumber(
  name: string,
  mstUseItemMetas: MstUseItemMetas,
  mstUseItems: MstUseItems,
): number {
  const trimmed = name.trim();
  if (trimmed) {
    for (const meta of Object.values(mstUseItemMetas.mst_use_item_metas)) {
      if (meta && meta.name.trim() === trimmed && item_list[meta.id]) {
        return meta.id;
      }
    }
    for (const mst of Object.values(mstUseItems.mst_use_items)) {
      if (mst && mst.name.trim() === trimmed && item_list[mst.id]) {
        return mst.id;
      }
    }
  }

  return 0;
}

function getSlotItemBackedUseItemCounts(
  slotItems?: SlotItems,
): Map<number, number> {
  if (!slotItems) return new Map();

  const slotItemCounts = new Map<number, number>();
  for (const slotItem of Object.values(slotItems.slot_items)) {
    if (!slotItem) continue;
    slotItemCounts.set(
      slotItem.slotitem_id,
      (slotItemCounts.get(slotItem.slotitem_id) ?? 0) + 1,
    );
  }

  const useItemCounts = new Map<number, number>();
  for (const [useItemId, slotItemId] of Object.entries(
    SLOTITEM_BACKED_USEITEMS,
  )) {
    useItemCounts.set(Number(useItemId), slotItemCounts.get(slotItemId) ?? 0);
  }
  return useItemCounts;
}

export function classifyUseItemShelf(useItemId: number): ItemShelfKind {
  if (PURCHASED_USEITEM_IDS.has(useItemId)) return "purchased";
  if (FURNITURE_STORE_USEITEM_IDS.has(useItemId)) return "furniture";
  const tableId = item_list[useItemId]?.[1];
  return tableId === 2 || tableId === 6 ? "special" : "normal";
}

export type BuildItemShelvesInput = {
  useItems: UseItems;
  payItems: PayItems;
  mstUseItems: MstUseItems;
  mstUseItemMetas: MstUseItemMetas;
  materials?: Materials;
  slotItems?: SlotItems;
  furnitureCoin?: number | null;
};

export function buildUseItemNameMap(
  mstUseItems: MstUseItems,
  mstUseItemMetas: MstUseItemMetas,
): Record<number, string> {
  const names: Record<number, string> = {};

  for (const meta of Object.values(mstUseItemMetas.mst_use_item_metas)) {
    if (!meta) continue;
    const name = (
      meta.name ||
      mstUseItems.mst_use_items[meta.id]?.name ||
      ""
    ).trim();
    if (name) names[meta.id] = name;
  }

  for (const item of Object.values(mstUseItems.mst_use_items)) {
    if (!item || names[item.id]) continue;
    const name = item.name.trim();
    if (name) names[item.id] = name;
  }

  for (const [itemNumber, name] of Object.entries(
    material_icon_name_by_number,
  )) {
    if (!names[Number(itemNumber)]) names[Number(itemNumber)] = name;
  }

  return names;
}

export function buildOwnedItemNumbers(
  useItems: UseItems,
  materials?: Materials,
  additionalItemNumbers: readonly number[] = [],
  slotItems?: SlotItems,
): number[] {
  const itemNumbers = new Set<number>();
  for (const item of Object.values(useItems.use_items)) {
    if (item && item.count > 0) itemNumbers.add(item.id);
  }

  for (const [index, count] of Object.entries(materials?.materials ?? {})) {
    const itemNumber = material_icon_number_by_index[Number(index)];
    if (itemNumber === undefined || count === undefined || count === null) {
      continue;
    }
    if (count > 0) {
      itemNumbers.add(itemNumber);
    } else {
      itemNumbers.delete(itemNumber);
    }
  }

  for (const [itemNumber, count] of getSlotItemBackedUseItemCounts(slotItems)) {
    if (count > 0) {
      itemNumbers.add(itemNumber);
    } else {
      itemNumbers.delete(itemNumber);
    }
  }

  for (const itemNumber of additionalItemNumbers) {
    itemNumbers.add(itemNumber);
  }

  return [...itemNumbers];
}

/**
 * Splits owned `useitem` and `payitem` records into Normal / Special / Purchased / Furniture Store shelves,
 * enriched with `api_start2/getData` names, descriptions, usetype, and `IconMaterial` IDs.
 */
export function buildItemShelves(
  input: BuildItemShelvesInput,
): ItemShelvesData {
  const normal: ItemViewEntry[] = [];
  const special: ItemViewEntry[] = [];
  const purchased: ItemViewEntry[] = [];
  const furniture: ItemViewEntry[] = [];

  const useItemCounts = new Map<number, number>();
  for (const item of Object.values(input.useItems.use_items)) {
    if (!item) continue;
    if (
      RESOURCE_MATERIAL_IDS.has(item.id) ||
      item.id === FURNITURE_COIN_USEITEM_ID
    ) {
      continue;
    }
    useItemCounts.set(item.id, item.count);
  }

  for (const [index, itemNumber] of Object.entries(
    material_icon_number_by_index,
  )) {
    if (!OWNED_MATERIAL_ITEM_IDS.has(itemNumber)) continue;
    const count = input.materials?.materials[Number(index)];
    if (count !== undefined && count !== null) {
      useItemCounts.set(itemNumber, count);
    }
  }

  for (const [useItemId, count] of getSlotItemBackedUseItemCounts(
    input.slotItems,
  )) {
    useItemCounts.set(useItemId, count);
  }

  for (const [useItemId, count] of useItemCounts) {
    if (count <= 0) continue;

    const meta = input.mstUseItemMetas.mst_use_item_metas[useItemId];
    const mst = input.mstUseItems.mst_use_items[useItemId];
    const name =
      (
        meta?.name ||
        mst?.name ||
        material_icon_name_by_number[useItemId] ||
        ""
      ).trim() || `Item #${useItemId}`;
    const description = joinUseItemDescription(meta?.description);
    const shelf = classifyUseItemShelf(useItemId);
    const usetype = meta?.usetype ?? 0;

    const entry: ItemViewEntry = {
      key: `use-${useItemId}`,
      id: useItemId,
      shelf,
      iconNumber: resolveUseItemIconNumber(useItemId),
      name,
      description,
      count,
      usable: usetype === 4,
      price: meta?.price ?? 0,
      category: meta?.category ?? 0,
      usetype,
      isPayItem: false,
    };

    if (shelf === "purchased") {
      purchased.push(entry);
    } else if (shelf === "special") {
      special.push(entry);
    } else {
      normal.push(entry);
    }
  }

  for (const payItem of Object.values(input.payItems.pay_items)) {
    if (!payItem || payItem.count <= 0) continue;

    purchased.push({
      key: `pay-${payItem.payitem_id}`,
      id: payItem.payitem_id,
      shelf: "purchased",
      iconNumber: resolvePayItemIconNumber(
        payItem.name,
        input.mstUseItemMetas,
        input.mstUseItems,
      ),
      name: payItem.name.trim() || `PayItem #${payItem.payitem_id}`,
      description: normalizeItemDescription(payItem.description),
      count: payItem.count,
      usable: true,
      price: payItem.price,
      category: payItem.item_type,
      usetype: 4,
      isPayItem: true,
    });
  }

  if (input.furnitureCoin !== undefined && input.furnitureCoin !== null) {
    const meta =
      input.mstUseItemMetas.mst_use_item_metas[FURNITURE_COIN_USEITEM_ID];
    const mst = input.mstUseItems.mst_use_items[FURNITURE_COIN_USEITEM_ID];

    furniture.push({
      key: `use-${FURNITURE_COIN_USEITEM_ID}`,
      id: FURNITURE_COIN_USEITEM_ID,
      shelf: "furniture",
      iconNumber: FURNITURE_COIN_USEITEM_ID,
      name: (meta?.name || mst?.name || "家具コイン").trim(),
      description: joinUseItemDescription(meta?.description),
      count: input.furnitureCoin,
      usable: false,
      price: meta?.price ?? 0,
      category: meta?.category ?? 0,
      usetype: meta?.usetype ?? 0,
      isPayItem: false,
    });
  }

  normal.sort((a, b) => a.id - b.id);
  special.sort((a, b) => a.id - b.id);
  furniture.sort((a, b) => a.id - b.id);
  purchased.sort(
    (a, b) => Number(b.isPayItem) - Number(a.isPayItem) || a.id - b.id,
  );

  return { normal, special, purchased, furniture };
}
