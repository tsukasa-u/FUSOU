import type { ShipInfo, WeaponIconFrame } from "./types";
import { toGroupIds, hpScoreForDeck } from "./helpers";
import { bannerUrl } from "@/features/simulator/equip-calc";
import { cachedFetch } from "@/utils/fetchCache";

let mstShipByIdCache: Map<number, Record<string, unknown>> | null = null;
let mstSlotItemByIdCache: Map<number, Record<string, unknown>> | null = null;
let weaponIconFramesCache: Record<number, WeaponIconFrame> | null = null;
let weaponIconMetaCache = { width: 0, height: 0 };

type BattleDataQueryOptions = {
  tableVersion?: string;
};

function buildTableVersionQuery(options?: BattleDataQueryOptions): string {
  const raw = options?.tableVersion;
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return `&table_version=${encodeURIComponent(trimmed)}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await cachedFetch(url);
  if (!response.ok) return null;
  return response.json();
}

async function fetchDevLocalRecords(
  table: string,
  value: string,
  field?: string,
): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams({
    uuid: value,
    table,
    value,
  });
  if (field) params.set("field", field);
  const payload = (await fetchJson(
    `/api/battle-data/dev/local-records?${params.toString()}`,
  )) as { records?: Array<Record<string, unknown>> } | null;
  return payload?.records || [];
}

export async function fetchBattleResultByUuid(
  uuid: string,
  options?: BattleDataQueryOptions,
): Promise<{ win_rank: string; drop_ship_id: unknown } | null> {
  if (!uuid) return null;
  try {
    const filterJson = encodeURIComponent(JSON.stringify({ uuid }));
    const tableVersionQuery = buildTableVersionQuery(options);
    const payload = (await fetchJson(
      `/api/battle-data/global/records?table=battle_result&period_tag=all${tableVersionQuery}&limit_blocks=120&limit_records=50&filter_json=${filterJson}`,
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
  options?: BattleDataQueryOptions,
): Promise<Array<Record<string, unknown>>> {
  if (!table || !uuid) return [];
  const candidateFields = ["uuid", "battle_id", "id"];
  const tableVersionQuery = buildTableVersionQuery(options);

  for (const field of candidateFields) {
    try {
      const filterJson = encodeURIComponent(JSON.stringify({ [field]: uuid }));
      const payload = (await fetchJson(
        `/api/battle-data/global/records?table=${encodeURIComponent(table)}&period_tag=all${tableVersionQuery}&limit_blocks=120&limit_records=200&filter_json=${filterJson}`,
      )) as { records?: Array<Record<string, unknown>> } | null;
      const records = payload?.records || [];
      if (records.length > 0) {
        return records;
      }
    } catch {
      // Fall through to the next candidate field.
    }
  }

  for (const field of candidateFields) {
    try {
      const records = await fetchDevLocalRecords(table, uuid, field);
      if (records.length > 0) {
        return records;
      }
    } catch {
      // Continue trying other key fields.
    }
  }

  return [];
}

/**
 * Batch-fetch records matching any of the given UUIDs in a single request.
 * Returns a Map from uuid → matching rows.
 */
export async function fetchRecordsByUuids(
  table: string,
  uuids: string[],
  options?: BattleDataQueryOptions,
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const unique = [...new Set(uuids.filter(Boolean))];
  if (!table || unique.length === 0) return new Map();
  if (unique.length === 1) {
    const rows = await fetchRecordsByUuid(table, unique[0], options);
    return new Map([[unique[0], rows]]);
  }
  try {
    const filterJson = encodeURIComponent(JSON.stringify({ uuid: unique }));
    const tableVersionQuery = buildTableVersionQuery(options);
    const payload = (await fetchJson(
      `/api/battle-data/global/records?table=${encodeURIComponent(table)}&period_tag=all${tableVersionQuery}&limit_blocks=120&limit_records=${unique.length * 50}&filter_json=${filterJson}`,
    )) as { records?: Array<Record<string, unknown>> } | null;
    const result = new Map<string, Array<Record<string, unknown>>>();
    for (const id of unique) result.set(id, []);
    for (const row of payload?.records || []) {
      const id = String(row?.uuid ?? "");
      if (result.has(id)) result.get(id)!.push(row);
    }

    // Local/dev fallback for IDs that were not resolved by global query.
    for (const id of unique) {
      if ((result.get(id)?.length || 0) > 0) continue;
      try {
        const rows = await fetchRecordsByUuid(table, id, options);
        if (rows.length > 0) result.set(id, rows);
      } catch {
        // Keep empty for unresolved id.
      }
    }

    return result;
  } catch {
    const fallback = new Map<string, Array<Record<string, unknown>>>();
    for (const id of unique) {
      try {
        fallback.set(id, await fetchRecordsByUuid(table, id, options));
      } catch {
        fallback.set(id, []);
      }
    }
    return fallback;
  }
}

export async function fetchRecordsByField(
  table: string,
  field: string,
  value: unknown,
  limitRecords = 200,
  options?: BattleDataQueryOptions,
): Promise<Array<Record<string, unknown>>> {
  if (!table || !field || value == null) return [];
  try {
    const filterJson = encodeURIComponent(JSON.stringify({ [field]: value }));
    const tableVersionQuery = buildTableVersionQuery(options);
    const payload = (await fetchJson(
      `/api/battle-data/global/records?table=${encodeURIComponent(table)}&period_tag=all${tableVersionQuery}&limit_blocks=120&limit_records=${limitRecords}&filter_json=${filterJson}`,
    )) as { records?: Array<Record<string, unknown>> } | null;
    let records = payload?.records || [];
    const localFallbackFields = new Set([
      "uuid",
      "battle_id",
      "id",
      "api_id",
      "env_uuid",
      "index",
    ]);
    if (records.length === 0 && localFallbackFields.has(field)) {
      try {
        records = await fetchDevLocalRecords(table, String(value), field);
      } catch {
        // Keep empty when fallback fails.
      }
    }
    return records;
  } catch {
    return [];
  }
}

export async function fetchRecentRecords(
  table: string,
  periodTag = "latest",
  limitRecords = 200,
  options?: BattleDataQueryOptions,
): Promise<Array<Record<string, unknown>>> {
  if (!table) return [];
  try {
    const tableVersionQuery = buildTableVersionQuery(options);
    const payload = (await fetchJson(
      `/api/battle-data/global/records?table=${encodeURIComponent(table)}&period_tag=${encodeURIComponent(periodTag)}${tableVersionQuery}&limit_blocks=120&limit_records=${limitRecords}`,
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
    const resolved = new Map(
      (payload?.records || []).map((row) => [Number(row.id), row]),
    );
    if (resolved.size > 0) {
      mstShipByIdCache = resolved;
    }
    return resolved;
  } catch {
    return new Map();
  }
}

export async function getMstSlotItemById(): Promise<
  Map<number, Record<string, unknown>>
> {
  if (mstSlotItemByIdCache) return mstSlotItemByIdCache;
  try {
    const payload = (await fetchJson(
      `/api/master-data/json?table_name=mst_slotitem`,
    )) as { records?: Array<Record<string, unknown>> } | null;
    const resolved = new Map(
      (payload?.records || []).map((row) => [Number(row.id), row]),
    );
    if (resolved.size > 0) {
      mstSlotItemByIdCache = resolved;
    }
    return resolved;
  } catch {
    return new Map();
  }
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
      `/api/asset-sync/weapon-icon-frames?v=2`,
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
    // Keep cache unset so callers can retry on the next invocation.
    weaponIconFramesCache = null;
    weaponIconMetaCache = { width: 0, height: 0 };
    return { frames: {}, meta: weaponIconMetaCache };
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
  options?: BattleDataQueryOptions,
): Promise<Array<Record<string, unknown>>> {
  const filterJson = encodeURIComponent(JSON.stringify({ uuid }));
  const tableVersionQuery = buildTableVersionQuery(options);
  const payload = (await fetchJson(
    `/api/battle-data/global/records?table=battle&period_tag=${encodeURIComponent(periodTag)}${tableVersionQuery}&limit_blocks=120&limit_records=50&filter_json=${filterJson}`,
  )) as { records?: Array<Record<string, unknown>> } | null;
  const records = payload?.records || [];
  let filtered = records.filter((r) => String(r?.uuid || "") === uuid);

  // Fallback: try dev local endpoint for testing/development data
  if (filtered.length === 0) {
    try {
      const devPayload = (await fetchJson(
        `/api/battle-data/dev/local-records?uuid=${encodeURIComponent(uuid)}&table=battle`,
      )) as { records?: Array<Record<string, unknown>> } | null;
      filtered = devPayload?.records || [];
    } catch {
      // Silently fail fallback - main endpoint is the source of truth
    }
  }

  return filtered;
}

export async function resolveMidnightHougeki(
  raw: unknown,
  options?: BattleDataQueryOptions,
): Promise<unknown> {
  if (!raw || typeof raw !== "string") return raw;
  const listRows = await fetchRecordsByUuid(
    "midnight_hougeki_list",
    raw,
    options,
  );
  const detailUuid = (listRows[0] as Record<string, unknown>)?.midnight_hougeki;
  if (!detailUuid || typeof detailUuid !== "string") return raw;
  const detailRows = await fetchRecordsByUuid(
    "midnight_hougeki",
    detailUuid,
    options,
  );
  return detailRows.length ? detailRows : raw;
}

export async function resolveOpeningTaisen(
  raw: unknown,
  options?: BattleDataQueryOptions,
): Promise<unknown> {
  if (!raw || typeof raw !== "string") return raw;
  const listRows = await fetchRecordsByUuid("opening_taisen_list", raw, options);
  const detailUuid = (listRows?.[0] as Record<string, unknown>)?.opening_taisen;
  const rows = detailUuid
    ? await fetchRecordsByUuid("opening_taisen", String(detailUuid), options)
    : await fetchRecordsByUuid("opening_taisen", raw, options);
  return rows.length ? rows : raw;
}

export async function resolveHougeki(
  raw: unknown,
  options?: BattleDataQueryOptions,
): Promise<unknown> {
  if (!raw || typeof raw !== "string") return raw;
  const listRows = await fetchRecordsByUuid("hougeki_list", raw, options);
  const detailUuid = (listRows?.[0] as Record<string, unknown>)?.hougeki;
  const rows = detailUuid
    ? await fetchRecordsByUuid("hougeki", String(detailUuid), options)
    : await fetchRecordsByUuid("hougeki", raw, options);
  return rows.length ? rows : raw;
}

export async function resolveOpeningAirAttack(
  raw: unknown,
  options?: BattleDataQueryOptions,
): Promise<unknown> {
  if (!raw || typeof raw !== "string") return raw;
  const listRows = await fetchRecordsByUuid(
    "opening_airattack_list",
    raw,
    options,
  );
  const detailUuid = (listRows?.[0] as Record<string, unknown>)
    ?.opening_air_attack;
  const rows = detailUuid
    ? await fetchRecordsByUuid("opening_airattack", String(detailUuid), options)
    : await fetchRecordsByUuid("opening_airattack", raw, options);
  return rows.length ? rows : raw;
}

export async function resolveOpeningRaigeki(
  raw: unknown,
  options?: BattleDataQueryOptions,
): Promise<unknown> {
  if (!raw || typeof raw !== "string") return raw;
  const rows = await fetchRecordsByUuid("opening_raigeki", raw, options);
  return rows.length ? rows[0] : raw;
}

export async function resolveClosingRaigeki(
  raw: unknown,
  options?: BattleDataQueryOptions,
): Promise<unknown> {
  if (!raw || typeof raw !== "string") return raw;
  const rows = await fetchRecordsByUuid("closing_raigeki", raw, options);
  return rows.length ? rows[0] : raw;
}

export async function resolveFriendlyFleet(
  battle: Record<string, unknown>,
  options?: BattleDataQueryOptions,
): Promise<ShipInfo[]> {
  const envUuid = battle?.env_uuid;
  if (!envUuid) return [];

  const ownDecks = await fetchRecordsByField(
    "own_deck",
    "env_uuid",
    envUuid,
    200,
    options,
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
  const ownShipsByGroup = await fetchRecordsByUuids(
    "own_ship",
    allGroupIds,
    options,
  );

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

  let selectedShips = bestGroupId ? ownShipsByGroup.get(bestGroupId) || [] : [];

  // Fallback: when own_deck linkage is unavailable, infer the best own_ship group by env_uuid + HP snapshot.
  if (!selectedShips.length) {
    const ownShipRows = await fetchRecordsByField(
      "own_ship",
      "env_uuid",
      envUuid,
      2000,
      options,
    );
    const byGroup = new Map<string, Array<Record<string, unknown>>>();
    for (const row of ownShipRows) {
      const groupId = String(row.uuid ?? "");
      if (!groupId) continue;
      if (!byGroup.has(groupId)) byGroup.set(groupId, []);
      byGroup.get(groupId)!.push(row);
    }

    let inferredBest: Array<Record<string, unknown>> = [];
    let inferredBestScore = Number.MAX_SAFE_INTEGER;
    for (const rows of byGroup.values()) {
      const score = hpScoreForDeck(
        rows as Array<{ index?: unknown; nowhp?: unknown; maxhp?: unknown }>,
        hpSnapshot,
      );
      if (score < inferredBestScore) {
        inferredBestScore = score;
        inferredBest = rows;
      }
    }
    if (inferredBest.length > 0) {
      selectedShips = inferredBest;
    }
  }

  if (!selectedShips.length) {
    const nearbyOwnShipRows = await fetchRecentRecords(
      "own_ship",
      "latest",
      2000,
      options,
    );
    const byGroup = new Map<string, Array<Record<string, unknown>>>();
    for (const row of nearbyOwnShipRows) {
      const groupId = String(row.uuid ?? "");
      if (!groupId) continue;
      if (!byGroup.has(groupId)) byGroup.set(groupId, []);
      byGroup.get(groupId)!.push(row);
    }

    let inferredNearest: Array<Record<string, unknown>> = [];
    let inferredNearestScore = Number.MAX_SAFE_INTEGER;
    for (const rows of byGroup.values()) {
      const score = hpScoreForDeck(
        rows as Array<{ index?: unknown; nowhp?: unknown; maxhp?: unknown }>,
        hpSnapshot,
      );
      if (score < inferredNearestScore) {
        inferredNearestScore = score;
        inferredNearest = rows;
      }
    }
    if (inferredNearest.length > 0) {
      selectedShips = inferredNearest;
    }
  }

  if (!selectedShips.length) {
    const fallbackHps = Array.isArray(hpSnapshot)
      ? hpSnapshot.map((v) => Number(v ?? 0) || 0)
      : [];
    return fallbackHps
      .filter((hp) => hp > 0)
      .map((hp, idx) => ({
        name: `味方${idx + 1}番艦`,
        shipId: null,
        level: null,
        nowhp: hp,
        maxhp: hp,
        karyoku: null,
        raisou: null,
        taiku: null,
        soukou: null,
        bannerUrl: "",
        equipments: [],
      }));
  }

  const mstShipById = await getMstShipById();
  const mstSlotItemById = await getMstSlotItemById();

  // Collect all slot UUIDs and batch-fetch them in one request
  const sortedShips = [...selectedShips].sort(
    (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0),
  );
  const slotUuids = sortedShips
    .map((s) => (typeof s.slot === "string" ? s.slot : ""))
    .filter(Boolean);
  const slotRowsByUuid = await fetchRecordsByUuids(
    "own_slotitem",
    slotUuids,
    options,
  );

  const slotRowsByEnvUuid = new Map<string, Array<Record<string, unknown>>>();
  const friendlyEnvUuid =
    String(sortedShips[0]?.env_uuid ?? battle?.env_uuid ?? "") || "";
  if (friendlyEnvUuid) {
    const envSlotRows = await fetchRecordsByField(
      "own_slotitem",
      "env_uuid",
      friendlyEnvUuid,
      4000,
      options,
    );
    for (const row of envSlotRows) {
      const groupId = String(row.uuid ?? "");
      if (!groupId) continue;
      if (!slotRowsByEnvUuid.has(groupId)) slotRowsByEnvUuid.set(groupId, []);
      slotRowsByEnvUuid.get(groupId)!.push(row);
    }
  }

  // Last-resort fallback: direct per-slot fetch when both batch and env lookups
  // missed rows for known slot UUIDs.
  const slotRowsByDirectUuid = new Map<string, Array<Record<string, unknown>>>();
  const unresolvedSlotUuids = [...new Set(slotUuids)].filter((slotUuid) => {
    if (!slotUuid) return false;
    return (
      (slotRowsByUuid.get(slotUuid)?.length || 0) === 0 &&
      (slotRowsByEnvUuid.get(slotUuid)?.length || 0) === 0
    );
  });
  for (const slotUuid of unresolvedSlotUuids) {
    try {
      const rows = await fetchRecordsByField(
        "own_slotitem",
        "uuid",
        slotUuid,
        64,
        options,
      );
      if (rows.length > 0) {
        slotRowsByDirectUuid.set(slotUuid, rows);
      }
    } catch {
      // Keep unresolved when direct lookup fails.
    }
  }

  const envShipCandidatesByIndexShip = new Map<
    string,
    Array<Record<string, unknown>>
  >();
  if (friendlyEnvUuid) {
    try {
      const envOwnShipRows = await fetchRecordsByField(
        "own_ship",
        "env_uuid",
        friendlyEnvUuid,
        2000,
        options,
      );
      for (const row of envOwnShipRows) {
        const key = `${Number(row.index ?? -1)}|${Number(row.ship_id ?? 0)}`;
        if (!envShipCandidatesByIndexShip.has(key)) {
          envShipCandidatesByIndexShip.set(key, []);
        }
        envShipCandidatesByIndexShip.get(key)!.push(row);
      }
    } catch {
      // Keep empty map when candidate lookup fails.
    }
  }

  return sortedShips.map((ship) => {
    const shipId = Number(ship.ship_id ?? 0) || null;
    const mstShip = shipId ? mstShipById.get(shipId) : null;
    const slotGroupId = typeof ship.slot === "string" ? ship.slot : null;
    let slotRows = slotGroupId
      ? (slotRowsByUuid.get(slotGroupId) ||
        slotRowsByEnvUuid.get(slotGroupId) ||
        slotRowsByDirectUuid.get(slotGroupId) ||
        [])
      : [];

    if (slotRows.length === 0) {
      const candidateKey = `${Number(ship.index ?? -1)}|${Number(ship.ship_id ?? 0)}`;
      const slotCandidates = envShipCandidatesByIndexShip.get(candidateKey) || [];
      const sortedCandidates = [...slotCandidates].sort((a, b) => {
        const da = Math.abs(Number(a.nowhp ?? 0) - Number(ship.nowhp ?? 0));
        const db = Math.abs(Number(b.nowhp ?? 0) - Number(ship.nowhp ?? 0));
        return da - db;
      });
      for (const candidate of sortedCandidates) {
        const candidateSlot =
          typeof candidate.slot === "string" ? candidate.slot : "";
        if (!candidateSlot) continue;
        const candidateRows =
          slotRowsByUuid.get(candidateSlot) ||
          slotRowsByEnvUuid.get(candidateSlot) ||
          slotRowsByDirectUuid.get(candidateSlot) ||
          [];
        if (candidateRows.length > 0) {
          slotRows = candidateRows;
          break;
        }
      }
    }

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
                ((mstSlot as Record<string, unknown>).type as unknown[])[3] ??
                  0,
              ) || null
            : null;
        return {
          name: (mstSlot as Record<string, unknown>)?.name
            ? String((mstSlot as Record<string, unknown>).name)
            : `装備ID:${slotId}`,
          level: (row.level as number) ?? null,
          iconType,
          slotItemId: slotId,
        };
      });

    return {
      name: mstShip
        ? String(
            (mstShip as Record<string, unknown>).name ??
              `艦ID:${shipId ?? "-"}`,
          )
        : `艦ID:${shipId ?? "-"}`,
      shipId,
      level: Number(ship.lv ?? 0) || null,
      nowhp: Number(ship.nowhp ?? 0) || 0,
      maxhp: Number(ship.maxhp ?? ship.nowhp ?? 0) || 0,
      karyoku: ship.karyoku ?? null,
      raisou: ship.raisou ?? null,
      taiku: ship.taiku ?? null,
      soukou: ship.soukou ?? null,
      bannerUrl: shipId ? bannerUrl(shipId, { f: "auto" }) : "",
      equipments: equips,
    } satisfies ShipInfo;
  });
}

export async function resolveEnemyFleet(
  battle: Record<string, unknown>,
  options?: BattleDataQueryOptions,
): Promise<ShipInfo[]> {
  const fallbackEnemyByHp = (): ShipInfo[] => {
    const hps = Array.isArray(battle?.e_nowhps)
      ? (battle.e_nowhps as unknown[]).map((v) => Number(v ?? 0) || 0)
      : [];
    return hps
      .filter((hp) => hp > 0)
      .map((hp, idx) => ({
        name: `敵${idx + 1}番艦`,
        shipId: null,
        level: null,
        nowhp: hp,
        maxhp: hp,
        karyoku: null,
        raisou: null,
        taiku: null,
        soukou: null,
        bannerUrl: "",
        equipments: [],
      }));
  };

  const inferEnemyByEnv = async (): Promise<ShipInfo[]> => {
    const envUuid = String(battle?.env_uuid ?? "");
    if (!envUuid) return [];

    const hpSnapshot = Array.isArray(battle?.e_nowhps)
      ? (battle.e_nowhps as unknown[])
      : [];
    const rows = await fetchRecordsByField(
      "enemy_ship",
      "env_uuid",
      envUuid,
      2000,
      options,
    );
    if (rows.length === 0) return [];

    const byGroup = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows) {
      const groupId = String(row.uuid ?? "");
      if (!groupId) continue;
      if (!byGroup.has(groupId)) byGroup.set(groupId, []);
      byGroup.get(groupId)!.push(row);
    }
    if (byGroup.size === 0) return [];

    let bestRows: Array<Record<string, unknown>> = [];
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (const groupRows of byGroup.values()) {
      const score = hpScoreForDeck(
        groupRows as Array<{
          index?: unknown;
          nowhp?: unknown;
          maxhp?: unknown;
        }>,
        hpSnapshot,
      );
      if (score < bestScore) {
        bestScore = score;
        bestRows = groupRows;
      }
    }
    if (bestRows.length === 0) return [];

    const mstShipById = await getMstShipById();
    return [...bestRows]
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
      .map((ship) => {
        const mstId = Number(ship.mst_ship_id ?? 0) || null;
        const mstShip = mstId ? mstShipById.get(mstId) : null;
        return {
          name: mstShip
            ? String(
                (mstShip as Record<string, unknown>).name ??
                  `敵艦ID:${mstId ?? "-"}`,
              )
            : `敵艦ID:${mstId ?? "-"}`,
          shipId: mstId,
          level: Number(ship.lv ?? 0) || null,
          nowhp: Number(ship.nowhp ?? 0) || 0,
          maxhp: Number(ship.maxhp ?? ship.nowhp ?? 0) || 0,
          karyoku: ship.karyoku ?? null,
          raisou: ship.raisou ?? null,
          taiku: ship.taiku ?? null,
          soukou: ship.soukou ?? null,
          bannerUrl: mstId ? bannerUrl(mstId, { f: "auto" }) : "",
          equipments: [],
        } satisfies ShipInfo;
      });
  };

  const deckId = battle?.e_deck_id;
  if (!deckId) {
    const inferred = await inferEnemyByEnv();
    return inferred.length > 0 ? inferred : fallbackEnemyByHp();
  }

  const deckRows = await fetchRecordsByUuid("enemy_deck", String(deckId), options);
  const deck = deckRows[0] || null;
  if (!deck) {
    const inferred = await inferEnemyByEnv();
    return inferred.length > 0 ? inferred : fallbackEnemyByHp();
  }

  const mstShipById = await getMstShipById();
  const mstSlotItemById = await getMstSlotItemById();

  // Batch-fetch all enemy ship groups in one request
  const groupIds = toGroupIds(deck.ship_ids);
  const shipsByGroup = await fetchRecordsByUuids(
    "enemy_ship",
    groupIds,
    options,
  );

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
  const slotRowsByUuid = await fetchRecordsByUuids(
    "enemy_slotitem",
    slotUuids,
    options,
  );

  const ships: ShipInfo[] = [];
  for (const ship of allShips) {
    const mstId = Number(ship.mst_ship_id ?? 0) || null;
    const mstShip = mstId ? mstShipById.get(mstId) : null;
    const slotGroupId = typeof ship.slot === "string" ? ship.slot : null;
    const slotRows = slotGroupId ? slotRowsByUuid.get(slotGroupId) || [] : [];
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
                ((mstSlot as Record<string, unknown>).type as unknown[])[3] ??
                  0,
              ) || null
            : null;
        return {
          name: (mstSlot as Record<string, unknown>)?.name
            ? String((mstSlot as Record<string, unknown>).name)
            : `装備ID:${slotId}`,
          level: null,
          iconType,
          slotItemId: slotId,
        };
      });

    ships.push({
      name: mstShip
        ? String(
            (mstShip as Record<string, unknown>).name ??
              `敵艦ID:${mstId ?? "-"}`,
          )
        : `敵艦ID:${mstId ?? "-"}`,
      shipId: mstId,
      level: Number(ship.lv ?? 0) || null,
      nowhp: Number(ship.nowhp ?? 0) || 0,
      maxhp: Number(ship.maxhp ?? ship.nowhp ?? 0) || 0,
      karyoku: ship.karyoku ?? null,
      raisou: ship.raisou ?? null,
      taiku: ship.taiku ?? null,
      soukou: ship.soukou ?? null,
      bannerUrl: mstId ? bannerUrl(mstId, { f: "auto" }) : "",
      equipments: equips,
    });
  }

  if (ships.length > 0) {
    return ships;
  }

  const inferred = await inferEnemyByEnv();
  if (inferred.length > 0) {
    return inferred;
  }

  return Array.isArray(battle?.e_nowhps)
    ? (battle.e_nowhps as unknown[])
        .map((v) => Number(v ?? 0) || 0)
        .filter((hp) => hp > 0)
        .map((hp, idx) => ({
          name: `敵${idx + 1}番艦`,
          shipId: null,
          level: null,
          nowhp: hp,
          maxhp: hp,
          karyoku: null,
          raisou: null,
          taiku: null,
          soukou: null,
          bannerUrl: "",
          equipments: [],
        }))
    : [];
}
