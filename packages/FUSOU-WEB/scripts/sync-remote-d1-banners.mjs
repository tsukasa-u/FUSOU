#!/usr/bin/env node
/**
 * sync-remote-d1-banners.mjs
 *
 * Syncs ship banner keys from the remote (production) D1 database into the
 * local wrangler D1 emulation.  When ASSET_BASE_URL is set in .dev.vars,
 * the client fetches images directly from the CDN — so we only need the keys
 * in local D1 for the banner-map endpoint, not the actual image blobs.
 *
 * Usage:
 *   node scripts/sync-remote-d1-banners.mjs
 *
 * After running, restart the Astro dev server so that platformProxy picks up
 * the updated SQLite data.
 *
 * Prerequisites:
 *   - `npx wrangler login` (Cloudflare auth)
 *   - wrangler.toml must have the D1 binding for dev_kc_asset_index
 */

import { execSync } from "child_process";

const ASSET_DB = "dev_kc_asset_index";
const BATCH_SIZE = 50;

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

function runQuiet(cmd) {
  try {
    return run(cmd);
  } catch {
    return "";
  }
}

async function main() {
  console.log("=== Sync Remote D1 Banner Keys → Local ===\n");

  // 1. Query remote D1
  console.log("[1/3] Querying remote D1 for banner keys...");
  let keys;
  try {
    const out = run(
      `npx wrangler d1 execute ${ASSET_DB} --remote --command "SELECT key FROM files WHERE key LIKE 'assets/kcs2/resources/ship/banner/%' ORDER BY key" --json`,
    );
    const parsed = JSON.parse(out);
    keys = parsed?.[0]?.results?.map((r) => r.key);
    if (!keys || keys.length === 0) {
      console.error("No banner keys found in remote D1.");
      process.exit(1);
    }
    console.log(`  Found ${keys.length} banner keys.\n`);
  } catch (e) {
    console.error("Failed to query remote D1. Run `npx wrangler login` first.");
    console.error(e.message);
    process.exit(1);
  }

  // 2. Ensure local schema
  console.log("[2/3] Ensuring local D1 schema...");
  runQuiet(
    `npx wrangler d1 execute ${ASSET_DB} --local --command "CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, size INTEGER, mime TEXT, uploaded_at INTEGER);"`,
  );
  console.log("  Schema ready.\n");

  // 3. Batch insert
  console.log("[3/3] Inserting banner keys into local D1...");
  let total = 0;
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const values = batch.map((k) => `('${k.replace(/'/g, "''")}')`).join(",");
    const sql = `INSERT OR IGNORE INTO files (key) VALUES ${values}`;
    runQuiet(`npx wrangler d1 execute ${ASSET_DB} --local --command "${sql}"`);
    total += batch.length;
    process.stdout.write(`  ${total}/${keys.length}\r`);
  }
  console.log(`  ${total}/${keys.length} — done.`);

  console.log(`\n✓ Synced ${keys.length} banner keys to local D1.`);
  console.log("  Restart the dev server (npm run dev) to pick up the changes.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
