/**
 * Parquet Compaction Engine
 * Handles streaming binary analysis and Row Group compaction
 */

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
 * Parquet footer メタデータを正確にパース
 * Thrift Compact Protocol デコーダー実装
 */
export function parseParquetMetadata(footerData: Uint8Array): RowGroupInfo[] {
  const rowGroups: RowGroupInfo[] = [];
  
  try {
    // Parquet footer の構造：
    // FileMetaData (Thrift compact protocol encoded)
    // 必要なフィールド：
    // - num_row_groups (field 3, int32)
    // - num_rows (field 4, int64)
    // - row_groups (field 5, list of RowGroup)
    
    console.log(`[Parquet.parseParquetMetadata] Starting metadata parse, footerSize=${footerData.length}`);
    console.log(`[Parquet.parseParquetMetadata] Footer first 50 bytes: ${Array.from(footerData.slice(0, 50)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    
    const metadata = parseThriftFileMetadata(footerData, 0);
    
    console.log(`[Parquet.parseParquetMetadata] Parsed metadata: num_row_groups=${metadata.num_row_groups}, row_groups.length=${metadata.row_groups.length}`);
    
    // 各 Row Group をパース
    for (let i = 0; i < metadata.num_row_groups; i++) {
      const rg = metadata.row_groups[i];
      rowGroups.push(rg);
    }
    
    console.log(`[Parquet.parseParquetMetadata] Successfully parsed ${rowGroups.length} Row Groups (expected ${metadata.num_row_groups})`);
    
    if (rowGroups.length === 0) {
      console.warn(`[Parquet.parseParquetMetadata] WARNING: No RowGroups found in metadata. This may indicate a parsing error.`);
      throw new Error(`Parsed 0 RowGroups (expected ${metadata.num_row_groups}). Footer size=${footerData.length}, footer hex=${Array.from(footerData.slice(0, 100)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    }
    
    return rowGroups;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error(`[Parquet.parseParquetMetadata] Failed to parse metadata: ${errorMessage}`);
    console.error(`[Parquet.parseParquetMetadata] Error stack: ${errorStack}`);
    console.error(`[Parquet.parseParquetMetadata] Footer size: ${footerData.length}, first 100 bytes: ${Array.from(footerData.slice(0, 100)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    
    // Fallback: 簡易パース
    console.warn(`[Parquet.parseParquetMetadata] Falling back to estimated RowGroups`);
    return generateEstimatedRowGroups(footerData.length);
  }
}

/**
 * Thrift FileMetaData をパース
 */
function parseThriftFileMetadata(data: Uint8Array, offset: number): {
  num_row_groups: number;
  num_rows: number;
  row_groups: RowGroupInfo[];
} {
  let pos = offset;
  let num_row_groups = 1;
  let num_rows = 0;
  const row_groups: RowGroupInfo[] = [];
  
  const reader = new ThriftCompactReader(data, pos);
  reader.resetFieldId();
  
  console.log(`[Parquet.parseThriftFileMetadata] Starting parse at pos=${pos}, dataLength=${data.length}`);
  
  // FileMetaData 構造体を読む
  while (!reader.isAtEnd()) {
    const fieldInfo = reader.readFieldInfo();
    if (fieldInfo.type === FieldType.STOP) {
      console.log(`[Parquet.parseThriftFileMetadata] Hit STOP byte`);
      break;
    }
    
    console.log(`[Parquet.parseThriftFileMetadata] Field fieldId=${fieldInfo.fieldId}, type=${fieldInfo.type}`);
    
    if (fieldInfo.fieldId === 3 && fieldInfo.type === FieldType.I32) {
      // num_row_groups
      num_row_groups = reader.readI32();
      console.log(`[Parquet.parseThriftFileMetadata] Found num_row_groups=${num_row_groups}`);
    } else if (fieldInfo.fieldId === 4 && fieldInfo.type === FieldType.I64) {
      // num_rows
      num_rows = reader.readI64();
      console.log(`[Parquet.parseThriftFileMetadata] Found num_rows=${num_rows}`);
    } else if (fieldInfo.fieldId === 5 && fieldInfo.type === FieldType.LIST) {
      // row_groups list
      const listInfo = reader.readListInfo();
      console.log(`[Parquet.parseThriftFileMetadata] Found row_groups list with size=${listInfo.size}`);
      for (let i = 0; i < listInfo.size; i++) {
        console.log(`[Parquet.parseThriftFileMetadata] Parsing RowGroup ${i}...`);
        const rg = parseThriftRowGroup(reader, i);
        if (!rg || rg.totalByteSize === undefined || rg.offset === undefined) {
          console.error(`[Parquet.parseThriftFileMetadata] Invalid RowGroup parsed at index ${i}:`, {
            hasRg: !!rg,
            totalByteSize: rg?.totalByteSize,
            offset: rg?.offset,
            numRows: rg?.numRows,
          });
          continue;
        }
        row_groups.push(rg);
      }
    } else {
      reader.skipField(fieldInfo.type);
    }
  }
  
  console.log(`[Parquet.parseThriftFileMetadata] Parse complete. row_groups.length=${row_groups.length}`);
  
  return {
    num_row_groups,
    num_rows,
    row_groups
  };
}

/**
 * Thrift RowGroup をパース
 */
function parseThriftRowGroup(reader: ThriftCompactReader, index: number): RowGroupInfo {
  const columnChunks: ColumnChunkInfo[] = [];
  let totalByteSize: number | undefined;
  let numRows: number | undefined;
  let fileOffset: number | undefined;
  
  const startPos = reader.getPosition();
  reader.resetFieldId();
  
  // RowGroup 構造体を読む
  while (!reader.isAtEnd()) {
    const fieldInfo = reader.readFieldInfo();
    if (fieldInfo.type === FieldType.STOP) break;
    
    if (fieldInfo.fieldId === 1 && fieldInfo.type === FieldType.LIST) {
      // column_chunks
      const listInfo = reader.readListInfo();
      for (let i = 0; i < listInfo.size; i++) {
        const chunk = parseColumnChunk(reader, i);
        columnChunks.push(chunk);
      }
    } else if (fieldInfo.fieldId === 2 && fieldInfo.type === FieldType.I64) {
      // num_rows
      numRows = reader.readI64();
    } else if (fieldInfo.fieldId === 3 && fieldInfo.type === FieldType.I64) {
      // total_byte_size
      totalByteSize = reader.readI64();
    } else if (fieldInfo.fieldId === 4 && fieldInfo.type === FieldType.I64) {
      // file_offset (this is the actual offset in the file)
      fileOffset = reader.readI64();
    } else {
      reader.skipField(fieldInfo.type);
    }
  }
  
  const endPos = reader.getPosition();
  
  // 診断：パースされた値を記録
  console.log(`[Parquet.parseThriftRowGroup] RG${index}: startPos=${startPos}, endPos=${endPos}, bytesRead=${endPos - startPos}`, {
    fileOffset,
    totalByteSize,
    numRows,
    columnChunkCount: columnChunks.length
  });
  
  // fileOffset と totalByteSize は必須
  if (fileOffset === undefined) {
    console.warn(`[Parquet.parseThriftRowGroup] RG${index}: fileOffset is undefined (field 4 not found)`);
  }
  if (totalByteSize === undefined) {
    console.warn(`[Parquet.parseThriftRowGroup] RG${index}: totalByteSize is undefined (field 3 not found)`);
  }
  
  const result: RowGroupInfo = {
    index,
    offset: fileOffset ?? undefined,
    totalByteSize: totalByteSize ?? undefined,
    numRows: numRows ?? 0,
    columnChunks
  };
  
  return result;
}

/**
 * ColumnChunk をパース
 */
function parseColumnChunk(reader: ThriftCompactReader, index: number): ColumnChunkInfo {
  let offset = reader.getPosition();
  let size = 65536;
  
  reader.resetFieldId();
  
  while (!reader.isAtEnd()) {
    const fieldInfo = reader.readFieldInfo();
    if (fieldInfo.type === FieldType.STOP) break;
    
    if (fieldInfo.fieldId === 2 && fieldInfo.type === FieldType.I64) {
      // file_offset
      offset = reader.readI64();
    } else if (fieldInfo.fieldId === 3 && fieldInfo.type === FieldType.STRUCT) {
      // meta_data
      const metaStart = reader.getPosition();
      parseColumnMetaData(reader);
      size = reader.getPosition() - metaStart;
    } else {
      reader.skipField(fieldInfo.type);
    }
  }
  
  return {
    columnIndex: index,
    offset,
    size: size > 0 ? size : 32768,
    type: 'unknown'
  };
}

/**
 * ColumnMetaData をパース（スキップ主目的）
 */
function parseColumnMetaData(reader: ThriftCompactReader): void {
  reader.resetFieldId();
  while (!reader.isAtEnd()) {
    const fieldInfo = reader.readFieldInfo();
    if (fieldInfo.type === FieldType.STOP) break;
    reader.skipField(fieldInfo.type);
  }
}

/**
 * Thrift Compact Protocol のフィールドタイプ
 */
enum FieldType {
  STOP = 0x00,
  BOOL_TRUE = 0x01,
  BOOL_FALSE = 0x02,
  BYTE = 0x03,
  I16 = 0x04,
  I32 = 0x05,
  I64 = 0x06,
  DOUBLE = 0x07,
  BINARY = 0x08,
  LIST = 0x09,
  SET = 0x0a,
  MAP = 0x0b,
  STRUCT = 0x0c
}

/**
 * Thrift Compact Protocol リーダー
 */
class ThriftCompactReader {
  private data: Uint8Array;
  private pos: number;
  private lastFieldId: number = 0;
  
  constructor(data: Uint8Array, startPos: number = 0) {
    this.data = data;
    this.pos = startPos;
  }
  
  isAtEnd(): boolean {
    return this.pos >= this.data.length;
  }
  
  getPosition(): number {
    return this.pos;
  }
  
  readFieldInfo(): { fieldId: number; type: FieldType } {
    if (this.isAtEnd()) return { fieldId: 0, type: FieldType.STOP };
    
    const byte = this.data[this.pos++];
    const type = (byte & 0x0f) as FieldType;
    const delta = (byte >> 4) & 0x0f;
    
    let fieldId: number;
    if (delta === 0) {
      // Field ID follows as a zigzag-encoded i16
      fieldId = this.readI16();
    } else {
      // Field ID is lastFieldId + delta
      fieldId = this.lastFieldId + delta;
    }
    
    // Special case: if type is STOP, don't update lastFieldId
    if (type !== FieldType.STOP) {
      this.lastFieldId = fieldId;
    }
    
    return { fieldId, type };
  }
  
  resetFieldId(): void {
    this.lastFieldId = 0;
  }
  
  readI16(): number {
    const zigzag = this.readVarint();
    return (zigzag >>> 1) ^ -(zigzag & 1);
  }
  
  readI32(): number {
    const zigzag = this.readVarint();
    return (zigzag >>> 1) ^ -(zigzag & 1);
  }
  
  readI64(): number {
    const zigzag = this.readVarintLong();
    return Number((zigzag >> 1n) ^ (-(zigzag & 1n)));
  }
  
  readZigZagVarint(): number {
    const zigzag = this.readVarint();
    return (zigzag >>> 1) ^ -(zigzag & 1);
  }
  
  readVarint(): number {
    let result = 0;
    let shift = 0;
    
    while (!this.isAtEnd()) {
      const byte = this.data[this.pos++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    
    return result;
  }
  
  readVarintLong(): bigint {
    let result = 0n;
    let shift = 0n;
    
    while (!this.isAtEnd()) {
      const byte = BigInt(this.data[this.pos++]);
      result |= (byte & 0x7fn) << shift;
      if ((byte & 0x80n) === 0n) break;
      shift += 7n;
    }
    
    return result;
  }
  
  readListInfo(): { elementType: FieldType; size: number } {
    const byte = this.data[this.pos++];
    const sizeType = (byte >> 4) & 0x0f;
    const elementType = (byte & 0x0f) as FieldType;
    
    let size: number;
    if (sizeType === 0x0f) {
      size = this.readVarint();
    } else {
      size = sizeType;
    }
    
    return { elementType, size };
  }
  
  skipField(type: FieldType): void {
    switch (type) {
      case FieldType.BOOL_TRUE:
      case FieldType.BOOL_FALSE:
      case FieldType.BYTE:
        this.pos += 1;
        break;
      case FieldType.I16:
        this.pos += 2;
        break;
      case FieldType.I32:
      case FieldType.DOUBLE:
        this.pos += 4;
        break;
      case FieldType.I64:
        this.pos += 8;
        break;
      case FieldType.BINARY:
        const strLen = this.readVarint();
        this.pos += strLen;
        break;
      case FieldType.LIST:
      case FieldType.SET:
        const listInfo = this.readListInfo();
        for (let i = 0; i < listInfo.size; i++) {
          this.skipField(listInfo.elementType);
        }
        break;
      case FieldType.MAP:
        // Map header
        const mapHeader = this.readVarint();
        const size = mapHeader & 0x0fffffff;
        const keyType = ((mapHeader >>> 4) & 0x0f) as FieldType;
        const valType = (mapHeader & 0x0f) as FieldType;
        
        for (let i = 0; i < size; i++) {
          this.skipField(keyType);
          this.skipField(valType);
        }
        break;
      case FieldType.STRUCT:
        const prevFieldId = this.lastFieldId;
        this.resetFieldId();
        while (!this.isAtEnd()) {
          const fieldInfo = this.readFieldInfo();
          if (fieldInfo.type === FieldType.STOP) break;
          this.skipField(fieldInfo.type);
        }
        this.lastFieldId = prevFieldId;
        break;
    }
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
