/**
 * Archiver Cron Worker for Avro OCF merging
 * - Reads Avro OCF files from Turso buffer tables
 * - Groups by table_name + period_tag + dataset_id
 * - Merges Avro OCF files into single valid OCF (preserves header, concatenates blocks)
 * - Records byte offsets in D1 block_indexes for Range reads
 *
 * Architecture:
 * - Turso: buffer_logs_active + buffer_logs_processing (hot buffer)
 * - D1: archived_files, block_indexes (metadata)
 * - R2: Avro OCF archives (long-term storage)
 */

import {
  mergeAvroOCF,
  mergeAvroOCFWithBoundaries,
  MergeResult,
} from "./avro-merger";
import { getAvroHeaderLengthFromPrefix } from "./avro-manual";
import {
  fetchProcessingBufferedData,
  cleanupProcessingBuffer,
  BufferLogRecord,
} from "./db";

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
  WORKFLOW_STATE_KV?: KVNamespace;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
}

const KV_PROCESSING_ACTIVE_KEY = "buffer_processing_active";
const KV_PROCESSING_ACTIVE_TTL_SECONDS = 10 * 60;

// Unified BufferRow interface (used internally in cron.ts)
interface BufferRow {
  id: number;
  dataset_id: string;
  table_name: string;
  period_tag: string;
  table_version: string;
  timestamp: number;
  data: ArrayBuffer; // Already Avro OCF binary
  uploaded_by: string | null;
  trust_tag: string | null;
}

interface DatasetBlock {
  dataset_id: string;
  avroData: Uint8Array;
  recordCount: number;
  startTimestamp: number;
  endTimestamp: number;
  trust_tag: string | null;
}

interface GroupKey {
  table_version: string;
  table_name: string;
  period_tag: string;
}

interface ArchiveGroup {
  key: GroupKey;
  blocks: DatasetBlock[];
}

interface BlockIndexRow {
  dataset_id: string;
  table_name: string;
  table_version: string;
  period_tag: string;
  file_id: number;
  start_byte: number;
  length: number;
  record_count: number;
  start_timestamp: number;
  end_timestamp: number;
  trust_tag: string | null;
}

// Convert BufferLogRecord to internal BufferRow format
function convertToBufferRow(record: BufferLogRecord): BufferRow {
  return {
    id: record.id,
    dataset_id: record.dataset_id,
    table_name: record.table_name,
    period_tag: record.period_tag,
    table_version: record.table_version,
    timestamp: record.timestamp,
    // FIXED: Use proper slice to avoid byteOffset issues when data is a Uint8Array view
    data:
      record.data instanceof ArrayBuffer
        ? record.data
        : (record.data.buffer.slice(
            record.data.byteOffset,
            record.data.byteOffset + record.data.byteLength,
          ) as ArrayBuffer),
    uploaded_by: record.uploaded_by,
    trust_tag: record.trust_tag,
  };
}

function resolveTrustTag(tags: Array<string | null | undefined>): string | null {
  if (tags.includes("suspicious")) return "suspicious";
  if (tags.includes("unverified")) return "unverified";
  if (tags.includes("sw_verified")) return "sw_verified";
  if (tags.includes("hw_verified")) return "hw_verified";
  return null;
}

/**
 * Group Avro binaries by table_name + period_tag + dataset_id
 * Each dataset gets one concatenated block in the final file
 */
function groupByDataset(rows: BufferRow[]): ArchiveGroup[] {
  const groupMap = new Map<string, Map<string, BufferRow[]>>();

  // Group by (table_version::table_name::period_tag) -> dataset_id -> rows[]
  for (const row of rows) {
    const groupKey = `${row.table_version}::${row.table_name}::${row.period_tag}`;
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, new Map());
    }
    const datasetMap = groupMap.get(groupKey)!;
    if (!datasetMap.has(row.dataset_id)) {
      datasetMap.set(row.dataset_id, []);
    }
    datasetMap.get(row.dataset_id)!.push(row);
  }

  // Convert to ArchiveGroup[]
  const groups: ArchiveGroup[] = [];
  for (const [groupKey, datasetMap] of groupMap.entries()) {
    const parts = groupKey.split("::");
    if (parts.length !== 3) {
      throw new Error(
        `Internal error: groupKey format invalid: "${groupKey}" (expected "table_version::table_name::period_tag")`,
      );
    }
    const [table_version, table_name, period_tag] = parts;
    const blocks: DatasetBlock[] = [];

    for (const [dataset_id, rows] of datasetMap.entries()) {
      // Convert all Avro OCF binaries to Uint8Array
      // D1 might return BLOB as Uint8Array or ArrayBuffer depending on driver
      // FIXED: Properly handle all cases including Uint8Array views with byteOffset
      const ocfFiles: Uint8Array[] = rows.map((r) => {
        if (r.data instanceof Uint8Array) return r.data;
        if (r.data instanceof ArrayBuffer) return new Uint8Array(r.data);
        // Fallback: try to get underlying buffer with proper offset handling
        const anyData = r.data as any;
        if (
          anyData.buffer &&
          typeof anyData.byteOffset === "number" &&
          typeof anyData.byteLength === "number"
        ) {
          // It's a typed array view - copy to avoid offset issues
          return new Uint8Array(
            anyData.buffer.slice(
              anyData.byteOffset,
              anyData.byteOffset + anyData.byteLength,
            ),
          );
        }
        return new Uint8Array(anyData.buffer || anyData);
      });

      // Merge multiple Avro OCF files into a single valid OCF
      // This preserves the header (magic, metadata, sync marker) from the first file
      // and properly concatenates data blocks from all files
      if (ocfFiles.length === 0) {
        throw new Error(`No OCF files to merge for dataset ${dataset_id}`);
      }

      let mergedAvro: Uint8Array;
      try {
        mergedAvro = mergeAvroOCF(ocfFiles);
      } catch (err) {
        console.error(
          `[Archiver] Failed to merge ${ocfFiles.length} OCF files for dataset ${dataset_id} (total ${ocfFiles.reduce((s, o) => s + o.byteLength, 0)}B):`,
          err,
        );
        throw new Error(
          `OCF merge failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const timestamps = rows.map((r) => r.timestamp);
      blocks.push({
        dataset_id,
        avroData: mergedAvro,
        recordCount: rows.length, // Number of source OCF files merged
        startTimestamp: Math.min(...timestamps),
        endTimestamp: Math.max(...timestamps),
        trust_tag: resolveTrustTag(rows.map((r) => r.trust_tag)),
      });
    }

    groups.push({
      key: { table_version, table_name, period_tag },
      blocks,
    });
  }

  return groups;
}

// File size limit: 128MB (2^27 bytes)
// Multiple datasets are merged into single files up to this limit for efficient storage
const MAX_FILE_SIZE = 128 * 1024 * 1024;

function generateFilePath(
  tableVersion: string,
  periodTag: string,
  tableName: string,
  fileIndex: number,
  runTimestamp: number,
): string {
  // Generate file path with index for multi-dataset files
  const indexStr = String(fileIndex).padStart(3, "0");
  return `${tableVersion}/${periodTag}/${runTimestamp}/${tableName}-${indexStr}.avro`;
}

async function registerArchivedFile(
  db: D1Database,
  filePath: string,
  tableVersion: string,
  fileSize: number,
  codec: string = "deflate",
): Promise<number> {
  // Use INSERT OR REPLACE to handle duplicate file_path (idempotent)
  // This allows cron to safely retry without UNIQUE constraint failures
  const now = Date.now();

  // Validate inputs
  if (!filePath || filePath.length === 0) {
    throw new Error("filePath cannot be empty");
  }
  if (fileSize < 0 || !Number.isFinite(fileSize)) {
    throw new Error(`Invalid fileSize: ${fileSize}`);
  }

  // First check if file already exists
  const existing = await db
    .prepare(
      `
    SELECT id FROM archived_files WHERE file_path = ?
  `,
    )
    .bind(filePath)
    .first<{ id: number }>();

  if (existing?.id) {
    // Update file metadata for existing entry (idempotent)
    // CRITICAL: Include table_version in UPDATE to ensure consistency
    await db
      .prepare(
        `
      UPDATE archived_files 
      SET file_size = ?, compression_codec = ?, table_version = ?, last_modified_at = ?
      WHERE id = ?
    `,
      )
      .bind(fileSize, codec, tableVersion, now, existing.id)
      .run();
    return existing.id;
  }

  // New file: INSERT — capture last_row_id from result meta to avoid a separate
  // SELECT last_insert_rowid() that D1 might route to a read replica (returning 0).
  const insertResult = await db
    .prepare(
      `
    INSERT INTO archived_files (file_path, table_version, file_size, compression_codec, created_at, last_modified_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .bind(filePath, tableVersion, fileSize, codec, now, now)
    .run();

  return insertResult.meta.last_row_id;
}

async function insertBlockIndexes(
  db: D1Database,
  rows: BlockIndexRow[],
): Promise<void> {
  if (!rows.length) return;

  // Delete existing indexes for these file_ids to handle retries
  const fileIds = [...new Set(rows.map((r) => r.file_id))];
  if (fileIds.length > 0) {
    const placeholders = fileIds.map(() => "?").join(",");
    await db
      .prepare(
        `
      DELETE FROM block_indexes WHERE file_id IN (${placeholders})
    `,
      )
      .bind(...fileIds)
      .run();
  }

  // Insert new indexes in chunks to stay within D1's 999-parameter bind limit.
  // Each row uses 11 parameters; floor(999/11) = 90 rows per chunk.
  const CHUNK_SIZE = 90;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const sql = `
      INSERT INTO block_indexes (dataset_id, table_name, table_version, period_tag, file_id, start_byte, length, record_count, start_timestamp, end_timestamp, trust_tag)
      VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",")}
    `;
    const params: (string | number)[] = [];
    for (const r of chunk) {
      params.push(
        r.dataset_id,
        r.table_name,
        r.table_version,
        r.period_tag,
        r.file_id,
        r.start_byte,
        r.length,
        r.record_count,
        r.start_timestamp,
        r.end_timestamp,
        r.trust_tag ?? "unverified",
      );
    }
    await db
      .prepare(sql)
      .bind(...params)
      .run();
  }
}

export async function handleCron(env: Env): Promise<void> {
  let archiveSuccess = false; // FIXED: Track success to prevent data loss on error
  let hadRows = false;
  let processingFlagSet = false;

  try {
    const runTimestamp = Date.now();

    // Fetch processing rows. If processing is empty, db layer swaps active->processing.
    const { rows: fetchedRows } = await fetchProcessingBufferedData(env);
    const rows: BufferRow[] = fetchedRows.map(convertToBufferRow);

    if (!rows.length) {
      return; // Silent: no data to archive
    }
    hadRows = true;

    if (env.WORKFLOW_STATE_KV) {
      await env.WORKFLOW_STATE_KV.put(KV_PROCESSING_ACTIVE_KEY, "1", {
        expirationTtl: KV_PROCESSING_ACTIVE_TTL_SECONDS,
      });
      processingFlagSet = true;
    }

    const groups = groupByDataset(rows);

    let totalFiles = 0;
    let totalBytes = 0;
    let totalDatasets = 0;
    let hasError = false;

    // Process each table_name + period_tag group
    for (const group of groups) {
      if (!group.blocks.length) continue;

      // Chunk blocks into files up to MAX_FILE_SIZE
      // Multiple datasets can be merged into a single file for storage efficiency
      const fileChunks: { blocks: DatasetBlock[]; size: number }[] = [];
      let currentChunk: DatasetBlock[] = [];
      let currentSize = 0;

      for (const block of group.blocks) {
        if (
          currentSize + block.avroData.byteLength > MAX_FILE_SIZE &&
          currentChunk.length > 0
        ) {
          // Start new file chunk
          fileChunks.push({ blocks: currentChunk, size: currentSize });
          currentChunk = [];
          currentSize = 0;
        }
        currentChunk.push(block);
        currentSize += block.avroData.byteLength;
      }

      // Add final chunk
      if (currentChunk.length > 0) {
        fileChunks.push({ blocks: currentChunk, size: currentSize });
      }

      // Process each file chunk
      for (let fileIndex = 0; fileIndex < fileChunks.length; fileIndex++) {
        const chunk = fileChunks[fileIndex];
        const filePath = generateFilePath(
          group.key.table_version,
          group.key.period_tag,
          group.key.table_name,
          fileIndex + 1,
          runTimestamp,
        );

        // Merge all dataset blocks in this chunk into a single file
        // Use mergeAvroOCFWithBoundaries to get accurate byte offsets for each dataset
        const blocksList: Uint8Array[] = chunk.blocks.map((b) => b.avroData);

        let mergeResult: MergeResult;
        if (blocksList.length === 1) {
          // Single block - calculate header size to get correct data block offset
          // The file IS the singleBlock, so we need to find where data blocks start
          const singleBlock = blocksList[0];
          try {
            // Parse header to find data block start position
            const headerSize = getAvroHeaderLengthFromPrefix(singleBlock);
            mergeResult = {
              merged: singleBlock,
              boundaries: [
                {
                  sourceIndex: 0,
                  startByte: headerSize, // FIXED: Data starts after header
                  length: singleBlock.byteLength - headerSize, // FIXED: Only data block portion
                },
              ],
              headerSize: headerSize,
            };
          } catch (err) {
            // Fallback if header parsing fails - use whole file
            console.warn(
              `[Archiver] Failed to parse header for single block, using whole file offset: ${err instanceof Error ? err.message : String(err)}`,
            );
            mergeResult = {
              merged: singleBlock,
              boundaries: [
                {
                  sourceIndex: 0,
                  startByte: 0,
                  length: singleBlock.byteLength,
                },
              ],
              headerSize: 0,
            };
          }
        } else {
          // Multiple blocks - merge with boundary tracking
          try {
            mergeResult = mergeAvroOCFWithBoundaries(blocksList);
          } catch (err) {
            console.error(
              `[Archiver] Failed to merge ${blocksList.length} blocks:`,
              err,
            );
            throw new Error(
              `Block merge failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        const combined = mergeResult.merged;
        const actualSize = combined.byteLength;

        // Upload to R2
        await env.BATTLE_DATA_BUCKET.put(filePath, combined, {
          httpMetadata: { contentType: "application/octet-stream" },
          customMetadata: {
            "archive-date": new Date().toISOString(),
            "run-timestamp": String(runTimestamp),
            "block-count": String(chunk.blocks.length),
            format: "avro-ocf",
            "table-version": group.key.table_version,
            table: group.key.table_name,
            period: group.key.period_tag,
            "file-index": String(fileIndex + 1),
            "total-files": String(fileChunks.length),
            "trust-tag":
              resolveTrustTag(chunk.blocks.map((b) => b.trust_tag)) ??
              "unverified",
          },
        });

        // Register file in D1
        try {
          const fileId = await registerArchivedFile(
            env.BATTLE_INDEX_DB,
            filePath,
            group.key.table_version,
            actualSize,
            "deflate",
          );

          // FIXED: Create block indexes using accurate boundaries from merge result
          // Each dataset's data is at the exact byte position returned by mergeAvroOCFWithBoundaries
          const blockIndexes: BlockIndexRow[] = [];

          for (let i = 0; i < chunk.blocks.length; i++) {
            const block = chunk.blocks[i];
            const boundary = mergeResult.boundaries[i];

            blockIndexes.push({
              dataset_id: block.dataset_id,
              table_name: group.key.table_name,
              table_version: group.key.table_version,
              period_tag: group.key.period_tag,
              file_id: fileId,
              start_byte: boundary.startByte, // Accurate offset from merge result
              length: boundary.length, // Accurate length from merge result
              record_count: block.recordCount,
              start_timestamp: block.startTimestamp,
              end_timestamp: block.endTimestamp,
              trust_tag: block.trust_tag,
            });
          }

          await insertBlockIndexes(env.BATTLE_INDEX_DB, blockIndexes);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          if (errorMsg.includes("UNIQUE constraint failed")) {
            console.warn(
              `[Archival] File already registered (duplicate): ${filePath}`,
            );
            hasError = true;
            continue;
          }
          throw err;
        }

        totalFiles++;
        totalBytes += actualSize;
        totalDatasets += chunk.blocks.length;
      }
    }

    // Summary log
    if (hasError) {
      console.log(
        `[Archival] ${totalFiles} files, ${totalDatasets} datasets, ${(totalBytes / 1024).toFixed(1)}KB archived from ${rows.length} buffer rows (some duplicates skipped)`,
      );
    } else {
      console.log(
        `[Archival] ${totalFiles} files, ${totalDatasets} datasets, ${(totalBytes / 1024).toFixed(1)}KB archived from ${rows.length} buffer rows`,
      );
    }

    // Mark archival as successful - safe to cleanup
    archiveSuccess = true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[Archival Error]", errorMsg);
    // archiveSuccess remains false - DO NOT cleanup to prevent data loss
  } finally {
    // FIXED: Only cleanup processing table if archival was successful
    // This prevents data loss when R2 upload or index registration fails
    if (hadRows && archiveSuccess) {
      try {
        const { source: cleanupSource, rowsAffected } =
          await cleanupProcessingBuffer(env);

        console.log(
          `[Archival] Cleaned up ${rowsAffected} rows from ${cleanupSource} buffer_logs_processing`,
        );
      } catch (cleanupErr) {
        console.error(
          "[Archival] Cleanup failed:",
          cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        );
      }
    } else if (hadRows && !archiveSuccess) {
      console.warn(
        "[Archival] Skipped cleanup due to archival error - processing rows preserved for retry",
      );
    }

    if (processingFlagSet && env.WORKFLOW_STATE_KV) {
      try {
        await env.WORKFLOW_STATE_KV.delete(KV_PROCESSING_ACTIVE_KEY);
      } catch (error) {
        console.warn(
          "[Archival] Failed to clear processing KV flag:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}
