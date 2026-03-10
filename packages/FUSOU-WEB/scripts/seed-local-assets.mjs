#!/usr/bin/env node
/**
 * seed-local-assets.mjs
 *
 * Downloads ship banner images from remote Cloudflare R2 and seeds
 * the local wrangler emulation (used by `astro dev` with platformProxy).
 *
 * Usage:
 *   node scripts/seed-local-assets.mjs          # seed first 30 banners
 *   node scripts/seed-local-assets.mjs --all    # seed ALL banners (~543)
 *   node scripts/seed-local-assets.mjs --limit 100  # seed first 100
 *
 * Prerequisites:
 *   - `npx wrangler login` (authenticated with Cloudflare)
 *   - wrangler.toml configured with correct R2/D1 bindings
 */

import { execSync } from "child_process";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const ASSET_BUCKET = "dev-kc-assets";
const ASSET_DB = "dev_kc_asset_index";
const TMP_DIR = join(process.cwd(), ".seed-assets-tmp");

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
  const limitIdx = process.argv.indexOf("--limit");
  const limit = useAll ? 99999 : (limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) || 30 : 30);

  console.log("=== Local Asset Seeder (Ship Banners) ===");
  console.log(`Limit: ${useAll ? "ALL" : limit}`);
  console.log();

  // Step 1: Query remote D1 for banner keys
  console.log("[1/4] Querying remote D1 for banner image keys...");
  let bannerKeys;
  try {
    const output = run(
      `npx wrangler d1 execute ${ASSET_DB} --remote --command "SELECT key FROM files WHERE key LIKE 'assets/kcs2/resources/ship/banner/%' ORDER BY key LIMIT ${limit};" --json`
    );
    const parsed = JSON.parse(output);
    const results = parsed?.[0]?.results;
    if (!results || results.length === 0) {
      console.error("No banner images found in remote D1.");
      process.exit(1);
    }
    bannerKeys = results.map((r) => r.key);
    console.log(`  Found ${bannerKeys.length} banner keys.`);
  } catch (e) {
    console.error("Failed to query remote D1. Are you logged in? (npx wrangler login)");
    console.error(e.message);
    process.exit(1);
  }

  // Step 2: Ensure local D1 schema
  console.log("[2/4] Ensuring local D1 files table...");
  runQuiet(
    `npx wrangler d1 execute ${ASSET_DB} --command "CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, size INTEGER, mime TEXT, uploaded_at INTEGER);"`
  );
  console.log("  Schema ready.");

  // Step 3: Download from remote R2
  console.log("[3/4] Downloading banner images from remote R2...");
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  let downloaded = 0;
  for (const r2Key of bannerKeys) {
    const filename = r2Key.split("/").pop();
    const localFile = join(TMP_DIR, filename);
    process.stdout.write(`  ${filename}...`);
    try {
      run(`npx wrangler r2 object get ${ASSET_BUCKET}/${r2Key} --file "${localFile}" --remote`);
      downloaded++;
      console.log(" OK");
    } catch {
      console.log(" SKIP");
    }
  }
  console.log(`  Downloaded ${downloaded}/${bannerKeys.length} images.`);

  // Step 4: Upload to local R2 + insert D1 records
  console.log("[4/4] Seeding local R2 & D1...");
  let seeded = 0;
  for (const r2Key of bannerKeys) {
    const filename = r2Key.split("/").pop();
    const localFile = join(TMP_DIR, filename);
    if (!existsSync(localFile)) continue;

    process.stdout.write(`  ${filename}...`);
    try {
      // Upload to local R2
      run(`npx wrangler r2 object put ${ASSET_BUCKET}/${r2Key} --file "${localFile}" --content-type "image/png"`);

      // Insert D1 record (ignore if exists)
      const escapedKey = r2Key.replace(/'/g, "''");
      const now = Math.floor(Date.now() / 1000);
      runQuiet(
        `npx wrangler d1 execute ${ASSET_DB} --command "INSERT OR IGNORE INTO files (key, mime, uploaded_at) VALUES ('${escapedKey}', 'image/png', ${now});"`
      );

      seeded++;
      console.log(" OK");
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
    }
  }

  // Cleanup
  rmSync(TMP_DIR, { recursive: true });

  console.log();
  console.log(`Done! Seeded ${seeded} banner images to local R2 & D1.`);
  console.log("The dev server should now serve banners at /api/asset-sync/ship-banner/:shipId");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
