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
 *   --target-timestamp <sec>  (optional: only seed block rows whose time range contains this unix timestamp)
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const TMP_DIR = join(process.cwd(), ".seed-battle-tmp");
const SUPPORTED_TABLES = [
  "battle",
  "battle_result",
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
const PERIOD_TAG_FETCH_LIMIT = 400;

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

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function shouldRetryCommand(error) {
  const text = String(error?.stderr || error?.stdout || error?.message || "");
  return /SQLITE_BUSY|database is locked|Too many requests/i.test(text);
}

function runWithRetry(cmd, attempts = 3, retryDelayMs = 250) {
  let lastError = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return run(cmd);
    } catch (e) {
      lastError = e;
      if (i < attempts && shouldRetryCommand(e)) {
        process.stdout.write(`retry ${i}/${attempts - 1} ... `);
        sleepMs(retryDelayMs * i);
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

function esc(value) {
  return String(value).replace(/'/g, "''");
}

function normalizeSql(sql) {
  return String(sql).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function quoteForCommand(sql) {
  return normalizeSql(sql).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isValidPeriodTagDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

function toTokyoPeriodTag(rawTag) {
  if (!rawTag) return null;
  const parsed = new Date(rawTag);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toLocaleDateString("sv-SE", {
    timeZone: "Asia/Tokyo",
  });
}

async function fetchAllowedPeriodTagSetFromSupabase() {
  const url =
    process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    "";

  if (!url || !key) {
    throw new Error(
      "Missing PUBLIC_SUPABASE_URL/SUPABASE_URL and/or SUPABASE_SECRET_KEY",
    );
  }

  const nowIso = new Date(Date.now() - 5000).toISOString();
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/kc_period_tag?select=tag&tag=lte.${nowIso}&order=tag.desc.nullslast&limit=${PERIOD_TAG_FETCH_LIMIT}`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch allowed period tags: ${response.status}`);
  }

  const rows = await response.json();
  const tags = (Array.isArray(rows) ? rows : [])
    .map((row) => toTokyoPeriodTag(row?.tag))
    .filter((tag) => typeof tag === "string" && isValidPeriodTagDate(tag));

  return new Set(tags);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const wranglerPath = join(process.cwd(), "wrangler.toml");
  const wranglerText = existsSync(wranglerPath)
    ? readFileSync(wranglerPath, "utf8")
    : "";

  const bucketFromWrangler = (() => {
    const pattern =
      /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"BATTLE_DATA_BUCKET"[\s\S]*?bucket_name\s*=\s*"([^"]+)"/m;
    const match = wranglerText.match(pattern);
    return match?.[1] || "";
  })();

  const dbFromWrangler = (() => {
    const pattern =
      /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"BATTLE_INDEX_DB"[\s\S]*?database_name\s*=\s*"([^"]+)"/m;
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
    targetTimestamp: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--bucket") options.bucket = (args[++i] || "").trim();
    else if (arg === "--db") options.db = (args[++i] || "").trim();
    else if (arg === "--period")
      options.period = (args[++i] || "latest").trim();
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
    } else if (arg === "--target-timestamp") {
      const parsed = Number.parseInt(args[++i] || "", 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.targetTimestamp = parsed;
      }
    }
  }

  if (!options.bucket) {
    throw new Error(
      "Missing battle bucket name. Pass --bucket, set SEED_BATTLE_BUCKET/BATTLE_DATA_BUCKET_NAME, or configure BATTLE_DATA_BUCKET in wrangler.toml",
    );
  }
  if (!options.db) {
    throw new Error(
      "Missing D1 database name. Pass --db, set SEED_BATTLE_DB/BATTLE_INDEX_DB_NAME, or configure BATTLE_INDEX_DB in wrangler.toml",
    );
  }

  const invalid = options.tables.filter((t) => !SUPPORTED_TABLES.includes(t));
  if (invalid.length > 0) {
    throw new Error(`Unsupported tables in --tables: ${invalid.join(", ")}`);
  }

  return options;
}

function d1Query(dbName, sql, remote = false) {
  const remoteFlag = remote ? "--remote" : "";
  const out = runWithRetry(
    `npx wrangler d1 execute ${dbName} ${remoteFlag} --command "${quoteForCommand(sql)}" --json`,
    6,
    400,
  );
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results || [];
}

function ensureLocalSchema(dbName) {
  const schemaSql = `
CREATE TABLE IF NOT EXISTS archived_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL,
  compression_codec TEXT DEFAULT 'none',
  created_at INTEGER NOT NULL,
  last_modified_at INTEGER NOT NULL,
  table_version TEXT NOT NULL DEFAULT 'v1',
  compaction_tier TEXT NOT NULL DEFAULT 'hourly',
  window_start_ms INTEGER,
  window_end_ms INTEGER,
  source_tier TEXT,
  lock_token TEXT,
  lock_expires_ms INTEGER,
  lock_owner_run_key TEXT
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
  compaction_tier TEXT NOT NULL DEFAULT 'hourly',
  window_start_ms INTEGER,
  window_end_ms INTEGER,
  source_file_count INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(file_id) REFERENCES archived_files(id)
);
CREATE INDEX IF NOT EXISTS idx_archived_files_path ON archived_files(file_path);
CREATE INDEX IF NOT EXISTS idx_block_file_offset ON block_indexes(file_id, start_byte);
CREATE INDEX IF NOT EXISTS idx_block_indexes_table_period ON block_indexes(table_name, period_tag);
CREATE INDEX IF NOT EXISTS idx_block_indexes_time ON block_indexes(start_timestamp);
`;
  runWithRetry(
    `npx wrangler d1 execute ${dbName} --command "${quoteForCommand(schemaSql)}"`,
    6,
    400,
  );

  const tableColumns = {
    archived_files: {
      compaction_tier: "TEXT NOT NULL DEFAULT 'hourly'",
      window_start_ms: "INTEGER",
      window_end_ms: "INTEGER",
      source_tier: "TEXT",
      lock_token: "TEXT",
      lock_expires_ms: "INTEGER",
      lock_owner_run_key: "TEXT",
    },
    block_indexes: {
      compaction_tier: "TEXT NOT NULL DEFAULT 'hourly'",
      window_start_ms: "INTEGER",
      window_end_ms: "INTEGER",
      source_file_count: "INTEGER NOT NULL DEFAULT 1",
    },
  };

  for (const [tableName, requiredColumns] of Object.entries(tableColumns)) {
    const infoRows = d1Query(dbName, `PRAGMA table_info(${tableName});`, false);
    const existingColumns = new Set(
      infoRows
        .map((row) => String(row?.name || "").trim())
        .filter(Boolean),
    );

    for (const [columnName, columnDef] of Object.entries(requiredColumns)) {
      if (existingColumns.has(columnName)) continue;
      runWithRetry(
        `npx wrangler d1 execute ${dbName} --command "ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef};"`,
        6,
        400,
      );
    }
  }

  const indexSql = `
CREATE INDEX IF NOT EXISTS idx_archived_files_lock_expires ON archived_files(lock_expires_ms);
CREATE INDEX IF NOT EXISTS idx_block_indexes_tier_period_table ON block_indexes(compaction_tier, period_tag, table_name, table_version, start_timestamp);
`;
  runWithRetry(
    `npx wrangler d1 execute ${dbName} --command "${quoteForCommand(indexSql)}"`,
    6,
    400,
  );
}

function getRemoteRows({ db, period, tables, limit, targetTimestamp }, allowedPeriodTagSet) {
  const allowedTags = [...allowedPeriodTagSet]
    .filter((tag) => isValidPeriodTagDate(tag))
    .sort((a, b) => b.localeCompare(a));
  if (allowedTags.length === 0) {
    return [];
  }

  const allowedTagSql = allowedTags.map((tag) => `'${esc(tag)}'`).join(",");
  const tableListSql = tables.map((t) => `'${esc(t)}'`).join(",");

  let periodCondition = "";
  if (period === "latest") {
    periodCondition =
      `AND bi.period_tag = (SELECT MAX(b2.period_tag) FROM block_indexes b2 WHERE b2.table_name = bi.table_name AND b2.period_tag IN (${allowedTagSql}))`;
  } else if (period !== "all") {
    periodCondition = `AND bi.period_tag = '${esc(period)}'`;
  }

  let timestampCondition = "";
  if (Number.isFinite(targetTimestamp) && targetTimestamp > 0) {
    timestampCondition = `AND bi.start_timestamp <= ${targetTimestamp} AND bi.end_timestamp >= ${targetTimestamp}`;
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
AND bi.period_tag IN (${allowedTagSql})
${periodCondition}
${timestampCondition}
ORDER BY bi.start_timestamp DESC
LIMIT ${limit};`;

  const rows = d1Query(db, sql, true);
  if (
    rows.length > 0 ||
    !(Number.isFinite(targetTimestamp) && targetTimestamp > 0)
  ) {
    return rows;
  }

  const nearestSql = `
WITH ranked AS (
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
    af.last_modified_at,
    ROW_NUMBER() OVER (
      PARTITION BY bi.table_name
      ORDER BY MIN(ABS(bi.start_timestamp - ${targetTimestamp}), ABS(bi.end_timestamp - ${targetTimestamp})) ASC,
               bi.start_timestamp DESC
    ) AS rn
  FROM block_indexes bi
  JOIN archived_files af ON af.id = bi.file_id
  WHERE bi.table_name IN (${tableListSql})
    AND bi.period_tag IN (${allowedTagSql})
    ${periodCondition}
)
SELECT dataset_id, table_name, start_byte, length, record_count, start_timestamp, end_timestamp, table_version, period_tag, file_path, file_size, compression_codec, created_at, last_modified_at
FROM ranked
WHERE rn = 1
ORDER BY start_timestamp DESC
LIMIT ${limit};`;

  return d1Query(db, nearestSql, true);
}

function seedR2Files(bucket, rows) {
  const uniqueByPath = new Map();
  for (const row of rows) {
    uniqueByPath.set(row.file_path, row);
  }

  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  let ok = 0;
  let failed = 0;
  const uploadedPaths = new Set();
  for (const [filePath] of uniqueByPath) {
    const safeName = filePath.replace(/[^a-zA-Z0-9._-]/g, "_");
    const localFile = join(TMP_DIR, safeName);
    process.stdout.write(`  R2 ${filePath} ... `);
    try {
      runWithRetry(
        `npx wrangler r2 object get ${bucket}/${filePath} --file "${localFile}" --remote`,
      );
      runWithRetry(
        `npx wrangler r2 object put ${bucket}/${filePath} --file "${localFile}"`,
      );
      ok++;
      uploadedPaths.add(filePath);
      console.log("OK");
    } catch (e) {
      failed++;
      console.log(`ERROR (${e.message?.split("\n")?.[0] || "unknown"})`);
    }
  }

  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  return { objectCount: ok, failedCount: failed, uploadedPaths };
}

function seedLocalD1(db, rows, tables, period, uploadedPaths) {
  const targetRows = rows.filter((row) => uploadedPaths.has(row.file_path));
  const tableListSql = tables.map((t) => `'${esc(t)}'`).join(",");

  if (period === "all") {
    runWithRetry(
      `npx wrangler d1 execute ${db} --command "DELETE FROM block_indexes WHERE table_name IN (${tableListSql});"`,
      6,
      400,
    );
  } else {
    const periodTagsByTable = new Map();
    for (const row of targetRows) {
      const tableName = String(row.table_name || "").trim();
      const periodTag = String(row.period_tag || "").trim();
      if (!tableName || !periodTag) continue;
      if (!periodTagsByTable.has(tableName)) {
        periodTagsByTable.set(tableName, new Set());
      }
      periodTagsByTable.get(tableName).add(periodTag);
    }

    for (const [tableName, tags] of periodTagsByTable.entries()) {
      if (!tags.size) continue;
      const tagSql = [...tags].map((tag) => `'${esc(tag)}'`).join(",");
      runWithRetry(
        `npx wrangler d1 execute ${db} --command "DELETE FROM block_indexes WHERE table_name='${esc(tableName)}' AND period_tag IN (${tagSql});"`,
        6,
        400,
      );
    }
  }

  const uniqueFiles = new Map();
  for (const row of targetRows) {
    uniqueFiles.set(row.file_path, row);
  }

  for (const row of uniqueFiles.values()) {
    runWithRetry(
      `npx wrangler d1 execute ${db} --command "INSERT INTO archived_files (file_path, file_size, compression_codec, created_at, last_modified_at, table_version) VALUES ('${esc(row.file_path)}', ${Number(row.file_size || 0)}, '${esc(row.compression_codec || "none")}', ${Number(row.created_at || Date.now())}, ${Number(row.last_modified_at || Date.now())}, '${esc(row.table_version || "v1")}') ON CONFLICT(file_path) DO UPDATE SET file_size=excluded.file_size, compression_codec=excluded.compression_codec, created_at=excluded.created_at, last_modified_at=excluded.last_modified_at, table_version=excluded.table_version;"`,
      6,
      400,
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

    runWithRetry(
      `npx wrangler d1 execute ${db} --command "INSERT INTO block_indexes (dataset_id, table_name, file_id, start_byte, length, record_count, start_timestamp, end_timestamp, table_version, period_tag) VALUES ('${esc(row.dataset_id)}', '${esc(row.table_name)}', ${fileId}, ${Number(row.start_byte || 0)}, ${Number(row.length || 0)}, ${Number(row.record_count || 0)}, ${Number(row.start_timestamp || 0)}, ${Number(row.end_timestamp || 0)}, '${esc(row.table_version || "v1")}', '${esc(row.period_tag || "unknown")}');"`,
      6,
      400,
    );
    inserted++;
  }

  return { fileCount: uniqueFiles.size, blockCount: inserted };
}

async function main() {
  const opts = parseArgs();
  const allowedPeriodTagSet = await fetchAllowedPeriodTagSetFromSupabase();

  console.log("=== Local Battle Data Seeder ===");
  console.log(`Bucket: ${opts.bucket}`);
  console.log(`D1 DB: ${opts.db}`);
  console.log(`Period: ${opts.period}`);
  console.log(`Tables: ${opts.tables.join(", ")}`);
  console.log(`Limit: ${opts.limit}`);
  console.log(`Allowed period tags: ${allowedPeriodTagSet.size}`);
  if (opts.targetTimestamp) {
    console.log(`Target timestamp: ${opts.targetTimestamp}`);
  }
  console.log();

  if (
    opts.period !== "all" &&
    opts.period !== "latest" &&
    !allowedPeriodTagSet.has(opts.period)
  ) {
    throw new Error(
      `period '${opts.period}' is not in Supabase period-tag allow-list`,
    );
  }

  console.log("[1/4] Fetching remote block metadata from D1...");
  const rows = getRemoteRows(opts, allowedPeriodTagSet);
  if (!rows.length) {
    console.log("No matching remote rows found. Nothing to seed.");
    return;
  }
  console.log(`  Found ${rows.length} block row(s).`);

  console.log("[2/4] Seeding local R2 objects...");
  const { objectCount, failedCount, uploadedPaths } = seedR2Files(
    opts.bucket,
    rows,
  );
  console.log(`  Uploaded ${objectCount} R2 object(s) to local bucket.`);
  if (failedCount > 0) {
    console.log(`  Failed to upload ${failedCount} object(s).`);
  }

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
  console.log(
    `  Inserted ${fileCount} archived file row(s), ${blockCount} block index row(s).`,
  );

  console.log();
  console.log("Done! Local battle data has been seeded to R2 + D1.");
}

main().catch((e) => {
  console.error(e?.message || e);
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  process.exit(1);
});
