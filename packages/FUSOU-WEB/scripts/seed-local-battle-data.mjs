#!/usr/bin/env node
/**
 * seed-local-battle-data.mjs
 *
 * Downloads battle Avro chunks from remote R2 and seeds local Wrangler D1/R2.
 *
 * Usage examples:
 *   node scripts/seed-local-battle-data.mjs --bucket dev-kc-battle-data --db dev_kc_battle_index
 *   node scripts/seed-local-battle-data.mjs --bucket dev-kc-battle-data --db dev_kc_battle_index --period all
 *   node scripts/seed-local-battle-data.mjs --bucket dev-kc-battle-data --db dev_kc_battle_index --period 2026-03-10
 *   node scripts/seed-local-battle-data.mjs --bucket dev-kc-battle-data --db dev_kc_battle_index --tables battle,cells --limit 500
 *
 * Required args:
 *   --bucket <R2 bucket name>
 *   --db <D1 database name>
 *
 * Optional args:
 *   --period <latest|all|tag> (default: latest)
 *   --tables <csv>            (default: battle,cells,env_info,enemy_deck,enemy_ship,enemy_slotitem,own_deck,own_ship,own_slotitem,carrierbase_assault,closing_raigeki,hougeki,hougeki_list,midnight_hougeki,midnight_hougeki_list,opening_airattack,opening_airattack_list,opening_raigeki,opening_taisen,opening_taisen_list)
 *   --limit <number>          (default: 2000, max: 20000)
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const TMP_DIR = join(process.cwd(), ".seed-battle-tmp");
const SUPPORTED_TABLES = [
  "battle",
  "cells",
  "env_info",
  "enemy_deck",
  "enemy_ship",
  "enemy_slotitem",
  "own_deck",
  "own_ship",
  "own_slotitem",
  "carrierbase_assault",
  "closing_raigeki",
  "hougeki",
  "hougeki_list",
  "midnight_hougeki",
  "midnight_hougeki_list",
  "opening_airattack",
  "opening_airattack_list",
  "opening_raigeki",
  "opening_taisen",
  "opening_taisen_list",
];
const DEFAULT_TABLES = [...SUPPORTED_TABLES];

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

function esc(value) {
  return String(value).replace(/'/g, "''");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const wranglerPath = join(process.cwd(), "wrangler.toml");
  const wranglerText = existsSync(wranglerPath) ? readFileSync(wranglerPath, "utf8") : "";

  const bucketFromWrangler = (() => {
    const pattern = /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"BATTLE_DATA_BUCKET"[\s\S]*?bucket_name\s*=\s*"([^"]+)"/m;
    const match = wranglerText.match(pattern);
    return match?.[1] || "";
  })();

  const dbFromWrangler = (() => {
    const pattern = /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"BATTLE_INDEX_DB"[\s\S]*?database_name\s*=\s*"([^"]+)"/m;
    const match = wranglerText.match(pattern);
    return match?.[1] || "";
  })();

  const options = {
    bucket:
      process.env.SEED_BATTLE_BUCKET ||
      process.env.BATTLE_DATA_BUCKET_NAME ||
      bucketFromWrangler ||
      "",
    db:
      process.env.SEED_BATTLE_DB ||
      process.env.BATTLE_INDEX_DB_NAME ||
      dbFromWrangler ||
      "",
    period: "latest",
    tables: [...DEFAULT_TABLES],
    limit: 2000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--bucket") options.bucket = (args[++i] || "").trim();
    else if (arg === "--db") options.db = (args[++i] || "").trim();
    else if (arg === "--period") options.period = (args[++i] || "latest").trim();
    else if (arg === "--tables") {
      options.tables = (args[++i] || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    } else if (arg === "--limit") {
      const parsed = Number.parseInt(args[++i] || "", 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.min(parsed, 20000);
      }
    }
  }

  if (!options.bucket) {
    throw new Error("Missing battle bucket name. Pass --bucket, set SEED_BATTLE_BUCKET/BATTLE_DATA_BUCKET_NAME, or configure BATTLE_DATA_BUCKET in wrangler.toml");
  }
  if (!options.db) {
    throw new Error("Missing D1 database name. Pass --db, set SEED_BATTLE_DB/BATTLE_INDEX_DB_NAME, or configure BATTLE_INDEX_DB in wrangler.toml");
  }

  const invalid = options.tables.filter((t) => !SUPPORTED_TABLES.includes(t));
  if (invalid.length > 0) {
    throw new Error(`Unsupported tables in --tables: ${invalid.join(", ")}`);
  }

  return options;
}

function d1Query(dbName, sql, remote = false) {
  const remoteFlag = remote ? "--remote" : "";
  const out = run(
    `npx wrangler d1 execute ${dbName} ${remoteFlag} --command "${sql}" --json`,
  );
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results || [];
}

function ensureLocalSchema(dbName) {
  runQuiet(
    `npx wrangler d1 execute ${dbName} --command "
CREATE TABLE IF NOT EXISTS archived_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL,
  compression_codec TEXT DEFAULT 'none',
  created_at INTEGER NOT NULL,
  last_modified_at INTEGER NOT NULL,
  table_version TEXT NOT NULL DEFAULT 'v1'
);
CREATE TABLE IF NOT EXISTS block_indexes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  length INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  start_timestamp INTEGER NOT NULL,
  end_timestamp INTEGER NOT NULL,
  table_version TEXT NOT NULL DEFAULT 'v1',
  period_tag TEXT NOT NULL DEFAULT '2025-12-18',
  FOREIGN KEY(file_id) REFERENCES archived_files(id)
);
CREATE INDEX IF NOT EXISTS idx_archived_files_path ON archived_files(file_path);
CREATE INDEX IF NOT EXISTS idx_block_file_offset ON block_indexes(file_id, start_byte);
CREATE INDEX IF NOT EXISTS idx_block_indexes_table_period ON block_indexes(table_name, period_tag);
CREATE INDEX IF NOT EXISTS idx_block_indexes_time ON block_indexes(start_timestamp);
"`,
  );
}

function getRemoteRows({ db, period, tables, limit }) {
  const tableListSql = tables.map((t) => `'${esc(t)}'`).join(",");

  let periodCondition = "";
  if (period === "latest") {
    periodCondition =
      "AND bi.period_tag = (SELECT MAX(b2.period_tag) FROM block_indexes b2 WHERE b2.table_name = bi.table_name)";
  } else if (period !== "all") {
    periodCondition = `AND bi.period_tag = '${esc(period)}'`;
  }

  const sql = `
SELECT
  bi.dataset_id,
  bi.table_name,
  bi.start_byte,
  bi.length,
  bi.record_count,
  bi.start_timestamp,
  bi.end_timestamp,
  bi.table_version,
  bi.period_tag,
  af.file_path,
  af.file_size,
  af.compression_codec,
  af.created_at,
  af.last_modified_at
FROM block_indexes bi
JOIN archived_files af ON af.id = bi.file_id
WHERE bi.table_name IN (${tableListSql})
${periodCondition}
ORDER BY bi.start_timestamp DESC
LIMIT ${limit};`;

  return d1Query(db, sql, true);
}

function seedR2Files(bucket, rows) {
  const uniqueByPath = new Map();
  for (const row of rows) {
    uniqueByPath.set(row.file_path, row);
  }

  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  let ok = 0;
  const uploadedPaths = new Set();
  for (const [filePath] of uniqueByPath) {
    const safeName = filePath.replace(/[^a-zA-Z0-9._-]/g, "_");
    const localFile = join(TMP_DIR, safeName);
    process.stdout.write(`  R2 ${filePath} ... `);
    try {
      run(`npx wrangler r2 object get ${bucket}/${filePath} --file "${localFile}" --remote`);
      run(`npx wrangler r2 object put ${bucket}/${filePath} --file "${localFile}"`);
      ok++;
      uploadedPaths.add(filePath);
      console.log("OK");
    } catch (e) {
      console.log(`ERROR (${e.message?.split("\n")?.[0] || "unknown"})`);
    }
  }

  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  return { objectCount: ok, uploadedPaths };
}

function seedLocalD1(db, rows, tables, period, uploadedPaths) {
  const targetRows = rows.filter((row) => uploadedPaths.has(row.file_path));
  const tableListSql = tables.map((t) => `'${esc(t)}'`).join(",");

  if (period === "all" || period === "latest") {
    runQuiet(`npx wrangler d1 execute ${db} --command "DELETE FROM block_indexes WHERE table_name IN (${tableListSql});"`);
  } else {
    runQuiet(
      `npx wrangler d1 execute ${db} --command "DELETE FROM block_indexes WHERE table_name IN (${tableListSql}) AND period_tag='${esc(period)}';"`,
    );
  }

  const uniqueFiles = new Map();
  for (const row of targetRows) {
    uniqueFiles.set(row.file_path, row);
  }

  for (const row of uniqueFiles.values()) {
    runQuiet(
      `npx wrangler d1 execute ${db} --command "DELETE FROM archived_files WHERE file_path='${esc(row.file_path)}';"`,
    );
    run(
      `npx wrangler d1 execute ${db} --command "INSERT INTO archived_files (file_path, file_size, compression_codec, created_at, last_modified_at, table_version) VALUES ('${esc(row.file_path)}', ${Number(row.file_size || 0)}, '${esc(row.compression_codec || "none")}', ${Number(row.created_at || Date.now())}, ${Number(row.last_modified_at || Date.now())}, '${esc(row.table_version || "v1")}');"`,
    );
  }

  let inserted = 0;
  for (const row of targetRows) {
    const fileRows = d1Query(
      db,
      `SELECT id FROM archived_files WHERE file_path = '${esc(row.file_path)}' LIMIT 1;`,
      false,
    );
    const fileId = Number(fileRows?.[0]?.id || 0);
    if (!fileId) continue;

    run(
      `npx wrangler d1 execute ${db} --command "INSERT INTO block_indexes (dataset_id, table_name, file_id, start_byte, length, record_count, start_timestamp, end_timestamp, table_version, period_tag) VALUES ('${esc(row.dataset_id)}', '${esc(row.table_name)}', ${fileId}, ${Number(row.start_byte || 0)}, ${Number(row.length || 0)}, ${Number(row.record_count || 0)}, ${Number(row.start_timestamp || 0)}, ${Number(row.end_timestamp || 0)}, '${esc(row.table_version || "v1")}', '${esc(row.period_tag || "unknown")}');"`,
    );
    inserted++;
  }

  return { fileCount: uniqueFiles.size, blockCount: inserted };
}

async function main() {
  const opts = parseArgs();

  console.log("=== Local Battle Data Seeder ===");
  console.log(`Bucket: ${opts.bucket}`);
  console.log(`D1 DB: ${opts.db}`);
  console.log(`Period: ${opts.period}`);
  console.log(`Tables: ${opts.tables.join(", ")}`);
  console.log(`Limit: ${opts.limit}`);
  console.log();

  console.log("[1/4] Fetching remote block metadata from D1...");
  const rows = getRemoteRows(opts);
  if (!rows.length) {
    console.log("No matching remote rows found. Nothing to seed.");
    return;
  }
  console.log(`  Found ${rows.length} block row(s).`);

  console.log("[2/4] Seeding local R2 objects...");
  const { objectCount, uploadedPaths } = seedR2Files(opts.bucket, rows);
  console.log(`  Uploaded ${objectCount} R2 object(s) to local bucket.`);

  console.log("[3/4] Ensuring local D1 schema...");
  ensureLocalSchema(opts.db);

  console.log("[4/4] Seeding local D1 indexes...");
  const { fileCount, blockCount } = seedLocalD1(
    opts.db,
    rows,
    opts.tables,
    opts.period,
    uploadedPaths,
  );
  console.log(`  Inserted ${fileCount} archived file row(s), ${blockCount} block index row(s).`);

  console.log();
  console.log("Done! Local battle data has been seeded to R2 + D1.");
}

main().catch((e) => {
  console.error(e?.message || e);
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  process.exit(1);
});
