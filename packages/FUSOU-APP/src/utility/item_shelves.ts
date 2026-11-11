import type { MstUseItemMetas, MstUseItems } from "@ipc-bindings/get_data";
import type { PayItems, UseItems } from "@ipc-bindings/require_info";
import { item_list } from "../components/ui/icons/material_data";

export type ItemShelfKind = "normal" | "special" | "purchased";

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
};

const RESOURCE_MATERIAL_IDS = new Set([1, 2, 3, 4, 31, 32, 33, 34, 44]);
const PURCHASED_USEITEM_IDS = new Set([53]);
const SPECIAL_SHELF_MIN_USEITEM_ID = 75;

const PAYITEM_ICON_MAP: Record<number, number> = {
  1: 31,
  2: 32,
  3: 33,
  4: 34,
  5: 3,
  6: 2,
  7: 1,
  8: 31,
  9: 31,
  10: 54,
  11: 50,
  12: 51,
  13: 31,
  14: 51,
  15: 52,
  16: 53,
  17: 31,
  18: 54,
  19: 34,
  20: 55,
  21: 54,
  22: 4,
  23: 59,
  24: 66,
  25: 67,
  26: 64,
  27: 73,
  28: 91,
  29: 95,
  30: 102,
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
  payItemId: number,
  name: string,
  mstUseItemMetas: MstUseItemMetas,
  mstUseItems: MstUseItems,
): number {
  const mapped = PAYITEM_ICON_MAP[payItemId];
  if (mapped && item_list[mapped]) return mapped;

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

export function classifyUseItemShelf(useItemId: number): ItemShelfKind {
  if (PURCHASED_USEITEM_IDS.has(useItemId)) return "purchased";
  if (useItemId >= SPECIAL_SHELF_MIN_USEITEM_ID) return "special";
  return "normal";
}

export type BuildItemShelvesInput = {
  useItems: UseItems;
  payItems: PayItems;
  mstUseItems: MstUseItems;
  mstUseItemMetas: MstUseItemMetas;
};

/**
 * Splits owned `useitem` and `payitem` records into Normal / Special / Purchased shelves,
 * enriched with `api_start2/getData` names, descriptions, usetype, and `IconMaterial` IDs.
 */
export function buildItemShelves(
  input: BuildItemShelvesInput,
): ItemShelvesData {
  const normal: ItemViewEntry[] = [];
  const special: ItemViewEntry[] = [];
  const purchased: ItemViewEntry[] = [];

  for (const item of Object.values(input.useItems.use_items)) {
    if (!item || item.count <= 0) continue;
    if (RESOURCE_MATERIAL_IDS.has(item.id)) continue;

    const meta = input.mstUseItemMetas.mst_use_item_metas[item.id];
    const mst = input.mstUseItems.mst_use_items[item.id];
    const name = (meta?.name || mst?.name || "").trim() || `Item #${item.id}`;
    const description = joinUseItemDescription(meta?.description);
    const shelf = classifyUseItemShelf(item.id);
    const usetype = meta?.usetype ?? 0;

    const entry: ItemViewEntry = {
      key: `use-${item.id}`,
      id: item.id,
      shelf,
      iconNumber: resolveUseItemIconNumber(item.id),
      name,
      description,
      count: item.count,
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
        payItem.payitem_id,
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

  normal.sort((a, b) => a.id - b.id);
  special.sort((a, b) => a.id - b.id);
  purchased.sort(
    (a, b) => Number(b.isPayItem) - Number(a.isPayItem) || a.id - b.id,
  );

  return { normal, special, purchased };
}
