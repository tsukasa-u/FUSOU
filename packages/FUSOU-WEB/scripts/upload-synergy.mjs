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
 *   --force             Allocate a fresh revision even if the same content already exists
 *   --br                Force Brotli payload upload (default: off in production)
 *
 * NOTE: --bucket-name must be the actual R2 bucket name (e.g. "kc-master-data"),
 * NOT the wrangler binding name ("MASTER_DATA_BUCKET").
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve, basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { brotliCompressSync, constants as zlibConstants } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { readdirSync, statSync } from "fs";

// Default file: equip_synergy_detector output lives next to FUSOU-WEB in the monorepo
function findDefaultFile(periodTag = null) {
  const dir = resolve(__dirname, "../../equip_synergy_detector/output");
  if (!existsSync(dir)) return null;

  if (periodTag) {
    const matched = join(dir, `slot_item_effects_${periodTag}.json`);
    if (existsSync(matched)) return matched;
  }

  const files = readdirSync(dir)
    .filter(f => f.startsWith("slot_item_effects_") && f.endsWith(".json") && f !== "slot_item_effects_ast.json")
    .map(f => ({ name: f, fullPath: join(dir, f), mtimeMs: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.length > 0 ? files[0].fullPath : null;
}

// ── Parse CLI arguments ────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {};
  const knownFlags = new Set([
    "--file",
    "--period-tag",
    "--api-start2-hash",
    "--bucket-name",
    "--admin-token",
    "--env",
    "--dry-run",
    "--force",
    "--no-br",
    "--br",
    "--help",
    "-h",
  ]);
  const readValue = (flag, index) => {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      console.error(`Error: ${flag} requires a value.`);
      process.exit(1);
    }
    return value;
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;

    if (!arg.startsWith("--") && arg !== "-h") {
      console.error(`Error: unexpected argument: ${arg}`);
      process.exit(1);
    }
    if (arg.startsWith("--") || arg === "-h") {
      if (!knownFlags.has(arg)) {
        console.error(`Error: unknown option: ${arg}`);
        process.exit(1);
      }
    }

    if (arg === "--file") opts.file = readValue("--file", i++);
    else if (arg === "--period-tag")
      opts.periodTag = readValue("--period-tag", i++);
    else if (arg === "--api-start2-hash")
      opts.apiStart2Hash = readValue("--api-start2-hash", i++);
    else if (arg === "--bucket-name")
      opts.bucketName = readValue("--bucket-name", i++);
    else if (arg === "--admin-token")
      opts.adminToken = readValue("--admin-token", i++);
    else if (arg === "--env") opts.env = readValue("--env", i++);
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--no-br") opts.noBr = true;
    else if (arg === "--br") opts.br = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
  }

  if (opts.noBr && opts.br) {
    console.error("Error: --no-br and --br cannot be used together.");
    process.exit(1);
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
  --force                 Allocate a fresh revision even if the same content already exists
  --no-br                 Upload raw JSON (disable Brotli payload)
  --br                    Force Brotli payload upload (default: off in production)
  `);
  process.exit(1);
}

class ApiError extends Error {
  constructor(status, body) {
    super(`API ${status}: ${JSON.stringify(body)}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
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

function getSynergyManifestR2Keys(periodTag, periodRevision, contentHash) {
  const basePath = `master_data_meta/sp_effect/${periodTag}/rev${periodRevision}/${contentHash}`;
  return {
    sp_effect_json: `${basePath}.json`,
    manifest: `master_data_meta/manifest/${periodTag}/rev${periodRevision}/${contentHash}.manifest.json`,
  };
}

function isConcurrentManifestConflict(err) {
  return (
    err instanceof ApiError &&
    err.status === 409 &&
    typeof err.body?.error === "string" &&
    err.body.error.includes("Concurrent conflict")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function allocateSynergyManifest(apiBase, requestBody, adminToken) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await apiPost(
        apiBase,
        "/api/master-data/synergy-manifest",
        requestBody,
        adminToken,
      );
    } catch (err) {
      if (!isConcurrentManifestConflict(err) || attempt === maxAttempts) {
        throw err;
      }
      console.warn(
        `  [retry] Concurrent manifest allocation conflict (attempt ${attempt}/${maxAttempts}); retrying in 1s...`,
      );
      await sleep(1000);
    }
  }
}

// ── Resolve API base URL ───────────────────────────────────────────
function resolveApiBase(env) {
  const envVar = process.env.SYNERGY_API_BASE;
  if (envVar) return envVar;

  if (env === "production") {
    const siteUrl = process.env.PUBLIC_SITE_URL_PRODUCTION;
    if (!siteUrl) {
      console.error(
        "Error: PUBLIC_SITE_URL_PRODUCTION env var is required for production, or set SYNERGY_API_BASE",
      );
      process.exit(1);
    }
    return siteUrl.replace(/\/$/, "");
  }

  const devSiteUrl = process.env.PUBLIC_SITE_URL;
  if (devSiteUrl) {
    return devSiteUrl.replace(/\/$/, "");
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
      "Error: --bucket-name (or MASTER_DATA_BUCKET_NAME env var) is required for production.",
    );
    process.exit(1);
  }
  return "dev-kc-master-data";
}

// ── Wrangler R2 upload ─────────────────────────────────────────────
function wranglerR2Put(r2Key, localPath, env, bucketName) {
  // Use argv-based spawn (not shell command string) to avoid platform-specific
  // quoting issues on Windows paths passed to --file.
  const wranglerArgs = [
    "wrangler",
    "r2",
    "object",
    "put",
    `${bucketName}/${r2Key}`,
    "--file",
    localPath,
  ];
  if (env === "production") wranglerArgs.push("--remote");

  const localWrangler =
    process.platform === "win32"
      ? join(__dirname, "..", "node_modules", ".bin", "wrangler.cmd")
      : join(__dirname, "..", "node_modules", ".bin", "wrangler");
  const spawnOptions = {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd: join(__dirname, ".."),
  };

  const command = localWrangler;
  const commandArgs = wranglerArgs.slice(1);

  console.log(`  $ ${command} ${commandArgs.join(" ")}`);
  let result = spawnSync(command, commandArgs, spawnOptions);

  // Fallback to npx only when direct local-binary execution fails to launch.
  if (result.error) {
    const npxCommand = "npx";
    console.warn(
      `  [warn] direct wrangler launch failed (${result.error.message}); falling back to ${npxCommand}`,
    );
    console.log(`  $ ${npxCommand} ${wranglerArgs.join(" ")}`);
    result = spawnSync(npxCommand, wranglerArgs, spawnOptions);
  }

  if (result.error) {
    throw new Error(`wrangler launch failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `wrangler r2 object put failed with exit code ${result.status}`,
    );
  }
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
  const rawBody = await res.text();
  let responseBody = null;
  if (rawBody) {
    try {
      responseBody = JSON.parse(rawBody);
    } catch {
      responseBody = { raw: rawBody };
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, responseBody);
  }
  return responseBody;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) usage();
  if (opts.env && opts.env !== "production" && opts.env !== "development") {
    console.error(
      `Error: --env must be one of: production, development. got: ${opts.env}`,
    );
    process.exit(1);
  }

  // ── Resolve file path ─────────────────────────────────────────────
  let filePath = opts.file;
  if (!filePath) {
    filePath = findDefaultFile(opts.periodTag || null);
    if (!filePath) {
      console.error("Error: Could not automatically find the latest slot_item_effects_YYYY-MM-DD.json in equip_synergy_detector/output.");
      process.exit(1);
    }
  }
  filePath = resolve(filePath);
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    console.error(
      "  Run `pnpm scan:volatile` in equip_synergy_detector first, or pass --file <path>",
    );
    process.exit(1);
  }

  // ── Read file and parse metadata ───────────────────────────────────
  const fileBuffer = readFileSync(filePath);
  const fileHash = sha256(fileBuffer);
  const fileSizeKB = (fileBuffer.length / 1024).toFixed(1);
  const useBrotli =
    opts.br === true
      ? true
      : opts.noBr === true
        ? false
        : opts.env === "production"
          ? false
          : true;

  const uploadBuffer = useBrotli
    ? brotliCompressSync(fileBuffer, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        },
      })
    : fileBuffer;
  const uploadSizeKB = (uploadBuffer.length / 1024).toFixed(1);

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
    console.error("Error: period_tag is required.");
    console.error(
      "  Pass --period-tag YYYY-MM-DD, or re-run scan.js with --period-tag YYYY-MM-DD to embed it.",
    );
    process.exit(1);
  }
  const apiStart2Hash = opts.apiStart2Hash || meta.api_start2_batch_hash;
  const generatorVersion = meta.generator_version || "v0.1.0";
  const apiBase = resolveApiBase(opts.env);
  const bucketName = resolveR2BucketName(opts.env, opts.bucketName);
  const adminToken = opts.adminToken || process.env.ADMIN_TOKEN;

  // ── Validate ───────────────────────────────────────────────────────
  if (!validatePeriodTag(periodTag)) {
    console.error(
      `Error: Invalid period-tag: "${periodTag}" (expected YYYY-MM-DD)`,
    );
    process.exit(1);
  }
  if (!apiStart2Hash) {
    console.error("Error: api-start2-hash not found.");
    console.error(
      "  Either pass --api-start2-hash, or re-run scan.js to embed it automatically.",
    );
    process.exit(1);
  }
  if (!validateSHA256(apiStart2Hash)) {
    console.error(
      `Error: api-start2-hash is not a valid 64-char SHA-256 hex string`,
    );
    process.exit(1);
  }
  if (!opts.dryRun && !adminToken) {
    console.error(
      "Error: admin token not found. Pass --admin-token or set the ADMIN_TOKEN env var.",
    );
    process.exit(1);
  }

  // ── Print plan ─────────────────────────────────────────────────────
  console.log("=== Synergy Upload Plan ===");
  console.log(`  File:             ${basename(filePath)} (${fileSizeKB} KB)`);
  console.log(
    `  Upload Payload:   ${useBrotli ? "brotli" : "raw json"} (${uploadSizeKB} KB)`,
  );
  console.log(`  SHA-256:          ${fileHash}`);
  console.log(`  Period Tag:       ${periodTag}`);
  console.log(`  API Start2 Hash:  ${apiStart2Hash}`);
  console.log(`  Generator:        ${generatorVersion}`);
  console.log(`  Generated At:     ${meta.generated}`);
  console.log(`  API Base:         ${apiBase}`);
  console.log(`  R2 Bucket:        ${bucketName}`);
  const adminTokenLabel = adminToken
    ? "***"
    : opts.dryRun
      ? "(not required for dry-run)"
      : "(missing)";
  console.log(`  Admin Token:      ${adminTokenLabel}`);
  console.log();

  if (opts.env === "production" && !useBrotli) {
    console.log(
      "  note: production upload defaults to raw json for compatibility (use --br to override)",
    );
    console.log();
  }

  if (opts.dryRun) {
    console.log("[dry-run] Would execute the following steps:");
    console.log(
      `  1. POST /api/master-data/synergy-manifest (allocate manifest)`,
    );
    console.log(
      `  2. wrangler r2 object put ${bucketName}/<r2key> (upload JSON to R2)`,
    );
    console.log(
      `  3. POST /api/master-data/synergy-manifest/complete (finalize)`,
    );
    return;
  }

  // Step 1: Allocate manifest
  console.log("[1/3] Allocating synergy manifest...");
  let manifest;
  try {
    manifest = await allocateSynergyManifest(
      apiBase,
      {
        period_tag: periodTag,
        sp_effect_sha256: fileHash,
        api_start2_batch_hash: apiStart2Hash,
        generator_version: generatorVersion,
        generated_at: meta.generated,
        allow_duplicate_content: opts.force === true,
      },
      adminToken,
    );
  } catch (err) {
    const isDuplicate =
      err instanceof ApiError &&
      err.status === 409 &&
      typeof err.body?.error === "string" &&
      err.body.error.includes("Duplicate");

    if (isDuplicate) {
      throw new Error(
        `${err.message}\nHint: Retry with --force to allocate a fresh latest revision for the same content.`,
      );
    } else {
      throw err;
    }
  }
  console.log(
    `  ✓ Allocated: period_revision=${manifest.period_revision}, id=${manifest.id}`,
  );
  console.log(`  R2 key: ${manifest.r2_keys.sp_effect_json}`);
  console.log();

  // Step 2: Upload to R2 via wrangler
  console.log("[2/3] Uploading to R2...");
  const uploadTmpPath = resolve(`${filePath}.upload.bin`);
  writeFileSync(uploadTmpPath, uploadBuffer);
  try {
    wranglerR2Put(
      manifest.r2_keys.sp_effect_json,
      uploadTmpPath,
      opts.env,
      bucketName,
    );
  } finally {
    if (existsSync(uploadTmpPath)) unlinkSync(uploadTmpPath);
  }
  console.log(
    `  ✓ sp_effect_item uploaded: ${manifest.r2_keys.sp_effect_json}`,
  );

  // Create and upload the manifest sidecar JSON for the allocated revision.
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
    wranglerR2Put(
      manifest.r2_keys.manifest,
      sidecarTmp,
      opts.env,
      bucketName,
    );
    console.log(
      `  ✓ manifest sidecar uploaded: ${manifest.r2_keys.manifest}`,
    );
  } finally {
    unlinkSync(sidecarTmp);
  }
  console.log();

  // Step 3: Mark as completed
  console.log("[3/3] Finalizing manifest...");
  let finalUploadStatus;
  try {
    const completed = await apiPost(
      apiBase,
      `/api/master-data/synergy-manifest/complete/${periodTag}/${manifest.period_revision}`,
      {},
      adminToken,
    );
    finalUploadStatus = completed.upload_status;
    console.log(
      `  ✓ ${completed.message} (status: ${completed.upload_status})`,
    );
  } catch (err) {
    throw err;
  }
  console.log();

  console.log("=== Done ===");
  console.log(`  period_tag:      ${periodTag}`);
  console.log(`  period_revision: ${manifest.period_revision}`);
  console.log(`  upload_status:   ${finalUploadStatus}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
