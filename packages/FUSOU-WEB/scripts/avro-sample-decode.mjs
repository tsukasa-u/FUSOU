#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join } from 'path';
import avro from 'avsc';

function usage() {
  console.log(`\nAvro Sample Encode/Decode Test (offline)\n\nUsage:\n  node scripts/avro-sample-decode.mjs [table]\n\nExamples:\n  node scripts/avro-sample-decode.mjs battle\n`);
}

function buildMinimalRecord(schema) {
  const rec = {};
  for (const f of schema.fields) {
    const name = f.name;
    let type = f.type;
    
    // Handle union types (e.g., ["null", "string"] or ["null", "long"])
    if (Array.isArray(type)) {
      if (type.includes('null')) rec[name] = null;
      else if (type.includes('string')) rec[name] = '';
      else if (type.includes('int') || type.includes('long')) rec[name] = 0;
      else if (type.includes('float') || type.includes('double')) rec[name] = 0.0;
      else if (type.includes('boolean')) rec[name] = false;
      else rec[name] = null;
    } 
    // Handle object type definitions (e.g., { "type": "string" })
    else if (typeof type === 'object' && type.type) {
      const innerType = type.type;
      if (innerType === 'string') rec[name] = '';
      else if (innerType === 'int' || innerType === 'long') rec[name] = 0;
      else if (innerType === 'float' || innerType === 'double') rec[name] = 0.0;
      else if (innerType === 'boolean') rec[name] = false;
      else if (innerType === 'array') rec[name] = [];
      else if (innerType === 'map') rec[name] = {};
      else if (innerType === 'record') rec[name] = buildMinimalRecord(type);
      else rec[name] = null;
    }
    // Handle primitive type strings
    else if (type === 'string') rec[name] = '';
    else if (type === 'int' || type === 'long') rec[name] = 0;
    else if (type === 'float' || type === 'double') rec[name] = 0.0;
    else if (type === 'boolean') rec[name] = false;
    else rec[name] = null;
  }
  return rec;
}

function main() {
  const table = process.argv[2] || 'battle';
  const kcSchemasPath = join(process.cwd(), '../FUSOU-WORKFLOW/schemas/kc_api_v1.json');
  const kc = JSON.parse(readFileSync(kcSchemasPath, 'utf-8'));
  const entry = kc.schemas.find(s => s.table_name === table);
  if (!entry) { console.error('schema not found'); process.exit(1); }
  const schemaObj = JSON.parse(entry.schema);
  if (schemaObj.type !== 'record' || !Array.isArray(schemaObj.fields) || !schemaObj.fields.length) {
    console.error('invalid record schema');
    process.exit(1);
  }
  // Ensure namespace is present (for name resolution)
  schemaObj.namespace = schemaObj.namespace || 'fusou.v1';

  const type = avro.Type.forSchema(schemaObj);
  const sample = buildMinimalRecord(schemaObj);
  try {
    const buf = type.toBuffer(sample); // Encode single datum (not OCF)
    const roundtrip = type.fromBuffer(buf); // Decode
    console.log('Encode/Decode success:', { table, encodedBytes: buf.length });
    console.log('Sample record:', sample);
    console.log('Roundtrip record:', roundtrip);
  } catch (e) {
    console.error('Encode/Decode failed:', e.message);
    process.exit(1);
  }
}

main();
