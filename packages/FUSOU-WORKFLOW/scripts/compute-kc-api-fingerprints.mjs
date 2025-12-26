#!/usr/bin/env node
/**
 * Compute schema fingerprints from kc-api-database extracted schemas.
 * Generates SCHEMA_FINGERPRINTS_JSON format for environment configuration.
 */

import { readFileSync } from 'fs';
import { computeSchemaFingerprint } from '../dist/avro-manual.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node compute-kc-api-fingerprints.mjs <schema-file.json>');
    console.error('Example: node compute-kc-api-fingerprints.mjs schemas/kc_api_v1.json');
    console.error('Note: Only v1 is currently generated; v2+ will be added as needed.');
    process.exit(1);
  }

  const results = {};

  for (const schemaFile of args) {
    console.error(`Processing ${schemaFile}...`);
    
    const content = readFileSync(schemaFile, 'utf-8');
    const schemaData = JSON.parse(content);

    // Extract version from filename (e.g., kc_api_v1.json -> v1)
    const versionMatch = schemaFile.match(/v(\d+)\.json$/);
    if (!versionMatch) {
      console.error(`Warning: Could not extract version from filename ${schemaFile}, skipping`);
      continue;
    }
    const version = `v${versionMatch[1]}`;

    // Extract table_version and schemas array from new format
    const tableVersion = schemaData.table_version || 'unknown';
    const schemas = schemaData.schemas || [];

    console.error(`  TABLE_VERSION: ${tableVersion}`);

    // Compute fingerprints for each table schema
    const tableFingerprints = {};
    for (const schemaEntry of schemas) {
      const tableName = schemaEntry.table_name;
      const schemaJson = schemaEntry.schema;

      // Parse the schema to add namespace
      const schemaParsed = JSON.parse(schemaJson);
      schemaParsed.namespace = `fusou.${version}`;
      
      const schemaWithNamespace = JSON.stringify(schemaParsed);
      const fingerprint = await computeSchemaFingerprint(schemaWithNamespace);
      // Store as array to allow multiple backward-compatible hashes per table
      tableFingerprints[tableName] = [fingerprint];
      console.error(`  ${tableName}: ${fingerprint}`);
    }

    results[version] = {
      table_version: tableVersion,
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
