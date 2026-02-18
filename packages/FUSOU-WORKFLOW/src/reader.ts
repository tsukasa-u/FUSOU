/**
 * Reader API - Hot/Cold Data Merge
 * 
 * Role: Unified query interface for recent (Hot) and historical (Cold) data
 * 
 * Access Pattern:
 * 1. Query Hot: TiDB buffer_logs (or D1 fallback on error)
 * 2. Query Cold: D1 block_indexes → R2 Range Request (efficient, historical)
 * 3. Merge: Combine and deduplicate results
 * 4. Cache: Aggressive caching for Cold data (immutable)
 * 
 * Data Consistency:
 * - Hot data is stored in TiDB (primary) or D1 (fallback)
 * - Must query TiDB if configured, otherwise data won't be found
 * 
 * Performance Target:
 * - Hot only: < 50ms
 * - Hot + Cold (single block): < 200ms
 * - Hot + Cold (multi-block, parallel): < 500ms
 */

import { detectCompressionCodec } from './utils/compression';
import { parseAllDeflateAvroBlocks, parseAllNullAvroBlocks, getAvroHeaderLengthFromPrefix, parseDeflateAvroBlock, parseNullAvroBlock } from './avro-manual';
import { computeSchemaFingerprint } from './avro-manual';
import { fetchHotDataWithFallback, BufferLogRecord } from './db';

// Bundled fingerprints — automatically kept in sync via rebuild-schema-chain.sh
// This import is resolved at build time, so no manual env var setup is needed.
// The env var TABLE_FINGERPRINTS_JSON can still override this at runtime.
import bundledFingerprints from '../../configs/fingerprints.json';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
  TABLE_FINGERPRINTS_JSON?: string; // map: { "0.4": { "table": ["<sha256>", ...] }, ... }
  // TiDB Cloud Serverless connection URL (required for hot data queries)
  TIDB_KC_DB_URL?: string;
}

interface QueryParams {
  dataset_id: string;
  table_name: string;
  from?: number;  // timestamp (ms)
  to?: number;    // timestamp (ms)
  format?: string; // 'json' (default) | 'ocf'
  table_version?: string; // Optional: filter by table version (0.4, 0.5, etc.)
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
  table_version: string;
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
 * Fetch Hot data from TiDB buffer_logs (or D1 fallback on error)
 * 
 * CRITICAL: Data is stored in TiDB if TIDB_KC_DB_URL is configured.
 * D1 fallback only happens on TiDB connection/query error.
 * 
 * FIXED: Hot data contains Avro OCF binary, not JSON text.
 * Must deserialize using Avro parser.
 */
async function fetchHotData(
  env: Env,
  params: QueryParams
): Promise<any[]> {
  const { rows } = await fetchHotDataWithFallback(env, {
    dataset_id: params.dataset_id,
    table_name: params.table_name,
    from: params.from,
    to: params.to,
    table_version: params.table_version,
  });
  
  // FIXED: Deserialize Avro OCF binary data (not JSON text)
  const allRecords: any[] = [];
  
  for (const row of rows) {
    // Convert to Uint8Array for Avro parsing
    // FIXED: Properly handle all cases including Uint8Array views with byteOffset
    let data: Uint8Array;
    if (row.data instanceof ArrayBuffer) {
      data = new Uint8Array(row.data);
    } else if (row.data instanceof Uint8Array) {
      data = row.data;
    } else {
      // Fallback: try to get underlying buffer with proper offset handling
      const anyData = row.data as any;
      if (anyData.buffer && typeof anyData.byteOffset === 'number' && typeof anyData.byteLength === 'number') {
        // It's a typed array view - copy to avoid offset issues
        data = new Uint8Array(anyData.buffer.slice(anyData.byteOffset, anyData.byteOffset + anyData.byteLength));
      } else {
        data = new Uint8Array(anyData.buffer || anyData);
      }
    }
    
    try {
      // Parse Avro OCF header to get schema and codec info
      const headerLen = getAvroHeaderLengthFromPrefix(data);
      const header = data.slice(0, headerLen);
      const body = data.slice(headerLen);
      
      // Detect codec and deserialize accordingly
      const codec = detectCompressionCodec(header);
      
      if (body.length === 0) {
        // Empty OCF (no data blocks)
        continue;
      }
      
      if (codec === 'deflate') {
        // FIXED: Parse ALL deflate-compressed blocks (not just the first one)
        const records = await parseAllDeflateAvroBlocks(header, body);
        allRecords.push(...records);
      } else {
        // FIXED: Parse ALL uncompressed blocks (not just the first one)
        const records = parseAllNullAvroBlocks(header, body);
        allRecords.push(...records);
      }
    } catch (err) {
      console.error(`[Reader] Failed to parse Hot data row ${row.id}:`, err instanceof Error ? err.message : String(err));
      // Continue processing other rows
    }
  }
  
  return allRecords;
}

/**
 * Fetch Cold block indexes from D1
 */
async function fetchColdIndexes(
  db: D1Database,
  params: QueryParams
): Promise<BlockIndex[]> {
  const { dataset_id, table_name, from, to, table_version } = params;
  
  let sql = `
    SELECT 
      bi.id, bi.dataset_id, bi.table_name, bi.table_version, bi.file_id,
      bi.start_byte, bi.length, bi.record_count,
      bi.start_timestamp, bi.end_timestamp,
      af.file_path, af.compression_codec
    FROM block_indexes bi
    JOIN archived_files af ON bi.file_id = af.id
    WHERE bi.dataset_id = ? AND bi.table_name = ?
  `;
  
  const bindings: any[] = [dataset_id, table_name];
  
  // Filter by table_version if specified
  if (table_version !== undefined) {
    sql += ' AND bi.table_version = ?';
    bindings.push(table_version);
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
    // Extract avro.schema JSON payload from Avro binary header.
    // In Avro OCF, metadata keys are stored as Avro strings (varint length + raw bytes),
    // NOT as JSON-quoted strings. So we search for the raw key without quotes.
    const text = new TextDecoder().decode(header);
    const keyIdx = text.indexOf('avro.schema');
    if (keyIdx === -1) return { fingerprint: null, namespace: null };
    const startBrace = text.indexOf('{', keyIdx);
    if (startBrace === -1) return { fingerprint: null, namespace: null };
    // Find matching closing brace with proper JSON string/escape handling
    let depth = 0;
    let endBrace = -1;
    let inString = false;
    let escapeNext = false;
    for (let i = startBrace; i < text.length; i++) {
      const ch = text[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (ch === '\\') { escapeNext = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (!inString) {
        if (ch === '{') depth++;
        if (ch === '}') {
          depth--;
          if (depth === 0) {
            endBrace = i;
            break;
          }
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
  tables: FingerprintTableMap;
}
type FingerprintVersionMap = Record<string, FingerprintVersionEntry>;

function loadSchemaFingerprintMap(env: Env): FingerprintVersionMap {
  // Priority: env var override > bundled fingerprints.json
  if (env.TABLE_FINGERPRINTS_JSON) {
    try {
      const parsed = JSON.parse(env.TABLE_FINGERPRINTS_JSON);
      if (typeof parsed === 'object' && parsed !== null) return parsed as FingerprintVersionMap;
    } catch {
      // Fall through to bundled
    }
  }
  // Use bundled fingerprints (imported at build time from configs/fingerprints.json)
  if (bundledFingerprints && typeof bundledFingerprints === 'object') {
    return bundledFingerprints as unknown as FingerprintVersionMap;
  }
  return {};
}

async function validateHeaderTableVersion(
  header: Uint8Array,
  tableVersion: string | undefined,
  allowedMap: FingerprintVersionMap,
  tableName: string
): Promise<void> {
  if (!tableVersion) return;
  const { fingerprint, namespace } = await parseSchemaFingerprintFromHeader(header);
  const versionEntry = allowedMap[tableVersion];
  if (!versionEntry || !fingerprint) return;
  const allowed = versionEntry.tables[tableName];
  const allowedList = Array.isArray(allowed) ? allowed : (allowed ? [allowed] : []);
  if (allowedList.length > 0 && !allowedList.includes(fingerprint)) {
    throw new Error(`Schema fingerprint mismatch for table_version=${tableVersion}/${tableName}`);
  }
}

/**
 * Deserialize Avro data block(s) to JSON records
 * FIXED: Uses multi-block parsers to handle OCF files with multiple data blocks.
 * Previously only parsed the first block, silently dropping records from subsequent blocks.
 */
async function deserializeAvroBlock(
  header: Uint8Array,
  dataBlock: Uint8Array
): Promise<any[]> {
  const codec = detectCompressionCodec(header);
  if (codec === 'deflate') {
    // FIXED: Use multi-block parser for deflate codec
    return await parseAllDeflateAvroBlocks(header, dataBlock);
  }
  // FIXED: Use multi-block parser for null/none codec
  return parseAllNullAvroBlocks(header, dataBlock);
}

/**
 * Merge Hot and Cold data, deduplicate by content hash
 * Note: Deduplication uses JSON stringification for simplicity
 * For production, consider using a more robust hash function
 */
async function fetchColdData(
  r2: R2Bucket,
  indexes: BlockIndex[],
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

    // Schema namespace/fingerprint validation (per file, using file's own table_version)
    const fileTableVersion = blocks[0]?.table_version; // All blocks in a file share the same version
    await validateHeaderTableVersion(header, fileTableVersion, allowedFingerprints, tableName);
    
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
    format: url.searchParams.get('format') ?? 'json',
    table_version: url.searchParams.get('table_version') ?? undefined
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
      
      // Check for mixed table versions (OCF format requires single schema)
      const uniqueVersions = new Set(indexes.map(idx => idx.table_version));
      if (uniqueVersions.size > 1) {
        console.warn(
          `[Reader] Mixed table versions detected for OCF request: ${Array.from(uniqueVersions).join(', ')}`
        );
        return new Response(
          JSON.stringify({
            error: 'Mixed table versions detected',
            detected_versions: Array.from(uniqueVersions),
            details: 'OCF format requires single table version. Please specify table_version parameter.',
          }),
          { 
            status: 400, 
            headers: { 'Content-Type': 'application/json' } 
          }
        );
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
    const hotRecords = await fetchHotData(env, params);
    console.log(`Hot records: ${hotRecords.length}`);
    
    // Step 2: Fetch Cold indexes (fast D1 query)
    const coldIndexes = await fetchColdIndexes(env.BATTLE_INDEX_DB, params);
    console.log(`Cold indexes: ${coldIndexes.length}`);
    
    // Detect mixed table versions
    const uniqueVersions = new Set(coldIndexes.map(idx => idx.table_version));
    const mixedVersions = uniqueVersions.size > 1;
    if (mixedVersions) {
      console.warn(
        `[Reader] Mixed table versions detected: ${Array.from(uniqueVersions).join(', ')}. ` +
        `Consider specifying table_version parameter for consistent results.`
      );
    }
    
    // Step 3: Fetch Cold data (Range Requests, parallel)
    const allowedFingerprints = loadSchemaFingerprintMap(env);
    const coldRecords = await fetchColdData(
      env.BATTLE_DATA_BUCKET,
      coldIndexes,
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
    
    const detectedVersionsList = Array.from(uniqueVersions);
    return new Response(
      JSON.stringify({
        dataset_id: params.dataset_id,
        table_name: params.table_name,
        table_version: detectedVersionsList.length === 1 ? detectedVersionsList[0] : undefined,
        record_count: mergedRecords.length,
        hot_count: hotRecords.length,
        cold_count: coldRecords.length,
        mixed_versions: mixedVersions || undefined,
        detected_versions: mixedVersions ? detectedVersionsList : undefined,
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
