/**
 * Database Client Module
 *
 * This directory contains database clients for buffer_logs operations:
 * - d1-client.ts: Cloudflare D1 (SQLite) operations
 * - tidb-client.ts: TiDB Cloud Serverless operations
 *
 * Both modules have the same interface for easy switching/fallback.
 *
 * IMPORTANT: All imports are static (not dynamic) to prevent webpack code splitting.
 * Cloudflare Workers cannot load dynamically split chunks at runtime.
 */

// Static imports for D1 client
import {
  insertBufferLog as _d1InsertBufferLog,
  fetchBufferedData as _d1FetchBufferedData,
  fetchHotData as _d1FetchHotData,
  cleanupBuffer as _d1CleanupBuffer,
  bulkInsertBufferLogs as _d1BulkInsertBufferLogs,
  getBufferedCount as _d1GetBufferedCount,
} from "./d1-client";

// Static imports for TiDB client
import {
  createTiDBClientFromUrl as _createTiDBClientFromUrl,
  createTiDBClient as _createTiDBClient,
  createTiDBClientFromEnv as _createTiDBClientFromEnv,
  insertBufferLog as _tidbInsertBufferLog,
  bulkInsertBufferLogs as _tidbBulkInsertBufferLogs,
  fetchBufferedData as _tidbFetchBufferedData,
  fetchHotData as _tidbFetchHotData,
  cleanupBuffer as _tidbCleanupBuffer,
  executeWithRetry as _tidbExecuteWithRetry,
  // Rate limit detection
  isRateLimitError as _isRateLimitError,
  recordRateLimitEvent as _recordRateLimitEvent,
  getLastRateLimitEvent as _getLastRateLimitEvent,
  RateLimitInfo,
} from "./tidb-client";

// Re-export D1 client functions
export const d1InsertBufferLog = _d1InsertBufferLog;
export const d1FetchBufferedData = _d1FetchBufferedData;
export const d1FetchHotData = _d1FetchHotData;
export const d1CleanupBuffer = _d1CleanupBuffer;
export const d1BulkInsertBufferLogs = _d1BulkInsertBufferLogs;
export const d1GetBufferedCount = _d1GetBufferedCount;

// Re-export TiDB client functions
export const createTiDBClientFromUrl = _createTiDBClientFromUrl;
export const createTiDBClient = _createTiDBClient;
export const createTiDBClientFromEnv = _createTiDBClientFromEnv;
export const tidbInsertBufferLog = _tidbInsertBufferLog;
export const tidbFetchBufferedData = _tidbFetchBufferedData;
export const tidbFetchHotData = _tidbFetchHotData;
export const tidbCleanupBuffer = _tidbCleanupBuffer;
export const tidbExecuteWithRetry = _tidbExecuteWithRetry;

// Re-export rate limit detection functions
export const isRateLimitError = _isRateLimitError;
export const recordRateLimitEvent = _recordRateLimitEvent;
export const getLastRateLimitEvent = _getLastRateLimitEvent;
export type { RateLimitInfo };

// ============================================================
// Unified Interface with TiDB -> D1 Fallback
// ============================================================

export interface UnifiedDbEnv {
  TIDB_KC_DB_URL?: string;
  BATTLE_INDEX_DB: D1Database;
}

export interface BufferLogRecord {
  id: number;
  dataset_id: string;
  table_name: string;
  period_tag: string;
  table_version: string;
  timestamp: number;
  data: ArrayBuffer | Uint8Array;
  uploaded_by: string | null;
  trust_tag: string | null;
}

type BinaryLike = ArrayBuffer | Uint8Array;

function toArrayBuffer(data: BinaryLike): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

function toUint8Array(data: BinaryLike): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildRecordDedupKey(record: BufferLogRecord): string {
  const bytes = toUint8Array(record.data);
  const head = bytes.subarray(0, Math.min(bytes.byteLength, 8));
  const tail = bytes.subarray(Math.max(0, bytes.byteLength - 8));
  return [
    record.dataset_id,
    record.table_name,
    record.period_tag,
    record.table_version,
    String(record.timestamp),
    record.uploaded_by ?? "",
    record.trust_tag ?? "",
    String(bytes.byteLength),
    toHex(head),
    toHex(tail),
  ].join("|");
}

function normalizeRecord(record: BufferLogRecord): BufferLogRecord {
  return {
    ...record,
    data: toArrayBuffer(record.data),
  };
}

function mergeUniqueRecords(
  primaryRows: BufferLogRecord[],
  secondaryRows: BufferLogRecord[],
): BufferLogRecord[] {
  const seen = new Set<string>();
  const merged: BufferLogRecord[] = [];

  const pushRecord = (row: BufferLogRecord) => {
    const normalized = normalizeRecord(row);
    const key = buildRecordDedupKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  };

  primaryRows.forEach(pushRecord);
  secondaryRows.forEach(pushRecord);

  return merged;
}

/**
 * Unified fetch buffered data with TiDB -> D1 fallback on error
 *
 * 1. If TIDB_KC_DB_URL is set, try TiDB first
 * 2. If TiDB fails (including rate limit), fallback to D1
 * 3. If no TIDB_KC_DB_URL, use D1 directly
 *
 * Returns rateLimited: true if the fallback was due to a rate limit error
 */
export async function fetchBufferedDataWithFallback(
  env: UnifiedDbEnv,
): Promise<{
  rows: BufferLogRecord[];
  source: "tidb" | "d1" | "both";
  rateLimited?: boolean;
  rateLimitInfo?: RateLimitInfo;
}> {
  let rateLimitDetected = false;
  let rateLimitInfo: RateLimitInfo | undefined;

  if (env.TIDB_KC_DB_URL) {
    try {
      const conn = _createTiDBClientFromUrl(env.TIDB_KC_DB_URL);
      const tidbRows = await _tidbFetchBufferedData(conn);
      const tidbNormalized = tidbRows.map((r) =>
        normalizeRecord({ ...r, data: r.data }),
      );

      try {
        // Keep D1 as a shadow read source so fallback writes remain visible after
        // TiDB recovery. We merge and deduplicate to avoid duplicate archiving.
        const d1Rows = (await _d1FetchBufferedData(
          env.BATTLE_INDEX_DB,
        )) as BufferLogRecord[];
        if (d1Rows.length === 0) {
          console.log(`[DB] Fetched ${tidbNormalized.length} rows from TiDB`);
          return {
            rows: tidbNormalized,
            source: "tidb",
            rateLimited: false,
          };
        }

        const mergedRows = mergeUniqueRecords(tidbNormalized, d1Rows);
        console.log(
          `[DB] Fetched ${tidbNormalized.length} rows from TiDB + ${d1Rows.length} rows from D1 shadow (merged=${mergedRows.length})`,
        );
        return {
          rows: mergedRows,
          source: "both",
          rateLimited: false,
        };
      } catch (d1Err) {
        console.error(
          "[DB] D1 shadow fetch failed; continuing with TiDB rows only:",
          d1Err instanceof Error ? d1Err.message : String(d1Err),
        );
        return {
          rows: tidbNormalized,
          source: "tidb",
          rateLimited: false,
        };
      }
    } catch (err) {
      // Check if this is a rate limit error
      rateLimitInfo = _isRateLimitError(err);
      rateLimitDetected = rateLimitInfo.isRateLimited;

      if (rateLimitDetected) {
        // Record for tracking and warn
        _recordRateLimitEvent(rateLimitInfo);
        console.warn(
          `[DB] TiDB rate limit detected (${rateLimitInfo.limitType}), falling back to D1`,
        );
      } else {
        console.error(
          "[DB] TiDB fetch failed, falling back to D1:",
          err instanceof Error ? err.message : String(err),
        );
      }
      // Fall through to D1
    }
  }

  // D1 fallback
  const d1Rows = await _d1FetchBufferedData(env.BATTLE_INDEX_DB);
  console.log(
    `[DB] Fetched ${d1Rows.length} rows from D1${rateLimitDetected ? " (TiDB rate limited)" : ""}`,
  );
  return {
    rows: (d1Rows as BufferLogRecord[]).map(normalizeRecord),
    source: "d1",
    rateLimited: rateLimitDetected,
    rateLimitInfo,
  };
}

/**
 * Unified cleanup buffer with TiDB -> D1 fallback on error
 *
 * Returns rateLimited: true if the fallback was due to a rate limit error
 */
export async function cleanupBufferWithFallback(
  env: UnifiedDbEnv,
  maxId: number,
  preferredSource: "tidb" | "d1" | "both",
): Promise<{
  source: "tidb" | "d1" | "both";
  rowsAffected: number;
  rateLimited?: boolean;
}> {
  if (preferredSource === "both" && env.TIDB_KC_DB_URL) {
    let tidbRowsAffected = 0;
    let rateLimited = false;

    try {
      const conn = _createTiDBClientFromUrl(env.TIDB_KC_DB_URL);
      const result = await _tidbCleanupBuffer(conn, maxId);
      tidbRowsAffected = result.rowsAffected;
      console.log(`[DB] Cleaned up ${tidbRowsAffected} rows from TiDB`);
    } catch (err) {
      const rateLimitInfo = _isRateLimitError(err);
      rateLimited = rateLimitInfo.isRateLimited;
      if (rateLimitInfo.isRateLimited) {
        _recordRateLimitEvent(rateLimitInfo);
        console.warn(
          `[DB] TiDB cleanup rate limit detected (${rateLimitInfo.limitType}) during dual-source cleanup`,
        );
      } else {
        console.error(
          "[DB] TiDB cleanup failed during dual-source cleanup:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const d1Result = await _d1CleanupBuffer(env.BATTLE_INDEX_DB, maxId);
    console.log(`[DB] Cleaned up ${d1Result.rowsAffected} rows from D1`);

    return {
      source: "both",
      rowsAffected: tidbRowsAffected + d1Result.rowsAffected,
      rateLimited,
    };
  }

  if (preferredSource === "tidb" && env.TIDB_KC_DB_URL) {
    try {
      const conn = _createTiDBClientFromUrl(env.TIDB_KC_DB_URL);
      const result = await _tidbCleanupBuffer(conn, maxId);
      console.log(`[DB] Cleaned up ${result.rowsAffected} rows from TiDB`);
      return {
        source: "tidb",
        rowsAffected: result.rowsAffected,
        rateLimited: false,
      };
    } catch (err) {
      // Check if this is a rate limit error
      const rateLimitInfo = _isRateLimitError(err);

      if (rateLimitInfo.isRateLimited) {
        _recordRateLimitEvent(rateLimitInfo);
        console.warn(
          `[DB] TiDB cleanup rate limit detected (${rateLimitInfo.limitType}), falling back to D1`,
        );
      } else {
        console.error(
          "[DB] TiDB cleanup failed, falling back to D1:",
          err instanceof Error ? err.message : String(err),
        );
      }

      // D1 fallback
      const result = await _d1CleanupBuffer(env.BATTLE_INDEX_DB, maxId);
      console.log(
        `[DB] Cleaned up ${result.rowsAffected} rows from D1${rateLimitInfo.isRateLimited ? " (TiDB rate limited)" : ""}`,
      );
      return {
        source: "d1",
        rowsAffected: result.rowsAffected,
        rateLimited: rateLimitInfo.isRateLimited,
      };
    }
  }

  // D1 directly (no TiDB configured or preferredSource is D1)
  const result = await _d1CleanupBuffer(env.BATTLE_INDEX_DB, maxId);
  console.log(`[DB] Cleaned up ${result.rowsAffected} rows from D1`);
  return {
    source: "d1",
    rowsAffected: result.rowsAffected,
    rateLimited: false,
  };
}

/**
 * Unified insert with TiDB -> D1 fallback on error
 *
 * Returns rateLimited: true if the fallback was due to a rate limit error
 */
export async function insertBufferLogsWithFallback(
  env: UnifiedDbEnv,
  records: Array<{
    dataset_id: string;
    table_name: string;
    period_tag: string;
    table_version: string;
    timestamp: number;
    data: ArrayBuffer | Uint8Array;
    uploaded_by?: string;
    trust_tag?: string;
  }>,
): Promise<{
  source: "tidb" | "d1";
  insertedCount: number;
  rateLimited?: boolean;
}> {
  if (env.TIDB_KC_DB_URL) {
    try {
      const conn = _createTiDBClientFromUrl(env.TIDB_KC_DB_URL);

      const typedRecords = records.map((r) => ({
        ...r,
        data:
          r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data),
      }));
      const { insertedCount } = await _tidbBulkInsertBufferLogs(
        conn,
        typedRecords,
      );

      console.log(`[DB] Inserted ${insertedCount} records to TiDB`);
      return { source: "tidb", insertedCount, rateLimited: false };
    } catch (err) {
      // Check if this is a rate limit error
      const rateLimitInfo = _isRateLimitError(err);

      if (rateLimitInfo.isRateLimited) {
        _recordRateLimitEvent(rateLimitInfo);
        console.warn(
          `[DB] TiDB insert rate limit detected (${rateLimitInfo.limitType}), falling back to D1`,
        );
      } else {
        console.error(
          "[DB] TiDB insert failed, falling back to D1:",
          err instanceof Error ? err.message : String(err),
        );
      }

      // D1 fallback
      const d1Records = records.map((r) => ({
        ...r,
        data:
          r.data instanceof ArrayBuffer
            ? r.data
            : (r.data.buffer.slice(
                r.data.byteOffset,
                r.data.byteOffset + r.data.byteLength,
              ) as ArrayBuffer),
      }));
      const result = await _d1BulkInsertBufferLogs(
        env.BATTLE_INDEX_DB,
        d1Records,
      );
      console.log(
        `[DB] Inserted ${result.insertedCount} records to D1${rateLimitInfo.isRateLimited ? " (TiDB rate limited)" : ""}`,
      );
      return {
        source: "d1",
        insertedCount: result.insertedCount,
        rateLimited: rateLimitInfo.isRateLimited,
      };
    }
  }

  // D1 directly (no TiDB configured)
  const d1Records = records.map((r) => ({
    ...r,
    data:
      r.data instanceof ArrayBuffer
        ? r.data
        : (r.data.buffer.slice(
            r.data.byteOffset,
            r.data.byteOffset + r.data.byteLength,
          ) as ArrayBuffer),
  }));
  const result = await _d1BulkInsertBufferLogs(env.BATTLE_INDEX_DB, d1Records);
  console.log(`[DB] Inserted ${result.insertedCount} records to D1`);
  return {
    source: "d1",
    insertedCount: result.insertedCount,
    rateLimited: false,
  };
}

/**
 * Unified fetch hot data (recent buffer_logs for specific dataset/table) with TiDB -> D1 fallback
 *
 * This is critical for data consistency: if data is in TiDB, we must query TiDB.
 * D1 fallback only happens if TiDB query fails, not based on configuration alone.
 *
 * Returns rateLimited: true if the fallback was due to a rate limit error
 */
export async function fetchHotDataWithFallback(
  env: UnifiedDbEnv,
  params: {
    dataset_id: string;
    table_name: string;
    from?: number;
    to?: number;
    table_version?: string;
  },
): Promise<{
  rows: BufferLogRecord[];
  source: "tidb" | "d1" | "both";
  rateLimited?: boolean;
}> {
  if (env.TIDB_KC_DB_URL) {
    try {
      const conn = _createTiDBClientFromUrl(env.TIDB_KC_DB_URL);
      const tidbRows = await _tidbFetchHotData(conn, params);
      const tidbNormalized = tidbRows.map((r) =>
        normalizeRecord({ ...r, data: r.data }),
      );

      try {
        const d1Rows = (await _d1FetchHotData(
          env.BATTLE_INDEX_DB,
          params,
        )) as BufferLogRecord[];
        if (d1Rows.length === 0) {
          console.log(`[DB] Fetched ${tidbNormalized.length} hot rows from TiDB`);
          return {
            rows: tidbNormalized,
            source: "tidb",
            rateLimited: false,
          };
        }

        const mergedRows = mergeUniqueRecords(tidbNormalized, d1Rows);
        console.log(
          `[DB] Fetched ${tidbNormalized.length} hot rows from TiDB + ${d1Rows.length} hot rows from D1 shadow (merged=${mergedRows.length})`,
        );
        return {
          rows: mergedRows,
          source: "both",
          rateLimited: false,
        };
      } catch (d1Err) {
        console.error(
          "[DB] D1 hot shadow fetch failed; continuing with TiDB hot rows only:",
          d1Err instanceof Error ? d1Err.message : String(d1Err),
        );
        return {
          rows: tidbNormalized,
          source: "tidb",
          rateLimited: false,
        };
      }
    } catch (err) {
      // Check if this is a rate limit error
      const rateLimitInfo = _isRateLimitError(err);

      if (rateLimitInfo.isRateLimited) {
        _recordRateLimitEvent(rateLimitInfo);
        console.warn(
          `[DB] TiDB fetchHotData rate limit detected (${rateLimitInfo.limitType}), falling back to D1`,
        );
      } else {
        console.error(
          "[DB] TiDB fetchHotData failed, falling back to D1:",
          err instanceof Error ? err.message : String(err),
        );
      }

      // D1 fallback
      const d1Rows = await _d1FetchHotData(env.BATTLE_INDEX_DB, params);
      console.log(
        `[DB] Fetched ${d1Rows.length} hot rows from D1${rateLimitInfo.isRateLimited ? " (TiDB rate limited)" : ""}`,
      );
      return {
        rows: (d1Rows as BufferLogRecord[]).map(normalizeRecord),
        source: "d1",
        rateLimited: rateLimitInfo.isRateLimited,
      };
    }
  }

  // D1 directly (no TiDB configured)
  const d1Rows = await _d1FetchHotData(env.BATTLE_INDEX_DB, params);
  console.log(`[DB] Fetched ${d1Rows.length} hot rows from D1`);
  return {
    rows: (d1Rows as BufferLogRecord[]).map(normalizeRecord),
    source: "d1",
    rateLimited: false,
  };
}
