#!/usr/bin/env node
/**
 * seed-local-ship-growth-data.mjs
 *
 * Pull ship-growth derived tables from remote D1 and seed local wrangler D1.
 * Also syncs R2 archive objects (ship-growth/archive/) from remote to local,
 * so that /cumulative and /all-periods work identically to production.
 *
 * Usage:
 *   node scripts/seed-local-ship-growth-data.mjs --db <database_name>
 *   node scripts/seed-local-ship-growth-data.mjs --db <database_name> --period latest
 *   node scripts/seed-local-ship-growth-data.mjs --db <database_name> --period 2026-04-07 --table-version 0.5
 *   # Skip R2 archive sync (D1 only):
 *   node scripts/seed-local-ship-growth-data.mjs --db <database_name> --no-r2
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const localWranglerCmdWin = join(process.cwd(), "node_modules", ".bin", "wrangler.cmd");
const localWranglerCmdUnix = join(process.cwd(), "node_modules", ".bin", "wrangler");
const WRANGLER_BIN = existsSync(localWranglerCmdWin)
  ? localWranglerCmdWin
  : existsSync(localWranglerCmdUnix)
    ? localWranglerCmdUnix
    : "wrangler";

function parseArgs(argv) {
  const args = { period: "latest", syncR2: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--db") args.db = argv[++i];
    else if (a === "--period") args.period = argv[++i];
    else if (a === "--table-version") args.tableVersion = argv[++i];
    else if (a === "--no-r2") args.syncR2 = false;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    "Usage: node scripts/seed-local-ship-growth-data.mjs --db <database_name> [--period latest|YYYY-MM-DD] [--table-version <version>] [--no-r2]",
  );
}

/**
 * Resolve Cloudflare API credentials.
 * Priority: explicit env vars → wrangler OAuth config + whoami.
 */
async function getCloudflareAuth() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (accountId && apiToken) return { accountId, token: apiToken };

  // Read OAuth token from wrangler config file (token may span multiple lines)
  const { readFileSync } = await import("node:fs");
  const configPath = join(
    process.env.HOME || process.env.USERPROFILE || "~",
    ".config", ".wrangler", "config", "default.toml",
  );
  let oauthToken = null;
  try {
    const content = readFileSync(configPath, "utf8");
    // oauth_token value may be wrapped across lines inside the quotes
    const m = content.match(/oauth_token\s*=\s*"([\s\S]*?)(?<!\\)"/);
    if (m) oauthToken = m[1].replace(/\s+/g, "");
  } catch { /* ignore */ }

  // Get account ID via wrangler whoami (parse box-drawing table output)
  let resolvedAccountId = accountId;
  if (!resolvedAccountId) {
    try {
      const out = execFileSync(WRANGLER_BIN, ["whoami"], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      // Table format: │ Account Name │ Account ID │
      const m = out.match(/[│|]\s*([a-f0-9]{32})\s*[│|]/i);
      if (m) resolvedAccountId = m[1];
    } catch { /* ignore */ }
  }

  if (!resolvedAccountId || !oauthToken) {
    throw new Error(
      "Could not determine Cloudflare credentials.\n" +
      "Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, or run 'npx wrangler login'.",
    );
  }
  return { accountId: resolvedAccountId, token: oauthToken };
}

/**
 * List all R2 objects under a given prefix using the Cloudflare REST API.
 */
async function listRemoteR2Objects(bucketName, prefix) {
  const { accountId, token } = await getCloudflareAuth();

  const objects = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({
      prefix,
      per_page: "1000",
      ...(cursor ? { cursor } : {}),
    });
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `CF API list objects failed (${res.status}): ${text.slice(0, 300)}`,
      );
    }
    const json = await res.json();
    if (!json.success) {
      throw new Error(`CF API error: ${JSON.stringify(json.errors ?? json)}`);
    }
    // CF R2 objects API returns result as a plain array (not result.objects)
    const items = Array.isArray(json.result)
      ? json.result
      : (json.result?.objects ?? []);
    for (const obj of items) {
      objects.push(obj);
    }
    const isTruncated =
      json.result_info?.cursor != null ||
      (Array.isArray(json.result) ? false : json.result?.truncated);
    cursor = isTruncated
      ? (json.result_info?.cursor ?? json.result?.cursor ?? null)
      : null;
  } while (cursor);

  return objects;
}

/**
 * Sync all R2 archive objects from remote bucket → local wrangler dev storage.
 * Uses wrangler r2 object get (remote) and wrangler r2 object put --local.
 */
async function syncR2Archive(remoteBucketName, localBucketName, archivePrefix, wranglerBin, tmpDir) {
  console.log(`\n=== Syncing R2 archive: ${remoteBucketName} → local ${localBucketName} ===`);
  console.log(`Prefix: ${archivePrefix}`);

  const objects = await listRemoteR2Objects(remoteBucketName, archivePrefix);
  console.log(`Remote archive objects found: ${objects.length}`);

  if (objects.length === 0) {
    console.log("No archive objects to sync.");
    return;
  }

  let synced = 0;
  let skipped = 0;
  for (const obj of objects) {
    const key = obj.key;
    const tmpFile = join(tmpDir, `r2-archive-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    try {
      // Download from remote R2
      execFileSync(
        wranglerBin,
        ["r2", "object", "get", `${remoteBucketName}/${key}`, "--file", tmpFile, "--remote"],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );

      // Upload to local R2
      execFileSync(
        wranglerBin,
        [
          "r2", "object", "put",
          `${localBucketName}/${key}`,
          "--file", tmpFile,
          "--local",
          "--content-type", "application/json; charset=utf-8",
        ],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );

      synced++;
      console.log(`  synced: ${key}`);
    } catch (err) {
      skipped++;
      console.warn(`  SKIP ${key}: ${err.message?.split("\n")[0]}`);
    } finally {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  console.log(`R2 archive sync complete: ${synced} synced, ${skipped} skipped.`);
}

function runWrangler(dbName, mode, commandOrFile) {
  const base = [WRANGLER_BIN, "d1", "execute", dbName, mode, "--json"];
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

async function main() {
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

  try {
    runWrangler(dbName, "--local", { file: sqlFile });
  } finally {
    try { unlinkSync(sqlFile); } catch { /* ignore */ }
  }

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
  console.log("Done: local ship-growth D1 data seeded.");

  // ── R2 archive sync ──────────────────────────────────────────────
  if (args.syncR2) {
    const remoteBucket = "dev-kc-ship-growth-archive";
    const localBucket = "dev-kc-ship-growth-archive";
    const archivePrefix = "ship-growth/archive/";
    await syncR2Archive(remoteBucket, localBucket, archivePrefix, WRANGLER_BIN, tmpDir);
  } else {
    console.log("Skipping R2 archive sync (--no-r2).");
  }

  console.log("\nDone.");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
