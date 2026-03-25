import type { EnemyDeckRecord, EnemyShipRecord, MstShipRecord } from "./types";

export function buildEnemyDeckResolver(
  enemyDecks: EnemyDeckRecord[],
  enemyShips: EnemyShipRecord[],
  mstShips: MstShipRecord[],
) {
  const deckById = new Map(enemyDecks.map((d) => [d.uuid, d]));
  const shipsByGroupId = new Map<string, EnemyShipRecord[]>();
  for (const ship of enemyShips) {
    const group = shipsByGroupId.get(ship.uuid);
    if (group) {
      group.push(ship);
    } else {
      shipsByGroupId.set(ship.uuid, [ship]);
    }
  }
  for (const group of shipsByGroupId.values()) {
    group.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  }
  const mstById = new Map(mstShips.map((s) => [s.id, s.name]));

  return (deckId?: string | null): string => {
    if (!deckId) return "-";
    const deck = deckById.get(deckId);
    if (!deck?.ship_ids) return `敵艦隊 ${deckId.slice(0, 6)}`;

    const names: string[] = [];
    if (Array.isArray(deck.ship_ids)) {
      for (const shipUuid of deck.ship_ids) {
        if (!shipUuid) continue;
        const groupShips = shipsByGroupId.get(shipUuid) || [];
        for (const ship of groupShips) {
          const mstId = ship?.mst_ship_id;
          if (!mstId) continue;
          names.push(mstById.get(mstId) ?? `艦ID:${mstId}`);
        }
      }
    } else if (typeof deck.ship_ids === "string" && deck.ship_ids) {
      const groupShips = shipsByGroupId.get(deck.ship_ids) || [];
      for (const ship of groupShips) {
        const mstId = ship?.mst_ship_id;
        if (!mstId) continue;
        names.push(mstById.get(mstId) ?? `艦ID:${mstId}`);
      }
    }

    if (names.length === 0) return `敵艦隊 ${deckId.slice(0, 6)}`;
    const uniq = [...new Set(names)];
    const head = uniq.slice(0, 3).join(" / ");
    return uniq.length > 3 ? `${head} +${uniq.length - 3}` : head;
  };
}
