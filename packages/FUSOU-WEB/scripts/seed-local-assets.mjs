#!/usr/bin/env node
/**
 * seed-local-assets.mjs
 *
 * Collects ship/equipment images from FUSOU-PROXY-DATA (local proxy cache)
 * and seeds the local wrangler emulation (used by `astro dev` with platformProxy).
 *
 * No remote download needed — images are read directly from PROXY-DATA.
 *
 * Usage:
 *   node scripts/seed-local-assets.mjs                  # seed all types
 *   node scripts/seed-local-assets.mjs --type banner    # seed banners only
 *   node scripts/seed-local-assets.mjs --type card      # seed cards only
 *   node scripts/seed-local-assets.mjs --type slot_card       # seed equipment card only
 *   node scripts/seed-local-assets.mjs --type slot_item_up    # seed equipment item_up only
 *   node scripts/seed-local-assets.mjs --limit 50       # seed first 50 of each type
 *
 * Prerequisites:
 *   - FUSOU-PROXY-DATA directory exists at ../../FUSOU-PROXY-DATA (relative to FUSOU-WEB)
 *     or set PROXY_DATA_DIR env var
 */

import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const ASSET_BUCKET = "dev-kc-assets";
const ASSET_DB = "dev_kc_asset_index";

const DEFAULT_PROXY_DATA = resolve(PROJECT_ROOT, "..", "FUSOU-PROXY-DATA");
const PROXY_DATA_DIR = process.env.PROXY_DATA_DIR || DEFAULT_PROXY_DATA;

// Maps type name → { proxySubpath, r2Prefix }
const ASSET_TYPES = {
  banner:       { proxySubpath: "kcs2/resources/ship/banner",    r2Prefix: "assets/kcs2/resources/ship/banner" },
  card:         { proxySubpath: "kcs2/resources/ship/card",      r2Prefix: "assets/kcs2/resources/ship/card" },
  slot_card:    { proxySubpath: "kcs2/resources/slot/card",      r2Prefix: "assets/kcs2/resources/slot/card" },
  slot_item_up: { proxySubpath: "kcs2/resources/slot/item_up",   r2Prefix: "assets/kcs2/resources/slot/item_up" },
};

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", cwd: PROJECT_ROOT, stdio: ["pipe", "pipe", "pipe"] });
}

function runQuiet(cmd) {
  try {
    return run(cmd);
  } catch (e) {
    return e.stderr || e.stdout || "";
  }
}

/**
 * Collect unique PNG files from all date folders in PROXY-DATA for a given subpath.
 * Later dates override earlier ones (newest file wins).
 */
function collectFiles(proxySubpath) {
  const dateDirs = readdirSync(PROXY_DATA_DIR)
    .filter((d) => statSync(join(PROXY_DATA_DIR, d)).isDirectory())
    .sort(); // chronological order, newest last → overwrites earlier

  const fileMap = new Map(); // filename → absolute path (newest wins)
  for (const dateDir of dateDirs) {
    const dir = join(PROXY_DATA_DIR, dateDir, proxySubpath);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".png")) {
        fileMap.set(file, join(dir, file));
      }
    }
  }
  return fileMap;
}

async function seedAssetType(type, config, limit) {
  const { proxySubpath, r2Prefix } = config;
  console.log(`\n--- Seeding ${type} images ---`);

  // Collect from PROXY-DATA
  console.log(`  [1/2] Collecting ${type} images from PROXY-DATA...`);
  const fileMap = collectFiles(proxySubpath);
  if (fileMap.size === 0) {
    console.log(`  No ${type} images found in PROXY-DATA. Skipping.`);
    return 0;
  }

  // Apply limit
  const entries = [...fileMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const limited = limit ? entries.slice(0, limit) : entries;
  console.log(`  Found ${fileMap.size} unique files, seeding ${limited.length}.`);

  // Upload to local R2 + insert D1 records
  console.log(`  [2/2] Seeding local R2 & D1...`);
  let seeded = 0;
  for (const [filename, filePath] of limited) {
    const r2Key = `${r2Prefix}/${filename}`;
    process.stdout.write(`    ${filename}...`);
    try {
      run(`npx wrangler r2 object put ${ASSET_BUCKET}/${r2Key} --file "${filePath}" --content-type "image/png"`);

      const escapedKey = r2Key.replace(/'/g, "''");
      const now = Math.floor(Date.now() / 1000);
      runQuiet(
        `npx wrangler d1 execute ${ASSET_DB} --command "INSERT OR IGNORE INTO files (key, size, content_type, uploaded_at, uploader_id) VALUES ('${escapedKey}', 0, 'image/png', ${now}, 'local-seed');"`
      );

      seeded++;
      console.log(" OK");
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
    }
  }

  return seeded;
}

async function main() {
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) || null : null;
  const typeIdx = process.argv.indexOf("--type");
  const typeFilter = typeIdx >= 0 ? process.argv[typeIdx + 1] : null;

  if (typeFilter && !ASSET_TYPES[typeFilter]) {
    console.error(`Unknown type: ${typeFilter}. Available: ${Object.keys(ASSET_TYPES).join(", ")}`);
    process.exit(1);
  }

  const typesToSeed = typeFilter
    ? { [typeFilter]: ASSET_TYPES[typeFilter] }
    : ASSET_TYPES;

  console.log("=== Local Asset Seeder (from PROXY-DATA) ===");
  console.log(`Source: ${PROXY_DATA_DIR}`);
  console.log(`Types:  ${Object.keys(typesToSeed).join(", ")}`);
  if (limit) console.log(`Limit:  ${limit} per type`);

  if (!existsSync(PROXY_DATA_DIR)) {
    console.error(`\nERROR: PROXY-DATA directory not found: ${PROXY_DATA_DIR}`);
    console.error("Set PROXY_DATA_DIR env var or ensure FUSOU-PROXY-DATA exists.");
    process.exit(1);
  }

  // Ensure local D1 schema
  console.log("\nEnsuring local D1 files table...");
  runQuiet(
    `npx wrangler d1 execute ${ASSET_DB} --command "CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, content_type TEXT DEFAULT 'application/octet-stream', content_hash TEXT, uploaded_at INTEGER NOT NULL, uploader_id TEXT NOT NULL, finder_tag TEXT DEFAULT NULL, metadata TEXT DEFAULT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);"`
  );
  console.log("  Schema ready.");

  let totalSeeded = 0;
  for (const [type, config] of Object.entries(typesToSeed)) {
    totalSeeded += await seedAssetType(type, config, limit);
  }

  console.log();
  console.log(`Done! Seeded ${totalSeeded} total images to local R2 & D1.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
