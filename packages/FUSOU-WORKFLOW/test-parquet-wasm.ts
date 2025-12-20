/**
 * hyparquet のテスト
 * ローカルでメタデータパースをテスト
 */

import { readFileSync } from 'fs';
import { parseParquetMetadataFromFullFile } from './src/parquet-compactor';
import { parquetMetadata } from 'hyparquet';

async function testHyparquet() {
  console.log('=== Testing hyparquet ===\n');
  
  // テストファイルのパス
  const testFile = '/tmp/test.parquet';
  
  try {
    // ファイルを読み込み
    const fileData = readFileSync(testFile);
    console.log(`File size: ${fileData.length} bytes\n`);
    
    // Magic number チェック
    const magicStart = fileData.slice(0, 4).toString('ascii');
    const magicEnd = fileData.slice(-4).toString('ascii');
    console.log(`Magic numbers: "${magicStart}" (start), "${magicEnd}" (end)`);
    
    if (magicStart !== 'PAR1' || magicEnd !== 'PAR1') {
      throw new Error('Invalid Parquet file: missing PAR1 magic numbers');
    }
    
    // Footer length を読み取り（最後の8バイトの前4バイト）
    const footerLengthBytes = fileData.slice(-8, -4);
    const footerLength = footerLengthBytes.readUInt32LE(0);
    console.log(`Footer length: ${footerLength} bytes`);
    
    // Footer データを抽出
    const footerStart = fileData.length - 8 - footerLength;
    console.log(`Footer data: ${footerLength} bytes (${footerStart} to ${footerStart + footerLength})\n`);
    
    console.log('--- Direct hyparquet test ---');
    try {
      const footerBuffer = fileData.buffer.slice(
        fileData.byteOffset + footerStart,
        fileData.byteOffset + fileData.byteLength
      );
      
      const metadata = parquetMetadata(footerBuffer);
      console.log('✅ hyparquet.parquetMetadata() succeeded!');
      console.log('Metadata keys:', Object.keys(metadata));
      console.log(`  version: ${metadata.version}`);
      console.log(`  num_rows: ${metadata.num_rows}`);
      console.log(`  row_groups: ${metadata.row_groups ? metadata.row_groups.length : 'undefined'}`);
      
      if (metadata.row_groups) {
        console.log('\n  First Row Group:');
        const rg = metadata.row_groups[0];
        console.log('    Keys:', Object.keys(rg));
        console.log(`    total_byte_size: ${rg.total_byte_size}`);
        console.log(`    num_rows: ${rg.num_rows}`);
        console.log(`    file_offset: ${rg.file_offset}`);
        console.log(`    columns: ${rg.columns?.length || 0}`);
      }
    } catch (err) {
      console.error('❌ hyparquet.parquetMetadata() failed:', err);
      throw err;
    }
    
    console.log('\n--- parseParquetMetadataFromFullFile() test ---');
    try {
      const rowGroups = parseParquetMetadataFromFullFile(fileData);
      console.log('✅ parseParquetMetadataFromFullFile() succeeded!');
      console.log(`  Parsed ${rowGroups.length} Row Groups`);
      
      for (let i = 0; i < Math.min(3, rowGroups.length); i++) {
        const rg = rowGroups[i];
        console.log(`  RG${rg.index}:`);
        console.log(`    offset: ${rg.offset}`);
        console.log(`    totalByteSize: ${rg.totalByteSize}`);
        console.log(`    numRows: ${rg.numRows}`);
        console.log(`    columns: ${rg.columnChunks.length}`);
      }
    } catch (err) {
      console.error('❌ parseParquetMetadataFromFullFile() failed:', err);
      throw err;
    }
    
    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

testHyparquet();
