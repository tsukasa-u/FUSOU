#!/usr/bin/env node
/**
 * Compute schema fingerprints from kc-api-database extracted schemas.
 * Generates TABLE_FINGERPRINTS_JSON format for environment configuration.
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';

/**
 * Compute SHA-256 fingerprint of raw schema JSON.
 * No namespace manipulation — hash must match what OCF headers contain.
 */
function computeFingerprint(schemaJson) {
  return createHash('sha256').update(schemaJson).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node compute-kc-api-fingerprints.mjs <schema-file.json> ...');
    process.exit(1);
  }

  const results = {};

  for (const schemaFile of args) {
    console.error(`Processing ${schemaFile}...`);
    
    const content = readFileSync(schemaFile, 'utf-8');
    const schemaData = JSON.parse(content);

    const tableVersion = schemaData.table_version || 'unknown';
    const schemas = schemaData.schemas || [];

    console.error(`  TABLE_VERSION: ${tableVersion}`);

    // Compute fingerprints for each table schema (raw, no namespace manipulation)
    const tableFingerprints = {};
    for (const schemaEntry of schemas) {
      const tableName = schemaEntry.table_name;
      const fingerprint = computeFingerprint(schemaEntry.schema);
      tableFingerprints[tableName] = [fingerprint];
      console.error(`  ${tableName}: ${fingerprint}`);
    }

    // Use table_version as the key (e.g., "0.4", "0.5", "0.6")
    results[tableVersion] = {
      tables: tableFingerprints
    };
  }

  // Output final JSON
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
