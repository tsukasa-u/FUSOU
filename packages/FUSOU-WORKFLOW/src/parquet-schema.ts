/**
 * Parquetスキーマ指紋によるグルーピング
 * 異スキーマ混在を自動分離
 */

import { parseParquetMetadata } from './parquet-compactor';

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
  
  return extractSchemaFingerprintFromData(footerData);
}

/**
 * ArrayBufferから直接スキーマ指紋を生成（抽出済みデータ用）
 */
export async function extractSchemaFingerprintFromData(
  parquetData: ArrayBuffer | Uint8Array
): Promise<SchemaFingerprint> {
  const data = parquetData instanceof Uint8Array ? parquetData : new Uint8Array(parquetData);
  
  // Footer読み取り（末尾8バイト→size→footer本体）
  if (data.length < 12) {
    throw new Error('Invalid Parquet file: too small');
  }
  
  const tailBuf = data.slice(-8);
  const footerSizeView = new DataView(tailBuf.buffer, tailBuf.byteOffset, 4);
  const footerSize = footerSizeView.getUint32(0, true);
  
  if (data.length < 8 + footerSize) {
    throw new Error('Invalid Parquet file: footer size mismatch');
  }
  
  const footerStart = data.length - 8 - footerSize;
  const footerData = data.slice(footerStart, footerStart + footerSize);
  
  // スキーマ情報を抽出（簡易版: Row Group最初のColumn Chunkから推定）
  const rowGroups = parseParquetMetadata(footerData);
  
  if (rowGroups.length === 0 || rowGroups[0].columnChunks.length === 0) {
    // スキーマなし（エラー扱い）
    return {
      hash: 'unknown',
      numColumns: 0,
      columnNames: [],
      columnTypes: [],
    };
  }
  
  // Column数と型リストを抽出
  const firstRg = rowGroups[0];
  const numColumns = firstRg.columnChunks.length;
  const columnTypes = firstRg.columnChunks.map((cc) => cc.type);
  
  // Column名は通常footerのSchemaElementから取得するが、簡易実装では型のみでハッシュ
  const columnNames = firstRg.columnChunks.map((cc, i) => `col_${i}`);
  
  // 指紋ハッシュ生成（シンプルな文字列連結→ハッシュ化）
  const schemaStr = `cols:${numColumns}|types:${columnTypes.join(',')}`;
  const hash = await simpleHash(schemaStr);
  
  return {
    hash,
    numColumns,
    columnNames,
    columnTypes,
  };
}

/**
 * Parquetフッターからスキーマ指紋を生成（旧実装 - 後方互換性のため残す）
 */
async function _extractSchemaFingerprintLegacy(
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
  
  // スキーマ情報を抽出（簡易版: Row Group最初のColumn Chunkから推定）
  const rowGroups = parseParquetMetadata(footerData);
  
  if (rowGroups.length === 0 || rowGroups[0].columnChunks.length === 0) {
    // スキーマなし（エラー扱い）
    return {
      hash: 'unknown',
      numColumns: 0,
      columnNames: [],
      columnTypes: [],
    };
  }
  
  // Column数と型リストを抽出
  const firstRg = rowGroups[0];
  const numColumns = firstRg.columnChunks.length;
  const columnTypes = firstRg.columnChunks.map((cc) => cc.type);
  
  // Column名は通常footerのSchemaElementから取得するが、簡易実装では型のみでハッシュ
  const columnNames = firstRg.columnChunks.map((cc, i) => `col_${i}`);
  
  // 指紋ハッシュ生成（シンプルな文字列連結→ハッシュ化）
  const schemaStr = `cols:${numColumns}|types:${columnTypes.join(',')}`;
  const hash = await simpleHash(schemaStr);
  
  return {
    hash,
    numColumns,
    columnNames,
    columnTypes,
  };
}

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
        try {
          const fingerprint = await extractSchemaFingerprint(bucket, frag.key);
          return { frag, fingerprint };
        } catch (error) {
          console.warn(`[Schema] Failed to extract schema from ${frag.key}: ${error}`);
          return { frag, fingerprint: { hash: 'error', numColumns: 0, columnNames: [], columnTypes: [] } };
        }
      })
    );
    
    batchResults.forEach(({ frag, fingerprint }) => {
      const hash = fingerprint.hash;
      // Skip files with error or unknown schema
      if (hash === 'error') {
        console.warn(`[Schema] Skipping fragment with extraction error: ${frag.key}`);
        return;
      }
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
        try {
          const fingerprint = await extractSchemaFingerprintFromData(frag.data);
          return { frag, fingerprint };
        } catch (error) {
          console.warn(`[Schema] Failed to extract schema from ${frag.key}: ${error}`);
          return { frag, fingerprint: { hash: 'error', numColumns: 0, columnNames: [], columnTypes: [] } };
        }
      })
    );
    
    batchResults.forEach(({ frag, fingerprint }) => {
      const hash = fingerprint.hash;
      // Skip files with error or unknown schema
      if (hash === 'error') {
        console.warn(`[Schema] Skipping fragment with extraction error: ${frag.key}`);
        return;
      }
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
