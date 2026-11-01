import { createClient } from "@tursodatabase/serverless/compat";
import { normalizeTableVersion, tableVersionAliases } from "../version";

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

function normalizeRecord(row: unknown): BufferLogRecord {
  if (!row || typeof row !== "object") {
    throw new Error("[Turso] Unexpected non-object row");
  }

  const values = row as Record<string, unknown>;
  const blob = values["data"];
  if (!(blob instanceof ArrayBuffer) && !(blob instanceof Uint8Array)) {
    throw new Error("[Turso] Row data is not binary");
  }

  return {
    id: Number(values["id"]),
    dataset_id: String(values["dataset_id"]),
    table_name: String(values["table_name"]),
    period_tag: String(values["period_tag"]),
    table_version: String(values["table_version"]),
    timestamp: Number(values["timestamp"]),
    data: blob,
    uploaded_by: values["uploaded_by"] ? String(values["uploaded_by"]) : null,
    trust_tag: values["trust_tag"] ? String(values["trust_tag"]) : null,
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
  messageId?: string,
): Promise<{ insertedCount: number }> {
  if (records.length === 0) return { insertedCount: 0 };

  if (messageId) {
    const tx = await client.transaction("write");
    try {
      const receipt = await tx.execute({
        sql: "SELECT message_id FROM workflow_queue_receipts WHERE message_id = ?",
        args: [messageId],
      });
      if (receipt.rows.length) {
        await tx.commit();
        return { insertedCount: 0 };
      }
      for (const record of records) {
        await tx.execute({
          sql: `INSERT INTO buffer_logs_active
            (dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by, trust_tag)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            record.dataset_id, record.table_name, record.period_tag,
            normalizeTableVersion(record.table_version), record.timestamp,
            normalizeBlob(record.data), record.uploaded_by ?? null, record.trust_tag ?? null,
          ],
        });
      }
      await tx.execute({
        sql: "INSERT INTO workflow_queue_receipts (message_id, created_at) VALUES (?, ?)",
        args: [messageId, Date.now()],
      });
      await tx.commit();
      return { insertedCount: records.length };
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }

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
        normalizeTableVersion(record.table_version),
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

export async function fetchHotRows(
  client: TursoClient,
  params: {
    dataset_id: string;
    table_name: string;
    from?: number;
    to?: number;
    table_version?: string;
    includeProcessing?: boolean;
  },
): Promise<BufferLogRecord[]> {
  let sql = `
    SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by, trust_tag
    FROM buffer_logs_active
    WHERE dataset_id = ? AND table_name = ?
  `;

  const args: Array<string | number> = [params.dataset_id, params.table_name];

  if (params.table_version !== undefined) {
    const aliases = tableVersionAliases(params.table_version);
    sql += ` AND table_version IN (${aliases.map(() => "?").join(",")})`;
    args.push(...aliases);
  }
  if (params.from !== undefined) {
    sql += " AND timestamp >= ?";
    args.push(params.from);
  }
  if (params.to !== undefined) {
    sql += " AND timestamp <= ?";
    args.push(params.to);
  }

  if (params.includeProcessing !== false) {
    sql += `
      UNION ALL
      SELECT id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by, trust_tag
      FROM buffer_logs_processing
      WHERE dataset_id = ? AND table_name = ?
    `;

    args.push(params.dataset_id, params.table_name);

    if (params.table_version !== undefined) {
      const aliases = tableVersionAliases(params.table_version);
      sql += ` AND table_version IN (${aliases.map(() => "?").join(",")})`;
      args.push(...aliases);
    }
    if (params.from !== undefined) {
      sql += " AND timestamp >= ?";
      args.push(params.from);
    }
    if (params.to !== undefined) {
      sql += " AND timestamp <= ?";
      args.push(params.to);
    }
  }

  sql += " ORDER BY timestamp ASC, id ASC";

  const result = await client.execute({ sql, args });
  return result.rows.map((row) => normalizeRecord(row));
}
