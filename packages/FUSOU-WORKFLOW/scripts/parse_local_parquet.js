#!/usr/bin/env node
import { readFileSync } from 'fs';
import { parquetMetadata } from 'hyparquet';

const inputPath = process.argv[2] || './0.parquet';
const data = readFileSync(inputPath);

const tail = data.slice(-8);
const magic = tail.slice(4).toString('ascii');
const footerSize = new DataView(tail.buffer, tail.byteOffset, 4).getUint32(0, true);
const footerStart = data.length - 8 - footerSize;

const footerData = data.slice(footerStart, footerStart + footerSize);
const composite = new Uint8Array(footerData.length + 8);
composite.set(footerData, 0);
new DataView(composite.buffer, footerData.length, 4).setUint32(0, footerSize, true);
composite.set(new TextEncoder().encode('PAR1'), footerData.length + 4);

console.log(`[Info] magic='${magic}', footerSize=${footerSize}, footerStart=${footerStart}`);

const meta = parquetMetadata(composite.buffer);
const rgs = meta.row_groups || [];
console.log(`[Info] rowGroups=${rgs.length}`);
rgs.forEach((rg, i) => {
  const numRows = Number(rg.num_rows || 0);
  const totalSize = Number(rg.total_byte_size || 0);
  console.log(`RG ${i}: numRows=${numRows}, totalByteSize=${totalSize}`);
});
