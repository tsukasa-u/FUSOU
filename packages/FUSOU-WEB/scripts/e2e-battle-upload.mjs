#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

function usage() {
  console.log(`
E2E Battle Upload Test

Usage:
  node scripts/e2e-battle-upload.mjs --jwt <token> [--base <url>] [--table battle] [--tamper schema|namespace|codec]

Examples:
  node scripts/e2e-battle-upload.mjs --jwt $JWT --base http://127.0.0.1:8788/api/battle-data
  node scripts/e2e-battle-upload.mjs --jwt $JWT --base https://your.pages.dev/api/battle-data --tamper schema
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { jwt: null, base: 'http://127.0.0.1:8788/api/battle-data', table: 'battle', tamper: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--jwt') out.jwt = args[++i];
    else if (a === '--base') out.base = args[++i];
    else if (a === '--table') out.table = args[++i];
    else if (a === '--tamper') out.tamper = args[++i];
    else if (a === '--help') { usage(); process.exit(0); }
  }
  if (!out.jwt) {
    console.error('Missing --jwt');
    usage();
    process.exit(1);
  }
  return out;
}

function injectNamespace(schemaJson, ns) {
  const obj = JSON.parse(schemaJson);
  obj.namespace = ns;
  return JSON.stringify(obj);
}

function buildFakeAvro(schemaJson, codec = null) {
  // Minimal Avro-like payload suitable for header scanning
  let header = `Obj\x01avro.schema${schemaJson}`;
  if (codec !== null) {
    header += `avro.codec"${codec}"`;
  }
  const payload = Buffer.concat([
    Buffer.from(header, 'utf-8'),
    Buffer.from('\x00\x00\x00\x00DATA', 'binary'),
  ]);
  return payload;
}

async function postJson(url, jwt, body) {
  const res = await fetch(url + '/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}

async function postBinary(uploadUrl, jwt, buf) {
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/octet-stream'
    },
    body: buf
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}

async function run() {
  const { jwt, base, table, tamper } = parseArgs();
  const kcSchemasPath = join(process.cwd(), '../FUSOU-WORKFLOW/schemas/kc_api_v1.json');
  const kc = JSON.parse(readFileSync(kcSchemasPath, 'utf-8'));
  const entry = kc.schemas.find(s => s.table_name === table);
  if (!entry) {
    console.error(`schema not found for table: ${table}`);
    process.exit(1);
  }

  let schemaSrc = entry.schema;
  let ns = 'fusou.v1';
  let codec = null;
  if (tamper === 'schema') {
    const obj = JSON.parse(schemaSrc);
    obj.__tamper__ = 'x';
    schemaSrc = JSON.stringify(obj);
  } else if (tamper === 'namespace') {
    ns = 'evil.v1';
  } else if (tamper === 'codec') {
    codec = 'deflate';
  }

  const schemaWithNs = injectNamespace(schemaSrc, ns);
  const avroBuf = buildFakeAvro(schemaWithNs, codec);
  const hashHex = crypto.createHash('sha256').update(avroBuf).digest('hex');

  // Stage 1: Preparation
  const prepBody = {
    dataset_id: `e2e-${Date.now()}`,
    table,
    kc_period_tag: 'latest',
    file_size: String(avroBuf.length),
    path: `e2e/${table}/${Date.now()}.avro`,
    binary: true,
    content_hash: hashHex,
    schema_version: 'v1'
  };
  const prep = await postJson(base, jwt, prepBody);
  console.log('Preparation:', prep);
  if (prep.status !== 200 || !prep.json?.uploadUrl) {
    console.error('Preparation failed');
    process.exit(1);
  }

  // Stage 2: Execution
  const exec = await postBinary(prep.json.uploadUrl, jwt, avroBuf);
  console.log('Execution:', exec);
  if (tamper) {
    if (exec.status === 400) {
      console.log('Tamper test passed: upload rejected as expected');
    } else {
      console.error('Tamper test failed: expected 400');
      process.exit(1);
    }
  } else {
    if (exec.status === 200) {
      console.log('Valid upload test passed: 200 OK');
    } else {
      console.error('Valid upload test failed: expected 200');
      process.exit(1);
    }
  }
}

run().catch(err => { console.error(err); process.exit(1); });
