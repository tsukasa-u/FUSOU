/**
 * D1 (SQLite) Client for buffer_logs
 * 
 * This module provides the same interface as tidb-client.ts but for Cloudflare D1.
 * Used as a fallback when TiDB is not configured.
 * 
 * Usage:
 * import { fetchBufferedData, cleanupBuffer, insertBufferLog } from './d1-client';
 * 
 * const rows = await fetchBufferedData(env.BATTLE_INDEX_DB);
 * await insertBufferLog(env.BATTLE_INDEX_DB, params);
 * await cleanupBuffer(env.BATTLE_INDEX_DB, maxId);
 */

// ============================================================
// Type Definitions (matching tidb-client.ts)
// ============================================================

export interface BufferLogRow {
  id: number;
  dataset_id: string;
  table_name: string;
  period_tag: string;
  table_version: string;
  timestamp: number;
  data: ArrayBuffer;  // D1 returns ArrayBuffer for BLOB
  uploaded_by: string | null;
}

export interface InsertBufferLogParams {
  dataset_id: string;
  table_name: string;
  period_tag: string;
  table_version: string;
  timestamp: number;
  data: ArrayBuffer;
  uploaded_by?: string;
}

// ============================================================
// Buffer Logs Operations
// ============================================================

/**
 * Insert a buffer log entry to D1
 */
export async function insertBufferLog(
  db: D1Database,
  params: InsertBufferLogParams
): Promise<{ insertId: number }> {
  const result = await db.prepare(`
    INSERT INTO buffer_logs 
    (dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    params.dataset_id,
    params.table_name,
    params.period_tag,
    params.table_version,
    params.timestamp,
    params.data,
    params.uploaded_by || null
  ).run();
  
  // D1 doesn't return insertId directly, use lastRowId
  return { insertId: result.meta.last_row_id ?? 0 };
}

/**
 * Fetch all buffered data for archiving
 * Ordered by table_version, table_name, period_tag, dataset_id, id for efficient grouping
 */
export async function fetchBufferedData(
  db: D1Database
): Promise<BufferLogRow[]> {
  const result = await db.prepare(`
    SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by
    FROM buffer_logs
    ORDER BY table_version, table_name, period_tag, dataset_id, id ASC
  `).all<BufferLogRow>();
  
  return result.results ?? [];
}

/**
 * Fetch hot data for a specific dataset and table
 */
export async function fetchHotData(
  db: D1Database,
  params: {
    dataset_id: string;
    table_name: string;
    from?: number;
    to?: number;
    table_version?: string;
  }
): Promise<BufferLogRow[]> {
  let sql = `
    SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by
    FROM buffer_logs
    WHERE dataset_id = ? AND table_name = ?
  `;
  
  const bindings: (string | number)[] = [params.dataset_id, params.table_name];
  
  if (params.table_version !== undefined) {
    sql += ' AND table_version = ?';
    bindings.push(params.table_version);
  }
  
  if (params.from !== undefined) {
    sql += ' AND timestamp >= ?';
    bindings.push(params.from);
  }
  
  if (params.to !== undefined) {
    sql += ' AND timestamp <= ?';
    bindings.push(params.to);
  }
  
  sql += ' ORDER BY timestamp ASC';
  
  const result = await db.prepare(sql).bind(...bindings).all<BufferLogRow>();
  
  return result.results ?? [];
}

/**
 * Delete processed buffer logs (cleanup after archiving)
 */
export async function cleanupBuffer(
  db: D1Database,
  maxId: number
): Promise<{ rowsAffected: number }> {
  const result = await db.prepare(
    'DELETE FROM buffer_logs WHERE id <= ?'
  ).bind(maxId).run();
  
  return { rowsAffected: result.meta.changes ?? 0 };
}

/**
 * Bulk insert buffer logs (used by queue consumer)
 * FIXED: Chunks large batches to avoid D1 SQL statement size limits
 */
export async function bulkInsertBufferLogs(
  db: D1Database,
  records: InsertBufferLogParams[]
): Promise<{ insertedCount: number }> {
  if (records.length === 0) {
    return { insertedCount: 0 };
  }
  
  // D1 has limits on SQL statement size and parameter count
  // Chunk into smaller batches to avoid exceeding limits
  const CHUNK_SIZE = 100;  // 100 records * 7 params = 700 params per statement (well under limit)
  let totalInserted = 0;
  
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    
    // Build bulk insert SQL for this chunk
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
    const sql = `
      INSERT INTO buffer_logs 
      (dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by)
      VALUES ${placeholders}
    `;
    
    const params: (string | number | ArrayBuffer | null)[] = [];
    for (const record of chunk) {
      params.push(
        record.dataset_id,
        record.table_name,
        record.period_tag,
        record.table_version,
        record.timestamp,
        record.data,
        record.uploaded_by || null
      );
    }
    
    await db.prepare(sql).bind(...params).run();
    totalInserted += chunk.length;
  }
  
  return { insertedCount: totalInserted };
}

/**
 * Get count of buffered records
 */
export async function getBufferedCount(
  db: D1Database
): Promise<number> {
  const result = await db.prepare('SELECT COUNT(*) as count FROM buffer_logs').first<{ count: number }>();
  return result?.count ?? 0;
}
