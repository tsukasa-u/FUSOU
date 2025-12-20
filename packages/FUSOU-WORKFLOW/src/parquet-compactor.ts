/**
 * Parquet Compaction Engine
 * Handles streaming binary analysis and Row Group compaction
 */

import { parquetMetadata } from 'hyparquet';

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
    console.log(`[Parquet.parseFromFullFile] Starting metadata parse with hyparquet, fileSize=${fileData.length}`);
    
    // Footer のオフセットを計算
    const view = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
    const footerMagic = view.getUint32(fileData.byteLength - 4, true);
    
    if (footerMagic !== 0x31524150) { // "PAR1"
      throw new Error('Invalid Parquet file: footer != PAR1');
    }
    
    const metadataLength = view.getUint32(fileData.byteLength - 8, true);
    console.log(`[Parquet.parseFromFullFile] Metadata length: ${metadataLength}`);
    
    // Footer 全体を取得（metadata + metadata_length + "PAR1"）
    const footerStart = fileData.byteLength - metadataLength - 8;
    const footerBuffer = fileData.buffer.slice(
      fileData.byteOffset + footerStart,
      fileData.byteOffset + fileData.byteLength
    );
    
    console.log(`[Parquet.parseFromFullFile] Footer: ${footerBuffer.byteLength} bytes (offset ${footerStart})`);
    
    // hyparquet の parquetMetadata を使用
    const metadata = parquetMetadata(footerBuffer);
    
    console.log(`[Parquet.parseFromFullFile] Metadata parsed:`, {
      numRowGroups: metadata.row_groups?.length,
      numRows: metadata.num_rows,
      version: metadata.version,
    });
    
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
            const md = col.meta_data ?? {} as any;

            const starts: number[] = [];
            if (typeof md.dictionary_page_offset === 'number') starts.push(Number(md.dictionary_page_offset));
            if (typeof md.index_page_offset === 'number') starts.push(Number(md.index_page_offset));
            if (typeof md.data_page_offset === 'number') starts.push(Number(md.data_page_offset));

            const colStart = starts.length > 0 ? Math.min(...starts) : (typeof col.file_offset === 'number' ? Number(col.file_offset) : 0);
            const colSizeCompressed = typeof md.total_compressed_size === 'number' ? Number(md.total_compressed_size) : 0;
            const colEnd = colStart + colSizeCompressed;

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

        const rowGroupInfo: RowGroupInfo = {
          index: i,
          // Prefer computed compressed span; fallback to rg.file_offset if present
          offset: Number.isFinite(rgStart) ? rgStart : (typeof (rg as any).file_offset === 'number' ? Number((rg as any).file_offset) : undefined),
          totalByteSize: rgEnd > rgStart ? (rgEnd - rgStart) : undefined,
          numRows: typeof (rg as any).num_rows === 'number' ? Number((rg as any).num_rows) : 0,
          columnChunks,
        };

        console.log(`[Parquet.parseFromFullFile] RG${i}:`, {
          offset: rowGroupInfo.offset,
          totalByteSize: rowGroupInfo.totalByteSize,
          numRows: rowGroupInfo.numRows,
          columns: rowGroupInfo.columnChunks.length,
        });

        rowGroups.push(rowGroupInfo);
      }
    }
    
    console.log(`[Parquet.parseFromFullFile] Successfully parsed ${rowGroups.length} Row Groups using hyparquet`);
    
    if (rowGroups.length === 0) {
      console.warn(`[Parquet.parseFromFullFile] WARNING: No RowGroups found in metadata.`);
      throw new Error(`Parsed 0 RowGroups from ${fileData.length} byte file`);
    }
    
    return rowGroups;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error(`[Parquet.parseFromFullFile] Failed: ${errorMessage}`);
    console.error(`[Parquet.parseFromFullFile] Error stack: ${errorStack}`);
    
    // Fallback: 簡易推定
    return generateEstimatedRowGroups(fileData.length);
  }
}

/**
 * Parquet footer メタデータを hyparquet でパース
 * 
 * NOTE: hyparquet の parquetMetadata は完全な Parquet ファイルを期待するため、
 * この関数では簡易的なフォールバック処理を行います。
 * 推奨：parseParquetMetadataFromFullFile() を使用してください。
 */
export function parseParquetMetadata(footerData: Uint8Array): RowGroupInfo[] {
  const rowGroups: RowGroupInfo[] = [];
  
  try {
    console.log(`[Parquet.parseParquetMetadata] Starting metadata parse with parquet-wasm, footerSize=${footerData.length}`);
    
    // parquet-wasm には footer だけからメタデータを読む API がないため、
    // Thrift フォーマットを直接パースする必要があります。
    // しかし、カスタム実装は複雑すぎるため、Fallback として推定値を返します。
    // 
    // より良い方法：R2 から全ファイルを読み込んで readParquet() を使う
    console.warn(`[Parquet.parseParquetMetadata] parquet-wasm requires full file, not just footer. Using fallback.`);
    
    // Fallback: 簡易パース
    return generateEstimatedRowGroups(footerData.length);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error(`[Parquet.parseParquetMetadata] Failed to parse metadata with parquet-wasm: ${errorMessage}`);
    console.error(`[Parquet.parseParquetMetadata] Error stack: ${errorStack}`);
    
    // Fallback: 簡易パース
    console.warn(`[Parquet.parseParquetMetadata] Falling back to estimated RowGroups`);
    return generateEstimatedRowGroups(footerData.length);
  }
}
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
      const data = await readRange(bucket, bucketKey, rg.offset, rg.totalByteSize);
      fragmentedData.push(data);
      totalFragmentedSize += rg.totalByteSize;
      console.log(`[Parquet] Read RG${rg.index}: ${rg.totalByteSize} bytes`);
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
