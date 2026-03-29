import type {
  EnemyDeckRecord,
  EnemyFleetDetails,
  EnemyShipRecord,
  EnemySlotItemRecord,
  MstShipRecord,
  MstSlotItemRecord,
} from "./types";

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

export function buildEnemyFleetResolver(
  enemyDecks: EnemyDeckRecord[],
  enemyShips: EnemyShipRecord[],
  enemySlotItems: EnemySlotItemRecord[],
  mstShips: MstShipRecord[],
  mstSlotItems: MstSlotItemRecord[],
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
  const slotItemsByGroupId = new Map<string, EnemySlotItemRecord[]>();
  for (const slotItem of enemySlotItems) {
    const group = slotItemsByGroupId.get(slotItem.uuid);
    if (group) {
      group.push(slotItem);
    } else {
      slotItemsByGroupId.set(slotItem.uuid, [slotItem]);
    }
  }
  for (const group of slotItemsByGroupId.values()) {
    group.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  }
  const mstSlotItemById = new Map(mstSlotItems.map((item) => [item.id, item]));

  const toGroupIds = (deckShipIds: EnemyDeckRecord["ship_ids"]): string[] => {
    if (Array.isArray(deckShipIds)) {
      return deckShipIds.filter((id): id is string => typeof id === "string" && id.length > 0);
    }
    if (typeof deckShipIds === "string" && deckShipIds.length > 0) {
      return [deckShipIds];
    }
    return [];
  };

  const bannerUrl = (mstShipId: number | null): string => {
    if (!mstShipId) return "";
    return `/api/asset-sync/ship-banner/${mstShipId}`;
  };

  const signatureOf = (ships: EnemyFleetDetails["ships"]): string =>
    ships
      .map((ship) => {
        const equipSig = ship.equipments
          .map((equip) => String(equip.mstSlotitemId ?? "?"))
          .join(",");
        return `${ship.mstShipId ?? 0}:${ship.karyoku ?? "?"}:${ship.raisou ?? "?"}:${ship.taiku ?? "?"}:${ship.soukou ?? "?"}:${equipSig}`;
      })
      .join("|");

  return (deckId?: string | null): EnemyFleetDetails => {
    if (!deckId) {
      return {
        signature: "none",
        ships: [],
        count: 0,
      };
    }

    const deck = deckById.get(deckId);
    if (!deck?.ship_ids) {
      const fallbackName = `敵艦隊 ${deckId.slice(0, 6)}`;
      return {
        signature: fallbackName,
        ships: [
          {
            mstShipId: null,
            name: fallbackName,
            bannerUrl: "",
            karyoku: null,
            raisou: null,
            taiku: null,
            soukou: null,
            equipments: [],
          },
        ],
        count: 0,
      };
    }

    const ships: EnemyFleetDetails["ships"] = [];
    for (const shipGroupId of toGroupIds(deck.ship_ids)) {
      const groupShips = shipsByGroupId.get(shipGroupId) || [];
      for (const shipData of groupShips) {
        const mstId = shipData.mst_ship_id ?? null;
        const shipName = mstId ? (mstById.get(mstId) ?? `艦ID:${mstId}`) : "敵艦";
        const slotGroupId = typeof shipData.slot === "string" ? shipData.slot : null;
        const slotRecords = slotGroupId ? (slotItemsByGroupId.get(slotGroupId) || []) : [];
        const equipments = slotRecords
          .filter((slot) => (slot.mst_slotitem_id ?? -1) > 0)
          .map((slot) => {
            const slotItemId = slot.mst_slotitem_id!;
            const mstSlotItem = mstSlotItemById.get(slotItemId);
            const typeArray = mstSlotItem?.type;
            const iconType =
              Array.isArray(typeArray) && typeArray.length >= 4
                ? (typeof typeArray[3] === "number" ? typeArray[3] : null)
                : null;
            return {
              mstSlotitemId: slotItemId,
              name: mstSlotItem?.name ?? `装備ID:${slotItemId}`,
              iconType,
            };
          });

        ships.push({
          mstShipId: mstId,
          name: shipName,
          bannerUrl: bannerUrl(mstId),
          karyoku: shipData.karyoku ?? null,
          raisou: shipData.raisou ?? null,
          taiku: shipData.taiku ?? null,
          soukou: shipData.soukou ?? null,
          equipments,
        });
      }
    }

    if (ships.length === 0) {
      const fallbackName = `敵艦隊 ${deckId.slice(0, 6)}`;
      return {
        signature: fallbackName,
        ships: [
          {
            mstShipId: null,
            name: fallbackName,
            bannerUrl: "",
            karyoku: null,
            raisou: null,
            taiku: null,
            soukou: null,
            equipments: [],
          },
        ],
        count: 0,
      };
    }

    return {
      signature: signatureOf(ships),
      ships,
      count: 0,
    };
  };
}
