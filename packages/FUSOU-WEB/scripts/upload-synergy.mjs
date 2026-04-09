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
 * Usage:
 *   node scripts/upload-synergy.mjs \
 *     --file ../equip_synergy_detector/output/slot_item_effects.json \
 *     --period-tag 2026-04-09 \
 *     --api-start2-hash <64-char SHA-256 of the api_start2 master data batch> \
 *     [--env production]
 *
 * Options:
 *   --file              Path to the synergy JSON (required)
 *   --period-tag        YYYY-MM-DD period tag (required)
 *   --api-start2-hash   SHA-256 of the api_start2 batch that was used for generation (required)
 *   --env               Wrangler environment: "production" or omit for dev (default: dev)
 *   --dry-run           Print plan without executing
 *
 * Prerequisites:
 *   - `npx wrangler login` (authenticated with Cloudflare)
 *   - wrangler.toml with MASTER_DATA_BUCKET binding
 *   - Synergy API endpoints deployed
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve, basename } from "path";
import { execSync } from "child_process";

// ── Parse CLI arguments ────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) opts.file = args[++i];
    else if (args[i] === "--period-tag" && args[i + 1]) opts.periodTag = args[++i];
    else if (args[i] === "--api-start2-hash" && args[i + 1]) opts.apiStart2Hash = args[++i];
    else if (args[i] === "--env" && args[i + 1]) opts.env = args[++i];
    else if (args[i] === "--dry-run") opts.dryRun = true;
    else if (args[i] === "--help" || args[i] === "-h") opts.help = true;
  }
  return opts;
}

function usage() {
  console.error(`Usage: node scripts/upload-synergy.mjs \\
  --file <path-to-slot_item_effects.json> \\
  --period-tag <YYYY-MM-DD> \\
  --api-start2-hash <64-char SHA-256> \\
  [--env production] [--dry-run]`);
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
    const siteUrl = process.env.PUBLIC_SITE_URL;
    if (!siteUrl) {
      console.error(
        "Error: PUBLIC_SITE_URL env var is required for production, or set SYNERGY_API_BASE"
      );
      process.exit(1);
    }
    return siteUrl.replace(/\/$/, "");
  }

  // Default: local dev server
  return "http://localhost:4321";
}

// ── Wrangler R2 upload ─────────────────────────────────────────────
function wranglerR2Put(r2Key, localPath, env) {
  const envFlag = env === "production" ? " --env production" : "";
  const cmd = `npx wrangler r2 object put "MASTER_DATA_BUCKET/${r2Key}" --file ${shellQuote(localPath)}${envFlag}`;
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

// ── API calls ──────────────────────────────────────────────────────
async function apiPost(baseUrl, path, body) {
  const url = `${baseUrl}${path}`;
  console.log(`  POST ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

  // Validate required args
  if (!opts.file) {
    console.error("Error: --file is required");
    usage();
  }
  if (!opts.periodTag) {
    console.error("Error: --period-tag is required");
    usage();
  }
  if (!opts.apiStart2Hash) {
    console.error("Error: --api-start2-hash is required");
    usage();
  }
  if (!validatePeriodTag(opts.periodTag)) {
    console.error(`Error: Invalid period-tag format: ${opts.periodTag} (expected YYYY-MM-DD)`);
    process.exit(1);
  }
  if (!validateSHA256(opts.apiStart2Hash)) {
    console.error(
      `Error: Invalid api-start2-hash: must be 64-char lowercase hex SHA-256`
    );
    process.exit(1);
  }

  const filePath = resolve(opts.file);
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  // Read and hash the file
  const fileBuffer = readFileSync(filePath);
  const fileHash = sha256(fileBuffer);
  const fileSizeKB = (fileBuffer.length / 1024).toFixed(1);

  // Extract _meta from JSON for generator_version
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

  // Use _meta.generator_version if present, otherwise derive from package
  const generatorVersion = meta.generator_version || "v0.1.0";

  const apiBase = resolveApiBase(opts.env);

  console.log("=== Synergy Upload Plan ===");
  console.log(`  File:             ${basename(filePath)} (${fileSizeKB} KB)`);
  console.log(`  SHA-256:          ${fileHash}`);
  console.log(`  Period Tag:       ${opts.periodTag}`);
  console.log(`  API Start2 Hash:  ${opts.apiStart2Hash}`);
  console.log(`  Generator:        ${generatorVersion}`);
  console.log(`  Generated At:     ${meta.generated}`);
  console.log(`  API Base:         ${apiBase}`);
  console.log();

  if (opts.dryRun) {
    console.log("[dry-run] Would execute the following steps:");
    console.log("  1. POST /api/master-data/synergy-manifest (allocate manifest)");
    console.log("  2. wrangler r2 object put (upload JSON to R2)");
    console.log("  3. POST /api/master-data/synergy-manifest/complete (finalize)");
    return;
  }

  // Step 1: Allocate manifest
  console.log("[1/3] Allocating synergy manifest...");
  const manifest = await apiPost(apiBase, "/api/master-data/synergy-manifest", {
    period_tag: opts.periodTag,
    sp_effect_sha256: fileHash,
    api_start2_batch_hash: opts.apiStart2Hash,
    generator_version: generatorVersion,
    generated_at: meta.generated,
  });
  console.log(
    `  ✓ Allocated: period_revision=${manifest.period_revision}, id=${manifest.id}`
  );
  console.log(`  R2 key: ${manifest.r2_keys.sp_effect_json}`);
  console.log();

  // Step 2: Upload to R2 via wrangler
  console.log("[2/3] Uploading to R2...");
  wranglerR2Put(manifest.r2_keys.sp_effect_json, filePath, opts.env);
  console.log(`  ✓ sp_effect_item uploaded: ${manifest.r2_keys.sp_effect_json}`);

  // Also create and upload the manifest sidecar JSON
  const manifestSidecar = JSON.stringify({
    period_tag: opts.periodTag,
    period_revision: manifest.period_revision,
    sp_effect_sha256: fileHash,
    api_start2_batch_hash: opts.apiStart2Hash,
    generator_version: generatorVersion,
    generated_at: meta.generated,
    upload_status: "pending",
  });
  const sidecarTmp = resolve(filePath + ".manifest.json");
  writeFileSync(sidecarTmp, manifestSidecar, "utf-8");
  try {
    wranglerR2Put(manifest.r2_keys.manifest, sidecarTmp, opts.env);
    console.log(`  ✓ manifest sidecar uploaded: ${manifest.r2_keys.manifest}`);
  } finally {
    unlinkSync(sidecarTmp);
  }
  console.log();

  // Step 3: Mark as completed
  console.log("[3/3] Finalizing manifest...");
  const completed = await apiPost(
    apiBase,
    `/api/master-data/synergy-manifest/complete/${opts.periodTag}/${manifest.period_revision}`,
    {}
  );
  console.log(`  ✓ ${completed.message} (status: ${completed.upload_status})`);
  console.log();

  console.log("=== Done ===");
  console.log(`  period_tag:     ${opts.periodTag}`);
  console.log(`  period_revision: ${manifest.period_revision}`);
  console.log(`  upload_status:  ${completed.upload_status}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
