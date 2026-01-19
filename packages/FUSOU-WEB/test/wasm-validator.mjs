import fs from 'fs';
import path from 'path';
import init, { validate_avro_ocf } from '../../avro-wasm/pkg/avro_wasm.js';

function b64ToUint8Array(b64) {
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf);
}

function extractSchemaFromOCF(avroBytes) {
  const header = avroBytes.slice(0, Math.min(avroBytes.length, 4096));
  const text = new TextDecoder().decode(header);
  const idx = text.indexOf('avro.schema');
  if (idx === -1) return null;
  const startBrace = text.indexOf('{', idx);
  if (startBrace === -1) return null;
  let depth = 0;
  let endBrace = -1;
  let inString = false;
  let escapeNext = false;
  for (let i = startBrace; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString) {
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) { endBrace = i; break; } }
    }
  }
  if (endBrace === -1) return null;
  return text.slice(startBrace, endBrace + 1);
}

const b64 = fs.readFileSync('/tmp/sample.avro.b64', 'utf8');
const bytes = b64ToUint8Array(b64);
const schemaJson = extractSchemaFromOCF(bytes);
if (!schemaJson) {
  console.error('Failed to extract schema JSON');
  process.exit(1);
}

const wasmUrl = new URL('../../avro-wasm/pkg/avro_wasm_bg.wasm', import.meta.url);
const wasmBytes = fs.readFileSync(wasmUrl);
await init(wasmBytes);

const result = validate_avro_ocf(bytes, schemaJson);
console.log('WASM validator result:', { valid: result.valid, count: result.record_count, error: result.error_message });
