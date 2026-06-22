/**
 * Shared display/formatting utility functions.
 * Pure functions with no DOM dependencies.
 */

import {
  EQUIP_TYPE_NAMES,
  RANGE_NAMES,
  SPEED_NAMES,
} from "@/features/simulator/constants";
import type { MstSlotItemData } from "@/features/simulator/types";

export function statRangeLabel(value: number[] | null | undefined): string {
  if (!value || value.length === 0) return "/";
  if (value.length === 1) return String(value[0]);
  return `${value[0]} / ${value[value.length - 1]}`;
}

export function hasStatRange(value: number[] | null | undefined): boolean {
  return Array.isArray(value) && value.length > 0;
}

export function statRangeLabelWithFallback(
  value: number[] | null | undefined,
  fallbackMax: number | null | undefined,
): string {
  if (hasStatRange(value) && !needsStatFallbackDisplay(value))
    return statRangeLabel(value);
  if (typeof fallbackMax === "number" && fallbackMax > 0) {
    return `- / ${fallbackMax}`;
  }
  return "-/-";
}

function needsStatFallbackDisplay(value: number[] | null | undefined): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.every((v) => !Number.isFinite(v) || v <= 0);
}

export function equipTypeName(typeId: number | null): string {
  if (typeId == null) return "不明";
  return EQUIP_TYPE_NAMES[typeId] ?? `種別${typeId}`;
}

export function equipDisplayTypeName(equip: MstSlotItemData): string {
  return equipTypeName(equip.type?.[2] ?? null);
}

export function rangeDisplay(value: number | null | undefined): string {
  if (value == null || value === 0) return "-";
  return RANGE_NAMES[value] ?? String(value);
}

export function speedDisplay(value: number | null | undefined): string {
  if (value == null) return "-";
  return SPEED_NAMES[value] ?? String(value);
}

export function statValueOrDash(value: number | null | undefined): string | number {
  return value == null || value === 0 ? "-" : value;
}

export function formatSlotIndexes(indexes: number[]): string {
  if (indexes.length === 0) return "";

  const ranges: string[] = [];
  let start = indexes[0];
  let end = indexes[0];

  for (let i = 1; i < indexes.length; i += 1) {
    const value = indexes[i];
    if (value === end + 1) {
      end = value;
      continue;
    }
    ranges.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
    start = value;
    end = value;
  }

  ranges.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
  return ranges.join(",");
}

export function groupBy<T>(
  items: T[],
  keyOf: (item: T) => string,
): Array<{ key: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const rows = map.get(key);
    if (rows) rows.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ja"))
    .map(([key, rows]) => ({ key, items: rows }));
}
