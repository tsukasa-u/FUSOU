#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

function injectNamespace(schemaJson, ns) {
  const obj = JSON.parse(schemaJson);
  obj.namespace = ns;
  return JSON.stringify(obj);
}

function buildFakeAvro(schemaJson) {
  const header = `Obj\x01avro.schema${schemaJson}`;
  const payload = Buffer.concat([
    Buffer.from(header, 'utf-8'),
    Buffer.from('\x00\x00\x00\x00DATA', 'binary'),
  ]);
  return payload;
}

function main() {
  const kcSchemasPath = join(process.cwd(), '../FUSOU-WORKFLOW/schemas/kc_api_v1.json');
  const kc = JSON.parse(readFileSync(kcSchemasPath, 'utf-8'));
  const table = process.argv[2] || 'battle';
  const out = process.argv[3] || `test-${table}.avro`;
  const tamper = process.argv[4] === '--tamper';
  const entry = kc.schemas.find(s => s.table_name === table);
  if (!entry) {
    console.error(`schema not found for table: ${table}`);
    process.exit(1);
  }
  let schemaSrc = entry.schema;
  if (tamper) {
    const obj = JSON.parse(schemaSrc);
    obj.__tamper__ = 'x';
    schemaSrc = JSON.stringify(obj);
  }
  const schemaWithNs = injectNamespace(schemaSrc, 'fusou.v1');
  const buf = buildFakeAvro(schemaWithNs);
  writeFileSync(out, buf);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  console.log(JSON.stringify({ file: out, bytes: buf.length, sha256_hex: hash }, null, 2));
}

main();
