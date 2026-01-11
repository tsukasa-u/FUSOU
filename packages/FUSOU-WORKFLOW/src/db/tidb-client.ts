/**
 * TiDB Cloud Serverless Client
 * 
 * Usage (Option 1 - DATABASE_URL, recommended by PingCAP):
 * const client = createTiDBClientFromUrl(env.DATABASE_URL);
 * 
 * Usage (Option 2 - Separate params):
 * const client = createTiDBClient({
 *   host: env.TIDB_HOST,
 *   username: env.TIDB_USERNAME,
 *   password: env.TIDB_PASSWORD,
 *   database: env.TIDB_DATABASE,
 * });
 * 
 * const result = await client.execute('SELECT * FROM buffer_logs WHERE dataset_id = ?', [datasetId]);
 */

import { connect, Connection } from '@tidbcloud/serverless';

// ============================================================
// Rate Limit Detection
// ============================================================

/**
 * TiDB Cloud rate limit error detection patterns
 * - HTTP 429: Too Many Requests
 * - RU quota exceeded: Request Units exhausted
 * - Throttling messages
 */
const RATE_LIMIT_PATTERNS = [
  /\b429\b/,                    // HTTP 429 status code (word boundary)
  /too many requests/i,
  /rate.?limit/i,
  /throttl/i,
  /quota.?exceed/i,
  /request.?units?.?exhaust/i,
  /ru.?limit/i,
];

export interface RateLimitInfo {
  /** Whether the error is a rate limit error */
  isRateLimited: boolean;
  /** Detected rate limit type (if known) */
  limitType?: 'api' | 'ru' | 'unknown';
  /** Original error message */
  message: string;
}

/**
 * Check if an error is a TiDB Cloud rate limit error
 * 
 * TiDB Cloud has two types of limits:
 * 1. API rate limit: 100 requests/minute per API key (HTTP 429)
 * 2. RU (Request Units) quota: Monthly compute budget for Serverless
 */
export function isRateLimitError(error: unknown): RateLimitInfo {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string | number })?.code;
  const status = (error as { status?: number })?.status;
  
  // Check HTTP status code
  if (status === 429 || code === 429 || code === '429') {
    return { isRateLimited: true, limitType: 'api', message };
  }
  
  // Check error message patterns
  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (pattern.test(message)) {
      // Determine limit type from message
      const limitType = /ru|request.?unit/i.test(message) ? 'ru' : 
                       /429|api|request/i.test(message) ? 'api' : 'unknown';
      return { isRateLimited: true, limitType, message };
    }
  }
  
  return { isRateLimited: false, message };
}

/**
 * Last known rate limit status (in-memory tracking)
 * This provides visibility into recent rate limit events
 */
let lastRateLimitEvent: {
  timestamp: number;
  info: RateLimitInfo;
} | null = null;

/**
 * Record a rate limit event for tracking
 */
export function recordRateLimitEvent(info: RateLimitInfo): void {
  if (info.isRateLimited) {
    lastRateLimitEvent = {
      timestamp: Date.now(),
      info,
    };
    console.warn(`[TiDB] Rate limit detected: ${info.limitType} - ${info.message}`);
  }
}

/**
 * Get the last rate limit event (if any, within last 5 minutes)
 */
export function getLastRateLimitEvent(): typeof lastRateLimitEvent {
  if (lastRateLimitEvent && Date.now() - lastRateLimitEvent.timestamp < 5 * 60 * 1000) {
    return lastRateLimitEvent;
  }
  return null;
}


export interface TiDBConfig {
  host: string;
  username: string;
  password: string;
  database: string;
}

export type TiDBConnection = Connection;

/**
 * Create a TiDB Cloud Serverless connection from DATABASE_URL
 * Format: mysql://username:password@host/database
 * 
 * This is the recommended method per official PingCAP Cloudflare integration docs:
 * https://docs.pingcap.com/tidbcloud/integrate-tidbcloud-with-cloudflare/
 */
export function createTiDBClientFromUrl(databaseUrl: string): TiDBConnection {
  return connect({ url: databaseUrl });
}

/**
 * Create a TiDB Cloud Serverless connection from separate params
 */
export function createTiDBClient(config: TiDBConfig): TiDBConnection {
  return connect({
    host: config.host,
    username: config.username,
    password: config.password,
    database: config.database,
  });
}

/**
 * Create TiDB client from Cloudflare Worker environment
 * Supports TIDB_KC_DB_URL (preferred) and separate params as fallback
 */
export function createTiDBClientFromEnv(env: {
  TIDB_KC_DB_URL?: string;
  DATABASE_URL?: string;
  TIDB_HOST?: string;
  TIDB_USERNAME?: string;
  TIDB_PASSWORD?: string;
  TIDB_DATABASE?: string;
}): TiDBConnection {
  // Prefer TIDB_KC_DB_URL if available (user's configured secret name)
  if (env.TIDB_KC_DB_URL) {
    return createTiDBClientFromUrl(env.TIDB_KC_DB_URL);
  }
  
  // Fallback to DATABASE_URL (official recommendation)
  if (env.DATABASE_URL) {
    return createTiDBClientFromUrl(env.DATABASE_URL);
  }
  
  // Fallback to separate params
  if (env.TIDB_HOST && env.TIDB_USERNAME && env.TIDB_PASSWORD && env.TIDB_DATABASE) {
    return createTiDBClient({
      host: env.TIDB_HOST,
      username: env.TIDB_USERNAME,
      password: env.TIDB_PASSWORD,
      database: env.TIDB_DATABASE,
    });
  }
  
  throw new Error('TiDB configuration not found. Set TIDB_KC_DB_URL, DATABASE_URL, or TIDB_HOST/USERNAME/PASSWORD/DATABASE');
}

// ============================================================
// Buffer Logs Operations
// ============================================================

export interface BufferLogRow {
  id: number;
  dataset_id: string;
  table_name: string;
  period_tag: string;
  schema_version: string;
  timestamp: number;
  data: Uint8Array;
  uploaded_by: string | null;
}

export interface InsertBufferLogParams {
  dataset_id: string;
  table_name: string;
  period_tag: string;
  schema_version: string;
  timestamp: number;
  data: Uint8Array;
  uploaded_by?: string;
}

/**
 * Insert a buffer log entry
 */
export async function insertBufferLog(
  conn: TiDBConnection,
  params: InsertBufferLogParams
): Promise<{ insertId: number }> {
  const result = await conn.execute(
    `INSERT INTO buffer_logs 
     (dataset_id, table_name, period_tag, schema_version, timestamp, data, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      params.dataset_id,
      params.table_name,
      params.period_tag,
      params.schema_version,
      params.timestamp,
      params.data,
      params.uploaded_by || null,
    ]
  );
  
  // TiDB SDK returns FullResult for INSERT with insertId
  const insertId = (result as { insertId?: number }).insertId ?? 0;
  return { insertId };
}

/**
 * Fetch all buffered data for archiving
 */
export async function fetchBufferedData(
  conn: TiDBConnection
): Promise<BufferLogRow[]> {
  const result = await conn.execute(
    `SELECT id, dataset_id, table_name, period_tag, schema_version, timestamp, data, uploaded_by
     FROM buffer_logs
     ORDER BY timestamp ASC`
  );
  
  // TiDB SDK: default returns array directly, fullResult:true returns object with rows
  // Handle both cases for safety
  if (Array.isArray(result)) {
    return result as BufferLogRow[];
  }
  // Fallback for fullResult mode (shouldn't happen with default config)
  const rows = (result as { rows?: unknown[] }).rows ?? [];
  return rows as BufferLogRow[];
}

/**
 * Fetch hot data for a specific dataset and table
 */
export async function fetchHotData(
  conn: TiDBConnection,
  params: {
    dataset_id: string;
    table_name: string;
    from?: number;
    to?: number;
  }
): Promise<BufferLogRow[]> {
  let sql = `
    SELECT id, dataset_id, table_name, period_tag, schema_version, timestamp, data, uploaded_by
    FROM buffer_logs
    WHERE dataset_id = ? AND table_name = ?
  `;
  
  const bindings: (string | number)[] = [params.dataset_id, params.table_name];
  
  if (params.from !== undefined) {
    sql += ' AND timestamp >= ?';
    bindings.push(params.from);
  }
  
  if (params.to !== undefined) {
    sql += ' AND timestamp <= ?';
    bindings.push(params.to);
  }
  
  sql += ' ORDER BY timestamp ASC';
  
  const result = await conn.execute(sql, bindings);
  
  // TiDB SDK: default returns array directly, fullResult:true returns object with rows
  if (Array.isArray(result)) {
    return result as BufferLogRow[];
  }
  const rows = (result as { rows?: unknown[] }).rows ?? [];
  return rows as BufferLogRow[];
}

/**
 * Delete processed buffer logs (cleanup after archiving)
 */
export async function cleanupBuffer(
  conn: TiDBConnection,
  maxId: number
): Promise<{ rowsAffected: number }> {
  const result = await conn.execute(
    'DELETE FROM buffer_logs WHERE id <= ?',
    [maxId]
  );
  
  // TiDB SDK returns FullResult with rowsAffected for DELETE
  const rowsAffected = (result as { rowsAffected?: number }).rowsAffected ?? 0;
  return { rowsAffected };
}

/**
 * Execute with retry for transient failures
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const isRetryable = 
        e.code === 'LOCK_WRITE_CONFLICT' ||
        e.message?.includes('connection') ||
        e.message?.includes('timeout');
      
      if (isRetryable && i < maxRetries - 1) {
        // Exponential backoff: 100ms, 200ms, 400ms
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, i)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Unreachable');
}
