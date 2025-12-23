import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const modPath = path.join(__dirname, '../dist/avro-append.js');
if (!fs.existsSync(modPath)) {
  console.error('Compiled module not found at', modPath);
  console.error('Run: npx tsc --outDir dist');
  process.exit(2);
}

const { buildAvroContainer, getAvroHeaderLengthFromPrefix, getAvroHeaderLength } = await import(modPath);
import avro from 'avsc';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function randomString(len) {
  return 'x'.repeat(len);
}

async function run() {
  console.log('Test 1: small records roundtrip');
  const recs1 = [{ a: 1 }, { a: 2 }, { a: 3 }];
  const buf1 = buildAvroContainer(recs1);
  assert(buf1 instanceof Uint8Array, 'buf1 not Uint8Array');
  const headerLen1 = getAvroHeaderLength(buf1);
  console.log(' headerLen1=', headerLen1);

  // decode with avsc BlockDecoder
  const { streams } = avro;
  const { BlockDecoder } = streams;
  const { Readable } = await import('stream');
  const decoded1 = [];
  await new Promise((resolve, reject) => {
    const decoder = new BlockDecoder();
    const rs = Readable.from([Buffer.from(buf1)]);
    rs.pipe(decoder)
      .on('data', (d) => decoded1.push(d))
      .on('end', resolve)
      .on('error', reject);
  });
  assert(decoded1.length >= recs1.length, 'decoded1 shorter than input');
  console.log('  decoded records >= expected:', decoded1.length);

  console.log('Test 2: large record (100KB string)');
  const large = { msg: randomString(100 * 1024) };
  const recs2 = [large, { msg: 'small' }];
  const buf2 = buildAvroContainer(recs2);
  assert(buf2.length > 100 * 1024, 'buf2 unexpected small');
  console.log('  built buffer length:', buf2.length);

  console.log('Test 3: header prefix parsing');
  const prefixLenGuess = Math.min(buf2.length, headerLen1 + 32);
  const prefix = buf2.subarray(0, prefixLenGuess);
  const parsed = getAvroHeaderLengthFromPrefix(prefix);
  assert(parsed > 0 && parsed <= buf2.length, 'invalid parsed header length');
  console.log('  parsed header length from prefix:', parsed);

  console.log('Test 4: insufficient prefix should throw');
  let threw = false;
  try {
    getAvroHeaderLengthFromPrefix(buf2.subarray(0, 2));
  } catch (e) {
    threw = true;
  }
  assert(threw, 'expected throw on insufficient prefix');

  console.log('\nAll tests passed');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(3);
});
