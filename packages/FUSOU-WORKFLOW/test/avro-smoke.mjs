import { buildAvroContainer } from '../dist/avro-manual.js';

const records = [
  { id: 1, name: 'alpha', score: 12.5, active: true },
  { id: 2, name: 'beta', score: 3.14, active: false },
];

const buf = buildAvroContainer(records);
console.log('[avro-smoke] container bytes:', buf.length);
console.log('[avro-smoke] first 8 bytes:', Array.from(buf.slice(0, 8)));
if (!(buf[0] === 0x4f && buf[1] === 0x62 && buf[2] === 0x6a && buf[3] === 0x01)) {
  throw new Error('Invalid Avro magic bytes');
}
console.log('[avro-smoke] magic OK');
