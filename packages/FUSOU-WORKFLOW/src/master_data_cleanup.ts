/**
 * Master Data Cleanup Worker
 * 
 * Purpose: Clean up orphaned master data records and R2 objects
 * 
 * Scheduled tasks:
 * 1. Find 'pending' records older than 1 hour
 * 2. Delete orphaned R2 objects
 * 3. Mark D1 records as 'failed'
 * 
 * This prevents accumulation of incomplete uploads due to client crashes or timeouts
 */

interface Env {
  MASTER_DATA_BUCKET: R2Bucket;
  MASTER_DATA_INDEX_DB: D1Database;
  MASTER_DATA_CLEANUP_TOKEN?: string;
}

interface MasterDataRecord {
  id: number;
  period_tag: string;
  content_hash: string;
  r2_keys: string | null; // JSON array of R2 keys
  upload_status: string;
  created_at: number;
  table_count: number;
}

/**
 * Cleanup orphaned master data uploads
 * Called via scheduled cron job
 */
export async function cleanupOrphanedMasterData(env: Env): Promise<{
  cleaned: number;
  deleted: number;
  errors: string[];
}> {
  const db = env.MASTER_DATA_INDEX_DB;
  const bucket = env.MASTER_DATA_BUCKET;
  const errors: string[] = [];
  let cleaned = 0;
  let deleted = 0;

  try {
    // Find pending records older than 1 hour (no R2 keys uploaded yet)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    
    const stmt = db.prepare(`
      SELECT id, period_tag, content_hash, r2_keys, table_offsets, upload_status, created_at, table_count
      FROM master_data_index
      WHERE upload_status = 'pending' AND created_at < ? AND r2_keys IS NULL
    `);

    const pendingRecords = await stmt.bind(oneHourAgo).all() as { results?: MasterDataRecord[] };
    const records = pendingRecords.results || [];

    console.log(`[master-data-cleanup] Found ${records.length} orphaned pending records`);

    for (const record of records) {
      try {
        // Mark D1 record as failed
        const updateStmt = db.prepare(`
          UPDATE master_data_index
          SET upload_status = 'failed'
          WHERE id = ?
        `);

        await updateStmt.bind(record.id).run();
        cleaned++;

        console.info(`[master-data-cleanup] Marked as failed: period=${record.period_tag}, id=${record.id}`);
      } catch (err) {
        const msg = `Failed to clean up record ${record.id}: ${String(err)}`;
        console.error(`[master-data-cleanup] ${msg}`);
        errors.push(msg);
      }
    }

    // Find and delete orphaned R2 objects (r2_keys exists but D1 record is failed/pending)
    // This handles the case where R2 upload succeeded but D1 update failed
    try {
      const orphanStmt = db.prepare(`
        SELECT id, r2_keys, period_tag
        FROM master_data_index
        WHERE (upload_status = 'failed' OR upload_status = 'pending') AND r2_keys IS NOT NULL
      `);

      const orphanedRecords = await orphanStmt.all() as { results?: { id: number; r2_keys: string; period_tag: string }[] };
      const orphans = orphanedRecords.results || [];

      console.log(`[master-data-cleanup] Found ${orphans.length} orphaned R2 object sets to clean`);

      for (const orphan of orphans) {
        try {
          // Parse r2_keys JSON array
          let r2Keys: string[] = [];
          try {
            r2Keys = JSON.parse(orphan.r2_keys);
          } catch (parseErr) {
            console.error(`[master-data-cleanup] Failed to parse r2_keys for id=${orphan.id}: ${String(parseErr)}`);
            errors.push(`Invalid r2_keys JSON for record ${orphan.id}`);
            continue;
          }

          // [Bug Fix #6] Validate r2_keys is an array with string elements
          if (!Array.isArray(r2Keys) || r2Keys.length === 0) {
            console.error(`[master-data-cleanup] Invalid r2_keys format for id=${orphan.id}: not an array or empty`);
            errors.push(`Invalid r2_keys array for record ${orphan.id}`);
            continue;
          }

          // Validate all elements are strings
          for (const key of r2Keys) {
            if (typeof key !== 'string' || key.trim() === '') {
              console.error(`[master-data-cleanup] Invalid r2_key element in array for id=${orphan.id}: ${JSON.stringify(key)}`);
              errors.push(`Invalid r2_key element for record ${orphan.id}`);
              continue; // Skip this entire record
            }
          }

          console.info(`[master-data-cleanup] Deleting ${r2Keys.length} R2 objects for period=${orphan.period_tag}, id=${orphan.id}`);

          // Delete all R2 objects for this record
          let allDeleted = true;
          for (const r2Key of r2Keys) {
            try {
              await bucket.delete(r2Key);
              deleted++;
              console.info(`[master-data-cleanup] Deleted R2 object: ${r2Key}`);
            } catch (deleteErr) {
              // [Issue #18] エラータイプを分析して適切に処理
              const errorMsg = String(deleteErr);
              // [Bug Fix #16] Improve R2 error classification - check status code if available
              const deleteError = deleteErr as any;
              const statusCode = deleteError?.status || deleteError?.statusCode;
              
              if (statusCode === 404 || errorMsg.includes("404") || errorMsg.includes("NoSuchKey")) {
                // R2 オブジェクトが既に存在しない → count as deleted
                console.warn(`[master-data-cleanup] R2 object already deleted: ${r2Key}`);
                deleted++;
              } else if (statusCode === 403 || errorMsg.includes("403") || errorMsg.includes("Forbidden")) {
                // 権限エラー → アラート対象
                const msg = `[CRITICAL] R2 permission denied for object ${r2Key}`;
                console.error(`[master-data-cleanup] ${msg}`);
                errors.push(msg);
                allDeleted = false;
              } else {
                // その他の一時的エラー → log only, retry を待つ
                const msg = `Failed to delete R2 object ${r2Key}: ${errorMsg}`;
                console.warn(`[master-data-cleanup] ${msg}`);
                errors.push(msg);
                allDeleted = false;
              }
            }
          }

          // Clear r2_keys from D1 if all were deleted successfully
          if (allDeleted) {
            try {
              const clearStmt = db.prepare(`
                UPDATE master_data_index
                SET r2_keys = NULL
                WHERE id = ?
              `);
              await clearStmt.bind(orphan.id).run();
              console.info(`[master-data-cleanup] Cleared r2_keys for id=${orphan.id}`);
            } catch (clearErr) {
              const msg = `Failed to clear r2_keys for id=${orphan.id}: ${String(clearErr)}`;
              console.warn(`[master-data-cleanup] ${msg}`);
              errors.push(msg);
            }
          } else {
            console.warn(`[master-data-cleanup] Not all R2 objects deleted for id=${orphan.id}, keeping r2_keys for retry`);
          }
        } catch (err) {
          const msg = `Failed to process orphaned record ${orphan.id}: ${String(err)}`;
          console.error(`[master-data-cleanup] ${msg}`);
          errors.push(msg);
        }
      }
    } catch (orphanErr) {
      const msg = `Failed to cleanup orphaned R2 objects: ${String(orphanErr)}`;
      console.error(`[master-data-cleanup] ${msg}`);
      errors.push(msg);
    }

    return { cleaned, deleted, errors };
  } catch (err) {
    const msg = `Cleanup job failed: ${String(err)}`;
    console.error(`[master-data-cleanup] ${msg}`);
    return { cleaned, deleted, errors: [msg, ...errors] };
  }
}

/**
 * Manually trigger cleanup via HTTP endpoint
 * Should be called from external cron service (GitHub Actions, etc.)
 * Requires: MASTER_DATA_CLEANUP_TOKEN in env (must be set, no default)
 */
export async function handleCleanupRequest(req: Request, env: Env): Promise<Response> {
  // [P2 FIX] Require explicit token in environment
  const cleanupToken = env.MASTER_DATA_CLEANUP_TOKEN;

  if (!cleanupToken) {
    console.error("[master-data-cleanup] MASTER_DATA_CLEANUP_TOKEN not configured");
    return new Response(
      JSON.stringify({
        error: "Server misconfiguration: cleanup token not set",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // [P2 FIX] Use Bearer token format
  const authHeader = req.headers.get("Authorization");
  const expectedAuth = `Bearer ${cleanupToken}`;

  if (authHeader !== expectedAuth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await cleanupOrphanedMasterData(env);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
