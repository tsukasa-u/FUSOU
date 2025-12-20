/**
 * ローカル診断スクリプト：抽出済みParquetファイルのRowGroup検証
 * 
 * 使用方法:
 *   npx tsx test-merge-diagnostics.ts /path/to/extracted_fragment.parquet
 * 
 * 出力：
 *   - ファイルヘッダー/フッター構造
 *   - RowGroupメタデータ（offset, totalByteSize, numRows等）
 *   - footerStartに対する各RGの範囲チェック結果
 */

import { readFileSync } from 'fs';
import { parseParquetMetadataFromFullFile } from './src/parquet-compactor.js';

if (process.argv.length < 3) {
  console.error('Usage: npx tsx test-merge-diagnostics.ts <path-to-parquet-file>');
  process.exit(1);
}

const filePath = process.argv[2];
console.log(`[Diagnostics] Loading: ${filePath}\n`);

try {
  const data = readFileSync(filePath);
  const buf = new Uint8Array(data);
  
  console.log('=== File Structure ===');
  console.log(`File size: ${buf.length} bytes`);
  
  // Check header magic
  const headerMagic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  console.log(`Header magic (bytes 0-3): '${headerMagic}' ${headerMagic === 'PAR1' ? '✓' : '✗ INVALID'}`);
  
  // Check footer
  const footerMagic = String.fromCharCode(buf[buf.length-4], buf[buf.length-3], buf[buf.length-2], buf[buf.length-1]);
  console.log(`Footer magic (bytes -4 to -1): '${footerMagic}' ${footerMagic === 'PAR1' ? '✓' : '✗ INVALID'}`);
  
  // Read footer size
  const sizeBytes = buf.slice(buf.length - 8, buf.length - 4);
  const footerSize = (sizeBytes[0]) | (sizeBytes[1] << 8) | (sizeBytes[2] << 16) | (sizeBytes[3] << 24);
  const footerStart = buf.length - 8 - footerSize;
  
  console.log(`Footer size (4B LE at -8 to -5): ${footerSize} bytes`);
  console.log(`Footer region: bytes ${footerStart} to ${buf.length - 8}`);
  console.log(`Data region (before footer): bytes 0 to ${footerStart}\n`);
  
  // Parse metadata
  console.log('=== Parsing Metadata ===');
  let rowGroups;
  try {
    rowGroups = parseParquetMetadataFromFullFile(buf);
    console.log(`✓ Successfully parsed metadata`);
  } catch (err) {
    console.error(`✗ Failed to parse metadata:`, err instanceof Error ? err.message : String(err));
    console.log('\nHex dump of footer (first 64 bytes):');
    const footerSnippet = buf.slice(footerStart, Math.min(footerStart + 64, buf.length - 8));
    console.log(Array.from(footerSnippet).map(b => b.toString(16).padStart(2, '0')).join(' '));
    process.exit(1);
  }
  
  console.log(`\n=== RowGroup Analysis (${rowGroups.length} total) ===\n`);
  
  let validCount = 0;
  let invalidCount = 0;
  
  for (let i = 0; i < rowGroups.length; i++) {
    const rg = rowGroups[i];
    const hasOffset = rg.offset !== undefined;
    const hasSize = rg.totalByteSize !== undefined;
    const numRows = rg.numRows ?? 0;
    
    console.log(`[RG ${i}]`);
    console.log(`  offset: ${hasOffset ? rg.offset : '(undefined)'}`);
    console.log(`  totalByteSize: ${hasSize ? rg.totalByteSize : '(undefined)'}`);
    console.log(`  numRows: ${numRows}`);
    
    if (!hasOffset || !hasSize) {
      console.log(`  ✗ INVALID: Missing offset or totalByteSize`);
      invalidCount++;
      console.log();
      continue;
    }
    
    if (numRows <= 0) {
      console.log(`  ⚠ ZERO_ROWS: numRows=${numRows}`);
      invalidCount++;
      console.log();
      continue;
    }
    
    // Range check
    const rgStart = rg.offset;
    const rgEnd = rg.offset + rg.totalByteSize;
    
    if (rgStart < 0) {
      console.log(`  ✗ INVALID: offset < 0`);
      invalidCount++;
    } else if (rgEnd > footerStart) {
      console.log(`  ✗ INVALID: range [${rgStart}, ${rgEnd}) exceeds data region (0, ${footerStart})`);
      invalidCount++;
    } else {
      console.log(`  ✓ VALID: range [${rgStart}, ${rgEnd})`);
      validCount++;
    }
    console.log();
  }
  
  console.log('=== Summary ===');
  console.log(`Valid RGs: ${validCount}`);
  console.log(`Invalid RGs: ${invalidCount}`);
  console.log(`\nResult: ${validCount > 0 ? '✓ Can merge' : '✗ Will skip (all invalid or zero-row)'}`);
  
} catch (err) {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
