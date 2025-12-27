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

import { detectCompressionCodec } from './utils/compression';
import { parseDeflateAvroBlock, getAvroHeaderLengthFromPrefix, parseNullAvroBlock } from './avro-manual';
import { computeSchemaFingerprint } from './avro-manual';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
  SCHEMA_FINGERPRINTS_JSON?: string; // map: { "v1": { "table": ["<sha256>", ...] }, ... }
}

interface QueryParams {
  dataset_id: string;
  table_name: string;
  from?: number;  // timestamp (ms)
  to?: number;    // timestamp (ms)
  format?: string; // 'json' (default) | 'ocf'
  schema_version?: string; // Optional: filter by schema version (v1, v2, etc.) - defaults to latest
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
  schema_version: string;
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
  const { dataset_id, table_name, from, to, schema_version } = params;
  
  let sql = `
    SELECT 
      bi.id, bi.dataset_id, bi.table_name, bi.schema_version, bi.file_id,
      bi.start_byte, bi.length, bi.record_count,
      bi.start_timestamp, bi.end_timestamp,
      af.file_path, af.compression_codec
    FROM block_indexes bi
    JOIN archived_files af ON bi.file_id = af.id
    WHERE bi.dataset_id = ? AND bi.table_name = ?
  `;
  
  const bindings: any[] = [dataset_id, table_name];
  
  // Filter by schema_version if specified
  // If not specified, return all versions (backward compatible)
  if (schema_version !== undefined) {
    sql += ' AND bi.schema_version = ?';
    bindings.push(schema_version);
  } else {
    // Default: prefer v1, but fallback to any version if v1 not available
    // This handles NULL values from pre-migration data
    sql += ' AND (bi.schema_version = \'v1\' OR bi.schema_version IS NULL)';
  }
  
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
  _compressionCodec: string | null
): Promise<Uint8Array> {
  const obj = await r2.get(filePath, {
    range: { offset: startByte, length }
  });
  
  if (!obj) {
    throw new Error(`R2 object not found: ${filePath}`);
  }
  
  const buffer = await obj.arrayBuffer();
  return new Uint8Array(buffer);
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
  const obj = await r2.get(filePath, { range: { offset: 0, length: 4096 } });
  
  if (!obj) {
    throw new Error(`R2 object not found: ${filePath}`);
  }
  
  const buffer = await obj.arrayBuffer();
  const prefix = new Uint8Array(buffer);
  // Try parse exact header length if Avro magic is present
  try {
    const headerLen = getAvroHeaderLengthFromPrefix(prefix);
    return prefix.slice(0, headerLen);
  } catch {
    // Not an Avro file (NDJSON path), treat header as empty
    return new Uint8Array(0);
  }
}

async function parseSchemaFingerprintFromHeader(header: Uint8Array): Promise<{ fingerprint: string | null; namespace: string | null }> {
  try {
    // Rough extraction: find avro.schema JSON payload inside header text
    const text = new TextDecoder().decode(header);
    const keyIdx = text.indexOf('"avro.schema"');
    if (keyIdx === -1) return { fingerprint: null, namespace: null };
    const startBrace = text.indexOf('{', keyIdx);
    if (startBrace === -1) return { fingerprint: null, namespace: null };
    // Find matching closing brace using a simple stack walk
    let depth = 0;
    let endBrace = -1;
    for (let i = startBrace; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          endBrace = i;
          break;
        }
      }
    }
    if (endBrace === -1) return { fingerprint: null, namespace: null };
    const schemaJson = text.slice(startBrace, endBrace + 1);
    const schema = JSON.parse(schemaJson);
    const fp = await computeSchemaFingerprint(schemaJson);
    const ns = typeof schema.namespace === 'string' ? schema.namespace : null;
    return { fingerprint: fp, namespace: ns };
  } catch {
    return { fingerprint: null, namespace: null };
  }
}

type FingerprintEntry = string | string[];
type FingerprintTableMap = Record<string, FingerprintEntry>;
interface FingerprintVersionEntry {
  table_version: string;
  tables: FingerprintTableMap;
}
type FingerprintVersionMap = Record<string, FingerprintVersionEntry>;

function loadSchemaFingerprintMap(env: Env): FingerprintVersionMap {
  if (!env.SCHEMA_FINGERPRINTS_JSON) return {};
  try {
    const parsed = JSON.parse(env.SCHEMA_FINGERPRINTS_JSON);
    if (typeof parsed === 'object' && parsed !== null) return parsed as FingerprintVersionMap;
  } catch {
    return {};
  }
  return {};
}

async function validateHeaderSchemaVersion(
  header: Uint8Array,
  expectedVersion: string | undefined,
  allowedMap: FingerprintVersionMap,
  tableName: string
): Promise<void> {
  if (!expectedVersion) return;
  const { fingerprint, namespace } = await parseSchemaFingerprintFromHeader(header);
  if (namespace && !namespace.includes(expectedVersion)) {
    throw new Error(`Schema namespace mismatch: expected version ${expectedVersion}, got namespace ${namespace}`);
  }
  const versionEntry = allowedMap[expectedVersion];
  if (!versionEntry || !fingerprint) return;
  const allowed = versionEntry.tables[tableName];
  const allowedList = Array.isArray(allowed) ? allowed : (allowed ? [allowed] : []);
  if (allowedList.length > 0 && !allowedList.includes(fingerprint)) {
    throw new Error(`Schema fingerprint mismatch for ${expectedVersion}/${tableName} (TABLE_VERSION: ${versionEntry.table_version})`);
  }
}

/**
 * Deserialize Avro data block to JSON records
 * Uses parseAvroDataBlock from avro-manual
 */
async function deserializeAvroBlock(
  header: Uint8Array,
  dataBlock: Uint8Array
): Promise<any[]> {
  const codec = detectCompressionCodec(header);
  if (codec === 'deflate') {
    // dataBlock is still compressed (we did not auto-decompress in fetchColdBlock)
    return await parseDeflateAvroBlock(header, dataBlock);
  }
  // null/none: decode without decompression
  return parseNullAvroBlock(header, dataBlock);
}

/**
 * Merge Hot and Cold data, deduplicate by content hash
 * Note: Deduplication uses JSON stringification for simplicity
 * For production, consider using a more robust hash function
 */
async function fetchColdData(
  r2: R2Bucket,
  indexes: BlockIndex[],
  expectedSchemaVersion: string | undefined,
  allowedFingerprints: FingerprintVersionMap,
  tableName: string
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
    // Optional: verify header codec matches index expectation, if provided
    const headerCodec = detectCompressionCodec(header);

    // Schema namespace/fingerprint validation (per file)
    await validateHeaderSchemaVersion(header, expectedSchemaVersion, allowedFingerprints, tableName);
    
    // Fetch all blocks for this file in parallel
    const blockPromises = blocks.map(block => {
      if (block.compression_codec && headerCodec && block.compression_codec !== headerCodec) {
        throw new Error(`Compression codec mismatch for ${filePath}: header=${headerCodec}, index=${block.compression_codec}`);
      }
      return fetchColdBlock(r2, filePath, block.start_byte, block.length, block.compression_codec);
    });
    
    const blockBuffers = await Promise.all(blockPromises);
    // Deserialize each block (codec-aware)
    const parsePromises = blockBuffers.map(buf => deserializeAvroBlock(header, buf));
    const parsedBlocks = await Promise.all(parsePromises);
    for (const recs of parsedBlocks) {
      allRecords.push(...recs);
    }
  }
  
  return allRecords;
}

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
    to: url.searchParams.has('to') ? Number(url.searchParams.get('to')) : undefined,
    format: url.searchParams.get('format') ?? 'json'
  };
  
  if (!params.dataset_id || !params.table_name) {
    return new Response(
      JSON.stringify({ error: 'Missing dataset_id or table_name' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  try {
    // Special mode: return an Avro OCF stream (header + blocks) for one file group
    if ((params.format ?? 'json') === 'ocf') {
      const indexes = await fetchColdIndexes(env.BATTLE_INDEX_DB, params);
      if (indexes.length === 0) {
        return new Response('Not Found', { status: 404 });
      }
      // Group by file_path; choose the first group
      const filePath = indexes[0].file_path;
      const blocks = indexes.filter(i => i.file_path === filePath);
      const header = await fetchAvroHeader(env.BATTLE_DATA_BUCKET, filePath);
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      await writer.write(header);
      const blockPromises = blocks.map(b => fetchColdBlock(env.BATTLE_DATA_BUCKET, filePath, b.start_byte, b.length, b.compression_codec));
      const buffers = await Promise.all(blockPromises);
      for (const buf of buffers) {
        await writer.write(buf);
      }
      await writer.close();
      const headers = new Headers({
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600, immutable',
        'Access-Control-Allow-Origin': '*'
      });
      return new Response(readable, { status: 200, headers });
    }

    // Step 1: Fetch Hot data (fast, always fresh)
    const hotRecords = await fetchHotData(env.BATTLE_INDEX_DB, params);
    console.log(`Hot records: ${hotRecords.length}`);
    
    // Step 2: Fetch Cold indexes (fast D1 query)
    const coldIndexes = await fetchColdIndexes(env.BATTLE_INDEX_DB, params);
    console.log(`Cold indexes: ${coldIndexes.length}`);
    
    // Step 3: Fetch Cold data (Range Requests, parallel)
    const allowedFingerprints = loadSchemaFingerprintMap(env);
    const effectiveSchemaVersion = params.schema_version ?? (coldIndexes[0]?.schema_version ?? undefined);
    const coldRecords = await fetchColdData(
      env.BATTLE_DATA_BUCKET,
      coldIndexes,
      effectiveSchemaVersion,
      allowedFingerprints,
      params.table_name
    );
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
