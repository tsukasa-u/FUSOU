/**
 * Parquetストリーミングマージ最適化版
 * メモリ効率化: Range GET→逐次転送でメモリ消費を最小化
 */

import { parseParquetMetadataFromFullFile, parseParquetMetadataFromFooterBuffer, RowGroupInfo } from './parquet-compactor';

// Toggle verbose success-path logs for stream merge operations
const VERBOSE_STREAM_LOGS = false;

interface SourceFragment {
  key: string;
  footerSize: number;
  footerStart: number;
  rowGroups: RowGroupInfo[];
  totalSize: number;
}

/**
 * フッター情報のみ先読み（メタデータ取得）
 * 
 * NOTE: hyparquet を使用するため、全ファイルを読み込んでメタデータをパースします
 */
async function readFragmentMetadata(
  bucket: R2Bucket,
  key: string
): Promise<SourceFragment> {
  // まずHEADでサイズのみ取得（ボディは読まない）
  let totalSize = 0;
  try {
    const head = await bucket.head(key);
    if (head && typeof head.size === 'number') {
      totalSize = head.size;
    }
  } catch (_) {
    // head未対応の場合は最小限のGETでサイズを得る（Range: 0-0 でもsizeは得られる）
  }

  // サイズが未取得なら最小のGETで取得
  if (!totalSize) {
    const tiny = await bucket.get(key, { range: { offset: 0, length: 1 } });
    if (!tiny) throw new Error(`Fragment not found: ${key}`);
    totalSize = (tiny as any).size || 0;
  }

  if (totalSize < 12) throw new Error(`Invalid Parquet (too small): ${key}`);

  // 末尾8バイトだけ取得してfooterサイズを読む
  const tailObj = await bucket.get(key, { range: { offset: totalSize - 8, length: 8 } });
  if (!tailObj) throw new Error(`Failed to read tail: ${key}`);
  const tailBuf = new Uint8Array(await tailObj.arrayBuffer());
  const magic = new TextDecoder().decode(tailBuf.slice(4));
  if (magic !== 'PAR1') throw new Error(`Invalid magic in ${key}`);
  const footerSize = new DataView(tailBuf.buffer, tailBuf.byteOffset, 4).getUint32(0, true);
  const footerStart = totalSize - 8 - footerSize;
  if (footerStart < 4 || footerSize <= 0) throw new Error(`Invalid footer region in ${key}`);

  // フッター（metadata + 8バイト）だけをRange GET
  const footerObj = await bucket.get(key, { range: { offset: footerStart, length: footerSize + 8 } });
  if (!footerObj) throw new Error(`Failed to read footer: ${key}`);
  const footerBuf = new Uint8Array(await footerObj.arrayBuffer());

  // hyparquetでフッターだけからメタデータをパース
  let rowGroups = parseParquetMetadataFromFooterBuffer(footerBuf);

  // 取得したRowGroupのうち、構造が不正なものや行数0のものを事前に除外
  // （マージ時の警告スパムを減らし、空結果の早期判定を可能にする）
  rowGroups = (rowGroups || []).filter((rg) => {
    const valid = !!rg && rg.offset !== undefined && rg.totalByteSize !== undefined;
    return valid;
  }).filter((rg) => (rg.numRows ?? 0) > 0);

  // 万一空ならフォールバックで全体読み取り（小ファイル前提）
  if (!rowGroups || rowGroups.length === 0) {
    const fileObj = await bucket.get(key);
    if (!fileObj) throw new Error(`Fragment not found (fallback): ${key}`);
    const fileData = new Uint8Array(await fileObj.arrayBuffer());
    rowGroups = parseParquetMetadataFromFullFile(fileData) || [];
    // フォールバックでも同様に事前フィルタを適用
    rowGroups = (rowGroups || []).filter((rg) => {
      const valid = !!rg && rg.offset !== undefined && rg.totalByteSize !== undefined;
      return valid;
    }).filter((rg) => (rg.numRows ?? 0) > 0);
  }

  return { key, footerSize, footerStart, rowGroups, totalSize };
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
  const selectedRgs: Array<{ frag: SourceFragment; rg: RowGroupInfo; rgIndex: number }> = [];
  let accumulatedBytes = 0;

  for (const frag of fragments) {
    // 事前に空RowGroupを除外済みのため、ここで空判定が成立する場合はスキップ対象
    if (!frag.rowGroups || frag.rowGroups.length === 0) {
      continue;
    }
    for (let i = 0; i < frag.rowGroups.length; i++) {
      const rg = frag.rowGroups[i];
      if (!rg || rg.totalByteSize === undefined || rg.offset === undefined) {
        console.error(`[StreamMerge] Invalid RowGroup in ${frag.key} at index ${i}:`, { 
          hasRg: !!rg, 
          totalByteSize: rg?.totalByteSize,
          offset: rg?.offset,
          numRows: rg?.numRows
        });
        continue;
      }
      // 安全側チェック: RG 範囲がフッター内に収まっていない場合はスキップ
      if (rg.offset < 0 || rg.offset + rg.totalByteSize > frag.footerStart) {
        console.warn(`[StreamMerge] Skip RG out of bounds: ${frag.key} RG${i}`, {
          offset: rg.offset,
          totalByteSize: rg.totalByteSize,
          footerStart: frag.footerStart,
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
    // すべてのフラグメントが非空RowGroupを持たない（＝行数0のみ、または不正）場合は空結果として扱う
    const allEmpty = fragments.every(f => !f.rowGroups || f.rowGroups.length === 0);
    if (allEmpty) {
      console.warn(`[Parquet Stream Merge] All ${fragments.length} fragments have empty RowGroups (numRows=0). Returning empty result.`);
      return { newFileSize: 0, etag: '', rowGroupCount: 0 };
    }
    throw new Error('No row groups selected for merge');
  }

  // 3. ストリーミング書込準備: TransformStreamでチャンク逐次送信
  let writeOffset = 0;
  const newRowGroups: RowGroupInfo[] = [];
  const dataChunks: Uint8Array[] = [];

  for (const { frag, rg } of selectedRgs) {
    // Range GETでRow Groupデータのみ取得
    if (VERBOSE_STREAM_LOGS) {
      console.log(`[Parquet Stream Merge] Fetching RG from ${frag.key}: offset=${rg.offset}, length=${rg.totalByteSize}`);
    }
    
    // Sanity check before Range GET
    if (rg.offset! + rg.totalByteSize! > frag.totalSize) {
      console.error(`[Parquet Stream Merge] CRITICAL: RG bounds exceed file size!`, {
        file: frag.key,
        rgOffset: rg.offset,
        rgSize: rg.totalByteSize,
        fileSize: frag.totalSize,
        rgEnd: rg.offset! + rg.totalByteSize!
      });
      throw new Error(`RG bounds exceed file size: ${frag.key}`);
    }
    
    const rgObj = await bucket.get(frag.key, {
      range: { offset: rg.offset!, length: rg.totalByteSize! },
    });
    if (!rgObj) throw new Error(`Failed to get RG from ${frag.key}`);
    
    const rgData = new Uint8Array(await rgObj.arrayBuffer());
    if (VERBOSE_STREAM_LOGS) {
      console.log(`[Parquet Stream Merge] Fetched RG from ${frag.key}: actual data length=${rgData.length}`);
    }
    dataChunks.push(rgData);

    // オフセット再計算
    const remappedChunks = (rg.columnChunks || []).map((cc) => ({
      columnIndex: cc.columnIndex,
      offset: writeOffset + (cc.offset - rg.offset!),
      size: cc.size,
      type: cc.type,
    }));

    newRowGroups.push({
      index: newRowGroups.length,
      offset: writeOffset,
      totalByteSize: rg.totalByteSize!,
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
  
  // CRITICAL DEFENSIVE CHECK
  const MAX_ALLOC_SIZE = 512 * 1024 * 1024; // 512MB safety limit
  if (totalSize > MAX_ALLOC_SIZE) {
    console.error(`[Parquet Stream Merge] CRITICAL: Merged file size (${totalSize}) exceeds max allocation (${MAX_ALLOC_SIZE})`, {
      writeOffset,
      footerDataLength: footerData.length,
      selectedRgsCount: selectedRgs.length,
      dataChunksCount: dataChunks.length,
      totalDataChunksSize: dataChunks.reduce((sum, c) => sum + c.length, 0)
    });
    throw new Error(`[Parquet Stream Merge] Output size ${totalSize} exceeds limit ${MAX_ALLOC_SIZE}`);
  }
  
  if (totalSize < 0 || !Number.isFinite(totalSize)) {
    console.error(`[Parquet Stream Merge] CRITICAL: Invalid total size`, {
      totalSize,
      writeOffset,
      footerDataLength: footerData.length
    });
    throw new Error(`[Parquet Stream Merge] Invalid total size: ${totalSize}`);
  }
  
  if (VERBOSE_STREAM_LOGS) {
    console.log(`[Parquet Stream Merge] Allocating merged Parquet: totalSize=${totalSize}, writeOffset=${writeOffset}, footerSize=${footerData.length}`);
  }
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

  if (VERBOSE_STREAM_LOGS) {
    console.log(`[StreamMerge] Written ${outKey}: ${totalSize} bytes, ${newRowGroups.length} RG`);
  }

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
  writer.writeField(3, FieldType.I64); writer.writeI64(rg.totalByteSize!);
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
    
    // Try to parse metadata, with detailed error handling
    let rowGroups: RowGroupInfo[] = [];
    try {
      rowGroups = parseParquetMetadataFromFullFile(data) || [];
    } catch (parseErr) {
      console.error(`[Parquet Stream Merge] Failed to parse metadata for ${frag.key}:`, String(parseErr));
      
      // Debug: show file structure for diagnosis
      if (data.length < 200) {
        console.error(`[Parquet Stream Merge] File too small (${data.length} bytes). First 100 bytes:`, 
          Array.from(data.slice(0, 100)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        console.error(`[Parquet Stream Merge] Last 100 bytes:`,
          Array.from(data.slice(Math.max(0, data.length - 100))).map(b => b.toString(16).padStart(2, '0')).join(' '));
      } else {
        console.error(`[Parquet Stream Merge] Magic (last 4 bytes):`, new TextDecoder().decode(data.slice(-4)));
        console.error(`[Parquet Stream Merge] Footer size should be at bytes [-8:-4], actual:`, 
          new DataView(data.buffer, data.byteOffset + data.length - 8, 4).getUint32(0, true));
      }
      
      // Return empty rowGroups array - this fragment will be skipped due to validation
      rowGroups = [];
    }
    
    const validRowGroups = rowGroups
      .filter((rg, idx) => {
        const isValid = !!rg && rg.offset !== undefined && rg.totalByteSize !== undefined && rg.offset !== undefined;
        if (!isValid) {
          console.warn(`[Parquet Stream Merge] Dropping invalid RowGroup from ${frag.key} at index ${idx}`, {
            hasRg: !!rg,
            offset: rg?.offset,
            totalByteSize: rg?.totalByteSize,
            numRows: rg?.numRows
          });
        }
        return isValid;
      })
      // 行数0のRowGroupは事前に除外（空データはマージ・ログ対象外）
      .filter((rg) => (rg.numRows ?? 0) > 0);
    
    return {
      key: frag.key,
      data,
      footerSize,
      footerStart,
      rowGroups: validRowGroups,
      totalSize: data.length,
    };
  });

  // 2. Row Groupを選別してバケツに詰める
  const selectedRgs: Array<{ frag: typeof fragments[0]; rg: RowGroupInfo; rgIndex: number }> = [];
  let accumulatedBytes = 0;

  for (const frag of fragments) {
    // 事前フィルタにより、空RowGroupのみのフラグメントはここでスキップ
    if (!frag.rowGroups || frag.rowGroups.length === 0) {
      continue;
    }
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
        
        // Sanity check: RowGroup size should not exceed file size
        if (rg.totalByteSize > frag.data.length) {
          console.error(`[Parquet Stream Merge] CRITICAL: RowGroup size (${rg.totalByteSize}) > file size (${frag.data.length}). File: ${frag.key}, RG${i}`, {
            offset: rg.offset,
            totalByteSize: rg.totalByteSize,
            fileSize: frag.data.length,
            rgEnd: rg.offset + rg.totalByteSize,
            footerStart: frag.footerStart
          });
          console.error(`[Parquet Stream Merge] This likely indicates multi-table concatenation without proper offset metadata. Skipping this RowGroup.`);
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
    // すべてのフラグメントが非空RowGroupを持たない（事前フィルタ後に空）場合は空結果として扱う
    const allEmpty = fragments.every(f => !f.rowGroups || f.rowGroups.length === 0);
    if (allEmpty) {
      console.warn(`[Parquet Stream Merge] All ${fragments.length} fragments have empty RowGroups (numRows=0). Returning empty result.`);
      return { etag: '', newFileSize: 0, rowGroupCount: 0 };
    }
    
    // Detailed diagnostics: collect all RowGroup info to understand why none were selected
    const diagnostics = fragments.map((frag) => ({
      key: frag.key,
      fileSize: frag.data.length,
      rowGroupCount: frag.rowGroups.length,
      rowGroups: (frag.rowGroups || []).map((rg, idx) => ({
        index: idx,
        offset: rg?.offset,
        totalByteSize: rg?.totalByteSize,
        numRows: rg?.numRows,
        isValid: !!rg && rg.offset !== undefined && rg.totalByteSize !== undefined,
      })),
    }));
    console.error(`[Parquet Stream Merge] CRITICAL: No valid RowGroups found. Diagnostics:`, JSON.stringify({
      fragmentCount: fragments.length,
      totalRowGroups: fragments.reduce((sum, f) => sum + (f.rowGroups?.length || 0), 0),
      fragments: diagnostics,
    }, null, 2));
    
    // Include first fragment's detailed info in error message for debugging
    const firstFragDetail = diagnostics[0] ? {
      key: diagnostics[0].key,
      fileSize: diagnostics[0].fileSize,
      rgCount: diagnostics[0].rowGroupCount,
      firstRg: diagnostics[0].rowGroups[0]
    } : null;
    
    throw new Error(`No row groups selected for merge (${fragments.length} fragments, ${fragments.reduce((sum, f) => sum + (f.rowGroups?.length || 0), 0)} RGs total, 0 valid). First fragment detail: ${JSON.stringify(firstFragDetail)}`);
  }

  // 3. データチャンク準備
  let writeOffset = 0;
  const newRowGroups: RowGroupInfo[] = [];
  const dataChunks: Uint8Array[] = [];

  for (const { frag, rg } of selectedRgs) {
    if (rg.offset === undefined || rg.totalByteSize === undefined) {
      throw new Error(`Selected RG has undefined bounds: ${frag.key}`);
    }
    // Row Group範囲を直接抽出
    const rgStart = rg.offset!;
    const rgEnd = rgStart + rg.totalByteSize!;
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
    writeOffset += rg.totalByteSize!;
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

  // R2アップロード (skip if finalData is empty)
  if (finalData.length === 0) {
    return { etag: '', newFileSize: 0, rowGroupCount: 0 };
  }
  
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
