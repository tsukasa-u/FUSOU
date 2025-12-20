import { readFileSync } from 'fs';
import { parseParquetMetadataFromFullFile } from './src/parquet-compactor';

const fileData = readFileSync('/tmp/userdata1.parquet');
console.log('Testing with userdata1.parquet (' + fileData.length + ' bytes)\n');

try {
  const rowGroups = parseParquetMetadataFromFullFile(fileData);
  console.log('\n✅ SUCCESS! Parsed', rowGroups.length, 'Row Groups\n');
  
  rowGroups.slice(0, 3).forEach((rg, idx) => {
    console.log(`RG${idx}:`);
    console.log(`  offset: ${rg.offset}`);
    console.log(`  totalByteSize: ${rg.totalByteSize}`);
    console.log(`  numRows: ${rg.numRows}`);
    console.log(`  columns: ${rg.columnChunks.length}`);
  });
  
  if (rowGroups.length > 3) {
    console.log(`... and ${rowGroups.length - 3} more row groups`);
  }
} catch (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}
