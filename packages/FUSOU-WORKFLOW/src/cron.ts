/**
 * Archiver Cron Worker for Avro BLOB concatenation
 * - Reads Avro binaries from D1 buffer_logs
 * - Groups by table_name + period_tag + dataset_id
 * - Concatenates Avro OCF blocks (already compressed from client)
 * - Records byte offsets in block_indexes for Range reads
 */

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
    const [schema_version, table_name, period_tag] = groupKey.split('::');
    const blocks: DatasetBlock[] = [];
    
    for (const [dataset_id, rows] of datasetMap.entries()) {
      // Concatenate all Avro binaries for this dataset
      // D1 might return BLOB as Uint8Array or ArrayBuffer depending on driver
      const buffers: Uint8Array[] = rows.map(r => {
        if (r.data instanceof Uint8Array) return r.data;
        if (r.data instanceof ArrayBuffer) return new Uint8Array(r.data);
        // Fallback: treat as any and attempt conversion
        return new Uint8Array((r.data as any).buffer || r.data);
      });
      
      const totalSize = buffers.reduce((sum, b) => sum + b.byteLength, 0);
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const buf of buffers) {
        combined.set(buf, offset);
        offset += buf.byteLength;
      }
      
      const timestamps = rows.map(r => r.timestamp);
      blocks.push({
        dataset_id,
        avroData: combined,
        recordCount: rows.length,
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

function generateFilePath(schemaVersion: string, periodTag: string, tableName: string, index: number): string {
  const indexStr = String(index).padStart(3, '0');
  return `${schemaVersion}/${periodTag}/${tableName}-${indexStr}.avro`;
}

async function registerArchivedFile(db: D1Database, filePath: string, schemaVersion: string, fileSize: number, codec: string = 'deflate'): Promise<number> {
  await db.prepare(`
    INSERT INTO archived_files (file_path, schema_version, file_size, compression_codec, created_at, last_modified_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(filePath, schemaVersion, fileSize, codec, Date.now(), Date.now()).run();
  const row = await db.prepare('SELECT last_insert_rowid() AS id').first<{ id: number }>();
  return row?.id ?? 0;
}

async function insertBlockIndexes(db: D1Database, rows: BlockIndexRow[]): Promise<void> {
  if (!rows.length) return;
  const sql = `
    INSERT INTO block_indexes (dataset_id, table_name, schema_version, file_id, start_byte, length, record_count, start_timestamp, end_timestamp)
    VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')}
  `;
  const params: (string | number)[] = [];
  for (const r of rows) {
    params.push(r.dataset_id, r.table_name, r.schema_version, r.file_id, r.start_byte, r.length, r.record_count, r.start_timestamp, r.end_timestamp);
  }
  await db.prepare(sql).bind(...params).run();
}

async function cleanupBuffer(db: D1Database, maxId: number): Promise<void> {
  await db.prepare('DELETE FROM buffer_logs WHERE id <= ?').bind(maxId).run();
}

export async function handleCron(env: Env): Promise<void> {
  try {
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
        const filePath = generateFilePath(group.key.schema_version, group.key.period_tag, group.key.table_name, fileIndex + 1);

        // Concatenate blocks for this file
        const combined = new Uint8Array(chunk.size);
        let offset = 0;
        for (const block of chunk.blocks) {
          combined.set(block.avroData, offset);
          offset += block.avroData.byteLength;
        }

        // Upload to R2
        await env.BATTLE_DATA_BUCKET.put(filePath, combined, {
          httpMetadata: { contentType: 'application/octet-stream' },
          customMetadata: {
            'archive-date': new Date().toISOString(),
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
        const fileId = await registerArchivedFile(env.BATTLE_INDEX_DB, filePath, group.key.schema_version, chunk.size, 'deflate');
        
        // Create block indexes for each dataset in this file
        const blockIndexes: BlockIndexRow[] = [];
        let currentOffset = 0;
        for (const block of chunk.blocks) {
          blockIndexes.push({
            dataset_id: block.dataset_id,
            table_name: group.key.table_name,
            schema_version: group.key.schema_version,
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
    console.error('[Archival Error]', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
