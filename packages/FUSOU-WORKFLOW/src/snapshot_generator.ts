import * as node_util from 'node:util';
import * as node_zlib from 'node:zlib';
import {
  decodeAvroOcfToJsonAsync,
  compressBrotli,
  buildOverviewSnapshot,
  buildDropsSnapshot,
  type SortieBundle,
  type JsonRecord,
} from '@fusou/compaction-core';
import { toUint8Array } from './utils/binary';
import { z } from "zod";
import { normalizeTableVersion } from "./version";
import { inspectAvroFrames } from "./avro-integrity";

const brotliDecompressAsync = node_util.promisify(node_zlib.brotliDecompress);
export const MAX_SNAPSHOT_JSON_BYTES = 16 * 1024 * 1024;
const SnapshotSchema = z.object({
  success: z.literal(true),
  battles: z.array(z.record(z.unknown())),
  cells: z.array(z.record(z.unknown())).optional(),
  enemy_decks: z.array(z.record(z.unknown())).optional(),
  enemy_ships: z.array(z.record(z.unknown())).optional(),
}).passthrough();
const DetailSchema = z.object({
  env_uuid: z.string(),
  period_tag: z.string(),
  table_version: z.string(),
  tables: z.record(z.array(z.record(z.unknown()))),
}).passthrough();

async function readSnapshot(object: R2ObjectBody): Promise<unknown> {
  if (object.size > MAX_SNAPSHOT_JSON_BYTES) throw new Error("Compressed snapshot exceeds 16 MiB");
  const raw = Buffer.from(await object.arrayBuffer());
  if (raw.byteLength > MAX_SNAPSHOT_JSON_BYTES) throw new Error("Snapshot input exceeds 16 MiB");
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    const expanded = await brotliDecompressAsync(raw, { maxOutputLength: MAX_SNAPSHOT_JSON_BYTES });
    return JSON.parse(expanded.toString("utf8")) as unknown;
  }
}

async function compressSnapshot(value: unknown): Promise<Uint8Array> {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > MAX_SNAPSHOT_JSON_BYTES) throw new Error("Snapshot JSON exceeds 16 MiB");
  return compressBrotli(json);
}

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
}

interface BufferRow {
  id: number;
  dataset_id: string;
  table_name: string;
  period_tag: string;
  table_version: string;
  timestamp: number;
  data: ArrayBuffer;
  uploaded_by: string | null;
  trust_tag: string | null;
}

async function parseAvroRecordsFromBuffer(data: ArrayBuffer): Promise<JsonRecord[]> {
  const bytes = toUint8Array(data);
  inspectAvroFrames(bytes);
  return decodeAvroOcfToJsonAsync(bytes, { maxRecords: 10000, maxDecodedBytes: 4 * 1024 * 1024 });
}

/**
 * Validates and extracts epoch milliseconds from a UUID v7 string.
 * Strictly verifies the version 7 nibble and a realistic epoch timestamp (2020 to 2100).
 */
export function extractTimestampFromUuidV7(uuidStr: string): number | null {
  if (typeof uuidStr !== 'string') return null;
  const hex = uuidStr.replace(/-/g, '').trim();
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  const version = Number.parseInt(hex[12] ?? '', 16);
  if (version !== 7) return null;
  const ts = Number(BigInt('0x' + hex.slice(0, 12)));
  if (!Number.isFinite(ts) || ts < 1_577_836_800_000 || ts > 4_102_444_800_000) {
    return null;
  }
  return ts;
}

function resolveSortieTimestamp(envUuid: string, tables: Record<string, JsonRecord[]>, fallbackMs: number): number {
  // 1. Highest fidelity: actual in-game battle timestamp
  const battles = tables['battle'];
  if (Array.isArray(battles) && battles.length > 0) {
    for (const b of battles) {
      const ts = b['timestamp'] ?? b['midnight_timestamp'];
      const numTs = Number(ts);
      const ms = numTs < 1_000_000_000_000 ? numTs * 1000 : numTs;
      if (Number.isFinite(ms) && ms > 1_577_836_800_000 && ms < 4_102_444_800_000) {
        return ms;
      }
    }
  }
  // 2. High fidelity: UUID v7 timestamp
  const v7Ts = extractTimestampFromUuidV7(envUuid);
  if (v7Ts !== null) return v7Ts;

  // 3. Fallback: buffer row timestamp
  return fallbackMs;
}

async function saveOverviewAndDropsSnapshot(
  env: Env,
  targetTag: string,
  sorties: SortieBundle[],
  options?: { maxOverview?: number; maxDrops?: number }
): Promise<void> {
  const overviewKey = 'snapshots/overview/' + targetTag + '.json.br';
  const dropsKey = 'snapshots/drops/' + targetTag + '.json.br';

  let mergedSorties = [...sorties];
  let historicalDecks: JsonRecord[] = [];
  let historicalShips: JsonRecord[] = [];

  const existingObj = await env.BATTLE_DATA_BUCKET.get(overviewKey);
  const existingDropsObj = await env.BATTLE_DATA_BUCKET.get(dropsKey);
  const existingDrops = existingDropsObj ? SnapshotSchema.parse(await readSnapshot(existingDropsObj)) : null;
  if (existingObj) {
      const existingOverview = SnapshotSchema.parse(await readSnapshot(existingObj));

      const existingBattles = Array.isArray(existingOverview.battles) ? existingOverview.battles : [];
      const existingCells = Array.isArray(existingOverview.cells) ? existingOverview.cells : [];
      historicalDecks = Array.isArray(existingOverview.enemy_decks) ? existingOverview.enemy_decks : [];
      historicalShips = Array.isArray(existingOverview.enemy_ships) ? existingOverview.enemy_ships : [];

      const existingByEnv = new Map<string, SortieBundle>();
      for (const b of existingBattles) {
        const u = String(b['env_uuid'] || '');
        if (!u) continue;
        let bundle = existingByEnv.get(u);
        if (!bundle) {
          const rawTs = Number(b['timestamp']);
        const bTs = Number.isFinite(rawTs) && rawTs > 0 ? rawTs : null;
          const v7Ts = extractTimestampFromUuidV7(u);
          bundle = {
            env_uuid: u,
            period_tag: targetTag,
            timestamp: bTs ?? v7Ts ?? Date.now(),
            cells: [],
            battles: [],
            battleResults: [],
          };
          existingByEnv.set(u, bundle);
        }
        const rawTs2 = Number(b['timestamp']);
        const bTs = Number.isFinite(rawTs2) && rawTs2 > 0 ? rawTs2 : null;
        if (bTs !== null && bTs > bundle.timestamp) {
          bundle.timestamp = bTs;
        }
        bundle.battles.push(b);
        const br = b['battle_result'];
        if (br && typeof br === 'object') {
          bundle.battleResults.push(br as JsonRecord);
        }
      }
      for (const c of existingCells) {
        const u = String(c['env_uuid'] || '');
        const b = existingByEnv.get(u);
        if (b) {
          b.cells.push(c);
        }
      }

      const newEnvs = new Set(sorties.map((s) => s.env_uuid));
      for (const [u, oldBundle] of existingByEnv.entries()) {
        if (!newEnvs.has(u)) {
          mergedSorties.push(oldBundle);
        }
      }
  }

  const overview = buildOverviewSnapshot(mergedSorties, {
    maxBattles: options?.maxOverview ?? 2000,
    periodTag: targetTag,
    existingEnemyDecks: historicalDecks,
    existingEnemyShips: historicalShips,
  });
  const overviewCompressed = await compressSnapshot(overview);
  const newEnvs = new Set(sorties.map((sortie) => sortie.env_uuid));
  const dropHistory = new Map<string, SortieBundle>();
  for (const battle of existingDrops?.battles ?? []) {
    const envUuid = String(battle["env_uuid"] ?? "");
    if (!envUuid || newEnvs.has(envUuid)) continue;
    let bundle = dropHistory.get(envUuid);
    if (!bundle) {
      bundle = {
        env_uuid: envUuid, period_tag: targetTag,
        timestamp: Number(battle["timestamp"]) || extractTimestampFromUuidV7(envUuid) || 0,
        cells: [], battles: [], battleResults: [],
      };
      dropHistory.set(envUuid, bundle);
    }
    bundle.battles.push(battle);
  }
  const drops = buildDropsSnapshot([...sorties, ...dropHistory.values()], {
    maxBattles: options?.maxDrops ?? 5000,
    periodTag: targetTag,
  });
  const dropsCompressed = await compressSnapshot(drops);

  const overviewSaved = await env.BATTLE_DATA_BUCKET.put(overviewKey, overviewCompressed, {
    onlyIf: existingObj ? { etagMatches: existingObj.etag } : { etagDoesNotMatch: "*" },
    httpMetadata: {
      contentType: 'application/json',
      contentEncoding: 'br',
      cacheControl: 'public, max-age=60, s-maxage=300, no-transform',
    },
    customMetadata: {
      'period-tag': targetTag,
      'snapshot-type': 'overview',
      'updated-at': String(Date.now()),
    },
  });
  if (!overviewSaved) throw new Error("Concurrent overview snapshot publication");
  const dropsSaved = await env.BATTLE_DATA_BUCKET.put(dropsKey, dropsCompressed, {
    onlyIf: existingDropsObj ? { etagMatches: existingDropsObj.etag } : { etagDoesNotMatch: "*" },
    httpMetadata: {
      contentType: 'application/json',
      contentEncoding: 'br',
      cacheControl: 'public, max-age=60, s-maxage=300, no-transform',
    },
    customMetadata: {
      'period-tag': targetTag,
      'snapshot-type': 'drops',
      'updated-at': String(Date.now()),
    },
  });
  if (!dropsSaved) throw new Error("Concurrent drops snapshot publication");
}

export async function generateAndSaveSnapshots(
  env: Env,
  rows: BufferRow[]
): Promise<{ sortiesSaved: number; snapshotsUpdated: string[] }> {
  if (!rows.length) return { sortiesSaved: 0, snapshotsUpdated: [] };

  const sortiesByEnvUuid = new Map<string, {
    env_uuid: string;
    period_tag: string;
    table_version: string;
    fallbackTimestamp: number;
    tables: Record<string, JsonRecord[]>;
  }>();
  let decodedBytes = 0;
  let decodedCount = 0;

  for (const row of rows) {
    const records = await parseAvroRecordsFromBuffer(row.data);
    decodedBytes += Buffer.byteLength(JSON.stringify(records));
    decodedCount += records.length;
    if (decodedBytes > MAX_SNAPSHOT_JSON_BYTES || decodedCount > 50000) {
      throw new Error("Snapshot batch exceeds decoded resource limits");
    }
    for (const record of records) {
      const envUuidRaw = record['env_uuid'] ?? record['sortie_key'] ??
        (row.table_name === "env_info" ? record["uuid"] : undefined);
      const envUuid = typeof envUuidRaw === 'string' ? envUuidRaw.trim() : '';
      if (!envUuid) continue;

      const identity = `${row.period_tag}/${envUuid}`;
      const version = normalizeTableVersion(row.table_version);
      let sortie = sortiesByEnvUuid.get(identity);
      if (!sortie) {
        sortie = {
          env_uuid: envUuid,
          period_tag: row.period_tag || 'latest',
          table_version: version,
          fallbackTimestamp: row.timestamp,
          tables: {},
        };
        sortiesByEnvUuid.set(identity, sortie);
      }
      if (sortie.table_version !== version) throw new Error("Conflicting sortie table versions");
      sortie.fallbackTimestamp = Math.max(sortie.fallbackTimestamp, row.timestamp);

      // Explicitly ensure env_uuid is attached to every child record for scopeRows compatibility
      const normalizedRecord: JsonRecord = {
        ...record,
        env_uuid: envUuid,
      };

      const tbl = row.table_name;
      const list = sortie.tables[tbl];
      if (!list) {
        sortie.tables[tbl] = [normalizedRecord];
      } else {
        list.push(normalizedRecord);
      }
    }
  }

  let sortiesSaved = 0;
  let retainedDetailBytes = 0;
  for (const sortie of sortiesByEnvUuid.values()) {
      const envUuid = sortie.env_uuid;
      const r2Key = 'snapshots/env_detail/' + sortie.period_tag + '/' + envUuid + '.json.br';
      const existingObj = await env.BATTLE_DATA_BUCKET.get(r2Key);
      const previousTables = existingObj ? DetailSchema.parse(await readSnapshot(existingObj)) : null;
      if (previousTables) {
        const existing = previousTables;
        if (existing.env_uuid !== envUuid || existing.period_tag !== sortie.period_tag ||
            normalizeTableVersion(existing.table_version) !== sortie.table_version) {
          throw new Error("Existing sortie identity/version mismatch");
        }
      }
        for (const table of new Set([...Object.keys(previousTables?.tables ?? {}), ...Object.keys(sortie.tables)])) {
          const records = previousTables?.tables[table] ?? [];
          const byKey = new Map<string, JsonRecord>();
          for (const record of [...records, ...(sortie.tables[table] ?? [])]) {
            const uuid = record["uuid"];
            const key = typeof uuid === "string"
              ? JSON.stringify([uuid, record["index"], record["index_1"], record["index_2"], record["cell_index"]])
              : JSON.stringify(record);
            byKey.set(key, record);
          sortie.tables[table] = [...byKey.values()];
        }
      }
      const actualTimestamp = resolveSortieTimestamp(envUuid, sortie.tables, sortie.fallbackTimestamp);
      const detailPayload = {
        env_uuid: envUuid,
        period_tag: sortie.period_tag,
        table_version: sortie.table_version,
        timestamp: actualTimestamp,
        tables: sortie.tables,
      };
      retainedDetailBytes += Buffer.byteLength(JSON.stringify(detailPayload));
      if (retainedDetailBytes > MAX_SNAPSHOT_JSON_BYTES) throw new Error("Merged sortie batch exceeds 16 MiB");
      const compressed = await compressSnapshot(detailPayload);

      const saved = await env.BATTLE_DATA_BUCKET.put(r2Key, compressed, {
        onlyIf: existingObj ? { etagMatches: existingObj.etag } : { etagDoesNotMatch: "*" },
        httpMetadata: {
          contentType: 'application/json',
          contentEncoding: 'br',
          cacheControl: 'public, max-age=0, must-revalidate, no-transform',
        },
        customMetadata: {
          'env-uuid': envUuid,
          'period-tag': sortie.period_tag,
          'table-version': sortie.table_version,
          'generated-at': String(Date.now()),
        },
      });
      if (!saved) throw new Error("Concurrent sortie snapshot publication");
      sortiesSaved++;
  }

  const sortiesByPeriodTag = new Map<string, SortieBundle[]>();

  for (const sortie of sortiesByEnvUuid.values()) {
    const pt = sortie.period_tag || 'latest';
    let list = sortiesByPeriodTag.get(pt);
    if (!list) {
      list = [];
      sortiesByPeriodTag.set(pt, list);
    }

    const actualTimestamp = resolveSortieTimestamp(sortie.env_uuid, sortie.tables, sortie.fallbackTimestamp);
    const bundle: SortieBundle = {
      env_uuid: sortie.env_uuid,
      period_tag: pt,
      table_version: sortie.table_version,
      timestamp: actualTimestamp,
      cells: sortie.tables['cells'] || sortie.tables['cell'] || [],
      battles: sortie.tables['battle'] || sortie.tables['battles'] || [],
      battleResults: sortie.tables['battle_result'] || sortie.tables['battleResult'] || sortie.tables['battle_results'] || [],
      enemyDecks: sortie.tables['enemy_deck'] || sortie.tables['enemy_decks'] || [],
      enemyShips: sortie.tables['enemy_ship'] || sortie.tables['enemy_ships'] || [],
      fleets: sortie.tables['own_deck'] || sortie.tables['own_decks'] || [],
    };

    list.push(bundle);
  }

  const snapshotsUpdated: string[] = [];

  // 1. Update per-period snapshots
  for (const [periodTag, newSorties] of sortiesByPeriodTag.entries()) {
      await saveOverviewAndDropsSnapshot(env, periodTag, newSorties);
      snapshotsUpdated.push(periodTag);
  }

  // 2. 'latest' alias generation removed: API dynamically resolves current period
  return { sortiesSaved, snapshotsUpdated };
}
