import { Hono } from 'hono';
import type { Bindings } from '../types';
import { createEnvContext, getEnv } from '../utils';

const app = new Hono<{ Bindings: Bindings }>();

// Simple retry helper (rate-limit safe)
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      const isRateLimitError = (error as any)?.message?.includes('429') || (error as any)?.status === 429;
      if (isLastAttempt || !isRateLimitError) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms`, { error: (error as any)?.message });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

type OffsetEntry = { start_byte: number; byte_length: number; table_name?: string };
function validateOffsetMetadata(offsets: any, totalSize: number): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(offsets)) return { valid: false, errors: ['table_offsets must be an array'] };
  let cursor = 0;
  for (const [idx, entry] of offsets.entries()) {
    const start = Number(entry?.start_byte);
    const len = Number(entry?.byte_length);
    if (!Number.isFinite(start) || !Number.isFinite(len)) errors.push(`offset[${idx}] invalid numbers`);
    if (start < cursor) errors.push(`offset[${idx}] overlaps previous slice`);
    if (len <= 0) errors.push(`offset[${idx}] byte_length must be > 0`);
    if (start + len > totalSize) errors.push(`offset[${idx}] exceeds total size`);
    cursor = start + len;
  }
  return { valid: errors.length === 0, errors };
}

// Upload route: accept JSON (file_base64) or binary body, then enqueue Avro slices
app.post("/upload", async (c) => {
  const env = createEnvContext(c);
  const signingSecret = getEnv(env, "BATTLE_DATA_SIGNING_SECRET");
  if (!env.runtime.COMPACTION_QUEUE || !signingSecret) {
    return c.json({ error: "Server misconfiguration: missing COMPACTION_QUEUE or signing secret" }, 500);
  }

  let datasetId = "";
  let table = "";
  let periodTag = "";
  let tableOffsetsStr: string | null = null;
  let dataU8: Uint8Array | null = null;

  // Try JSON first
  const ct = c.req.header('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      const body: any = await c.req.json();
      datasetId = typeof body?.dataset_id === 'string' ? body.dataset_id.trim() : '';
      table = typeof body?.table === 'string' ? body.table.trim() : '';
      periodTag = typeof body?.kc_period_tag === 'string' ? body.kc_period_tag.trim() : '';
      tableOffsetsStr = typeof body?.table_offsets === 'string' ? body.table_offsets.trim() : null;
      const fileB64 = typeof body?.file_base64 === 'string' ? body.file_base64 : null;
      if (fileB64) dataU8 = Uint8Array.from(Buffer.from(fileB64, 'base64'));
    } catch (e) {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
  }

  // Fallback to raw binary
  if (!dataU8) {
    try {
      const buf = await c.req.arrayBuffer();
      dataU8 = new Uint8Array(buf);
    } catch {
      // ignore
    }
  }

  if (!datasetId) datasetId = c.req.query('dataset_id') || '';
  if (!table) table = c.req.query('table') || '';
  if (!periodTag) periodTag = c.req.query('kc_period_tag') || '';
  if (!tableOffsetsStr) tableOffsetsStr = c.req.query('table_offsets') || null;

  if (!datasetId) return c.json({ error: 'dataset_id is required' }, 400);
  if (!table) return c.json({ error: 'table is required' }, 400);
  if (!periodTag) return c.json({ error: 'kc_period_tag is required' }, 400);
  if (!/^[\w\-]+$/.test(periodTag)) return c.json({ error: 'kc_period_tag must contain only alphanumeric characters and hyphens' }, 400);
  if (!dataU8 || dataU8.length === 0) return c.json({ error: 'binary body or file_base64 is required' }, 400);

  // Validate offsets if provided
  let offsets: OffsetEntry[] = [];
  if (tableOffsetsStr) {
    try {
      const parsed = JSON.parse(tableOffsetsStr);
      const { valid, errors } = validateOffsetMetadata(parsed, dataU8.length);
      if (!valid) return c.json({ error: 'Invalid table_offsets', details: errors }, 400);
      offsets = parsed as OffsetEntry[];
    } catch {
      return c.json({ error: 'Malformed table_offsets JSON' }, 400);
    }
  }

  const triggeredAt = new Date().toISOString();
  try {
    const messages: any[] = [];
    if (Array.isArray(offsets) && offsets.length) {
      for (const entry of offsets) {
        const start = Number(entry.start_byte ?? 0);
        const len = Number(entry.byte_length ?? 0);
        const tname = String(entry.table_name ?? table);
        if (len <= 0) continue;
        const slice = dataU8.subarray(start, start + len);
        const b64 = Buffer.from(slice).toString('base64');
        messages.push({ table: tname, avro_base64: b64, datasetId, periodTag, triggeredAt, userId: 'unknown' });
      }
    } else {
      const b64 = Buffer.from(dataU8).toString('base64');
      messages.push({ table, avro_base64: b64, datasetId, periodTag, triggeredAt, userId: 'unknown' });
    }

    if (typeof (env.runtime.COMPACTION_QUEUE as any).sendBatch === 'function') {
      await (env.runtime.COMPACTION_QUEUE as any).sendBatch(messages.map((m) => ({ body: m })));
    } else {
      for (const m of messages) await env.runtime.COMPACTION_QUEUE.send(m);
    }
    console.info(`[battle-data] Enqueued ${messages.length} Avro slices to COMPACTION_QUEUE (dataset=${datasetId}, period=${periodTag})`);
  } catch (err) {
    console.error('[battle-data] FAILED to enqueue slices', { error: String(err) });
    return c.json({ error: 'Failed to enqueue slices' }, 500);
  }

  return c.json({ ok: true, dataset_id: datasetId, table, period_tag: periodTag });
});
 

/**
 * GET /chunks - Retrieve battle data fragments by period
 * Query params: dataset_id, table, from (ISO8601), to (ISO8601)
 * Response: array of fragment metadata sorted by uploaded_at DESC
 * Cache: 60s max-age, 300s stale-while-revalidate
 */
app.get("/chunks", async (c) => {
  const indexDb = c.env.BATTLE_INDEX_DB;

  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const datasetId = c.req.query("dataset_id");
  const table = c.req.query("table");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const limit = Math.min(parseInt(c.req.query("limit") || "1000", 10), 10000);
  const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10));

  if (!datasetId || !table) {
    return c.json({ error: "dataset_id and table are required" }, 400);
  }

  try {
    let sql = `SELECT key, dataset_id, "table" as table, size, etag, uploaded_at, content_hash
           FROM battle_files WHERE dataset_id = ? AND "table" = ?`;
    const params: unknown[] = [datasetId, table];

    if (from) {
      sql += ` AND uploaded_at >= ?`;
      params.push(from);
    }
    if (to) {
      sql += ` AND uploaded_at <= ?`;
      params.push(to);
    }

    sql += ` ORDER BY uploaded_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = indexDb.prepare(sql);
    const result = await stmt.bind(...params).all?.();
    if (!result) {
      throw new Error("D1 returned no results for chunks query");
    }

    const chunks = result.results || [];

    c.res.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json({ chunks, count: chunks.length, dataset_id: datasetId, table });
  } catch (err) {
    console.error("[battle_data] Failed to query chunks:", err);
    return c.json({ error: "Failed to retrieve chunks" }, 500);
  }
});

/**
 * GET /latest - Retrieve latest fragment for dataset/table
 * Query params: dataset_id, table
 * Response: latest fragment metadata (by uploaded_at DESC)
 * Cache: 60s max-age, 300s stale-while-revalidate
 */
app.get("/latest", async (c) => {
  const indexDb = c.env.BATTLE_INDEX_DB;

  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const datasetId = c.req.query("dataset_id");
  const table = c.req.query("table");

  if (!datasetId || !table) {
    return c.json({ error: "dataset_id and table are required" }, 400);
  }

  try {
    const stmt = indexDb.prepare(
      `SELECT key, dataset_id, "table" as table, size, etag, uploaded_at, content_hash
       FROM battle_files WHERE dataset_id = ? AND "table" = ?
       ORDER BY uploaded_at DESC LIMIT 1`
    );
    const result = await stmt.bind(datasetId, table).first?.();

    if (!result) {
      return c.json({ error: "No fragments found" }, 404);
    }

    c.res.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json({ latest: result });
  } catch (err) {
    console.error("[battle_data] Failed to query latest:", err);
    return c.json({ error: "Failed to retrieve latest fragment" }, 500);
  }
});

// GET /health - health check for battle data service
app.get("/health", (c) => {
  return c.json({ status: "ok", service: "battle_data" });
});

/**
 * GET /global/chunks - Retrieve fragments across all users by table/period
 * Query params: table, period_tag, from, to
 * Response: array of fragment metadata sorted by uploaded_at DESC
 */
app.get("/global/chunks", async (c) => {
  const indexDb = c.env.BATTLE_INDEX_DB;
  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const table = c.req.query("table");
  const periodTag = c.req.query("period_tag");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const limit = Math.min(parseInt(c.req.query("limit") || "1000", 10), 10000);
  const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10));

  if (!table || !periodTag) {
    return c.json({ error: "table and period_tag are required" }, 400);
  }

  try {
    let sql = `SELECT key, dataset_id, "table" as table, size, etag, uploaded_at, content_hash
           FROM battle_files WHERE "table" = ? AND period_tag = ?`;
    const params: unknown[] = [table, periodTag];

    if (from) { sql += ` AND uploaded_at >= ?`; params.push(from); }
    if (to) { sql += ` AND uploaded_at <= ?`; params.push(to); }

    sql += ` ORDER BY uploaded_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = indexDb.prepare(sql);
    const result = await stmt.bind(...params).all?.();
    if (!result) { throw new Error("D1 returned no results for global chunks query"); }

    const chunks = result.results || [];
    c.res.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json({ chunks, count: chunks.length, table, period_tag: periodTag });
  } catch (err) {
    console.error("[battle_data] Failed to query global chunks:", err);
    return c.json({ error: "Failed to retrieve global chunks" }, 500);
  }
});

/**
 * GET /global/latest - Latest fragment across all users for table/period
 * Query params: table, period_tag
 */
app.get("/global/latest", async (c) => {
  const indexDb = c.env.BATTLE_INDEX_DB;
  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const table = c.req.query("table");
  const periodTag = c.req.query("period_tag");

  if (!table || !periodTag) {
    return c.json({ error: "table and period_tag are required" }, 400);
  }

  try {
    const stmt = indexDb.prepare(
      `SELECT key, dataset_id, "table" as table, size, etag, uploaded_at, content_hash
       FROM battle_files WHERE "table" = ? AND period_tag = ?
       ORDER BY uploaded_at DESC LIMIT 1`
    );
    const result = await stmt.bind(table, periodTag).first?.();
    if (!result) { return c.json({ error: "No fragments found" }, 404); }

    c.res.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json({ latest: result });
  } catch (err) {
    console.error("[battle_data] Failed to query global latest:", err);
    return c.json({ error: "Failed to retrieve global latest fragment" }, 500);
  }
});

export default app;
