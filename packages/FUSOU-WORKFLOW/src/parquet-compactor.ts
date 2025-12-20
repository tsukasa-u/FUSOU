/**
 * Parquet Compaction Engine
 * Handles streaming binary analysis and Row Group compaction
 */

import { parquetMetadata, type ColumnMetaData } from 'hyparquet';

/**
 * Safe bigint to number conversion with overflow validation
 * Returns undefined if value exceeds Number.MAX_SAFE_INTEGER
 */
function safeNumberFromBigInt(value: bigint | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    console.warn(`[parquet-compactor] BigInt value ${value} exceeds MAX_SAFE_INTEGER, precision may be lost`);
  }
  return Number(value);
}

/**
 * Parquet Row Group 情報
 */
export interface RowGroupInfo {
  index: number;
  offset: number | undefined;
  totalByteSize: number | undefined;
  numRows: number;
  columnChunks: ColumnChunkInfo[];
}

export interface ColumnChunkInfo {
  columnIndex: number;
  offset: number;
  size: number;
  type: string;
}

/**
 * Parquet ファイル全体から hyparquet でメタデータをパース
 */
export function parseParquetMetadataFromFullFile(fileData: Uint8Array): RowGroupInfo[] {
  try {
    // Footer のオフセットを計算
    const view = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
    const footerMagic = view.getUint32(fileData.byteLength - 4, true);
    
    if (footerMagic !== 0x31524150) { // "PAR1"
      throw new Error('Invalid Parquet file: footer != PAR1');
    }
    
    const metadataLength = view.getUint32(fileData.byteLength - 8, true);
    
    // Footer メタデータ領域のみを抽出（末尾の8バイトは除外）
    const footerStart = fileData.byteLength - metadataLength - 8;
    const footerEnd = footerStart + metadataLength;
    
    // Validate footer region is within bounds
    if (footerStart < 0 || footerEnd > fileData.byteLength || metadataLength <= 0) {
      throw new Error(`Invalid footer region: start=${footerStart}, end=${footerEnd}, length=${metadataLength}`);
    }
    
    const footerBuffer = fileData.buffer.slice(
      fileData.byteOffset + footerStart,
      fileData.byteOffset + footerEnd
    ) as ArrayBuffer;
    
    // hyparquet の parquetMetadata を使用
    const metadata = parquetMetadata(footerBuffer as ArrayBuffer);
    
    // RowGroup 情報を抽出
    const rowGroups: RowGroupInfo[] = [];
    
    if (metadata.row_groups) {
      for (let i = 0; i < metadata.row_groups.length; i++) {
        const rg = metadata.row_groups[i];

        const columnChunks: ColumnChunkInfo[] = [];
        let rgStart = Number.POSITIVE_INFINITY;
        let rgEnd = 0;

        if (rg.columns && rg.columns.length > 0) {
          for (let colIdx = 0; colIdx < rg.columns.length; colIdx++) {
            const col = rg.columns[colIdx];
            const md: Partial<ColumnMetaData> = col.meta_data ?? {};

            // hyparquet uses bigint for offset fields - use safe conversion
            const starts: number[] = [];
            const dictOffset = safeNumberFromBigInt(md.dictionary_page_offset);
            const indexOffset = safeNumberFromBigInt(md.index_page_offset);
            const dataOffset = safeNumberFromBigInt(md.data_page_offset);
            if (dictOffset !== undefined) starts.push(dictOffset);
            if (indexOffset !== undefined) starts.push(indexOffset);
            if (dataOffset !== undefined) starts.push(dataOffset);

            // Fallback to col.file_offset, then undefined (not 0!) if all offsets are missing
            const colStartRaw = starts.length > 0 
              ? Math.min(...starts) 
              : safeNumberFromBigInt(col.file_offset);
            const colSizeCompressed = safeNumberFromBigInt(md.total_compressed_size);
            
            // Skip this column chunk if essential metadata is missing or invalid
            // colSizeCompressed must be > 0 (size 0 is invalid, would indicate missing data)
            // colStart must be >= 0 (negative offsets are invalid)
            if (colStartRaw === undefined || colSizeCompressed === undefined || colSizeCompressed <= 0 || colStartRaw < 0) {
              continue;
            }
            
            const colStart = colStartRaw;
            const colEnd = colStart + colSizeCompressed;
            
            // Validate colEnd doesn't overflow
            if (colEnd > Number.MAX_SAFE_INTEGER) {
              console.warn(`[parquet-compactor] ColumnChunk end offset ${colEnd} exceeds MAX_SAFE_INTEGER, skipping`);
              continue;
            }

            rgStart = Math.min(rgStart, colStart);
            rgEnd = Math.max(rgEnd, colEnd);

            columnChunks.push({
              columnIndex: colIdx,
              offset: colStart,
              size: colSizeCompressed,
              type: md.type !== undefined ? String(md.type) : 'unknown',
            });
          }
        }

        // Prefer row-group level metadata if available (hyparquet uses bigint for these fields)
        const rgLevelStart = safeNumberFromBigInt(rg.file_offset);
        const rgLevelSize = safeNumberFromBigInt(rg.total_byte_size);
        
        // Validate row-group level metadata
        // If RG-level metadata is present, it must be valid (non-negative start, positive size)
        let finalOffset: number | undefined;
        let finalSize: number | undefined;
        
        if (rgLevelStart !== undefined && rgLevelSize !== undefined && rgLevelStart >= 0 && rgLevelSize > 0) {
          // RG-level metadata is valid
          finalOffset = rgLevelStart;
          finalSize = rgLevelSize;
        } else if (Number.isFinite(rgStart) && rgEnd > rgStart) {
          // Fall back to column-level computed metadata
          finalOffset = rgStart;
          finalSize = rgEnd - rgStart;
        }
        // else: both metadata sources are invalid, leave as undefined

        const rowGroupInfo: RowGroupInfo = {
          index: i,
          offset: finalOffset,
          totalByteSize: finalSize,
          numRows: Math.max(0, safeNumberFromBigInt(rg.num_rows) ?? 0),  // Ensure non-negative
          columnChunks,
        };

        rowGroups.push(rowGroupInfo);
      }
    }
    
    if (rowGroups.length === 0) {
      // Return empty array instead of throwing - allows empty tables to be filtered later
      return [];
    }
    
    return rowGroups;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error(`[Parquet.parseFromFullFile] Failed: ${errorMessage}`);
    console.error(`[Parquet.parseFromFullFile] Error stack: ${errorStack}`);
    
    // CRITICAL: Do NOT use generateEstimatedRowGroups as it produces completely wrong offsets
    // Instead, treat this as an unparseable file and throw error to prevent silent corruption
    console.error(`[Parquet.parseFromFullFile] CRITICAL: Unable to parse Parquet metadata. Refusing to generate fake RowGroups.`);
    console.error(`[Parquet.parseFromFullFile] File size: ${fileData.length} bytes, Footer attempt failed.`);
    throw new Error(`[Parquet.parseFromFullFile] Unable to parse Parquet file (${fileData.length} bytes): ${errorMessage}`);
  }
}

/**
 * フッター（metadata + 8バイトの長さと"PAR1"）だけからメタデータをパース
 * 大容量ファイルでもフッターのみのRange GETで対応可能
 */
export function parseParquetMetadataFromFooterBuffer(footerBuffer: Uint8Array): RowGroupInfo[] {
  try {
    // Validate input buffer
    if (!footerBuffer || footerBuffer.byteLength < 8) {
      console.warn(`[Parquet.parseFromFooterBuffer] Invalid footer buffer: length=${footerBuffer?.byteLength ?? 0}`);
      return [];
    }
    
    // hyparquet はフッターメタデータのみを期待するため、末尾の8バイト（サイズ+魔法）を除外
    const totalLen = footerBuffer.byteLength;
    const metaLen = totalLen >= 8 ? totalLen - 8 : totalLen;
    const ab = footerBuffer.buffer.slice(
      footerBuffer.byteOffset,
      footerBuffer.byteOffset + metaLen
    ) as ArrayBuffer;
    const metadata = parquetMetadata(ab);

    const rowGroups: RowGroupInfo[] = [];
    if (metadata.row_groups) {
      for (let i = 0; i < metadata.row_groups.length; i++) {
        const rg = metadata.row_groups[i];
        const columnChunks: ColumnChunkInfo[] = [];
        let rgStart = Number.POSITIVE_INFINITY;
        let rgEnd = 0;

        if (rg.columns && rg.columns.length > 0) {
          for (let colIdx = 0; colIdx < rg.columns.length; colIdx++) {
            const col = rg.columns[colIdx];
            const md: Partial<ColumnMetaData> = col.meta_data ?? {};

            // hyparquet uses bigint for offset fields - use safe conversion
            const starts: number[] = [];
            const dictOffset = safeNumberFromBigInt(md.dictionary_page_offset);
            const indexOffset = safeNumberFromBigInt(md.index_page_offset);
            const dataOffset = safeNumberFromBigInt(md.data_page_offset);
            if (dictOffset !== undefined) starts.push(dictOffset);
            if (indexOffset !== undefined) starts.push(indexOffset);
            if (dataOffset !== undefined) starts.push(dataOffset);

            // Fallback to col.file_offset, then undefined (not 0!) if all offsets are missing
            const colStartRaw = starts.length > 0 
              ? Math.min(...starts) 
              : safeNumberFromBigInt(col.file_offset);
            const colSizeCompressed = safeNumberFromBigInt(md.total_compressed_size);
            
            // Skip this column chunk if essential metadata is missing or invalid
            // colSizeCompressed must be > 0 (size 0 is invalid, would indicate missing data)
            // colStart must be >= 0 (negative offsets are invalid)
            if (colStartRaw === undefined || colSizeCompressed === undefined || colSizeCompressed <= 0 || colStartRaw < 0) {
              continue;
            }
            
            const colStart = colStartRaw;
            const colEnd = colStart + colSizeCompressed;
            
            // Validate colEnd doesn't overflow
            if (colEnd > Number.MAX_SAFE_INTEGER) {
              console.warn(`[parquet-compactor] ColumnChunk end offset ${colEnd} exceeds MAX_SAFE_INTEGER, skipping`);
              continue;
            }

            rgStart = Math.min(rgStart, colStart);
            rgEnd = Math.max(rgEnd, colEnd);

            columnChunks.push({
              columnIndex: colIdx,
              offset: colStart,
              size: colSizeCompressed,
              type: md.type !== undefined ? String(md.type) : 'unknown',
            });
          }
        }
        // Prefer row-group level metadata if available (hyparquet uses bigint for these fields)
        const rgLevelStart = safeNumberFromBigInt(rg.file_offset);
        const rgLevelSize = safeNumberFromBigInt(rg.total_byte_size);
        
        // Validate row-group level metadata
        // If RG-level metadata is present, it must be valid (non-negative start, positive size)
        let finalOffset: number | undefined;
        let finalSize: number | undefined;
        
        if (rgLevelStart !== undefined && rgLevelSize !== undefined && rgLevelStart >= 0 && rgLevelSize > 0) {
          // RG-level metadata is valid
          finalOffset = rgLevelStart;
          finalSize = rgLevelSize;
        } else if (Number.isFinite(rgStart) && rgEnd > rgStart) {
          // Fall back to column-level computed metadata
          finalOffset = rgStart;
          finalSize = rgEnd - rgStart;
        }
        // else: both metadata sources are invalid, leave as undefined

        rowGroups.push({
          index: i,
          offset: finalOffset,
          totalByteSize: finalSize,
          numRows: Math.max(0, safeNumberFromBigInt(rg.num_rows) ?? 0),  // Ensure non-negative
          columnChunks,
        });
      }
    }

    return rowGroups;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Parquet.parseFromFooter] Failed: ${errorMessage}`);
    return [];
  }
}

// Backward-compatible alias used by legacy merge path
export function parseParquetMetadata(footerBuffer: Uint8Array): RowGroupInfo[] {
  return parseParquetMetadataFromFooterBuffer(footerBuffer);
}

/**
 * Parquet footer メタデータを hyparquet でパース
 * 
 * NOTE: hyparquet の parquetMetadata は完全な Parquet ファイルを期待するため、
 * この関数では簡易的なフォールバック処理を行います。
 * 推奨：parseParquetMetadataFromFullFile() を使用してください。
 */
// Legacy stub removed: use parseParquetMetadataFromFooterBuffer or parseParquetMetadataFromFullFile instead
/**
 * 推定 Row Group を生成（フォールバック）
 */
function generateEstimatedRowGroups(footerSize: number): RowGroupInfo[] {
  const estimatedCount = Math.max(1, Math.floor(footerSize / 300));
  const rowGroups: RowGroupInfo[] = [];
  
  for (let i = 0; i < estimatedCount; i++) {
    rowGroups.push({
      index: i,
      offset: i * (10 * 1024 * 1024),
      totalByteSize: 10 * 1024 * 1024,
      numRows: 100000,
      columnChunks: []
    });
  }
  
  return rowGroups;
}

/**
 * 断片化された Row Group をコンパクション
 */
export async function compactFragmentedRowGroups(
  bucket: R2Bucket,
  bucketKey: string,
  footerStart: number,
  rowGroups: RowGroupInfo[],
  fragmentedIndices: number[],
  readRange: (bucket: R2Bucket, key: string, offset: number, length: number) => Promise<Uint8Array>
): Promise<{ newFileSize: number; newRowGroupCount: number; etag: string }> {
  // Step 1: 健全な Row Group を特定
  const healthyIndices = rowGroups
    .map((_, idx) => idx)
    .filter(idx => !fragmentedIndices.includes(idx));
  
  const healthyRowGroups = rowGroups.filter((_, idx) => healthyIndices.includes(idx));
  const fragmentedRowGroups = rowGroups.filter((_, idx) => fragmentedIndices.includes(idx));
  
  console.log(`[Parquet] ${healthyIndices.length} healthy RG, ${fragmentedIndices.length} fragmented`);
  
  // Step 2: 断片化 Row Group のデータを読み込み
  console.log(`[Parquet] Reading fragmented Row Groups...`);
  
  const fragmentedData: Uint8Array[] = [];
  let totalFragmentedSize = 0;
  
  for (const rg of fragmentedRowGroups) {
    try {
      if (!rg || rg.totalByteSize === undefined || rg.offset === undefined) {
        console.error(`[Parquet] Invalid RowGroup at index ${rg?.index || 'unknown'}:`, {
          hasRg: !!rg,
          totalByteSize: rg?.totalByteSize,
          offset: rg?.offset,
          index: rg?.index
        });
        continue;
      }
      // 読み取り範囲の安全チェック（フッター開始位置を上限としてクランプ）
      const safeOffset = Math.max(0, Math.min(rg.offset, footerStart));
      const maxReadable = footerStart - safeOffset;
      const requestedSize = rg.totalByteSize;
      const safeSize = Math.max(0, Math.min(requestedSize, maxReadable));

      if (safeSize <= 0) {
        console.warn(`[Parquet] Skipping RG${rg.index}: out-of-bounds range`, {
          offset: rg.offset,
          totalByteSize: rg.totalByteSize,
          footerStart,
          safeOffset,
          safeSize,
        });
        continue;
      }

      const data = await readRange(bucket, bucketKey, safeOffset, safeSize);
      fragmentedData.push(data);
      totalFragmentedSize += safeSize;
      console.log(`[Parquet] Read RG${rg.index}: ${safeSize} bytes (requested ${requestedSize})`);
    } catch (error) {
      console.error(`[Parquet] Failed to read RG${rg?.index || 'unknown'}: ${error}`);
    }
  }
  
  if (fragmentedData.length === 0) {
    console.log(`[Parquet] No fragmented Row Groups to process`);
    return {
      newFileSize: footerStart,
      newRowGroupCount: rowGroups.length,
      etag: ''
    };
  }
  
  // Step 3: マージされた Row Group を構築
  console.log(`[Parquet] Building merged Row Group...`);
  
  const mergedRowGroup: RowGroupInfo = {
    index: healthyRowGroups.length,
    offset: 0, // 実際のオフセットは後で計算
    totalByteSize: totalFragmentedSize,
    numRows: fragmentedRowGroups.reduce((sum, rg) => sum + rg.numRows, 0),
    columnChunks: fragmentedRowGroups.flatMap(rg => rg.columnChunks)
  };
  
  // Step 4: R2 にコンパクテッドファイルを書き込む
  console.log(`[Parquet] Writing compacted file to R2...`);
  
  const { writeCompactedParquetFile } = await import('./parquet-writer');
  
  const writeResult = await writeCompactedParquetFile(
    bucket,
    bucketKey,
    healthyRowGroups,
    mergedRowGroup,
    readRange
  );
  
  const newRowGroupCount = healthyRowGroups.length + 1;
  
  console.log(`[Parquet] File compaction complete`);
  console.log(`[Parquet] Original file size: ${footerStart} bytes`);
  console.log(`[Parquet] New file size: ${writeResult.newFileSize} bytes (saved ${footerStart - writeResult.newFileSize} bytes, ${((footerStart - writeResult.newFileSize) / footerStart * 100).toFixed(1)}%)`);
  console.log(`[Parquet] Row Groups: ${rowGroups.length} → ${newRowGroupCount}`);
  console.log(`[Parquet] ETag: ${writeResult.etag}`);
  
  return {
    newFileSize: writeResult.newFileSize,
    newRowGroupCount,
    etag: writeResult.etag
  };
}
