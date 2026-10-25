/**
 * Brotli level 6 compression for high-speed & high-ratio balance.
 * Uses dynamic import of node:zlib so browser bundles never encounter static node builtins.
 */
export async function compressBrotli(data: Uint8Array | string): Promise<Uint8Array> {
  const node_util = await import("node:util");
  const node_zlib = await import("node:zlib");
  const brotliCompressAsync = node_util.promisify(node_zlib.brotliCompress);
  const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  const compressed = await brotliCompressAsync(buffer, {
    params: {
      [node_zlib.constants.BROTLI_PARAM_QUALITY]: 6,
      [node_zlib.constants.BROTLI_PARAM_MODE]: node_zlib.constants.BROTLI_MODE_TEXT,
    },
  });
  return new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);
}

export type JsonRecord = Record<string, unknown>;

export interface SortieBundle {
  env_uuid: string;
  period_tag: string;
  table_version?: string;
  timestamp: number;
  cells: JsonRecord[];
  battles: JsonRecord[];
  battleResults: JsonRecord[];
  enemyDecks?: JsonRecord[];
  enemyShips?: JsonRecord[];
  fleets?: JsonRecord[];
  phases?: Record<string, JsonRecord[]>;
}

export interface OverviewSnapshotPayload {
  success: boolean;
  period_tag: string;
  table_version?: string | null | undefined;
  snapshot_timestamp: number;
  battles: JsonRecord[];
  cells: JsonRecord[];
  enemy_decks?: JsonRecord[];
  enemy_ships?: JsonRecord[];
}

export interface DropsSnapshotPayload {
  success: boolean;
  period_tag: string;
  table_version?: string | null | undefined;
  snapshot_timestamp: number;
  battles: JsonRecord[];
  mst_ships?: JsonRecord[];
}

/**
 * Normalizes win_rank and drop_ship_id into a structured battle_result object.
 * Retains 1-based MVP indexes (1 = 旗艦, matching frontend BattleStatsPanel expectations).
 */
function normalizeEpochMs(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? (parsed < 1_000_000_000_000 ? parsed * 1000 : parsed) : null;
  }
  return null;
}

export function normalizeBattleResult(raw: unknown): JsonRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as JsonRecord;
  const winRank = typeof obj["win_rank"] === "string" ? obj["win_rank"] : null;
  if (!winRank) return null;

  let mvpIndexes: number[] | undefined = undefined;
  if (Array.isArray(obj["mvp_ship_indexes"])) {
    mvpIndexes = obj["mvp_ship_indexes"].map(Number).filter((n) => Number.isSafeInteger(n) && n >= 0);
  } else {
    const rawMvp = Number(obj["api_mvp"] ?? obj["mvp"]);
    if (Number.isSafeInteger(rawMvp) && rawMvp > 0) {
      mvpIndexes = [rawMvp - 1]; // 0-based: 0 = 旗艦, 1 = 2番艦...
    }
  }

  const dropShipId = typeof obj["drop_ship_id"] === "number" && Number.isSafeInteger(obj["drop_ship_id"]) && obj["drop_ship_id"] > 0
    ? obj["drop_ship_id"]
    : null;

  return {
    ...obj,
    win_rank: winRank,
    drop_ship_id: dropShipId,
    ...(mvpIndexes !== undefined ? { mvp_ship_indexes: mvpIndexes } : {}),
  };
}

/**
 * Builds the Overview snapshot containing up to maxRecords recent battles and their associated cells & enemy fleet data.
 */
export function buildOverviewSnapshot(
  sorties: SortieBundle[],
  options?: {
    maxBattles?: number;
    periodTag?: string;
    existingEnemyDecks?: JsonRecord[];
    existingEnemyShips?: JsonRecord[];
  }
): OverviewSnapshotPayload {
  const maxBattles = options?.maxBattles ?? 500;
  const periodTag = options?.periodTag ?? sorties[0]?.period_tag ?? "latest";

  // Sort sorties descending by timestamp
  const sortedSorties = [...sorties].sort((a, b) => b.timestamp - a.timestamp);

  const snapshotBattles: JsonRecord[] = [];
  const snapshotCells: JsonRecord[] = [];
  const snapshotEnemyDecks: JsonRecord[] = [];
  const snapshotEnemyShips: JsonRecord[] = [];
  const seenDeckUuids = new Set<string>();
  const seenShipUuids = new Set<string>();
  const includedEnvUuids = new Set<string>();

  for (const sortie of sortedSorties) {
    if (snapshotBattles.length >= maxBattles) break;

    // Build battle result map for this sortie (keyed by battle_result.uuid and index)
    const resultByUuid = new Map<string, JsonRecord>();
    const resultByIndex = new Map<number, JsonRecord>();
    for (const br of sortie.battleResults) {
      const u = typeof br["uuid"] === "string" ? br["uuid"] : "";
      if (u) resultByUuid.set(u, br);
      const idx = typeof br["index"] === "number" && Number.isFinite(br["index"]) ? br["index"] : null;
      if (idx !== null) resultByIndex.set(idx, br);
    }

    // Map enemy deck names by UUID
    const deckById = new Map<string, JsonRecord>();
    if (Array.isArray(sortie.enemyDecks)) {
      for (const d of sortie.enemyDecks) {
        const u = typeof d["uuid"] === "string" ? d["uuid"] : "";
        if (u) deckById.set(u, d);
      }
    }

    // Map cell info by battle UUID (string or array)
    const cellByBattleUuid = new Map<string, JsonRecord>();
    for (const cell of sortie.cells) {
      const bRef = cell["battles"];
      if (typeof bRef === "string" && bRef) {
        cellByBattleUuid.set(bRef, cell);
      } else if (Array.isArray(bRef)) {
        for (const u of bRef) {
          if (typeof u === "string" && u) {
            cellByBattleUuid.set(u, cell);
          }
        }
      }
    }

    const firstCell = sortie.cells[0];

    let sortieBattleIdx = 0;
    for (const battle of sortie.battles) {
      if (snapshotBattles.length >= maxBattles) break;

      const rawIndex = battle["index"];
      const battleIndex = (typeof rawIndex === "number" && Number.isFinite(rawIndex))
        ? rawIndex
        : sortieBattleIdx;
      sortieBattleIdx++;

      const battleUuid = typeof battle["uuid"] === "string" ? battle["uuid"] : "";
      const brRef = battle["battle_result"];
      // Quadruple-check resolution: 1. already an object, 2. battle_result UUID string, 3. battle.uuid matching, 4. battleIndex matching
      const rawResult = (typeof brRef === "object" && brRef !== null)
        ? (brRef as JsonRecord)
        : (typeof brRef === "string" ? resultByUuid.get(brRef) : null) ||
          resultByUuid.get(battleUuid) ||
          resultByIndex.get(battleIndex) ||
          null;
      const normalizedResult = normalizeBattleResult(rawResult);

      // Resolve matching cell: 1. by battleUuid, 2. by battleIndex contained in cell.battle_index, 3. firstCell fallback
      let cell = cellByBattleUuid.get(battleUuid);
      if (!cell) {
        for (const c of sortie.cells) {
          if (Array.isArray(c["battle_index"]) && c["battle_index"].map(Number).includes(battleIndex)) {
            cell = c;
            break;
          }
        }
      }

      // If cell_id is not directly in battle, check cell.battle_index & cell.cell_index alignment
      let derivedCellId: number | null = null;
      if (cell && Array.isArray(cell["battle_index"]) && Array.isArray(cell["cell_index"])) {
        const pos = cell["battle_index"].map(Number).indexOf(battleIndex);
        if (pos >= 0 && pos < cell["cell_index"].length) {
          const cid = Number(cell["cell_index"][pos]);
          if (Number.isFinite(cid)) derivedCellId = cid;
        }
      }

      const rawCellId = battle["cell_id"] ?? derivedCellId ?? cell?.["cell_id"] ?? cell?.["event_id"] ?? NaN;
      const cellId = Number(rawCellId);
      // Battles without a resolvable cell_id cannot be plotted on maps or overview lists
      if (!Number.isFinite(cellId)) continue;

      const mapareaId = Number(battle["maparea_id"] ?? cell?.["maparea_id"] ?? firstCell?.["maparea_id"] ?? NaN);
      const mapinfoNo = Number(battle["mapinfo_no"] ?? cell?.["mapinfo_no"] ?? firstCell?.["mapinfo_no"] ?? NaN);

      const normalizedTs =
        normalizeEpochMs(battle["timestamp"]) ??
        normalizeEpochMs(battle["midnight_timestamp"]) ??
        normalizeEpochMs(sortie.timestamp) ??
        Date.now();

      const enemyDeckId = battle["e_deck_id"] != null ? String(battle["e_deck_id"]).trim() : "";
      const matchedDeck = enemyDeckId ? deckById.get(enemyDeckId) : null;
      const enemySummary = typeof battle["enemy_summary"] === "string" && battle["enemy_summary"]
        ? battle["enemy_summary"]
        : (typeof matchedDeck?.["name"] === "string" ? matchedDeck["name"] : undefined);

      // Note: Spread ...battle FIRST so calculated cell_id, timestamp, maparea_id, etc. are NOT overwritten by battle's null fields
      snapshotBattles.push({
        ...battle,
        index: battleIndex,
        cell_id: cellId,
        timestamp: normalizedTs,
        env_uuid: sortie.env_uuid,
        maparea_id: Number.isFinite(mapareaId) ? mapareaId : null,
        mapinfo_no: Number.isFinite(mapinfoNo) ? mapinfoNo : null,
        battle_result: normalizedResult,
        ...(enemySummary ? { enemy_summary: enemySummary } : {}),
      });

      includedEnvUuids.add(sortie.env_uuid);
    }

    // Include cells and enemy fleet info for the sorties that have battles included
    if (includedEnvUuids.has(sortie.env_uuid)) {
      if (Array.isArray(sortie.enemyDecks)) {
        for (const deck of sortie.enemyDecks) {
          const u = String(deck["uuid"] || "");
          if (!u || !seenDeckUuids.has(u)) {
            if (u) seenDeckUuids.add(u);
            snapshotEnemyDecks.push(deck);
          }
        }
      }
      if (Array.isArray(sortie.enemyShips)) {
        for (const ship of sortie.enemyShips) {
          const u = String(ship["uuid"] || "");
          if (!u || !seenShipUuids.has(u)) {
            if (u) seenShipUuids.add(u);
            snapshotEnemyShips.push(ship);
          }
        }
      }
      for (const cell of sortie.cells) {
        snapshotCells.push({
          ...cell,
          env_uuid: sortie.env_uuid,
        });
      }
    }
  }

  // Preserve existing historical enemy decks and ships from previous snapshots
  if (Array.isArray(options?.existingEnemyDecks)) {
    for (const deck of options.existingEnemyDecks) {
      const u = String(deck["uuid"] || "");
      if (!u || !seenDeckUuids.has(u)) {
        if (u) seenDeckUuids.add(u);
        snapshotEnemyDecks.push(deck);
      }
    }
  }
  if (Array.isArray(options?.existingEnemyShips)) {
    for (const ship of options.existingEnemyShips) {
      const u = String(ship["uuid"] || "");
      if (!u || !seenShipUuids.has(u)) {
        if (u) seenShipUuids.add(u);
        snapshotEnemyShips.push(ship);
      }
    }
  }

  return {
    success: true,
    period_tag: periodTag,
    table_version: sorties[0]?.table_version ?? null,
    snapshot_timestamp: Date.now(),
    battles: snapshotBattles,
    cells: snapshotCells,
    enemy_decks: snapshotEnemyDecks,
    enemy_ships: snapshotEnemyShips,
  };
}

/**
 * Builds the Drops snapshot focusing on battles that produced ship drops.
 */
export function buildDropsSnapshot(
  sorties: SortieBundle[],
  options?: { maxBattles?: number; periodTag?: string }
): DropsSnapshotPayload {
  const maxBattles = options?.maxBattles ?? 1000;
  const periodTag = options?.periodTag ?? sorties[0]?.period_tag ?? "latest";

  const overview = buildOverviewSnapshot(sorties, { maxBattles, periodTag });
  return {
    success: true,
    period_tag: periodTag,
    table_version: overview.table_version ?? null,
    snapshot_timestamp: overview.snapshot_timestamp,
    battles: overview.battles,
    mst_ships: [],
  };
}

export interface EnvDetailSnapshotBundle {
  success: true;
  env_uuid: string;
  period_tag: string;
  table_version?: string | null | undefined;
  snapshot_timestamp: number;
  /** Keyed by battle index (0, 1, 2...) */
  battles: Record<string, JsonRecord>;
}
