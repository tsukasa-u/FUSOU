import { readFileSync } from 'fs';
import { parseParquetMetadata } from './src/parquet-compactor.js';

const data = readFileSync('/tmp/test.parquet');

// Read footer
const tailBuf = data.slice(-8);
const magic = tailBuf.slice(-4).toString('ascii');
console.log('Magic:', magic);

const footerSizeView = new DataView(tailBuf.buffer, tailBuf.byteOffset, 4);
const footerSize = footerSizeView.getUint32(0, true);
console.log('Footer size:', footerSize);

const footerStart = data.length - 8 - footerSize;
console.log('Footer starts at:', footerStart);

const footerData = data.slice(footerStart, footerStart + footerSize);

console.log('\nCalling parseParquetMetadata...\n');
const rowGroups = parseParquetMetadata(new Uint8Array(footerData));

console.log('\n=== Result ===');
console.log('Row groups:', rowGroups.length);
rowGroups.forEach((rg, idx) => {
  console.log(`RG ${idx}:`, {
    offset: rg.offset,
    totalByteSize: rg.totalByteSize,
    numRows: rg.numRows,
  });
});
