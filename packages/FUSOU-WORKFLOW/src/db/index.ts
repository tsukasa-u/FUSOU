/**
 * Database Client Module
 * 
 * This directory contains database clients for buffer_logs operations:
 * - d1-client.ts: Cloudflare D1 (SQLite) operations
 * - tidb-client.ts: TiDB Cloud Serverless operations
 * 
 * Both modules have the same interface for easy switching/fallback.
 */

// Re-export D1 client functions (types excluded to avoid webpack warnings)
export {
  insertBufferLog as d1InsertBufferLog,
  fetchBufferedData as d1FetchBufferedData,
  fetchHotData as d1FetchHotData,
  cleanupBuffer as d1CleanupBuffer,
  bulkInsertBufferLogs as d1BulkInsertBufferLogs,
  getBufferedCount as d1GetBufferedCount,
} from './d1-client';

// Re-export TiDB client functions (types excluded to avoid webpack warnings)
export {
  createTiDBClientFromUrl,
  createTiDBClient,
  createTiDBClientFromEnv,
  insertBufferLog as tidbInsertBufferLog,
  fetchBufferedData as tidbFetchBufferedData,
  fetchHotData as tidbFetchHotData,
  cleanupBuffer as tidbCleanupBuffer,
  executeWithRetry as tidbExecuteWithRetry,
} from './tidb-client';

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
  schema_version: string;
  timestamp: number;
  data: ArrayBuffer | Uint8Array;
  uploaded_by: string | null;
}

/**
 * Unified fetch buffered data with TiDB -> D1 fallback on error
 * 
 * 1. If TIDB_KC_DB_URL is set, try TiDB first
 * 2. If TiDB fails, fallback to D1
 * 3. If no TIDB_KC_DB_URL, use D1 directly
 */
export async function fetchBufferedDataWithFallback(
  env: UnifiedDbEnv
): Promise<{ rows: BufferLogRecord[]; source: 'tidb' | 'd1' }> {
  const { fetchBufferedData: d1Fetch } = await import('./d1-client');
  
  if (env.TIDB_KC_DB_URL) {
    try {
      const { createTiDBClientFromUrl, fetchBufferedData: tidbFetch } = await import('./tidb-client');
      const conn = createTiDBClientFromUrl(env.TIDB_KC_DB_URL);
      const tidbRows = await tidbFetch(conn);
      console.log(`[DB] Fetched ${tidbRows.length} rows from TiDB`);
      return {
        rows: tidbRows.map(r => ({
          ...r,
          data: r.data.buffer as ArrayBuffer,
        })),
        source: 'tidb',
      };
    } catch (err) {
      console.error('[DB] TiDB fetch failed, falling back to D1:', err instanceof Error ? err.message : String(err));
    }
  }
  
  // D1 fallback
  const d1Rows = await d1Fetch(env.BATTLE_INDEX_DB);
  console.log(`[DB] Fetched ${d1Rows.length} rows from D1`);
  return {
    rows: d1Rows as BufferLogRecord[],
    source: 'd1',
  };
}

/**
 * Unified cleanup buffer with TiDB -> D1 fallback on error
 */
export async function cleanupBufferWithFallback(
  env: UnifiedDbEnv,
  maxId: number,
  preferredSource: 'tidb' | 'd1'
): Promise<{ source: 'tidb' | 'd1'; rowsAffected: number }> {
  const { cleanupBuffer: d1Cleanup } = await import('./d1-client');
  
  if (preferredSource === 'tidb' && env.TIDB_KC_DB_URL) {
    try {
      const { createTiDBClientFromUrl, cleanupBuffer: tidbCleanup } = await import('./tidb-client');
      const conn = createTiDBClientFromUrl(env.TIDB_KC_DB_URL);
      const result = await tidbCleanup(conn, maxId);
      console.log(`[DB] Cleaned up ${result.rowsAffected} rows from TiDB`);
      return { source: 'tidb', rowsAffected: result.rowsAffected };
    } catch (err) {
      console.error('[DB] TiDB cleanup failed, falling back to D1:', err instanceof Error ? err.message : String(err));
    }
  }
  
  // D1 fallback
  const result = await d1Cleanup(env.BATTLE_INDEX_DB, maxId);
  console.log(`[DB] Cleaned up ${result.rowsAffected} rows from D1`);
  return { source: 'd1', rowsAffected: result.rowsAffected };
}

/**
 * Unified insert with TiDB -> D1 fallback on error
 */
export async function insertBufferLogsWithFallback(
  env: UnifiedDbEnv,
  records: Array<{
    dataset_id: string;
    table_name: string;
    period_tag: string;
    schema_version: string;
    timestamp: number;
    data: ArrayBuffer | Uint8Array;
    uploaded_by?: string;
  }>
): Promise<{ source: 'tidb' | 'd1'; insertedCount: number }> {
  const { bulkInsertBufferLogs: d1BulkInsert } = await import('./d1-client');
  
  if (env.TIDB_KC_DB_URL) {
    try {
      const { createTiDBClientFromUrl, insertBufferLog: tidbInsert } = await import('./tidb-client');
      const conn = createTiDBClientFromUrl(env.TIDB_KC_DB_URL);
      
      let insertedCount = 0;
      for (const record of records) {
        await tidbInsert(conn, {
          ...record,
          data: record.data instanceof Uint8Array ? record.data : new Uint8Array(record.data),
        });
        insertedCount++;
      }
      
      console.log(`[DB] Inserted ${insertedCount} records to TiDB`);
      return { source: 'tidb', insertedCount };
    } catch (err) {
      console.error('[DB] TiDB insert failed, falling back to D1:', err instanceof Error ? err.message : String(err));
    }
  }
  
  // D1 fallback
  const d1Records = records.map(r => ({
    ...r,
    data: r.data instanceof ArrayBuffer ? r.data : r.data.buffer as ArrayBuffer,
  }));
  const result = await d1BulkInsert(env.BATTLE_INDEX_DB, d1Records);
  console.log(`[DB] Inserted ${result.insertedCount} records to D1`);
  return { source: 'd1', insertedCount: result.insertedCount };
}

/**
 * Unified fetch hot data (recent buffer_logs for specific dataset/table) with TiDB -> D1 fallback
 * 
 * This is critical for data consistency: if data is in TiDB, we must query TiDB.
 * D1 fallback only happens if TiDB query fails, not based on configuration alone.
 */
export async function fetchHotDataWithFallback(
  env: UnifiedDbEnv,
  params: {
    dataset_id: string;
    table_name: string;
    from?: number;
    to?: number;
  }
): Promise<{ rows: BufferLogRecord[]; source: 'tidb' | 'd1' }> {
  const { fetchHotData: d1FetchHot } = await import('./d1-client');
  
  if (env.TIDB_KC_DB_URL) {
    try {
      const { createTiDBClientFromUrl, fetchHotData: tidbFetchHot } = await import('./tidb-client');
      const conn = createTiDBClientFromUrl(env.TIDB_KC_DB_URL);
      const tidbRows = await tidbFetchHot(conn, params);
      console.log(`[DB] Fetched ${tidbRows.length} hot rows from TiDB`);
      return {
        rows: tidbRows.map(r => ({
          ...r,
          data: r.data.buffer as ArrayBuffer,
        })),
        source: 'tidb',
      };
    } catch (err) {
      console.error('[DB] TiDB fetchHotData failed, falling back to D1:', err instanceof Error ? err.message : String(err));
    }
  }
  
  // D1 fallback
  const d1Rows = await d1FetchHot(env.BATTLE_INDEX_DB, params);
  console.log(`[DB] Fetched ${d1Rows.length} hot rows from D1`);
  return {
    rows: d1Rows as BufferLogRecord[],
    source: 'd1',
  };
}
