#!/usr/bin/env node
/**
 * upload-synergy.mjs
 *
 * End-to-end workflow for publishing synergy data (sp_effect_item.json):
 *   1. Reads equip_synergy_detector output (slot_item_effects.json)
 *   2. Computes SHA-256 of the file
 *   3. Calls POST /api/master-data/synergy-manifest to allocate a manifest entry
 *   4. Uploads the JSON to R2 at the returned r2_keys
 *   5. Calls POST /api/master-data/synergy-manifest/complete to finalize
 *
 * Zero-config usage (after setting env vars once):
 *   export ADMIN_TOKEN=<token>
 *   export MASTER_DATA_BUCKET_NAME=dev-kc-master-data
 *   node scripts/upload-synergy.mjs
 *
 * Full usage:
 *   node scripts/upload-synergy.mjs \
 *     [--file ../equip_synergy_detector/output/slot_item_effects.json] \
 *     [--period-tag 2026-04-12] \
 *     [--api-start2-hash <64-char SHA-256>] \
 *     [--bucket-name dev-kc-master-data] \
 *     [--admin-token <token>] \
 *     [--env production] [--dry-run]
 *
 * Options (all optional if env vars set and scan.js embedded hashes):
 *   --file              Path to slot_item_effects.json
 *                       Default: ../../equip_synergy_detector/output/slot_item_effects.json
 *   --period-tag        YYYY-MM-DD. Default: today's date
 *   --api-start2-hash   64-char SHA-256. Default: _meta.api_start2_batch_hash from file
 *   --bucket-name       Actual R2 bucket name (NOT binding name).
 *                       Default: MASTER_DATA_BUCKET_NAME env var, or "dev-kc-master-data"
 *   --admin-token       X-ADMIN-TOKEN value. Default: ADMIN_TOKEN env var
 *   --env               "production" or omit for dev
 *   --dry-run           Print plan without executing
 *
 * NOTE: --bucket-name must be the actual R2 bucket name (e.g. "kc-master-data"),
 * NOT the wrangler binding name ("MASTER_DATA_BUCKET").
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Default file: equip_synergy_detector output lives next to FUSOU-WEB in the monorepo
const DEFAULT_FILE = resolve(__dirname, "../../equip_synergy_detector/output/slot_item_effects.json");

// ── Parse CLI arguments ────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) opts.file = args[++i];
    else if (args[i] === "--period-tag" && args[i + 1]) opts.periodTag = args[++i];
    else if (args[i] === "--api-start2-hash" && args[i + 1]) opts.apiStart2Hash = args[++i];
    else if (args[i] === "--bucket-name" && args[i + 1]) opts.bucketName = args[++i];
    else if (args[i] === "--admin-token" && args[i + 1]) opts.adminToken = args[++i];
    else if (args[i] === "--env" && args[i + 1]) opts.env = args[++i];
    else if (args[i] === "--dry-run") opts.dryRun = true;
    else if (args[i] === "--help" || args[i] === "-h") opts.help = true;
  }
  return opts;
}

function usage() {
  console.error(`
Usage: node scripts/upload-synergy.mjs [options]

All options have smart defaults — running without args works if env vars are set:
  export ADMIN_TOKEN=<token>
  export MASTER_DATA_BUCKET_NAME=dev-kc-master-data

Options:
  --file <path>           slot_item_effects.json (default: equip_synergy_detector/output/)
  --period-tag <YYYY-MM-DD>  Default: today's date
  --api-start2-hash <hex>    Default: embedded in file by scan.js
  --bucket-name <name>    Actual R2 bucket name. Default: MASTER_DATA_BUCKET_NAME env
  --admin-token <token>   Default: ADMIN_TOKEN env var
  --env production        Target production (default: dev / localhost:4321)
  --dry-run               Print plan without executing
  `);
  process.exit(1);
}

// ── Validation ─────────────────────────────────────────────────────
function validateSHA256(hash) {
  return /^[a-f0-9]{64}$/i.test(hash);
}

function validatePeriodTag(tag) {
  return /^\d{4}-\d{2}-\d{2}$/.test(tag);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// ── Resolve API base URL ───────────────────────────────────────────
function resolveApiBase(env) {
  const envVar = process.env.SYNERGY_API_BASE;
  if (envVar) return envVar;

  if (env === "production") {
    const siteUrl = process.env.PUBLIC_SITE_URL_PRODUCTION;
    if (!siteUrl) {
      console.error(
        "Error: PUBLIC_SITE_URL_PRODUCTION env var is required for production, or set SYNERGY_API_BASE"
      );
      process.exit(1);
    }
    return siteUrl.replace(/\/$/, "");
  }

  // Default: local dev server
  return "http://localhost:4321";
}

// ── Resolve R2 bucket name ─────────────────────────────────────────
// NOTE: wrangler r2 object put takes the ACTUAL bucket name, not the binding name.
// The binding name (MASTER_DATA_BUCKET) is a Workers-runtime concept and is NOT
// recognised by the wrangler CLI for r2 commands.
function resolveR2BucketName(env, cliOverride) {
  if (cliOverride) return cliOverride;
  const envVar = process.env.MASTER_DATA_BUCKET_NAME;
  if (envVar) return envVar;
  // Fail loudly for production rather than silently using the dev bucket.
  if (env === "production") {
    console.error(
      "Error: --bucket-name (or MASTER_DATA_BUCKET_NAME env var) is required for production."
    );
    process.exit(1);
  }
  return "dev-kc-master-data";
}

// ── Wrangler R2 upload ─────────────────────────────────────────────
function wranglerR2Put(r2Key, localPath, env, bucketName) {
  // --remote uploads to the actual Cloudflare R2 (not local dev storage).
  const remoteFlag = env === "production" ? " --remote" : "";
  const cmd = `npx wrangler r2 object put "${bucketName}/${r2Key}" --file ${shellQuote(localPath)}${remoteFlag}`;
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

// ── API calls ──────────────────────────────────────────────────────
async function apiPost(baseUrl, path, body, adminToken) {
  const url = `${baseUrl}${path}`;
  console.log(`  POST ${url}`);
  const headers = { "Content-Type": "application/json" };
  if (adminToken) headers["X-ADMIN-TOKEN"] = adminToken;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) usage();

  // ── Resolve file path ─────────────────────────────────────────────
  const filePath = resolve(opts.file || DEFAULT_FILE);
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    console.error("  Run `pnpm scan:volatile` in equip_synergy_detector first, or pass --file <path>");
    process.exit(1);
  }

  // ── Read file and parse metadata ───────────────────────────────────
  const fileBuffer = readFileSync(filePath);
  const fileHash = sha256(fileBuffer);
  const fileSizeKB = (fileBuffer.length / 1024).toFixed(1);

  let meta;
  try {
    const parsed = JSON.parse(fileBuffer.toString("utf-8"));
    meta = parsed._meta;
  } catch {
    console.error("Error: File is not valid JSON");
    process.exit(1);
  }
  if (!meta || !meta.generated) {
    console.error("Error: JSON missing _meta.generated field");
    process.exit(1);
  }

  // ── Resolve all values with smart defaults ─────────────────────────
  // period_tag priority: --period-tag CLI > _meta.period_tag (embedded by scan.js --period-tag) > error
  const periodTag = opts.periodTag || meta.period_tag || null;
  if (!periodTag) {
    console.error('Error: period_tag is required.');
    console.error('  Pass --period-tag YYYY-MM-DD, or re-run scan.js with --period-tag YYYY-MM-DD to embed it.');
    process.exit(1);
  }
  const apiStart2Hash = opts.apiStart2Hash || meta.api_start2_batch_hash;
  const generatorVersion = meta.generator_version || "v0.1.0";
  const apiBase = resolveApiBase(opts.env);
  const bucketName = resolveR2BucketName(opts.env, opts.bucketName);
  const adminToken = opts.adminToken || process.env.ADMIN_TOKEN;

  // ── Validate ───────────────────────────────────────────────────────
  if (!validatePeriodTag(periodTag)) {
    console.error(`Error: Invalid period-tag: "${periodTag}" (expected YYYY-MM-DD)`);
    process.exit(1);
  }
  if (!apiStart2Hash) {
    console.error("Error: api-start2-hash not found.");
    console.error("  Either pass --api-start2-hash, or re-run scan.js to embed it automatically.");
    process.exit(1);
  }
  if (!validateSHA256(apiStart2Hash)) {
    console.error(`Error: api-start2-hash is not a valid 64-char SHA-256 hex string`);
    process.exit(1);
  }
  if (!adminToken) {
    console.error("Error: admin token not found. Pass --admin-token or set the ADMIN_TOKEN env var.");
    process.exit(1);
  }

  // ── Print plan ─────────────────────────────────────────────────────
  console.log("=== Synergy Upload Plan ===");
  console.log(`  File:             ${basename(filePath)} (${fileSizeKB} KB)`);
  console.log(`  SHA-256:          ${fileHash}`);
  console.log(`  Period Tag:       ${periodTag}`);
  console.log(`  API Start2 Hash:  ${apiStart2Hash}`);
  console.log(`  Generator:        ${generatorVersion}`);
  console.log(`  Generated At:     ${meta.generated}`);
  console.log(`  API Base:         ${apiBase}`);
  console.log(`  R2 Bucket:        ${bucketName}`);
  console.log(`  Admin Token:      ***`);
  console.log();

  if (opts.dryRun) {
    console.log("[dry-run] Would execute the following steps:");
    console.log(`  1. POST /api/master-data/synergy-manifest (allocate manifest)`);
    console.log(`  2. wrangler r2 object put ${bucketName}/<r2key> (upload JSON to R2)`);
    console.log(`  3. POST /api/master-data/synergy-manifest/complete (finalize)`);
    return;
  }

  // Step 1: Allocate manifest
  console.log("[1/3] Allocating synergy manifest...");
  const manifest = await apiPost(apiBase, "/api/master-data/synergy-manifest", {
    period_tag: periodTag,
    sp_effect_sha256: fileHash,
    api_start2_batch_hash: apiStart2Hash,
    generator_version: generatorVersion,
    generated_at: meta.generated,
  }, adminToken);
  console.log(
    `  ✓ Allocated: period_revision=${manifest.period_revision}, id=${manifest.id}`
  );
  console.log(`  R2 key: ${manifest.r2_keys.sp_effect_json}`);
  console.log();

  // Step 2: Upload to R2 via wrangler
  console.log("[2/3] Uploading to R2...");
  wranglerR2Put(manifest.r2_keys.sp_effect_json, filePath, opts.env, bucketName);
  console.log(`  ✓ sp_effect_item uploaded: ${manifest.r2_keys.sp_effect_json}`);

  // Also create and upload the manifest sidecar JSON
  const manifestSidecar = JSON.stringify({
    period_tag: periodTag,
    period_revision: manifest.period_revision,
    sp_effect_sha256: fileHash,
    api_start2_batch_hash: apiStart2Hash,
    generator_version: generatorVersion,
    generated_at: meta.generated,
    upload_status: "pending",
  });
  const sidecarTmp = resolve(filePath + ".manifest.json");
  writeFileSync(sidecarTmp, manifestSidecar, "utf-8");
  try {
    wranglerR2Put(manifest.r2_keys.manifest, sidecarTmp, opts.env, bucketName);
    console.log(`  ✓ manifest sidecar uploaded: ${manifest.r2_keys.manifest}`);
  } finally {
    unlinkSync(sidecarTmp);
  }
  console.log();

  // Step 3: Mark as completed
  console.log("[3/3] Finalizing manifest...");
  const completed = await apiPost(
    apiBase,
    `/api/master-data/synergy-manifest/complete/${periodTag}/${manifest.period_revision}`,
    {},
    adminToken
  );
  console.log(`  ✓ ${completed.message} (status: ${completed.upload_status})`);
  console.log();

  console.log("=== Done ===");
  console.log(`  period_tag:      ${periodTag}`);
  console.log(`  period_revision: ${manifest.period_revision}`);
  console.log(`  upload_status:   ${completed.upload_status}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
