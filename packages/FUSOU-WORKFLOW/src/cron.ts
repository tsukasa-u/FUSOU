/**
 * Archiver Cron Worker using manual Avro OCF blocks (deflate codec)
 * - Streams a single hourly OCF file to R2
 * - Builds a shared header once, then appends per-user blocks
 * - Records byte offsets/lengths for D1 block index to enable Range reads
 */

import { generateHeader, generateBlock, inferSchemaFromRecord, generateSyncMarker, AvroSchema } from './utils/avro.js';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
}

interface BufferRow {
  id: number;
  dataset_id: string;
  table_name: string;
  period_tag: string;
  timestamp: number;
  data: ArrayBuffer;
  uploaded_by: string | null;
}

interface RecordWithMetadata {
  dataset_id: string;
  record: any;
}

interface DatasetGroup {
  table_name: string;
  period_tag: string;
  records: RecordWithMetadata[];
}

interface BlockIndexRow {
  dataset_id: string;
  table_name: string;
  file_id: number;
  start_byte: number;
  length: number;
  record_count: number;
  start_timestamp: number;
  end_timestamp: number;
}

async function fetchBufferedData(db: D1Database): Promise<BufferRow[]> {
  const res = await db.prepare(`
    SELECT id, dataset_id, table_name, period_tag, timestamp, data, uploaded_by
    FROM buffer_logs
    ORDER BY id ASC
  `).all<BufferRow>();
  return res.results ?? [];
}

interface RecordWithMetadata {
  dataset_id: string;
  record: any;
}

function groupByDataset(rows: BufferRow[]): DatasetGroup[] {
  const groups = new Map<string, DatasetGroup>();
  for (const row of rows) {
    const key = `${row.table_name}::${row.period_tag}`;
    if (!groups.has(key)) {
      groups.set(key, { table_name: row.table_name, period_tag: row.period_tag, records: [] });
    }
    const decoded = new TextDecoder().decode(row.data);
    const record = JSON.parse(decoded);
    // Store metadata separately to avoid polluting user data
    const recordWithMetadata: RecordWithMetadata = { dataset_id: row.dataset_id, record };
    groups.get(key)!.records.push(recordWithMetadata);
  }
  return Array.from(groups.values());
}

function generateFilePath(tableName: string, periodTag: string): string {
  return `${tableName}/${periodTag}.avro`;
}

async function registerArchivedFile(db: D1Database, filePath: string, fileSize: number, codec: string = 'deflate'): Promise<number> {
  await db.prepare(`
    INSERT INTO archived_files (file_path, file_size, compression_codec, created_at, last_modified_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(filePath, fileSize, codec, Date.now(), Date.now()).run();
  const row = await db.prepare('SELECT last_insert_rowid() AS id').first<{ id: number }>();
  return row?.id ?? 0;
}

async function insertBlockIndexes(db: D1Database, rows: BlockIndexRow[]): Promise<void> {
  if (!rows.length) return;
  const sql = `
    INSERT INTO block_indexes (dataset_id, table_name, file_id, start_byte, length, record_count, start_timestamp, end_timestamp)
    VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?)').join(',')}
  `;
  const params: (string | number)[] = [];
  for (const r of rows) {
    params.push(r.dataset_id, r.table_name, r.file_id, r.start_byte, r.length, r.record_count, r.start_timestamp, r.end_timestamp);
  }
  await db.prepare(sql).bind(...params).run();
}

async function cleanupBuffer(db: D1Database, maxId: number): Promise<void> {
  await db.prepare('DELETE FROM buffer_logs WHERE id <= ?').bind(maxId).run();
}

export async function handleCron(env: Env): Promise<void> {
  const rows = await fetchBufferedData(env.BATTLE_INDEX_DB);
  if (!rows.length) {
    console.log('No buffered data to archive');
    return;
  }

  const maxId = Math.max(...rows.map(r => r.id));
  const groups = groupByDataset(rows);

  // Process each table_name + period_tag independently (one file per group)
  for (const group of groups) {
    if (!group.records.length) continue;

    const filePath = generateFilePath(group.table_name, group.period_tag);

    // Infer schema from first actual record (not metadata wrapper)
    const schema: AvroSchema = group.records.length
      ? inferSchemaFromRecord(group.records[0].record)
      : { type: 'record', name: 'Record', fields: [{ name: 'payload', type: 'string' }] };
    const syncMarker = generateSyncMarker();

    // Group records by dataset_id for per-user blocks
    const datasetGroups = new Map<string, { dataset_id: string; records: any[] }>();
    for (const item of group.records) {
      const did = item.dataset_id;
      if (!datasetGroups.has(did)) {
        datasetGroups.set(did, { dataset_id: did, records: [] });
      }
      datasetGroups.get(did)!.records.push(item.record);  // Store ONLY user data
    }

    // Build header once
    const header = generateHeader(schema, syncMarker);
    
    // Build separate blocks for each dataset_id
    const blocks: { dataset_id: string; records: any[]; buffer: Uint8Array }[] = [];
    for (const group of datasetGroups.values()) {
      const blockBuffer = await generateBlock(schema, group.records, syncMarker);
      blocks.push({ dataset_id: group.dataset_id, records: group.records, buffer: blockBuffer });
    }

    // Calculate total size: header + all blocks
    const totalSize = header.byteLength + blocks.reduce((sum, b) => sum + b.buffer.byteLength, 0);

    // Concatenate header + all blocks into one file
    const combined = new Uint8Array(totalSize);
    combined.set(header, 0);
    let offset = header.byteLength;
    for (const block of blocks) {
      combined.set(block.buffer, offset);
      offset += block.buffer.byteLength;
    }

    // Upload to R2 (header + multiple blocks, one per dataset_id)
    await env.BATTLE_DATA_BUCKET.put(filePath, combined, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: {
        'archive-date': new Date().toISOString(),
        'block-count': String(blocks.length),
        'compression': 'deflate',
        'upload-mode': 'multi-block'
      }
    });

    // Register file and create block indexes per dataset_id with correct offsets
    const fileId = await registerArchivedFile(env.BATTLE_INDEX_DB, filePath, totalSize, 'deflate');
    
    const blockIndexes: BlockIndexRow[] = [];
    let currentOffset = header.byteLength;
    for (const block of blocks) {
      const ts = block.records.map(r => r.timestamp ?? Date.now()).filter(t => typeof t === 'number');
      const startTs = ts.length ? Math.min(...ts) : Date.now();
      const endTs = ts.length ? Math.max(...ts) : Date.now();
      blockIndexes.push({
        dataset_id: block.dataset_id,
        table_name: group.table_name,
        file_id: fileId,
        start_byte: currentOffset,
        length: block.buffer.byteLength,
        record_count: block.records.length,
        start_timestamp: startTs,
        end_timestamp: endTs,
      });
      currentOffset += block.buffer.byteLength;
    }
    await insertBlockIndexes(env.BATTLE_INDEX_DB, blockIndexes);
  }

  await cleanupBuffer(env.BATTLE_INDEX_DB, maxId);
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCron(env));
  }
};
