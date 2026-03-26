import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { createEnvContext, getEnv, validateDatasetToken } from "../utils";
import { handleTwoStageUpload } from "../utils/upload";
import { validateOffsetMetadata } from "../validators/offsets";
import { decodeAvroOcfToJson } from "../utils/avro-decoder";
import {
  validateAvroOCFSmart,
  extractSchemaFromOCF,
  validateAvroHeader,
} from "../utils/avro-validator";

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Convert Uint8Array to base64 string (Cloudflare Workers compatible)
 * Uses chunks to avoid O(n²) string concatenation
 */
function arrayBufferToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...Array.from(chunk));
  }
  return btoa(binary);
}

const PUBLIC_RECORD_TABLES = new Set([
  "battle",
  "cells",
  "env_info",
  "enemy_deck",
  "enemy_ship",
  "enemy_slotitem",
  "own_deck",
  "own_ship",
  "own_slotitem",
  "battle_result",
  "carrierbase_assault",
  "closing_raigeki",
  "hougeki",
  "hougeki_list",
  "midnight_hougeki",
  "midnight_hougeki_list",
  "opening_airattack",
  "opening_airattack_list",
  "opening_raigeki",
  "opening_taisen",
  "opening_taisen_list",
]);

const SORTIE_SPLIT_GAP_MS = 90 * 60 * 1000;

function parsePositiveInt(value: string | undefined, fallbackValue: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.min(parsed, max);
}

function normalizeTimestamp(value: unknown): number | null {
  const normalizeEpochMs = (raw: number): number => {
    // Some records store seconds while others store milliseconds.
    return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  };

  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeEpochMs(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? normalizeEpochMs(parsed) : null;
  }
  return null;
}

function attachSortieIds(records: any[]): void {
  type Item = {
    rec: Record<string, unknown>;
    ts: number | null;
  };

  const sortable: Item[] = records
    .filter((rec): rec is Record<string, unknown> => !!rec && typeof rec === "object")
    .map((rec) => ({
      rec,
      ts: normalizeTimestamp(rec.timestamp) ?? normalizeTimestamp(rec.midnight_timestamp),
    }))
    .sort((a, b) => {
      const aTs = a.ts ?? Number.MAX_SAFE_INTEGER;
      const bTs = b.ts ?? Number.MAX_SAFE_INTEGER;
      return aTs - bTs;
    });

  const byDataset = new Map<string, { mapKey: string; ts: number | null; sortieNo: number }>();

  for (const item of sortable) {
    const datasetId = typeof item.rec.dataset_id === "string" && item.rec.dataset_id
      ? item.rec.dataset_id
      : "global";
    const mapArea = Number(item.rec.maparea_id ?? 0) || 0;
    const mapInfo = Number(item.rec.mapinfo_no ?? 0) || 0;
    const mapKey = `${mapArea}-${mapInfo}`;

    const prev = byDataset.get(datasetId);
    let sortieNo = 1;
    if (prev) {
      const sameMap = prev.mapKey === mapKey;
      const withinGap =
        prev.ts != null && item.ts != null
          ? Math.abs(item.ts - prev.ts) <= SORTIE_SPLIT_GAP_MS
          : sameMap;
      sortieNo = sameMap && withinGap ? prev.sortieNo : prev.sortieNo + 1;
    }

    byDataset.set(datasetId, { mapKey, ts: item.ts, sortieNo });
    item.rec.__sortie_id = `${datasetId}:${mapKey}:${sortieNo}`;
  }
}

function matchesRecordFilter(record: unknown, filterObj: Record<string, unknown>): boolean {
  if (!record || typeof record !== "object") {
    return false;
  }
  const rec = record as Record<string, unknown>;
  for (const [key, expected] of Object.entries(filterObj)) {
    const actual = rec[key];

    if (Array.isArray(expected)) {
      if (!expected.includes(actual as never)) {
        return false;
      }
      continue;
    }

    if (expected === null) {
      if (actual !== null && actual !== undefined) {
        return false;
      }
      continue;
    }

    if (typeof expected === "number") {
      const actualNum = Number(actual);
      if (!Number.isFinite(actualNum) || actualNum !== expected) {
        return false;
      }
      continue;
    }

    if (typeof expected === "boolean") {
      if (Boolean(actual) !== expected) {
        return false;
      }
      continue;
    }

    if (String(actual) !== String(expected)) {
      return false;
    }
  }
  return true;
}

async function decodeIndexedBlock(
  bucket: R2Bucket,
  filePath: string,
  startByte: number,
  length: number,
): Promise<any[]> {
  if (startByte < 0 || length <= 0) {
    return [];
  }

  // Read once and slice in-memory to avoid body re-use issues in local runtimes.
  const sourceObject = await bucket.get(filePath);
  if (!sourceObject?.body) {
    return [];
  }
  const sourceBytes = new Uint8Array(await new Response(sourceObject.body).arrayBuffer());
  const endByte = Math.min(sourceBytes.byteLength, startByte + length);
  if (startByte >= endByte) {
    return [];
  }

  const headerBytes = sourceBytes.subarray(0, startByte);
  const dataBytes = sourceBytes.subarray(startByte, endByte);
  const combined = new Uint8Array(headerBytes.byteLength + dataBytes.byteLength);
  combined.set(headerBytes, 0);
  combined.set(dataBytes, headerBytes.byteLength);

  return decodeAvroOcfToJson(combined);
}

// validateAvroHeader is now imported from avro-validator

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
    return c.json(
      { error: "Server misconfiguration: missing R2 bucket or signing secret" },
      500,
    );
  }

  return handleTwoStageUpload(c, {
    bucket,
    signingSecret,
    preparationValidator: async (body, _user) => {
      // Extract and validate dataset_token (X-Dataset-Token header or dataset_token in body)
      const datasetTokenHeader = c.req.header("X-Dataset-Token");
      const datasetTokenBody =
        typeof body?.dataset_token === "string"
          ? body.dataset_token.trim()
          : "";
      const datasetToken = datasetTokenHeader || datasetTokenBody;

      if (datasetToken) {
        const datasetTokenSecret = getEnv(env, "DATASET_TOKEN_SECRET");
        if (!datasetTokenSecret) {
          console.error("[battle-data] DATASET_TOKEN_SECRET not configured");
          return c.json({ error: "Server configuration error" }, 500);
        }

        const validatedToken = await validateDatasetToken(
          datasetToken,
          datasetTokenSecret,
        );
        if (!validatedToken) {
          console.warn("[battle-data] Invalid or expired dataset_token");
          return c.json({ error: "Invalid or expired dataset_token" }, 401);
        }

        // Verify dataset_id matches token
        const requestedDatasetId =
          typeof body?.dataset_id === "string" ? body.dataset_id.trim() : "";
        if (requestedDatasetId !== validatedToken.dataset_id) {
          console.warn(`[battle-data] dataset_id mismatch detected`);
          return c.json({ error: "dataset_id does not match token" }, 403);
        }

        console.log(`[battle-data] dataset_token validated successfully`);
      }

      const datasetId =
        typeof body?.dataset_id === "string" ? body.dataset_id.trim() : "";
      const table = typeof body?.table === "string" ? body.table.trim() : "";
      const periodTag =
        typeof body?.kc_period_tag === "string"
          ? body.kc_period_tag.trim()
          : "";
      const tableVersion =
        typeof body?.table_version === "string"
          ? body.table_version.trim()
          : typeof body?.tableVersion === "string"
            ? body.tableVersion.trim()
            : "";
      const declaredSize = parseInt(
        typeof body?.file_size === "string" ? body.file_size : "0",
        10,
      );
      const tableOffsets =
        typeof body?.table_offsets === "string"
          ? body.table_offsets.trim()
          : null;
      const pathTag = typeof body?.path === "string" ? body.path.trim() : null;
      const isBinary = typeof body?.binary === "boolean" ? body.binary : false;

      // Verify that client indicated binary format
      if (!isBinary) {
        console.warn("[battle-data] Rejecting non-binary upload");
        return c.json(
          { error: "binary field must be true for battle data" },
          400,
        );
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
      if (!tableVersion) {
        return c.json({ error: "table_version is required" }, 400);
      }
      if (!/^[\w\-]+$/.test(periodTag)) {
        return c.json(
          {
            error:
              "kc_period_tag must contain only alphanumeric characters and hyphens",
          },
          400,
        );
      }
      if (declaredSize <= 0) {
        return c.json({ error: "file_size must be > 0" }, 400);
      }

      // Get content_hash from body (computed by client)
      const contentHash =
        typeof body?.content_hash === "string" ? body.content_hash.trim() : "";
      if (!contentHash) {
        console.warn("[battle-data] Rejecting upload without content_hash");
        return c.json({ error: "content_hash is required" }, 400);
      }

      // Validate table_offsets if provided
      if (tableOffsets) {
        try {
          console.info(
            `[battle-data] Received table_offsets for ${table}: ${tableOffsets}`,
          );
          const parsed = JSON.parse(tableOffsets);
          console.info(
            `[battle-data] Parsed table_offsets (${parsed.length} tables): ${JSON.stringify(parsed.map((p: any) => p.table_name))}`,
          );
          const { valid, errors } = validateOffsetMetadata(
            parsed,
            declaredSize,
          );
          if (!valid) {
            console.warn(
              `[battle-data] Invalid table_offsets provided; rejecting. Errors: ${errors.join(", ")}`,
            );
            return c.json(
              { error: "Invalid table_offsets", details: errors },
              400,
            );
          }
        } catch (e) {
          console.warn(
            `[battle-data] Failed to parse table_offsets; rejecting. Error: ${String(e)}`,
          );
          return c.json({ error: "Malformed table_offsets JSON" }, 400);
        }
      } else {
        console.info(
          `[battle-data] No table_offsets provided for table '${table}'`,
        );
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
          table_version: tableVersion,
        },
      };
    },
    executionProcessor: async (tokenPayload, data, user) => {
      const datasetId = tokenPayload.dataset_id as string;
      const table = tokenPayload.table as string;
      const periodTag = (tokenPayload as any).period_tag as string;
      let tableOffsets = (tokenPayload as any).table_offsets as string | null;
      const tableVersion = (tokenPayload as any).table_version as string;
      const detectedTableVersions = new Set<string>();

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
          return c.json(
            {
              error: "Server misconfiguration: COMPACTION_QUEUE not available",
            },
            500,
          );
        }

        // Parse table_offsets and split data into per-table Avro slices
        let offsets: any[] = [];
        if (tableOffsets) {
          try {
            offsets = JSON.parse(tableOffsets) as any[];
          } catch (e) {
            console.warn(
              "[battle-data] Failed to parse table_offsets for queue split",
              e,
            );
            offsets = [];
          }
        }

        // Get size limit from env (default 64KB per table slice)
        const maxBytes = env.buildtime.MAX_BATTLE_SLICE_BYTES
          ? parseInt(env.buildtime.MAX_BATTLE_SLICE_BYTES, 10)
          : 65536;

        // Validate each table slice before batching
        // This is strict validation - all tables must pass before any are queued
        const validatedOffsets: any[] = [];
        if (Array.isArray(offsets) && offsets.length) {
          for (const entry of offsets) {
            const start = Number(entry.start_byte ?? 0);
            const len = Number(entry.byte_length ?? 0);
            const tname = String(entry.table_name ?? table);
            if (len <= 0) continue;

            const slice = data.subarray(start, start + len);

            // Lightweight header validation (DoS prevention)
            const headerCheck = validateAvroHeader(slice, maxBytes);
            if (!headerCheck.valid) {
              console.error(
                `[battle-data] Invalid Avro header for ${tname}:`,
                headerCheck.error,
              );
              return c.json(
                { error: `Invalid Avro data: ${headerCheck.error}` },
                400,
              );
            }

            // Extract schema and validate via full decode
            const schemaJson = extractSchemaFromOCF(slice);
            if (!schemaJson) {
              console.error(
                `[battle-data] Failed to extract schema from ${tname}`,
              );
              return c.json(
                { error: "Invalid Avro: schema not found in header" },
                400,
              );
            }

            const decodeResult = await validateAvroOCFSmart(
              slice,
              tableVersion,
            );
            if (!decodeResult.valid) {
              console.error(
                `[battle-data] Decode validation failed for ${tname}:`,
                decodeResult.errorMessage,
              );
              return c.json(
                {
                  error: "Schema validation failed",
                  details: decodeResult.errorMessage,
                },
                400,
              );
            }

            if (!decodeResult.tableVersion) {
              console.error(
                `[battle-data] Missing table_version in Avro header for ${tname}`,
              );
              return c.json(
                { error: "table_version not found in Avro header" },
                400,
              );
            }

            if (decodeResult.tableVersion !== tableVersion) {
              console.error(
                `[battle-data] table_version mismatch for ${tname}: token=${tableVersion}, avro=${decodeResult.tableVersion}`,
              );
              return c.json(
                {
                  error: `table_version mismatch: expected ${tableVersion}, got ${decodeResult.tableVersion}`,
                },
                400,
              );
            }

            detectedTableVersions.add(decodeResult.tableVersion);

            console.info(
              `[battle-data] Validated ${tname}: ${decodeResult.recordCount} records, table_version=${decodeResult.tableVersion}`,
            );
            validatedOffsets.push({
              table_name: tname,
              start_byte: start,
              byte_length: len,
              record_count: decodeResult.recordCount,
            });
          }
        } else {
          // No offsets: treat entire payload as single table slice
          const headerCheck = validateAvroHeader(data, maxBytes);
          if (!headerCheck.valid) {
            console.error(
              "[battle-data] Invalid Avro header:",
              headerCheck.error,
            );
            return c.json(
              { error: `Invalid Avro data: ${headerCheck.error}` },
              400,
            );
          }

          const schemaJson = extractSchemaFromOCF(data);
          if (!schemaJson) {
            console.error(
              "[battle-data] Failed to extract schema from payload",
            );
            return c.json(
              { error: "Invalid Avro: schema not found in header" },
              400,
            );
          }

          const decodeResult = await validateAvroOCFSmart(data, tableVersion);
          if (!decodeResult.valid) {
            console.error(
              "[battle-data] Decode validation failed:",
              decodeResult.errorMessage,
            );
            return c.json(
              {
                error: "Schema validation failed",
                details: decodeResult.errorMessage,
              },
              400,
            );
          }

          if (!decodeResult.tableVersion) {
            console.error("[battle-data] Missing table_version in Avro header");
            return c.json(
              { error: "table_version not found in Avro header" },
              400,
            );
          }

          if (decodeResult.tableVersion !== tableVersion) {
            console.error(
              `[battle-data] table_version mismatch: token=${tableVersion}, avro=${decodeResult.tableVersion}`,
            );
            return c.json(
              {
                error: `table_version mismatch: expected ${tableVersion}, got ${decodeResult.tableVersion}`,
              },
              400,
            );
          }

          detectedTableVersions.add(decodeResult.tableVersion);

          console.info(
            `[battle-data] Validated ${table}: ${decodeResult.recordCount} records, table_version=${decodeResult.tableVersion}`,
          );
          validatedOffsets.push({
            table_name: table,
            start_byte: 0,
            byte_length: data.byteLength,
            record_count: decodeResult.recordCount,
          });
        }

        if (detectedTableVersions.size > 1) {
          return c.json(
            {
              error: "Mixed table_version detected in upload",
              detected_versions: Array.from(detectedTableVersions),
            },
            400,
          );
        }

        // Send a SINGLE queue message with all tables batched
        // This reduces queue message consumption (15 tables = 1 message instead of 15)
        if (validatedOffsets.length) {
          try {
            const b64 = arrayBufferToBase64(data);
            // Note: Queue.send() takes the body directly (not wrapped in { body })
            // sendBatch() takes array of { body } objects
            const messageBody = {
              // Batch metadata
              batched: true,
              datasetId,
              periodTag,
              tableVersion,
              triggeredAt,
              userId: user.id,
              // Full payload (base64 encoded)
              payload_base64: b64,
              // Table offsets for splitting at consumer
              table_offsets: validatedOffsets,
            };

            console.info(
              "[battle-data] Sending 1 batched message to COMPACTION_QUEUE with",
              validatedOffsets.length,
              "tables",
            );
            await env.runtime.COMPACTION_QUEUE.send(messageBody);
            console.info(
              "[battle-data] Successfully enqueued batched message with",
              validatedOffsets.length,
              "tables",
            );
          } catch (sendErr) {
            console.error("[battle-data] FAILED at send", {
              error: String(sendErr),
              tableCount: validatedOffsets.length,
            });
            throw sendErr;
          }
        } else {
          console.warn("[battle-data] No valid tables to enqueue");
        }
      } catch (queueErr) {
        console.error("[battle-data] FAILED to enqueue to COMPACTION_QUEUE", {
          error: String(queueErr),
          stack: String(queueErr),
        });
        return c.json({ error: "Failed to enqueue slices" }, 500);
      }

      return {
        response: {
          ok: true,
          dataset_id: datasetId,
          table,
          period_tag: periodTag,
        },
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
  const env = createEnvContext(c);
  const indexDb = env.runtime.BATTLE_INDEX_DB;

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
    const tableVersion = c.req.query("table_version");
    let sql = `SELECT 
           bi.id AS id,
           bi.dataset_id,
           bi.table_name AS table_name,
           bi.length AS size,
           bi.table_version,
           af.file_path,
           af.created_at,
           bi.start_timestamp,
           bi.end_timestamp,
           bi.record_count
         FROM block_indexes bi
         JOIN archived_files af ON af.id = bi.file_id
         WHERE bi.dataset_id = ? AND bi.table_name = ?`;
    const params: unknown[] = [datasetId, table];

    if (tableVersion) {
      sql += ` AND bi.table_version = ?`;
      params.push(tableVersion);
    }

    // Convert ISO8601 to epoch millis if provided
    const fromMs = from ? Date.parse(from) : undefined;
    const toMs = to ? Date.parse(to) : undefined;
    if (fromMs && !Number.isNaN(fromMs)) {
      sql += ` AND bi.start_timestamp >= ?`;
      params.push(fromMs);
    }
    if (toMs && !Number.isNaN(toMs)) {
      sql += ` AND bi.end_timestamp <= ?`;
      params.push(toMs);
    }

    sql += ` ORDER BY bi.start_timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = indexDb.prepare(sql);
    const result = await stmt.bind(...params).all?.();
    if (!result) {
      throw new Error("D1 returned no results for chunks query");
    }

    const rows = (result.results || []) as any[];
    // Map block_indexes to response format
    const chunks = rows.map((r) => ({
      id: r.id,
      file_path: r.file_path,
      dataset_id: r.dataset_id,
      table: r.table_name,
      table_version: r.table_version,
      size: r.size,
      record_count: r.record_count,
      uploaded_at: new Date(r.start_timestamp).toISOString(),
    }));

    c.res.headers.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
    return c.json({
      chunks,
      count: chunks.length,
      dataset_id: datasetId,
      table,
    });
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
  const env = createEnvContext(c);
  const indexDb = env.runtime.BATTLE_INDEX_DB;

  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const datasetId = c.req.query("dataset_id");
  const table = c.req.query("table");

  if (!datasetId || !table) {
    return c.json({ error: "dataset_id and table are required" }, 400);
  }

  try {
    const tableVersion = c.req.query("table_version");
    let latestSql = `SELECT 
         bi.id,
         bi.dataset_id,
         bi.table_name AS table_name,
         bi.length AS size,
         bi.table_version,
         af.file_path,
         af.created_at,
         bi.start_timestamp,
         bi.record_count
       FROM block_indexes bi
       JOIN archived_files af ON af.id = bi.file_id
       WHERE bi.dataset_id = ? AND bi.table_name = ?`;
    const latestParams: unknown[] = [datasetId, table];
    if (tableVersion) {
      latestSql += ` AND bi.table_version = ?`;
      latestParams.push(tableVersion);
    }
    latestSql += ` ORDER BY bi.start_timestamp DESC LIMIT 1`;

    const stmt = indexDb.prepare(latestSql);
    const row = await stmt.bind(...latestParams).first?.();

    if (!row) {
      return c.json({ error: "No fragments found" }, 404);
    }

    const latest = {
      id: row.id,
      file_path: row.file_path,
      dataset_id: row.dataset_id,
      table: row.table_name,
      table_version: row.table_version,
      size: row.size,
      record_count: row.record_count,
      uploaded_at: new Date(Number(row.start_timestamp || 0)).toISOString(),
    };

    c.res.headers.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
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
  const env = createEnvContext(c);
  const indexDb = env.runtime.BATTLE_INDEX_DB;
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
    const tableVersion = c.req.query("table_version");
    let sql = `SELECT 
           bi.id,
           bi.dataset_id,
           bi.table_name AS table_name,
           bi.length AS size,
           bi.table_version,
           af.file_path,
           af.created_at,
           bi.start_timestamp,
           bi.end_timestamp,
           bi.record_count
         FROM block_indexes bi
         JOIN archived_files af ON af.id = bi.file_id
         WHERE bi.table_name = ?`;
    const params: unknown[] = [table];

    if (tableVersion) {
      sql += ` AND bi.table_version = ?`;
      params.push(tableVersion);
    }

    const fromMs = from ? Date.parse(from) : undefined;
    const toMs = to ? Date.parse(to) : undefined;
    if (fromMs && !Number.isNaN(fromMs)) {
      sql += ` AND bi.start_timestamp >= ?`;
      params.push(fromMs);
    }
    if (toMs && !Number.isNaN(toMs)) {
      sql += ` AND bi.end_timestamp <= ?`;
      params.push(toMs);
    }

    sql += ` ORDER BY bi.start_timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = indexDb.prepare(sql);
    const result = await stmt.bind(...params).all?.();
    if (!result) {
      throw new Error("D1 returned no results for global chunks query");
    }

    const rows = (result.results || []) as any[];
    const chunks = rows.map((r) => ({
      id: r.id,
      file_path: r.file_path,
      dataset_id: r.dataset_id,
      table: r.table_name,
      table_version: r.table_version,
      size: r.size,
      record_count: r.record_count,
      uploaded_at: new Date(r.start_timestamp).toISOString(),
    }));
    c.res.headers.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
    return c.json({ chunks, count: chunks.length, table });
  } catch (err) {
    console.error("[battle_data] Failed to query global chunks:", err);
    return c.json({ error: "Failed to retrieve global chunks" }, 500);
  }
});

/**
 * GET /global/records - Decode recent battle-related records for web UI analysis pages
 * Query params:
 *   - table: battle | cells | enemy_deck | enemy_ship
 *   - period_tag: latest | all | specific tag
 *   - dataset_id: optional dataset filter
 *   - limit_blocks: max archived blocks to decode (default 10, max 40)
 *   - limit_records: max records in response (default 3000, max 20000)
 */
app.get("/global/records", async (c) => {
  const env = createEnvContext(c);
  const indexDb = env.runtime.BATTLE_INDEX_DB;
  const bucket = env.runtime.BATTLE_DATA_BUCKET;

  if (!indexDb || !bucket) {
    return c.json({ error: "BATTLE index DB or R2 bucket is not configured" }, 500);
  }

  const table = (c.req.query("table") || "battle").trim();
  const periodTagParam = (c.req.query("period_tag") || "latest").trim();
  const datasetId = c.req.query("dataset_id")?.trim();
  const includeSortieKeyRaw =
    (c.req.query("include_sortie_key") || "1").trim().toLowerCase();
  const includeSortieKey = !["0", "false", "off", "no"].includes(includeSortieKeyRaw);
  const filterJsonRaw = c.req.query("filter_json")?.trim();
  const limitBlocks = parsePositiveInt(c.req.query("limit_blocks"), 10, 40);
  const limitRecords = parsePositiveInt(c.req.query("limit_records"), 3000, 20000);

  let recordFilter: Record<string, unknown> | null = null;
  if (filterJsonRaw) {
    try {
      const parsed = JSON.parse(filterJsonRaw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return c.json({ error: "INVALID_FILTER", message: "filter_json must be a JSON object" }, 400);
      }
      recordFilter = parsed as Record<string, unknown>;
    } catch {
      return c.json({ error: "INVALID_FILTER", message: "filter_json must be valid JSON" }, 400);
    }
  }

  if (!PUBLIC_RECORD_TABLES.has(table)) {
    return c.json(
      {
        error: "INVALID_TABLE",
        message: `table must be one of: ${Array.from(PUBLIC_RECORD_TABLES).join(", ")}`,
      },
      400,
    );
  }

  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cacheKey = new Request(c.req.url, { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("X-FUSOU-Cache", "HIT");
      return hit;
    }
  }

  try {
    let resolvedPeriodTag: string | null = null;
    if (periodTagParam === "latest") {
      const latest = (await indexDb
        .prepare(
          "SELECT period_tag FROM block_indexes WHERE table_name = ? ORDER BY period_tag DESC, start_timestamp DESC LIMIT 1",
        )
        .bind(table)
        .first()) as { period_tag?: string } | null;
      resolvedPeriodTag = latest?.period_tag ?? null;
    } else if (periodTagParam !== "all") {
      resolvedPeriodTag = periodTagParam;
    }

    let sql = `SELECT bi.id, bi.dataset_id, bi.start_byte, bi.length, bi.start_timestamp, bi.end_timestamp, bi.period_tag, af.file_path
               FROM block_indexes bi
               JOIN archived_files af ON af.id = bi.file_id
               WHERE bi.table_name = ?`;
    const params: unknown[] = [table];

    if (resolvedPeriodTag) {
      sql += " AND bi.period_tag = ?";
      params.push(resolvedPeriodTag);
    }
    if (datasetId) {
      sql += " AND bi.dataset_id = ?";
      params.push(datasetId);
    }

    sql += " ORDER BY bi.start_timestamp DESC LIMIT ?";
    params.push(limitBlocks);

    const blockResult = await indexDb.prepare(sql).bind(...params).all?.();
    const rows = (blockResult?.results || []) as Array<{
      id: number;
      dataset_id: string;
      start_byte: number;
      length: number;
      start_timestamp: number | null;
      end_timestamp: number | null;
      period_tag: string | null;
      file_path: string;
    }>;

    if (rows.length === 0) {
      const payload = {
        success: true,
        table,
        period_tag: resolvedPeriodTag || periodTagParam,
        count: 0,
        records: [],
        source_blocks: 0,
      };
      const response = c.json(payload);
      response.headers.set(
        "Cache-Control",
        "public, max-age=30, stale-while-revalidate=120",
      );
      response.headers.set("X-FUSOU-Cache", "MISS");
      if (cache) {
        c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      return response;
    }

    const decodedRecords: any[] = [];
    for (const row of rows) {
      try {
        const recs = await decodeIndexedBlock(
          bucket,
          row.file_path,
          Number(row.start_byte || 0),
          Number(row.length || 0),
        );
        for (const rec of recs) {
          if (recordFilter && !matchesRecordFilter(rec, recordFilter)) {
            continue;
          }
          decodedRecords.push(rec);
          if (decodedRecords.length >= limitRecords) {
            break;
          }
        }
        if (decodedRecords.length >= limitRecords) {
          break;
        }
      } catch (err) {
        console.warn("[battle-data] failed to decode block in /global/records", {
          table,
          blockId: row.id,
          filePath: row.file_path,
          error: String(err),
        });
      }
    }

    if (table === "battle" && includeSortieKey) {
      attachSortieIds(decodedRecords);
    }

    const payload = {
      success: true,
      table,
      period_tag: resolvedPeriodTag || periodTagParam,
      count: decodedRecords.length,
      records: decodedRecords,
      source_blocks: rows.length,
    };
    const response = c.json(payload);
    response.headers.set(
      "Cache-Control",
      "public, max-age=30, stale-while-revalidate=120",
    );
    response.headers.set("X-FUSOU-Cache", "MISS");
    if (cache) {
      c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  } catch (err) {
    console.error("[battle-data] Failed to fetch global records:", err);
    return c.json({ error: "Failed to decode records" }, 500);
  }
});

/**
 * GET /global/latest - Latest fragment across all users for table/period
 * Query params: table, period_tag
 */
app.get("/global/latest", async (c) => {
  const env = createEnvContext(c);
  const indexDb = env.runtime.BATTLE_INDEX_DB;
  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const table = c.req.query("table");

  if (!table) {
    return c.json({ error: "table is required" }, 400);
  }

  try {
    const tableVersion = c.req.query("table_version");
    let globalLatestSql = `SELECT 
         bi.id,
         bi.dataset_id,
         bi.table_name AS table_name,
         bi.length AS size,
         bi.table_version,
         af.file_path,
         af.created_at,
         bi.start_timestamp,
         bi.record_count
       FROM block_indexes bi
       JOIN archived_files af ON af.id = bi.file_id
       WHERE bi.table_name = ?`;
    const globalLatestParams: unknown[] = [table];
    if (tableVersion) {
      globalLatestSql += ` AND bi.table_version = ?`;
      globalLatestParams.push(tableVersion);
    }
    globalLatestSql += ` ORDER BY bi.start_timestamp DESC LIMIT 1`;

    const stmt = indexDb.prepare(globalLatestSql);
    const row = await stmt.bind(...globalLatestParams).first?.();
    if (!row) {
      return c.json({ error: "No fragments found" }, 404);
    }

    const latest = {
      id: row.id,
      file_path: row.file_path,
      dataset_id: row.dataset_id,
      table: row.table_name,
      table_version: row.table_version,
      size: row.size,
      record_count: row.record_count,
      uploaded_at: new Date(Number(row.start_timestamp || 0)).toISOString(),
    };

    c.res.headers.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
    return c.json({ latest });
  } catch (err) {
    console.error("[battle_data] Failed to query global latest:", err);
    return c.json({ error: "Failed to retrieve global latest fragment" }, 500);
  }
});

export default app;
