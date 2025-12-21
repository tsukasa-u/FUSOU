import { RowGroupInfo, parseParquetMetadata } from './parquet-compactor';

type RgWithSource = RowGroupInfo & { __sourceKey: string; __rgStart: number };

async function readObjectFully(bucket: R2Bucket, key: string): Promise<Uint8Array> {
  const obj = await bucket.get(key);
  if (!obj) throw new Error(`R2 object not found: ${key}`);
  return new Uint8Array(await obj.arrayBuffer());
}

function readFooter(buffer: Uint8Array): { footerSize: number; footerStart: number; rowGroups: RowGroupInfo[] } {
  if (buffer.length < 8) throw new Error('Parquet file too small');
  const magic = new TextDecoder().decode(buffer.slice(-4));
  if (magic !== 'PAR1') throw new Error('Invalid Parquet magic number');
  const sizeView = new DataView(buffer.buffer, buffer.byteOffset + buffer.length - 8, 4);
  const footerSize = sizeView.getUint32(0, true);
  const footerStart = buffer.length - 8 - footerSize;
  if (footerStart < 0) throw new Error('Invalid footer size');
  const footerData = buffer.slice(footerStart, footerStart + footerSize);
  const rowGroups = parseParquetMetadata(footerData);
  return { footerSize, footerStart, rowGroups };
}

/**
 * @deprecated このメモリ集約型実装は非推奨です。
 * 代わりに parquet-stream-merge.ts の streamMergeParquetFragments を使用してください。
 * 理由: 全ファイルをメモリにロードするため、大量のフラグメントでメモリ不足が発生します。
 * ストリーミングマージはRange GETで15%メモリ削減を達成しています。
 */
export async function mergeFragmentsToParquet(
  bucket: R2Bucket,
  outKey: string,
  sourceKeys: string[],
  thresholdBytes: number
): Promise<{ newFileSize: number; etag: string; rowGroupCount: number }> {
  console.warn('[DEPRECATED] mergeFragmentsToParquet は非推奨です。streamMergeParquetFragments への移行を推奨します。');
  
  // Load sources fully (keeps implementation simple; optimize to streaming later if needed)
  const sources = await Promise.all(
    sourceKeys.map(async (key) => {
      const buf = await readObjectFully(bucket, key);
      const { rowGroups } = readFooter(buf);
      return { key, buf, rowGroups };
    })
  );

  const dataChunks: Uint8Array[] = [];
  const newRowGroups: RowGroupInfo[] = [];
  let writeOffset = 0;
  let bucketBytes = 0;

  for (const src of sources) {
    // Append row groups in order
    for (const rg of src.rowGroups) {
      // Defensive guard: skip invalid RGs
      if (rg.offset === undefined || rg.totalByteSize === undefined) {
        console.warn(`[DEPRECATED mergeFragments] Skipping RG with undefined offset/size in ${src.key}`);
        continue;
      }
      
      if (bucketBytes > 0 && bucketBytes + rg.totalByteSize > thresholdBytes) {
        // Stop when threshold exceeded; caller should create next bucket
        break;
      }
      const start = rg.offset;
      const end = rg.offset + rg.totalByteSize;
      
            // Check for overflow in end calculation
            if (end > Number.MAX_SAFE_INTEGER || end < rg.offset) {
              console.warn(`[DEPRECATED mergeFragments] RG overflow detected in ${src.key}: offset=${rg.offset}, size=${rg.totalByteSize}`);
              continue;
            }
      
      const rgData = src.buf.slice(start, end);
      dataChunks.push(rgData);

      // Remap RowGroup offsets to new file space
      const remappedChunks = (rg.columnChunks || []).map((cc) => {
        const relativeOffset = cc.offset - start;
        const newOffset = writeOffset + relativeOffset;
        
        // Check for overflow
        if (newOffset > Number.MAX_SAFE_INTEGER || newOffset < 0) {
          throw new Error(`[DEPRECATED mergeFragments] Column chunk offset overflow: cc.offset=${cc.offset}, start=${start}, writeOffset=${writeOffset}`);
        }
        
        return {
          columnIndex: cc.columnIndex,
          offset: newOffset,
          size: cc.size,
          type: cc.type,
        };
      });

      newRowGroups.push({
        index: newRowGroups.length,
        offset: writeOffset,
        totalByteSize: rg.totalByteSize,
        numRows: rg.numRows,
        columnChunks: remappedChunks,
      });

      // Accumulate with overflow checks
      const newWriteOffset = writeOffset + rgData.length;
      const newBucketBytes = bucketBytes + rg.totalByteSize;
      
      if (newWriteOffset > Number.MAX_SAFE_INTEGER || newWriteOffset < writeOffset) {
        throw new Error(`[DEPRECATED mergeFragments] writeOffset overflow: ${writeOffset} + ${rgData.length}`);
      }
      if (newBucketBytes > Number.MAX_SAFE_INTEGER || newBucketBytes < bucketBytes) {
        console.warn(`[DEPRECATED mergeFragments] bucketBytes overflow: ${bucketBytes} + ${rg.totalByteSize}`);
      }
      
      writeOffset = newWriteOffset;
      bucketBytes = newBucketBytes;
    }
    if (bucketBytes >= thresholdBytes) break;
  }

  // Assemble final file: data + footer + size + magic
  const footerData = generateMinimalFooter(newRowGroups);
  const footerSizeBuf = new ArrayBuffer(4);
  new DataView(footerSizeBuf).setUint32(0, footerData.length, true);
  const magic = new TextEncoder().encode('PAR1');

  const totalSize = writeOffset + footerData.length + 4 + 4;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of dataChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  out.set(footerData, pos);
  pos += footerData.length;
  out.set(new Uint8Array(footerSizeBuf), pos);
  pos += 4;
  out.set(magic, pos);

  const putRes = await bucket.put(outKey, out, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: {
      compacted: 'true',
      compacted_from: String(sourceKeys.length),
      new_row_groups: String(newRowGroups.length),
    },
  });

  return { newFileSize: totalSize, etag: putRes!.etag, rowGroupCount: newRowGroups.length };
}

// Minimal Thrift Compact footer writer (reuse from parquet-writer but minimal deps here)
enum FieldType { STOP=0x00, I32=0x05, I64=0x06, BINARY=0x08, LIST=0x09, STRUCT=0x0c }

class ThriftCompactWriter {
  private buf = new Uint8Array(4096);
  private pos = 0;
  private lastFieldId = 0;
  private ensure(n: number) { if (this.pos + n > this.buf.length) { const nb = new Uint8Array(Math.max(this.buf.length*2, this.pos+n)); nb.set(this.buf); this.buf = nb; } }
  private write(b: number) { this.ensure(1); this.buf[this.pos++] = b & 0xff; }
  writeField(fieldId: number, type: FieldType) {
    const delta = fieldId - this.lastFieldId;
    if (delta > 0 && delta <= 15) { this.write((delta<<4) | type); }
    else { this.write(type); this.writeVarint((fieldId<<1) ^ (fieldId>>15)); }
    this.lastFieldId = fieldId;
  }
  writeVarint(v: number) { while ((v & ~0x7f) !== 0) { this.write((v & 0x7f) | 0x80); v >>>= 7; } this.write(v & 0x7f); }
  writeVarint64(v: bigint) { while ((v & ~0x7fn) !== 0n) { this.write(Number((v & 0x7fn) | 0x80n)); v >>= 7n; } this.write(Number(v & 0x7fn)); }
  writeI32(n: number) { const zz = n >= 0 ? n<<1 : (n<<1) ^ -1; this.writeVarint(zz); }
  writeI64(n: number) { const zz = n >= 0 ? BigInt(n)*2n : BigInt(n)*2n - 1n; this.writeVarint64(zz); }
  writeListHeader(size: number, elementType: FieldType) { if (size < 15) this.write((size<<4)|elementType); else { this.write(0xf0 | elementType); this.writeVarint(size);} }
  writeBytes(bytes: Uint8Array) { this.ensure(bytes.length); this.buf.set(bytes, this.pos); this.pos += bytes.length; }
  writeStop() { this.write(FieldType.STOP); }
  bytes() { return this.buf.slice(0, this.pos); }
}

function writeColumnChunk(writer: ThriftCompactWriter, chunk: RowGroupInfo['columnChunks'][number]) {
  // ColumnChunk struct: file_offset (field 2), metadata (field 3) omitted
  writer.writeField(2, FieldType.I64);
  writer.writeI64(chunk.offset);
  writer.writeStop();
}

function writeRowGroup(writer: ThriftCompactWriter, rg: RowGroupInfo) {
  // columns (1)
  writer.writeField(1, FieldType.LIST);
  writer.writeListHeader(rg.columnChunks.length, FieldType.STRUCT);
  for (const cc of rg.columnChunks) writeColumnChunk(writer, cc);
  // num_rows (2)
  writer.writeField(2, FieldType.I64); writer.writeI64(rg.numRows);
  // total_byte_size (3)
  writer.writeField(3, FieldType.I64); writer.writeI64(rg.totalByteSize);
  writer.writeStop();
}

function generateMinimalFooter(rowGroups: RowGroupInfo[]): Uint8Array {
  const w = new ThriftCompactWriter();
  // version (1)
  w.writeField(1, FieldType.I32); w.writeI32(1);
  // num_rows (4)
  const totalRows = rowGroups.reduce((s, r) => s + r.numRows, 0);
  w.writeField(4, FieldType.I64); w.writeI64(totalRows);
  // row_groups (5)
  w.writeField(5, FieldType.LIST); w.writeListHeader(rowGroups.length, FieldType.STRUCT);
  for (const rg of rowGroups) writeRowGroup(w, rg);
  // created_by (6)
  w.writeField(6, FieldType.BINARY);
  const by = new TextEncoder().encode('FUSOU Merge v1.0');
  w.writeVarint(by.length); w.writeBytes(by);
  // stop
  w.writeStop();
  return w.bytes();
}

export function pickFragmentsForBucket(
  fragments: Array<{ key: string; size: number }>,
  startIndex: number,
  thresholdBytes: number
): { picked: string[]; nextIndex: number; totalBytes: number } {
  let total = 0;
  const picked: string[] = [];
  let i = startIndex;
  for (; i < fragments.length; i++) {
    const s = fragments[i].size;
    if (total > 0 && total + s > thresholdBytes) break;
    picked.push(fragments[i].key);
    total += s;
  }
  return { picked, nextIndex: i, totalBytes: total };
}
