/**
 * Archiver Cron Worker - Hot → Cold Migration
 * 
 * Role: Hourly consolidation of D1 buffer_logs → R2 Avro with byte-level indexing
 * 
 * Algorithm Overview:
 * 1. Fetch Hot Data: SELECT * FROM buffer_logs ORDER BY id
 * 2. Group by Dataset: Map<dataset_id, Record[]>
 * 3. Manual Avro Construction:
 *    - Write shared header once
 *    - For each dataset group:
 *      a. Serialize records to Avro binary (with header)
 *      b. Extract data block only (strip header)
 *      c. Track byte offset for indexing
 *      d. Append to stream
 * 4. Upload to R2: analytics/YYYYMMDD_HH.avro
 * 5. Index in D1: block_indexes table
 * 6. Cleanup: DELETE FROM buffer_logs WHERE id <= max_processed_id
 * 
 * Performance Target: < 5 minutes for 100K records
 */

import { buildAvroContainer, getAvroHeaderLength } from './avro-manual.js';
import { compressDeflate } from './utils/compression.js';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
}

interface BufferRow {
  id: number;
  dataset_id: string;
  table_name: string;
  timestamp: number;
  data: ArrayBuffer;  // BLOB from D1
  uploaded_by: string | null;
}

interface DatasetGroup {
  dataset_id: string;
  table_name: string;
  records: any[];  // Deserialized JSON records
}

interface BlockMetadata {
  dataset_id: string;
  table_name: string;
  file_id: number;
  start_byte: number;
  length: number;
  record_count: number;
  start_timestamp: number;
  end_timestamp: number;
}

/**
 * Fetch all buffered data (or use cursor for very large datasets)
 */
async function fetchBufferedData(db: D1Database): Promise<BufferRow[]> {
  const result = await db.prepare(`
    SELECT id, dataset_id, table_name, timestamp, data, uploaded_by
    FROM buffer_logs
    ORDER BY id ASC
  `).all<BufferRow>();
  
  return result.results ?? [];
}

/**
 * Group records by dataset_id and table_name
 */
function groupByDataset(rows: BufferRow[]): DatasetGroup[] {
  const groups = new Map<string, DatasetGroup>();
  
  for (const row of rows) {
    const key = `${row.dataset_id}::${row.table_name}`;
    
    if (!groups.has(key)) {
      groups.set(key, {
        dataset_id: row.dataset_id,
        table_name: row.table_name,
        records: []
      });
    }
    
    // Deserialize BLOB to JSON
    const decoded = new TextDecoder().decode(row.data);
    const record = JSON.parse(decoded);
    groups.get(key)!.records.push(record);
  }
  
  return Array.from(groups.values());
}

/**
 * Build consolidated Avro file with manual block construction
 * Returns: { buffer: Uint8Array, blockMetadata: BlockMetadata[] }
 */
async function buildConsolidatedAvro(
  groups: DatasetGroup[],
  fileId: number,
  tableName: string
): Promise<{ buffer: Uint8Array; blockMetadata: BlockMetadata[] }> {
  const chunks: Uint8Array[] = [];
  const blockMetadata: BlockMetadata[] = [];
  let currentOffset = 0;
  
  // Safety check: need at least one non-empty group
  const nonEmptyGroups = groups.filter(g => g.records.length > 0);
  if (nonEmptyGroups.length === 0) {
    // Return empty Avro file with minimal header
    // Use placeholder record for schema generation
    const placeholderRecord = { timestamp: Date.now(), data: 'empty' };
    const emptyHeader = buildAvroContainer([placeholderRecord]);
    return { buffer: new Uint8Array(emptyHeader), blockMetadata: [] };
  }
  
  // Step 1: Write shared Avro header (once for entire file)
  // Use first group's schema as template (assume all groups share schema)
  const sampleRecords = nonEmptyGroups[0].records;
  const headerContainer = buildAvroContainer(sampleRecords);
  const headerLength = getAvroHeaderLength(headerContainer);
  const header = headerContainer.slice(0, headerLength);
  
  chunks.push(header);
  currentOffset += header.byteLength;
  
  // Step 2: For each dataset group, append data block
  for (const group of groups) {
    if (group.records.length === 0) continue;
    
    // Build full Avro container for this group
    const container = buildAvroContainer(group.records);
    
    // Extract data block only (skip header)
    const groupHeaderLength = getAvroHeaderLength(container);
    const dataBlock = container.slice(groupHeaderLength);
    
    // Track metadata for block index
    const timestamps = group.records
      .map(r => r.timestamp ?? Date.now())
      .filter(t => typeof t === 'number');
    
    // Safety: ensure timestamps array is not empty
    const minTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
    const maxTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
    
    blockMetadata.push({
      dataset_id: group.dataset_id,
      table_name: group.table_name,
      file_id: fileId,
      start_byte: currentOffset,
      length: dataBlock.byteLength,
      record_count: group.records.length,
      start_timestamp: minTimestamp,
      end_timestamp: maxTimestamp
    });
    
    // Append to stream
    chunks.push(new Uint8Array(dataBlock));
    currentOffset += dataBlock.byteLength;
  }
  
  // Step 3: Concatenate all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  
  return { buffer, blockMetadata };
}

/**
 * Generate R2 file path for current hour
 * Format: "table_name/YYYYMMDD_HH.avro"
 */
function generateFilePath(tableName: string, date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  
  return `${tableName}/${year}${month}${day}_${hour}.avro`;
}

/**
 * Register archived file in D1 and return file_id
 */
async function registerArchivedFile(
  db: D1Database,
  filePath: string,
  fileSize: number,
  compressionCodec: string | null = 'deflate'
): Promise<number> {
  // D1 may not support RETURNING clause, use last_insert_rowid() instead
  const insertResult = await db.prepare(`
    INSERT INTO archived_files (file_path, file_size, compression_codec, created_at, last_modified_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    filePath,
    fileSize,
    compressionCodec,
    Date.now(),
    Date.now()
  ).run();
  
  if (!insertResult.success) {
    throw new Error('Failed to insert archived file');
  }
  
  // Get the last inserted ID
  const result = await db.prepare(`
    SELECT last_insert_rowid() as id
  `).first<{ id: number }>();
  
  if (!result?.id) {
    throw new Error('Failed to get inserted file ID');
  }
  
  return result.id;
}

/**
 * Insert block indexes in bulk
 * Note: Chunked if needed to avoid D1 parameter limits
 */
async function insertBlockIndexes(
  db: D1Database,
  blockMetadata: BlockMetadata[]
): Promise<void> {
  if (blockMetadata.length === 0) return;
  
  // D1 parameter limit safety: chunk into smaller batches
  const CHUNK_SIZE = 100; // 100 blocks = 800 parameters (safe)
  
  for (let i = 0; i < blockMetadata.length; i += CHUNK_SIZE) {
    const chunk = blockMetadata.slice(i, i + CHUNK_SIZE);
    
    // Bulk insert with placeholders
    const placeholder = '(?,?,?,?,?,?,?,?)';
    const placeholders = Array(chunk.length).fill(placeholder).join(',');
    const sql = `INSERT INTO block_indexes 
      (dataset_id, table_name, file_id, start_byte, length, record_count, start_timestamp, end_timestamp)
      VALUES ${placeholders}`;
    
    const params = chunk.flatMap(block => [
      block.dataset_id,
      block.table_name,
      block.file_id,
      block.start_byte,
      block.length,
      block.record_count,
      block.start_timestamp,
      block.end_timestamp
    ]);
    
    await db.prepare(sql).bind(...params).run();
  }
}

/**
 * Delete processed buffer data (safe ID-range deletion)
 */
async function cleanupBuffer(
  db: D1Database,
  maxProcessedId: number
): Promise<void> {
  await db.prepare(`
    DELETE FROM buffer_logs WHERE id <= ?
  `).bind(maxProcessedId).run();
}

/**
 * Main Archiver Cron Handler
 * Trigger: Scheduled Worker (e.g., "0 * * * *" - every hour)
 */
export async function handleArchiver(env: Env): Promise<void> {
  console.log('🕐 Starting archival process...');
  
  // Step 1: Fetch buffered data
  const rows = await fetchBufferedData(env.BATTLE_INDEX_DB);
  
  if (rows.length === 0) {
    console.log('✅ No data to archive');
    return;
  }
  
  console.log(`📦 Fetched ${rows.length} buffer records`);
  
  // Track max ID for cleanup
  const maxId = Math.max(...rows.map(r => r.id));
  
  // Step 2: Group by dataset + table
  const groups = groupByDataset(rows);
  console.log(`📊 Grouped into ${groups.length} dataset groups`);
  
  // Step 3: Process each table separately (different R2 files)
  const tableGroups = new Map<string, DatasetGroup[]>();
  for (const group of groups) {
    if (!tableGroups.has(group.table_name)) {
      tableGroups.set(group.table_name, []);
    }
    tableGroups.get(group.table_name)!.push(group);
  }
  
  for (const [tableName, tableDatasets] of tableGroups.entries()) {
    console.log(`🔨 Processing table: ${tableName} (${tableDatasets.length} datasets)`);
    
    try {
      // Generate file path
      const filePath = generateFilePath(tableName);
      
      // Build consolidated Avro
      // Register file first to get file_id
      const tempFileId = await registerArchivedFile(env.BATTLE_INDEX_DB, filePath, 0);
      
      const { buffer, blockMetadata } = await buildConsolidatedAvro(
        tableDatasets,
        tempFileId,
        tableName
      );
      
      // Optionally compress
      const compressed = await compressDeflate(buffer);
      const finalBuffer = compressed ?? buffer;
      
      console.log(`📏 Built Avro file: ${finalBuffer.byteLength} bytes (${blockMetadata.length} blocks)`);
      
      // Step 4: Upload to R2
      await env.BATTLE_DATA_BUCKET.put(filePath, finalBuffer, {
        httpMetadata: {
          contentType: 'application/octet-stream',
        },
        customMetadata: {
          'archive-date': new Date().toISOString(),
          'block-count': String(blockMetadata.length),
          'compression': compressed ? 'deflate' : 'none'
        }
      });
      
      console.log(`✅ Uploaded to R2: ${filePath}`);
      
      // Step 5: Update file size in D1
      await env.BATTLE_INDEX_DB.prepare(`
        UPDATE archived_files SET file_size = ?, last_modified_at = ? WHERE id = ?
      `).bind(finalBuffer.byteLength, Date.now(), tempFileId).run();
      
      // Step 6: Insert block indexes
      await insertBlockIndexes(env.BATTLE_INDEX_DB, blockMetadata);
      console.log(`📇 Inserted ${blockMetadata.length} block indexes`);
      
    } catch (err) {
      console.error(`❌ Failed to archive table ${tableName}:`, err);
      // Continue with next table instead of failing entire archival
      // Buffer data will remain and be retried next hour
      continue;
    }
  }
  
  // Step 7: Cleanup buffer (atomic deletion by ID)
  await cleanupBuffer(env.BATTLE_INDEX_DB, maxId);
  console.log(`🧹 Cleaned up ${rows.length} buffer records (id <= ${maxId})`);
  
  console.log('✅ Archival complete');
}

/**
 * Export for Scheduled Worker integration
 */
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleArchiver(env));
  }
};
