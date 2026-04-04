#!/usr/bin/env node

/**
 * Migrate master data object keys from /r{n}/ to /rev{n}/.
 *
 * This script:
 * 1) Reads master_data_tables rows from D1.
 * 2) Detects old-style keys like master_data/<ver>/<period>/r2/<table>.avro.
 * 3) Copies objects in R2 from old key -> new key (rev2).
 * 4) Updates master_data_tables.r2_key.
 * 5) Rebuilds master_data_index.r2_keys from master_data_tables ordered by table_index.
 *
 * Usage examples:
 *   node scripts/migrate-masterdata-revision-keys.mjs --db dev_kc_master_data_index --bucket dev-kc-master-data
 *   node scripts/migrate-masterdata-revision-keys.mjs --remote --db dev_kc_master_data_index --bucket dev-kc-master-data
 *
 * Notes:
 * - No fallback defaults for db/bucket: script fails loudly when missing.
 * - Keeps old objects for rollback safety.
 */

import { execSync } from "child_process";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

function parseArgs(argv) {
  const out = {
    remote: false,
    db: "",
    bucket: "",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--remote") {
      out.remote = true;
      continue;
    }
    if (a === "--db") {
      out.db = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (a === "--bucket") {
      out.bucket = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
  }

  return out;
}

function shQuote(value) {
  const raw = String(value ?? "");
  return `'${raw.replace(/'/g, `'"'"'`)}'`;
}

function sqlQuote(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

function runD1({ db, remote }, sql) {
  const remoteFlag = remote ? " --remote" : "";
  const cmd = `npx wrangler d1 execute ${shQuote(db)}${remoteFlag} --command ${shQuote(sql)} --json`;
  const output = run(cmd);
  const parsed = JSON.parse(output);
  return parsed?.[0]?.results || [];
}

function runR2Get({ bucket, remote }, key, filePath) {
  const remoteFlag = remote ? " --remote" : "";
  const cmd = `npx wrangler r2 object get ${shQuote(`${bucket}/${key}`)} --file ${shQuote(filePath)}${remoteFlag}`;
  run(cmd);
}

function runR2Put({ bucket, remote }, key, filePath) {
  const remoteFlag = remote ? " --remote" : "";
  const cmd = `npx wrangler r2 object put ${shQuote(`${bucket}/${key}`)} --file ${shQuote(filePath)}${remoteFlag}`;
  run(cmd);
}

function convertKey(oldKey, periodRevision) {
  const key = String(oldKey || "");

  // Already migrated.
  if (/\/rev\d+\//.test(key)) return key;

  // Convert revision segment /r{n}/ -> /rev{n}/
  if (/\/r\d+\//.test(key)) {
    return key.replace(/\/r(\d+)\//, "/rev$1/");
  }

  // Legacy key without revision segment:
  // master_data/<version>/<period>/<table>.avro -> master_data/<version>/<period>/rev{periodRevision>/<table>.avro
  const m = key.match(/^(master_data\/[^/]+\/[^/]+\/)([^/]+\.avro)$/);
  if (m) {
    const rev = Number(periodRevision);
    if (!Number.isInteger(rev) || rev < 1) return key;
    return `${m[1]}rev${rev}/${m[2]}`;
  }

  return key;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.db) {
    throw new Error("Missing required --db <D1_DATABASE_NAME>");
  }
  if (!args.bucket) {
    throw new Error("Missing required --bucket <R2_BUCKET_NAME>");
  }

  const envLabel = args.remote ? "remote" : "local";
  console.log(`=== MasterData Revision Key Migration (${envLabel}) ===`);
  console.log(`DB: ${args.db}`);
  console.log(`Bucket: ${args.bucket}`);

  const rows = runD1(
    { db: args.db, remote: args.remote },
    "SELECT mdt.id, mdt.master_data_id, mdt.table_name, mdt.table_index, mdt.r2_key, mdi.period_revision FROM master_data_tables mdt JOIN master_data_index mdi ON mdi.id = mdt.master_data_id ORDER BY mdt.master_data_id ASC, mdt.table_index ASC;",
  );

  if (!rows.length) {
    console.log("No rows found in master_data_tables. Nothing to migrate.");
    return;
  }

  const mappings = [];
  for (const row of rows) {
    const oldKey = String(row.r2_key || "");
    const periodRevision = Number(row.period_revision || 1);
    const newKey = convertKey(oldKey, periodRevision);
    if (newKey === oldKey) continue;
    mappings.push({
      id: Number(row.id),
      masterDataId: Number(row.master_data_id),
      tableName: String(row.table_name || ""),
      tableIndex: Number(row.table_index || 0),
      periodRevision,
      oldKey,
      newKey,
    });
  }

  if (!mappings.length) {
    console.log("No keys requiring migration found. Nothing to migrate.");
    return;
  }

  console.log(`Found ${mappings.length} rows to migrate.`);

  const tmpDir = join(process.cwd(), ".migrate-masterdata-r2-tmp");
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  try {
    let copied = 0;
    for (const m of mappings) {
      const filePath = join(tmpDir, `${m.id}.avro`);
      process.stdout.write(`Copy ${m.tableName} [${m.id}] ... `);
      runR2Get({ bucket: args.bucket, remote: args.remote }, m.oldKey, filePath);
      runR2Put({ bucket: args.bucket, remote: args.remote }, m.newKey, filePath);
      console.log("OK");
      copied += 1;
    }

    // Update table rows with new keys
    for (const m of mappings) {
      const sql = `UPDATE master_data_tables SET r2_key='${sqlQuote(m.newKey)}' WHERE id=${m.id};`;
      runD1({ db: args.db, remote: args.remote }, sql);
    }

    // Rebuild index-level r2_keys from table rows in table_index order
    const affectedIds = Array.from(new Set(mappings.map((m) => m.masterDataId)));
    for (const id of affectedIds) {
      const keyRows = runD1(
        { db: args.db, remote: args.remote },
        `SELECT r2_key FROM master_data_tables WHERE master_data_id=${id} ORDER BY table_index ASC;`,
      );
      const keys = keyRows.map((r) => String(r.r2_key || ""));
      const json = JSON.stringify(keys);
      const sql = `UPDATE master_data_index SET r2_keys='${sqlQuote(json)}' WHERE id=${id};`;
      runD1({ db: args.db, remote: args.remote }, sql);
    }

    // Verify
    const remain = runD1(
      { db: args.db, remote: args.remote },
      "SELECT COUNT(*) AS cnt FROM master_data_tables WHERE r2_key NOT LIKE '%/rev%/%';",
    );
    const remaining = Number(remain?.[0]?.cnt || 0);

    console.log("---");
    console.log(`Copied objects: ${copied}`);
    console.log(`Updated rows: ${mappings.length}`);
    console.log(`Updated index rows: ${affectedIds.length}`);
    console.log(`Remaining old-style keys: ${remaining}`);

    if (remaining !== 0) {
      throw new Error(`Migration incomplete: ${remaining} old-style keys remain.`);
    }
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
