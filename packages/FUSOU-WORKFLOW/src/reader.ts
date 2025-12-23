/**
 * Reader API - Hot/Cold Data Merge
 * 
 * Role: Unified query interface for recent (Hot) and historical (Cold) data
 * 
 * Access Pattern:
 * 1. Query Hot: D1 buffer_logs (fast, recent 1 hour)
 * 2. Query Cold: D1 block_indexes → R2 Range Request (efficient, historical)
 * 3. Merge: Combine and deduplicate results
 * 4. Cache: Aggressive caching for Cold data (immutable)
 * 
 * Performance Target:
 * - Hot only: < 50ms
 * - Hot + Cold (single block): < 200ms
 * - Hot + Cold (multi-block, parallel): < 500ms
 */

import { autoDecompress } from './utils/compression';
import { parseAvroDataBlock } from './avro-manual';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
}

interface QueryParams {
  dataset_id: string;
  table_name: string;
  from?: number;  // timestamp (ms)
  to?: number;    // timestamp (ms)
}

interface HotRecord {
  id: number;
  dataset_id: string;
  table_name: string;
  timestamp: number;
  data: ArrayBuffer;
}

interface BlockIndex {
  id: number;
  dataset_id: string;
  table_name: string;
  file_id: number;
  start_byte: number;
  length: number;
  record_count: number;
  start_timestamp: number;
  end_timestamp: number;
  file_path: string;        // Joined from archived_files
  compression_codec: string | null;
}

/**
 * Fetch Hot data from D1 buffer_logs
 */
async function fetchHotData(
  db: D1Database,
  params: QueryParams
): Promise<any[]> {
  const { dataset_id, table_name, from, to } = params;
  
  let sql = `
    SELECT id, dataset_id, table_name, timestamp, data
    FROM buffer_logs
    WHERE dataset_id = ? AND table_name = ?
  `;
  
  const bindings: any[] = [dataset_id, table_name];
  
  if (from !== undefined) {
    sql += ' AND timestamp >= ?';
    bindings.push(from);
  }
  
  if (to !== undefined) {
    sql += ' AND timestamp <= ?';
    bindings.push(to);
  }
  
  sql += ' ORDER BY timestamp ASC';
  
  const result = await db.prepare(sql).bind(...bindings).all<HotRecord>();
  
  // Deserialize BLOB to JSON
  return (result.results ?? []).map(row => {
    const decoded = new TextDecoder().decode(row.data);
    return JSON.parse(decoded);
  });
}

/**
 * Fetch Cold block indexes from D1
 */
async function fetchColdIndexes(
  db: D1Database,
  params: QueryParams
): Promise<BlockIndex[]> {
  const { dataset_id, table_name, from, to } = params;
  
  let sql = `
    SELECT 
      bi.id, bi.dataset_id, bi.table_name, bi.file_id,
      bi.start_byte, bi.length, bi.record_count,
      bi.start_timestamp, bi.end_timestamp,
      af.file_path, af.compression_codec
    FROM block_indexes bi
    JOIN archived_files af ON bi.file_id = af.id
    WHERE bi.dataset_id = ? AND bi.table_name = ?
  `;
  
  const bindings: any[] = [dataset_id, table_name];
  
  if (from !== undefined) {
    sql += ' AND bi.end_timestamp >= ?';
    bindings.push(from);
  }
  
  if (to !== undefined) {
    sql += ' AND bi.start_timestamp <= ?';
    bindings.push(to);
  }
  
  sql += ' ORDER BY bi.start_timestamp ASC';
  
  const result = await db.prepare(sql).bind(...bindings).all<BlockIndex>();
  
  return result.results ?? [];
}

/**
 * Fetch single block from R2 using Range Request
 */
async function fetchColdBlock(
  r2: R2Bucket,
  filePath: string,
  startByte: number,
  length: number,
  compressionCodec: string | null
): Promise<Uint8Array> {
  const obj = await r2.get(filePath, {
    range: { offset: startByte, length }
  });
  
  if (!obj) {
    throw new Error(`R2 object not found: ${filePath}`);
  }
  
  const buffer = await obj.arrayBuffer();
  const data = new Uint8Array(buffer);
  
  // Decompress if needed
  return await autoDecompress(data, compressionCodec);
}

/**
 * Fetch Avro header for data block reconstruction
 * (Cached aggressively, same for entire file)
 */
async function fetchAvroHeader(
  r2: R2Bucket,
  filePath: string
): Promise<Uint8Array> {
  // Read first 4KB (headers are typically < 1KB)
  const obj = await r2.get(filePath, {
    range: { offset: 0, length: 4096 }
  });
  
  if (!obj) {
    throw new Error(`R2 object not found: ${filePath}`);
  }
  
  const buffer = await obj.arrayBuffer();
  
  // TODO: Parse Avro header length and return exact bytes
  // For now, return first 4KB
  return new Uint8Array(buffer);
}

/**
 * Deserialize Avro data block to JSON records
 * Uses parseAvroDataBlock from avro-manual
 */
function deserializeAvroBlock(
  header: Uint8Array,
  dataBlock: Uint8Array
): any[] {
  return parseAvroDataBlock(header, dataBlock);
}

/**
 * Fetch Cold data from R2 with Range Requests (parallel)
 */
async function fetchColdData(
  r2: R2Bucket,
  indexes: BlockIndex[]
): Promise<any[]> {
  if (indexes.length === 0) return [];
  
  // Group by file to cache headers
  const fileGroups = new Map<string, BlockIndex[]>();
  for (const idx of indexes) {
    if (!fileGroups.has(idx.file_path)) {
      fileGroups.set(idx.file_path, []);
    }
    fileGroups.get(idx.file_path)!.push(idx);
  }
  
  // Fetch all blocks in parallel
  const allRecords: any[] = [];
  
  for (const [filePath, blocks] of fileGroups.entries()) {
    // Fetch header once per file
    const header = await fetchAvroHeader(r2, filePath);
    
    // Fetch all blocks for this file in parallel
    const blockPromises = blocks.map(block =>
      fetchColdBlock(r2, filePath, block.start_byte, block.length, block.compression_codec)
    );
    
    const blockBuffers = await Promise.all(blockPromises);
    
    // Deserialize each block
    for (const buffer of blockBuffers) {
      const records = deserializeAvroBlock(header, buffer);
      allRecords.push(...records);
    }
  }
  
  return allRecords;
}

/**
 * Merge Hot and Cold data, deduplicate by content hash
 * Note: Deduplication uses JSON stringification for simplicity
 * For production, consider using a more robust hash function
 */
function mergeAndDeduplicate(
  hotRecords: any[],
  coldRecords: any[]
): any[] {
  // Combine
  const combined = [...coldRecords, ...hotRecords];
  
  // Sort by timestamp
  combined.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  
  // Deduplicate by content hash (not just timestamp)
  // This prevents losing records with same timestamp but different content
  const seen = new Set<string>();
  const deduplicated: any[] = [];
  
  for (const record of combined) {
    // Create a simple hash from record content
    // In production, use a proper hash function (e.g., SHA-256)
    const hash = JSON.stringify(record);
    if (!seen.has(hash)) {
      seen.add(hash);
      deduplicated.push(record);
    }
  }
  
  return deduplicated;
}

/**
 * Main Reader Handler
 * GET /v1/read?dataset_id=X&table_name=Y&from=Z&to=W
 */
export async function handleRead(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const params: QueryParams = {
    dataset_id: url.searchParams.get('dataset_id') ?? '',
    table_name: url.searchParams.get('table_name') ?? '',
    from: url.searchParams.has('from') ? Number(url.searchParams.get('from')) : undefined,
    to: url.searchParams.has('to') ? Number(url.searchParams.get('to')) : undefined
  };
  
  if (!params.dataset_id || !params.table_name) {
    return new Response(
      JSON.stringify({ error: 'Missing dataset_id or table_name' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  try {
    // Step 1: Fetch Hot data (fast, always fresh)
    const hotRecords = await fetchHotData(env.BATTLE_INDEX_DB, params);
    console.log(`Hot records: ${hotRecords.length}`);
    
    // Step 2: Fetch Cold indexes (fast D1 query)
    const coldIndexes = await fetchColdIndexes(env.BATTLE_INDEX_DB, params);
    console.log(`Cold indexes: ${coldIndexes.length}`);
    
    // Step 3: Fetch Cold data (Range Requests, parallel)
    const coldRecords = await fetchColdData(env.BATTLE_DATA_BUCKET, coldIndexes);
    console.log(`Cold records: ${coldRecords.length}`);
    
    // Step 4: Merge and deduplicate
    const mergedRecords = mergeAndDeduplicate(hotRecords, coldRecords);
    
    // Step 5: Return with caching headers
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      
      // Cache Cold data aggressively (immutable)
      // If only Hot data: short cache (1 minute)
      'Cache-Control': coldRecords.length > 0
        ? 'public, max-age=3600, immutable'  // 1 hour
        : 'public, max-age=60'                // 1 minute
    });
    
    return new Response(
      JSON.stringify({
        dataset_id: params.dataset_id,
        table_name: params.table_name,
        record_count: mergedRecords.length,
        hot_count: hotRecords.length,
        cold_count: coldRecords.length,
        records: mergedRecords
      }),
      { status: 200, headers }
    );
    
  } catch (err) {
    console.error('Read error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Export for integration into main Worker
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/v1/read' && request.method === 'GET') {
      return await handleRead(request, env);
    }
    
    return new Response('Not Found', { status: 404 });
  }
};
