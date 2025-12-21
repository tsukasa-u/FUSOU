import { readFileSync } from 'fs';
import { parseParquetMetadata } from './src/parquet-compactor.js';

// Allow passing a file path; default to ./0.parquet
const inputPath = process.argv[2] || './0.parquet';
const data = readFileSync(inputPath);

// Read footer
const tailBuf = data.slice(-8);
const magic = tailBuf.slice(-4).toString('ascii');
console.log('Magic:', magic);

const footerSizeView = new DataView(tailBuf.buffer, tailBuf.byteOffset, 4);
const footerSize = footerSizeView.getUint32(0, true);
console.log('Footer size:', footerSize);

const footerStart = data.length - 8 - footerSize;
console.log('Footer starts at:', footerStart);

// Build composite buffer: [footer][size(LE)][PAR1]
const footerData = data.slice(footerStart, footerStart + footerSize);
const composite = new Uint8Array(footerData.length + 8);
composite.set(footerData, 0);
new DataView(composite.buffer, footerData.length, 4).setUint32(0, footerSize, true);
composite.set(new TextEncoder().encode('PAR1'), footerData.length + 4);

console.log('\nCalling parseParquetMetadata...\n');
const rowGroups = parseParquetMetadata(composite);

console.log('\n=== Result ===');
console.log('Row groups:', rowGroups.length);
rowGroups.forEach((rg, idx) => {
  console.log(`RG ${idx}:`, {
    offset: rg.offset,
    totalByteSize: rg.totalByteSize,
    numRows: rg.numRows,
  });
});
