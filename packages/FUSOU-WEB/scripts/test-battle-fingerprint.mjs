#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

function injectNamespace(schemaJson, ns) {
  const obj = JSON.parse(schemaJson);
  obj.namespace = ns;
  return JSON.stringify(obj);
}

function computeSha256Hex(str) {
  return crypto.createHash('sha256').update(Buffer.from(str, 'utf-8')).digest('hex');
}

function extractAllowedFingerprint(table) {
  const tomlPath = join(process.cwd(), 'wrangler.toml');
  const toml = readFileSync(tomlPath, 'utf-8');
  const match = toml.match(/SCHEMA_FINGERPRINTS_JSON\s*=\s*"""([\s\S]*?)"""/);
  if (!match) return null;
  const json = match[1];
  const map = JSON.parse(json);
  const entry = map?.v1?.tables?.[table];
  if (!entry) return null;
  return Array.isArray(entry) ? entry[0] : entry;
}

function main() {
  const kcSchemasPath = join(process.cwd(), '../FUSOU-WORKFLOW/schemas/kc_api_v1.json');
  const kc = JSON.parse(readFileSync(kcSchemasPath, 'utf-8'));
  const battle = kc.schemas.find(s => s.table_name === 'battle');
  if (!battle) {
    console.error('battle schema not found');
    process.exit(1);
  }
  const schemaWithNs = injectNamespace(battle.schema, 'fusou.v1');
  const fp = computeSha256Hex(schemaWithNs);
  const allowed = extractAllowedFingerprint('battle');
  console.log('Computed:', fp);
  console.log('Allowed :', allowed);
  if (fp !== allowed) {
    console.error('Mismatch: fingerprint does not match allowlist');
    process.exit(1);
  }
  console.log('OK: fingerprint matches allowlist');
}

main();
