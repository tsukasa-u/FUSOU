import { parseFiniteNumber } from "./payload-guards";

export function escHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeEpochMs(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n < 1_000_000_000_000 ? n * 1000 : n;
}

export function battleRowIndexForSort(value: unknown): number {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return Number.MAX_SAFE_INTEGER;
  }
  const index =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(index) && index >= 0
    ? index
    : Number.MAX_SAFE_INTEGER;
}

export function normalizeNullableNumber(value: unknown): number | null {
  return parseFiniteNumber(value).value;
}

export function formatNullableNumber(value: unknown): string {
  return String(parseFiniteNumber(value).value ?? "?");
}

export function sumNullableNumbers(values: unknown[]): number | null {
  const parsed = values.map((value) => parseFiniteNumber(value).value);
  const numeric = parsed.filter((value): value is number => value !== null);
  if (numeric.length !== parsed.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0);
}

export function averageNullableNumbers(values: unknown[]): number | null {
  const sum = sumNullableNumbers(values);
  if (sum === null || values.length === 0) return null;
  return Math.round(sum / values.length);
}

export function toGroupIds(rawIds: unknown): string[] {
  if (Array.isArray(rawIds)) {
    return rawIds.filter((id) => typeof id === "string" && id.length > 0);
  }
  if (typeof rawIds === "string" && rawIds.length > 0) {
    return [rawIds];
  }
  return [];
}

export function hpScoreForDeck(
  ships: Array<{ index?: unknown; nowhp?: unknown; maxhp?: unknown }>,
  hpSnapshot: unknown[],
): number {
  if (!ships.length || !Array.isArray(hpSnapshot) || hpSnapshot.length === 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  const sorted = [...ships].sort(
    (a, b) => battleRowIndexForSort(a.index) - battleRowIndexForSort(b.index),
  );
  const len = Math.min(sorted.length, hpSnapshot.length);
  let score = Math.abs(sorted.length - hpSnapshot.length) * 20;
  for (let i = 0; i < len; i++) {
    const nowhp = parseFiniteNumber(
      sorted[i]?.nowhp ?? sorted[i]?.maxhp,
    ).value;
    const target = parseFiniteNumber(hpSnapshot[i]).value;
    if (nowhp === null || target === null) {
      score += 50;
      continue;
    }
    score += Math.abs(nowhp - target);
  }
  return score;
}

export function getDamageState(
  current: unknown,
  max: unknown,
): { label: string; cls: string } {
  const parsedMax = parseFiniteNumber(max).value;
  const parsedCurrent = parseFiniteNumber(current).value;
  if (parsedMax === null || parsedCurrent === null || parsedMax <= 0) {
    return { label: "不明", cls: "badge-ghost" };
  }
  const pct = (parsedCurrent / parsedMax) * 100;
  if (pct <= 25) return { label: "大破", cls: "badge-error" };
  if (pct <= 50) return { label: "中破", cls: "badge-warning" };
  if (pct <= 75) return { label: "小破", cls: "badge-info" };
  return { label: "健在", cls: "badge-success" };
}

export function hpFillClass(pct: number): string {
  if (pct <= 25) return "bg-error";
  if (pct <= 50) return "bg-warning";
  if (pct <= 75) return "bg-info";
  return "bg-success";
}

export function transitionState(
  beforeHp: number | null,
  afterHp: number | null,
  maxHp: number | null,
): { beforeState: string; afterState: string; sunk: boolean } {
  const beforeState = getDamageState(beforeHp, maxHp).label;
  const afterState = getDamageState(afterHp, maxHp).label;
  return {
    beforeState,
    afterState,
    sunk: afterHp !== null && beforeHp !== null && afterHp <= 0 && beforeHp > 0,
  };
}

