/**
 * Parquet形式検証ツール (parquet-tools meta相当)
 * フッター/Row Group整合性を確認
 */

import { parseParquetMetadata, RowGroupInfo } from './parquet-compactor';

export interface ParquetFileInfo {
  valid: boolean;
  fileSize: number;
  footerSize: number;
  numRowGroups: number;
  totalRows: number;
  rowGroups: RowGroupInfo[];
  errors: string[];
  warnings: string[];
  cleaned?: boolean; // 検証失敗時に削除された場合にtrue
}

export interface ValidateOptions {
  deleteOnFailure?: boolean; // 検証失敗時に自動削除
  minRowGroups?: number; // 最小Row Group数チェック
  maxFileSize?: number; // 最大ファイルサイズチェック
}

/**
 * Parquetファイルの形式チェック
 */
export async function validateParquetFile(
  bucket: R2Bucket,
  key: string,
  options: ValidateOptions = {}
): Promise<ParquetFileInfo> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  try {
    const obj = await bucket.get(key);
    if (!obj) {
      return {
        valid: false,
        fileSize: 0,
        footerSize: 0,
        numRowGroups: 0,
        totalRows: 0,
        rowGroups: [],
        errors: [`Object not found: ${key}`],
        warnings: [],
      };
    }

    const fileSize = obj.size;
    const buffer = new Uint8Array(await obj.arrayBuffer());

    // 1. Magic number チェック (先頭 "PAR1")
    if (buffer.length < 8) {
      errors.push('File too small (< 8 bytes)');
      return { valid: false, fileSize, footerSize: 0, numRowGroups: 0, totalRows: 0, rowGroups: [], errors, warnings };
    }

    const headerMagic = new TextDecoder().decode(buffer.slice(0, 4));
    if (headerMagic !== 'PAR1') {
      errors.push(`Invalid header magic: expected "PAR1", got "${headerMagic}"`);
      // Early return if header is invalid
      return { valid: false, fileSize, footerSize: 0, numRowGroups: 0, totalRows: 0, rowGroups: [], errors, warnings };
    }

    // 2. Footer magic (末尾 "PAR1")
    const footerMagic = new TextDecoder().decode(buffer.slice(-4));
    if (footerMagic !== 'PAR1') {
      errors.push(`Invalid footer magic: expected "PAR1", got "${footerMagic}"`);
    }

    // 3. Footer size
    const footerSizeView = new DataView(buffer.buffer, buffer.byteOffset + buffer.length - 8, 4);
    const footerSize = footerSizeView.getUint32(0, true);
    
    if (footerSize <= 0 || footerSize > buffer.length - 8) {
      errors.push(`Invalid footer size: ${footerSize} (file size: ${buffer.length})`);
      return { valid: false, fileSize, footerSize, numRowGroups: 0, totalRows: 0, rowGroups: [], errors, warnings };
    }

    const footerStart = buffer.length - 8 - footerSize;
    if (footerStart < 4) {
      errors.push(`Footer start position invalid: ${footerStart}`);
      return { valid: false, fileSize, footerSize, numRowGroups: 0, totalRows: 0, rowGroups: [], errors, warnings };
    }

    // 4. Parse footer metadata
    const footerData = buffer.slice(footerStart, footerStart + footerSize);
    let rowGroups: RowGroupInfo[] = [];
    try {
      rowGroups = parseParquetMetadata(footerData);
    } catch (error) {
      errors.push(`Failed to parse footer metadata: ${error}`);
      return { valid: false, fileSize, footerSize, numRowGroups: 0, totalRows: 0, rowGroups: [], errors, warnings };
    }

    // 5. Row Group整合性チェック
    const numRowGroups = rowGroups.length;
    let totalRows = 0;
    let prevEnd = 0;

    for (let i = 0; i < rowGroups.length; i++) {
      const rg = rowGroups[i];
      totalRows += rg.numRows;

      // Offset範囲チェック
      if (rg.offset < prevEnd && i > 0) {
        warnings.push(`RG${i}: offset ${rg.offset} overlaps with previous RG (ended at ${prevEnd})`);
      }
      
      const rgEnd = rg.offset + rg.totalByteSize;
      if (rgEnd > footerStart) {
        errors.push(`RG${i}: data extends beyond footer (${rgEnd} > ${footerStart})`);
      }

      prevEnd = rgEnd;

      // Column chunk整合性
      for (let c = 0; c < rg.columnChunks.length; c++) {
        const cc = rg.columnChunks[c];
        if (cc.offset < rg.offset || cc.offset + cc.size > rgEnd) {
          warnings.push(`RG${i} CC${c}: offset ${cc.offset} out of RG bounds [${rg.offset}, ${rgEnd}]`);
        }
      }

      // Row count妥当性
      if (rg.numRows <= 0) {
        warnings.push(`RG${i}: zero or negative row count (${rg.numRows})`);
      }
      if (rg.totalByteSize <= 0) {
        warnings.push(`RG${i}: zero or negative byte size (${rg.totalByteSize})`);
      }
    }

    const valid = errors.length === 0;

    // 追加の検証ルール
    if (options.minRowGroups && numRowGroups < options.minRowGroups) {
      errors.push(`Row groups count ${numRowGroups} is below minimum ${options.minRowGroups}`);
    }
    if (options.maxFileSize && fileSize > options.maxFileSize) {
      errors.push(`File size ${fileSize} exceeds maximum ${options.maxFileSize}`);
    }

    const finalValid = errors.length === 0;

    // 検証失敗時のクリーンアップ
    let cleaned = false;
    if (!finalValid && options.deleteOnFailure) {
      try {
        await bucket.delete(key);
        cleaned = true;
        console.log(`[Validator] Deleted invalid file: ${key}`);
      } catch (deleteError) {
        warnings.push(`Failed to delete invalid file: ${deleteError}`);
      }
    }

    return {
      valid: finalValid,
      fileSize,
      footerSize,
      numRowGroups,
      totalRows,
      rowGroups,
      errors,
      warnings,
      cleaned,
    };
  } catch (error) {
    const errorResult: ParquetFileInfo = {
      valid: false,
      fileSize: 0,
      footerSize: 0,
      numRowGroups: 0,
      totalRows: 0,
      rowGroups: [],
      errors: [`Unexpected error: ${error}`],
      warnings: [],
    };

    // 予期しないエラー時も削除オプションを尊重
    if (options.deleteOnFailure) {
      try {
        await bucket.delete(key);
        errorResult.cleaned = true;
        console.log(`[Validator] Deleted corrupted file: ${key}`);
      } catch (deleteError) {
        errorResult.warnings.push(`Failed to delete corrupted file: ${deleteError}`);
      }
    }

    return errorResult;
  }
}

/**
 * 検証結果を人間可読形式で出力
 */
export function formatValidationReport(info: ParquetFileInfo, key: string): string {
  const lines: string[] = [];
  
  lines.push(`=== Parquet File Validation Report ===`);
  lines.push(`File: ${key}`);
  lines.push(`Status: ${info.valid ? '✓ VALID' : '✗ INVALID'}`);
  lines.push(``);
  
  lines.push(`File size: ${info.fileSize.toLocaleString()} bytes`);
  lines.push(`Footer size: ${info.footerSize.toLocaleString()} bytes`);
  lines.push(`Row Groups: ${info.numRowGroups}`);
  lines.push(`Total Rows: ${info.totalRows.toLocaleString()}`);
  lines.push(``);

  if (info.errors.length > 0) {
    lines.push(`Errors (${info.errors.length}):`);
    info.errors.forEach((err, i) => lines.push(`  ${i + 1}. ${err}`));
    lines.push(``);
  }

  if (info.warnings.length > 0) {
    lines.push(`Warnings (${info.warnings.length}):`);
    info.warnings.forEach((warn, i) => lines.push(`  ${i + 1}. ${warn}`));
    lines.push(``);
  }

  lines.push(`Row Groups Detail:`);
  info.rowGroups.forEach((rg, i) => {
    lines.push(`  RG${i}:`);
    lines.push(`    Offset: ${rg.offset.toLocaleString()}`);
    lines.push(`    Size: ${rg.totalByteSize.toLocaleString()} bytes`);
    lines.push(`    Rows: ${rg.numRows.toLocaleString()}`);
    lines.push(`    Columns: ${rg.columnChunks.length}`);
  });

  return lines.join('\n');
}

/**
 * バッチ検証（複数ファイル）
 */
export async function validateParquetBatch(
  bucket: R2Bucket,
  keys: string[],
  options: ValidateOptions = {}
): Promise<Map<string, ParquetFileInfo>> {
  const results = new Map<string, ParquetFileInfo>();
  
  // 並列検証（最大5並列）
  const batchSize = 5;
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (key) => {
        const info = await validateParquetFile(bucket, key, options);
        return { key, info };
      })
    );
    
    batchResults.forEach(({ key, info }) => {
      results.set(key, info);
    });
  }
  
  return results;
}
