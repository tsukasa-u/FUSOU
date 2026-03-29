import type { ShipInfo, WeaponIconFrame } from "./types";
import { toGroupIds, hpScoreForDeck } from "./helpers";
import { cachedFetch } from "@/utility/fetchCache";

let mstShipByIdCache: Map<number, Record<string, unknown>> | null = null;
let mstSlotItemByIdCache: Map<number, Record<string, unknown>> | null = null;
let weaponIconFramesCache: Record<number, WeaponIconFrame> | null = null;
let weaponIconMetaCache = { width: 0, height: 0 };

async function fetchJson(url: string): Promise<unknown> {
  const response = await cachedFetch(url);
  if (!response.ok) return null;
  return response.json();
}

export async function fetchBattleResultByUuid(
  uuid: string,
): Promise<{ win_rank: string; drop_ship_id: unknown } | null> {
  if (!uuid) return null;
  try {
    const filterJson = encodeURIComponent(JSON.stringify({ uuid }));
    const payload = (await fetchJson(
      `/api/battle-data/global/records?table=battle_result&period_tag=all&limit_blocks=120&limit_records=50&filter_json=${filterJson}`,
    )) as { records?: Array<Record<string, unknown>> } | null;
    const item = (payload?.records || []).find(
      (r) => r?.uuid === uuid && r?.win_rank,
    );
    if (!item?.win_rank) return null;
    return {
      win_rank: String(item.win_rank),
      drop_ship_id: item.drop_ship_id ?? null,
    };
  } catch {
    return null;
  }
}

export async function fetchRecordsByUuid(
  table: string,
  uuid: string,
): Promise<Array<Record<string, unknown>>> {
  if (!table || !uuid) return [];
  try {
    const filterJson = encodeURIComponent(JSON.stringify({ uuid }));
    const payload = (await fetchJson(
      `/api/battle-data/global/records?table=${encodeURIComponent(table)}&period_tag=all&limit_blocks=120&limit_records=200&filter_json=${filterJson}`,
    )) as { records?: Array<Record<string, unknown>> } | null;
    return payload?.records || [];
  } catch {
    return [];
  }
}

/**
 * Batch-fetch records matching any of the given UUIDs in a single request.
 * Returns a Map from uuid → matching rows.
 */
export async function fetchRecordsByUuids(
  table: string,
  uuids: string[],
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const unique = [...new Set(uuids.filter(Boolean))];
  if (!table || unique.length === 0) return new Map();
  if (unique.length === 1) {
    const rows = await fetchRecordsByUuid(table, unique[0]);
    return new Map([[unique[0], rows]]);
  }
  try {
    const filterJson = encodeURIComponent(JSON.stringify({ uuid: unique }));
    const payload = (await fetchJson(
      `/api/battle-data/global/records?table=${encodeURIComponent(table)}&period_tag=all&limit_blocks=120&limit_records=${unique.length * 50}&filter_json=${filterJson}`,
    )) as { records?: Array<Record<string, unknown>> } | null;
    const result = new Map<string, Array<Record<string, unknown>>>();
    for (const id of unique) result.set(id, []);
    for (const row of payload?.records || []) {
      const id = String(row?.uuid ?? "");
      if (result.has(id)) result.get(id)!.push(row);
    }
    return result;
  } catch {
    return new Map();
  }
}

export async function fetchRecordsByField(
  table: string,
  field: string,
  value: unknown,
  limitRecords = 200,
): Promise<Array<Record<string, unknown>>> {
  if (!table || !field || value == null) return [];
  try {
    const filterJson = encodeURIComponent(
      JSON.stringify({ [field]: value }),
    );
    const payload = (await fetchJson(
      `/api/battle-data/global/records?table=${encodeURIComponent(table)}&period_tag=all&limit_blocks=120&limit_records=${limitRecords}&filter_json=${filterJson}`,
    )) as { records?: Array<Record<string, unknown>> } | null;
    return payload?.records || [];
  } catch {
    return [];
  }
}

export async function getMstShipById(): Promise<
  Map<number, Record<string, unknown>>
> {
  if (mstShipByIdCache) return mstShipByIdCache;
  try {
    const payload = (await fetchJson(
      `/api/master-data/json?table_name=mst_ship`,
    )) as { records?: Array<Record<string, unknown>> } | null;
    mstShipByIdCache = new Map(
      (payload?.records || []).map((row) => [Number(row.id), row]),
    );
  } catch {
    mstShipByIdCache = new Map();
  }
  return mstShipByIdCache;
}

export async function getMstSlotItemById(): Promise<
  Map<number, Record<string, unknown>>
> {
  if (mstSlotItemByIdCache) return mstSlotItemByIdCache;
  try {
    const payload = (await fetchJson(
      `/api/master-data/json?table_name=mst_slotitem`,
    )) as { records?: Array<Record<string, unknown>> } | null;
    mstSlotItemByIdCache = new Map(
      (payload?.records || []).map((row) => [Number(row.id), row]),
    );
  } catch {
    mstSlotItemByIdCache = new Map();
  }
  return mstSlotItemByIdCache;
}

export async function getWeaponIconFrames(): Promise<{
  frames: Record<number, WeaponIconFrame>;
  meta: { width: number; height: number };
}> {
  if (weaponIconFramesCache) {
    return { frames: weaponIconFramesCache, meta: weaponIconMetaCache };
  }
  try {
    const payload = (await fetchJson(
      `/api/asset-sync/weapon-icon-frames`,
    )) as {
      frames?: Record<string, { frame?: Record<string, unknown> }>;
      meta?: { size?: { w?: number; h?: number } };
    } | null;
    const frames: Record<number, WeaponIconFrame> = {};
    for (const [name, entry] of Object.entries(payload?.frames || {})) {
      const m = String(name).match(/_id_(\d+)$/);
      if (!m) continue;
      const id = Number(m[1]);
      const frame = entry?.frame;
      if (!Number.isFinite(id) || !frame) continue;
      frames[id] = {
        x: Number(frame.x ?? 0),
        y: Number(frame.y ?? 0),
        w: Number(frame.w ?? 0),
        h: Number(frame.h ?? 0),
      };
    }
    weaponIconFramesCache = frames;
    weaponIconMetaCache = {
      width: Number(payload?.meta?.size?.w ?? 0) || 0,
      height: Number(payload?.meta?.size?.h ?? 0) || 0,
    };
  } catch {
    weaponIconFramesCache = {};
  }
  return { frames: weaponIconFramesCache, meta: weaponIconMetaCache };
}

export function getWeaponIconCaches(): {
  frames: Record<number, WeaponIconFrame> | null;
  meta: { width: number; height: number };
} {
  return { frames: weaponIconFramesCache, meta: weaponIconMetaCache };
}

export async function fetchBattleRecordsByUuid(
  uuid: string,
  periodTag = "latest",
): Promise<Array<Record<string, unknown>>> {
  const filterJson = encodeURIComponent(JSON.stringify({ uuid }));
  const payload = (await fetchJson(
    `/api/battle-data/global/records?table=battle&period_tag=${periodTag}&limit_blocks=120&limit_records=50&filter_json=${filterJson}`,
  )) as { records?: Array<Record<string, unknown>> } | null;
  const records = payload?.records || [];
  return records.filter((r) => String(r?.uuid || "") === uuid);
}

export async function resolveMidnightHougeki(
  raw: unknown,
): Promise<unknown> {
  if (!raw || typeof raw !== "string") return raw;
  const listRows = await fetchRecordsByUuid("midnight_hougeki_list", raw);
  const detailUuid = (listRows[0] as Record<string, unknown>)?.midnight_hougeki;
  if (!detailUuid || typeof detailUuid !== "string") return raw;
  const detailRows = await fetchRecordsByUuid("midnight_hougeki", detailUuid);
  return detailRows.length ? detailRows : raw;
}

export async function resolveOpeningTaisen(raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== "string") return raw;
  const listRows = await fetchRecordsByUuid("opening_taisen_list", raw);
  const detailUuid = (listRows?.[0] as Record<string, unknown>)?.opening_taisen;
  const rows = detailUuid
    ? await fetchRecordsByUuid("opening_taisen", String(detailUuid))
    : await fetchRecordsByUuid("opening_taisen", raw);
  return rows.length ? rows : raw;
}

export async function resolveHougeki(raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== "string") return raw;
  const listRows = await fetchRecordsByUuid("hougeki_list", raw);
  const detailUuid = (listRows?.[0] as Record<string, unknown>)?.hougeki;
  const rows = detailUuid
    ? await fetchRecordsByUuid("hougeki", String(detailUuid))
    : await fetchRecordsByUuid("hougeki", raw);
  return rows.length ? rows : raw;
}

export async function resolveOpeningAirAttack(
  raw: unknown,
): Promise<unknown> {
  if (!raw || typeof raw !== "string") return raw;
  const listRows = await fetchRecordsByUuid("opening_airattack_list", raw);
  const detailUuid = (listRows?.[0] as Record<string, unknown>)?.opening_air_attack;
  const rows = detailUuid
    ? await fetchRecordsByUuid("opening_airattack", String(detailUuid))
    : await fetchRecordsByUuid("opening_airattack", raw);
  return rows.length ? rows : raw;
}

export async function resolveFriendlyFleet(
  battle: Record<string, unknown>,
): Promise<ShipInfo[]> {
  const envUuid = battle?.env_uuid;
  if (!envUuid) return [];

  const ownDecks = await fetchRecordsByField(
    "own_deck",
    "env_uuid",
    envUuid,
    200,
  );
  const hpSnapshot = (battle.f_nowhps ??
    battle.midnight_f_nowhps ??
    []) as unknown[];

  // Collect all unique ship group IDs from all decks
  const allGroupIds: string[] = [];
  for (const deck of ownDecks) {
    for (const gid of toGroupIds(deck.ship_ids)) {
      if (!allGroupIds.includes(gid)) allGroupIds.push(gid);
    }
  }

  // Batch-fetch all ship groups in one request
  const ownShipsByGroup = await fetchRecordsByUuids("own_ship", allGroupIds);

  let bestGroupId: string | null = null;
  let bestScore = Number.MAX_SAFE_INTEGER;
  for (const deck of ownDecks) {
    for (const groupId of toGroupIds(deck.ship_ids)) {
      const ships = ownShipsByGroup.get(groupId) || [];
      const score = hpScoreForDeck(
        ships as Array<{ index?: unknown; nowhp?: unknown; maxhp?: unknown }>,
        hpSnapshot,
      );
      if (score < bestScore) {
        bestScore = score;
        bestGroupId = groupId;
      }
    }
  }

  const selectedShips = bestGroupId
    ? ownShipsByGroup.get(bestGroupId) || []
    : [];
  if (!selectedShips.length) return [];

  const mstShipById = await getMstShipById();
  const mstSlotItemById = await getMstSlotItemById();

  // Collect all slot UUIDs and batch-fetch them in one request
  const sortedShips = [...selectedShips].sort(
    (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0),
  );
  const slotUuids = sortedShips
    .map((s) => (typeof s.slot === "string" ? s.slot : ""))
    .filter(Boolean);
  const slotRowsByUuid = await fetchRecordsByUuids("own_slotitem", slotUuids);

  return sortedShips.map((ship) => {
    const shipId = Number(ship.ship_id ?? 0) || null;
    const mstShip = shipId ? mstShipById.get(shipId) : null;
    const slotGroupId = typeof ship.slot === "string" ? ship.slot : null;
    const slotRows = slotGroupId
      ? slotRowsByUuid.get(slotGroupId) || []
      : [];
    const equips = slotRows
      .filter((row) => Number(row.mst_slotitem_id ?? -1) > 0)
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
      .map((row) => {
        const slotId = Number(row.mst_slotitem_id ?? 0) || null;
        const mstSlot = slotId ? mstSlotItemById.get(slotId) : null;
        const iconType =
          Array.isArray((mstSlot as Record<string, unknown>)?.type) &&
          ((mstSlot as Record<string, unknown>).type as unknown[]).length >= 4
            ? Number(
                ((mstSlot as Record<string, unknown>).type as unknown[])[3] ?? 0,
              ) || null
            : null;
        return {
          name:
            (mstSlot as Record<string, unknown>)?.name
              ? String((mstSlot as Record<string, unknown>).name)
              : `装備ID:${slotId}`,
          level: (row.level as number) ?? null,
          iconType,
          slotItemId: slotId,
        };
      });

    return {
      name: mstShip
        ? String((mstShip as Record<string, unknown>).name ?? `艦ID:${shipId ?? "-"}`)
        : `艦ID:${shipId ?? "-"}`,
      shipId,
      level: Number(ship.lv ?? 0) || null,
      nowhp: Number(ship.nowhp ?? 0) || 0,
      maxhp: Number(ship.maxhp ?? ship.nowhp ?? 0) || 0,
      karyoku: ship.karyoku ?? null,
      raisou: ship.raisou ?? null,
      taiku: ship.taiku ?? null,
      soukou: ship.soukou ?? null,
      bannerUrl: shipId ? `/api/asset-sync/ship-banner/${shipId}` : "",
      equipments: equips,
    } satisfies ShipInfo;
  });
}

export async function resolveEnemyFleet(
  battle: Record<string, unknown>,
): Promise<ShipInfo[]> {
  const deckId = battle?.e_deck_id;
  if (!deckId) return [];

  const deckRows = await fetchRecordsByUuid("enemy_deck", String(deckId));
  const deck = deckRows[0] || null;
  if (!deck) return [];

  const mstShipById = await getMstShipById();
  const mstSlotItemById = await getMstSlotItemById();

  // Batch-fetch all enemy ship groups in one request
  const groupIds = toGroupIds(deck.ship_ids);
  const shipsByGroup = await fetchRecordsByUuids("enemy_ship", groupIds);

  // Collect all ships and their slot UUIDs
  const allShips: Array<Record<string, unknown>> = [];
  for (const groupId of groupIds) {
    const groupShips = [...(shipsByGroup.get(groupId) || [])].sort(
      (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0),
    );
    allShips.push(...groupShips);
  }

  // Batch-fetch all enemy slot items in one request
  const slotUuids = allShips
    .map((s) => (typeof s.slot === "string" ? s.slot : ""))
    .filter(Boolean);
  const slotRowsByUuid = await fetchRecordsByUuids("enemy_slotitem", slotUuids);

  const ships: ShipInfo[] = [];
  for (const ship of allShips) {
    const mstId = Number(ship.mst_ship_id ?? 0) || null;
    const mstShip = mstId ? mstShipById.get(mstId) : null;
    const slotGroupId = typeof ship.slot === "string" ? ship.slot : null;
    const slotRows = slotGroupId
      ? slotRowsByUuid.get(slotGroupId) || []
      : [];
    const equips = slotRows
      .filter((row) => Number(row.mst_slotitem_id ?? -1) > 0)
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
      .map((row) => {
        const slotId = Number(row.mst_slotitem_id ?? 0) || null;
        const mstSlot = slotId ? mstSlotItemById.get(slotId) : null;
        const iconType =
          Array.isArray((mstSlot as Record<string, unknown>)?.type) &&
          ((mstSlot as Record<string, unknown>).type as unknown[]).length >= 4
            ? Number(
                ((mstSlot as Record<string, unknown>).type as unknown[])[3] ?? 0,
              ) || null
            : null;
        return {
          name:
            (mstSlot as Record<string, unknown>)?.name
              ? String((mstSlot as Record<string, unknown>).name)
              : `装備ID:${slotId}`,
          level: null,
          iconType,
          slotItemId: slotId,
        };
      });

    ships.push({
      name: mstShip
        ? String((mstShip as Record<string, unknown>).name ?? `敵艦ID:${mstId ?? "-"}`)
        : `敵艦ID:${mstId ?? "-"}`,
      shipId: mstId,
      level: Number(ship.lv ?? 0) || null,
      nowhp: Number(ship.nowhp ?? 0) || 0,
      maxhp: Number(ship.maxhp ?? ship.nowhp ?? 0) || 0,
      karyoku: ship.karyoku ?? null,
      raisou: ship.raisou ?? null,
      taiku: ship.taiku ?? null,
      soukou: ship.soukou ?? null,
      bannerUrl: mstId ? `/api/asset-sync/ship-banner/${mstId}` : "",
      equipments: equips,
    });
  }

  return ships;
}
