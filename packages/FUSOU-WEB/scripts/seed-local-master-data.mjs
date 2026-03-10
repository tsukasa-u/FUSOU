#!/usr/bin/env node
/**
 * seed-local-master-data.mjs
 *
 * Downloads master data from remote Cloudflare R2/D1 and seeds
 * the local wrangler emulation (used by `astro dev` with platformProxy).
 *
 * Usage:
 *   node scripts/seed-local-master-data.mjs
 *
 * Prerequisites:
 *   - `npx wrangler login` (authenticated with Cloudflare)
 *   - wrangler.toml configured with correct R2/D1 bindings
 */

import { execSync } from "child_process";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const BUCKET = "dev-kc-master-data";
const DB_NAME = "dev_kc_master_data_index";
const TMP_DIR = join(process.cwd(), ".seed-tmp");

// Tables needed for the simulator
const REQUIRED_TABLES = [
  "mst_ship",
  "mst_slotitem",
  "mst_stype",
  "mst_slotitem_equiptype",
];

// All 13 tables for completeness
const ALL_TABLES = [
  "mst_ship",
  "mst_shipgraph",
  "mst_slotitem",
  "mst_slotitem_equiptype",
  "mst_payitem",
  "mst_equip_exslot",
  "mst_equip_exslot_ship",
  "mst_equip_limit_exslot",
  "mst_equip_ship",
  "mst_stype",
  "mst_map_area",
  "mst_map_info",
  "mst_ship_upgrade",
];

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

function runQuiet(cmd) {
  try {
    return run(cmd);
  } catch (e) {
    return e.stderr || e.stdout || "";
  }
}

async function main() {
  const useAll = process.argv.includes("--all");
  const tables = useAll ? ALL_TABLES : REQUIRED_TABLES;

  console.log("=== Local Master Data Seeder ===");
  console.log(`Tables to seed: ${tables.join(", ")}`);
  console.log();

  // Step 1: Query remote D1 for latest completed entry
  console.log("[1/4] Querying remote D1 for latest master data...");
  let remoteRecord;
  try {
    const output = run(
      `npx wrangler d1 execute ${DB_NAME} --remote --command "SELECT period_tag, table_version, r2_keys FROM master_data_index WHERE upload_status = 'completed' ORDER BY completed_at DESC LIMIT 1;" --json`
    );
    const parsed = JSON.parse(output);
    const results = parsed?.[0]?.results;
    if (!results || results.length === 0) {
      console.error("No completed master data found in remote D1.");
      process.exit(1);
    }
    remoteRecord = results[0];
    console.log(
      `  Found: period=${remoteRecord.period_tag}, version=${remoteRecord.table_version}`
    );
  } catch (e) {
    console.error("Failed to query remote D1. Are you logged in? (npx wrangler login)");
    console.error(e.message);
    process.exit(1);
  }

  const { period_tag, table_version, r2_keys } = remoteRecord;

  // Step 2: Create local D1 schema if needed
  console.log("[2/4] Ensuring local D1 schema...");
  runQuiet(
    `npx wrangler d1 execute ${DB_NAME} --command "CREATE TABLE IF NOT EXISTS master_data_index (id INTEGER PRIMARY KEY AUTOINCREMENT, period_tag TEXT NOT NULL, table_version TEXT NOT NULL DEFAULT '0.4', content_hash TEXT NOT NULL, r2_keys TEXT, upload_status TEXT DEFAULT 'pending', uploaded_by TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER, UNIQUE(period_tag)); CREATE INDEX IF NOT EXISTS idx_master_data_by_period ON master_data_index(period_tag); CREATE INDEX IF NOT EXISTS idx_master_data_by_status_created ON master_data_index(upload_status, created_at); CREATE INDEX IF NOT EXISTS idx_master_data_by_version ON master_data_index(table_version);"`
  );

  // Delete existing record for this period to allow re-seeding
  runQuiet(
    `npx wrangler d1 execute ${DB_NAME} --command "DELETE FROM master_data_index WHERE period_tag = '${period_tag}';"`
  );

  // Insert record
  const r2KeysEscaped = r2_keys.replace(/'/g, "''");
  const now = Math.floor(Date.now() / 1000);
  run(
    `npx wrangler d1 execute ${DB_NAME} --command "INSERT INTO master_data_index (period_tag, table_version, content_hash, r2_keys, upload_status, uploaded_by, created_at, completed_at) VALUES ('${period_tag}', '${table_version}', 'local-seed', '${r2KeysEscaped}', 'completed', 'local-seed', ${now}, ${now});"`
  );
  console.log("  D1 record created.");

  // Step 3: Download Avro files from remote R2
  console.log("[3/4] Downloading Avro files from remote R2...");
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  for (const table of tables) {
    const r2Key = `master_data/${table_version}/${period_tag}/${table}.avro`;
    const localFile = join(TMP_DIR, `${table}.avro`);
    process.stdout.write(`  ${table}...`);
    try {
      run(
        `npx wrangler r2 object get ${BUCKET}/${r2Key} --file "${localFile}" --remote`
      );
      console.log(" OK");
    } catch {
      console.log(" SKIP (not found in remote)");
    }
  }

  // Step 4: Upload to local R2
  console.log("[4/4] Uploading to local R2...");
  for (const table of tables) {
    const localFile = join(TMP_DIR, `${table}.avro`);
    if (!existsSync(localFile)) continue;
    const r2Key = `master_data/${table_version}/${period_tag}/${table}.avro`;
    process.stdout.write(`  ${table}...`);
    try {
      run(
        `npx wrangler r2 object put ${BUCKET}/${r2Key} --file "${localFile}"`
      );
      console.log(" OK");
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
    }
  }

  // Cleanup
  rmSync(TMP_DIR, { recursive: true });

  console.log();
  console.log("Done! Local D1/R2 seeded with master data.");
  console.log("Run `pnpm dev` to start the dev server.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
