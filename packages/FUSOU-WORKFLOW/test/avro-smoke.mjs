import { buildAvroContainer, getAvroHeaderLengthFromPrefix } from '../dist/FUSOU-WORKFLOW/src/avro-manual.js';

const records = [
  { id: 1, name: 'alpha', score: 12.5, active: true },
  { id: 2, name: 'beta', score: 3.14, active: false },
];

const buf = buildAvroContainer(records);

const headerLen = getAvroHeaderLengthFromPrefix(buf);
console.log('[avro-smoke] header bytes:', headerLen);
if (!(buf[0] === 0x4f && buf[1] === 0x62 && buf[2] === 0x6a && buf[3] === 0x01)) {
  throw new Error('Invalid Avro magic bytes');
}
if (headerLen <= 21) {
  throw new Error(`Unexpectedly short Avro header length: ${headerLen}`);
}
console.log('[avro-smoke] parser/builder OK');
