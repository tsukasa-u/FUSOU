#!/usr/bin/env node
/**
 * Compute SHA-256 fingerprints for Avro schemas.
 * 
 * Usage:
 *   node scripts/compute-schema-fingerprints.mjs schemas/*.avsc
 *   node scripts/compute-schema-fingerprints.mjs path/to/schema.json
 * 
 * Output:
 *   Prints JSON to stdout, e.g. {"v1":"<sha256>","v2":"<sha256>"}
 * 
 * Notes:
 * - Expects each schema JSON to contain a `namespace` like "fusou.v1".
 * - Fingerprint is computed on the canonical JSON string of the schema.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use the built implementation for SHA-256 to match runtime
import { computeSchemaFingerprint } from '../dist/avro-manual.js';

function usageAndExit(msg) {
  if (msg) console.error(msg);
  console.error('\nUsage:');
  console.error('  node scripts/compute-schema-fingerprints.mjs <schema.json|*.avsc>...');
  console.error('\nExample:');
  console.error('  node scripts/compute-schema-fingerprints.mjs schemas/battle_result.v1.avsc schemas/battle_result.v2.avsc');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usageAndExit('No schema files provided.');

  const map = {}; // { version: fingerprint }

  for (const p of args) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) usageAndExit(`File not found: ${p}`);
    const text = fs.readFileSync(abs, 'utf-8');

    let schema;
    try {
      schema = JSON.parse(text);
    } catch (e) {
      usageAndExit(`Failed to parse JSON for ${p}: ${e.message}`);
    }

    const ns = typeof schema.namespace === 'string' ? schema.namespace : '';
    const match = ns.match(/fusou\.(v[\w\-]+)/);
    if (!match) usageAndExit(`Schema namespace must include version like fusou.v1: ${ns}`);
    const version = match[1]; // e.g. v1

    // Canonicalize JSON (sort keys) to ensure stable hash
    const canonical = JSON.stringify(schema, Object.keys(schema).sort());
    const fp = await computeSchemaFingerprint(canonical);

    map[version] = fp;
  }

  // Print compact JSON for env var usage
  process.stdout.write(JSON.stringify(map));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
