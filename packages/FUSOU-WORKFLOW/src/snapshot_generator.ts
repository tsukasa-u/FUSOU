import * as node_util from 'node:util';
import * as node_zlib from 'node:zlib';
import {
  parseAllNullAvroBlocks,
  parseAllDeflateAvroBlocks,
  getAvroHeaderLengthFromPrefix,
  compressBrotli,
  buildOverviewSnapshot,
  buildDropsSnapshot,
  type SortieBundle,
  type JsonRecord,
} from '@fusou/compaction-core';
import { toUint8Array } from './utils/binary';

const brotliDecompressAsync = node_util.promisify(node_zlib.brotliDecompress);

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
  if (bytes.byteLength < 24) return [];

  if (bytes[0] !== 0x4f || bytes[1] !== 0x62 || bytes[2] !== 0x6a || bytes[3] !== 0x01) {
    return [];
  }

  const headerSize = getAvroHeaderLengthFromPrefix(bytes);
  const header = bytes.subarray(0, headerSize);
  const body = bytes.subarray(headerSize);

  const headerStr = new TextDecoder().decode(header);
  const isDeflate = headerStr.includes('deflate');

  try {
    if (isDeflate) {
      return (await parseAllDeflateAvroBlocks(header, body)) as JsonRecord[];
    } else {
      return parseAllNullAvroBlocks(header, body) as JsonRecord[];
    }
  } catch (err) {
    console.warn('[SnapshotGenerator] Failed to parse Avro record block:', err);
    return [];
  }
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
      if (Number.isFinite(numTs) && numTs > 1_577_836_800_000) {
        return numTs;
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
  if (existingObj) {
    try {
      const rawBuffer = await existingObj.arrayBuffer();
      const decompressed = await brotliDecompressAsync(Buffer.from(rawBuffer));
      const existingOverview = JSON.parse(decompressed.toString('utf8'));

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
    } catch (err) {
      console.warn('[SnapshotGenerator] Failed to merge existing snapshot for ' + targetTag + ':', err);
    }
  }

  const overview = buildOverviewSnapshot(mergedSorties, {
    maxBattles: options?.maxOverview ?? 2000,
    periodTag: targetTag,
    existingEnemyDecks: historicalDecks,
    existingEnemyShips: historicalShips,
  });
  const overviewCompressed = await compressBrotli(JSON.stringify(overview));

  await env.BATTLE_DATA_BUCKET.put(overviewKey, overviewCompressed, {
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

  const drops = buildDropsSnapshot(mergedSorties, {
    maxBattles: options?.maxDrops ?? 5000,
    periodTag: targetTag,
  });
  const dropsCompressed = await compressBrotli(JSON.stringify(drops));

  await env.BATTLE_DATA_BUCKET.put(dropsKey, dropsCompressed, {
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

  for (const row of rows) {
    const records = await parseAvroRecordsFromBuffer(row.data);
    for (const record of records) {
      const envUuidRaw = record['env_uuid'] ?? record['sortie_key'];
      const envUuid = typeof envUuidRaw === 'string' ? envUuidRaw.trim() : '';
      if (!envUuid) continue;

      let sortie = sortiesByEnvUuid.get(envUuid);
      if (!sortie) {
        sortie = {
          env_uuid: envUuid,
          period_tag: row.period_tag || 'latest',
          table_version: row.table_version,
          fallbackTimestamp: row.timestamp,
          tables: {},
        };
        sortiesByEnvUuid.set(envUuid, sortie);
      }

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
  for (const [envUuid, sortie] of sortiesByEnvUuid.entries()) {
    try {
      const actualTimestamp = resolveSortieTimestamp(envUuid, sortie.tables, sortie.fallbackTimestamp);
      const detailPayload = {
        env_uuid: envUuid,
        period_tag: sortie.period_tag,
        table_version: sortie.table_version,
        timestamp: actualTimestamp,
        tables: sortie.tables,
      };
      const jsonStr = JSON.stringify(detailPayload);
      const compressed = await compressBrotli(jsonStr);

      const r2Key = 'snapshots/env_detail/' + sortie.period_tag + '/' + envUuid + '.json.br';
      await env.BATTLE_DATA_BUCKET.put(r2Key, compressed, {
        httpMetadata: {
          contentType: 'application/json',
          contentEncoding: 'br',
          cacheControl: 'public, max-age=31536000, immutable, no-transform',
        },
        customMetadata: {
          'env-uuid': envUuid,
          'period-tag': sortie.period_tag,
          'table-version': sortie.table_version,
          'generated-at': String(Date.now()),
        },
      });
      sortiesSaved++;
    } catch (err) {
      console.error('[SnapshotGenerator] Failed to save sortie snapshot ' + envUuid + ':', err);
    }
  }

  const allSortieBundles: SortieBundle[] = [];
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
    allSortieBundles.push(bundle);
  }

  const snapshotsUpdated: string[] = [];

  // 1. Update per-period snapshots
  for (const [periodTag, newSorties] of sortiesByPeriodTag.entries()) {
    try {
      await saveOverviewAndDropsSnapshot(env, periodTag, newSorties);
      snapshotsUpdated.push(periodTag);
    } catch (err) {
      console.error('[SnapshotGenerator] Failed to update snapshots for period ' + periodTag + ':', err);
    }
  }

  // 2. ALWAYS update the default 'latest' master snapshot across all sorties
  try {
    await saveOverviewAndDropsSnapshot(env, 'latest', allSortieBundles);
    if (!snapshotsUpdated.includes('latest')) {
      snapshotsUpdated.push('latest');
    }
  } catch (err) {
    console.error('[SnapshotGenerator] Failed to update master "latest" snapshot:', err);
  }

  return { sortiesSaved, snapshotsUpdated };
}
