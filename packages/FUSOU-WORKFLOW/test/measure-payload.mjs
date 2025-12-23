import fs from 'fs';
import path from 'path';
const mod = path.join(process.cwd(), 'dist', 'avro-append.js');
if (!fs.existsSync(mod)) {
  console.error('dist/avro-append.js not found — run: npx tsc --outDir dist');
  process.exit(2);
}

const { buildAvroContainer } = await import(mod);

function makeRecord(size) {
  return { payload: 'x'.repeat(size) };
}

function printSize(label, buf) {
  const bytes = buf.length || buf.byteLength || 0;
  const kb = (bytes / 1024).toFixed(2);
  console.log(`${label}: ${bytes} bytes (${kb} KB)`);
}

function measure(count, recSize) {
  const records = Array.from({ length: count }, () => makeRecord(recSize));
  const buf = buildAvroContainer(records);
  printSize(`${count} x ${recSize}B record(s)`, buf);
}

console.log('Measuring payload sizes for various record sizes (this simulates one queue batch -> one Avro file)');
measure(200, 100); // 100B
measure(200, 1024); // 1KB
measure(200, 10 * 1024); // 10KB
measure(200, 100 * 1024); // 100KB

// Also show dist files sizes
console.log('\nDist files:');
const distDir = path.join(process.cwd(), 'dist');
for (const f of fs.readdirSync(distDir)) {
  const st = fs.statSync(path.join(distDir, f));
  console.log(` - ${f}: ${st.size} bytes`);
}
