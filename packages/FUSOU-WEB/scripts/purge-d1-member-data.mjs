#!/usr/bin/env node

/**
 * Inspect the fixed D1 databases for Fleet-owned data.
 *
 * Fleet snapshots are stored in R2, not D1. The D1 Fleet allowlist is
 * intentionally empty, so every discovered D1 table, row, and column is
 * preserved. The command remains named after the old purge operation so
 * existing runbooks fail closed without a destructive replacement.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const DATABASES = Object.freeze([
  "dev-kc-battle-index",
  "dev-kc-quest-index",
  "dev-kc-remodel-index",
  "dev-kc-soku-speed-observed",
  "dev-kc-ship-growth",
]);

const FLEET_D1_TARGETS = Object.freeze([]);

function usage() {
  console.log(`Usage:
  node scripts/purge-d1-member-data.mjs --remote
  node scripts/purge-d1-member-data.mjs --remote --apply
  node scripts/purge-d1-member-data.mjs --plan

The default operation is a dry-run. Fleet data is not stored in D1, so
--apply performs no D1 deletion. It reports every discovered table with its
columns and row count as preserved. R2 Fleet cleanup is handled separately.`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    help: false,
    json: false,
    plan: false,
    remote: false,
  };

  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--plan") args.plan = true;
    else if (arg === "--remote") args.remote = true;
    else if (arg === "--dry-run") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.apply && !args.remote) {
    throw new Error("--apply requires --remote");
  }

  return args;
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Invalid fixed SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function parseWranglerJson(stdout) {
  const clean = String(stdout).replaceAll(/\u001b\[[0-9;]*m/g, "");
  for (let start = clean.indexOf("["); start >= 0; start = clean.indexOf("[", start + 1)) {
    try {
      const parsed = JSON.parse(clean.slice(start).trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Wrangler may print informational lines before its JSON result.
    }
  }
  throw new Error(`Could not parse Wrangler JSON output: ${clean.slice(-500)}`);
}

function runD1(database, sql, remote) {
  const args = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    database,
    remote ? "--remote" : "--local",
    "--command",
    sql,
    "--json",
  ];
  const stdout = execFileSync("pnpm", args, {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = parseWranglerJson(stdout);
  return parsed.flatMap((result) => result?.results ?? []);
}

function listTables(database, remote) {
  return runD1(
    database,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    remote,
  ).map((row) => String(row.name));
}

function getRowCount(database, table, remote) {
  const rows = runD1(
    database,
    `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(table)}`,
    remote,
  );
  const count = Number(rows[0]?.row_count);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid row count returned for ${database}.${table}`);
  }
  return count;
}

function inspectDatabase(database, remote) {
  return listTables(database, remote).map((table) => {
    const columns = runD1(
      database,
      `PRAGMA table_info(${quoteIdentifier(table)})`,
      remote,
    ).map((row) => String(row.name));
    const before = getRowCount(database, table, remote);
    return {
      database,
      table,
      status: "preserved-not-fleet",
      columns,
      before,
      after: before,
    };
  });
}

function summarize(reports) {
  return reports.map((report) => ({
    database: report.database,
    tables: report.tables.map((entry) => ({
      table: entry.table,
      status: entry.status,
      columns: entry.columns,
      before: entry.before,
      after: entry.after,
    })),
  }));
}

function printReport(label, reports, json) {
  const data = summarize(reports);
  if (json) {
    console.log(
      JSON.stringify(
        {
          phase: label,
          fleetD1Targets: FLEET_D1_TARGETS,
          databases: data,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`=== D1 Fleet-only cleanup ${label} ===`);
  console.log("fleetD1Targets=none");
  for (const database of data) {
    console.log(database.database);
    for (const table of database.tables) {
      const before = table.before === null ? "-" : String(table.before);
      const after = table.after === null ? "-" : String(table.after);
      console.log(`  ${table.table}: ${table.status} (before=${before}, after=${after})`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (args.plan) {
    console.log(
      JSON.stringify(
        {
          databases: DATABASES,
          fleetD1Targets: FLEET_D1_TARGETS,
          preservation: "all D1 tables, rows, and columns",
          fleetStorage: "R2 bucket dev-kc-fleets under fleets/",
        },
        null,
        2,
      ),
    );
    return;
  }

  const remote = args.remote;
  const reports = DATABASES.map((database) => ({
    database,
    tables: inspectDatabase(database, remote),
  }));
  printReport(args.apply ? "preflight" : "dry-run", reports, args.json);

  if (!args.apply) return;

  console.error("No Fleet-owned D1 tables are configured; no D1 deletion was attempted.");
  printReport("postflight", reports, args.json);
}

try {
  main();
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 1;
}