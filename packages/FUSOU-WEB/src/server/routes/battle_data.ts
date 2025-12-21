import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { createEnvContext, getEnv } from "../utils";
import { handleTwoStageUpload } from "../utils/upload";
import { validateOffsetMetadata } from "../validators/offsets";

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Retry utility for handling rate limits and transient errors
 * Implements exponential backoff to respect Supabase Free tier limits
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      const isRateLimitError =
        (error as any)?.message?.includes('429') ||
        (error as any)?.message?.includes('Too Many Requests') ||
        (error as any)?.status === 429;

      if (isLastAttempt || !isRateLimitError) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[battle-data] Retry: Attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
        error: (error as any)?.message,
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * Battle data server-side upload routes
 * - Does NOT upload to R2 (per spec: enqueue-only)
 * - Enqueues Avro slices to COMPACTION_QUEUE
 * - Provides REST APIs for chunk retrieval and latest data access
 */

// OPTIONS (CORS)
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

/**
 * POST /upload - Real-time battle data upload with automatic compaction triggering
 * 
 * Purpose: Accept concatenated Avro data, split by table_offsets, and enqueue slices
 * 
 * Process:
 * 1. Split concatenated Avro data by table_offsets
 * 2. Enqueue each table's slice to COMPACTION_QUEUE
 * 3. Return 200 OK immediately (non-blocking)
 * 4. Workflow processes slices asynchronously, appending to per-table Avro files in R2
 * 
 * Note: Queuing failures are logged; upload still succeeds if data was received
 */
app.post("/upload", async (c) => {
  const env = createEnvContext(c);
  const bucket = env.runtime.BATTLE_DATA_BUCKET;
  const signingSecret = getEnv(env, "BATTLE_DATA_SIGNING_SECRET");

  if (!bucket || !signingSecret) {
    return c.json({ error: "Server misconfiguration: missing R2 bucket or signing secret" }, 500);
  }

  return handleTwoStageUpload(c, {
    bucket,
    signingSecret,
    preparationValidator: async (body, _user) => {
      const datasetId = typeof body?.dataset_id === "string" ? body.dataset_id.trim() : "";
      const table = typeof body?.table === "string" ? body.table.trim() : "";
      const periodTag = typeof body?.kc_period_tag === "string" ? body.kc_period_tag.trim() : "";
      const declaredSize = parseInt(typeof body?.file_size === "string" ? body.file_size : "0", 10);
      const tableOffsets = typeof body?.table_offsets === "string" ? body.table_offsets.trim() : null;
      const pathTag = typeof body?.path === "string" ? body.path.trim() : null;
      const isBinary = typeof body?.binary === "boolean" ? body.binary : false;

      // Verify that client indicated binary format
      if (!isBinary) {
        console.warn("[battle-data] Rejecting non-binary upload");
        return c.json({ error: "binary field must be true for battle data" }, 400);
      }

      if (!pathTag) {
        console.warn("[battle-data] Rejecting upload without path field");
        return c.json({ error: "path is required for battle data" }, 400);
      }

      if (!datasetId) {
        return c.json({ error: "dataset_id is required" }, 400);
      }
      if (!table) {
        return c.json({ error: "table is required" }, 400);
      }
      if (!periodTag) {
        return c.json({ error: "kc_period_tag is required" }, 400);
      }
      if (!/^[\w\-]+$/.test(periodTag)) {
        return c.json({ error: "kc_period_tag must contain only alphanumeric characters and hyphens" }, 400);
      }
      if (declaredSize <= 0) {
        return c.json({ error: "file_size must be > 0" }, 400);
      }

      // Get content_hash from body (computed by client)
      const contentHash = typeof body?.content_hash === "string" ? body.content_hash.trim() : "";
      if (!contentHash) {
        console.warn("[battle-data] Rejecting upload without content_hash");
        return c.json({ error: "content_hash is required" }, 400);
      }

      // Validate table_offsets if provided
      if (tableOffsets) {
        try {
          console.info(`[battle-data] Received table_offsets for ${table}: ${tableOffsets}`);
          const parsed = JSON.parse(tableOffsets);
          console.info(`[battle-data] Parsed table_offsets (${parsed.length} tables): ${JSON.stringify(parsed.map((p: any) => p.table_name))}`);
          const { valid, errors } = validateOffsetMetadata(parsed, declaredSize);
          if (!valid) {
            console.warn(`[battle-data] Invalid table_offsets provided; rejecting. Errors: ${errors.join(', ')}`);
            return c.json({ error: "Invalid table_offsets", details: errors }, 400);
          }
        } catch (e) {
          console.warn(`[battle-data] Failed to parse table_offsets; rejecting. Error: ${String(e)}`);
          return c.json({ error: "Malformed table_offsets JSON" }, 400);
        }
      } else {
        console.info(`[battle-data] No table_offsets provided for table '${table}'`);
      }

      return {
        tokenPayload: {
          dataset_id: datasetId,
          table,
          period_tag: periodTag,
          declared_size: declaredSize,
          table_offsets: tableOffsets,
          content_hash: contentHash,
          path_tag: pathTag,
        },
      };
    },
    executionProcessor: async (tokenPayload, data, user) => {
      const datasetId = tokenPayload.dataset_id as string;
      const table = tokenPayload.table as string;
      const periodTag = (tokenPayload as any).period_tag as string;
      let tableOffsets = (tokenPayload as any).table_offsets as string | null;

      const triggeredAt = new Date().toISOString();

      console.info("[battle-data] Step: About to enqueue to COMPACTION_QUEUE", {
        datasetId,
        table,
        periodTag,
        queueExists: !!env.runtime.COMPACTION_QUEUE,
        timestamp: triggeredAt,
      });

      try {
        if (!env.runtime.COMPACTION_QUEUE) {
          console.warn("[battle-data] COMPACTION_QUEUE binding not available");
          return c.json({ error: "Server misconfiguration: COMPACTION_QUEUE not available" }, 500);
        }

        // Parse table_offsets and split data into per-table Avro slices
        let offsets: any[] = [];
        if (tableOffsets) {
          try {
            offsets = JSON.parse(tableOffsets) as any[];
          } catch (e) {
            console.warn('[battle-data] Failed to parse table_offsets for queue split', e);
            offsets = [];
          }
        }

        const messages: any[] = [];
        if (Array.isArray(offsets) && offsets.length) {
          // Split by provided offsets
          for (const entry of offsets) {
            const start = Number(entry.start_byte ?? 0);
            const len = Number(entry.byte_length ?? 0);
            const tname = String(entry.table_name ?? table);
            if (len <= 0) continue;
            const slice = data.subarray(start, start + len);
            const b64 = Buffer.from(slice).toString('base64');
            messages.push({
              body: {
                table: tname,
                avro_base64: b64,
                datasetId,
                periodTag,
                triggeredAt,
                userId: user.id,
              },
            });
          }
        } else {
          // No offsets: treat entire payload as single table slice
          const b64 = Buffer.from(data).toString('base64');
          messages.push({
            body: {
              table,
              avro_base64: b64,
              datasetId,
              periodTag,
              triggeredAt,
              userId: user.id,
            },
          });
        }

        if (messages.length) {
          await withRetry(async () => {
            // Cloudflare Queue sendBatch expects array of message bodies (not wrapped in {body: ...})
            console.info('[battle-data] Sending', messages.length, 'messages to COMPACTION_QUEUE');
            const bodies = messages.map(m => m.body);
            await env.runtime.COMPACTION_QUEUE.sendBatch(bodies);
            return { ok: true };
          });
          console.info('[battle-data] Successfully enqueued', messages.length, 'Avro slices to COMPACTION_QUEUE');
        } else {
          console.warn('[battle-data] No messages to enqueue');
        }
      } catch (queueErr) {
        console.error('[battle-data] FAILED to enqueue to COMPACTION_QUEUE', { error: String(queueErr) });
        return c.json({ error: 'Failed to enqueue slices' }, 500);
      }

      return {
        response: { ok: true, dataset_id: datasetId, table, period_tag: periodTag },
      };
    },
  });
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
