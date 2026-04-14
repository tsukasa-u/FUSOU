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

// Default tables needed for simulator core flows + equipment filtering.
const REQUIRED_TABLES = [
  "mst_ship",
  "mst_slotitem",
  "mst_stype",
  "mst_slotitem_equiptype",
  "mst_equip_ship",
  "mst_equip_exslot",
  "mst_equip_exslot_ship",
  "mst_equip_limit_exslot",
];

// All supported master tables for completeness
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
  return execSync(cmd, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function runQuiet(cmd) {
  try {
    return run(cmd);
  } catch (e) {
    return e.stderr || e.stdout || "";
  }
}

function sqlQuote(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function shellQuote(value) {
  const raw = String(value ?? "");
  return `"${raw.replace(/"/g, '\\"')}"`;
}

function toSafeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

function quoteForCommand(sql) {
  return normalizeSql(sql).replace(/"/g, '\\"');
}

function d1ExecuteSql(sql, { remote = false, json = false } = {}) {
  const remoteFlag = remote ? " --remote" : "";
  const jsonFlag = json ? " --json" : "";
  return run(
    `npx wrangler d1 execute ${DB_NAME}${remoteFlag} --command "${quoteForCommand(sql)}"${jsonFlag}`,
  );
}

function getLocalColumns(tableName) {
  const output = d1ExecuteSql(`PRAGMA table_info(${tableName});`, {
    json: true,
  });
  const parsed = JSON.parse(output);
  const rows = parsed?.[0]?.results || [];
  return new Set(rows.map((row) => String(row.name)));
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
  let remoteTableRows = [];
  try {
    const output = d1ExecuteSql(
      "SELECT id, period_tag, table_version, period_revision, content_hash FROM master_data_index WHERE upload_status = 'completed' ORDER BY completed_at DESC, period_revision DESC LIMIT 1;",
      { remote: true, json: true },
    );
    const parsed = JSON.parse(output);
    const results = parsed?.[0]?.results;
    if (!results || results.length === 0) {
      console.error("No completed master data found in remote D1.");
      process.exit(1);
    }
    remoteRecord = results[0];
    console.log(
      `  Found: period=${remoteRecord.period_tag}, version=${remoteRecord.table_version}, revision=${remoteRecord.period_revision}`,
    );

    const remoteMasterId = toSafeInt(remoteRecord.id, -1);
    if (remoteMasterId < 0) {
      console.error("Invalid remote master_data_index id.");
      process.exit(1);
    }

    const tableOutput = d1ExecuteSql(
      `SELECT table_name, table_version, table_index, start_byte, end_byte, record_count, r2_key, content_hash, created_at FROM master_data_tables WHERE master_data_id = ${remoteMasterId} ORDER BY table_index ASC;`,
      { remote: true, json: true },
    );
    const tableParsed = JSON.parse(tableOutput);
    remoteTableRows = tableParsed?.[0]?.results || [];
    if (!remoteTableRows.length) {
      console.error("No master_data_tables rows found for selected revision.");
      process.exit(1);
    }
  } catch (e) {
    console.error(
      "Failed to query remote D1. Are you logged in? (npx wrangler login)",
    );
    console.error(e.message);
    process.exit(1);
  }

  const { period_tag, table_version, period_revision, content_hash } =
    remoteRecord;
  const selectedRows = remoteTableRows.filter((row) =>
    tables.includes(row.table_name),
  );

  if (!selectedRows.length) {
    console.error(
      "None of requested tables exist in selected remote revision.",
    );
    process.exit(1);
  }

  // Step 2: Create local D1 schema if needed
  console.log("[2/4] Ensuring local D1 schema...");
  runQuiet(
    `npx wrangler d1 execute ${DB_NAME} --command "${quoteForCommand("PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS master_data_index (id INTEGER PRIMARY KEY AUTOINCREMENT, period_tag TEXT NOT NULL, table_version TEXT NOT NULL DEFAULT '0.4', period_revision INTEGER NOT NULL DEFAULT 1, content_hash TEXT NOT NULL, r2_keys TEXT, table_offsets TEXT, table_count INTEGER, upload_status TEXT DEFAULT 'pending', uploaded_by TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER, UNIQUE(period_tag, table_version, period_revision)); CREATE TABLE IF NOT EXISTS master_data_tables (id INTEGER PRIMARY KEY AUTOINCREMENT, master_data_id INTEGER NOT NULL, table_name TEXT NOT NULL, table_version TEXT NOT NULL DEFAULT '0.4', table_index INTEGER NOT NULL, start_byte INTEGER NOT NULL, end_byte INTEGER NOT NULL, record_count INTEGER, r2_key TEXT NOT NULL, content_hash TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (master_data_id) REFERENCES master_data_index(id), UNIQUE(master_data_id, table_name)); CREATE INDEX IF NOT EXISTS idx_master_data_by_period ON master_data_index(period_tag); CREATE INDEX IF NOT EXISTS idx_master_data_by_status_created ON master_data_index(upload_status, created_at); CREATE INDEX IF NOT EXISTS idx_master_tables_by_master_id ON master_data_tables(master_data_id); CREATE INDEX IF NOT EXISTS idx_master_tables_by_table_name ON master_data_tables(table_name);")}"`,
  );

  const indexCols = getLocalColumns("master_data_index");
  const tableCols = getLocalColumns("master_data_tables");

  if (!indexCols.has("period_revision")) {
    d1ExecuteSql(
      "ALTER TABLE master_data_index ADD COLUMN period_revision INTEGER NOT NULL DEFAULT 1;",
    );
    indexCols.add("period_revision");
  }
  if (!indexCols.has("table_offsets")) {
    d1ExecuteSql(
      "ALTER TABLE master_data_index ADD COLUMN table_offsets TEXT;",
    );
    indexCols.add("table_offsets");
  }
  if (!indexCols.has("table_count")) {
    d1ExecuteSql(
      "ALTER TABLE master_data_index ADD COLUMN table_count INTEGER;",
    );
    indexCols.add("table_count");
  }

  const hasPeriodRevision = indexCols.has("period_revision");
  const hasTableVersion = indexCols.has("table_version");
  const hasCompletedAt = indexCols.has("completed_at");
  const hasIndexTableVersion = tableCols.has("table_version");
  const hasTableIndex = tableCols.has("table_index");

  // Delete existing record for this exact period/version/revision to allow re-seeding
  const periodTagEscaped = sqlQuote(period_tag);
  const tableVersionEscaped = sqlQuote(table_version);
  const periodRevisionInt = toSafeInt(period_revision, 1);

  const whereParts = [`period_tag = '${periodTagEscaped}'`];
  if (hasTableVersion) {
    whereParts.push(`table_version = '${tableVersionEscaped}'`);
  }
  const whereClause = whereParts.join(" AND ");
  d1ExecuteSql(
    `DELETE FROM master_data_tables WHERE master_data_id IN (SELECT id FROM master_data_index WHERE ${whereClause}); DELETE FROM master_data_index WHERE ${whereClause};`,
  );

  // Insert master_data_index row
  const r2Keys = selectedRows.map((row) => row.r2_key);
  const tableOffsets = selectedRows.map((row) => ({
    table_name: row.table_name,
    start: row.start_byte,
    end: row.end_byte,
  }));
  const r2KeysEscaped = JSON.stringify(r2Keys).replace(/'/g, "''");
  const tableOffsetsEscaped = JSON.stringify(tableOffsets).replace(/'/g, "''");
  const contentHashEscaped = sqlQuote(content_hash || "local-seed");
  const now = Math.floor(Date.now() / 1000);
  const indexInsertColumns = ["period_tag"];
  const indexInsertValues = [`'${periodTagEscaped}'`];

  if (indexCols.has("content_hash")) {
    indexInsertColumns.push("content_hash");
    indexInsertValues.push(`'${contentHashEscaped}'`);
  }
  if (indexCols.has("r2_keys")) {
    indexInsertColumns.push("r2_keys");
    indexInsertValues.push(`'${r2KeysEscaped}'`);
  }
  if (indexCols.has("table_offsets")) {
    indexInsertColumns.push("table_offsets");
    indexInsertValues.push(`'${tableOffsetsEscaped}'`);
  }
  if (indexCols.has("table_count")) {
    indexInsertColumns.push("table_count");
    indexInsertValues.push(`${selectedRows.length}`);
  }
  if (indexCols.has("upload_status")) {
    indexInsertColumns.push("upload_status");
    indexInsertValues.push("'completed'");
  }
  if (indexCols.has("uploaded_by")) {
    indexInsertColumns.push("uploaded_by");
    indexInsertValues.push("'local-seed'");
  }
  if (indexCols.has("created_at")) {
    indexInsertColumns.push("created_at");
    indexInsertValues.push(`${now}`);
  }

  if (hasTableVersion) {
    indexInsertColumns.splice(1, 0, "table_version");
    indexInsertValues.splice(1, 0, `'${tableVersionEscaped}'`);
  }
  if (hasPeriodRevision) {
    const tableVersionIdx = hasTableVersion ? 2 : 1;
    indexInsertColumns.splice(tableVersionIdx, 0, "period_revision");
    indexInsertValues.splice(tableVersionIdx, 0, `${periodRevisionInt}`);
  }
  if (hasCompletedAt) {
    indexInsertColumns.push("completed_at");
    indexInsertValues.push(`${now}`);
  }

  const insertOutput = d1ExecuteSql(
    `INSERT INTO master_data_index (${indexInsertColumns.join(", ")}) VALUES (${indexInsertValues.join(", ")}) RETURNING id;`,
    { json: true },
  );
  const insertParsed = JSON.parse(insertOutput);
  const localMasterId = toSafeInt(insertParsed?.[0]?.results?.[0]?.id, -1);
  if (localMasterId < 0) {
    console.error("Failed to create local master_data_index row.");
    process.exit(1);
  }

  for (const row of selectedRows) {
    const rowHashEscaped = sqlQuote(row.content_hash || "local-seed");
    const r2KeyEscaped = sqlQuote(row.r2_key);
    const tableNameEscaped = sqlQuote(row.table_name);
    const rowTableVersionEscaped = sqlQuote(row.table_version || table_version);
    const tableIndex = toSafeInt(row.table_index, 0);
    const startByte = toSafeInt(row.start_byte, 0);
    const endByte = toSafeInt(row.end_byte, 0);
    const createdAt = toSafeInt(row.created_at, now);
    const recordCountSql =
      row.record_count == null
        ? "NULL"
        : String(toSafeInt(row.record_count, 0));

    const tableInsertColumns = [
      "master_data_id",
      "table_name",
      "start_byte",
      "end_byte",
      "record_count",
      "r2_key",
      "content_hash",
      "created_at",
    ];
    const tableInsertValues = [
      `${localMasterId}`,
      `'${tableNameEscaped}'`,
      `${startByte}`,
      `${endByte}`,
      `${recordCountSql}`,
      `'${r2KeyEscaped}'`,
      `'${rowHashEscaped}'`,
      `${createdAt}`,
    ];
    if (hasIndexTableVersion) {
      tableInsertColumns.splice(2, 0, "table_version");
      tableInsertValues.splice(2, 0, `'${rowTableVersionEscaped}'`);
    }
    if (hasTableIndex) {
      const insertPos = hasIndexTableVersion ? 3 : 2;
      tableInsertColumns.splice(insertPos, 0, "table_index");
      tableInsertValues.splice(insertPos, 0, `${tableIndex}`);
    }

    d1ExecuteSql(
      `INSERT INTO master_data_tables (${tableInsertColumns.join(", ")}) VALUES (${tableInsertValues.join(", ")});`,
    );
  }
  console.log(`  D1 rows created: index=1 tables=${selectedRows.length}`);

  // Step 3: Download Avro files from remote R2
  console.log("[3/4] Downloading Avro files from remote R2...");
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  for (const row of selectedRows) {
    const table = row.table_name;
    const r2Key = row.r2_key;
    const localFile = join(TMP_DIR, `${table}.avro`);
    process.stdout.write(`  ${table}...`);
    try {
      run(
        `npx wrangler r2 object get ${shellQuote(`${BUCKET}/${r2Key}`)} --file ${shellQuote(localFile)} --remote`,
      );
      console.log(" OK");
    } catch {
      console.log(" SKIP (not found in remote)");
    }
  }

  // Step 4: Upload to local R2
  console.log("[4/4] Uploading to local R2...");
  for (const row of selectedRows) {
    const table = row.table_name;
    const localFile = join(TMP_DIR, `${table}.avro`);
    if (!existsSync(localFile)) continue;
    const r2Key = row.r2_key;
    process.stdout.write(`  ${table}...`);
    try {
      run(
        `npx wrangler r2 object put ${shellQuote(`${BUCKET}/${r2Key}`)} --file ${shellQuote(localFile)}`,
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
