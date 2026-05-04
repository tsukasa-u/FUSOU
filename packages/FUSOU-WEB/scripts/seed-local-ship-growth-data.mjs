#!/usr/bin/env node
/**
 * seed-local-ship-growth-data.mjs
 *
 * Pull ship-growth derived tables from remote D1 and seed local wrangler D1.
 *
 * Usage:
 *   node scripts/seed-local-ship-growth-data.mjs --db <database_name>
 *   node scripts/seed-local-ship-growth-data.mjs --db <database_name> --period latest
 *   node scripts/seed-local-ship-growth-data.mjs --db <database_name> --period 2026-04-07 --table-version 0.5
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { period: "latest" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--db") args.db = argv[++i];
    else if (a === "--period") args.period = argv[++i];
    else if (a === "--table-version") args.tableVersion = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    "Usage: node scripts/seed-local-ship-growth-data.mjs --db <database_name> [--period latest|YYYY-MM-DD] [--table-version <version>]",
  );
}

function runWrangler(dbName, mode, commandOrFile) {
  const localWranglerCmd = join(
    process.cwd(),
    "node_modules",
    ".bin",
    "wrangler.cmd",
  );
  const wranglerBin = existsSync(localWranglerCmd)
    ? localWranglerCmd
    : "wrangler";
  const base = [wranglerBin, "d1", "execute", dbName, mode, "--json"];
  if (commandOrFile.command) {
    base.push("--command", commandOrFile.command);
  } else if (commandOrFile.file) {
    base.push("--file", commandOrFile.file);
  } else {
    throw new Error("commandOrFile must include command or file");
  }

  const command = base[0];
  const args = base.slice(1);
  const stdout = execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number: ${value}`);
    return String(value);
  }
  const s = String(value).replace(/'/g, "''");
  return `'${s}'`;
}

function buildInsertSql(tableName, columns, rows) {
  if (!rows.length) return [];
  return rows.map((row) => {
    const values = columns.map((c) => sqlValue(row[c])).join(", ");
    return `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${values});`;
  });
}

function getResults(json) {
  return json?.[0]?.results ?? [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const dbName =
    args.db ||
    process.env.SEED_SHIP_GROWTH_DB ||
    process.env.SHIP_GROWTH_DB_NAME;
  if (!dbName) {
    throw new Error(
      "Missing DB name. Pass --db or set SEED_SHIP_GROWTH_DB / SHIP_GROWTH_DB_NAME.",
    );
  }

  console.log("=== Local Ship Growth Seeder ===");
  console.log(`DB: ${dbName}`);

  let periodTag = args.period;
  let tableVersion = args.tableVersion;

  if (periodTag === "latest") {
    const latestRows = getResults(
      runWrangler(dbName, "--remote", {
        command:
          "SELECT period_tag, table_version FROM ship_level_exp_pairs ORDER BY period_tag DESC, table_version DESC LIMIT 1",
      }),
    );
    if (!latestRows.length) {
      throw new Error("Remote ship_level_exp_pairs is empty.");
    }
    periodTag = latestRows[0].period_tag;
    tableVersion = latestRows[0].table_version;
  }

  if (!tableVersion) {
    throw new Error(
      "Missing table version. Pass --table-version when --period is not latest.",
    );
  }

  console.log(`Period: ${periodTag}`);
  console.log(`Table version: ${tableVersion}`);

  const whereClause = `period_tag = '${String(periodTag).replace(/'/g, "''")}' AND table_version = '${String(tableVersion).replace(/'/g, "''")}'`;

  const expRows = getResults(
    runWrangler(dbName, "--remote", {
      command: `SELECT period_tag, table_version, lv, exp_current FROM ship_level_exp_pairs WHERE ${whereClause} ORDER BY lv`,
    }),
  );
  const boundRows = getResults(
    runWrangler(dbName, "--remote", {
      command: `SELECT period_tag, table_version, master_id, lv, kaihi_naked, taisen_naked, sakuteki_naked FROM ship_growth_bounds WHERE ${whereClause} ORDER BY master_id, lv`,
    }),
  );
  const capRows = getResults(
    runWrangler(dbName, "--remote", {
      command: `SELECT period_tag, table_version, master_id, kaihi_max, taisen_max, sakuteki_max FROM ship_growth_caps WHERE ${whereClause} ORDER BY master_id`,
    }),
  );

  console.log(
    `Remote rows: exp=${expRows.length}, bounds=${boundRows.length}, caps=${capRows.length}`,
  );
  if (!expRows.length && !boundRows.length && !capRows.length) {
    throw new Error("No remote rows found for the target period/version.");
  }

  const statements = [
    "BEGIN TRANSACTION;",
    `DELETE FROM ship_level_exp_pairs WHERE ${whereClause};`,
    `DELETE FROM ship_growth_bounds WHERE ${whereClause};`,
    `DELETE FROM ship_growth_caps WHERE ${whereClause};`,
    ...buildInsertSql(
      "ship_level_exp_pairs",
      ["period_tag", "table_version", "lv", "exp_current"],
      expRows,
    ),
    ...buildInsertSql(
      "ship_growth_bounds",
      [
        "period_tag",
        "table_version",
        "master_id",
        "lv",
        "kaihi_naked",
        "taisen_naked",
        "sakuteki_naked",
      ],
      boundRows,
    ),
    ...buildInsertSql(
      "ship_growth_caps",
      [
        "period_tag",
        "table_version",
        "master_id",
        "kaihi_max",
        "taisen_max",
        "sakuteki_max",
      ],
      capRows,
    ),
    "COMMIT;",
  ];

  const tmpDir = join(process.cwd(), ".tmp");
  mkdirSync(tmpDir, { recursive: true });
  const sqlFile = join(tmpDir, `ship-growth-seed-${Date.now()}.sql`);
  writeFileSync(sqlFile, statements.join("\n"), "utf8");

  runWrangler(dbName, "--local", { file: sqlFile });

  const localExpCount = getResults(
    runWrangler(dbName, "--local", {
      command: `SELECT COUNT(*) AS c FROM ship_level_exp_pairs WHERE ${whereClause}`,
    }),
  )[0]?.c;
  const localBoundCount = getResults(
    runWrangler(dbName, "--local", {
      command: `SELECT COUNT(*) AS c FROM ship_growth_bounds WHERE ${whereClause}`,
    }),
  )[0]?.c;
  const localCapCount = getResults(
    runWrangler(dbName, "--local", {
      command: `SELECT COUNT(*) AS c FROM ship_growth_caps WHERE ${whereClause}`,
    }),
  )[0]?.c;

  console.log(
    `Local rows: exp=${localExpCount}, bounds=${localBoundCount}, caps=${localCapCount}`,
  );
  console.log("Done: local ship-growth data seeded.");
}

main();
