#!/usr/bin/env node
/**
 * seed-local-fleet-data.mjs
 *
 * Downloads fleet snapshots from remote Cloudflare R2 and seeds
 * the local wrangler emulation (used by `astro dev` with platformProxy).
 *
 * Usage:
 *   node scripts/seed-local-fleet-data.mjs <dataset_id>
 *   node scripts/seed-local-fleet-data.mjs --all
 *
 * Examples:
 *   # Seed snapshots for a specific dataset_id (member_id_hash)
 *   node scripts/seed-local-fleet-data.mjs 73b5d4e465c258e0be1da2a541401abea10c20e0d2b83a0e5ed0cc41b6a89ab1
 *
 *   # Seed all datasets found in remote R2
 *   node scripts/seed-local-fleet-data.mjs --all
 *
 * Prerequisites:
 *   - `npx wrangler login` (authenticated with Cloudflare)
 *   - wrangler.toml configured with FLEET_SNAPSHOT_BUCKET binding
 */

import { execSync } from "child_process";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const BUCKET = "dev-kc-fleets";
const TMP_DIR = join(process.cwd(), ".seed-fleet-tmp");

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

/**
 * List remote R2 objects under a given prefix using the Cloudflare REST API.
 * Falls back to wrangler CLI JSON parsing when the API token has R2 list scope.
 */
function listRemoteObjects(prefix) {
  // Use wrangler r2 object get with a known prefix via the API
  // Since wrangler CLI doesn't have a list subcommand, we use the Cloudflare API
  // through wrangler's --remote flag on a list operation via a workaround:
  // execute a D1 query isn't applicable here, so we rely on the Cloudflare API token.

  // Attempt via wrangler-exposed API (requires workers:write scope in token)
  try {
    const result = run(
      `npx wrangler r2 object list ${BUCKET} --prefix "${prefix}" --remote --json 2>/dev/null`,
    );
    return JSON.parse(result);
  } catch {
    // wrangler doesn't have a native list command; use CF REST API via curl/PowerShell fallback
    return null;
  }
}

/**
 * Upload a local file to the local R2 bucket under the given key.
 */
function putLocal(key, localFile) {
  run(`npx wrangler r2 object put "${BUCKET}/${key}" --file "${localFile}"`);
}

/**
 * Download a remote R2 object to a local file.
 */
function getRemote(key, localFile) {
  run(
    `npx wrangler r2 object get "${BUCKET}/${key}" --file "${localFile}" --remote`,
  );
}

/**
 * Fetch remote R2 object keys under a prefix via Cloudflare REST API.
 * Requires wrangler OAuth token stored in the default config location.
 */
async function fetchRemoteKeys(prefix, { delimiter } = {}) {
  const accountId = "4251ceba7e6cde5576e39c207a13d720";
  let url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects?prefix=${encodeURIComponent(prefix)}&max_keys=1000`;
  if (delimiter) url += `&delimiter=${encodeURIComponent(delimiter)}`;

  // Read wrangler OAuth token
  const os = await import("os");
  const fs = await import("fs");
  const path = await import("path");
  const configPath = path.join(
    os.default.homedir(),
    "AppData",
    "Roaming",
    "xdg.config",
    ".wrangler",
    "config",
    "default.toml",
  );

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Wrangler config not found at ${configPath}. Run 'npx wrangler login' first.`,
    );
  }

  const config = fs.readFileSync(configPath, "utf8");
  const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!tokenMatch) {
    throw new Error(
      "No oauth_token found in wrangler config. Run 'npx wrangler login' first.",
    );
  }
  const token = tokenMatch[1];

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(
      `Cloudflare API error ${resp.status}: ${await resp.text()}`,
    );
  }

  const data = await resp.json();
  const keys = (data.result || []).map((obj) => obj.key);

  // Handle common prefix (delimiter-based listing returns delimited sub-paths)
  const delimited = data.result_info?.delimited || [];

  return { keys, delimited };
}

async function seedDataset(datasetId) {
  console.log(`\n  Dataset: ${datasetId.slice(0, 16)}...`);
  const prefix = `fleets/${datasetId}/`;

  const { keys } = await fetchRemoteKeys(prefix);

  if (keys.length === 0) {
    console.log("  No objects found in remote R2 for this dataset.");
    return 0;
  }

  console.log(`  Found ${keys.length} object(s).`);
  mkdirSync(TMP_DIR, { recursive: true });

  let seeded = 0;
  for (const key of keys) {
    const localFile = join(TMP_DIR, key.replace(/\//g, "__"));
    process.stdout.write(`    ${key.slice(prefix.length)}...`);
    try {
      getRemote(key, localFile);
      putLocal(key, localFile);
      console.log(" OK");
      seeded++;
    } catch (e) {
      console.log(` ERROR: ${e.message?.split("\n")[0]}`);
    }
  }
  return seeded;
}

async function main() {
  const args = process.argv.slice(2);
  const useAll = args.includes("--all");
  const specificId = !useAll && args[0] ? args[0].trim() : null;

  if (!useAll && !specificId) {
    console.error("Usage:");
    console.error(
      "  node scripts/seed-local-fleet-data.mjs <dataset_id>  # seed specific user",
    );
    console.error(
      "  node scripts/seed-local-fleet-data.mjs --all          # seed all datasets",
    );
    process.exit(1);
  }

  console.log("=== Local Fleet Data Seeder ===");

  let datasetIds = [];

  if (specificId) {
    datasetIds = [specificId];
  } else {
    // List all dataset directories under fleets/
    console.log("Fetching dataset list from remote R2...");
    const { delimited } = await fetchRemoteKeys("fleets/", { delimiter: "/" });
    datasetIds = delimited.map((d) =>
      d.replace(/^fleets\//, "").replace(/\/$/, ""),
    );
    if (datasetIds.length === 0) {
      console.log("No datasets found in remote R2.");
      return;
    }
    console.log(
      `Found ${datasetIds.length} dataset(s): ${datasetIds.map((d) => d.slice(0, 8) + "...").join(", ")}`,
    );
  }

  let total = 0;
  for (const id of datasetIds) {
    total += await seedDataset(id);
  }

  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });

  console.log(`\nDone! ${total} object(s) seeded to local R2 (${BUCKET}).`);
  console.log("Run `pnpm dev` to start the dev server.");
}

main().catch((e) => {
  console.error(e.message || e);
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  process.exit(1);
});
