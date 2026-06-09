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
    (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0),
  );
  const len = Math.min(sorted.length, hpSnapshot.length);
  let score = Math.abs(sorted.length - hpSnapshot.length) * 20;
  for (let i = 0; i < len; i++) {
    const nowhp = Number(sorted[i]?.nowhp ?? sorted[i]?.maxhp ?? 0);
    const target = Number(hpSnapshot[i] ?? 0);
    score += Math.abs(nowhp - target);
  }
  return score;
}

export function getDamageState(
  current: unknown,
  max: unknown,
): { label: string; cls: string } {
  const safeMax = Number(max ?? 0) || 0;
  const safeCurrent = Number(current ?? 0) || 0;
  if (safeMax <= 0) {
    return { label: "不明", cls: "badge-ghost" };
  }
  const pct = (safeCurrent / safeMax) * 100;
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
  beforeHp: number,
  afterHp: number,
  maxHp: number,
): { beforeState: string; afterState: string; sunk: boolean } {
  const beforeState = getDamageState(beforeHp, maxHp).label;
  const afterState = getDamageState(afterHp, maxHp).label;
  return { beforeState, afterState, sunk: afterHp <= 0 && beforeHp > 0 };
}

export function resolveBattleResult(
  raw: unknown,
  battleResultByUuid: Map<string, { win_rank: string; drop_ship_id: unknown }>,
): { win_rank: string; drop_ship_id: unknown } | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    return battleResultByUuid.get(raw) ?? null;
  }
  if (typeof raw === "object" && raw !== null && "win_rank" in raw) {
    const obj = raw as Record<string, unknown>;
    return {
      win_rank: String(obj.win_rank),
      drop_ship_id: obj.drop_ship_id ?? null,
    };
  }
  return null;
}
