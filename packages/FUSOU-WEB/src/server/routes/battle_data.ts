import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { createEnvContext, getEnv } from "../utils";
import { handleTwoStageUpload } from "../utils/upload";
import { validateOffsetMetadata } from "../validators/offsets";
import { validateAvroOCF, extractSchemaFromOCF } from "../utils/avro-validator";

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Convert Uint8Array to base64 string (Cloudflare Workers compatible)
 * Uses chunks to avoid O(n²) string concatenation
 */
function arrayBufferToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Lightweight Avro header validation (DoS prevention)
 * Checks magic bytes, codec, and size limit before expensive decode
 */
function validateAvroHeader(data: Uint8Array, maxBytes: number = 65536): { valid: boolean; error?: string } {
  // Size limit (default 64KB)
  if (data.byteLength > maxBytes) {
    return { valid: false, error: `File too large: ${data.byteLength} bytes (max: ${maxBytes})` };
  }
  
  // Magic bytes: "Obj\x01" (4 bytes)
  if (data.byteLength < 4 || data[0] !== 0x4F || data[1] !== 0x62 || data[2] !== 0x6A || data[3] !== 0x01) {
    return { valid: false, error: 'Invalid Avro magic bytes' };
  }
  
  // Extract codec from header (search for "avro.codec")
  const headerSlice = data.slice(0, Math.min(data.byteLength, 512));
  const text = new TextDecoder().decode(headerSlice);
  const codecIdx = text.indexOf('avro.codec');
  if (codecIdx !== -1) {
    const codecSlice = text.slice(codecIdx, codecIdx + 50);
    // Reject compressed codecs (deflate/snappy) - potential decompression bombs
    if (codecSlice.includes('deflate') || codecSlice.includes('snappy')) {
      return { valid: false, error: 'Compressed Avro not supported (codec must be null)' };
    }
  }
  
  return { valid: true };
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
      const schemaVersion = typeof body?.schema_version === "string"
        ? body.schema_version.trim()
        : typeof body?.schemaVersion === "string"
          ? body.schemaVersion.trim()
          : "v1";
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
          schema_version: schemaVersion,
        },
      };
    },
    executionProcessor: async (tokenPayload, data, user) => {
      const datasetId = tokenPayload.dataset_id as string;
      const table = tokenPayload.table as string;
      const periodTag = (tokenPayload as any).period_tag as string;
      let tableOffsets = (tokenPayload as any).table_offsets as string | null;
      const schemaVersion = (tokenPayload as any).schema_version as string || "v1";

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

        // Get size limit from env (default 64KB)
        const maxBytes = env.buildtime.MAX_BATTLE_SLICE_BYTES
          ? parseInt(env.buildtime.MAX_BATTLE_SLICE_BYTES, 10)
          : 65536;

        const messages: any[] = [];
        if (Array.isArray(offsets) && offsets.length) {
          // Split by provided offsets and validate each slice
          for (const entry of offsets) {
            const start = Number(entry.start_byte ?? 0);
            const len = Number(entry.byte_length ?? 0);
            const tname = String(entry.table_name ?? table);
            if (len <= 0) continue;
            
            const slice = data.subarray(start, start + len);
            
            // Lightweight header validation (DoS prevention)
            const headerCheck = validateAvroHeader(slice, maxBytes);
            if (!headerCheck.valid) {
              console.error(`[battle-data] Invalid Avro header for ${tname}:`, headerCheck.error);
              return c.json({ error: `Invalid Avro data: ${headerCheck.error}` }, 400);
            }
            
            // Extract schema and validate via full decode
            const schemaJson = extractSchemaFromOCF(slice);
            if (!schemaJson) {
              console.error(`[battle-data] Failed to extract schema from ${tname}`);
              return c.json({ error: 'Invalid Avro: schema not found in header' }, 400);
            }
            
            const decodeResult = await validateAvroOCF(slice, schemaJson);
            if (!decodeResult.valid) {
              console.error(`[battle-data] Decode validation failed for ${tname}:`, decodeResult.error);
              return c.json({ 
                error: 'Schema validation failed', 
                details: decodeResult.error 
              }, 400);
            }
            
            console.info(`[battle-data] Validated ${tname}: ${decodeResult.recordCount} records`);
            
            const b64 = arrayBufferToBase64(slice);
            messages.push({
              body: {
                table: tname,
                avro_base64: b64,
                datasetId,
                periodTag,
                schemaVersion,
                triggeredAt,
                userId: user.id,
              },
            });
          }
        } else {
          // No offsets: treat entire payload as single table slice
          
          // Lightweight header validation
          const headerCheck = validateAvroHeader(data, maxBytes);
          if (!headerCheck.valid) {
            console.error('[battle-data] Invalid Avro header:', headerCheck.error);
            return c.json({ error: `Invalid Avro data: ${headerCheck.error}` }, 400);
          }
          
          // Extract schema and validate via full decode
          const schemaJson = extractSchemaFromOCF(data);
          if (!schemaJson) {
            console.error('[battle-data] Failed to extract schema from payload');
            return c.json({ error: 'Invalid Avro: schema not found in header' }, 400);
          }
          
          const decodeResult = await validateAvroOCF(data, schemaJson);
          if (!decodeResult.valid) {
            console.error('[battle-data] Decode validation failed:', decodeResult.error);
            return c.json({ 
              error: 'Schema validation failed', 
              details: decodeResult.error 
            }, 400);
          }
          
          console.info(`[battle-data] Validated ${table}: ${decodeResult.recordCount} records`);
          
          const b64 = arrayBufferToBase64(data);
          messages.push({
            body: {
              table,
              avro_base64: b64,
              datasetId,
              periodTag,
              schemaVersion,
              triggeredAt,
              userId: user.id,
            },
          });
        }

        if (messages.length) {
          try {
            console.info('[battle-data] Sending', messages.length, 'messages to COMPACTION_QUEUE');
            await env.runtime.COMPACTION_QUEUE.sendBatch(messages);
            console.info('[battle-data] Successfully enqueued', messages.length, 'Avro slices to COMPACTION_QUEUE');
          } catch (sendBatchErr) {
            console.error('[battle-data] FAILED at sendBatch', {
              error: String(sendBatchErr),
              messageCount: messages.length,
              firstMessageKeys: messages[0] ? Object.keys(messages[0]) : null,
              firstMessageBodyKeys: messages[0]?.body ? Object.keys(messages[0].body) : null,
            });
            throw sendBatchErr;
          }
        } else {
          console.warn('[battle-data] No messages to enqueue');
        }
      } catch (queueErr) {
        console.error('[battle-data] FAILED to enqueue to COMPACTION_QUEUE', { error: String(queueErr), stack: String(queueErr) });
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
    let sql = `SELECT 
           bi.id AS id,
           bi.dataset_id,
           bi.table_name AS table,
           bi.length AS size,
           af.file_path,
           af.created_at,
           bi.start_timestamp,
           bi.end_timestamp,
           bi.record_count
         FROM block_indexes bi
         JOIN archived_files af ON af.id = bi.file_id
         WHERE bi.dataset_id = ? AND bi.table_name = ?`;
    const params: unknown[] = [datasetId, table];

    // Convert ISO8601 to epoch millis if provided
    const fromMs = from ? Date.parse(from) : undefined;
    const toMs = to ? Date.parse(to) : undefined;
    if (fromMs && !Number.isNaN(fromMs)) { sql += ` AND bi.start_timestamp >= ?`; params.push(fromMs); }
    if (toMs && !Number.isNaN(toMs)) { sql += ` AND bi.end_timestamp <= ?`; params.push(toMs); }

    sql += ` ORDER BY bi.start_timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = indexDb.prepare(sql);
    const result = await stmt.bind(...params).all?.();
    if (!result) { throw new Error("D1 returned no results for chunks query"); }

    const rows = (result.results || []) as any[];
    // Map block_indexes to response format
    const chunks = rows.map(r => ({
      id: r.id,
      file_path: r.file_path,
      dataset_id: r.dataset_id,
      table: r.table,
      size: r.size,
      record_count: r.record_count,
      uploaded_at: new Date(r.start_timestamp).toISOString(),
    }));

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
      `SELECT 
         bi.id,
         bi.dataset_id,
         bi.table_name AS table,
         bi.length AS size,
         af.file_path,
         af.created_at,
         bi.start_timestamp,
         bi.record_count
       FROM block_indexes bi
       JOIN archived_files af ON af.id = bi.file_id
       WHERE bi.dataset_id = ? AND bi.table_name = ?
       ORDER BY bi.start_timestamp DESC LIMIT 1`
    );
    const row = await stmt.bind(datasetId, table).first?.();

    if (!row) { return c.json({ error: "No fragments found" }, 404); }

    const latest = {
      id: row.id,
      file_path: row.file_path,
      dataset_id: row.dataset_id,
      table: row.table,
      size: row.size,
      record_count: row.record_count,
      uploaded_at: new Date(Number(row.start_timestamp || 0)).toISOString(),
    };

    c.res.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json({ latest });
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
  const from = c.req.query("from");
  const to = c.req.query("to");
  const limit = Math.min(parseInt(c.req.query("limit") || "1000", 10), 10000);
  const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10));

  if (!table) {
    return c.json({ error: "table is required" }, 400);
  }

  try {
    let sql = `SELECT 
           bi.id,
           bi.dataset_id,
           bi.table_name AS table,
           bi.length AS size,
           af.file_path,
           af.created_at,
           bi.start_timestamp,
           bi.end_timestamp,
           bi.record_count
         FROM block_indexes bi
         JOIN archived_files af ON af.id = bi.file_id
         WHERE bi.table_name = ?`;
    const params: unknown[] = [table];

    const fromMs = from ? Date.parse(from) : undefined;
    const toMs = to ? Date.parse(to) : undefined;
    if (fromMs && !Number.isNaN(fromMs)) { sql += ` AND bi.start_timestamp >= ?`; params.push(fromMs); }
    if (toMs && !Number.isNaN(toMs)) { sql += ` AND bi.end_timestamp <= ?`; params.push(toMs); }

    sql += ` ORDER BY bi.start_timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = indexDb.prepare(sql);
    const result = await stmt.bind(...params).all?.();
    if (!result) { throw new Error("D1 returned no results for global chunks query"); }

    const rows = (result.results || []) as any[];
    const chunks = rows.map(r => ({
      id: r.id,
      file_path: r.file_path,
      dataset_id: r.dataset_id,
      table: r.table,
      size: r.size,
      record_count: r.record_count,
      uploaded_at: new Date(r.start_timestamp).toISOString(),
    }));
    c.res.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json({ chunks, count: chunks.length, table });
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

  if (!table) {
    return c.json({ error: "table is required" }, 400);
  }

  try {
    const stmt = indexDb.prepare(
      `SELECT 
         bi.id,
         bi.dataset_id,
         bi.table_name AS table,
         bi.length AS size,
         af.file_path,
         af.created_at,
         bi.start_timestamp,
         bi.record_count
       FROM block_indexes bi
       JOIN archived_files af ON af.id = bi.file_id
       WHERE bi.table_name = ?
       ORDER BY bi.start_timestamp DESC LIMIT 1`
    );
    const row = await stmt.bind(table).first?.();
    if (!row) { return c.json({ error: "No fragments found" }, 404); }

    const latest = {
      id: row.id,
      file_path: row.file_path,
      dataset_id: row.dataset_id,
      table: row.table,
      size: row.size,
      record_count: row.record_count,
      uploaded_at: new Date(Number(row.start_timestamp || 0)).toISOString(),
    };

    c.res.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json({ latest });
  } catch (err) {
    console.error("[battle_data] Failed to query global latest:", err);
    return c.json({ error: "Failed to retrieve global latest fragment" }, 500);
  }
});

export default app;
