import { Hono } from "hono";
import type { Bindings } from "../types";
import { createEnvContext, getEnv, timingSafeEqual } from "../utils";
import { getLatestAllowedPeriodTag } from "../utils/period-tags";

const app = new Hono<{ Bindings: Bindings }>();

type CompactionTier = "hourly" | "daily" | "weekly" | "period";

type InternalAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

const EXCLUDED_COMPACTION_TABLE_VERSIONS = [
  "0.0.0",
  "0.1.0",
  "0.4",
  "0.5",
] as const;

function verifyInternalToken(
  c: { env: Bindings; req: { header: (name: string) => string | undefined } },
): InternalAuthResult {
  const env = createEnvContext(c);
  const expected = getEnv(env, "INTERNAL_COMPACTION_TOKEN");
  if (!expected) {
    return {
      ok: false,
      status: 403,
      error: "Endpoint disabled (INTERNAL_COMPACTION_TOKEN not set)",
    };
  }

  const provided = c.req.header("X-INTERNAL-TOKEN") ?? "";
  if (!timingSafeEqual(provided, expected)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}

function isTier(value: unknown): value is CompactionTier {
  return (
    value === "hourly" ||
    value === "daily" ||
    value === "weekly" ||
    value === "period"
  );
}

function decodeAvroLong(
  buffer: Uint8Array,
  offset: number,
): { value: number; offset: number } {
  let n = 0;
  let shift = 0;
  let b: number;
  let pos = offset;
  do {
    if (pos >= buffer.length) {
      throw new Error("Avro buffer overrun while parsing header");
    }
    b = buffer[pos++];
    n |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  return { value: (n >>> 1) ^ -(n & 1), offset: pos };
}

function getAvroHeaderLengthFromPrefix(buffer: Uint8Array): number {
  if (buffer.length < 4) {
    throw new Error("Buffer too small for Avro header");
  }
  if (
    buffer[0] !== 0x4f ||
    buffer[1] !== 0x62 ||
    buffer[2] !== 0x6a ||
    buffer[3] !== 0x01
  ) {
    throw new Error("Invalid Avro magic bytes");
  }

  let offset = 4;
  const blockCount = decodeAvroLong(buffer, offset);
  offset = blockCount.offset;

  if (blockCount.value === 0) {
    return offset + 16;
  }

  let remaining = blockCount.value;
  while (remaining > 0) {
    const keyLen = decodeAvroLong(buffer, offset);
    offset = keyLen.offset + keyLen.value;

    const valueLen = decodeAvroLong(buffer, offset);
    offset = valueLen.offset + valueLen.value;
    remaining -= 1;
  }

  const endMarker = decodeAvroLong(buffer, offset);
  offset = endMarker.offset;

  return offset + 16;
}

app.post("/list-source-blocks", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime.BATTLE_INDEX_DB as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const tier = body?.tier;
  const tableName = String(body?.table_name ?? "").trim();
  const periodTag = String(body?.period_tag ?? "").trim();
  const tableVersion = String(body?.table_version ?? "").trim();
  const cursorId = Number.isFinite(Number(body?.cursor_id))
    ? Number(body.cursor_id)
    : 0;
  const limitRaw = Number(body?.limit ?? 200);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(500, Math.trunc(limitRaw)))
    : 200;

  if (!isTier(tier)) return c.json({ error: "tier is invalid" }, 400);
  if (!tableName) return c.json({ error: "table_name is required" }, 400);
  if (!periodTag) return c.json({ error: "period_tag is required" }, 400);

  let sql = `SELECT
    bi.id,
    bi.dataset_id,
    bi.table_name,
    bi.table_version,
    bi.period_tag,
    bi.start_byte,
    bi.length,
    bi.record_count,
    bi.start_timestamp,
    bi.end_timestamp,
    bi.compaction_tier,
    bi.window_start_ms,
    bi.window_end_ms,
    af.id AS file_id,
    af.file_path,
    af.file_size
  FROM block_indexes bi
  JOIN archived_files af ON af.id = bi.file_id
  WHERE bi.compaction_tier = ?
    AND bi.table_name = ?
    AND bi.period_tag = ?
    AND bi.table_version NOT IN (${EXCLUDED_COMPACTION_TABLE_VERSIONS.map(() => "?").join(", ")})
    AND bi.id > ?`;

  const params: Array<string | number> = [
    tier,
    tableName,
    periodTag,
    ...EXCLUDED_COMPACTION_TABLE_VERSIONS,
    cursorId,
  ];

  if (tableVersion) {
    sql += " AND bi.table_version = ?";
    params.push(tableVersion);
  }

  if (Number.isFinite(Number(body?.window_start_ms))) {
    const windowStart = Number(body.window_start_ms);
    sql +=
      " AND ((bi.window_start_ms IS NOT NULL AND bi.window_start_ms >= ?) OR (bi.window_start_ms IS NULL AND bi.start_timestamp >= ?))";
    params.push(windowStart, windowStart);
  }

  if (Number.isFinite(Number(body?.window_end_ms))) {
    const windowEnd = Number(body.window_end_ms);
    sql +=
      " AND ((bi.window_end_ms IS NOT NULL AND bi.window_end_ms <= ?) OR (bi.window_end_ms IS NULL AND bi.end_timestamp <= ?))";
    params.push(windowEnd, windowEnd);
  }

  sql += " ORDER BY bi.id ASC LIMIT ?";
  params.push(limit);

  const rows = (await db
    .prepare(sql)
    .bind(...params)
    .all()) as { results?: Array<Record<string, unknown>> };

  const results = rows.results ?? [];
  const nextCursor =
    results.length > 0
      ? Number(results[results.length - 1]?.id ?? cursorId)
      : cursorId;

  return c.json({
    success: true,
    count: results.length,
    cursor_id: cursorId,
    next_cursor_id: nextCursor,
    has_more: results.length === limit,
    blocks: results,
  });
});

app.post("/list-source-groups", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime.BATTLE_INDEX_DB as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const tier = body?.tier;
  const tableName = String(body?.table_name ?? "").trim();
  const windowStart = Number(body?.window_start_ms);
  const windowEnd = Number(body?.window_end_ms);

  if (!isTier(tier)) return c.json({ error: "tier is invalid" }, 400);
  if (!tableName) return c.json({ error: "table_name is required" }, 400);
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    return c.json({ error: "window_start_ms and window_end_ms are required" }, 400);
  }

  const rows = (await db
    .prepare(
      `SELECT
         bi.period_tag,
         bi.table_version,
         COUNT(*) AS source_blocks
       FROM block_indexes bi
       WHERE bi.compaction_tier = ?
         AND bi.table_name = ?
         AND ((bi.window_start_ms IS NOT NULL AND bi.window_start_ms >= ?) OR (bi.window_start_ms IS NULL AND bi.start_timestamp >= ?))
         AND ((bi.window_end_ms IS NOT NULL AND bi.window_end_ms <= ?) OR (bi.window_end_ms IS NULL AND bi.end_timestamp <= ?))
         AND bi.period_tag IS NOT NULL
         AND bi.period_tag != ''
         AND bi.table_version IS NOT NULL
         AND bi.table_version != ''
         AND bi.table_version NOT IN (${EXCLUDED_COMPACTION_TABLE_VERSIONS.map(() => "?").join(", ")})
       GROUP BY bi.period_tag, bi.table_version
       ORDER BY bi.period_tag DESC, bi.table_version DESC`,
    )
    .bind(
      tier,
      tableName,
      windowStart,
      windowStart,
      windowEnd,
      windowEnd,
      ...EXCLUDED_COMPACTION_TABLE_VERSIONS,
    )
    .all()) as {
    results?: Array<{
      period_tag?: string | null;
      table_version?: string | null;
      source_blocks?: number;
    }>;
  };

  const groups = (rows.results ?? [])
    .map((row) => ({
      period_tag: typeof row.period_tag === "string" ? row.period_tag : "",
      table_version: typeof row.table_version === "string" ? row.table_version : "",
      source_blocks: Number(row.source_blocks ?? 0),
    }))
    .filter((row) => row.period_tag.length > 0 && row.table_version.length > 0);

  return c.json({
    success: true,
    count: groups.length,
    groups,
  });
});

app.post("/list-source-tables", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime.BATTLE_INDEX_DB as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const tier = body?.tier;
  const windowStart = Number(body?.window_start_ms);
  const windowEnd = Number(body?.window_end_ms);

  if (!isTier(tier)) return c.json({ error: "tier is invalid" }, 400);

  let sql = `SELECT DISTINCT
      bi.table_name
    FROM block_indexes bi
    WHERE bi.compaction_tier = ?
      AND bi.table_name IS NOT NULL
      AND bi.table_name != ''
      AND bi.table_version IS NOT NULL
      AND bi.table_version != ''
      AND bi.table_version NOT IN (${EXCLUDED_COMPACTION_TABLE_VERSIONS.map(() => "?").join(", ")})`;

  const params: Array<string | number> = [tier, ...EXCLUDED_COMPACTION_TABLE_VERSIONS];

  if (Number.isFinite(windowStart)) {
    sql +=
      " AND ((bi.window_start_ms IS NOT NULL AND bi.window_start_ms >= ?) OR (bi.window_start_ms IS NULL AND bi.start_timestamp >= ?))";
    params.push(windowStart, windowStart);
  }

  if (Number.isFinite(windowEnd)) {
    sql +=
      " AND ((bi.window_end_ms IS NOT NULL AND bi.window_end_ms <= ?) OR (bi.window_end_ms IS NULL AND bi.end_timestamp <= ?))";
    params.push(windowEnd, windowEnd);
  }

  sql += " ORDER BY bi.table_name ASC";

  const rows = (await db
    .prepare(sql)
    .bind(...params)
    .all()) as {
    results?: Array<{
      table_name?: string | null;
    }>;
  };

  const tables = (rows.results ?? [])
    .map((row) => (typeof row.table_name === "string" ? row.table_name.trim() : ""))
    .filter(Boolean);

  return c.json({
    success: true,
    count: tables.length,
    tables,
  });
});

app.post("/resolve-source-window-range", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime.BATTLE_INDEX_DB as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const tier = body?.tier;
  const tableNames = Array.isArray(body?.table_names)
    ? body.table_names.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
    : [];

  if (!isTier(tier)) return c.json({ error: "tier is invalid" }, 400);
  if (tableNames.length === 0) {
    return c.json({ error: "table_names is required" }, 400);
  }

  const placeholders = tableNames.map(() => "?").join(", ");
  const rows = (await db
    .prepare(
      `SELECT
         MIN(COALESCE(bi.window_start_ms, bi.start_timestamp)) AS start_ms,
         MAX(COALESCE(bi.window_end_ms, bi.end_timestamp)) AS end_ms
       FROM block_indexes bi
       WHERE bi.compaction_tier = ?
         AND bi.table_name IN (${placeholders})
         AND bi.table_version NOT IN (${EXCLUDED_COMPACTION_TABLE_VERSIONS.map(() => "?").join(", ")})`,
    )
    .bind(tier, ...tableNames, ...EXCLUDED_COMPACTION_TABLE_VERSIONS)
    .all()) as {
    results?: Array<{
      start_ms?: number | null;
      end_ms?: number | null;
    }>;
  };

  const row = rows.results?.[0] ?? {};
  const startMs = Number(row.start_ms);
  const endMs = Number(row.end_ms);

  return c.json({
    success: true,
    start_ms: Number.isFinite(startMs) ? startMs : null,
    end_ms: Number.isFinite(endMs) ? endMs : null,
  });
});

app.post("/fetch-block-ocf", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const bucket = env.runtime.BATTLE_DATA_BUCKET as R2Bucket | undefined;
  if (!bucket) return c.json({ error: "BATTLE_DATA_BUCKET not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const filePath = String(body?.file_path ?? "").trim();
  const startByte = Number(body?.start_byte);
  const length = Number(body?.length);

  if (!filePath) return c.json({ error: "file_path is required" }, 400);
  if (!Number.isFinite(startByte) || startByte < 0) {
    return c.json({ error: "start_byte is invalid" }, 400);
  }
  if (!Number.isFinite(length) || length <= 0) {
    return c.json({ error: "length is invalid" }, 400);
  }

  const prefixObject = await bucket.get(filePath, {
    range: { offset: 0, length: startByte },
  });
  if (!prefixObject?.body) {
    return c.json({ error: "header range not found" }, 404);
  }

  const dataObject = await bucket.get(filePath, {
    range: { offset: startByte, length },
  });
  if (!dataObject?.body) {
    return c.json({ error: "data range not found" }, 404);
  }

  const prefixBytes = new Uint8Array(await prefixObject.arrayBuffer());
  const headerLength = getAvroHeaderLengthFromPrefix(prefixBytes);
  const headerBytes = prefixBytes.slice(0, headerLength);
  const dataBytes = new Uint8Array(await dataObject.arrayBuffer());
  const combined = new Uint8Array(headerBytes.byteLength + dataBytes.byteLength);
  combined.set(headerBytes, 0);
  combined.set(dataBytes, headerBytes.byteLength);

  return new Response(combined, {
    headers: {
      "Content-Type": "application/avro",
      "Content-Length": String(combined.byteLength),
    },
  });
});

app.post("/verify-output-visible", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const bucket = env.runtime.BATTLE_DATA_BUCKET as R2Bucket | undefined;
  if (!bucket) return c.json({ error: "BATTLE_DATA_BUCKET not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const filePath = String(body?.file_path ?? "").trim();
  if (!filePath) return c.json({ error: "file_path is required" }, 400);

  const obj = await bucket.head(filePath);
  if (!obj) {
    return c.json({ success: false, visible: false, file_path: filePath }, 404);
  }

  return c.json({
    success: true,
    visible: true,
    file_path: filePath,
    size: Number(obj.size ?? 0),
    etag: obj.etag ?? null,
  });
});

app.post("/acquire-output-lock", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime.BATTLE_INDEX_DB as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const filePath = String(body?.file_path ?? "").trim();
  const lockToken = String(body?.lock_token ?? "").trim();
  const tableVersion = String(body?.table_version ?? "").trim();
  const compactionTier = body?.compaction_tier;
  const sourceTier = String(body?.source_tier ?? "").trim();
  const windowStart = Number(body?.window_start_ms);
  const windowEnd = Number(body?.window_end_ms);
  const runKey = String(body?.run_key ?? "").trim();
  const lockTtlMsRaw = Number(body?.lock_ttl_ms);
  const lockTtlMs = Number.isFinite(lockTtlMsRaw)
    ? Math.max(30_000, Math.min(24 * 60 * 60_000, Math.trunc(lockTtlMsRaw)))
    : 6 * 60 * 60_000;

  if (!filePath) return c.json({ error: "file_path is required" }, 400);
  if (!lockToken) return c.json({ error: "lock_token is required" }, 400);
  if (!tableVersion) return c.json({ error: "table_version is required" }, 400);
  if (!isTier(compactionTier)) return c.json({ error: "compaction_tier is invalid" }, 400);
  if (!sourceTier) return c.json({ error: "source_tier is required" }, 400);
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    return c.json({ error: "window_start_ms and window_end_ms are required" }, 400);
  }

  const now = Date.now();
  const lockExpiresMs = now + lockTtlMs;

  await db
    .prepare(
      `INSERT OR IGNORE INTO archived_files (
        file_path, file_size, compression_codec, created_at, last_modified_at,
        table_version, compaction_tier, window_start_ms, window_end_ms, source_tier,
        lock_token, lock_expires_ms, lock_owner_run_key
      ) VALUES (?, 0, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      filePath,
      now,
      now,
      tableVersion,
      compactionTier,
      windowStart,
      windowEnd,
      sourceTier,
      lockToken,
      lockExpiresMs,
      runKey || null,
    )
    .run();

  await db
    .prepare(
      `UPDATE archived_files
       SET lock_token = ?, lock_expires_ms = ?, lock_owner_run_key = ?,
           table_version = ?, compaction_tier = ?, window_start_ms = ?, window_end_ms = ?,
           source_tier = ?, last_modified_at = ?
       WHERE file_path = ?
         AND (
           lock_token IS NULL OR lock_token = '' OR lock_expires_ms IS NULL OR lock_expires_ms < ? OR lock_token = ?
         )`,
    )
    .bind(
      lockToken,
      lockExpiresMs,
      runKey || null,
      tableVersion,
      compactionTier,
      windowStart,
      windowEnd,
      sourceTier,
      now,
      filePath,
      now,
      lockToken,
    )
    .run();

  const owner = (await db
    .prepare(
      `SELECT lock_token, lock_expires_ms, lock_owner_run_key
       FROM archived_files
       WHERE file_path = ?
       LIMIT 1`,
    )
    .bind(filePath)
    .first()) as {
      lock_token?: string | null;
      lock_expires_ms?: number | null;
      lock_owner_run_key?: string | null;
    } | null;

  const acquired = String(owner?.lock_token ?? "") === lockToken;
  if (!acquired) {
    return c.json({
      success: false,
      acquired: false,
      file_path: filePath,
      lock_expires_ms: Number(owner?.lock_expires_ms ?? 0) || null,
      lock_owner_run_key: typeof owner?.lock_owner_run_key === "string" ? owner.lock_owner_run_key : null,
      error: "output lock is already held",
    }, 409);
  }

  return c.json({
    success: true,
    acquired: true,
    file_path: filePath,
    lock_expires_ms: lockExpiresMs,
  });
});

app.post("/release-output-lock", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime.BATTLE_INDEX_DB as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const filePath = String(body?.file_path ?? "").trim();
  const lockToken = String(body?.lock_token ?? "").trim();
  if (!filePath) return c.json({ error: "file_path is required" }, 400);
  if (!lockToken) return c.json({ error: "lock_token is required" }, 400);

  const now = Date.now();
  const released = await db
    .prepare(
      `UPDATE archived_files
       SET lock_token = NULL, lock_expires_ms = NULL, lock_owner_run_key = NULL, last_modified_at = ?
       WHERE file_path = ?
         AND lock_token = ?`,
    )
    .bind(now, filePath, lockToken)
    .run();

  return c.json({
    success: true,
    file_path: filePath,
    released: Number(released.meta?.changes ?? 0) > 0,
  });
});

app.post("/register-output", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime.BATTLE_INDEX_DB as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const filePath = String(body?.file_path ?? "").trim();
  const lockToken = String(body?.lock_token ?? "").trim();
  const tableVersion = String(body?.table_version ?? "").trim();
  const compactionTier = body?.compaction_tier;
  const sourceTier = String(body?.source_tier ?? "").trim();
  const windowStart = Number(body?.window_start_ms);
  const windowEnd = Number(body?.window_end_ms);
  const fileSize = Number(body?.file_size);
  const codec = String(body?.compression_codec ?? "deflate").trim();
  const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
  if (!filePath) return c.json({ error: "file_path is required" }, 400);
  if (!lockToken) return c.json({ error: "lock_token is required" }, 400);
  if (!tableVersion) return c.json({ error: "table_version is required" }, 400);
  if (!isTier(compactionTier)) return c.json({ error: "compaction_tier is invalid" }, 400);
  if (!sourceTier) return c.json({ error: "source_tier is required" }, 400);
  if (!Number.isFinite(fileSize) || fileSize < 0) {
    return c.json({ error: "file_size is invalid" }, 400);
  }
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    return c.json({ error: "window_start_ms and window_end_ms are required" }, 400);
  }
  if (blocks.length === 0) return c.json({ error: "blocks is required" }, 400);

  const now = Date.now();

  let fileId = 0;
  const existing = (await db
    .prepare("SELECT id, lock_token, lock_expires_ms FROM archived_files WHERE file_path = ?")
    .bind(filePath)
    .first()) as { id?: number; lock_token?: string | null; lock_expires_ms?: number | null } | null;

  if (!existing?.id) {
    return c.json({
      error: "output lock record not found; acquire lock before register-output",
      file_path: filePath,
    }, 409);
  }

  const ownerToken = String(existing.lock_token ?? "");
  const lockExpiresMs = Number(existing.lock_expires_ms ?? 0);
  const hasValidOwnership = ownerToken === lockToken && Number.isFinite(lockExpiresMs) && lockExpiresMs >= now;
  if (!hasValidOwnership) {
    return c.json({
      error: "output lock is not owned by caller",
      file_path: filePath,
    }, 409);
  }

  fileId = Number(existing.id);
  await db
    .prepare(
      `UPDATE archived_files
       SET file_size = ?, compression_codec = ?, table_version = ?,
           compaction_tier = ?, window_start_ms = ?, window_end_ms = ?,
           source_tier = ?, last_modified_at = ?
       WHERE id = ?`,
    )
    .bind(
      fileSize,
      codec,
      tableVersion,
      compactionTier,
      windowStart,
      windowEnd,
      sourceTier,
      now,
      fileId,
    )
    .run();

  const normalizedBlocks: Array<{
    datasetId: string;
    tableName: string;
    periodTag: string;
    startByte: number;
    length: number;
    recordCount: number;
    startTs: number;
    endTs: number;
    sourceFileCount: number;
  }> = [];

  for (const block of blocks) {
    const datasetId = String(block?.dataset_id ?? "").trim();
    const tableName = String(block?.table_name ?? "").trim();
    const periodTag = String(block?.period_tag ?? "").trim();
    const startByte = Number(block?.start_byte);
    const length = Number(block?.length);
    const recordCount = Number(block?.record_count ?? 0);
    const startTs = Number(block?.start_timestamp ?? 0);
    const endTs = Number(block?.end_timestamp ?? 0);
    const sourceFileCount = Number(block?.source_file_count ?? 1);

    if (!datasetId || !tableName || !periodTag) {
      return c.json({ error: "invalid block metadata" }, 400);
    }

    if (
      !Number.isFinite(startByte) ||
      !Number.isFinite(length) ||
      !Number.isFinite(recordCount) ||
      !Number.isFinite(startTs) ||
      !Number.isFinite(endTs)
    ) {
      return c.json({ error: "invalid block numeric metadata" }, 400);
    }

    normalizedBlocks.push({
      datasetId,
      tableName,
      periodTag,
      startByte,
      length,
      recordCount,
      startTs,
      endTs,
      sourceFileCount,
    });
  }

  await db
    .prepare("DELETE FROM block_indexes WHERE file_id = ?")
    .bind(fileId)
    .run();

  const statements: Array<ReturnType<D1Database["prepare"]>> = [];
  for (const block of normalizedBlocks) {
    statements.push(
      db
        .prepare(
          `INSERT INTO block_indexes (
            dataset_id, table_name, file_id, start_byte, length, record_count,
            start_timestamp, end_timestamp, table_version, period_tag,
            compaction_tier, window_start_ms, window_end_ms, source_file_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          block.datasetId,
          block.tableName,
          fileId,
          block.startByte,
          block.length,
          block.recordCount,
          block.startTs,
          block.endTs,
          tableVersion,
          block.periodTag,
          compactionTier,
          windowStart,
          windowEnd,
          block.sourceFileCount,
        ),
    );
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return c.json({
    success: true,
    file_id: fileId,
    inserted_blocks: statements.length,
    file_path: filePath,
  });
});

app.post("/cleanup-consumed-sources", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime.BATTLE_INDEX_DB as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const sourceTier = body?.source_tier;
  const tableName = String(body?.table_name ?? "").trim();
  const periodTag = String(body?.period_tag ?? "").trim();
  const tableVersion = String(body?.table_version ?? "").trim();
  const windowStart = Number(body?.window_start_ms);
  const windowEnd = Number(body?.window_end_ms);
  const rawSourceFileIds: unknown[] = Array.isArray(body?.source_file_ids)
    ? (body.source_file_ids as unknown[])
    : [];
  const sourceFileIds: number[] = [];
  for (const value of rawSourceFileIds) {
    const id = Number(value);
    if (Number.isFinite(id) && id > 0 && !sourceFileIds.includes(id)) {
      sourceFileIds.push(id);
    }
  }

  if (!isTier(sourceTier)) return c.json({ error: "source_tier is invalid" }, 400);
  if (!tableName) return c.json({ error: "table_name is required" }, 400);
  if (!periodTag) return c.json({ error: "period_tag is required" }, 400);
  if (!tableVersion) return c.json({ error: "table_version is required" }, 400);
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    return c.json({ error: "window_start_ms and window_end_ms are required" }, 400);
  }
  if (sourceFileIds.length === 0) return c.json({ success: true, deleted_source_files: 0 });

  const placeholders = sourceFileIds.map(() => "?").join(", ");
  const rows = (await db
    .prepare(
      `SELECT DISTINCT af.id AS file_id
       FROM archived_files af
       JOIN block_indexes bi ON bi.file_id = af.id
       WHERE af.id IN (${placeholders})
         AND bi.compaction_tier = ?
         AND bi.table_name = ?
         AND bi.period_tag = ?
         AND bi.table_version = ?
         AND ((bi.window_start_ms IS NOT NULL AND bi.window_start_ms >= ?) OR (bi.window_start_ms IS NULL AND bi.start_timestamp >= ?))
         AND ((bi.window_end_ms IS NOT NULL AND bi.window_end_ms <= ?) OR (bi.window_end_ms IS NULL AND bi.end_timestamp <= ?))`,
    )
    .bind(...sourceFileIds, sourceTier, tableName, periodTag, tableVersion, windowStart, windowStart, windowEnd, windowEnd)
    .all()) as { results?: Array<{ file_id?: number | null }> };

  const validIds = new Set((rows.results ?? []).map((row) => Number(row.file_id ?? 0)).filter((value) => Number.isFinite(value) && value > 0));
  const targetIds = sourceFileIds.filter((id) => validIds.has(id));
  if (targetIds.length === 0) {
    return c.json({
      success: true,
      deleted_source_files: 0,
      skipped_source_files: sourceFileIds.length,
    });
  }

  const statements: Array<ReturnType<D1Database["prepare"]>> = [];
  for (const sourceFileId of targetIds) {
    statements.push(db.prepare("DELETE FROM block_indexes WHERE file_id = ?").bind(sourceFileId));
    statements.push(db.prepare("DELETE FROM archived_files WHERE id = ?").bind(sourceFileId));
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return c.json({
    success: true,
    deleted_source_files: targetIds.length,
    skipped_source_files: sourceFileIds.length - targetIds.length,
  });
});

app.post("/period-rollover-check", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime.BATTLE_INDEX_DB as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const tableName = String(body?.table_name ?? "").trim();
  const sourceTierRaw = String(body?.source_tier ?? "weekly").trim();
  const sourceTier = sourceTierRaw as CompactionTier;

  if (!tableName) return c.json({ error: "table_name is required" }, 400);
  if (!isTier(sourceTier)) {
    return c.json({ error: "source_tier is invalid" }, 400);
  }

  const currentOpenPeriod = await getLatestAllowedPeriodTag(c, {
    cacheKV: env.runtime.DATA_LOADER_CACHE_KV,
  });

  if (!currentOpenPeriod) {
    return c.json({
      success: true,
      should_compact: false,
      reason: "no-open-period",
      closed_period_tag: null,
      current_open_period_tag: null,
    });
  }

  const candidate = (await db
    .prepare(
      `SELECT bi.period_tag
       FROM block_indexes bi
       WHERE bi.table_name = ?
         AND bi.compaction_tier = ?
         AND bi.period_tag <> ?
        AND bi.table_version NOT IN (${EXCLUDED_COMPACTION_TABLE_VERSIONS.map(() => "?").join(", ")})
       ORDER BY bi.period_tag DESC
       LIMIT 1`,
    )
    .bind(tableName, sourceTier, currentOpenPeriod, ...EXCLUDED_COMPACTION_TABLE_VERSIONS)
    .first()) as { period_tag?: string | null } | null;

  const closedPeriodTag =
    typeof candidate?.period_tag === "string" && candidate.period_tag
      ? candidate.period_tag
      : null;

  if (!closedPeriodTag) {
    return c.json({
      success: true,
      should_compact: false,
      reason: "no-closed-period",
      closed_period_tag: null,
      current_open_period_tag: currentOpenPeriod,
    });
  }

  const alreadyCompleted = (await db
    .prepare(
      `SELECT 1 AS ok
       FROM compaction_runs
         WHERE tier = 'period'
           AND table_name = ?
           AND period_tag = ?
           AND status = 'completed'
       LIMIT 1`,
    )
      .bind(tableName, closedPeriodTag)
    .first()) as { ok?: number } | null;

  return c.json({
    success: true,
    should_compact: !alreadyCompleted,
    reason: alreadyCompleted ? "already-compacted" : "period-rolled-over",
    closed_period_tag: closedPeriodTag,
    current_open_period_tag: currentOpenPeriod,
  });
});

app.post("/resolve-table-version", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime.BATTLE_INDEX_DB as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const tableName = String(body?.table_name ?? "").trim();
  const periodTag = String(body?.period_tag ?? "").trim();
  const sourceTierRaw = String(body?.source_tier ?? "hourly").trim();
  const sourceTier = sourceTierRaw as CompactionTier;

  if (!tableName) return c.json({ error: "table_name is required" }, 400);
  if (!periodTag) return c.json({ error: "period_tag is required" }, 400);
  if (!isTier(sourceTier)) {
    return c.json({ error: "source_tier is invalid" }, 400);
  }

  const row = (await db
    .prepare(
      `SELECT table_version
       FROM block_indexes
       WHERE table_name = ?
         AND period_tag = ?
         AND compaction_tier = ?
         AND table_version IS NOT NULL
         AND table_version != ''
         AND table_version NOT IN (${EXCLUDED_COMPACTION_TABLE_VERSIONS.map(() => "?").join(", ")})
       ORDER BY id DESC
       LIMIT 1`,
    )
    .bind(tableName, periodTag, sourceTier, ...EXCLUDED_COMPACTION_TABLE_VERSIONS)
    .first()) as { table_version?: string | null } | null;

  const tableVersion =
    typeof row?.table_version === "string" && row.table_version
      ? row.table_version
      : null;

  if (!tableVersion) {
    return c.json({ error: "table_version not found" }, 404);
  }

  return c.json({
    success: true,
    table_name: tableName,
    period_tag: periodTag,
    source_tier: sourceTier,
    table_version: tableVersion,
  });
});

export default app;