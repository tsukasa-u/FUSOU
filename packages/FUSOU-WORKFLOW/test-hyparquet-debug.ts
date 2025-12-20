/**
 * Hyparquet 詳細デバッグテスト
 */

import { readFileSync } from 'fs';
import { parquetMetadata } from 'hyparquet';

const testFile = '/tmp/test.parquet';

try {
  const fileData = readFileSync(testFile);
  console.log(`File size: ${fileData.length} bytes\n`);
  
  // Magic number check
  const magicStart = fileData.slice(0, 4).toString('ascii');
  const magicEnd = fileData.slice(-4).toString('ascii');
  console.log(`Magic: start="${magicStart}", end="${magicEnd}"`);
  
  if (magicStart !== 'PAR1' || magicEnd !== 'PAR1') {
    throw new Error('Invalid Parquet file');
  }
  
  // Footer size
  const view = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
  const footerSize = view.getUint32(fileData.byteLength - 8, true);
  console.log(`Footer size: ${footerSize} bytes`);
  
  // Extract footer buffer (metadata + size + PAR1)
  const footerStart = fileData.byteLength - footerSize - 8;
  const footerBuffer = fileData.buffer.slice(
    fileData.byteOffset + footerStart,
    fileData.byteOffset + fileData.byteLength
  );
  
  console.log(`Footer buffer: ${footerBuffer.byteLength} bytes (offset ${footerStart})\n`);
  
  // Parse with hyparquet
  console.log('=== Parsing with hyparquet ===');
  const metadata = parquetMetadata(footerBuffer);
  
  console.log('Metadata structure:');
  console.log(`  version: ${metadata.version}`);
  console.log(`  num_rows: ${metadata.num_rows}`);
  console.log(`  created_by: ${metadata.created_by || 'N/A'}`);
  console.log(`  schema: ${metadata.schema ? metadata.schema.length : 0} elements`);
  console.log(`  row_groups: ${metadata.row_groups ? metadata.row_groups.length : 0} groups`);
  
  if (metadata.schema && metadata.schema.length > 0) {
    console.log('\n  Schema elements:');
    metadata.schema.slice(0, 5).forEach((elem, idx) => {
      console.log(`    [${idx}] ${elem.name} (type: ${elem.type}, repetition: ${elem.repetition_type})`);
    });
    if (metadata.schema.length > 5) {
      console.log(`    ... and ${metadata.schema.length - 5} more`);
    }
  }
  
  if (metadata.row_groups && metadata.row_groups.length > 0) {
    console.log('\n  Row Groups:');
    metadata.row_groups.forEach((rg, idx) => {
      console.log(`    [${idx}]`);
      console.log(`      total_byte_size: ${rg.total_byte_size}`);
      console.log(`      num_rows: ${rg.num_rows}`);
      console.log(`      file_offset: ${rg.file_offset}`);
      console.log(`      columns: ${rg.columns?.length || 0}`);
    });
  } else {
    console.log('\n  ⚠️ No row groups found!');
    console.log('  This could mean:');
    console.log('    1. The file has no data (empty parquet file)');
    console.log('    2. The footer is corrupted');
    console.log('    3. The file format is incompatible with hyparquet');
  }
  
  console.log('\n✅ Test complete');
  
} catch (error) {
  console.error('\n❌ Error:', error);
  process.exit(1);
}
