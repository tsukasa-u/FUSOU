/**
 * Parquet ファイル書き込みエンジン
 * 圧縮されたファイルを R2 に書き込む
 */

import { RowGroupInfo, ColumnChunkInfo } from './parquet-compactor';

/**
 * マージされた Row Group の情報
 */
export interface MergedRowGroup extends RowGroupInfo {
  mergedFrom?: number[]; // どの Row Group インデックスをマージしたか
}

/**
 * Parquet ファイルを R2 に書き込む
 */
export async function writeCompactedParquetFile(
  bucket: R2Bucket,
  bucketKey: string,
  healthyRowGroups: RowGroupInfo[],
  mergedRowGroup: MergedRowGroup,
  readRange: (bucket: R2Bucket, key: string, offset: number, length: number) => Promise<Uint8Array>
): Promise<{ newFileSize: number; etag: string }> {
  console.log(`[Parquet Writer] Starting file write for ${bucketKey}`);

  // Step 1: すべての data を集める
  console.log(`[Parquet Writer] Collecting data from ${healthyRowGroups.length} healthy RG + 1 merged RG`);

  const dataChunks: Uint8Array[] = [];
  let totalDataSize = 0;

  // Healthy Row Groups のデータを読み込み
  for (const rg of healthyRowGroups) {
    try {
      const data = await readRange(bucket, bucketKey, rg.offset, rg.totalByteSize);
      dataChunks.push(data);
      totalDataSize += rg.totalByteSize;
      console.log(`[Parquet Writer] Loaded healthy RG${rg.index}: ${rg.totalByteSize} bytes`);
    } catch (error) {
      console.error(`[Parquet Writer] Failed to load healthy RG${rg.index}: ${error}`);
      throw error;
    }
  }

  // Merged Row Group のデータを読み込み
  try {
    const data = await readRange(bucket, bucketKey, mergedRowGroup.offset, mergedRowGroup.totalByteSize);
    dataChunks.push(data);
    totalDataSize += mergedRowGroup.totalByteSize;
    console.log(`[Parquet Writer] Loaded merged RG: ${mergedRowGroup.totalByteSize} bytes`);
  } catch (error) {
    console.error(`[Parquet Writer] Failed to load merged RG: ${error}`);
    throw error;
  }

  // Step 2: Footer メタデータを生成
  console.log(`[Parquet Writer] Generating footer metadata`);

  const newRowGroups = [...healthyRowGroups, mergedRowGroup];
  const footerData = generateParquetFooter(newRowGroups);

  console.log(`[Parquet Writer] Footer size: ${footerData.length} bytes`);

  // Step 3: ファイルを組み立てる
  console.log(`[Parquet Writer] Assembling file structure`);

  // Parquet ファイル構造：
  // - Data (Row Group 0 data)
  // - Data (Row Group 1 data)
  // - ...
  // - Footer metadata
  // - Footer size (4 bytes, little-endian)
  // - Magic "PAR1" (4 bytes)

  const footerSizeBuffer = new ArrayBuffer(4);
  const footerSizeView = new DataView(footerSizeBuffer);
  footerSizeView.setUint32(0, footerData.length, true); // little-endian

  const magicBuffer = new TextEncoder().encode('PAR1');

  // すべてのデータを結合
  const totalFileSize = totalDataSize + footerData.length + 4 + 4; // data + footer + footerSize + magic
  const fileBuffer = new Uint8Array(totalFileSize);

  let offset = 0;

  // データを書き込み
  for (const chunk of dataChunks) {
    fileBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  // Footer を書き込み
  fileBuffer.set(footerData, offset);
  offset += footerData.length;

  // Footer size を書き込み
  fileBuffer.set(new Uint8Array(footerSizeBuffer), offset);
  offset += 4;

  // Magic number を書き込み
  fileBuffer.set(magicBuffer, offset);
  offset += 4;

  console.log(`[Parquet Writer] File assembled: ${totalFileSize} bytes`);

  // Step 4: R2 に書き込む
  console.log(`[Parquet Writer] Uploading to R2: ${bucketKey}`);

  const uploadResult = await bucket.put(bucketKey, fileBuffer, {
    httpMetadata: {
      contentType: 'application/octet-stream',
      contentEncoding: 'gzip',
    },
    customMetadata: {
      'compacted': 'true',
      'compaction_timestamp': new Date().toISOString(),
      'original_row_groups': String(healthyRowGroups.length + 1),
      'new_row_groups': String(newRowGroups.length),
    },
  });

  console.log(`[Parquet Writer] File uploaded successfully`);
  console.log(`[Parquet Writer] ETag: ${uploadResult.etag}`);
  console.log(`[Parquet Writer] New file size: ${totalFileSize} bytes`);

  return {
    newFileSize: totalFileSize,
    etag: uploadResult.etag,
  };
}

/**
 * Parquet footer メタデータを生成（Thrift compact protocol）
 * 
 * FileMetaData structure (Thrift):
 * - version (field 1, i32)
 * - schema (field 2, list of SchemaElement)
 * - num_rows (field 4, i64)
 * - row_groups (field 5, list of RowGroup)
 * - created_by (field 6, string)
 */
function generateParquetFooter(rowGroups: (RowGroupInfo | MergedRowGroup)[]): Uint8Array {
  const writer = new ThriftCompactWriter();

  // Version: 1
  writer.writeField(1, FieldType.I32);
  writer.writeI32(1);

  // Schema: minimal (skip for now, use existing)
  // In a real implementation, we'd preserve the original schema

  // num_rows: sum of all row groups
  const totalRows = rowGroups.reduce((sum, rg) => sum + rg.numRows, 0);
  writer.writeField(4, FieldType.I64);
  writer.writeI64(totalRows);

  // row_groups: list of RowGroup
  writer.writeField(5, FieldType.LIST);
  writer.writeListHeader(rowGroups.length, FieldType.STRUCT);

  for (const rg of rowGroups) {
    writeRowGroup(writer, rg);
  }

  // created_by: "FUSOU Compaction Engine"
  writer.writeField(6, FieldType.BINARY);
  const createdByBytes = new TextEncoder().encode('FUSOU Compaction Engine v1.0');
  writer.writeVarint(createdByBytes.length);
  writer.writeBytes(createdByBytes);

  // Stop field
  writer.writeStop();

  return writer.getBuffer();
}

/**
 * Row Group を Thrift で書き込む
 */
function writeRowGroup(writer: ThriftCompactWriter, rg: RowGroupInfo | MergedRowGroup): void {
  // RowGroup structure:
  // - columns (field 1, list of ColumnChunk)
  // - num_rows (field 2, i64)
  // - total_byte_size (field 3, i64)

  writer.writeField(1, FieldType.LIST);
  writer.writeListHeader(rg.columnChunks.length, FieldType.STRUCT);

  for (const chunk of rg.columnChunks) {
    writeColumnChunk(writer, chunk);
  }

  // num_rows
  writer.writeField(2, FieldType.I64);
  writer.writeI64(rg.numRows);

  // total_byte_size
  writer.writeField(3, FieldType.I64);
  writer.writeI64(rg.totalByteSize);

  // Stop field
  writer.writeStop();
}

/**
 * Column Chunk を Thrift で書き込む
 */
function writeColumnChunk(writer: ThriftCompactWriter, chunk: ColumnChunkInfo): void {
  // ColumnChunk structure (simplified):
  // - file_offset (field 2, i64)
  // - metadata (field 3, ColumnMetaData)

  writer.writeField(2, FieldType.I64);
  writer.writeI64(chunk.offset);

  // Skip metadata for now (would need full parsing/reconstruction)
  // In production, this would be reconstructed from the original

  // Stop field
  writer.writeStop();
}

/**
 * Thrift Compact Protocol フィールドタイプ
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
  STRUCT = 0x0c,
}

/**
 * Thrift Compact Protocol ライター
 */
class ThriftCompactWriter {
  private buffer: Uint8Array;
  private pos: number = 0;
  private fieldStack: number[] = [];

  constructor(initialSize: number = 4096) {
    this.buffer = new Uint8Array(initialSize);
  }

  /**
   * バッファをリサイズ
   */
  private ensureCapacity(needed: number): void {
    if (this.pos + needed > this.buffer.length) {
      const newSize = Math.max(this.buffer.length * 2, this.pos + needed);
      const newBuffer = new Uint8Array(newSize);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
  }

  /**
   * フィールドヘッダーを書き込む
   */
  writeField(fieldId: number, type: FieldType): void {
    const lastFieldId = this.fieldStack[this.fieldStack.length - 1] || 0;
    this.fieldStack[this.fieldStack.length - 1] = fieldId;

    if (fieldId > lastFieldId && fieldId - lastFieldId <= 15) {
      // Delta encoding
      const byte = ((fieldId - lastFieldId) << 4) | type;
      this.ensureCapacity(1);
      this.buffer[this.pos++] = byte;
    } else {
      // Full encoding
      this.ensureCapacity(2);
      this.buffer[this.pos++] = type;
      this.writeI16(fieldId);
    }
  }

  /**
   * I32 を書き込む（zigzag エンコーディング）
   */
  writeI32(value: number): void {
    const zigzag = value >= 0 ? value << 1 : (value << 1) ^ -1;
    this.writeVarint(zigzag);
  }

  /**
   * I64 を書き込む（zigzag エンコーディング）
   */
  writeI64(value: number): void {
    const zigzag = value >= 0 ? value * 2 : value * 2 - 1;
    this.writeVarintLong(BigInt(zigzag));
  }

  /**
   * I16 を書き込む
   */
  writeI16(value: number): void {
    this.writeVarint((value << 1) ^ (value >> 15));
  }

  /**
   * Varint を書き込む
   */
  writeVarint(value: number): void {
    this.ensureCapacity(5);
    while ((value & ~0x7f) !== 0) {
      this.buffer[this.pos++] = (value & 0x7f) | 0x80;
      value >>>= 7;
    }
    this.buffer[this.pos++] = value & 0x7f;
  }

  /**
   * 64-bit Varint を書き込む
   */
  writeVarintLong(value: bigint): void {
    this.ensureCapacity(10);
    while ((value & ~0x7fn) !== 0n) {
      this.buffer[this.pos++] = Number((value & 0x7fn) | 0x80n);
      value >>= 7n;
    }
    this.buffer[this.pos++] = Number(value & 0x7fn);
  }

  /**
   * List ヘッダーを書き込む
   */
  writeListHeader(size: number, elementType: FieldType): void {
    if (size < 15) {
      this.ensureCapacity(1);
      this.buffer[this.pos++] = (size << 4) | elementType;
    } else {
      this.ensureCapacity(6);
      this.buffer[this.pos++] = 0xf0 | elementType;
      this.writeVarint(size);
    }
  }

  /**
   * Stop フィールドを書き込む
   */
  writeStop(): void {
    this.ensureCapacity(1);
    this.buffer[this.pos++] = FieldType.STOP;
    this.fieldStack.pop();
  }

  /**
   * バイト列を書き込む
   */
  writeBytes(data: Uint8Array): void {
    this.ensureCapacity(data.length);
    this.buffer.set(data, this.pos);
    this.pos += data.length;
  }

  /**
   * バッファを取得
   */
  getBuffer(): Uint8Array {
    return this.buffer.slice(0, this.pos);
  }
}
