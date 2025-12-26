/**
 * Archiver Cron Worker for Avro OCF merging
 * - Reads Avro OCF files from D1 buffer_logs
 * - Groups by table_name + period_tag + dataset_id
 * - Merges Avro OCF files into single valid OCF (preserves header, concatenates blocks)
 * - Records byte offsets in block_indexes for Range reads
 */

import { mergeAvroOCF } from './avro-merger.js';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
}

interface BufferRow {
  id: number;
  dataset_id: string;
  table_name: string;
  period_tag: string;
  schema_version: string;
  timestamp: number;
  data: ArrayBuffer;  // Already Avro OCF binary
  uploaded_by: string | null;
}

interface DatasetBlock {
  dataset_id: string;
  avroData: Uint8Array;
  recordCount: number;
  startTimestamp: number;
  endTimestamp: number;
}

interface GroupKey {
  schema_version: string;
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
  schema_version: string;
  period_tag: string;
  file_id: number;
  start_byte: number;
  length: number;
  record_count: number;
  start_timestamp: number;
  end_timestamp: number;
}

async function fetchBufferedData(db: D1Database): Promise<BufferRow[]> {
  const res = await db.prepare(`
    SELECT id, dataset_id, table_name, period_tag, schema_version, timestamp, data, uploaded_by
    FROM buffer_logs
    ORDER BY schema_version, table_name, period_tag, dataset_id, id ASC
  `).all<BufferRow>();
  return res.results ?? [];
}

/**
 * Group Avro binaries by table_name + period_tag + dataset_id
 * Each dataset gets one concatenated block in the final file
 */
function groupByDataset(rows: BufferRow[]): ArchiveGroup[] {
  const groupMap = new Map<string, Map<string, BufferRow[]>>();
  
  // Group by (schema_version::table_name::period_tag) -> dataset_id -> rows[]
  for (const row of rows) {
    const groupKey = `${row.schema_version}::${row.table_name}::${row.period_tag}`;
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
    const parts = groupKey.split('::');
    if (parts.length !== 3) {
      throw new Error(`Internal error: groupKey format invalid: "${groupKey}" (expected "schema_version::table_name::period_tag")`);
    }
    const [schema_version, table_name, period_tag] = parts;
    const blocks: DatasetBlock[] = [];
    
    for (const [dataset_id, rows] of datasetMap.entries()) {
      // Convert all Avro OCF binaries to Uint8Array
      // D1 might return BLOB as Uint8Array or ArrayBuffer depending on driver
      const ocfFiles: Uint8Array[] = rows.map(r => {
        if (r.data instanceof Uint8Array) return r.data;
        if (r.data instanceof ArrayBuffer) return new Uint8Array(r.data);
        // Fallback: treat as any and attempt conversion
        return new Uint8Array((r.data as any).buffer || r.data);
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
        console.error(`[Archiver] Failed to merge ${ocfFiles.length} OCF files for dataset ${dataset_id} (total ${ocfFiles.reduce((s, o) => s + o.byteLength, 0)}B):`, err);
        throw new Error(`OCF merge failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      
      const timestamps = rows.map(r => r.timestamp);
      blocks.push({
        dataset_id,
        avroData: mergedAvro,
        recordCount: rows.length,  // Number of source OCF files merged
        startTimestamp: Math.min(...timestamps),
        endTimestamp: Math.max(...timestamps)
      });
    }
    
    groups.push({
      key: { schema_version, table_name, period_tag },
      blocks
    });
  }
  
  return groups;
}

// File size limit: 128MB (2^27 bytes)
const MAX_FILE_SIZE = 128 * 1024 * 1024;

function generateFilePath(schemaVersion: string, periodTag: string, tableName: string, index: number, runTimestamp: number): string {
  const indexStr = String(index).padStart(3, '0');
  // Ensure uniqueness per cron run by embedding runTimestamp in the path
  return `${schemaVersion}/${periodTag}/${runTimestamp}/${tableName}-${indexStr}.avro`;
}

async function registerArchivedFile(db: D1Database, filePath: string, schemaVersion: string, fileSize: number, codec: string = 'deflate'): Promise<number> {
  // Use INSERT OR REPLACE to handle duplicate file_path (idempotent)
  // This allows cron to safely retry without UNIQUE constraint failures
  const now = Date.now();
  
  // Validate inputs
  if (!filePath || filePath.length === 0) {
    throw new Error('filePath cannot be empty');
  }
  if (fileSize < 0 || !Number.isFinite(fileSize)) {
    throw new Error(`Invalid fileSize: ${fileSize}`);
  }
  
  // First check if file already exists
  const existing = await db.prepare(`
    SELECT id FROM archived_files WHERE file_path = ?
  `).bind(filePath).first<{ id: number }>();
  
  if (existing?.id) {
    // Update file metadata for existing entry (idempotent)
    // CRITICAL: Include schema_version in UPDATE to ensure consistency
    await db.prepare(`
      UPDATE archived_files 
      SET file_size = ?, compression_codec = ?, schema_version = ?, last_modified_at = ?
      WHERE id = ?
    `).bind(fileSize, codec, schemaVersion, now, existing.id).run();
    return existing.id;
  }
  
  // New file: INSERT
  await db.prepare(`
    INSERT INTO archived_files (file_path, schema_version, file_size, compression_codec, created_at, last_modified_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(filePath, schemaVersion, fileSize, codec, now, now).run();
  
  const row = await db.prepare('SELECT last_insert_rowid() AS id').first<{ id: number }>();
  return row?.id ?? 0;
}

async function insertBlockIndexes(db: D1Database, rows: BlockIndexRow[]): Promise<void> {
  if (!rows.length) return;
  
  // Delete existing indexes for these file_ids to handle retries
  const fileIds = [...new Set(rows.map(r => r.file_id))];
  if (fileIds.length > 0) {
    const placeholders = fileIds.map(() => '?').join(',');
    await db.prepare(`
      DELETE FROM block_indexes WHERE file_id IN (${placeholders})
    `).bind(...fileIds).run();
  }
  
  // Insert new indexes
  const sql = `
    INSERT INTO block_indexes (dataset_id, table_name, schema_version, period_tag, file_id, start_byte, length, record_count, start_timestamp, end_timestamp)
    VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',')}
  `;
  const params: (string | number)[] = [];
  for (const r of rows) {
    params.push(r.dataset_id, r.table_name, r.schema_version, r.period_tag, r.file_id, r.start_byte, r.length, r.record_count, r.start_timestamp, r.end_timestamp);
  }
  await db.prepare(sql).bind(...params).run();
}

async function cleanupBuffer(db: D1Database, maxId: number): Promise<void> {
  await db.prepare('DELETE FROM buffer_logs WHERE id <= ?').bind(maxId).run();
}

export async function handleCron(env: Env): Promise<void> {
  try {
    const runTimestamp = Date.now();
    const rows = await fetchBufferedData(env.BATTLE_INDEX_DB);
    if (!rows.length) {
      return; // Silent: no data to archive
    }

    const maxId = Math.max(...rows.map(r => r.id));
    const groups = groupByDataset(rows);

    let totalFiles = 0;
    let totalBytes = 0;
    let totalDatasets = 0;

    // Process each table_name + period_tag group
    for (const group of groups) {
      if (!group.blocks.length) continue;

      // Split blocks into files with 128MB limit
      const fileChunks: { blocks: DatasetBlock[]; size: number }[] = [];
      let currentChunk: DatasetBlock[] = [];
      let currentSize = 0;

      for (const block of group.blocks) {
        if (currentSize + block.avroData.byteLength > MAX_FILE_SIZE && currentChunk.length > 0) {
          // Start new file
          fileChunks.push({ blocks: currentChunk, size: currentSize });
          currentChunk = [];
          currentSize = 0;
        }
        currentChunk.push(block);
        currentSize += block.avroData.byteLength;
      }
      
      // Add last chunk
      if (currentChunk.length > 0) {
        fileChunks.push({ blocks: currentChunk, size: currentSize });
      }

      // Upload each file chunk with index
      for (let fileIndex = 0; fileIndex < fileChunks.length; fileIndex++) {
        const chunk = fileChunks[fileIndex];
        const filePath = generateFilePath(
          group.key.schema_version,
          group.key.period_tag,
          group.key.table_name,
          fileIndex + 1,
          runTimestamp
        );

        // Merge blocks for this file (if multiple blocks in same file chunk)
        const blocksList: Uint8Array[] = chunk.blocks.map(b => b.avroData);
        
        let combined: Uint8Array;
        if (blocksList.length === 0) {
          throw new Error('Empty block list for file chunk');
        } else if (blocksList.length === 1) {
          // Single block, use as-is (already merged from OCF files within dataset)
          combined = blocksList[0];
        } else {
          // Multiple blocks from different datasets in same chunk
          // WARNING: Merging blocks from different datasets assumes compatible schema
          // In production, ensure that datasets in same file chunk have identical schemas
          try {
            combined = mergeAvroOCF(blocksList);
          } catch (err) {
            console.error(`[Archiver] Failed to merge ${blocksList.length} blocks (total ${blocksList.reduce((s, b) => s + b.byteLength, 0)}B):`, err);
            throw new Error(`Block merge failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Upload to R2
        await env.BATTLE_DATA_BUCKET.put(filePath, combined, {
          httpMetadata: { contentType: 'application/octet-stream' },
          customMetadata: {
            'archive-date': new Date().toISOString(),
            'run-timestamp': String(runTimestamp),
            'block-count': String(chunk.blocks.length),
            'format': 'avro-ocf',
            'schema-version': group.key.schema_version,
            'table': group.key.table_name,
            'period': group.key.period_tag,
            'file-index': String(fileIndex + 1),
            'total-files': String(fileChunks.length)
          }
        });

        // Register file in D1
        // CRITICAL: Use actual combined size, not chunk.size (which may be estimate)
        const actualSize = combined.byteLength;
        const fileId = await registerArchivedFile(env.BATTLE_INDEX_DB, filePath, group.key.schema_version, actualSize, 'deflate');
        
        // Create block indexes for each dataset in this file
        const blockIndexes: BlockIndexRow[] = [];
        let currentOffset = 0;
        for (const block of chunk.blocks) {
          blockIndexes.push({
            dataset_id: block.dataset_id,
            table_name: group.key.table_name,
            schema_version: group.key.schema_version,
            period_tag: group.key.period_tag,
            file_id: fileId,
            start_byte: currentOffset,
            length: block.avroData.byteLength,
            record_count: block.recordCount,
            start_timestamp: block.startTimestamp,
            end_timestamp: block.endTimestamp,
          });
          currentOffset += block.avroData.byteLength;
        }
        await insertBlockIndexes(env.BATTLE_INDEX_DB, blockIndexes);
        
        totalFiles++;
        totalBytes += chunk.size;
        totalDatasets += chunk.blocks.length;
      }
    }

    await cleanupBuffer(env.BATTLE_INDEX_DB, maxId);
    
    // Summary log
    console.log(`[Archival] ${totalFiles} files, ${totalDatasets} datasets, ${(totalBytes / 1024).toFixed(1)}KB archived from ${rows.length} buffer rows`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    // Handle UNIQUE constraint errors gracefully
    if (errorMsg.includes('UNIQUE constraint failed')) {
      console.error('[Archival Error] UNIQUE constraint violation - likely duplicate file_path from retry', errorMsg);
      console.error('[Archival Info] This is expected if cron is retrying. Existing files will be reused.');
      // Don't throw - allow graceful degradation for idempotent cron jobs
      return;
    }
    
    // Other errors should be thrown
    console.error('[Archival Error]', errorMsg);
    throw error;
  }
}
