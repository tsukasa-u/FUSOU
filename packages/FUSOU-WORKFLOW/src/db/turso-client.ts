import { createClient } from "@tursodatabase/serverless/compat";

export type TursoClient = ReturnType<typeof createClient>;

export interface TursoEnv {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
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

export interface InsertBufferLogParams {
  dataset_id: string;
  table_name: string;
  period_tag: string;
  table_version: string;
  timestamp: number;
  data: ArrayBuffer | Uint8Array;
  uploaded_by?: string;
  trust_tag?: string;
}

const INSERT_CHUNK_SIZE = 100;
const MAX_RETRIES = 3;

function getRequiredEnv(value: string | undefined, key: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`[Turso] Missing required env: ${key}`);
  }
  return value;
}

function normalizeBlob(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

function normalizeRecord(row: any): BufferLogRecord {
  const blob = row.data as ArrayBuffer | Uint8Array;
  return {
    id: Number(row.id),
    dataset_id: String(row.dataset_id),
    table_name: String(row.table_name),
    period_tag: String(row.period_tag),
    table_version: String(row.table_version),
    timestamp: Number(row.timestamp),
    data: blob,
    uploaded_by: row.uploaded_by ? String(row.uploaded_by) : null,
    trust_tag: row.trust_tag ? String(row.trust_tag) : null,
  };
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /busy|conflict|locked|timeout/i.test(message);
}

async function executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < MAX_RETRIES; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || i === MAX_RETRIES - 1) {
        throw error;
      }
      const delayMs = 100 * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export function createTursoClientFromEnv(env: TursoEnv): TursoClient {
  return createClient({
    url: getRequiredEnv(env.TURSO_DATABASE_URL, "TURSO_DATABASE_URL"),
    authToken: getRequiredEnv(env.TURSO_AUTH_TOKEN, "TURSO_AUTH_TOKEN"),
  });
}

export async function bulkInsertActive(
  client: TursoClient,
  records: InsertBufferLogParams[],
): Promise<{ insertedCount: number }> {
  if (records.length === 0) return { insertedCount: 0 };

  let insertedCount = 0;
  for (let i = 0; i < records.length; i += INSERT_CHUNK_SIZE) {
    const chunk = records.slice(i, i + INSERT_CHUNK_SIZE);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    const sql = `
      INSERT INTO buffer_logs_active
      (dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by, trust_tag)
      VALUES ${placeholders}
    `;

    const args: Array<string | number | Uint8Array | null> = [];
    for (const record of chunk) {
      args.push(
        record.dataset_id,
        record.table_name,
        record.period_tag,
        record.table_version,
        record.timestamp,
        normalizeBlob(record.data),
        record.uploaded_by ?? null,
        record.trust_tag ?? null,
      );
    }

    await executeWithRetry(async () => {
      await client.execute({ sql, args });
    });

    insertedCount += chunk.length;
  }

  return { insertedCount };
}

export async function countProcessingRows(client: TursoClient): Promise<number> {
  const result = await client.execute(
    "SELECT COUNT(*) AS count FROM buffer_logs_processing",
  );
  const value = result.rows[0]?.count;
  return Number(value ?? 0);
}

export async function swapTables(client: TursoClient): Promise<void> {
  await executeWithRetry(async () => {
    await client.batch(
      [
        "ALTER TABLE buffer_logs_active RENAME TO buffer_logs_swap_tmp",
        "ALTER TABLE buffer_logs_processing RENAME TO buffer_logs_active",
        "ALTER TABLE buffer_logs_swap_tmp RENAME TO buffer_logs_processing",
      ],
      "write",
    );
  });
}

export async function fetchProcessingRows(
  client: TursoClient,
): Promise<BufferLogRecord[]> {
  const result = await client.execute(`
    SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by, trust_tag
    FROM buffer_logs_processing
    ORDER BY table_version, table_name, period_tag, dataset_id, id ASC
  `);

  return result.rows.map((row: any) => normalizeRecord(row));
}

export async function fetchHotRows(
  client: TursoClient,
  params: {
    dataset_id: string;
    table_name: string;
    from?: number;
    to?: number;
    table_version?: string;
  },
): Promise<BufferLogRecord[]> {
  let sql = `
    SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by, trust_tag
    FROM buffer_logs_active
    WHERE dataset_id = ? AND table_name = ?
  `;

  const args: Array<string | number> = [params.dataset_id, params.table_name];

  if (params.table_version !== undefined) {
    sql += " AND table_version = ?";
    args.push(params.table_version);
  }
  if (params.from !== undefined) {
    sql += " AND timestamp >= ?";
    args.push(params.from);
  }
  if (params.to !== undefined) {
    sql += " AND timestamp <= ?";
    args.push(params.to);
  }

  sql += `
    UNION ALL
    SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by, trust_tag
    FROM buffer_logs_processing
    WHERE dataset_id = ? AND table_name = ?
  `;

  args.push(params.dataset_id, params.table_name);

  if (params.table_version !== undefined) {
    sql += " AND table_version = ?";
    args.push(params.table_version);
  }
  if (params.from !== undefined) {
    sql += " AND timestamp >= ?";
    args.push(params.from);
  }
  if (params.to !== undefined) {
    sql += " AND timestamp <= ?";
    args.push(params.to);
  }

  sql += " ORDER BY timestamp ASC, id ASC";

  const result = await client.execute({ sql, args });
  return result.rows.map((row: any) => normalizeRecord(row));
}

export async function resetProcessingTable(client: TursoClient): Promise<void> {
  await executeWithRetry(async () => {
    await client.batch(
      [
        "DROP TABLE IF EXISTS buffer_logs_processing",
        `CREATE TABLE buffer_logs_processing (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          dataset_id TEXT NOT NULL,
          table_name TEXT NOT NULL,
          period_tag TEXT NOT NULL DEFAULT 'latest',
          table_version TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          data BLOB NOT NULL,
          uploaded_by TEXT,
          trust_tag TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        )`,
        "CREATE INDEX idx_blp_ordering ON buffer_logs_processing(table_version, table_name, period_tag, dataset_id, id)",
        "CREATE INDEX idx_blp_hot ON buffer_logs_processing(dataset_id, table_name, timestamp)",
      ],
      "write",
    );
  });
}
