import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { createEnvContext, getEnv } from "../utils";
import { handleTwoStageUpload } from "../utils/upload";

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Battle data server-side upload routes
 * - Uploads to Cloudflare R2 with VARIABLE keys (timestamp + UUID) to prevent overwrites
 * - Indexes fragments in D1 (BATTLE_INDEX_DB) for period-based compaction and querying
 * - Provides REST APIs for chunk retrieval and latest data access
 */

// OPTIONS (CORS)
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

/**
 * POST /upload - 2-stage upload with JWT authentication
 * - Generates variable key: battle_data/{dataset_id}/{table}/{YYYYMMDDHHmmss}-{uuid}.parquet
 * - Stores in R2 BATTLE_DATA_BUCKET
 * - Records fragment metadata in D1 BATTLE_INDEX_DB for indexing
 */
app.post("/upload", async (c) => {
  const env = createEnvContext(c);
  const bucket = env.runtime.BATTLE_DATA_BUCKET;
  const indexDb = env.runtime.BATTLE_INDEX_DB;
  const signingSecret = getEnv(env, "BATTLE_DATA_SIGNING_SECRET");

  if (!bucket || !indexDb || !signingSecret) {
    return c.json({ error: "Server misconfiguration: missing R2 bucket or D1 database" }, 500);
  }

  return handleTwoStageUpload(c, {
    bucket,
    signingSecret,
    preparationValidator: async (body, user) => {
      const datasetId = typeof body?.dataset_id === "string" ? body.dataset_id.trim() : "";
      const table = typeof body?.table === "string" ? body.table.trim() : "";
      const contentHash = typeof body?.content_hash === "string" ? body.content_hash.trim() : "";
      const periodTag = typeof body?.kc_period_tag === "string" ? body.kc_period_tag.trim() : "";
      const declaredSize = parseInt(typeof body?.file_size === "string" ? body.file_size : "0", 10);
      const tableOffsets = typeof body?.table_offsets === "string" ? body.table_offsets.trim() : null;

      if (!datasetId) {
        return c.json({ error: "dataset_id is required" }, 400);
      }
      if (!table) {
        return c.json({ error: "table is required" }, 400);
      }
      if (!contentHash) {
        return c.json({ error: "content_hash (SHA-256) is required" }, 400);
      }
      if (!periodTag) {
        return c.json({ error: "kc_period_tag is required" }, 400);
      }
      if (declaredSize <= 0) {
        return c.json({ error: "file_size must be > 0" }, 400);
      }

      // Generate variable key with timestamp + UUID to prevent overwrites
      const now = new Date();
      const timestamp = now.toISOString().replace(/[^\d]/g, "").slice(0, 14); // YYYYMMDDHHmmss
      const uuid = crypto.randomUUID();
      const variableKey = `battle_data/${datasetId}/${table}/${timestamp}-${uuid}.parquet`;

      return {
        tokenPayload: {
          key: variableKey,
          dataset_id: datasetId,
          table,
          content_hash: contentHash,
          declared_size: declaredSize,
          period_tag: periodTag,
          table_offsets: tableOffsets,
        },
      };
    },
    executionProcessor: async (tokenPayload, data, user) => {
      const key = tokenPayload.key;
      const datasetId = tokenPayload.dataset_id;
      const table = tokenPayload.table;
      const contentHash = tokenPayload.content_hash;
      const periodTag = (tokenPayload as any).period_tag as string;
      const tableOffsets = (tokenPayload as any).table_offsets as string | null;
      if (!key || !datasetId || !table) {
        return c.json({ error: "Invalid token payload" }, 400);
      }

      // Upload to R2
      const result = await bucket.put(key, data, {
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "immutable",
        },
        customMetadata: {
          uploaded_by: user.id,
          dataset_id: datasetId,
          table,
          period_tag: periodTag,
        },
      });

      const actualSize = result?.size || data.length;
      const etag = result?.etag || "";
      const uploadedAt = new Date().toISOString();

      // Record fragment metadata in D1 for indexing
      try {
        const stmt = indexDb.prepare(
          `INSERT INTO battle_files (key, dataset_id, "table", period_tag, size, etag, uploaded_at, content_hash, uploaded_by, table_offsets)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        await stmt
          .bind(key, datasetId, table, periodTag, actualSize, etag, uploadedAt, contentHash, user.id, tableOffsets)
          .run();
      } catch (err) {
        console.error("[battle_data] Failed to record fragment in D1:", err);
        return c.json({ error: "Failed to record fragment metadata" }, 500);
      }

      return {
        response: { ok: true, key, size: actualSize, uploaded_at: uploadedAt },
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
