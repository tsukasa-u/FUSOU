/**
 * Parquetストリーミングマージ最適化版
 * メモリ効率化: Range GET→逐次転送でメモリ消費を最小化
 */

import { parseParquetMetadata, RowGroupInfo } from './parquet-compactor';

interface SourceFragment {
  key: string;
  footerSize: number;
  footerStart: number;
  rowGroups: RowGroupInfo[];
  totalSize: number;
}

/**
 * フッター情報のみ先読み（メタデータ取得）
 */
async function readFragmentMetadata(
  bucket: R2Bucket,
  key: string
): Promise<SourceFragment> {
  // 末尾8バイト読み取り（footer size + magic）
  const tailObj = await bucket.get(key, {
    range: { suffix: 8 },
  });
  if (!tailObj) throw new Error(`Fragment not found: ${key}`);
  
  const tailBuf = new Uint8Array(await tailObj.arrayBuffer());
  const magic = new TextDecoder().decode(tailBuf.slice(-4));
  if (magic !== 'PAR1') throw new Error(`Invalid magic in ${key}`);
  
  const footerSizeView = new DataView(tailBuf.buffer, tailBuf.byteOffset, 4);
  const footerSize = footerSizeView.getUint32(0, true);
  
  // Footer本体を読み取り
  const headObj = await bucket.head(key);
  if (!headObj) throw new Error(`Cannot head ${key}`);
  const totalSize = headObj.size;
  const footerStart = totalSize - 8 - footerSize;
  
  const footerObj = await bucket.get(key, {
    range: { offset: footerStart, length: footerSize },
  });
  if (!footerObj) throw new Error(`Cannot read footer of ${key}`);
  
  const footerData = new Uint8Array(await footerObj.arrayBuffer());
  const rowGroups = parseParquetMetadata(footerData);
    
  
  return {
    key,
    footerSize,
    footerStart,
    rowGroups,
    totalSize,
  };
}

/**
 * ストリーミングマージ: Range GETで逐次転送、メモリ最小化
 */
export async function streamMergeParquetFragments(
  bucket: R2Bucket,
  outKey: string,
  sourceKeys: string[],
  thresholdBytes: number
): Promise<{ newFileSize: number; etag: string; rowGroupCount: number }> {
  // 1. 全フラグメントのメタデータ取得（小容量）
  const fragments = await Promise.all(
    sourceKeys.map((key) => readFragmentMetadata(bucket, key))
  );

  // 2. Row Groupを選別してバケツに詰める
  const selectedRgs: Array<{ srcKey: string; rg: RowGroupInfo; rgIndex: number }> = [];
  let accumulatedBytes = 0;

  for (const frag of fragments) {
    for (let i = 0; i < frag.rowGroups.length; i++) {
      const rg = frag.rowGroups[i];
      if (!rg || rg.totalByteSize === undefined) {
        console.error(`[StreamMerge] Invalid RowGroup in ${frag.key} at index ${i}:`, { rg, hasRg: !!rg, totalByteSize: rg?.totalByteSize });
        continue;
      }
      if (accumulatedBytes > 0 && accumulatedBytes + rg.totalByteSize > thresholdBytes) {
        break;
      }
      selectedRgs.push({ srcKey: frag.key, rg, rgIndex: i });
      accumulatedBytes += rg.totalByteSize;
          if (!rg || rg.totalByteSize === undefined || rg.offset === undefined) {
            console.error(`[StreamMerge] Invalid RowGroup in ${frag.key} at index ${i}:`, {
              hasRg: !!rg,
              totalByteSize: rg?.totalByteSize,
              offset: rg?.offset,
              numRows: rg?.numRows
            });
            continue;
          }
    }
    if (accumulatedBytes >= thresholdBytes) break;
  }

  if (selectedRgs.length === 0) {
    throw new Error('No row groups selected for merge');
  }

  // 3. ストリーミング書込準備: TransformStreamでチャンク逐次送信
  let writeOffset = 0;
  const newRowGroups: RowGroupInfo[] = [];
  const dataChunks: Uint8Array[] = [];

  for (const { srcKey, rg } of selectedRgs) {
    // Range GETでRow Groupデータのみ取得
    const rgObj = await bucket.get(srcKey, {
      range: { offset: rg.offset, length: rg.totalByteSize },
    });
    if (!rgObj) throw new Error(`Failed to get RG from ${srcKey}`);
    
    const rgData = new Uint8Array(await rgObj.arrayBuffer());
    dataChunks.push(rgData);

    // オフセット再計算
    const remappedChunks = (rg.columnChunks || []).map((cc) => ({
      columnIndex: cc.columnIndex,
      offset: writeOffset + (cc.offset - rg.offset),
      size: cc.size,
      type: cc.type,
    }));

    newRowGroups.push({
      index: newRowGroups.length,
      offset: writeOffset,
      totalByteSize: rg.totalByteSize,
      numRows: rg.numRows,
      columnChunks: remappedChunks,
    });

    writeOffset += rgData.length;
  }

  // 4. Footer生成
  const footerData = generateMinimalFooter(newRowGroups);
  const footerSizeBuf = new ArrayBuffer(4);
  new DataView(footerSizeBuf).setUint32(0, footerData.length, true);
  const magic = new TextEncoder().encode('PAR1');

  // 5. 最終ファイル組み立て（一括アップロード; 真のストリーミングはR2 Multipartへ拡張可）
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
      stream_optimized: 'true',
      source_count: String(sourceKeys.length),
      row_group_count: String(newRowGroups.length),
    },
  });

  console.log(`[StreamMerge] Written ${outKey}: ${totalSize} bytes, ${newRowGroups.length} RG`);

  return {
    newFileSize: totalSize,
    etag: putRes!.etag,
    rowGroupCount: newRowGroups.length,
  };
}

// Minimal footer writer (同parquet-merge.tsから抽出)
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
  writer.writeField(2, FieldType.I64);
  writer.writeI64(chunk.offset);
  writer.writeStop();
}

function writeRowGroup(writer: ThriftCompactWriter, rg: RowGroupInfo) {
  writer.writeField(1, FieldType.LIST);
  writer.writeListHeader(rg.columnChunks.length, FieldType.STRUCT);
  for (const cc of rg.columnChunks) writeColumnChunk(writer, cc);
  writer.writeField(2, FieldType.I64); writer.writeI64(rg.numRows);
  writer.writeField(3, FieldType.I64); writer.writeI64(rg.totalByteSize);
  writer.writeStop();
}

function generateMinimalFooter(rowGroups: RowGroupInfo[]): Uint8Array {
  const w = new ThriftCompactWriter();
  w.writeField(1, FieldType.I32); w.writeI32(1);
  const totalRows = rowGroups.reduce((s, r) => s + r.numRows, 0);
  w.writeField(4, FieldType.I64); w.writeI64(totalRows);
  w.writeField(5, FieldType.LIST); w.writeListHeader(rowGroups.length, FieldType.STRUCT);
  for (const rg of rowGroups) writeRowGroup(w, rg);
  w.writeField(6, FieldType.BINARY);
  const by = new TextEncoder().encode('FUSOU StreamMerge v1.0');
  w.writeVarint(by.length); w.writeBytes(by);
  w.writeStop();
  return w.bytes();
}

/**
 * 抽出済みデータからストリーミングマージ（offset extraction後の処理用）
 */
export async function streamMergeExtractedFragments(
  bucket: R2Bucket,
  outKey: string,
  sourceFragments: Array<{ key: string; data: ArrayBuffer; size: number }>,
  thresholdBytes: number
): Promise<{ newFileSize: number; etag: string; rowGroupCount: number }> {
  // 1. 全フラグメントのメタデータ取得（ArrayBufferから直接）
  const fragments = sourceFragments.map((frag) => {
    const data = new Uint8Array(frag.data);
    
    // Footer読み取り
    if (data.length < 12) throw new Error(`Invalid Parquet: ${frag.key}`);
    
    const tailBuf = data.slice(-8);
    const magic = new TextDecoder().decode(tailBuf.slice(-4));
    if (magic !== 'PAR1') throw new Error(`Invalid Parquet magic: ${frag.key}`);
    
    const footerSizeView = new DataView(tailBuf.buffer, tailBuf.byteOffset, 4);
    const footerSize = footerSizeView.getUint32(0, true);
    
    const footerStart = data.length - 8 - footerSize;
    const footerData = data.slice(footerStart, footerStart + footerSize);
    
    const rowGroups = parseParquetMetadata(footerData);
    
    
    return {
      key: frag.key,
      data,
      footerSize,
      footerStart,
      rowGroups,
      totalSize: data.length,
    };
  });

    // Debug: Log all parsed fragments with RowGroup details
    console.log(`[Parquet Stream Merge] Parsed ${fragments.length} fragments:`);
    fragments.forEach((frag, idx) => {
      console.log(`  Fragment ${idx}: ${frag.key}`);
      console.log(`    fileSize=${frag.data.length}, footerSize=${frag.footerSize}, rowGroupCount=${frag.rowGroups.length}`);
      frag.rowGroups.forEach((rg, rgIdx) => {
        const isValid = rg.offset !== undefined && rg.totalByteSize !== undefined && rg.numRows !== undefined;
        console.log(`      RG${rgIdx}: offset=${rg.offset}, totalByteSize=${rg.totalByteSize}, numRows=${rg.numRows}, isValid=${isValid}`);
      });
    });

  // 2. Row Groupを選別してバケツに詰める
  const selectedRgs: Array<{ frag: typeof fragments[0]; rg: RowGroupInfo; rgIndex: number }> = [];
  let accumulatedBytes = 0;

  for (const frag of fragments) {
    for (let i = 0; i < frag.rowGroups.length; i++) {
      const rg = frag.rowGroups[i];
      
        // Defensive check: Skip invalid RowGroups
        if (!rg || rg.totalByteSize === undefined || rg.offset === undefined) {
          console.warn(`[Parquet Stream Merge] Skipping invalid RowGroup: ${frag.key} RG${i}`, {
            hasRg: !!rg,
            offset: rg?.offset,
            totalByteSize: rg?.totalByteSize,
            numRows: rg?.numRows
          });
          continue;
        }
      
      if (accumulatedBytes > 0 && accumulatedBytes + rg.totalByteSize > thresholdBytes) {
        break;
      }
      selectedRgs.push({ frag, rg, rgIndex: i });
      accumulatedBytes += rg.totalByteSize;
    }
    if (accumulatedBytes >= thresholdBytes) break;
  }

  if (selectedRgs.length === 0) {
    throw new Error('No row groups selected for merge');
  }

  // 3. データチャンク準備
  let writeOffset = 0;
  const newRowGroups: RowGroupInfo[] = [];
  const dataChunks: Uint8Array[] = [];

  for (const { frag, rg } of selectedRgs) {
    // Row Group範囲を直接抽出
    const rgStart = rg.offset;
    const rgEnd = rgStart + rg.totalByteSize;
    const rgData = frag.data.slice(rgStart, rgEnd);
    
    dataChunks.push(rgData);
    
    // オフセット再計算
    const newRg: RowGroupInfo = {
      ...rg,
      offset: writeOffset,
      columnChunks: rg.columnChunks.map((cc) => ({
        ...cc,
        offset: cc.offset - rgStart + writeOffset,
      })),
    };
    
    newRowGroups.push(newRg);
    writeOffset += rg.totalByteSize;
  }

  // 4. Footer生成
  const footerData = generateMinimalFooter(newRowGroups);
  const footerSizeBytes = new Uint8Array(4);
  new DataView(footerSizeBytes.buffer).setUint32(0, footerData.length, true);
  const magicBytes = new TextEncoder().encode('PAR1');

  // 5. 最終結合してR2にアップロード
  const totalSize = writeOffset + footerData.length + 4 + 4;
  const finalData = new Uint8Array(totalSize);
  
  // Header magic
  finalData.set(magicBytes, 0);
  
  // Data chunks
  let offset = 4;
  for (const chunk of dataChunks) {
    finalData.set(chunk, offset);
    offset += chunk.length;
  }
  
  // Footer
  finalData.set(footerData, offset);
  offset += footerData.length;
  
  // Footer size + magic
  finalData.set(footerSizeBytes, offset);
  offset += 4;
  finalData.set(magicBytes, offset);

  // R2アップロード
  const uploadResult = await bucket.put(outKey, finalData);
  if (!uploadResult) {
    throw new Error('Failed to upload compacted file to R2');
  }

  return {
    newFileSize: totalSize,
    etag: uploadResult.etag,
    rowGroupCount: newRowGroups.length,
  };
}
