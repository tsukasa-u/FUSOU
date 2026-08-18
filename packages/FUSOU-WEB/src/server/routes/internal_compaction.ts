import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../types";
import {
  ListSourceGroupsRequestSchema,
  ListSourceTablesRequestSchema,
  FetchBlockOcfRequestSchema,
  ResolveSourceWindowRangeRequestSchema,
  VerifyOutputVisibleRequestSchema,
  ReleaseOutputLockRequestSchema,
  AcquireOutputLockRequestSchema,
  PeriodRolloverCheckRequestSchema,
  ResolveTableVersionRequestSchema,
  ListSourceBlocksRequestSchema,
  CleanupConsumedSourcesRequestSchema,
  RegisterOutputRequestSchema,
  ClosedPeriodTagRowSchema,
  ListSourceBlockRowSchema,
  SourceGroupRowSchema,
  SourceTableRowSchema,
  SourceWindowRangeRowSchema,
  OutputLockOwnerRowSchema,
  RegisteredOutputLockRowSchema,
  CleanupOutputRowSchema,
  LinkedSourceRowSchema,
  CleanupSourceRowSchema,
  CompletedCompactionRunRowSchema,
  TableVersionRowSchema,
} from "../schemas/internal-compaction";
import { parseOcfHeader } from "../../features/avro/ocf-header";
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

function getAvroHeaderLengthFromPrefix(buffer: Uint8Array): number {
  return parseOcfHeader(buffer).bodyOffset;
}

app.post("/list-source-blocks", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = ListSourceBlocksRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) return c.json({ error: "tier is invalid" }, 400);

  const {
    tier,
    table_name: tableName,
    period_tag: periodTag,
    table_version: tableVersion,
    cursor_id: cursorIdRaw,
    limit: limitRaw,
    window_start_ms: windowStartMs,
    window_end_ms: windowEndMs,
  } = parsedBody.data;
  const cursorId = cursorIdRaw ?? 0;
  const limit =
    limitRaw !== undefined
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

  if (windowStartMs !== undefined) {
    const windowStart = windowStartMs;
    sql +=
      " AND ((bi.window_start_ms IS NOT NULL AND bi.window_start_ms >= ?) OR (bi.window_start_ms IS NULL AND bi.start_timestamp >= ?))";
    params.push(windowStart, windowStart);
  }

  if (windowEndMs !== undefined) {
    const windowEnd = windowEndMs;
    sql +=
      " AND ((bi.window_end_ms IS NOT NULL AND bi.window_end_ms <= ?) OR (bi.window_end_ms IS NULL AND bi.end_timestamp <= ?))";
    params.push(windowEnd, windowEnd);
  }

  sql += " ORDER BY bi.id ASC LIMIT ?";
  params.push(limit);

  const rows = await db
    .prepare(sql)
    .bind(...params)
    .all();
  const parsedRows = z.array(ListSourceBlockRowSchema).safeParse(rows.results ?? []);
  if (!parsedRows.success) {
    return c.json({ error: "Invalid source block row" }, 500);
  }

  const results = parsedRows.data;
  const nextCursor =
    results.length > 0
      ? Number(results[results.length - 1]?.["id"] ?? cursorId)
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
  const db = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = ListSourceGroupsRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const field = parsedBody.error.issues[0]?.path[0];
    if (field === "tier") return c.json({ error: "tier is invalid" }, 400);
    if (field === "table_name") {
      return c.json({ error: "table_name is required" }, 400);
    }
    return c.json(
      { error: "window_start_ms and window_end_ms are required" },
      400,
    );
  }

  const { tier, table_name: tableName, window_start_ms: windowStart, window_end_ms: windowEnd } =
    parsedBody.data;

  if (!isTier(tier)) return c.json({ error: "tier is invalid" }, 400);
  if (!tableName) return c.json({ error: "table_name is required" }, 400);
  if (windowStart === undefined || windowEnd === undefined) {
    return c.json({ error: "window_start_ms and window_end_ms are required" }, 400);
  }

  const rows = await db
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
    .all();
  const parsedRows = z.array(SourceGroupRowSchema).safeParse(rows.results ?? []);
  if (!parsedRows.success) {
    return c.json({ error: "Invalid source group row" }, 500);
  }

  const groups = parsedRows.data;

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
  const db = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = ListSourceTablesRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) return c.json({ error: "tier is invalid" }, 400);

  const {
    tier,
    window_start_ms: windowStart,
    window_end_ms: windowEnd,
  } = parsedBody.data;

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

  if (windowStart !== undefined) {
    sql +=
      " AND ((bi.window_start_ms IS NOT NULL AND bi.window_start_ms >= ?) OR (bi.window_start_ms IS NULL AND bi.start_timestamp >= ?))";
    params.push(windowStart, windowStart);
  }

  if (windowEnd !== undefined) {
    sql +=
      " AND ((bi.window_end_ms IS NOT NULL AND bi.window_end_ms <= ?) OR (bi.window_end_ms IS NULL AND bi.end_timestamp <= ?))";
    params.push(windowEnd, windowEnd);
  }

  sql += " ORDER BY bi.table_name ASC";

  const rows = await db
    .prepare(sql)
    .bind(...params)
    .all();
  const parsedRows = z.array(SourceTableRowSchema).safeParse(rows.results ?? []);
  if (!parsedRows.success) {
    return c.json({ error: "Invalid source table row" }, 500);
  }

  const tables = parsedRows.data
    .map((row) => row.table_name.trim())
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
  const db = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = ResolveSourceWindowRangeRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const field = parsedBody.error.issues[0]?.path[0];
    if (field === "table_names") {
      return c.json({ error: "table_names is required" }, 400);
    }
    return c.json({ error: "tier is invalid" }, 400);
  }

  const { tier } = parsedBody.data;
  const tableNames = parsedBody.data.table_names
    ? parsedBody.data.table_names
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    : [];

  if (!isTier(tier)) return c.json({ error: "tier is invalid" }, 400);
  if (tableNames.length === 0) {
    return c.json({ error: "table_names is required" }, 400);
  }

  const placeholders = tableNames.map(() => "?").join(", ");
  const rows = await db
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
    .all();
  const parsedRows = SourceWindowRangeRowSchema.nullable().safeParse(
    rows.results?.[0] ?? null,
  );
  if (!parsedRows.success) {
    return c.json({ error: "Invalid source window range row" }, 500);
  }

  const row = parsedRows.data;
  const startMs = Number(row?.start_ms);
  const endMs = Number(row?.end_ms);

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
  const bucket = env.runtime["BATTLE_DATA_BUCKET"] as R2Bucket | undefined;
  if (!bucket) return c.json({ error: "BATTLE_DATA_BUCKET not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = FetchBlockOcfRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const field = parsedBody.error.issues[0]?.path[0];
    if (field === "file_path") {
      return c.json({ error: "file_path is required" }, 400);
    }
    return c.json(
      { error: field === "start_byte" ? "start_byte is invalid" : "length is invalid" },
      400,
    );
  }

  const {
    file_path: filePath,
    start_byte: startByte,
    length,
  } = parsedBody.data;

  if (!filePath) return c.json({ error: "file_path is required" }, 400);
  if (startByte === undefined || startByte < 0) {
    return c.json({ error: "start_byte is invalid" }, 400);
  }
  if (length === undefined || length <= 0) {
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
  const bucket = env.runtime["BATTLE_DATA_BUCKET"] as R2Bucket | undefined;
  if (!bucket) return c.json({ error: "BATTLE_DATA_BUCKET not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = VerifyOutputVisibleRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return c.json({ error: "file_path is required" }, 400);
  }

  const { file_path: filePath } = parsedBody.data;
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
  const db = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = AcquireOutputLockRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const field = parsedBody.error.issues[0]?.path[0];
    const errors: Record<string, string> = {
      file_path: "file_path is required",
      lock_token: "lock_token is required",
      table_version: "table_version is required",
      compaction_tier: "compaction_tier is invalid",
      source_tier: "source_tier is required",
      window_start_ms: "window_start_ms and window_end_ms are required",
      window_end_ms: "window_start_ms and window_end_ms are required",
    };
    return c.json({ error: errors[String(field)] ?? "Invalid JSON" }, 400);
  }

  const {
    file_path: filePath,
    lock_token: lockToken,
    table_version: tableVersion,
    compaction_tier: compactionTier,
    source_tier: sourceTier,
    window_start_ms: windowStart,
    window_end_ms: windowEnd,
    run_key: runKey,
    lock_ttl_ms: lockTtlMsRaw,
  } = parsedBody.data;
  const lockTtlMs = lockTtlMsRaw !== undefined && Number.isFinite(lockTtlMsRaw)
    ? Math.max(30_000, Math.min(24 * 60 * 60_000, Math.trunc(lockTtlMsRaw)))
    : 6 * 60 * 60_000;

  if (!filePath) return c.json({ error: "file_path is required" }, 400);
  if (!lockToken) return c.json({ error: "lock_token is required" }, 400);
  if (!tableVersion) return c.json({ error: "table_version is required" }, 400);
  if (!isTier(compactionTier)) return c.json({ error: "compaction_tier is invalid" }, 400);
  if (!sourceTier) return c.json({ error: "source_tier is required" }, 400);
  if (windowStart === undefined || windowEnd === undefined) {
    return c.json({ error: "window_start_ms and window_end_ms are required" }, 400);
  }

  const now = Date.now();
  const lockExpiresMs = now + lockTtlMs;

  await db
    .prepare(
      `INSERT OR IGNORE INTO archived_files (
        file_path, file_size, compression_codec, created_at, last_modified_at,
        table_version, compaction_tier, window_start_ms, window_end_ms, source_tier,
        lock_token, lock_expires_ms, lock_owner_run_key, lifecycle_state
      ) VALUES (?, 0, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
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

  const ownerResult = await db
    .prepare(
      `SELECT lock_token, lock_expires_ms, lock_owner_run_key
       FROM archived_files
       WHERE file_path = ?
       LIMIT 1`,
    )
    .bind(filePath)
    .first();
  const parsedOwner = OutputLockOwnerRowSchema.nullable().safeParse(ownerResult);
  if (!parsedOwner.success) {
    return c.json({ error: "Invalid output lock row" }, 500);
  }
  const owner = parsedOwner.data;

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
  const db = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = ReleaseOutputLockRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const field = parsedBody.error.issues[0]?.path[0];
    return c.json(
      { error: field === "lock_token" ? "lock_token is required" : "file_path is required" },
      400,
    );
  }

  const { file_path: filePath, lock_token: lockToken } = parsedBody.data;
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
  const db = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);
  const bucket = env.runtime["BATTLE_DATA_BUCKET"] as R2Bucket | undefined;
  if (!bucket) return c.json({ error: "BATTLE_DATA_BUCKET not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = RegisterOutputRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const field = String(parsedBody.error.issues[0]?.path[0]);
    if (field === "compaction_tier") {
      return c.json({ error: "compaction_tier is invalid" }, 400);
    }
    if (field === "file_size") {
      return c.json({ error: "file_size is invalid" }, 400);
    }
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const {
    file_path: filePath = "",
    lock_token: lockToken = "",
    table_version: tableVersion = "",
    compaction_tier: compactionTier,
    source_tier: sourceTier = "",
    source_objects: sourceObjects,
    window_start_ms: windowStart,
    window_end_ms: windowEnd,
    file_size: fileSize,
    compression_codec: codec = "deflate",
    blocks,
  } = parsedBody.data;
  if (!filePath) return c.json({ error: "file_path is required" }, 400);
  if (!lockToken) return c.json({ error: "lock_token is required" }, 400);
  if (!tableVersion) return c.json({ error: "table_version is required" }, 400);
  if (!isTier(compactionTier)) return c.json({ error: "compaction_tier is invalid" }, 400);
  if (!sourceTier) return c.json({ error: "source_tier is required" }, 400);
  if (
    fileSize === undefined ||
    !Number.isFinite(fileSize) ||
    fileSize < 0
  ) {
    return c.json({ error: "file_size is invalid" }, 400);
  }
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    return c.json({ error: "window_start_ms and window_end_ms are required" }, 400);
  }
  if (blocks.length === 0) return c.json({ error: "blocks is required" }, 400);

  const outputObject = await bucket.head(filePath);
  if (!outputObject) {
    return c.json({ error: "output object is not visible in R2", file_path: filePath }, 409);
  }
  if (Number(outputObject.size ?? -1) !== fileSize) {
    return c.json({
      error: "output object size does not match register-output payload",
      file_path: filePath,
      expected_size: fileSize,
      actual_size: Number(outputObject.size ?? -1),
    }, 409);
  }

  const now = Date.now();

  let fileId = 0;
  const existingResult = await db
    .prepare("SELECT id, lock_token, lock_expires_ms FROM archived_files WHERE file_path = ?")
    .bind(filePath)
    .first();
  const parsedExisting = RegisteredOutputLockRowSchema.nullable().safeParse(existingResult);
  if (!parsedExisting.success) {
    return c.json({ error: "Invalid output lock row" }, 500);
  }
  const existing = parsedExisting.data;

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
    const blockRecord =
      block && typeof block === "object"
        ? (block as Record<string, unknown>)
        : {};
    const datasetId = String(blockRecord["dataset_id"] ?? "").trim();
    const tableName = String(blockRecord["table_name"] ?? "").trim();
    const periodTag = String(blockRecord["period_tag"] ?? "").trim();
    const startByte = Number(blockRecord["start_byte"]);
    const length = Number(blockRecord["length"]);
    const recordCount = Number(blockRecord["record_count"] ?? 0);
    const startTs = Number(blockRecord["start_timestamp"] ?? 0);
    const endTs = Number(blockRecord["end_timestamp"] ?? 0);
    const sourceFileCount = Number(blockRecord["source_file_count"] ?? 1);

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

  const normalizedSourceObjects = [
    ...new Map(
      sourceObjects
        .map((source) => ({
          fileId: Number(source.file_id),
          filePath: String(source.file_path ?? "").trim(),
          archivedPath: String(source.archived_path ?? "").trim(),
        }))
        .filter(
          (source) =>
            Number.isSafeInteger(source.fileId) &&
            source.fileId > 0 &&
            source.filePath.length > 0 &&
            source.archivedPath.length > 0,
        )
        .map((source) => [source.fileId, source] as const),
    ).values(),
  ];

  const statements: Array<ReturnType<D1Database["prepare"]>> = [
    db
      .prepare(
        `UPDATE archived_files
         SET file_size = ?, compression_codec = ?, table_version = ?,
             compaction_tier = ?, window_start_ms = ?, window_end_ms = ?,
             source_tier = ?, lifecycle_state = CASE
               WHEN lifecycle_state = 'completed' THEN 'completed'
               ELSE 'registered'
             END,
             output_etag = ?, output_verified_at_ms = ?, output_error = NULL,
             last_modified_at = ?
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
        outputObject.etag ?? null,
        now,
        now,
        fileId,
      ),
    db.prepare("DELETE FROM block_indexes WHERE file_id = ?").bind(fileId),
  ];
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

  for (const source of normalizedSourceObjects) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO compaction_output_sources (
             output_file_id, source_file_id, source_file_path, archived_source_path,
             source_r2_state, source_d1_state, created_at_ms
           ) VALUES (?, ?, ?, ?, 'pending', 'active', ?)`,
        )
        .bind(
          fileId,
          source.fileId,
          source.filePath,
          source.archivedPath,
          now,
        ),
    );
  }

  await db.batch(statements);

  return c.json({
    success: true,
    file_id: fileId,
    inserted_blocks: normalizedBlocks.length,
    file_path: filePath,
    lifecycle_state: "registered",
    output_etag: outputObject.etag ?? null,
  });
});

app.post("/cleanup-consumed-sources", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);
  const bucket = env.runtime["BATTLE_DATA_BUCKET"] as R2Bucket | undefined;
  if (!bucket) return c.json({ error: "BATTLE_DATA_BUCKET not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = CleanupConsumedSourcesRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const field = parsedBody.error.issues[0]?.path[0];
    const errors: Record<string, string> = {
      output_file_path: "output_file_path is required",
      source_tier: "source_tier is invalid",
      table_name: "table_name is required",
      period_tag: "period_tag is required",
      table_version: "table_version is required",
      window_start_ms: "window_start_ms and window_end_ms are required",
      window_end_ms: "window_start_ms and window_end_ms are required",
        source_file_ids: "source_file_ids must be an array",
      source_objects: "source_objects must be an array",
    };
    return c.json({ error: errors[String(field)] ?? "Invalid JSON" }, 400);
  }

  const {
    output_file_path: outputFilePath = "",
    source_tier: sourceTier,
    table_name: tableName,
    period_tag: periodTag,
    table_version: tableVersion,
    window_start_ms: windowStart,
    window_end_ms: windowEnd,
    source_objects: sourceObjects,
  } = parsedBody.data;

  if (!isTier(sourceTier)) return c.json({ error: "source_tier is invalid" }, 400);
  if (!tableName) return c.json({ error: "table_name is required" }, 400);
  if (!periodTag) return c.json({ error: "period_tag is required" }, 400);
  if (!tableVersion) return c.json({ error: "table_version is required" }, 400);
  if (windowStart === undefined || windowEnd === undefined) {
    return c.json({ error: "window_start_ms and window_end_ms are required" }, 400);
  }
  if (!outputFilePath) return c.json({ error: "output_file_path is required" }, 400);

  const outputObject = await bucket.head(outputFilePath);
  if (!outputObject) {
    return c.json({
      error: "output object is not visible in R2; source cleanup is deferred",
      file_path: outputFilePath,
    }, 409);
  }

  const outputRowResult = await db
    .prepare(
      `SELECT id, lifecycle_state, output_verified_at_ms
       FROM archived_files
       WHERE file_path = ?
       LIMIT 1`,
    )
    .bind(outputFilePath)
    .first();
  const parsedOutputRow = CleanupOutputRowSchema.nullable().safeParse(outputRowResult);
  if (!parsedOutputRow.success) {
    return c.json({ error: "Invalid cleanup output row" }, 500);
  }
  const outputRow = parsedOutputRow.data;

  const outputFileId = Number(outputRow?.id ?? 0);
  if (!Number.isFinite(outputFileId) || outputFileId <= 0) {
    return c.json({ error: "output registration not found; source cleanup is deferred" }, 409);
  }
  if (outputRow?.lifecycle_state === "completed") {
    return c.json({
      success: true,
      output_file_path: outputFilePath,
      lifecycle_state: "completed",
      deleted_source_files: 0,
    });
  }
  if (outputRow?.lifecycle_state !== "registered") {
    return c.json({
      error: "output is not registered; source cleanup is deferred",
      lifecycle_state: outputRow?.lifecycle_state ?? null,
    }, 409);
  }
  if (!Number.isFinite(Number(outputRow.output_verified_at_ms))) {
    return c.json({ error: "output has not been verified; source cleanup is deferred" }, 409);
  }

  const linkedRows = await db
    .prepare(
      `SELECT source_file_id, source_file_path, archived_source_path
       FROM compaction_output_sources
       WHERE output_file_id = ?
       ORDER BY source_file_id ASC`,
    )
    .bind(outputFileId)
    .all();
  const parsedLinkedRows = z.array(LinkedSourceRowSchema).safeParse(linkedRows.results ?? []);
  if (!parsedLinkedRows.success) {
    return c.json({ error: "Invalid linked source row" }, 500);
  }

  const linkedSourceObjects = parsedLinkedRows.data.map((row) => ({
    fileId: row.source_file_id,
    filePath: row.source_file_path,
    archivedPath: row.archived_source_path,
  }));

  const fallbackSourceObjects = sourceObjects
    .map((source) => ({
      fileId: Number(source.file_id),
      filePath: String(source.file_path ?? "").trim(),
      archivedPath: String(source.archived_path ?? "").trim(),
    }))
    .filter(
      (source) =>
        Number.isFinite(source.fileId) &&
        source.fileId > 0 &&
        source.filePath.length > 0 &&
        source.archivedPath.length > 0,
    );
  const sourceObjectsToVerify = linkedSourceObjects.length > 0
    ? linkedSourceObjects
    : fallbackSourceObjects;
  if (sourceObjectsToVerify.length === 0) {
    return c.json({
      error: "source R2 archive paths are not recorded; source cleanup is deferred",
    }, 409);
  }

  const missingArchivedPaths: string[] = [];
  for (const source of sourceObjectsToVerify) {
    if (!(await bucket.head(source.archivedPath))) {
      missingArchivedPaths.push(source.archivedPath);
    }
  }
  if (missingArchivedPaths.length > 0) {
    return c.json({
      error: "consumed source objects are not archived in R2; source cleanup is deferred",
      missing_archived_paths: missingArchivedPaths,
    }, 409);
  }

  const sourceIdsToDelete = [
    ...new Set(
      sourceObjectsToVerify
        .map((source) => source.fileId)
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  if (sourceIdsToDelete.length === 0) {
    return c.json({ success: true, output_file_path: outputFilePath, deleted_source_files: 0 });
  }

  const placeholders = sourceIdsToDelete.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT DISTINCT af.id AS file_id, af.file_path
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
    .bind(...sourceIdsToDelete, sourceTier, tableName, periodTag, tableVersion, windowStart, windowStart, windowEnd, windowEnd)
    .all();
  const parsedRows = z.array(CleanupSourceRowSchema).safeParse(rows.results ?? []);
  if (!parsedRows.success) {
    return c.json({ error: "Invalid cleanup source row" }, 500);
  }

  const expectedPathById = new Map(
    sourceObjectsToVerify.map((source) => [source.fileId, source.filePath]),
  );
  const validIds = new Set(
    parsedRows.data
      .filter((row) => {
        const fileId = Number(row.file_id ?? 0);
        const expectedPath = expectedPathById.get(fileId);
        return (
          Number.isFinite(fileId) &&
          fileId > 0 &&
          typeof expectedPath === "string" &&
          expectedPath === String(row.file_path ?? "")
        );
      })
      .map((row) => Number(row.file_id ?? 0)),
  );
  const expectedSourceIds = new Set(sourceObjectsToVerify.map((source) => source.fileId));
  if (validIds.size < expectedSourceIds.size) {
    return c.json({
      error: "source D1 metadata does not match the registered source links; source cleanup is deferred",
    }, 409);
  }
  const targetIds = sourceIdsToDelete.filter((id) => validIds.has(id));

  const statements: Array<ReturnType<D1Database["prepare"]>> = [];
  if (linkedSourceObjects.length === 0) {
    const now = Date.now();
    for (const source of fallbackSourceObjects) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO compaction_output_sources (
               output_file_id, source_file_id, source_file_path, archived_source_path,
               source_r2_state, source_d1_state, created_at_ms
             ) VALUES (?, ?, ?, ?, 'pending', 'active', ?)`,
          )
          .bind(outputFileId, source.fileId, source.filePath, source.archivedPath, now),
      );
    }
  }
  const now = Date.now();
  for (const sourceFileId of targetIds) {
    statements.push(db.prepare("DELETE FROM block_indexes WHERE file_id = ?").bind(sourceFileId));
    statements.push(db.prepare("DELETE FROM archived_files WHERE id = ?").bind(sourceFileId));
  }

  for (const source of sourceObjectsToVerify) {
    statements.push(
      db
        .prepare(
          `UPDATE compaction_output_sources
           SET source_r2_state = 'moved', source_d1_state = 'deleted',
               moved_at_ms = COALESCE(moved_at_ms, ?), d1_deleted_at_ms = ?
           WHERE output_file_id = ? AND source_file_id = ?`,
        )
        .bind(now, now, outputFileId, source.fileId),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE archived_files
         SET lifecycle_state = 'completed', source_cleanup_completed_at_ms = ?,
             last_modified_at = ?
         WHERE id = ?`,
      )
      .bind(now, now, outputFileId),
  );

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return c.json({
    success: true,
    output_file_path: outputFilePath,
    lifecycle_state: "completed",
    deleted_source_files: targetIds.length,
    skipped_source_files: sourceIdsToDelete.length - targetIds.length,
  });
});

app.post("/period-rollover-check", async (c) => {
  const auth = verifyInternalToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const env = createEnvContext(c);
  const db = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = PeriodRolloverCheckRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return c.json({ error: "table_name is required" }, 400);
  }

  const {
    table_name: tableName,
    source_tier: sourceTierRaw,
  } = parsedBody.data;
  const sourceTier = sourceTierRaw as CompactionTier;

  if (!tableName) return c.json({ error: "table_name is required" }, 400);
  if (!isTier(sourceTier)) {
    return c.json({ error: "source_tier is invalid" }, 400);
  }

  const currentOpenPeriod = await getLatestAllowedPeriodTag(c, {
    cacheKV: env.runtime["DATA_LOADER_CACHE_KV"],
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

  const candidate = await db
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
    .first();
  const parsedCandidate = ClosedPeriodTagRowSchema.safeParse(candidate);

  const closedPeriodTag =
    parsedCandidate.success && parsedCandidate.data.period_tag
      ? parsedCandidate.data.period_tag
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

  const alreadyCompletedResult = await db
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
    .first();
  const parsedAlreadyCompleted = CompletedCompactionRunRowSchema.nullable().safeParse(
    alreadyCompletedResult,
  );
  if (!parsedAlreadyCompleted.success) {
    return c.json({ error: "Invalid compaction run row" }, 500);
  }
  const alreadyCompleted = parsedAlreadyCompleted.data;

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
  const db = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (!db) return c.json({ error: "BATTLE_INDEX_DB not configured" }, 500);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsedBody = ResolveTableVersionRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return c.json({ error: "table_name is required" }, 400);
  }

  const {
    table_name: tableName,
    period_tag: periodTag,
    source_tier: sourceTierRaw,
  } = parsedBody.data;
  const sourceTier = sourceTierRaw as CompactionTier;

  if (!tableName) return c.json({ error: "table_name is required" }, 400);
  if (!periodTag) return c.json({ error: "period_tag is required" }, 400);
  if (!isTier(sourceTier)) {
    return c.json({ error: "source_tier is invalid" }, 400);
  }

  const rowResult = await db
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
    .first();
  const parsedRow = TableVersionRowSchema.nullable().safeParse(rowResult);
  if (!parsedRow.success) {
    return c.json({ error: "Invalid table version row" }, 500);
  }
  const row = parsedRow.data;

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