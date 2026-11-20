#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const GENERATED_SCHEMAS_DIR = resolve(REPO_ROOT, "packages/kc_api/generated-schemas");
const OUTPUT_PATH = resolve(__dirname, "../src/data/avro-schema-registry.json");

function parseVersionTuple(version) {
  return version
    .replace(/^v/, "")
    .split("_")
    .map((part) => Number.parseInt(part, 10));
}

function compareVersions(a, b) {
  const pa = parseVersionTuple(a);
  const pb = parseVersionTuple(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

function main() {
  if (!existsSync(GENERATED_SCHEMAS_DIR)) {
    throw new Error(`Generated schemas directory not found: ${GENERATED_SCHEMAS_DIR}`);
  }

  const schemaFiles = readdirSync(GENERATED_SCHEMAS_DIR)
    .map((name) => {
      const m = /^schema_(v[0-9]+_[0-9]+(?:_[0-9]+)?)\.json$/.exec(name);
      return m ? { name, version: m[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => compareVersions(a.version, b.version));

  if (!schemaFiles.length) {
    throw new Error("No schema_v*.json files found");
  }

  const schemaPool = [];
  const schemaIndexByJson = new Map();
  const versions = [];

  for (const { name, version } of schemaFiles) {
    const raw = JSON.parse(readFileSync(resolve(GENERATED_SCHEMAS_DIR, name), "utf8"));
    const tableVersion = String(raw.table_version ?? "");
    const tables = {};

    for (const entry of raw.schemas ?? []) {
      const tableName = String(entry.table_name);
      const schemaJson = String(entry.schema);
      let idx = schemaIndexByJson.get(schemaJson);
      if (idx === undefined) {
        idx = schemaPool.length;
        schemaPool.push(schemaJson);
        schemaIndexByJson.set(schemaJson, idx);
      }
      tables[tableName] = idx;
    }

    versions.push({
      version,
      table_version: tableVersion,
      tables,
    });
  }

  const output = {
    schemas: schemaPool,
    versions,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(
    `✓ avro schema registry: ${versions.length} versions, ${schemaPool.length} unique schemas → ${OUTPUT_PATH}`,
  );
}

main();
