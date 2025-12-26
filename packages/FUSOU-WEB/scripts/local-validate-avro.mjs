#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

function injectNamespace(schemaJson, ns) {
  const obj = JSON.parse(schemaJson);
  obj.namespace = ns;
  return JSON.stringify(obj);
}

function buildFakeAvro(schemaJson, codec = null) {
  let header = `Obj\x01avro.schema${schemaJson}`;
  if (codec !== null) header += `avro.codec"${codec}"`;
  const payload = Buffer.concat([
    Buffer.from(header, 'utf-8'),
    Buffer.from('\x00\x00\x00\x00DATA', 'binary'),
  ]);
  return payload;
}

function computeSchemaFingerprintHex(schemaJson) {
  return crypto.createHash('sha256').update(Buffer.from(schemaJson, 'utf-8')).digest('hex');
}

function validateHeader(buf, version, allowedMap, table) {
  // Magic
  if (buf.length < 4) return { ok: false, error: 'too small' };
  if (!(buf[0] === 0x4f && buf[1] === 0x62 && buf[2] === 0x6a && buf[3] === 0x01)) {
    return { ok: false, error: 'invalid magic' };
  }
  const text = Buffer.from(buf.slice(0, Math.min(buf.length, 4096))).toString('utf-8');
  // Codec
  const ci = text.indexOf('avro.codec');
  if (ci !== -1) {
    const qs = text.indexOf('"', ci);
    const qe = qs !== -1 ? text.indexOf('"', qs + 1) : -1;
    const cv = qs !== -1 && qe !== -1 ? text.slice(qs + 1, qe) : null;
    if (cv && cv !== 'null') return { ok: false, error: `unsupported codec: ${cv}` };
  }
  // Schema
  const si = text.indexOf('avro.schema');
  if (si === -1) return { ok: false, error: 'missing schema' };
  const sb = text.indexOf('{', si);
  if (sb === -1) return { ok: false, error: 'missing schema json' };
  let depth = 0, eb = -1;
  for (let i = sb; i < text.length; i++) { const ch = text[i]; if (ch === '{') depth++; if (ch === '}') { depth--; if (depth === 0) { eb = i; break; } } }
  if (eb === -1) return { ok: false, error: 'unterminated json' };
  const schemaJson = text.slice(sb, eb + 1);
  let obj;
  try { obj = JSON.parse(schemaJson); } catch { return { ok: false, error: 'invalid json' }; }
  if (!obj || obj.type !== 'record' || !Array.isArray(obj.fields) || obj.fields.length === 0) {
    return { ok: false, error: 'not a record schema' };
  }
  const ns = typeof obj.namespace === 'string' ? obj.namespace : null;
  const expectedNs = `fusou.${version}`;
  if (!ns || ns !== expectedNs) return { ok: false, error: `namespace mismatch: ${ns} != ${expectedNs}` };
  const fp = computeSchemaFingerprintHex(schemaJson);
  const entry = allowedMap[version]?.tables?.[table];
  const list = Array.isArray(entry) ? entry : (entry ? [entry] : []);
  if (!list.length || !list.includes(fp)) return { ok: false, error: 'fingerprint mismatch' };
  return { ok: true };
}

function main() {
  const table = process.argv[2] || 'battle';
  const tamper = process.argv[3] || null; // schema|namespace|codec
  const fingerprintsPath = join(process.cwd(), '../configs/fingerprints.json');
  const allowedMap = JSON.parse(readFileSync(fingerprintsPath, 'utf-8'));
  const kcSchemasPath = join(process.cwd(), '../FUSOU-WORKFLOW/schemas/kc_api_v1.json');
  const kc = JSON.parse(readFileSync(kcSchemasPath, 'utf-8'));
  const entry = kc.schemas.find(s => s.table_name === table);
  if (!entry) { console.error('schema not found'); process.exit(1); }
  let schemaSrc = entry.schema;
  let ns = 'fusou.v1';
  let codec = null;
  if (tamper === 'schema') { const o = JSON.parse(schemaSrc); o.__x__ = 1; schemaSrc = JSON.stringify(o); }
  if (tamper === 'namespace') ns = 'evil.v1';
  if (tamper === 'codec') codec = 'deflate';
  const schemaWithNs = injectNamespace(schemaSrc, ns);
  const buf = buildFakeAvro(schemaWithNs, codec);
  const v = validateHeader(buf, 'v1', allowedMap, table);
  console.log('Result:', v);
  if (!v.ok) { process.exit(1); }
}

main();
