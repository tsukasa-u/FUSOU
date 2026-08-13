export type BattleRecord = Record<string, unknown>;

export function normalizeTimestamp(value: unknown): number | null {
  const normalizeEpochMs = (raw: number): number =>
    raw < 1_000_000_000_000 ? raw * 1000 : raw;

  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeEpochMs(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? normalizeEpochMs(parsed) : null;
  }
  return null;
}

export function toGroupIdsForBattleQuery(rawIds: unknown): string[] {
  if (Array.isArray(rawIds)) {
    return rawIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
  }
  if (typeof rawIds === "string" && rawIds.length > 0) {
    return [rawIds];
  }
  return [];
}

export function buildEnemySummaryResolver(args: {
  enemyDecks: BattleRecord[];
  enemyShips: BattleRecord[];
  mstShips: BattleRecord[];
}): (deckId?: string | null) => string {
  const deckById = new Map(
    args.enemyDecks.map((deck) => [String(deck.uuid ?? ""), deck]),
  );
  const shipsByGroupId = new Map<string, BattleRecord[]>();
  for (const ship of args.enemyShips) {
    const groupId = String(ship.uuid ?? "");
    if (!groupId) continue;
    if (!shipsByGroupId.has(groupId)) shipsByGroupId.set(groupId, []);
    shipsByGroupId.get(groupId)!.push(ship);
  }
  for (const ships of shipsByGroupId.values()) {
    ships.sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0));
  }
  const mstNameById = new Map(
    args.mstShips.map((ship) => [Number(ship.id ?? 0), String(ship.name ?? "")]),
  );

  return (deckId?: string | null): string => {
    if (!deckId) return "-";
    const deck = deckById.get(deckId);
    if (!deck?.ship_ids) return "-";

    const names: string[] = [];
    for (const groupId of toGroupIdsForBattleQuery(deck.ship_ids)) {
      for (const ship of shipsByGroupId.get(groupId) || []) {
        const mstId = Number(ship.mst_ship_id ?? 0);
        if (mstId > 0) names.push(mstNameById.get(mstId) || `艦ID:${mstId}`);
      }
    }

    const uniqueNames = [...new Set(names)];
    if (uniqueNames.length === 0) return "-";
    const head = uniqueNames.slice(0, 3).join(" / ");
    return uniqueNames.length > 3 ? `${head} +${uniqueNames.length - 3}` : head;
  };
}