/**
 * Parquetスキーマ指紋によるグルーピング
 * 異スキーマ混在を自動分離
 */

import { parseParquetMetadataFromFooterBuffer, parseParquetMetadataFromFullFile, RowGroupInfo } from './parquet-compactor';

export interface SchemaFingerprint {
  hash: string;
  numColumns: number;
  columnNames: string[];
  columnTypes: string[];
}

/**
 * Parquetフッターからスキーマ指紋を生成
 */
export async function extractSchemaFingerprint(
  bucket: R2Bucket,
  key: string
): Promise<SchemaFingerprint> {
  // Footer読み取り（末尾8バイト→size→footer本体）
  const tailObj = await bucket.get(key, { range: { suffix: 8 } });
  if (!tailObj) throw new Error(`Fragment not found: ${key}`);
  
  const tailBuf = new Uint8Array(await tailObj.arrayBuffer());
  const footerSizeView = new DataView(tailBuf.buffer, tailBuf.byteOffset, 4);
  const footerSize = footerSizeView.getUint32(0, true);
  
  const headObj = await bucket.head(key);
  if (!headObj) throw new Error(`Cannot head ${key}`);
  const totalSize = headObj.size;
  const footerStart = totalSize - 8 - footerSize;
  
  const footerObj = await bucket.get(key, {
    range: { offset: footerStart, length: footerSize },
  });
  if (!footerObj) throw new Error(`Cannot read footer of ${key}`);
  
  const footerData = new Uint8Array(await footerObj.arrayBuffer());
  // hyparquet用に footer(metadata) + 4B(size) + 4B('PAR1') を連結
  const footerBuf = new Uint8Array(footerSize + 8);
  footerBuf.set(footerData, 0);
  new DataView(footerBuf.buffer, footerSize, 4).setUint32(0, footerSize, true);
  footerBuf.set(new TextEncoder().encode('PAR1'), footerSize + 4);

  const rowGroups = parseParquetMetadataFromFooterBuffer(footerBuf);
  return buildSchemaFingerprintFromRowGroups(rowGroups);
}

/**
 * ArrayBufferから直接スキーマ指紋を生成（抽出済みデータ用）
 */
export async function extractSchemaFingerprintFromData(
  parquetData: ArrayBuffer | Uint8Array
): Promise<SchemaFingerprint> {
  const data = parquetData instanceof Uint8Array ? parquetData : new Uint8Array(parquetData);
  const rowGroups = parseParquetMetadataFromFullFile(data);
  return await buildSchemaFingerprintFromRowGroups(rowGroups);
}

async function buildSchemaFingerprintFromRowGroups(rowGroups: RowGroupInfo[]): Promise<SchemaFingerprint> {
  if (!rowGroups || rowGroups.length === 0 || !rowGroups[0] || !rowGroups[0].columnChunks || rowGroups[0].columnChunks.length === 0) {
    return { hash: 'unknown', numColumns: 0, columnNames: [], columnTypes: [] };
  }

  const firstRg = rowGroups[0];
  const numColumns = firstRg.columnChunks.length;
  const columnTypes = firstRg.columnChunks.map((cc) => cc.type);
  const columnNames = firstRg.columnChunks.map((_, i) => `col_${i}`);
  const schemaStr = `cols:${numColumns}|types:${columnTypes.join(',')}`;
  const hash = await simpleHash(schemaStr);
  return { hash, numColumns, columnNames, columnTypes };
}

/**
 * Parquetフッターからスキーマ指紋を生成（旧実装 - 後方互換性のため残す）
 */
// Legacy implementation removed: use hyparquet-based extractors above for safety

/**
 * シンプルなハッシュ関数（Web Crypto API利用）
 */
async function simpleHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 16); // 先頭16文字（64bit相当）
}

/**
 * Extract schema fingerprint from table offset metadata (no R2 access needed)
 * This avoids expensive R2 GET requests by using metadata already in D1
 */
export async function extractSchemaFingerprintFromOffsetMetadata(
  offsets: Array<{ table_name: string; schema?: any }>
): Promise<SchemaFingerprint> {
  if (!offsets || offsets.length === 0) {
    return { hash: 'unknown', numColumns: 0, columnNames: [], columnTypes: [] };
  }

  // Use first table's schema metadata if available
  const firstTable = offsets[0];
  if (!firstTable.schema || typeof firstTable.schema !== 'object') {
    return { hash: 'unknown', numColumns: 0, columnNames: [], columnTypes: [] };
  }

  const schema = firstTable.schema;
  const columnNames = Array.isArray(schema.columns) ? schema.columns.map((c: any) => c.name || 'unknown') : [];
  const columnTypes = Array.isArray(schema.columns) ? schema.columns.map((c: any) => c.type || 'unknown') : [];
  const numColumns = columnNames.length;

  if (numColumns === 0) {
    return { hash: 'unknown', numColumns: 0, columnNames: [], columnTypes: [] };
  }

  const schemaStr = `cols:${numColumns}|types:${columnTypes.join(',')}`;
  const hash = await simpleHash(schemaStr);
  return { hash, numColumns, columnNames, columnTypes };
}

/**
 * フラグメント群をスキーマ指紋でグルーピング
 */
export async function groupFragmentsBySchema(
  bucket: R2Bucket,
  fragments: Array<{ key: string; size: number }>
): Promise<Map<string, Array<{ key: string; size: number }>>> {
  const schemaGroups = new Map<string, Array<{ key: string; size: number }>>();
  
  // 並列でスキーマ抽出（最大5並列）
  const batchSize = 5;
  for (let i = 0; i < fragments.length; i += batchSize) {
    const batch = fragments.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (frag) => {
        // FAIL-FAST: Don't catch errors in development, let workflow fail immediately
        const fingerprint = await extractSchemaFingerprint(bucket, frag.key);
        return { frag, fingerprint };
      })
    );
    
    batchResults.forEach(({ frag, fingerprint }) => {
      const hash = fingerprint.hash;
      if (!schemaGroups.has(hash)) {
        schemaGroups.set(hash, []);
      }
      schemaGroups.get(hash)!.push(frag);
    });
  }
  
  console.log(`[Schema] Grouped ${fragments.length} fragments into ${schemaGroups.size} schema groups`);
  
  return schemaGroups;
}

/**
 * 抽出済みデータをスキーマ指紋でグルーピング（offset extraction後の処理用）
 */
export async function groupExtractedFragmentsBySchema(
  fragments: Array<{ key: string; data: ArrayBuffer; size: number }>
): Promise<Map<string, Array<{ key: string; data: ArrayBuffer; size: number }>>> {
  const schemaGroups = new Map<string, Array<{ key: string; data: ArrayBuffer; size: number }>>();
  
  // 並列でスキーマ抽出（最大5並列）
  const batchSize = 5;
  for (let i = 0; i < fragments.length; i += batchSize) {
    const batch = fragments.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (frag) => {
        // FAIL-FAST: Don't catch errors in development, let workflow fail immediately
        const fingerprint = await extractSchemaFingerprintFromData(frag.data);
        return { frag, fingerprint };
      })
    );
    
    batchResults.forEach(({ frag, fingerprint }) => {
      const hash = fingerprint.hash;
      if (!schemaGroups.has(hash)) {
        schemaGroups.set(hash, []);
      }
      schemaGroups.get(hash)!.push(frag);
    });
  }
  
  console.log(`[Schema] Grouped ${fragments.length} extracted fragments into ${schemaGroups.size} schema groups`);
  
  return schemaGroups;
}

/**
 * OPTIMIZED: Group fragments by schema using offset metadata (no Parquet parsing)
 * This eliminates expensive hyparquet parsing by using schema info already in D1
 */
export async function groupFragmentsByOffsetMetadata(
  fragments: Array<{ key: string; data: ArrayBuffer; size: number; offsetMetadata?: string }>
): Promise<Map<string, Array<{ key: string; data: ArrayBuffer; size: number }>>> {
  const schemaGroups = new Map<string, Array<{ key: string; data: ArrayBuffer; size: number }>>();
  let emptyRowGroupCount = 0;
  
  for (const frag of fragments) {
    let schemaHash = 'unknown';
    
    // Try to extract schema from offset metadata first (fast path)
    if (frag.offsetMetadata) {
      try {
        const offsets = JSON.parse(frag.offsetMetadata);
        if (Array.isArray(offsets) && offsets.length > 0) {
          // Check if all tables have num_rows = 0 (empty RowGroups)
          const allEmpty = offsets.every((t: any) => typeof t.num_rows === 'number' && t.num_rows === 0);
          if (allEmpty) {
            emptyRowGroupCount++;
            continue; // Skip fragments with all empty RowGroups
          }
          
          const fingerprint = await extractSchemaFingerprintFromOffsetMetadata(offsets);
          schemaHash = fingerprint.hash;
        }
      } catch (error) {
        console.warn(`[Schema] Failed to parse offset metadata for ${frag.key}, falling back to Parquet parsing`);
      }
    }
    
    // Fallback: Parse Parquet data if offset metadata unavailable (legacy fragments)
    if (schemaHash === 'unknown') {
      try {
        const fingerprint = await extractSchemaFingerprintFromData(frag.data);
        schemaHash = fingerprint.hash;
      } catch (error) {
        console.warn(`[Schema] Failed to extract schema for ${frag.key}:`, error);
        schemaHash = 'unknown';
      }
    }
    
    if (!schemaGroups.has(schemaHash)) {
      schemaGroups.set(schemaHash, []);
    }
    schemaGroups.get(schemaHash)!.push({
      key: frag.key,
      data: frag.data,
      size: frag.size
    });
  }
  
  if (emptyRowGroupCount > 0) {
    console.info(`[Schema] Filtered ${emptyRowGroupCount} fragments with all empty RowGroups (numRows=0)`);
  }
  
  console.log(`[Schema] Grouped ${fragments.length - emptyRowGroupCount} fragments into ${schemaGroups.size} schema groups (using offset metadata)`);
  
  return schemaGroups;
}

/**
 * スキーマグループごとにコンパクション実行
 * 戻り値: { schemaHash: string, fragments: {...}[], outputKeys: string[] }[]
 */
export interface SchemaGroupOutput {
  schemaHash: string;
  fragmentCount: number;
  outputKeys: string[];
  totalOriginalSize: number;
  totalCompactedSize: number;
}

export async function processSchemaGroups(
  bucket: R2Bucket,
  schemaGroups: Map<string, Array<{ key: string; size: number }>>,
  compactionFn: (
    bucket: R2Bucket,
    fragments: Array<{ key: string; size: number }>
  ) => Promise<{ outputKeys: string[]; totalOriginalSize: number; totalCompactedSize: number }>
): Promise<SchemaGroupOutput[]> {
  const results: SchemaGroupOutput[] = [];
  
  for (const [hash, frags] of schemaGroups.entries()) {
    console.log(`[Schema] Processing schema group ${hash}: ${frags.length} fragments`);
    
    const { outputKeys, totalOriginalSize, totalCompactedSize } = await compactionFn(bucket, frags);
    
    results.push({
      schemaHash: hash,
      fragmentCount: frags.length,
      outputKeys,
      totalOriginalSize,
      totalCompactedSize,
    });
  }
  
  return results;
}
