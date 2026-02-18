import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS, MAX_UPLOAD_BYTES, SIGNED_URL_TTL_SECONDS } from "../constants";
import { createEnvContext, getEnv, validateJWT, extractBearer } from "../utils";
import { handleTwoStageUpload } from "../utils/upload";
import { ERROR_CODES, createErrorResponse } from "../error-codes";

const app = new Hono<{ Bindings: Bindings }>();

// Allowed master data table names
// MUST match client's GetDataTableEncode struct exactly (kc_api::database::table)
// All 13 tables that clients provide
const ALLOWED_MASTER_TABLES = new Set([
  "mst_ship",
  "mst_shipgraph",
  "mst_slotitem",
  "mst_slotitem_equiptype",
  "mst_payitem",
  "mst_equip_exslot",
  "mst_equip_exslot_ship",
  "mst_equip_limit_exslot",
  "mst_equip_ship",
  "mst_stype",
  "mst_map_area",
  "mst_map_info",
  "mst_ship_upgrade",
]);

// OPTIONS (CORS)
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

/**
 * POST /upload - Master data bulk upload (all tables in one request)
 *
 * Purpose: Upload all master data tables at once to R2 with D1 metadata tracking
 * 
 * Key changes from individual upload:
 * - Single request for all 12 tables (~240kB total)
 * - Client concatenates all tables and provides table_offsets
 * - Atomic: all tables uploaded together or none
 * - Reuses battle_data pattern (proven implementation)
 * 
 * Key constraints:
 * - Master data is shared across all users (global)
 * - Each period_tag can only be uploaded once (all tables together)
 * - Once uploaded, content is immutable
 * 
 * Race condition handling (D1-first pattern):
 * 1. Preparation: INSERT ... ON CONFLICT DO NOTHING to claim ownership for entire period
 *    - If returns id: this user is first, proceed with R2 upload
 *    - If returns NULL: another user already has this period, return 409
 * 2. Execution: Split data by table_offsets, upload all to R2, then UPDATE D1 status to 'completed'
 * 
 * Upload flow:
 * 1. Client concatenates all tables and sends metadata + table_offsets in preparation phase
 * 2. Server attempts to claim ownership in D1 with UNIQUE(period_tag) constraint
 * 3. If successful, client uploads concatenated binary data
 * 4. Server splits by table_offsets, uploads each to R2, marks D1 as 'completed'
 * 5. Cleanup job handles orphaned 'pending' records after timeout
 */
app.post("/upload", async (c) => {
  // [Bug Fix #2] Authentication check
  const authHeader = c.req.header("Authorization");
  const accessToken = extractBearer(authHeader);
  if (!accessToken) {
    return c.json({ error: "Missing Authorization bearer token" }, 401);
  }
  const supabaseUser = await validateJWT(accessToken);
  if (!supabaseUser) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const env = createEnvContext(c);
  const bucket = env.runtime.MASTER_DATA_BUCKET;
  const db = env.runtime.MASTER_DATA_INDEX_DB;
  const signingSecret = getEnv(env, "MASTER_DATA_SIGNING_SECRET");

  if (!bucket || !db || !signingSecret) {
    console.error("[master-data] missing bindings", {
      hasBucket: !!bucket,
      hasDb: !!db,
      hasSigningSecret: !!signingSecret,
    });
    return c.json({ error: "Master data storage not configured" }, 503);
  }

  return handleTwoStageUpload(c, {
    bucket,
    signingSecret,
    tokenTTL: 300, // 5 minutes is enough for ~240kB (no dynamic TTL needed)
    maxBodySize: MAX_UPLOAD_BYTES,

    // Preparation phase: claim ownership for entire period
    preparationValidator: async (body, user) => {
      const periodTag = typeof body?.kc_period_tag === "string" ? body.kc_period_tag.trim() : "";
      const tableVersion = typeof body?.table_version === "string"
        ? body.table_version.trim()
        : typeof body?.tableVersion === "string"
          ? body.tableVersion.trim()
          : "";
      const contentHash = typeof body?.content_hash === "string" ? body.content_hash.trim() : "";
      const tableOffsetsStr = typeof body?.table_offsets === "string" ? body.table_offsets.trim() : "";

      // Validate period_tag
      const MAX_PERIOD_TAG_LENGTH = 64;
      if (!periodTag || periodTag.length === 0) {
        return c.json({ error: "kc_period_tag is required" }, 400);
      }
      if (periodTag.length > MAX_PERIOD_TAG_LENGTH) {
        return c.json({ error: `kc_period_tag must be 1-${MAX_PERIOD_TAG_LENGTH} characters` }, 400);
      }
      if (!/^[a-zA-Z0-9_\-]+$/.test(periodTag)) {
        return c.json({ error: "kc_period_tag must contain only ASCII alphanumeric characters, underscores, and hyphens" }, 400);
      }
      if (periodTag.startsWith('.') || periodTag.startsWith('/') || periodTag.includes('..')) {
        return c.json({ error: "kc_period_tag cannot start with . or / or contain .." }, 400);
      }

      if (!tableVersion) {
        return c.json({ error: "table_version is required" }, 400);
      }

      // Validate content_hash
      if (!contentHash) {
        return c.json({ error: "content_hash (SHA-256) is required" }, 400);
      }
      if (!/^[a-f0-9]{64}$/i.test(contentHash)) {
        return c.json({ error: "content_hash must be a valid SHA-256 hash (64 hexadecimal characters)" }, 400);
      }

      // Validate file size

      // Handle both number and string types (Rust sends as number, other clients may send as string)
      let declaredSize: number;
      const fileSizeRaw = body?.file_size;
      
      if (typeof fileSizeRaw === "number") {
        declaredSize = fileSizeRaw;
      } else if (typeof fileSizeRaw === "string") {
        const parsed = parseInt(fileSizeRaw.trim(), 10);
        if (isNaN(parsed)) {
          return c.json({ error: "file_size must be a valid number" }, 400);
        }
        declaredSize = parsed;
      } else {
        return c.json({ error: "file_size is required" }, 400);
      }
      
      if (declaredSize <= 0 || declaredSize > MAX_UPLOAD_BYTES) {
        return c.json({ error: `Invalid file size. Must be > 0 and <= ${MAX_UPLOAD_BYTES} bytes` }, 400);
      }
      // Parse and validate table_offsets
      if (!tableOffsetsStr) {
        return c.json({ error: "table_offsets is required for bulk upload" }, 400);
      }

      let tableOffsets: Array<{ table_name: string; start: number; end: number }> = [];
      try {
        tableOffsets = JSON.parse(tableOffsetsStr);
        if (!Array.isArray(tableOffsets) || tableOffsets.length === 0) {
          return c.json({ error: "table_offsets must be a non-empty array" }, 400);
        }
      } catch (e) {
        return c.json({ error: "table_offsets must be valid JSON" }, 400);
      }

      // Validate all tables are present and valid
      const providedTables = new Set<string>();
      for (let i = 0; i < tableOffsets.length; i++) {
        const offset = tableOffsets[i];
        
        if (!offset.table_name || typeof offset.table_name !== 'string') {
          return c.json({ error: `table_offsets[${i}]: table_name is required and must be string` }, 400);
        }
        
        if (!ALLOWED_MASTER_TABLES.has(offset.table_name)) {
          return c.json({ 
            error: `table_offsets[${i}]: invalid table_name "${offset.table_name}". Allowed: ${Array.from(ALLOWED_MASTER_TABLES).join(", ")}` 
          }, 400);
        }
        
        if (typeof offset.start !== 'number' || typeof offset.end !== 'number') {
          return c.json({ error: `table_offsets[${i}]: start and end must be numbers` }, 400);
        }
        
        if (!Number.isInteger(offset.start) || !Number.isInteger(offset.end)) {
          return c.json({ error: `table_offsets[${i}]: start and end must be integers` }, 400);
        }
        
        if (offset.start < 0 || offset.end <= offset.start) {
          return c.json({ error: `table_offsets[${i}]: invalid range (start=${offset.start}, end=${offset.end})` }, 400);
        }
        
        if (offset.end > declaredSize) {
          return c.json({ error: `table_offsets[${i}]: end (${offset.end}) exceeds declared file size (${declaredSize})` }, 400);
        }
        
        if (providedTables.has(offset.table_name)) {
          return c.json({ error: `table_offsets[${i}]: duplicate table_name "${offset.table_name}"` }, 400);
        }
        
        providedTables.add(offset.table_name);
      }

      // Check for missing required tables
      const missingTables = Array.from(ALLOWED_MASTER_TABLES).filter(t => !providedTables.has(t));
      if (missingTables.length > 0) {
        return c.json({ 
          error: `Missing required tables: ${missingTables.join(", ")}` 
        }, 400);
      }

      // Validate offsets are contiguous and cover entire file
      const sortedOffsets = [...tableOffsets].sort((a, b) => a.start - b.start);
      if (sortedOffsets[0].start !== 0) {
        return c.json({ error: "table_offsets must start at offset 0" }, 400);
      }
      if (sortedOffsets[sortedOffsets.length - 1].end !== declaredSize) {
        return c.json({ error: "table_offsets must cover entire file" }, 400);
      }
      for (let i = 1; i < sortedOffsets.length; i++) {
        if (sortedOffsets[i].start !== sortedOffsets[i - 1].end) {
          return c.json({ error: "table_offsets must be contiguous (no gaps or overlaps)" }, 400);
        }
      }

      // Attempt to claim ownership for this period via INSERT ... ON CONFLICT DO NOTHING
      // UNIQUE(period_tag) ensures only one upload per period
      try {
        const stmt = db.prepare(`
          INSERT INTO master_data_index 
            (period_tag, table_version, content_hash, upload_status, uploaded_by, created_at)
          VALUES (?, ?, 'pending', ?, ?, ?)
          ON CONFLICT(period_tag, table_version) DO NOTHING
          RETURNING id
        `);
        
        const now = Date.now();
        const result = await stmt.bind(
          periodTag,
          tableVersion,
          contentHash,
          user.id,
          now
        ).first() as { id?: number } | null;
        
        if (!result?.id) {
          // Another user already claimed this period
          console.info(`[master-data] Duplicate period detected: ${periodTag}`);
          return c.json(
            { 
              error: "Master data for this period has already been uploaded",
              period_tag: periodTag,
            },
            409
          );
        }

        // We successfully claimed ownership
        console.info(`[master-data] Claimed ownership: id=${result.id}, period=${periodTag}, tables=${tableOffsets.length}`);

        return {
          tokenPayload: {
            record_id: result.id,
            period_tag: periodTag,
            table_version: tableVersion,
            content_hash: contentHash,
            declared_size: declaredSize,
            table_offsets: tableOffsetsStr,
            table_count: tableOffsets.length,
          },
        };
      } catch (err) {
        console.error(`[master-data] Error claiming ownership:`, err);
        console.error(`[master-data] Error details:`, {
          message: err instanceof Error ? err.message : String(err),
          periodTag,
          contentHashLength: contentHash.length,
          tableOffsetsLength: tableOffsetsStr.length,
        });
        return c.json({ 
          error: "Failed to process upload request",
          details: err instanceof Error ? err.message : String(err)
        }, 500);
      }
    },

    // Execution phase: split data by table_offsets, upload all to R2, mark D1 as completed
    executionProcessor: async (tokenPayload, data, user) => {
      // [Issue #19] Validate token payload with type safety
      const { validateTokenPayload } = await import("../utils");
      const payloadValidation = validateTokenPayload(tokenPayload, [
        'record_id',
        'period_tag',
        'content_hash',
        'table_offsets',
        'table_count',
        'declared_size', // [Bug Fix #3] Add missing required field
      ]);
      
      if (!payloadValidation.valid) {
        console.error(`[master-data] Invalid token payload: ${payloadValidation.error}`);
        return new Response(JSON.stringify({
          error: `Invalid upload token: ${payloadValidation.error}`,
          code: "INVALID_TOKEN_PAYLOAD",
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const recordId = tokenPayload.record_id as number;
      const periodTag = tokenPayload.period_tag as string;
      const tableVersion = tokenPayload.table_version as string;
      const expectedContentHash = tokenPayload.content_hash as string;
      const tableOffsetsStr = tokenPayload.table_offsets as string;
      const tableCount = tokenPayload.table_count as number;

      // [Bug Fix #2] Verify uploaded data size matches declared size
      if (data.byteLength !== tokenPayload.declared_size) {
        return new Response(JSON.stringify({ 
          error: "Data size mismatch",
          expected: tokenPayload.declared_size,
          actual: data.byteLength
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        // [Bug Fix #1] Verify content_hash matches the uploaded data (using Web Crypto API)
        // Ensure the input satisfies BufferSource typing across TS versions
        const bytes = (data.buffer instanceof ArrayBuffer && data.byteOffset === 0)
          ? data
          : new Uint8Array(data);
        const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
        const actualContentHash = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        // [Bug Fix #15] Hash comparison must be case-insensitive
        if (actualContentHash.toLowerCase() !== expectedContentHash.toLowerCase()) {
          console.warn(
            `[master-data] Content hash mismatch for id=${recordId}: expected ${expectedContentHash}, got ${actualContentHash}`
          );

          // Mark as failed without uploading
          try {
            const stmt = db.prepare(`
              UPDATE master_data_index
              SET upload_status = 'failed', r2_keys = NULL
              WHERE id = ?
            `);
            await stmt.bind(recordId).run();
          } catch (updateErr) {
            console.error(`[master-data] Failed to mark hash mismatch: ${String(updateErr)}`);
          }

          return new Response(JSON.stringify({
            error: "Content hash mismatch - data may be corrupted",
            expected: expectedContentHash,
            actual: actualContentHash,
          }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Parse table_offsets and split data
        let tableOffsets: Array<{ table_name: string; start: number; end: number }> = [];
        try {
          tableOffsets = JSON.parse(tableOffsetsStr);
        } catch (e) {
          console.error(`[master-data] Failed to parse table_offsets: ${String(e)}`);
          return new Response(JSON.stringify({ error: "Invalid table_offsets in token" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        console.info(`[master-data] Splitting data into ${tableOffsets.length} tables for period ${periodTag}`);

        // Split data and upload each table to R2
        const r2Keys: string[] = [];
        const uploadResults: Array<{ table: string; r2_key: string; size: number }> = [];
        
        for (const offset of tableOffsets) {
          const tableData = data.slice(offset.start, offset.end);
          const r2Key = `master_data/${tableVersion}/${periodTag}/${offset.table_name}.avro`;

          console.info(`[master-data] Uploading ${offset.table_name}: ${r2Key} (${tableData.byteLength} bytes)`);

          try {
            // Compute hash for this individual table for integrity verification
            const tableHashBuf = await crypto.subtle.digest('SHA-256', tableData);
            const tableContentHash = Array.from(new Uint8Array(tableHashBuf))
              .map(b => b.toString(16).padStart(2, '0'))
              .join('');

            const r2Result = await bucket.put(r2Key, tableData, {
              httpMetadata: {
                contentType: "application/octet-stream",
                cacheControl: "public, max-age=31536000, immutable", // 1 year, immutable
              },
              customMetadata: {
                table_name: offset.table_name,
                period_tag: periodTag,
                table_version: tableVersion,
                table_hash: tableContentHash, // Hash of individual table
                uploaded_by: user.id,
                batch_hash: expectedContentHash, // Hash of entire batch for reference
                uploaded_at: new Date().toISOString(),
              },
            });

            if (!r2Result) {
              throw new Error(`R2 put() returned null for ${offset.table_name}`);
            }

            r2Keys.push(r2Key);
            uploadResults.push({
              table: offset.table_name,
              r2_key: r2Key,
              size: tableData.byteLength,
            });

            console.info(`[master-data] Successfully uploaded ${offset.table_name} to ${r2Key}`);
          } catch (r2Err) {
            console.error(`[master-data] R2 put() failed for ${offset.table_name}: ${String(r2Err)}`);

            // Cleanup: delete all successfully uploaded tables before this failure
            console.warn(`[master-data] Cleaning up ${r2Keys.length} partially uploaded tables`);
            const failedCleanups: string[] = [];
            for (const keyToDelete of r2Keys) {
              try {
                await bucket.delete(keyToDelete);
                console.info(`[master-data] Deleted ${keyToDelete}`);
              } catch (delErr) {
                console.error(`[master-data] Failed to delete ${keyToDelete}: ${String(delErr)}`);
                failedCleanups.push(keyToDelete);
              }
            }

            // Mark D1 as failed (preserve failed cleanup keys for cleanup job)
            try {
              const stmt = db.prepare(`
                UPDATE master_data_index
                SET upload_status = 'failed', r2_keys = ?
                WHERE id = ?
              `);
              // [Bug Fix #4] Store failed cleanup keys so cleanup job can retry
              const r2KeysToStore = failedCleanups.length > 0 ? JSON.stringify(failedCleanups) : null;
              await stmt.bind(r2KeysToStore, recordId).run();
            } catch (markErr) {
              console.error(`[CRITICAL] Failed to mark record as failed after R2 error: ${String(markErr)}`);
            }

            return new Response(JSON.stringify({
              error: `Failed to upload table ${offset.table_name} to R2`,
              failed_table: offset.table_name,
            }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        console.info(`[master-data] All ${r2Keys.length} tables uploaded successfully for period ${periodTag}`);

        try {
          // Insert master_data_tables records for querying by data-loader
          for (let i = 0; i < tableOffsets.length; i++) {
            const offset = tableOffsets[i];
            const tableStmt = db.prepare(`
              INSERT INTO master_data_tables 
                (master_data_id, table_name, table_version, table_index, start_byte, end_byte, record_count, r2_key, content_hash, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            // Compute hash for this individual table
            const tableData = data.slice(offset.start, offset.end);
            const tableHashBuf = await crypto.subtle.digest('SHA-256', tableData);
            const tableContentHash = Array.from(new Uint8Array(tableHashBuf))
              .map(b => b.toString(16).padStart(2, '0'))
              .join('');
            
            const r2Key = `master_data/${tableVersion}/${periodTag}/${offset.table_name}.avro`;
            const now = Date.now();
            
            await tableStmt.bind(
              recordId,
              offset.table_name,
              tableVersion,
              i,
              offset.start,
              offset.end,
              null,  // record_count will be calculated if needed
              r2Key,
              tableContentHash,
              now
            ).run();
          }

          const stmt = db.prepare(`
            UPDATE master_data_index
            SET upload_status = 'completed', 
                r2_keys = ?, 
                completed_at = ?
            WHERE id = ?
          `);

          const now = Date.now();
          await stmt.bind(JSON.stringify(r2Keys), now, recordId).run();

          console.info(`[master-data] D1 record updated: id=${recordId}, status=completed, tables=${r2Keys.length}`);
        } catch (d1Err) {
          // D1 update failed - R2 objects exist but D1 is not updated
          console.error(`[master-data] D1 update failed: ${String(d1Err)}`);
          console.warn(`[CRITICAL] Orphaned R2 objects: ${r2Keys.join(", ")} - cleanup job will handle`);

          // Try to mark as failed in D1 (preserve r2_keys so cleanup job can delete them)
          try {
            const failStmt = db.prepare(`
              UPDATE master_data_index
              SET upload_status = 'failed', r2_keys = ?
              WHERE id = ?
            `);
            await failStmt.bind(JSON.stringify(r2Keys), recordId).run();
          } catch (markFailErr) {
            // [Bug Fix #5] Double failure - store r2_keys in fallback location (alert/logging)
            console.error(`[CRITICAL] DOUBLE FAILURE: Cannot update D1 to track r2_keys`);
            console.error(`[CRITICAL] Orphaned R2 keys: ${JSON.stringify(r2Keys)}`);
            console.error(`[CRITICAL] Period: ${periodTag}, Record ID: ${recordId}`);
            console.error(`[CRITICAL] Primary error: ${String(d1Err)}`);
            console.error(`[CRITICAL] Secondary error: ${String(markFailErr)}`);
            
            // TODO: Send alert to monitoring system (Sentry, CloudWatch, etc.)
            // For now, ensure it's logged for manual recovery
          }

          return new Response(JSON.stringify({
            error: "Completed R2 upload but failed to update metadata. Upload will be cleaned up by system.",
          }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }

        return {
          response: {
            ok: true,
            period_tag: periodTag,
            tables_uploaded: uploadResults.length,
            total_size: data.byteLength,
            r2_keys: r2Keys,
            upload_results: uploadResults,
          },
        };
      } catch (err) {
        console.error(`[master-data] Error during execution: ${String(err)}`);

        // Mark D1 record as failed
        try {
          const stmt = db.prepare(`
            UPDATE master_data_index
            SET upload_status = 'failed', r2_keys = NULL
            WHERE id = ?
          `);
          await stmt.bind(recordId).run();
        } catch (updateErr) {
          console.error(
            `[master-data] Failed to mark record as failed: ${String(updateErr)}`
          );
        }

        return new Response(JSON.stringify({ error: "Failed to upload master data" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  });
});

/**
 * GET /exists - Check if master data for a period already exists
 * 
 * Query params:
 * - period_tag: required
 * 
 * Returns 200 with metadata if found, 404 if not found
 * Requires: Authorization bearer token
 */
app.get("/exists", async (c) => {
  const authHeader = c.req.header("Authorization");
  const accessToken = extractBearer(authHeader);
  if (!accessToken) {
    return c.json({ error: "Missing Authorization bearer token" }, 401);
  }
  const supabaseUser = await validateJWT(accessToken);
  if (!supabaseUser) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const env = createEnvContext(c);
  const db = env.runtime.MASTER_DATA_INDEX_DB;

  if (!db) {
    return c.json({ error: "Master data storage not configured" }, 503);
  }

  const periodTag = c.req.query("period_tag");
  const tableVersion = c.req.query("table_version");

  if (!periodTag) {
    return c.json({ error: "period_tag is required" }, 400);
  }

  try {
    let sql = `
      SELECT id, period_tag, table_version, content_hash, r2_keys, upload_status, created_at, completed_at
      FROM master_data_index
      WHERE period_tag = ? AND upload_status = 'completed'
    `;
    const params: unknown[] = [periodTag];
    if (tableVersion) {
      sql += ' AND table_version = ?';
      params.push(tableVersion);
    }
    sql += ' LIMIT 1';

    const stmt = db.prepare(sql);
    const result = await stmt.bind(...params).first();

    if (!result) {
      return c.json({ exists: false }, 404);
    }

    return c.json({
      exists: true,
      data: {
        id: result.id,
        period_tag: result.period_tag,
        table_version: result.table_version,
        table_count: result.table_count,
        table_offsets: result.table_offsets ? JSON.parse(result.table_offsets) : [],
        upload_status: result.upload_status,
        created_at: result.created_at,
        completed_at: result.completed_at,
      },
    });
  } catch (err) {
    console.error(`[master-data] Error checking existence: ${String(err)}`);
    return c.json({ error: "Failed to check master data existence" }, 500);
  }
});

/**
 * GET /latest - Get latest version of master data
 * 
 * Query params:
 * - None (returns most recent completed period)
 * 
 * Returns the most recently completed upload
 * Requires: Authorization bearer token
 */
app.get("/latest", async (c) => {
  const authHeader = c.req.header("Authorization");
  const accessToken = extractBearer(authHeader);
  if (!accessToken) {
    return c.json({ error: "Missing Authorization bearer token" }, 401);
  }
  const supabaseUser = await validateJWT(accessToken);
  if (!supabaseUser) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const env = createEnvContext(c);
  const db = env.runtime.MASTER_DATA_INDEX_DB;

  if (!db) {
    return c.json({ error: "Master data storage not configured" }, 503);
  }

  try {
    const tableVersion = c.req.query("table_version");
    let sql = `
      SELECT id, period_tag, table_version, content_hash, r2_keys, upload_status, created_at, completed_at
      FROM master_data_index
      WHERE upload_status = 'completed'
    `;
    const params: unknown[] = [];
    if (tableVersion) {
      sql += ' AND table_version = ?';
      params.push(tableVersion);
    }
    sql += ' ORDER BY completed_at DESC LIMIT 1';
    
    const stmt = db.prepare(sql);
    const result = await stmt.bind(...params).first();

    if (!result) {
      return c.json({ exists: false }, 404);
    }

    return c.json({
      exists: true,
      data: {
        id: result.id,
        period_tag: result.period_tag,
        table_version: result.table_version,
        table_count: result.table_count,
        table_offsets: result.table_offsets ? JSON.parse(result.table_offsets) : [],
        upload_status: result.upload_status,
        created_at: result.created_at,
        completed_at: result.completed_at,
      },
    });
  } catch (err) {
    console.error(`[master-data] Error fetching latest: ${String(err)}`);
    return c.json({ error: "Failed to fetch master data metadata" }, 500);
  }
});

/**
 * GET /download - Download master data from R2
 * 
 * Query params:
 * - period_tag: required
 * - table_name: required (which table to download)
 * 
 * Returns binary Avro data for the specified table
 * Requires: Authorization bearer token
 */
app.get("/download", async (c) => {
  const authHeader = c.req.header("Authorization");
  const accessToken = extractBearer(authHeader);
  if (!accessToken) {
    return c.json({ error: "Missing Authorization bearer token" }, 401);
  }
  const supabaseUser = await validateJWT(accessToken);
  if (!supabaseUser) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const env = createEnvContext(c);
  const db = env.runtime.MASTER_DATA_INDEX_DB;
  const bucket = env.runtime.MASTER_DATA_BUCKET;

  if (!db || !bucket) {
    return c.json({ error: "Master data storage not configured" }, 503);
  }

  const periodTag = c.req.query("period_tag");
  const tableName = c.req.query("table_name");
  const tableVersion = c.req.query("table_version");

  if (!periodTag) {
    return c.json({ error: "period_tag is required" }, 400);
  }
  
  if (!tableName) {
    return c.json({ error: "table_name is required" }, 400);
  }

  if (!tableVersion) {
    return c.json({ error: "table_version is required" }, 400);
  }

  // Validate table_name
  if (!ALLOWED_MASTER_TABLES.has(tableName)) {
    return c.json({ 
      error: `Invalid table_name. Allowed: ${Array.from(ALLOWED_MASTER_TABLES).join(", ")}` 
    }, 400);
  }

  try {
    // Find the metadata record for this period
    let sql = `
      SELECT r2_keys, table_offsets
      FROM master_data_index
      WHERE period_tag = ? AND upload_status = 'completed'
    `;
    const params: unknown[] = [periodTag];
    if (tableVersion) {
      sql += ' AND table_version = ?';
      params.push(tableVersion);
    }
    sql += ' LIMIT 1';
    const stmt = db.prepare(sql);

    const record = await stmt.bind(...params).first() as { r2_keys?: string; table_offsets?: string } | null;

    if (!record?.r2_keys) {
      return c.json({ error: "Master data not found for this period" }, 404);
    }

    // Parse r2_keys to find the key for this table
    let r2Keys: string[] = [];
    try {
      r2Keys = JSON.parse(record.r2_keys);
    } catch (e) {
      console.error(`[master-data] Failed to parse r2_keys: ${String(e)}`);
      return c.json({ error: "Invalid metadata" }, 500);
    }

    // [Bug Fix #8] Explicitly use table_offsets to validate table presence
    let tableOffsetsArray: Array<{ table_name: string; start: number; end: number }> = [];
    if (record.table_offsets) {
      try {
        tableOffsetsArray = JSON.parse(record.table_offsets);
      } catch (e) {
        console.warn(`[master-data] Failed to parse table_offsets for metadata: ${String(e)}`);
      }
    }

    // Find the R2 key for this specific table
    // Format: master_data/{table_version}/{period_tag}/{table_name}.avro
    const expectedKey = `master_data/${tableVersion}/${periodTag}/${tableName}.avro`;
    const r2Key = r2Keys.find(key => key === expectedKey);

    if (!r2Key) {
      return c.json({ 
        error: `Table ${tableName} not found in this period`,
        available_tables: r2Keys.map(k => k.split('/').pop()?.replace('.avro', '')).filter(Boolean)
      }, 404);
    }

    // Fetch from R2
    const r2Object = await bucket.get(r2Key);

    if (!r2Object) {
      console.error(`[master-data] R2 object not found: ${r2Key}`);
      return c.json({ error: "Master data file not found in storage" }, 404);
    }

    // Stream from R2
    return new Response(r2Object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": r2Object.size.toString(),
        "Content-Disposition": `attachment; filename="${tableName}.avro"`,
        "Cache-Control": "public, max-age=31536000, immutable",
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    console.error(`[master-data] Error downloading: ${String(err)}`);
    return c.json({ error: "Failed to download master data" }, 500);
  }
});

export default app;
