import {
  createTursoClientFromEnv,
  bulkInsertActive,
  countProcessingRows,
  swapTables,
  fetchProcessingRows,
  fetchHotRows,
  resetProcessingTable,
  BufferLogRecord,
} from "./turso-client";

export interface UnifiedDbEnv {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  BATTLE_INDEX_DB: D1Database;
}

export type { BufferLogRecord };

export async function insertBufferLogs(
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
): Promise<{ source: "turso"; insertedCount: number }> {
  const client = createTursoClientFromEnv(env);
  const result = await bulkInsertActive(client, records);
  return {
    source: "turso",
    insertedCount: result.insertedCount,
  };
}

export async function fetchProcessingBufferedData(
  env: UnifiedDbEnv,
): Promise<{ rows: BufferLogRecord[]; source: "turso" }> {
  const client = createTursoClientFromEnv(env);
  const processingCount = await countProcessingRows(client);
  if (processingCount === 0) {
    await swapTables(client);
  }

  const rows = await fetchProcessingRows(client);
  return {
    rows,
    source: "turso",
  };
}

export async function cleanupProcessingBuffer(
  env: UnifiedDbEnv,
): Promise<{ source: "turso"; rowsAffected: number }> {
  const client = createTursoClientFromEnv(env);
  const before = await countProcessingRows(client);
  await resetProcessingTable(client);
  return {
    source: "turso",
    rowsAffected: before,
  };
}

export async function fetchHotData(
  env: UnifiedDbEnv,
  params: {
    dataset_id: string;
    table_name: string;
    from?: number;
    to?: number;
    table_version?: string;
  },
): Promise<{ rows: BufferLogRecord[]; source: "turso" }> {
  const client = createTursoClientFromEnv(env);
  const rows = await fetchHotRows(client, params);
  return {
    rows,
    source: "turso",
  };
}
